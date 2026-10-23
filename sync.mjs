#!/usr/bin/env node
/*
  sync.mjs: keeps the parts every page shares identical, and writes the sitemaps.

  Pages stay plain, openable HTML. Each one has marker comments:

    <!-- page: {"title": "Pricing", "description": "..."} -->   (once, in <head>)
    <!-- shared:head --> ... <!-- /shared:head -->               (the whole <head> contents)
    <!-- shared:skip-link --> ... <!-- /shared:skip-link -->
    <!-- shared:sky --> ... <!-- /shared:sky -->        (gold dust and the shooting star)
    <!-- shared:header --> ... <!-- /shared:header -->
    <!-- shared:footer --> ... <!-- /shared:footer -->

  This script rewrites what is between the markers from shared/*.html and
  shared/facts.json. Edit the shared files (or the page comment), never the
  text between the markers. It turns straight quotes, apostrophes and "..."
  in page text into typographic ones, writes each page's text as Markdown to
  copy/<page>.md (home.md for the home page) for reading and diffing copy,
  and regenerates site/sitemap-0.xml and site/sitemap-index.xml from the
  pages that can be indexed.

  The "page" comment takes: title (without the site name; it is added),
  description (optional, defaults to the site description), noindex (optional).

  Usage:
    node sync.mjs            write changes
    node sync.mjs --dry      write nothing; exit 1 if anything is out of date
    --root <dir>             the site folder (default: site)
    --shared <dir>           the shared folder (default: shared)
    --copy <dir>             the copy extracts folder (default: copy)
*/
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BLOCKS = ["head", "skip-link", "sky", "header", "footer"];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const normalizePath = (p) => p.replace(/\/+$/, "") || "/";

/** Every .html file under root, as { file, path } (path is the page's URL path). */
export function listPages(root) {
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".html")) {
        const rel = relative(root, full).split(sep).join("/");
        const path = rel === "index.html" ? "/" : rel.endsWith("/index.html") ? "/" + rel.slice(0, -"index.html".length) : "/" + rel;
        pages.push({ file: full, path });
      }
    }
  };
  walk(root);
  return pages;
}

export function readPageMeta(html, label = "page") {
  const m = html.match(/<!--\s*page:\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) throw new Error(`${label}: missing the <!-- page: {...} --> comment`);
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`${label}: the page comment is not valid JSON (${e.message})`);
  }
  if (!meta.title) throw new Error(`${label}: the page comment needs a "title"`);
  return meta;
}

const lookup = (name, ctx) => {
  let v = ctx;
  for (const key of name.split(".")) v = v?.[key];
  if (v === undefined) throw new Error(`unknown placeholder {{${name}}}`);
  return v;
};

function renderTemplate(tpl, ctx, { path, noindex, nav }) {
  const out = [];
  for (let line of tpl.replace(/\n$/, "").split("\n")) {
    const flag = line.match(/^\?(noindex|indexed) /);
    if (flag) {
      if ((flag[1] === "noindex") !== Boolean(noindex)) continue;
      line = line.slice(flag[0].length);
    }
    const navLine = line.match(/^(\s*)\{\{nav(?::(\w+))?\}\}\s*$/);
    if (navLine) {
      const [, indent, cls] = navLine;
      for (const { href, label } of nav) {
        const current = normalizePath(href) === normalizePath(path) ? ' aria-current="page"' : "";
        out.push(`${indent}<li${cls ? ` class="${cls}"` : ""}><a class="nav-link" href="${href}"${current}>${esc(label)}</a></li>`);
      }
      continue;
    }
    out.push(line.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
      const v = lookup(name, ctx);
      return name === "year" ? v : esc(v);
    }));
  }
  return out.join("\n");
}

function replaceBlock(html, name, content) {
  const re = new RegExp(`(<!-- shared:${name} -->)[\\s\\S]*?(<!-- /shared:${name} -->)`);
  if (!re.test(html)) return null;
  return html.replace(re, (_, open, close) => `${open}\n${content}\n${close}`);
}

/**
 * Give every /css/*.css and /js/*.js reference a ?v= hash of the file's
 * contents, so site/_headers can cache them for good: a changed file gets a
 * new URL. Files that don't exist are left alone (check.mjs reports them).
 */
function stampAssets(html, root) {
  return html.replace(/\b(href|src)="(\/(?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g, (whole, attr, path) => {
    const file = join(root, path);
    if (!existsSync(file)) return whole;
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
    return `${attr}="${path}?v=${hash}"`;
  });
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®",
  trade: "™", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", times: "×", bull: "•", shy: "­",
  thinsp: " ", deg: "°",
};

