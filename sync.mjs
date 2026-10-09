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
  text between the markers. Then it regenerates site/sitemap-0.xml and
  site/sitemap-index.xml from the pages that can be indexed.

  The "page" comment takes: title (without the site name; it is added),
  description (optional, defaults to the site description), noindex (optional).

  Usage:
    node sync.mjs            write changes
    node sync.mjs --dry      write nothing; exit 1 if anything is out of date
    --root <dir>             the site folder (default: site)
    --shared <dir>           the shared folder (default: shared)
*/
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
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

/** Build the new text for every page and the sitemaps. Returns { changed, pages }. */
export function sync({ root, shared, write = true }) {
  const facts = JSON.parse(readFileSync(join(shared, "facts.json"), "utf8"));
  const templates = Object.fromEntries(BLOCKS.map((b) => [b, readFileSync(join(shared, `${b}.html`), "utf8")]));
  const changed = [];
  const pages = [];

  const save = (file, text) => {
    const old = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (old === text) return;
    changed.push(file);
    if (write) writeFileSync(file, text);
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
    html = stampAssets(html, root);
    save(file, html);
    pages.push({ file, path, meta, url: ctx.url, description: ctx.description, title });
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
  try {
    const { changed } = sync({ root, shared, write: !dry });
    for (const f of changed) console.log(`${dry ? "out of date" : "updated"}: ${relative(here, f)}`);
    if (!changed.length) console.log("sync: everything is up to date");
    if (dry && changed.length) process.exit(1);
  } catch (e) {
    console.error(`sync: ${e.message}`);
    process.exit(1);
  }
}
