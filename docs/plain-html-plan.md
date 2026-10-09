# Plan: rebuild presswork.dev as plain HTML (branch `plain-html`)

Drafted 2026-10-07; carried out and deployed the same day. Skill: `docs/static-site-stack-skill.md`. `main` stays the live site and is untouched until the cutover step.

## Rule for the whole port

**Port, don't redesign.** CSS and JS move over as they are. The handoff lists hard-won Firefox performance findings (no `mask-image` on moving things, stepped animations, fixed keyframe values, px keyframes). A "cleanup" could undo those. Only the mechanics change: Astro components become inline HTML, scoped styles become plain CSS.

## Target layout

```
site/                    ← the assets folder Wrangler deploys, as is
  index.html  pricing/index.html  about/index.html  contact/index.html  404.html
  css/   fonts.css reset.css tokens.css global.css components.css
  js/    hero.js dust.js shooting-star.js header.js receipt.js contact.js (+ slider if used)
  fonts/ self-hosted .woff2 files
  img/   pre-optimized images
  favicon.*, apple-touch-icon.png, og-image.png, robots.txt
  sitemap-index.xml, sitemap-0.xml   (same names as now, so Google/Bing need nothing)
  _headers
shared/header.html footer.html head.html   ← single sources
worker/index.js          ← fetch handler (contact form only)
worker/validate.js       ← pure validation, tested
sync.mjs  check.mjs  test/*.test.mjs   ← dependency-free Node scripts
wrangler.jsonc
```

No `package.json` dependencies at all. Wrangler is run with `npx` (as the user already does for deploys).

## What replaces each Astro feature

| Astro feature | Plain replacement |
|---|---|
| Layouts, header, footer, head tags | `shared/*.html`, written into each page between marker comments by `sync.mjs` |
| `src/data/config.ts` (nav, prices, copy) | Written directly into the pages. `check.mjs` verifies prices and nav match everywhere |
| Scoped component `<style>` | `components.css`, with each component's rules under its own wrapper class. Native `@scope` if browser support checks out, else prefixed class names. Astro's leaking nested-CSS and global-keyframe problems go away, but flattening scoped CSS can change specificity, so every component is diffed |
| `@astrojs/sitemap` | `sync.mjs` regenerates both sitemap files from the page list |
| `@fontsource` packages | Copy the `.woff2` files in; `@font-face` with `unicode-range` |
| Image optimization | One-time conversion of the few images used (not a dependency), committed as files |
| Prefetch (viewport strategy) | Native Speculation Rules: a `<script type="speculationrules">` JSON block in `shared/head.html`, prefetch only (not prerender, which would run the dust and shooting-star animations in a hidden page). Chromium browsers only; Firefox and Safari ignore it harmlessly. No viewport trigger exists, so use `eagerness: "eager"` (only 4 small same-origin pages) |
| Content collection / Work page | Not ported. Work page is off. Case studies move to an archive folder for the Prairie Rose redo |
| `FontTester`, `EasterEgg` | Not ported (unused) |
| Astro Action + `astro:env` | `worker/index.js` + Worker secret `CONTACT_TO_EMAIL` (already set) |

## The contact form (the only real server code)

Behavior to preserve exactly:
- Works with no JS: plain form POST to `/contact/`.
- Same rules as the Zod schema (name, email, business, audit + required site URL, message ≤ 5000, one-line fields flattened).
- Spam trap: drop with fake success if under 2 s since render or no timestamp. The Worker serves `/contact/` by fetching the static page and writing `Date.now()` into the hidden `renderedAt` field, so it works without JS.
- Sends from `form@presswork.dev`, Reply-To the visitor, to `CONTACT_TO_EMAIL`.
- No-JS errors: Worker re-renders the page with the error summary, field errors and typed values refilled (HTMLRewriter). Success without JS: 303 redirect to `/contact/?sent=1` showing the thank-you (no resubmit prompt on refresh).
- With JS: same page script, but `fetch` POST with `Accept: application/json`; keeps the "Sending…" dots, stamp animation and focus handling.

`wrangler.jsonc`: `run_worker_first: ["/contact", "/contact/"]`. The `/_actions/*` rule and the robots.txt `Disallow: /_actions/` line go away. Locally `npx wrangler dev` serves everything and logs emails like now; the secret moves from `.env` to `.dev.vars`.

Validation is tested with the built-in `node --test` (no packages): good and bad input, line-break injection, the timing trap.

## Drift protection

- `sync.mjs`: header, footer, shared `<head>` tags, sitemaps.
- `check.mjs`: one `<h1>` per page, title/description/canonical/og tags, all internal links and asset paths resolve, sitemap matches pages, prices and nav identical everywhere, every character on the site is covered by the font subsets we ship (guards the "arrow pulls in the math subset" problem).
- Both run before every deploy.

## Steps

1. **Baseline.** Build `main` once into a gitignored `.reference/dist` to compare against.
2. **Skeleton.** `site/`, tokens/reset/global CSS verbatim, fonts, `wrangler.jsonc` pointing at `site/`.
3. **Shared parts and scripts.** `shared/*`, `sync.mjs`, `check.mjs`.
4. **Pages.** 404, about, pricing, then home (hero, before/after, receipt, closing CTA), then contact markup.
5. **Scripts.** Port each component script as a plain `.js` file, deferred, no behavior changes.
6. **Worker + tests.**
7. **Images.**
8. **Compare.** Text and structure diff of each page against `.reference/dist` (I can run this in the sandbox), then Lighthouse and a visual check on the preview by the user, including Firefox CPU for the home page since the perf findings live there.
9. **Preview.** `wrangler versions upload` from the user's terminal. Send one real contact message through the preview URL.
10. **Cutover (only on the user's say-so).** Merge to `main`, `wrangler deploy`. Rollback is `wrangler rollback` (previous version) or reverting the merge. Afterwards: remove Astro files and dependencies, rewrite the project notes and the build notes, delete the stale sandbox build-env memory.

## Limits and risks

- I can't reach localhost, the preview URL or Cloudflare from the sandbox, so the visual check, performance check and real-email test are the user's. I can verify structure, text, links, validation logic and CSS by diffing files.
- Deploy goes live. Nothing here deploys; only the user's `wrangler deploy` does.
- The sandbox build env vars in memory apply to `main`'s Astro build only. The new site needs no build.
- Pages use root-relative paths (`/css/...`), so they need `wrangler dev` or any local server, not `file://`. `check.mjs` verifies the paths.
- Work done on `plain-html` may be auto-committed by Git Docs; check that it's watching the right branch.
