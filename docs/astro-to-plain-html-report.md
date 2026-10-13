# From Astro to plain HTML: report

Written 2026-10-12. Covers the rebuild of presswork.dev on 2026-10-07 and what followed. Sources: the git history, the plan (`plain-html-plan.md`), the stack skill (`static-site-stack-skill.md`), and the Claude Code sessions.

## Summary

presswork.dev was an Astro site: components, scoped styles, and an Astro Action for the contact form. On 2026-10-07 it was rebuilt as plain HTML, CSS, and JavaScript served by a Cloudflare Worker with static assets, with no framework, bundler, or build step. The plan was written, carried out, checked, and deployed the same day, under one rule: **port, don't redesign.** Computed styles matched the old site on every element, and the live Lighthouse scores did not drop; in fact, Performance moved from 97 to between 98 and 100. Each page also ships 40 to 60 percent less code.

## Why

As the workflow became much more AI-centric, it became clear that much of what Astro was doing on this project (components, scoped styles, image tooling) existed to make life easier for a human coder. With an AI agent doing most of the legwork, that convenience turned into overhead. The site is four live pages plus a 404. Most of its interactivity (typing headline, dust, shooting star, slider) was already plain JavaScript. And with no blog, products, or content collections to manage, Astro was basically overkill.

The payoff is a lighter site that is simpler to maintain and ships less code.

## How it was done

1. **Stack skill first.** Before any code was written, a `static-site-stack` skill set out how the site would be built, so the agent followed one approach from start to finish (see `static-site-stack-skill.md`).
2. **Branch and preview.** The work happened on a `plain-html` branch while `main` stayed live. `wrangler versions upload` gives a preview URL without going live.
3. **Baseline.** The old site was built once into a gitignored folder to compare against.
4. **Plan.** Ten steps: baseline, skeleton, shared parts and Node scripts, pages, page scripts, Worker and tests, images, compare, preview, cutover.
5. **Cutover.** Squash-merged into `main`, deployed with `npx wrangler deploy`, then Astro files and dependencies removed. If anything had gone wrong, `wrangler rollback` would have restored the old version.

## What replaced what

| Astro | Plain version |
|---|---|
| Layout, header, footer, head tags | `shared/*.html`, written into each page between marker comments by `sync.mjs` |
| `config.ts` prices, nav, and copy | `shared/facts.json`, with `check.mjs` verifying every price and nav item matches on every page |
| Scoped component CSS | Plain CSS, each component under its own root class; keyframe names prefixed per component |
| `@astrojs/sitemap` | `sync.mjs` regenerates the sitemaps |
| `@fontsource` packages | Self-hosted `.woff2` files with `unicode-range`; only Latin and Latin-ext are shipped, and `check.mjs` fails on any character outside them |
| Image optimization | One-time conversion, committed as files |
| Automatic asset hashing | `sync.mjs` adds a content hash (`?v=`) to every CSS and JS link, and `_headers` caches those files as immutable; added on 2026-10-08, after the first plain version served them under fixed names that revalidated on every visit |
| `prefetchAll` | Speculation Rules in the head (Chromium); a small `rel="prefetch"` fallback for Firefox and Safari was added on 2026-10-08 |
| Astro Action and `astro:env` | `worker/index.js` and a Worker secret |
| Zod validation | `worker/validate.js`, covered with the contact form and Worker by 28 tests in the built-in `node --test` |

Drift protection is two dependency-free Node scripts run before every deploy: `sync.mjs` writes the shared parts and sitemaps; `check.mjs` checks titles, headings, links, assets, sitemap, prices, nav, font coverage, page size, color contrast, masks on animated rules, scripts loaded as modules, and third-party hosts. Nine planted bugs were all caught when it was written, and it now has 13 tests of its own.

## Verification, and what it found

