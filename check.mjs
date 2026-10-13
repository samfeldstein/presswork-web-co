#!/usr/bin/env node
/*
  check.mjs: fails when the site has drifted or something is broken.
  No dependencies. Run it (after sync.mjs) before every deploy.

  What it checks:
    - sync is up to date: shared parts, sitemaps (runs sync.mjs --dry)
    - each page: lang, one <h1>, one <main id="main">, headings that don't
      skip a level, unique ids, <img> alt text, a title and description
    - every link and asset path resolves to a real file (in pages and CSS),
      page links end in "/", and #fragments point at a real id
    - label for / aria-labelledby / aria-describedby / aria-controls values
      point at ids that exist on the same page
    - CSS (files and inline <style>) has balanced braces and no unterminated
      comments or strings
    - prices and emails: every $ amount on the site must be listed in
      shared/facts.json, and the only email address is the one in facts
    - every character shown on the page is covered by the font files we ship
      (or listed in facts.json "allowedChars": decorative symbols that are
      meant to come from the system font, like the stars in the bakery drawing)
    - robots.txt points at a sitemap that exists
    - no mask or mask-image on an animated rule or inside @keyframes (a moving
      mask is drawn in software in Firefox)
    - every script file is loaded as a module (type="module"), every classic
      inline script runs inside a self-calling function, and
      no script, stylesheet, image or form points at a host outside facts.json
      "allowedHosts" (plain <a> links to other sites are fine)
    - text/background color pairs listed in facts.json "contrast" meet WCAG AA
      (4.5:1), read from the tokens in css/tokens.css
    - each page's gzipped HTML + linked CSS and JS stays within its budget in
      facts.json "sizeBudgetKB" (a "default" and optional per-path overrides)

  Usage: node check.mjs [--root site] [--shared shared] [--facts]
  --facts prints where each price appears, to review after a price change.
*/
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { sync } from "./sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®",
  trade: "™", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", times: "×", bull: "•", shy: "­",
  thinsp: " ", deg: "°",
};

/** Remove comments, and the insides of <script> and <style>; keep JSON-LD for the price check. */
function simplify(html) {
  const ld = [];
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, body) => {
    if (/application\/ld\+json/.test(attrs)) ld.push(body);
    return `<script${attrs}></script>`;
  });
  const styles = [];
  s = s.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, body) => {
    styles.push(body);
    return `<style${attrs}></style>`;
  });
  return { markup: s, ld, styles };
}

const TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function* tags(markup) {
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(markup))) yield { name: m[1].toLowerCase(), attrs: parseAttrs(m[2]), index: m.index };
}

function visibleText(markup) {
  const body = markup.replace(/^[\s\S]*?<body\b[^>]*>/i, "");
  return body.replace(/<[^>]*>/g, " ");
}

function decode(text, problems, label) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref) => {
    if (ref[0] === "#") {
      const code = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(code);
    }
    if (!(ref in ENTITIES)) {
      problems.push(`${label}: unknown entity ${all} (add it to ENTITIES in check.mjs)`);
      return "";
    }
    return ENTITIES[ref];
  });
}

function fontRanges(css) {
  const ranges = [];
  for (const m of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
    for (const part of m[1].split(",")) {
      const [a, b] = part.trim().replace(/^U\+/i, "").split("-");
      ranges.push([parseInt(a, 16), parseInt(b ?? a, 16)]);
    }
  }
  return ranges;
}

/** Structural problems in a stylesheet: unbalanced braces, an unterminated comment or string. */
export function cssProblems(css) {
  const found = [];
  const line = (index) => css.slice(0, index).split("\n").length;
  let depth = 0;
  let lastOpen = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return [...found, `unterminated comment starting on line ${line(i)}`];
      i = end + 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      if (css[j] !== ch) return [...found, `unterminated string starting on line ${line(i)}`];
      i = j;
    } else if (ch === "{") {
      if (depth === 0) lastOpen = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) return [...found, `unmatched "}" on line ${line(i)}`];
    }
  }
  if (depth > 0) found.push(`unclosed "{" (the block opened on line ${line(lastOpen)} never ends)`);
  return found;
}

