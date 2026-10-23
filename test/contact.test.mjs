// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, buildEmail, typedValues } from "../worker/validate.js";
import { tooFast, botReason, trapped, looksLikeSpam, HONEYPOT } from "../worker/spam.js";
import { stampTime, sentState, errorState } from "../worker/render.js";
import worker from "../worker/index.js";

const page = readFileSync(new URL("../site/contact/index.html", import.meta.url), "utf8");
const form = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};
const good = { name: "Rosa", email: "rosa@example.com", message: "Hello" };

// ---- validation
test("accepts a minimal valid submission", () => {
  const r = validate(form(good));
  assert.equal(r.ok, true);
  assert.equal(r.data.business, undefined);
});

test("requires name, a valid email and a message", () => {
  const r = validate(form({ name: " ", email: "nope", message: "" }));
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.fields).sort(), ["email", "message", "name"]);
  assert.equal(r.fields.email[0], "Enter a valid email address.");
});

test("missing fields fail the same way as empty ones", () => {
  assert.equal(validate(form({})).ok, false);
});

test("a free audit needs a website", () => {
  const r = validate(form({ ...good, audit: "on" }));
  assert.equal(r.ok, false);
  assert.equal(r.fields.siteUrl[0], "Enter your current website so we can audit it.");
  assert.equal(validate(form({ ...good, audit: "on", siteUrl: "example.com" })).ok, true);
});

test("one-line fields cannot carry line breaks into the email", () => {
  const r = validate(form({ ...good, name: "Eve\nEmail: boss@example", business: "A\r\nB" }));
  assert.equal(r.ok, true);
  assert.equal(r.data.name, "Eve Email: boss@example");
  assert.equal(r.data.business, "A B");
  const mail = buildEmail(r.data, "Presswork Web Co.");
  assert.equal(mail.subject, "New inquiry from Eve Email: boss@example, A B");
  assert.equal(mail.text.split("\n").filter((l) => l.startsWith("Email:")).length, 1);
});

test("length limits", () => {
  assert.equal(validate(form({ ...good, name: "x".repeat(201) })).ok, false);
  assert.equal(validate(form({ ...good, message: "x".repeat(5001) })).ok, false);
  assert.equal(validate(form({ ...good, message: "x".repeat(5000) })).ok, true);
});

test("email body lists audit and site only when asked", () => {
  const r = validate(form({ ...good, business: "Rosa's", audit: "on", siteUrl: "rosas.example" }));
  const mail = buildEmail(r.data, "Presswork Web Co.");
  assert.match(mail.text, /^Name: Rosa\nEmail: rosa@example.com\nBusiness: Rosa's\nFree site audit: requested\nCurrent site: rosas.example\n\nHello$/);
  assert.equal(mail.replyTo, "rosa@example.com");
  assert.equal(mail.from.email, "form@presswork.dev");
});

test("the timing trap", () => {
  assert.equal(tooFast(undefined).bot, true);
  assert.equal(tooFast("__RENDERED_AT__").bot, true);
  assert.equal(tooFast(String(Date.now() - 500)).bot, true);
  assert.equal(tooFast(String(Date.now() - 5000)).bot, false);
});

test("the timing trap rejects empty, short, non-numeric and future timestamps", () => {
  for (const value of ["", "   ", "0", "1", "12345", "abc", "1e12", "-1783000000000", String(Date.now() + 60_000)]) {
    assert.equal(tooFast(value).bot, true, JSON.stringify(value));
  }
  assert.equal(tooFast(null).bot, true);
});

// ---- page changes
test("the page has what the Worker edits", () => {
  assert.match(page, /__RENDERED_AT__/);
  assert.match(page, /<div class="summary" data-summary [^>]*hidden><\/div>/);
  assert.match(page, /<section class="thanks" data-thanks hidden/);
});

test("stampTime fills in the timestamp", () => {
  assert.match(stampTime(page, 12345), /name="renderedAt" value="12345"/);
});

test("sentState shows the thank-you and drops the form", () => {
  const out = sentState(page);
  assert.doesNotMatch(out, /<form/);
  assert.match(out, /<section class="thanks" data-thanks tabindex/);
});

test("errorState refills values, escapes them, and shows the errors", () => {
  const bad = form({ name: 'Ro"><script>x</script>', email: "nope", message: "Line 1 & <b>2</b>", audit: "on" });
  const r = validate(bad);
  const out = errorState(stampTime(page), { fields: r.fields, typed: typedValues(bad) });
  assert.doesNotMatch(out, /<script>x/);
  assert.match(out, /value="Ro&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
  assert.match(out, /Line 1 &amp; &lt;b&gt;2&lt;\/b&gt;<\/textarea>/);
  assert.match(out, /id="field-email-error">Enter a valid email address\./);
  assert.match(out, /aria-invalid="true" aria-describedby="field-email-error"/);
  assert.match(out, /<input type="checkbox" name="audit" checked/);
  assert.match(out, /data-summary [^>]*>(?!<\/div>).*Please fix the following:/);
  assert.doesNotMatch(out, /data-summary [^>]*hidden/);
  assert.match(out, /data-summary [^>]*role="alert"/);
});

test("errorState with only a general message", () => {
  const out = errorState(page, { message: "Nope" });
  assert.match(out, /data-summary [^>]*><p>Nope<\/p><\/div>/);
});

// ---- the Worker
function env({ send } = {}) {
  const sent = [];
  return {
    sent,
    ASSETS: { fetch: async (req) => (new URL(req.url).pathname === "/contact/" ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("asset")) },
    EMAIL: { send: send ?? (async (m) => void sent.push(m)) },
    CONTACT_TO_EMAIL: "owner@example.com",
  };
}
const post = (fields, headers = {}) =>
  new Request("https://presswork.dev/contact/", { method: "POST", body: form(fields), headers });
const old = () => String(Date.now() - 10_000);

test("GET /contact/ stamps the time, uncached", async () => {
  const res = await worker.fetch(new Request("https://presswork.dev/contact/"), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /name="renderedAt" value="\d{13}"/);
});

test("GET /contact/?sent=1 shows the thank-you", async () => {
  const res = await worker.fetch(new Request("https://presswork.dev/contact/?sent=1"), env());
  assert.doesNotMatch(await res.text(), /<form/);
});

test("/contact redirects to /contact/", async () => {
  const res = await worker.fetch(new Request("https://presswork.dev/contact"), env());
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://presswork.dev/contact/");
});

test("other paths go to the assets", async () => {
  const res = await worker.fetch(new Request("https://presswork.dev/pricing/"), env());
  assert.equal(await res.text(), "asset");
});

test("valid JSON post sends one email", async () => {
  const e = env();
  const res = await worker.fetch(post({ ...good, renderedAt: old() }, { accept: "application/json" }), e);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true });
  assert.equal(e.sent.length, 1);
  assert.equal(e.sent[0].to, "owner@example.com");
  assert.equal(e.sent[0].replyTo, "rosa@example.com");
});

