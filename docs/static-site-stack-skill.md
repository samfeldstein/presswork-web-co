---
name: static-site-stack
description: Use when building or rebuilding a small website (marketing site, portfolio, landing pages, up to roughly 10-15 pages). Defaults to plain HTML, CSS and vanilla JS with no framework or bundler, self-hosted fonts, a tiny Cloudflare Worker only when a form or endpoint is needed, and dependency-free scripts that prevent drift between pages. Says when to escalate to Astro or similar.
---

# Static site stack

The user has Claude write all the code, so build tools that exist to save humans repetitive work are usually unnecessary. Default to the simplest thing that ships.

## Default stack

- Plain HTML, CSS, and a little vanilla JS. No bundler, no framework, no npm dependencies.
- Files must open directly in a browser and deploy by uploading the folder (Cloudflare Pages/Workers, Netlify, GitHub Pages).
- Shared elements (header, footer, nav) are duplicated across pages. Update all pages in one pass when they change, and use the drift scripts below so they can't fall out of sync.

## Progressive enhancement

- Start with semantic HTML that works with no CSS and no JS.
- Layer CSS on top, then JS only for behavior HTML and CSS can't provide.
- Prefer native features: `<dialog>`, `<details>`, `popover`, forms with built-in validation, `:has()`, container queries, CSS custom properties, grid, and view transitions.
- Guard newer features with `@supports` or feature detection, and make sure the fallback is still usable.
- Content and navigation must never depend on JS running.

## Scripts

- Load each script file as a module (`<script type="module" src="...">`). A module defers on its own and keeps its top-level names private. Classic scripts all share one global scope, and two that each declared the same top-level `const` once broke a slider with no visible error.
- An inline script that must run while the page is parsed (for example one that collapses a menu before first paint) stays classic, wrapped in a self-calling function, `(() => { ... })();`, for the same reason.
- Have a check fail on a script file loaded without `type="module"` and on an unwrapped classic inline script.
- Load nothing from third-party hosts: no CDN libraries, no analytics snippets, no font hosts. Keep a short allowed-hosts list and have a check fail on anything else.
- Keep comments out of shipped CSS and JS except the few that stop a regression (browser workarounds).

## Forms and other server needs

A static folder can't send email or handle a form POST. When a site needs that, add one small Cloudflare Worker script: a `fetch` handler that serves the static assets and handles the POST, with bindings such as `send_email` declared in `wrangler.jsonc`. It needs no build step and no dependencies. Keep the form working without JS (a plain `<form method="post">`). Needing a server endpoint is not a reason to bring a framework back.

## Fonts

Self-host fonts as `.woff2` files committed to the repo, loaded with `@font-face` and `font-display: swap`. Never load from Google Fonts or other third-party font hosts.

## Performance rules for animation

Learned by profiling in Firefox (the Firefox Profiler, Graphics preset, about 10 seconds, and the GPU helper in Activity Monitor rather than `top`). Profile early when something feels heavy.

- Never put `mask-image` or `mask` on anything that moves. Firefox on macOS draws a moving mask in software, on the CPU, every frame. A static mask (a ring cut out of a disc) is fine.
- Any smooth, nonstop animation makes Firefox redraw every frame. Prefer `steps()` animations on one shared beat, which redraw only on the beat.
- Keep keyframe values fixed: no `var()` inside keyframes, which pushed an animation onto the main thread.
- For animations driven from JS (Web Animations API), use plain `px` keyframes; `cqw` and `var()` ran on the main thread.
- Keep moving elements small, and check Firefox CPU after adding any continuous animation.
- Prefix keyframe names per component; they are global.

## Caching and content hashes

If CSS and JS links carry a content hash (`?v=...`, written by the sync script), the host can cache them as immutable for a year, and page changes stop revalidating every stylesheet and script. Run the sync script after any CSS or JS edit or the old hash is served. On Cloudflare Workers, the `_headers` file applies to static files only, not to responses the Worker's own code builds, and static HTML is sent `max-age=0, must-revalidate` by default, which is what you want for pages.

## Preventing drift

Anything that exists in more than one place can drift: header, footer, nav links, the sitemap, meta tags, canonical URLs, prices and other key facts. Keep one source for each fact and let a script either generate the copies or check them. Use the two dependency-free Node scripts bundled with this skill in `scripts/` (plain `node`, no install step). Copy `sync.mjs` and `check.mjs` into the site's root unchanged and keep them side by side. Setup steps and the optional `site.config.json` settings are in `references/drift-scripts.md`; read it the first time you set a site up.

1. **`sync.mjs`** writes the shared parts.
   - The header and footer live once, in `shared/header.html` and `shared/footer.html`.
   - Each page wraps its copy in marker comments, e.g. `<!-- shared:header -->…<!-- /shared:header -->`, and the script rewrites what's between them.
   - Pages stay plain, openable HTML, and the shared parts can't drift because they are regenerated.
   - The same script regenerates `sitemap.xml` from the list of page files.