- **CSS rule comparison.** All 293 rules in the Astro CSS were checked against the new CSS; the 237 rules that could be checked this way (the rest only apply in states like hover or focus) matched the same number of elements on every page. It found one real bug: the contact button's "Sending" styles were nested under `.contact` twice and never matched. Fixed.
- **Computed styles in a browser.** Every element on home, pricing, about, and 404 (301, 161, 127, and 119 elements) was compared at 1280px and 390px. Layout rectangles were identical; the only differences were renamed keyframes, equivalent gradient syntax, and `0px` against `0%`.
- **Interactions.** Phone menu, typing headline, receipt printing, and the skip link behaved the same. This pass found the second real bug: three classic scripts each declared a top-level `const reduceMotion`, so on the home page two of them threw and never ran. The before/after slider and the shooting star were dead. The first fix wrapped each script in its own function; on 2026-10-12 the scripts became ES modules, which keep each file's names private as part of the language.
- **Contact page.** No old page to compare against (the old build rendered it on request), so it was ported from the source and tested on the preview.
- **Preview.** Lighthouse mobile: home page 99 Performance and 100 elsewhere; the SEO score dipped only because a preview URL can't be indexed, and was back to 100 live. Firefox GPU-helper CPU on the home page was about the same as the live Astro site (roughly 10 to 17 percent on both). A real contact message sent and arrived. A real phone check passed.

## Results

| | Astro (2026-10-06) | Plain HTML (2026-10-12) |
|---|---|---|
| Direct dependencies | 6 (Astro, Cloudflare adapter, sitemap, two font packages, Wrangler) | 1 (Wrangler, run with `npx`) |
| Lockfile | 5,745 lines | 1,500 lines (all Wrangler's) |
| Source lines | about 5,100 (4,532 `.astro`, 291 `.ts`, 296 `.css`) | about 4,000 in `site/` (1,816 HTML, 1,905 CSS, 312 JS), plus 1,286 in the scripts, Worker, and tests |
| Build step before deploy | `astro build` | none |
| Lighthouse mobile, Performance | 97 on all four pages | 98 at the lowest, up to 100 on one or two pages |
| Lighthouse mobile, other three | 100 | 100 |
| Page weight, gzipped HTML, CSS, and JS (fonts and images not counted) | home 29.6 KB, others 22.3 to 23.2 KB | home 17.8 KB, others 9.4 to 10.3 KB |

Line counts aren't like for like: `.astro` files hold markup, styles, and scripts together, and plain pages repeat the shared header and footer. The old page weight was measured on 2026-10-12 by building the commit before the rewrite. Most of the difference is CSS: Astro sent about 17 KB to every page, one shared bundle that included `@font-face` rules for every language subset of the fonts, against 5 to 9 KB now.

## What was lost

- **Automatic CSS scoping and splitting.** Now the split is manual (`components.css` sitewide, `home.css` home only), and nothing warns about dead rules. A measurement on 2026-10-08 found about 1 KB of unused CSS per page. What was lost is convenience and a safety net, not bytes: Astro's automatic splitting still sent about 17 KB of CSS to every page, against 5 to 9 KB now.

## Post-launch debugging

After the plain HTML version went live, a brief white flash appeared when changing pages in Firefox. The audit found three plausible causes: no early dark background, revalidating stylesheets, and no prefetch in Firefox. Fixes (early background and `color-scheme`, hashed immutable CSS and JS, the prefetch fallback) made it rarer. The remaining flashes came from a browser extension: a clean profile, a private window, and Firefox Developer Edition showed none, and re-enabling the extensions one by one pointed to Readwise Reader. Lesson: if a problem shows up in an everyday browser but not in a private window or a clean profile, suspect an extension before changing the site.

## Lessons

- Port, don't redesign. The CSS and JS held hard-won fixes for animation performance in Firefox, and a "cleanup" could have undone them.
- Testing the rendered pages finds what reading code can't. Both real bugs surfaced only that way (one by comparing CSS rules against the pages, one by trying the interactions in a browser).
- Load scripts as modules. Classic scripts share a global scope, and a duplicated top-level name fails silently on one page.
- Keep one source for every fact that appears twice (nav, prices, sitemap), and have a script check or generate the copies.
- Strip explanatory comments from shipped CSS and JS: they were about a third of `components.css`.
- When to go back to Astro: more than 10 to 15 pages, content-heavy sections, many shared components, or automatic image handling (see `static-site-stack-skill.md`).