/** Decode character references; onUnknown(ref) is called for a named entity not in the table. */
export function decodeEntities(text, onUnknown = () => {}) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref) => {
    if (ref[0] === "#") return String.fromCodePoint(ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
    if (!(ref in ENTITIES)) {
      onUnknown(all);
      return "";
    }
    return ENTITIES[ref];
  });
}

/** Straight quotes and three dots to typographic ones (also used by reports/build-report.mjs). */
export const smart = (t) =>
  t
    .replace(/(^|[\s(\[{—–-])'/g, "$1‘")
    .replace(/'/g, "’")
    .replace(/(^|[\s(\[{=—–-])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/\.\.\./g, "…");

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const NO_TYPOGRAPHY = new Set(["script", "style", "textarea", "pre", "code", "kbd", "samp", "svg", "template"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "button", "dd", "details", "dialog", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "label", "legend", "li", "main",
  "nav", "noscript", "ol", "option", "p", "section", "summary", "table", "td", "th", "tr", "ul",
]);

/** Split HTML into tokens: text, tags (with name and attributes), comments, and the raw insides of script/style/textarea/title. */
export function tokenize(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[0];
    if (!m[2]) {
      tokens.push({ type: raw[0] === "<" && raw.length > 1 ? "other" : "text", raw });
      continue;
    }
    const name = m[2].toLowerCase();
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    tokens.push({ type: m[1] ? "close" : "open", raw, name, attrs, empty: VOID.has(name) || /\/>$/.test(raw) });
    if (!m[1] && RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      const stop = end === -1 ? html.length : end;
      if (stop > re.lastIndex) tokens.push({ type: name === "title" ? "text" : "raw", raw: html.slice(re.lastIndex, stop) });
      re.lastIndex = stop;
    }
  }
  return tokens;
}

/** Walk the text a reader sees, outside tags, comments, attributes and code. Calls visit(token, previousChar). */
function eachText(tokens, visit) {
  let skip = 0;
  let prev = " ";
  for (const t of tokens) {
    if (t.type === "open" || t.type === "close") {
      if (NO_TYPOGRAPHY.has(t.name) && !t.empty) skip = Math.max(0, skip + (t.type === "open" ? 1 : -1));
      if (BLOCK.has(t.name)) prev = " ";
    } else if (t.type === "text" && !skip) {
      visit(t, prev);
      if (t.raw.length) prev = /\s$/.test(t.raw) ? " " : t.raw.at(-1);
    }
  }
}

/** Typographic quotes, apostrophes and ellipses in the text of an HTML document. */
export function typography(html) {
  const tokens = tokenize(html);
  eachText(tokens, (t, prev) => {
    t.raw = smart(prev + t.raw.replace(/\.\.\./g, "…")).slice(1);
  });
  return tokens.map((t) => t.raw).join("");
}

/** Straight quotes or three dots left in the text of an HTML document, as short snippets. */
export function straightQuotes(html) {
  const found = [];
  eachText(tokenize(html), (t) => {
    const text = decodeEntities(t.raw);
    for (const m of text.matchAll(/['"]|\.\.\./g)) found.push(text.slice(Math.max(0, m.index - 15), m.index + 15).replace(/\s+/g, " ").trim());
  });
  return found;
}

const classes = (attrs) => (attrs.class ?? "").split(/\s+/);

/**
 * The text of a page as Markdown: headings as # lines, list items as "- " lines,
 * every other block as a paragraph; links, markup, and text hidden from view dropped.
 */
export function copyExtract(html) {
  const tokens = tokenize(html);
  const bodyAt = tokens.findIndex((t) => t.type === "open" && t.name === "body");
  const lines = [];
  const stack = [];
  let skip = 0;
  let buf = "";
  let boundary = false;
  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    if (!text) return;
    const block = [...stack].reverse().find((s) => s.block);
    const h = block?.name.match(/^h([1-6])$/);
    lines.push(h ? `${"#".repeat(Number(h[1]))} ${text}` : block?.name === "li" ? `- ${text}` : text);
  };
  for (const t of tokens.slice(bodyAt + 1)) {
    if (t.type === "open") {
      if (t.empty) {
        if (BLOCK.has(t.name) && !skip) flush();
        continue;
      }
      const hides = skip || NO_TYPOGRAPHY.has(t.name) || t.attrs.inert !== undefined || classes(t.attrs).includes("visually-hidden");
      const block = BLOCK.has(t.name) || classes(t.attrs).includes("button");
      stack.push({ name: t.name, block, hides: Boolean(hides) });
      if (hides) skip++;
      else if (block) flush();
      else boundary = true;
    } else if (t.type === "close") {
      const at = stack.findLastIndex((s) => s.name === t.name);
      if (at === -1) continue;
      while (stack.length > at) {
        const s = stack.at(-1);
        if (s.hides) skip--;
        else if (s.block && !skip) flush();
        else boundary = true;
        stack.pop();
      }
    } else if (t.type === "text" && !skip) {
      const text = decodeEntities(t.raw);
      if (boundary && /[\p{L}\p{N}$]$/u.test(buf) && /^[\p{L}\p{N}$]/u.test(text)) buf += " ";
      boundary = false;
      buf += text;
    }
  }
  flush();
  let out = "";
  lines.forEach((line, i) => {
    out += i === 0 ? "" : line.startsWith("- ") && lines[i - 1].startsWith("- ") ? "\n" : "\n\n";
    out += line;
  });
  return out + "\n";
}

/** The copy/ file name for a page path: "/" is home, "/pricing/" is pricing, "/404.html" is 404. */
export const copyName = (path) => `${path.replace(/^\/|\/$/g, "").replace(/\.html$/, "").replace(/\//g, "-") || "home"}.md`;

/** Build the new text for every page, its copy extract, and the sitemaps. Returns { changed, pages }. */
export function sync({ root, shared, copy = join(root, "..", "copy"), write = true }) {
  const facts = JSON.parse(readFileSync(join(shared, "facts.json"), "utf8"));
  const templates = Object.fromEntries(BLOCKS.map((b) => [b, readFileSync(join(shared, `${b}.html`), "utf8")]));
  const changed = [];
  const pages = [];
  const extracts = new Set();

  const save = (file, text) => {
    const old = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (old === text) return;
    changed.push(file);
    if (write) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  };

  for (const { file, path } of listPages(root)) {
    const label = relative(root, file);
    let html = readFileSync(file, "utf8");
    const meta = readPageMeta(html, label);
    const title = meta.title === facts.site.title ? meta.title : `${meta.title} | ${facts.site.title}`;
    const ctx = {
      ...facts,
      fullTitle: title,
      description: meta.description ?? facts.site.description,
      url: new URL(path, facts.site.url).href,
      year: String(new Date().getFullYear()),
    };
    for (const b of BLOCKS) {
      const next = replaceBlock(html, b, renderTemplate(templates[b], ctx, { path, noindex: meta.noindex, nav: facts.nav }));
      if (next === null) throw new Error(`${label}: missing the <!-- shared:${b} --> ... <!-- /shared:${b} --> markers`);
      html = next;
    }
    html = typography(stampAssets(html, root));
    save(file, html);
    const extract = join(copy, copyName(path));
    extracts.add(extract);
    save(extract, copyExtract(html));
    pages.push({ file, path, meta, url: ctx.url, description: ctx.description, title });
  }

  for (const name of existsSync(copy) ? readdirSync(copy) : []) {
    const file = join(copy, name);
    if (!name.endsWith(".md") || extracts.has(file)) continue;
    changed.push(file);
    if (write) unlinkSync(file);
  }

  const urls = pages.filter((p) => !p.meta.noindex).map((p) => p.url).sort();
  const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>${body}\n`;
  save(
    join(root, "sitemap-0.xml"),
    xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join("")}</urlset>`),
  );
  save(
    join(root, "sitemap-index.xml"),
    xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${esc(facts.site.url)}/sitemap-0.xml</loc></sitemap></sitemapindex>`),
  );

  return { changed, pages, facts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const dry = args.includes("--dry");
  const root = resolve(here, opt("--root", "site"));
  const shared = resolve(here, opt("--shared", "shared"));
  const copy = resolve(here, opt("--copy", "copy"));
  try {
    const { changed } = sync({ root, shared, copy, write: !dry });
    for (const f of changed) console.log(`${dry ? "out of date" : "updated"}: ${relative(here, f)}`);
    if (!changed.length) console.log("sync: everything is up to date");
    if (dry && changed.length) process.exit(1);
  } catch (e) {
    console.error(`sync: ${e.message}`);
    process.exit(1);
  }
}
