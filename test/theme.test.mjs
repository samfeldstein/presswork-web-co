import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tokens = readFileSync(new URL("../site/css/tokens.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = tokens.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `tokens.css has no ${selector} block`);
  return tokens.slice(start, tokens.indexOf("}", start));
};
const colors = (css) => Object.fromEntries([...css.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const dark = colors(block(":root"));
const light = colors(block(':root[data-theme="light"]'));
const fallback = colors(block(":root:not([data-theme])"));

test("the light theme sets every color token the dark theme sets", () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

test("light color tokens point only at day inks, so the contrast check covers them", () => {
  for (const [name, value] of Object.entries(light)) assert.match(value, /^var\(--ink-day-[\w-]+\)$/, name);
});

test("the no-JS light fallback matches the light theme", () => {
  assert.deepEqual(fallback, light);
});

test("every day ink used by the light theme is in the facts.json contrast list", () => {
  const facts = JSON.parse(readFileSync(new URL("../shared/facts.json", import.meta.url), "utf8"));
  const listed = new Set(facts.contrast.flatMap((p) => [p.fg, p.bg]));
  const used = Object.entries(light)
    .filter(([name]) => name !== "--color-rule")
    .map(([, v]) => v.slice(4, -1));
  for (const ink of used) assert.ok(listed.has(ink), `${ink} is not in a contrast pair`);
});

const head = readFileSync(new URL("../shared/head.html", import.meta.url), "utf8");
const components = readFileSync(new URL("../site/css/components.css", import.meta.url), "utf8");

test("the stored theme is applied before any stylesheet loads", () => {
  const script = head.indexOf('localStorage.getItem("theme")');
  assert.notEqual(script, -1);
  assert.ok(script < head.indexOf('<link rel="stylesheet"'));
});

test("the first-paint background uses the theme colors from facts.json, which match the paper inks", () => {
  const facts = JSON.parse(readFileSync(new URL("../shared/facts.json", import.meta.url), "utf8"));
  const ink = (name) => new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "i").exec(tokens)[1].toLowerCase();
  assert.equal(facts.site.themeColor.toLowerCase(), ink("--ink-night"));
  assert.equal(facts.site.themeColorLight.toLowerCase(), ink("--ink-day-paper"));
  assert.match(head, /html\[data-theme=light\]\{background:\{\{site\.themeColorLight\}\}/);
  assert.match(head, /html:not\(\[data-theme\]\)\{background:\{\{site\.themeColorLight\}\}/);
});

test("the light-only rules in components.css are the same for the toggle and the system setting", () => {
  const byAttr = /:root\[data-theme="light"\] \{([\s\S]*?)\n\}/.exec(components)[1].replace(/\s+/g, " ").trim();
  const bySystem = /:root:not\(\[data-theme\]\) \{([\s\S]*?)\n  \}/.exec(components)[1].replace(/\s+/g, " ").trim();
  assert.equal(bySystem, byAttr);
});