2. **`check.mjs`** catches everything else. It fails if:
   - a page is missing a `<title>`, meta description, canonical URL, `lang`, or has other than exactly one `<h1>`;
   - an internal link, `src` or `href` points at a file that doesn't exist;
   - a page is missing from the sitemap, or a sitemap URL isn't a real page;
   - a price or other key fact differs between places (the script lists every occurrence of each so a mismatch is obvious).

Run both before every deploy. This is two short scripts, not a build system. Don't grow them into one: if a check is missing, add one rule to the right script.

Once a site has settled, rules like these are worth adding to `check.mjs`, with their settings in the site's facts or config file:

- a gzipped size budget per page (HTML plus linked CSS and JS), set about a third above the measured size;
- WCAG AA contrast (4.5:1) for a list of text and background color pairs, read from the design tokens;
- no `mask` on animated rules or inside `@keyframes`;
- every script file loaded as a module and every classic inline script wrapped in a self-calling function, and no hosts outside the allowed list;
- every character on a page covered by the shipped font subsets, balanced CSS braces, and `for`/`aria-*` references that point at ids that exist.

Prove each rule works by breaking something on purpose in a test (a copy of the site with a bad script, host, color or mask) and watching it fail.

## Auditing a change

Keep a short checklist in the repo and run it after any major change (shared parts, CSS, JS, the Worker, config, a new page) before committing. Three parts:

1. **Automatic:** the sync and check scripts and the tests.
2. **Judgment, reporting only problems:** accessibility semantics (names, roles, focus order, decorative things hidden), SEO impact, Worker security (validation, escaping, size limits, no internals in errors, no header injection), the performance rules above, and hard-coded things that may now be stale (Lighthouse scores shown on the site, prices, nav, docs).
3. **Only the owner can run:** Lighthouse (mobile, incognito, every page), Firefox GPU helper on the home page, a real phone, a screen reader (VoiceOver in Safari) when markup changed, the contact form once for real, and the W3C validator and WAVE after larger markup changes. Give these one at a time.

**Hosting dashboard settings are changes too.** A setting turned on in the dashboard can change what the site sends without touching the repo. On Cloudflare, Bot Fight Mode on the Free plan injects a bot-detection script into every page, and its deprecated-API warnings dropped Lighthouse Best Practices from 100 to 81; turning it off fixed it after some minutes. After changing anything under Security, Speed or Rules, run Lighthouse on the live site and search the page source for scripts you didn't add. Security response headers, HSTS on a `.dev` domain, and Rocket Loader were judged not worth it for a small static site with no logins, stored data or uploads.

## Read-only data sites

When the site is a read-only view of a dataset (a spending map, a searchable table), the same plain approach still applies.

- Settle layout and visual hierarchy against mock data while the data pipeline is still running.
- For an open-ended design, build several quick variants and choose by looking at them.
- Ship precomputed JSON and filter client-side. When the data gets too big to load, pre-aggregate it, tile it, or add a backend.
- Show trust details: per-source provenance (raw file link, checksum, pull date), a methodology page, and visible labels for any caps or exclusions.

## When to escalate to Astro (or similar)

Switch only when duplication or content volume starts to hurt:

- Roughly more than 10-15 pages
- Content-heavy sites (blog with dozens of posts, docs) that benefit from Markdown collections
- Many shared components that are painful to keep in sync, even with the drift scripts
- Needs automatic image optimization, sitemaps, or RSS at a scale hand-work can't keep up with

Astro still outputs mostly static HTML, so migrating later is cheap. Don't migrate preemptively.

## Workflow

1. Confirm the page count and content type. If small, go plain.
2. Build semantic HTML first, then CSS (start the stylesheet from the `reset-css` skill's reset, loaded first), then JS.
3. Before adding any dependency or build step, state why native HTML/CSS/JS can't do the job.
4. Check modern-web-guidance for current best practices on HTML/CSS/JS APIs when available.
5. Check accessibility basics: landmarks, heading order, alt text, focus states, color contrast, reduced-motion support.
6. Run `node sync.mjs` then `node check.mjs` (and the tests) before deploying, and the change audit for anything major. If the site doesn't have the scripts yet, copy them from this skill's `scripts/` folder.
7. For a live site, work on a git branch and deploy a preview version rather than going live (for Cloudflare Workers: `wrangler versions upload`, not `wrangler deploy`).

## Avoid

- Adding a framework or bundler by habit
- JS-only rendering for static content
- Heavy dependencies for things the platform does natively
- Hand-copying shared markup or key facts between pages without a check
- Unwrapped scripts, third-party hosts, or a mask on anything that moves
