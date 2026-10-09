# From Astro to plain HTML: report

Written 2026-10-09. Covers the rebuild of presswork.dev on 2026-10-07 and what followed. Sources: the git history, the plan (`plain-html-plan.md`), the stack skill (`static-site-stack-skill.md`) and the working sessions.

## Summary

presswork.dev was an Astro site: components, scoped styles, a content collection, an Astro Action for the contact form. On 2026-10-07 it was rebuilt as plain HTML, CSS and JavaScript served by a Cloudflare Worker with static assets, with no framework, bundler or build step. The plan was written, carried out, checked and deployed the same day, under one rule: **port, don't redesign.** Computed styles matched the old site on every element, and the live Lighthouse scores did not drop (Performance moved from 97 to 98 or 99).

## Why

The idea came from a realization: since an AI assistant writes all the code, most of what Astro offers (components, scoped styles, content collections, image tooling) saves a human from repetition, and repetition costs the assistant nothing. The site is four live pages plus a 404, with the Work page switched off. Most of its interactivity (typing headline, dust, shooting star, slider) was already plain JavaScript.

Astro had also cost real time: a nested-CSS scoping leak, global keyframe names, a stale dev server, and build environment variables that had to be set for every build in the assistant's sandbox. Removing it also removed Astro, the Cloudflare adapter, the sitemap and font packages and the `allowScripts` list.

The payoff is a site that is simpler to maintain, not a faster or better one for visitors. That is why it waited until the launch-critical items were done.

## How it was done

1. **Stack skill first.** A `static-site-stack` skill was written and then extended with three things the first version missed: a static folder can't send email, so a form needs a tiny Worker (not a reason to bring a framework back); fonts are self-hosted as `.woff2`; and drift between pages needs scripts, not discipline.
2. **Branch and preview.** The work happened on a `plain-html` branch while `main` stayed live. `wrangler versions upload` gives a preview URL without going live.
3. **Baseline.** The old site was built once into a gitignored folder to compare against.
4. **Plan.** Ten steps: baseline, skeleton, shared parts and scripts, pages, scripts, Worker and tests, images, compare, preview, cutover.
5. **Cutover.** Squash-merged into `main`, deployed with `npx wrangler deploy`, then Astro files and dependencies removed. Rollback was `wrangler rollback`.

## What replaced what

| Astro | Plain version |
|---|---|
| Layout, header, footer, head tags | `shared/*.html`, written into each page between marker comments by `sync.mjs` |
| `config.ts` prices, nav and copy | `shared/facts.json`, with `check.mjs` verifying every price and nav item matches on every page |
| Scoped component CSS | Plain CSS, each component under its own root class; keyframe names prefixed per component |
| `@astrojs/sitemap` | `sync.mjs` regenerates the sitemaps |
| `@fontsource` packages | Self-hosted `.woff2` files with `unicode-range`; only Latin and Latin-ext are shipped, and `check.mjs` fails on any character outside them |
| Image optimization | One-time conversion, committed as files |
| `prefetchAll` | Speculation Rules in the head (Chromium); a small `rel="prefetch"` fallback was added on 2026-10-08 |
| Astro Action and `astro:env` | `worker/index.js` and a Worker secret |
| Zod validation | Hand-written `worker/validate.js`, 24 tests with the built-in `node --test` |

Drift protection is two dependency-free Node scripts run before every deploy: `sync.mjs` writes the shared parts and sitemaps; `check.mjs` checks titles, headings, links, assets, sitemap, prices, nav and font coverage. Nine planted bugs were all caught when it was written.

## Verification, and what it found

