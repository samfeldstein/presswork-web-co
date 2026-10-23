import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../check.mjs";
import { copyExtract, copyName, straightQuotes, sync, typography } from "../sync.mjs";

function copyOfSite() {
  const dir = mkdtempSync(join(tmpdir(), "presswork-sync-"));
  for (const name of ["site", "shared", "copy"]) cpSync(new URL(`../${name}`, import.meta.url), join(dir, name), { recursive: true });
  return dir;
}

test("copyExtract writes headings, list items and paragraphs, and drops links, markup and hidden text", () => {
  const html = `<html><head><title>T</title></head><body>
    <script>var x = "no";</script><style>p{}</style>
    <main><h1>Big <em>news.</em></h1>
    <p>Read <a href="/x/">our page</a> &amp; more.</p>
    <h2><span class="visually-hidden">Hidden: </span>Shown</h2>
    <ul><li>One</li><li><b>Two</b></li></ul>
    <p><span class="label">5 pages</span><span class="total">$2,000</span></p>
    <p>Price<span class="dot">.</span></p>
    <div inert><label>Leave this empty</label></div>
    <svg aria-hidden="true"><text>nope</text></svg>
    <a class="button" href="/a/"><span>First</span></a><a class="button" href="/b/">Second</a>
    </main></body></html>`;
  assert.equal(
    copyExtract(html),
    "# Big news.\n\nRead our page & more.\n\n## Shown\n\n- One\n- Two\n\n5 pages $2,000\n\nPrice.\n\nFirst\n\nSecond\n",
  );
});

test("copyName maps page paths to file names", () => {
  assert.equal(copyName("/"), "home.md");
  assert.equal(copyName("/pricing/"), "pricing.md");
  assert.equal(copyName("/404.html"), "404.md");
  assert.equal(copyName("/work/bakery/"), "work-bakery.md");
});

test("sync writes an extract for every page and removes extracts without a page", () => {
  const dir = copyOfSite();
  try {
    const copy = join(dir, "copy");
    writeFileSync(join(copy, "gone.md"), "old page\n");
    rmSync(join(copy, "about.md"));
    sync({ root: join(dir, "site"), shared: join(dir, "shared"), copy });
    assert.ok(!existsSync(join(copy, "gone.md")));
    assert.match(readFileSync(join(copy, "about.md"), "utf8"), /^# A small shop, and we like it that way\.$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check fails when a copy extract is stale, missing or has no page", () => {
  const dir = copyOfSite();
  try {
    const copy = join(dir, "copy");
    const page = join(dir, "site/about/index.html");
    writeFileSync(page, readFileSync(page, "utf8").replace("<h1>A small shop,", "<h1>A tiny shop,"));
    rmSync(join(copy, "404.md"));
    writeFileSync(join(copy, "gone.md"), "old page\n");
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared"), copy });
    for (const name of ["about", "404", "gone"]) {
      assert.ok(problems.some((p) => new RegExp(`^copy/${name}\\.md: copy extract is stale`).test(p)), problems.join("\n"));
    }
    assert.equal(problems.length, 3, problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("typography curls quotes, apostrophes and ellipses in text only", () => {
  const html = `<p class="it's" title='say "hi"'>It's "great"... we're 'in'</p><script>var a = 'x';</script><style>a::after{content:"'"}</style><code>don't</code><!-- don't -->`;
  assert.equal(
    typography(html),
    `<p class="it's" title='say "hi"'>It\u2019s \u201cgreat\u201d\u2026 we\u2019re \u2018in\u2019</p><script>var a = 'x';</script><style>a::after{content:"'"}</style><code>don't</code><!-- don't -->`,
  );
});

test("typography reads quotes across inline tags and restarts at blocks", () => {
  assert.equal(typography(`<p>"<em>Hello</em>," she said. The <b>shop</b>'s door.</p><p>'Tis</p>`), `<p>\u201c<em>Hello</em>,\u201d she said. The <b>shop</b>\u2019s door.</p><p>\u2018Tis</p>`);
});

test("typography leaves already curly text alone", () => {
  const html = "<p>It\u2019s \u201cdone.\u201d</p>";
  assert.equal(typography(html), html);
  assert.equal(typography(typography(`<p>It's "x"</p>`)), typography(`<p>It's "x"</p>`));
});

test("straightQuotes finds straight quotes in text and entities, not in attributes or code", () => {
  assert.deepEqual(straightQuotes(`<p title="a'b">fine</p><code>"x"</code>`), []);
  assert.equal(straightQuotes(`<p>It's</p>`).length, 1);
  assert.equal(straightQuotes(`<p>&quot;x&quot;</p>`).length, 2);
});

test("sync curls page text and check fails on a straight quote left in text", () => {
  const dir = copyOfSite();
  try {
    const page = join(dir, "site/about/index.html");
    const html = readFileSync(page, "utf8").replace("<h1>A small shop,", "<h1>A shop that's small, &quot;honest&quot;,");
    writeFileSync(page, html);
    const problems = check({ root: join(dir, "site"), shared: join(dir, "shared"), copy: join(dir, "copy") });
    assert.ok(problems.some((p) => /^about\/index\.html: out of date/.test(p)), problems.join("\n"));
    assert.equal(problems.filter((p) => /straight quote/.test(p)).length, 3, problems.join("\n"));
    sync({ root: join(dir, "site"), shared: join(dir, "shared"), copy: join(dir, "copy") });
    assert.match(readFileSync(page, "utf8"), /<h1>A shop that\u2019s small, &quot;honest&quot;,/);
    assert.deepEqual(
      check({ root: join(dir, "site"), shared: join(dir, "shared"), copy: join(dir, "copy") }).map((p) => p.replace(/: ".*/, "")),
      ["about/index.html: straight quote or \"...\" in text", "about/index.html: straight quote or \"...\" in text"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