/** Firefox draws a moving mask in software; flag a mask on anything animated (or inside @keyframes). */
export function maskProblems(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const root = { prelude: "", parent: null, animated: false, masks: [] };
  const frames = [];
  let frame = root;
  let buf = "";
  let paren = 0;
  let line = 1;
  let bufLine = 1;
  const declaration = () => {
    const m = /^\s*([-\w]+)\s*:\s*([\s\S]*?)\s*$/.exec(buf);
    if (m) {
      const [, prop, value] = m;
      if (/^(-webkit-)?mask(-image)?$/.test(prop) && !/^(none|initial|unset)$/.test(value)) frame.masks.push(bufLine);
      if (/^animation(-name)?$/.test(prop) && !/^none\b/.test(value)) frame.animated = true;
    }
    buf = "";
  };
  for (const ch of text) {
    if (ch === "\n") line++;
    if (ch === "(") paren++;
    if (ch === ")") paren--;
    if (ch === "{" && paren === 0) {
      frame = { prelude: buf.trim(), parent: frame, animated: false, masks: [] };
      frames.push(frame);
      buf = "";
    } else if (ch === "}" && paren === 0) {
      declaration();
      frame = frame.parent ?? root;
    } else if (ch === ";" && paren === 0) {
      declaration();
    } else {
      if (!buf.trim()) bufLine = line;
      buf += ch;
    }
  }
  const problems = [];
  for (const f of frames) {
    if (!f.masks.length) continue;
    let reason = "";
    for (let a = f; a && !reason; a = a.parent) {
      if (a.animated) reason = a === f ? "is animated" : `is inside an animated rule (${a.prelude})`;
      else if (/^@(-webkit-)?keyframes\b/.test(a.prelude)) reason = "is inside @keyframes";
    }
    if (reason) for (const l of f.masks) problems.push(`mask on line ${l} ${reason} (${f.prelude}); Firefox draws a moving mask in software`);
  }
  return problems;
}

/** A classic inline script must run inside a function, so top-level names can't collide between scripts. */
export function scriptProblems(code) {
  const body = code.replace(/^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, "").replace(/\s+$/, "");
  const opens = /^;?\(\s*(?:async\s*)?(?:\(\s*\)\s*=>|function\b)|^!\s*function\b|^;?\(\s*(?:async\s*)?\(\s*\)\s*=>/.test(body);
  const closes = /\)\s*\(\s*\)\s*;?$|\}\s*\(\s*\)\s*\)\s*;?$/.test(body);
  return opens && closes ? [] : ["script isn't wrapped in a function that runs itself, e.g. (() => { ... })();"];
}

/** Any absolute http(s) address in code must be on the allowed-hosts list (no third-party services). */
export function hostProblems(text, allowed) {
  const problems = [];
  for (const m of text.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (!allowed.includes(host)) problems.push(`refers to ${host}, which isn't in shared/facts.json "allowedHosts"`);
  }
  return [...new Set(problems)];
}

const ID_REFERENCES = ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"];

/** Resolve a custom property from tokens.css, following var() references, to a #rrggbb value. */
function tokenColor(tokens, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens);
  if (!m) return null;
  const v = m[1].trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return tokenColor(tokens, ref[1], seen);
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastProblems(tokens, pairs) {
  const problems = [];
  for (const { fg, bg, min = 4.5 } of pairs) {
    const a = tokenColor(tokens, fg);
    const b = tokenColor(tokens, bg);
    if (!a || !b) {
      problems.push(`contrast pair ${fg} on ${bg}: can't resolve ${!a ? fg : bg} to a #rrggbb color in css/tokens.css`);
      continue;
    }
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < min) problems.push(`contrast ${fg} (${a}) on ${bg} (${b}) is ${ratio.toFixed(2)}:1, below ${min}:1`);
  }
  return problems;
}

