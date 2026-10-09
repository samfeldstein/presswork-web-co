import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, contrastProblems, cssProblems, hostProblems, maskProblems, scriptProblems } from "../check.mjs";

test("cssProblems accepts balanced CSS, including braces in strings and comments", () => {
  assert.deepEqual(cssProblems('a{color:red}@media (min-width:1px){b{c:d}}\n/* } { */ i::before{content:"}"}'), []);
});

test("cssProblems reports an extra closing brace with its line", () => {
  assert.deepEqual(cssProblems("a{b:c}\n}\n"), ['unmatched "}" on line 2']);
});

test("cssProblems reports a block that never closes", () => {
  assert.match(cssProblems("a{b:c}\n.x{\n  y:z;\n")[0], /unclosed "\{".*line 2/);
});

test("cssProblems reports an unterminated comment and string", () => {
  assert.match(cssProblems("a{b:c} /* oops")[0], /unterminated comment/);
  assert.match(cssProblems('a{content:"oops}')[0], /unterminated string/);
});

function copyOfSite() {
  const dir = mkdtempSync(join(tmpdir(), "presswork-check-"));
  cpSync(new URL("../site", import.meta.url), join(dir, "site"), { recursive: true });
  cpSync(new URL("../shared", import.meta.url), join(dir, "shared"), { recursive: true });
  return dir;
}

test("check passes on a clean copy of the site", () => {
  const dir = copyOfSite();
  try {
    assert.deepEqual(check({ root: join(dir, "site"), shared: join(dir, "shared") }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check reports broken CSS files, broken inline styles and dangling id references", () => {
  const dir = copyOfSite();
  try {
    appendFileSync(join(dir, "site/css/tokens.css"), "\n}\n");
    const page = join(dir, "site/about/index.html");
    const html = readFileSync(page, "utf8");
    writeFileSync(
      page,
      html.replace(/<main\b[^>]*>/, (open) => `${open}<style>.x{</style><p aria-labelledby="nope" id="p1">x</p><label for="missing">y</label>`),
    );
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared") });
    assert.ok(problems.some((p) => /css\/tokens\.css: unmatched "\}"/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /inline <style>: unclosed/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /aria-labelledby="nope".*doesn't exist/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /for="missing".*doesn't exist/.test(p)), problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an email address at the end of a sentence is accepted", () => {
  const dir = copyOfSite();
  try {
    const page = join(dir, "site/about/index.html");
    const html = readFileSync(page, "utf8");
    writeFileSync(page, html.replace(/<main\b[^>]*>/, (open) => `${open}<p>Write to hello@presswork.dev.</p><p>Or to boss@other.example.</p>`));
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared") });
    assert.ok(!problems.some((p) => /email hello@presswork\.dev is not/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /boss@other\.example is not the one/.test(p)), problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check reports a page over its size budget", () => {
  const dir = copyOfSite();
  try {
    const file = join(dir, "shared/facts.json");
    const facts = JSON.parse(readFileSync(file, "utf8"));
    facts.sizeBudgetKB = { default: 100, "/": 1 };
    writeFileSync(file, JSON.stringify(facts, null, 2));
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared") });
    assert.ok(problems.some((p) => /index\.html: .* KB gzipped .* over its 1 KB budget/.test(p)), problems.join("\n"));
    assert.equal(problems.filter((p) => /budget/.test(p)).length, 1, problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("contrastProblems resolves tokens and reports pairs below the minimum", () => {
  const tokens = ":root { --a: #ffffff; --b: #000000; --c: #777777; --fg: var(--a); --bg: var(--b); --low: var(--c); }";
  assert.deepEqual(contrastProblems(tokens, [{ fg: "--fg", bg: "--bg" }]), []);
  assert.match(contrastProblems(tokens, [{ fg: "--low", bg: "--a" }])[0], /--low \(#777777\) on --a \(#ffffff\) is 4\.48:1, below 4\.5:1/);
  assert.match(contrastProblems(tokens, [{ fg: "--nope", bg: "--a" }])[0], /can't resolve --nope/);
});

test("maskProblems flags a mask on anything animated and allows a static one", () => {
  assert.deepEqual(maskProblems(".ring::before { mask: radial-gradient(#000, transparent); }"), []);
  assert.equal(maskProblems(".a { mask-image: url(x.svg); animation: spin 1s linear infinite; }").length, 1);
  assert.equal(maskProblems(".a { animation: spin 1s; .b { -webkit-mask-image: linear-gradient(#000, #000); } }").length, 1);
  assert.equal(maskProblems("@keyframes k { to { mask-image: linear-gradient(#000, #000); } }").length, 1);
  assert.deepEqual(maskProblems(".a { animation: none; mask: url(data:image/png;base64,AAA); }"), []);
});

test("scriptProblems wants a self-calling function around the whole script", () => {
  assert.deepEqual(scriptProblems("(() => {\n  const a = 1;\n})();\n"), []);
  assert.deepEqual(scriptProblems("(function () { var a = 1; })();"), []);
  assert.deepEqual(scriptProblems("(function () { var a = 1; }());"), []);
  assert.deepEqual(scriptProblems("// note\n(async () => { await 1; })();"), []);
  assert.equal(scriptProblems("const reduceMotion = 1;").length, 1);
  assert.equal(scriptProblems("(() => {})();\nconst leak = 1;").length, 1);
});

test("hostProblems allows listed hosts and flags others", () => {
  const allowed = ["presswork.dev", "www.w3.org"];
  assert.deepEqual(hostProblems('createElementNS("http://www.w3.org/2000/svg", "svg")', allowed), []);
  assert.equal(hostProblems('fetch("https://analytics.example.com/x")', allowed).length, 1);
  assert.equal(hostProblems("//cdn.example.net/lib.js", allowed).length, 1);
});

test("check reports an unwrapped script and third-party hosts", () => {
  const dir = copyOfSite();
  try {
    writeFileSync(join(dir, "site/js/leaky.js"), 'const x = 1;\nfetch("https://tracker.example.com/");\n');
    const page = join(dir, "site/about/index.html");
    const html = readFileSync(page, "utf8");
    writeFileSync(
      page,
      html.replace(
        /<main\b[^>]*>/,
        (open) => `${open}<script>var leak = 1;</script><script src="https://cdn.example.org/lib.js"></script><img src="//img.example.io/a.png" alt=""><a href="https://example.com/">fine</a>`,
      ),
    );
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared") });
    assert.ok(problems.some((p) => /js\/leaky\.js: script isn't wrapped/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /js\/leaky\.js: refers to tracker\.example\.com/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /about\/index\.html: inline <script>: script isn't wrapped/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /<script> refers to cdn\.example\.org/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /<img> refers to img\.example\.io/.test(p)), problems.join("\n"));
    assert.ok(!problems.some((p) => /<a>/.test(p)), problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
