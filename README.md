# Presswork Web Co.

The source for [presswork.dev](https://presswork.dev), published as a code sample. The site is plain HTML, CSS and JavaScript with no framework or build step, a few dependency-free Node scripts that keep its pages consistent, and one small Cloudflare Worker for the contact form.

If you'd like a site built for you, [get in touch](https://presswork.dev/contact/).

## How it's built

The deployed folder is `site/`: five pages (home, pricing, about, contact, 404), a handful of stylesheets and scripts, self-hosted fonts and images. Pages are written by hand as HTML. There is no bundler, no framework and no runtime dependency; the only package is `wrangler`, Cloudflare's deploy tool.

I built this site with Claude Code, and the way I work follows from that. A framework mostly saves a person from repeating themselves, and repetition costs an AI assistant nothing. What a hand-written site needs instead is protection against drift, where the header, the prices or the footer differ from page to page. So the single sources live in `shared/` (head, header, footer, and a `facts.json` holding prices, navigation and the contact email), and `sync.mjs` writes them into every page between marker comments. It also adds a content hash to each CSS and JS link, so those files can be cached as immutable and still update the moment they change.

Styling is plain CSS. Colors, type and spacing are tokens in one file, and each component's styles sit under its own root class. Each script is a classic deferred script wrapped in a function, so two files can't collide on a top-level name. Pages are fully readable without JavaScript; the scripts only add animation and the contact form's inline sending state.

## How it's checked

`check.mjs` fails the build when the site has drifted or something is broken. It checks that:

- every page has one `<h1>` and one `<main>`, plus a title, description, canonical URL and social tags;
- internal links and asset paths resolve, and the sitemaps match the pages that exist;
- prices and navigation are identical everywhere they appear;
- every character on every page is covered by the font subsets I ship;
- each page stays under a gzipped size budget (16 KB, 24 KB for the home page);
- the color pairs in the design pass WCAG AA contrast;
- every script is wrapped in a function, and no page loads from a host that isn't on an allowlist (which keeps third-party scripts out).

`test/` holds tests for the contact form and the Worker, and tests that `check.mjs` itself catches broken CSS and dangling ids. Before any commit or deploy, I run `node sync.mjs && node check.mjs && node --test test/`.

## The contact form

The Worker (`worker/`) answers only `/contact`; everything else is served as static files. It renders the page with the current time in a hidden field, validates each post with the rules in `validate.js`, and quietly drops anything submitted under two seconds after the page was rendered or with no timestamp. It sends through Cloudflare Email Service, with the visitor's address as the Reply-To, and it waits for the send to finish, so a visitor finds out if sending failed instead of being told it worked. With JavaScript, the page posts in the background and shows the sending animation; without it, the same form works as a normal post and the Worker re-renders the page with errors or redirects to a thank-you state.

## Performance and accessibility

Lighthouse on the live site, mobile, scores 98 to 100 across every page. Before launch I also ran the W3C and schema.org validators, WAVE, a keyboard-only pass, a VoiceOver pass, Firefox profiles (where I found and fixed animation costs that Chrome hides), and a real phone. The performance rules that came out of that work are in the stack write-up below.

## Further reading

- [`docs/astro-to-plain-html-report.md`](docs/astro-to-plain-html-report.md): the site started on Astro. How and why I rebuilt it as plain HTML, and what I'd do differently.
- [`docs/plain-html-plan.md`](docs/plain-html-plan.md): the plan I wrote before the rebuild.
- [`docs/static-site-stack-skill.md`](docs/static-site-stack-skill.md): the lessons from this site, written as a guide for building small static sites.

## Commands

These are for running the site as it is, in case you want to follow along.

- `npx wrangler dev`: local server with the contact form Worker
- `node sync.mjs && node check.mjs && node --test test/`: run before every commit or deploy
- `npx wrangler versions upload`: preview URL (not live)
- `npx wrangler deploy`: goes live

## Setup

Put `CONTACT_TO_EMAIL` (where contact form emails go) in a `.dev.vars` file (never committed), and set it as a secret on Cloudflare. It must be a verified destination address in Cloudflare Email Routing. The form sends through Cloudflare Email Service (the `EMAIL` binding in `wrangler.jsonc`); the local dev server only logs the email.

## License

All rights reserved; see `LICENSE`. The code is public to read, not to reuse.