test("a too-fast post pretends to succeed and sends nothing", async () => {
  const e = env();
  const res = await worker.fetch(post({ ...good, renderedAt: String(Date.now()) }, { accept: "application/json" }), e);
  assert.deepEqual(await res.json(), { sent: true });
  assert.equal(e.sent.length, 0);
});

test("invalid JSON post returns the field errors", async () => {
  const res = await worker.fetch(post({ name: "", email: "x", message: "", renderedAt: old() }, { accept: "application/json" }), env());
  assert.equal(res.status, 400);
  assert.ok((await res.json()).fields.email);
});

test("a failed send returns 500 and the generic message", async () => {
  const e = env({ send: async () => { throw new Error("down"); } });
  const res = await worker.fetch(post({ ...good, renderedAt: old() }, { accept: "application/json" }), e);
  assert.equal(res.status, 500);
  assert.match((await res.json()).message, /couldn’t be sent/);
});

test("plain post: success redirects to the thank-you", async () => {
  const res = await worker.fetch(post({ ...good, renderedAt: old() }), env());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "https://presswork.dev/contact/?sent=1");
});

test("plain post: errors come back on the page with the typed values", async () => {
  const res = await worker.fetch(post({ name: "Rosa", email: "bad", message: "Hi", renderedAt: old() }), env());
  assert.equal(res.status, 400);
  const out = await res.text();
  assert.match(out, /value="Rosa"/);
  assert.match(out, /Enter a valid email address\./);
});

test("other methods are refused", async () => {
  const res = await worker.fetch(new Request("https://presswork.dev/contact/", { method: "PUT" }), env());
  assert.equal(res.status, 405);
});

test("a body over the size limit is refused with 413 without reading it all", async () => {
  const e = env();
  let pulls = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(16_384));
    },
  });
  const request = new Request("https://presswork.dev/contact/", {
    method: "POST",
    body: endless,
    duplex: "half",
    headers: { accept: "application/json", "content-type": "multipart/form-data; boundary=x" },
  });
  const res = await worker.fetch(request, e);
  assert.equal(res.status, 413);
  assert.match((await res.json()).message, /too large/);
  assert.ok(pulls < 20, `read ${pulls} chunks`);
  assert.equal(e.sent.length, 0);
});

test("a declared content-length over the limit is refused before reading", async () => {
  const headers = { accept: "application/json", "content-length": "999999" };
  const res = await worker.fetch(post({ ...good, renderedAt: old() }, headers), env());
  assert.equal(res.status, 413);
});

test("a missing contact page asset is an error, not a 200", async () => {
  const e = { ...env(), ASSETS: { fetch: async () => new Response("not found page", { status: 404 }) } };
  const get = await worker.fetch(new Request("https://presswork.dev/contact/"), e);
  assert.equal(get.status, 500);
  assert.doesNotMatch(await get.text(), /not found page/);
  const bad = await worker.fetch(post({ name: "", email: "x", message: "", renderedAt: old() }), e);
  assert.equal(bad.status, 500);
  assert.match(await bad.text(), /couldn’t be sent/);
});