export function check({ root, shared, showFacts = false }) {
  const problems = [];
  const fail = (label, msg) => problems.push(`${label}: ${msg}`);

  let result;
  try {
    result = sync({ root, shared, write: false });
  } catch (e) {
    return [`sync: ${e.message}`];
  }
  for (const f of result.changed) fail(relative(root, f), "out of date; run `node sync.mjs`");
  const { facts, pages } = result;

  const exists = (p) => existsSync(join(root, p));
  const pageByPath = new Map(pages.map((p) => [p.path, p]));
  const idsByPath = new Map();
  const parsed = new Map();

  for (const page of pages) {
    const html = readFileSync(page.file, "utf8");
    const s = simplify(html);
    parsed.set(page.path, s);
    const ids = new Set();
    for (const t of tags(s.markup)) if (t.attrs.id !== undefined) ids.add(t.attrs.id);
    idsByPath.set(page.path, ids);
  }

  /** Check one URL found on a page. Returns nothing; records problems. */
  const checkUrl = (label, raw, fromPath, what) => {
    let url = raw.trim();
    if (!url || /^(mailto:|tel:|data:|javascript:)/i.test(url)) return;
    if (url.startsWith(facts.site.url)) url = url.slice(facts.site.url.length) || "/";
    else if (/^(https?:)?\/\//i.test(url)) return;
    if (url.startsWith("#")) {
      const id = decodeURIComponent(url.slice(1));
      if (id && id !== "top" && !idsByPath.get(fromPath)?.has(id)) fail(label, `${what} points at #${id}, which doesn't exist on this page`);
      return;
    }
    if (!url.startsWith("/")) return fail(label, `${what} "${raw}" is not root-relative (start it with "/")`);
    const [pathAndQuery, frag] = url.split("#");
    const path = pathAndQuery.split("?")[0];
    const dirIndex = join(path, "index.html");
    if (path.endsWith("/")) {
      if (!exists(dirIndex)) return fail(label, `${what} "${raw}" doesn't match a page`);
    } else if (exists(path) && !exists(dirIndex)) {
      // a plain file (css, image, ...)
    } else if (exists(dirIndex)) {
      return fail(label, `${what} "${raw}" should end in "/" (it is a page)`);
    } else return fail(label, `${what} "${raw}" doesn't exist`);
    if (frag) {
      const target = pageByPath.get(path);
      if (target && !idsByPath.get(target.path)?.has(decodeURIComponent(frag))) fail(label, `${what} "${raw}": no id "${frag}" on that page`);
    }
  };

  const fontCss = existsSync(join(root, "css/fonts.css")) ? readFileSync(join(root, "css/fonts.css"), "utf8") : "";
  const ranges = fontRanges(fontCss);
  const covered = (cp) => (cp >= 0x20 && cp <= 0x7e) || ranges.some(([a, b]) => cp >= a && cp <= b);

  const amountSeen = new Map(); // amount -> Map(page -> count)
  const allowed = new Set(facts.amounts);
  const note = (amount, pagePath) => {
    if (!amountSeen.has(amount)) amountSeen.set(amount, new Map());
    const m = amountSeen.get(amount);
    m.set(pagePath, (m.get(pagePath) ?? 0) + 1);
  };

  for (const page of pages) {
    const label = relative(root, page.file);
    const html = readFileSync(page.file, "utf8");
    const { markup, ld, styles } = parsed.get(page.path);

    if (!/<html[^>]*\slang="en"/i.test(markup)) fail(label, `<html> needs lang="en"`);
    if (!page.description) fail(label, "missing description");

    let h1 = 0, mains = 0, prevLevel = 0;
    const seenIds = new Set();
    for (const t of tags(markup)) {
      const a = t.attrs;
      if (t.name === "main") {
        mains++;
        if (a.id !== "main") fail(label, `<main> needs id="main" (the skip link points at it)`);
      }
      const h = t.name.match(/^h([1-6])$/);
      if (h) {
        const level = Number(h[1]);
        if (level === 1) h1++;
        if (level > prevLevel + 1) fail(label, `heading <h${level}> follows ${prevLevel ? `<h${prevLevel}>` : "nothing"} (don't skip levels)`);
        prevLevel = level;
      }
      if (a.id !== undefined) {
        if (seenIds.has(a.id)) fail(label, `duplicate id "${a.id}"`);
        seenIds.add(a.id);
      }
      for (const attr of ID_REFERENCES) {
        for (const id of (a[attr] ?? "").split(/\s+/).filter(Boolean)) {
          if (!idsByPath.get(page.path).has(id)) fail(label, `<${t.name} ${attr}="${id}"> points at an id that doesn't exist on this page`);
        }
      }
      if (t.name === "img" && a.alt === undefined) fail(label, `<img src="${a.src}"> has no alt attribute`);
      if (t.name === "a" && a.href !== undefined) checkUrl(label, a.href, page.path, "link");
      if (t.name === "form" && a.action) checkUrl(label, a.action, page.path, "form action");
      if (t.name === "link" && a.href) checkUrl(label, a.href, page.path, `<link ${a.rel}>`);
      if ((t.name === "script" || t.name === "img" || t.name === "source" || t.name === "video" || t.name === "audio") && a.src) checkUrl(label, a.src, page.path, `<${t.name}> src`);
      if (a.srcset) for (const part of a.srcset.split(",")) checkUrl(label, part.trim().split(/\s+/)[0], page.path, "srcset");
      if (t.name === "meta" && /^(og:image|og:url|twitter:image)$/.test(a.property ?? a.name ?? "") && a.content) checkUrl(label, a.content, page.path, `<meta ${a.property ?? a.name}>`);
    }
    if (h1 !== 1) fail(label, `needs exactly one <h1> (found ${h1})`);
    if (mains !== 1) fail(label, `needs exactly one <main> (found ${mains})`);

    // Prices and emails
    const textForFacts = [markup.replace(/<style[\s\S]*?<\/style>/gi, ""), ...ld].join("\n");
    for (const m of textForFacts.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) {
      note(m[0], page.path);
      if (!allowed.has(m[0])) fail(label, `price ${m[0]} is not in shared/facts.json "amounts"`);
    }
    for (const m of ld.join("\n").matchAll(/"price":\s*"?(\d[\d.]*)"?/g)) {
      const asDollars = `$${m[1]}`;
      note(asDollars, page.path);
      if (!allowed.has(asDollars) && !allowed.has(`$${Number(m[1]).toFixed(2)}`)) fail(label, `structured-data price ${m[1]} is not in shared/facts.json "amounts"`);
    }
    for (const m of textForFacts.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
      const address = m[0].replace(/\.+$/, "");
      if (address !== facts.me.email) fail(label, `email ${address} is not the one in shared/facts.json (${facts.me.email})`);
    }

    for (const body of styles) for (const problem of [...cssProblems(body), ...maskProblems(body)]) fail(label, `inline <style>: ${problem}`);

    // Characters must be in the font files we ship
    const text = decode(visibleText(markup), problems, label) + styles.join("");
    const bad = new Set();
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0xa0 || cp === 0xad) continue;
      if (!covered(cp) && !(facts.allowedChars ?? []).includes(ch)) bad.add(`${ch} (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`);
    }
    if (bad.size) fail(label, `characters outside the shipped fonts: ${[...bad].join(", ")}`);
  }

  // CSS files: url() and @import must resolve
  const cssDir = join(root, "css");
  if (existsSync(cssDir)) {
    for (const name of readdirSync(cssDir).filter((n) => n.endsWith(".css"))) {
      const label = `css/${name}`;
      const raw = readFileSync(join(cssDir, name), "utf8");
      for (const problem of [...cssProblems(raw), ...maskProblems(raw)]) fail(label, problem);
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/g)) {
        const u = m[1] ?? m[2];
        if (u.startsWith("data:") || u.startsWith("#")) continue;
        checkUrl(label, u, "/", "css url");
      }
    }
  }

  // Color contrast for the pairs listed in facts.json
  if (facts.contrast && exists("css/tokens.css")) {
    for (const problem of contrastProblems(readFileSync(join(root, "css/tokens.css"), "utf8"), facts.contrast)) fail("css/tokens.css", problem);
  }

  // Scripts: files load as modules, classic inline scripts are wrapped, and nothing loads from a third-party host
  const allowedHosts = facts.allowedHosts ?? [];
  const scriptLabel = (label, problems) => problems.forEach((m) => fail(label, m));
  const jsDir = join(root, "js");
  if (existsSync(jsDir)) {
    for (const name of readdirSync(jsDir).filter((n) => n.endsWith(".js"))) {
      const code = readFileSync(join(jsDir, name), "utf8");
      scriptLabel(`js/${name}`, hostProblems(code, allowedHosts));
    }
  }
  for (const page of pages) {
    const label = relative(root, page.file);
    const html = readFileSync(page.file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = parseAttrs(m[1]);
      if (attrs.src !== undefined) {
        if (attrs.type?.trim().toLowerCase() !== "module") fail(label, `<script src="${attrs.src}"> isn't type="module", so its top-level names are shared with every other script`);
      } else if ((!attrs.type || /javascript|module/i.test(attrs.type)) && m[2].trim()) {
        const wrap = attrs.type?.trim().toLowerCase() === "module" ? [] : scriptProblems(m[2]);
        scriptLabel(`${label}: inline <script>`, [...wrap, ...hostProblems(m[2], allowedHosts)]);
      }
    }
    for (const t of tags(simplify(html).markup)) {
      const url = t.name === "link" ? t.attrs.href : t.name === "form" ? t.attrs.action : t.name === "a" || t.name === "meta" ? undefined : t.attrs.src;
      if (url && /^(?:https?:)?\/\//i.test(url.trim())) for (const m of hostProblems(url, allowedHosts)) fail(label, `<${t.name}> ${m}`);
    }
  }

  // Size budget: gzipped HTML plus the CSS and JS it links
  const budgets = facts.sizeBudgetKB;
  if (budgets) {
    const gz = (buf) => gzipSync(buf, { level: 9 }).length;
    for (const page of pages) {
      const html = readFileSync(page.file);
      let total = gz(html);
      const refs = new Set([...html.toString("utf8").matchAll(/(?:href|src)="(\/(?:css|js)\/[^"?#]+)/g)].map((m) => m[1]));
      for (const ref of refs) if (exists(ref.slice(1))) total += gz(readFileSync(join(root, ref)));
      const limit = (budgets[page.path] ?? budgets.default) * 1024;
      if (total > limit) fail(relative(root, page.file), `${(total / 1024).toFixed(1)} KB gzipped (HTML + CSS + JS) is over its ${limit / 1024} KB budget in shared/facts.json "sizeBudgetKB"`);
    }
  }

  // robots.txt -> sitemap
  if (existsSync(join(root, "robots.txt"))) {
    for (const m of readFileSync(join(root, "robots.txt"), "utf8").matchAll(/^Sitemap:\s*(\S+)/gim)) checkUrl("robots.txt", m[1], "/", "Sitemap");
  }

  if (showFacts) {
    console.log("Where each price appears:");
    for (const [amount, byPage] of [...amountSeen].sort()) {
      console.log(`  ${amount.padEnd(8)} ${[...byPage].map(([p, n]) => `${p} x${n}`).join(", ")}`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const problems = check({
    root: resolve(here, opt("--root", "site")),
    shared: resolve(here, opt("--shared", "shared")),
    showFacts: args.includes("--facts"),
  });
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    console.error(`\ncheck: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log("check: all good");
}