- **CSS rule comparison.** All 293 rules in the Astro CSS were compared with the new CSS; the 237 rules that could be compared matched the same number of elements on every page. It found one real bug: the contact button's "Sending" styles were nested under `.contact` twice and never matched. Fixed.
- **Computed styles in a browser.** Every element on home, pricing, about and 404 (301, 161, 127 and 119 elements) was compared at 1280px and 390px. Layout rectangles were identical; the only differences were renamed keyframes, equivalent gradient syntax and `0px` against `0%`.
- **Interactions.** Phone menu, typing headline, receipt printing and the skip link behaved the same. This pass found the second real bug: three classic scripts each declared a top-level `const reduceMotion`, so on the home page two of them threw and never ran. The before/after slider and the shooting star were dead. Fix: each script is wrapped in its own function, and that is now a standing rule.
- **Contact page.** No old page to compare against (the old build rendered it on request), so it was ported from the source and tested on the preview.
- **Preview.** Lighthouse mobile: home page 99 Performance and 100 elsewhere; the SEO score dipped only because a preview URL can't be indexed, and was back to 100 live. Firefox GPU-helper CPU on the home page was about the same as the live Astro site (roughly 10 to 17 percent on both). A real contact message sent and arrived. A real phone check passed.

## Results

| | Astro (2026-10-06) | Plain HTML (2026-10-09) |
|---|---|---|
| Direct dependencies | 6 (Astro, Cloudflare adapter, sitemap, two font packages, Wrangler) | 1 (Wrangler, run with `npx`) |
| Lockfile | 5,745 lines | 1,500 lines (all Wrangler's) |
| Source lines | about 5,100 (4,532 `.astro`, 291 `.ts`, 296 `.css`) | about 4,000 in `site/` (1,825 HTML, 1,884 CSS, 303 JS), plus 912 in the scripts, Worker and tests |
| Build step before deploy | `astro build` | none |
| Lighthouse mobile, Performance | 97 on all four pages | 98 on home, 99 on the others |
| Lighthouse mobile, other three | 100 | 100 |
| Home page weight, gzipped | not measured | about 17 KB of HTML, CSS and JS, plus fonts |

Line counts aren't like for like: `.astro` files hold markup, styles and scripts together, and plain pages repeat the shared header and footer. The old page weight can be measured by checking out the commit before the rewrite, installing and building.

## What was lost, and what it cost

- **Automatic CSS scoping and splitting.** Now the split is manual (`components.css` sitewide, `home.css` home only). A measurement on 2026-10-08 found about 1 KB of unused CSS per page. Nothing warns about dead rules.
- **Automatic asset hashing.** The first plain version served CSS and JS under fixed names that revalidated on every visit. `sync.mjs` now adds a content hash and `_headers` caches them as immutable.
- **Prefetching in Firefox and Safari.** Speculation Rules work only in Chromium, hence the fallback.
- **Contact send time.** The form takes 3 to 4 seconds to answer, because the Worker waits for the email send so a visitor learns if it failed. That is deliberate and was kept. The Astro version did the same work, so it was probably no faster, though that was not measured.

## A follow-up worth telling

After launch a brief white flash appeared when changing pages in Firefox. The audit found three plausible causes: no early dark background, revalidating stylesheets and no prefetch in Firefox. Fixes (early background and `color-scheme`, hashed immutable CSS and JS, the prefetch fallback) made it rarer. The remaining flashes came from a browser extension: a clean profile, a private window and Firefox Developer Edition showed none, and re-enabling the extensions one by one pointed to Readwise Reader. Lesson: test in a clean profile before changing the site further.

## Lessons

- Port, don't redesign. The Firefox performance findings lived in the CSS and JS, and a "cleanup" could have undone them.
- A rendered, element-by-element comparison finds what reading code can't. Both real bugs surfaced only that way (one by rule counts, one in the browser).
- Wrap every script in a function. Classic scripts share a global scope, and a duplicated top-level name fails silently on one page.
- Keep one source for every fact that appears twice (nav, prices, sitemap), and have a script check or generate the copies.
- Strip explanatory comments from shipped CSS and JS: they were about a third of `components.css`.
- When to go back to Astro: more than 10 to 15 pages, content-heavy sections, many shared components or automatic image handling (see `static-site-stack-skill.md`).
