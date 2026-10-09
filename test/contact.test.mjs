// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, buildEmail, tooFast, typedValues } from "../worker/validate.js";
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
  const r = validate(form({ ...good, name: "Eve\nEmail: boss@x.com", business: "A\r\nB" }));
  assert.equal(r.ok, true);
  assert.equal(r.data.name, "Eve Email: boss@x.com");
  assert.equal(r.data.business, "A B");
  const mail = buildEmail(r.data, "Presswork Web Co.");
  assert.equal(mail.subject, "New inquiry from Eve Email: boss@x.com, A B");
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
  const res = await worker.fetch(post({ name: "", email: "x", message: "" }, { accept: "application/json" }), env());
  assert.equal(res.status, 400);
  assert.ok((await res.json()).fields.email);
});

test("a failed send returns 500 and the generic message", async () => {
  const e = env({ send: async () => { throw new Error("down"); } });
  const res = await worker.fetch(post({ ...good, renderedAt: old() }, { accept: "application/json" }), e);
  assert.equal(res.status, 500);
  assert.match((await res.json()).message, /couldn't be sent/);
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
  const bad = await worker.fetch(post({ name: "", email: "x", message: "" }), e);
  assert.equal(bad.status, 500);
  assert.match(await bad.text(), /couldn't be sent/);
});
