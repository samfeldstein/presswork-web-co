# Presswork Web Co.

The source for [presswork.dev](https://presswork.dev), published as a code sample. The site is plain HTML, CSS, and JavaScript with no framework or build step, a few dependency-free Node scripts that keep its pages consistent, and one small Cloudflare Worker for the contact form.

If you'd like a site built for you, [get in touch](https://presswork.dev/contact/).

## How it's built

The deployed folder is `site/`: five pages (home, pricing, about, contact, 404), a handful of stylesheets and scripts, and self-hosted fonts and images. Each page is a plain HTML file. There is no bundler, no framework, and no runtime dependency; the only package is `wrangler`, Cloudflare's deploy tool.

I built this site with Claude Code, and the way I work follows from that. A framework mostly saves a person from repeating themselves, and repetition costs an AI agent nothing. What a site without a framework needs instead is protection against drift, where the header, the prices, or the footer differ from page to page. So the single sources live in `shared/` (head, header, footer, and a `facts.json` holding prices, navigation, and the contact email), and `sync.mjs` writes them into every page between marker comments. It also adds a content hash to each CSS and JS link, so those files can be cached as immutable and still update the moment they change.

Styling is plain CSS. Colors, type, and spacing are tokens in one file, and each component's styles sit under its own root class. Each script file is an ES module, so two files can't collide on a top-level name. Pages are fully readable without JavaScript; the scripts only add animation and the contact form's inline sending state.

## How it's checked

`check.mjs` fails the build when the site has drifted or something is broken. It checks that:

- every page has one `<h1>` and one `<main>`, plus a title, description, canonical URL, and social tags;
- internal links and asset paths resolve, and the sitemaps match the pages that exist;
- prices and navigation are identical everywhere they appear;
- every character on every page is covered by the font subsets I ship;
- each page stays under a gzipped size budget (16 KB, 24 KB for the home page);
- the color pairs in the design pass WCAG AA contrast;
- every script file loads as a module, and no page loads from a host that isn't on an allowlist (which keeps third-party scripts out; the one exception is Cloudflare's cookieless Web Analytics beacon, which loads after the page does).

`test/` holds tests for the contact form and the Worker, and tests that `check.mjs` itself catches broken CSS and dangling ids. Before any commit or deploy, I run `node sync.mjs && node check.mjs && node --test test/`.

## The contact form

The Worker (`worker/`) answers only `/contact`; everything else is served as static files. It renders the page with the current time in a hidden field, validates each post with the rules in `validate.js`, and quietly drops anything that arrives too soon after the page was rendered (`spam.js`). A message that fills in a field people can't see still arrives, marked as likely spam, so a real message is never lost to a browser's autofill. A name that looks like spam gets a visible error, so a real person can fix it. The Worker logs each outcome without the contents of the form, and it never sends an automatic reply, so the form can't be used to send spam to other people. It sends through Cloudflare Email Service, with the visitor's address as the Reply-To, and it waits for the send to finish, so a visitor finds out if sending failed instead of being told it worked. With JavaScript, the page posts in the background and shows the sending animation; without it, the same form works as a normal post and the Worker re-renders the page with errors or redirects to a thank-you state.

## Performance and accessibility

On the live site, mobile, PageSpeed Insights scores accessibility, best practices, and SEO at 100 on every page, and performance between 94 and 100 depending on the run (`lighthouse.mjs` and `pagespeed.mjs` score every page from the command line). Before launch I also ran the W3C and schema.org validators, WAVE, a keyboard-only pass, a VoiceOver pass, Firefox profiles (where I found and fixed animation costs that Chrome hides), and a real phone. The performance rules that came out of that work are in the stack write-up below.

## Further reading

- [`docs/astro-to-plain-html-report.md`](docs/astro-to-plain-html-report.md): the site started on Astro. How and why I rebuilt it as plain HTML, and what I learned.
- [`docs/plain-html-plan.md`](docs/plain-html-plan.md): the plan I wrote before the rebuild.
- [`docs/static-site-stack-skill.md`](docs/static-site-stack-skill.md): a Claude skill, written as instructions for Claude, that captures the lessons from this site. It tells Claude how to build small static sites the same way.

## License

All rights reserved; see `LICENSE`. The code is public to read, not to reuse.