// ---- spam defenses
const spamNames = [
  'Your balance: $39,437.15 GET > "https://www.google.com/share.google?q=BOVPro5Xbso0J7rSL"',
  "Visit www.x.com",
  "https://x.io",
  "bit.ly/abc",
  "Rosa $500",
  "€1.000",
  "ｗｗｗ.example.com",
  "x\u200b.com",
  "a<b",
];
const realNames = [
  "Rosa", "José Núñez", "O'Brien", "Smith & Co.", "Studio 54", "Dr. Smith", "St.John", "J.R.R. Tolkien",
  "Mary-Kate", "李雷", "Zoë", 'Robert "Bob" Smith', "Rosa (Rosa's Bakery)", "Rosa 555-123-4567", "Ana.Co", "Mr.Me",
];

test("the name check catches links, money, and angle brackets", () => {
  for (const name of spamNames) assert.equal(looksLikeSpam(name), true, JSON.stringify(name));
});

test("the name check lets real names through", () => {
  for (const name of realNames) assert.equal(looksLikeSpam(name), false, JSON.stringify(name));
});

test("a spammy name gets a field error; business is not checked", () => {
  const r = validate(form({ ...good, name: spamNames[0] }));
  assert.equal(r.ok, false);
  assert.match(r.fields.name[0], /Enter just your name here/);
  for (const business of ["Acme.io", "$5 Pizza", "www.acme.com"]) {
    assert.equal(validate(form({ ...good, business })).ok, true, business);
  }
});

test("botReason is the timing check; trapped is the honeypot", () => {
  assert.equal(botReason(form({ ...good, renderedAt: old(), [HONEYPOT]: "x" })), null);
  assert.equal(botReason(form({ ...good, renderedAt: old() })), null);
  assert.match(botReason(form({ ...good })), /without a valid timestamp \(none\)/);
  assert.equal(trapped(form({ ...good, [HONEYPOT]: "x" })), true);
  assert.equal(trapped(form({ ...good, [HONEYPOT]: "" })), false);
  assert.equal(trapped(form(good)), false);
});

test("the page has the honeypot, hidden from people and keyboards", () => {
  const block = page.match(/<div class="extra" aria-hidden="true" inert>[\s\S]*?<\/div>/)?.[0];
  assert.ok(block, "honeypot wrapper");
  assert.match(block, new RegExp(`<input id="field-${HONEYPOT}" name="${HONEYPOT}" type="text" tabindex="-1" autocomplete="off">`));
  assert.match(block, new RegExp(`<label for="field-${HONEYPOT}">`));
  assert.doesNotMatch(block, /class="field"/);
});

test("a filled honeypot still sends, marked as likely spam, and logs no personal data", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const e = env();
  const json = await worker.fetch(post({ ...good, renderedAt: old(), [HONEYPOT]: "x" }, { accept: "application/json" }), e);
  assert.deepEqual(await json.json(), { sent: true });
  const plain = await worker.fetch(post({ ...good, renderedAt: old(), [HONEYPOT]: "x" }), e);
  assert.equal(plain.status, 303);
  assert.equal(e.sent.length, 2);
  assert.equal(e.sent[0].subject, "[Likely spam] New inquiry from Rosa");
  assert.match(e.sent[0].text, /^Likely spam: a hidden field was filled in\. Check before replying\.\n\nName: Rosa\n/);
  const logged = log.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(logged, /message sent as likely spam \(hidden field filled\)/);
  assert.doesNotMatch(logged, /Rosa|rosa@example\.com|Hello/);
});

test("an empty honeypot sends a normal subject", async () => {
  const e = env();
  await worker.fetch(post({ ...good, renderedAt: old(), [HONEYPOT]: "" }, { accept: "application/json" }), e);
  assert.equal(e.sent[0].subject, "New inquiry from Rosa");
  assert.match(e.sent[0].text, /^Name: Rosa\n/);
});

test("a too-fast bot with bad fields still gets the fake success", async (t) => {
  t.mock.method(console, "warn", () => {});
  const e = env();
  const res = await worker.fetch(post({ name: spamNames[0], email: "x", message: "", renderedAt: String(Date.now()) }, { accept: "application/json" }), e);
  assert.deepEqual(await res.json(), { sent: true });
  assert.equal(e.sent.length, 0);
});

test("a spammy name from a person comes back as a field error and sends nothing", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const e = env();
  const res = await worker.fetch(post({ ...good, name: spamNames[0], renderedAt: old() }, { accept: "application/json" }), e);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).fields.name);
  assert.equal(e.sent.length, 0);
  assert.equal(log.mock.calls[0].arguments[0], "contact: rejected (name)");
});

test("the honeypot value is never echoed back", async () => {
  const res = await worker.fetch(post({ name: "", email: "x", message: "", [HONEYPOT]: "", renderedAt: old() }), env());
  assert.doesNotMatch(await res.text(), new RegExp(`name="${HONEYPOT}"[^>]*value=`));
});

test("failure logs carry only the error message", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  const e = env({ send: async () => { throw new Error("down"); } });
  await worker.fetch(post({ ...good, renderedAt: old() }, { accept: "application/json" }), e);
  assert.deepEqual(error.mock.calls[0].arguments, ["contact: Email Service rejected the message: down"]);
});
