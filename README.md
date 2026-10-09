# Presswork Web Co.

Marketing site for [Presswork Web Co.](https://presswork.dev): plain HTML, CSS and JavaScript, deployed to Cloudflare Workers.

## Commands

- `npx wrangler dev`: local server with the contact form Worker
- `node sync.mjs && node check.mjs && node --test test/`: run before every commit or deploy
- `npx wrangler versions upload`: preview URL (not live)
- `npx wrangler deploy`: goes live

## Setup

Put `CONTACT_TO_EMAIL` (where contact form emails go) in a `.dev.vars` file (never committed), and set it as a secret on Cloudflare. It must be a verified destination address in Cloudflare Email Routing. The form sends through Cloudflare Email Service (the `EMAIL` binding in `wrangler.jsonc`); the local dev server only logs the email.

## License

All rights reserved; see `LICENSE`. The code is public to read, not to reuse.
