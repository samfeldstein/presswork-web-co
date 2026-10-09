---
name: reset-css
description: Use whenever starting a new website, landing page or static site, or restyling one from scratch, and whenever the user mentions a CSS reset, normalize, base styles, box-sizing, or "starting styles". Gives the user's small, modern reset.css (assets/reset.css) and the rules for using it, so every site starts from the same baseline instead of a bigger library like normalize.css or a framework's preflight. Use it even if the user doesn't say "reset", for example when you are about to write the first stylesheet of a new site.
---

# reset.css

Browsers ship slightly different default styles. A reset removes the differences that cause bugs, so the site's own CSS starts from the same place everywhere. This reset is deliberately small (about 40 lines): it fixes real problems and sets no look of its own. Colors, fonts, spacing and headings belong in the site's tokens and global styles.

## How to use it

1. Copy `assets/reset.css` to the site's CSS folder (for example `css/reset.css`) unchanged.
2. Load it first, before the site's tokens and global styles, so everything after it can override it.
3. Don't add look-and-feel rules to it. If a rule is about how this one site looks, it goes in the site's own stylesheet. That keeps the reset reusable and makes it obvious where to find a rule later.
4. Don't swap in a larger reset (normalize.css, Tailwind preflight, a full "modern reset"). Most of their rules fix problems that no longer exist in current browsers, and extra rules are extra surprises.

## What each rule is for

- **`box-sizing: border-box` on everything:** padding and borders count inside an element's width, so layouts don't overflow when you add padding.
- **`margin: 0` on everything:** spacing is set deliberately in the site's CSS (a spacing scale), not inherited from browser defaults on `p`, `h1` and friends.
- **`text-size-adjust: none` on `html`:** stops mobile browsers from silently enlarging text in some orientations. Users who want bigger text still get it from their browser or system settings.
- **`scrollbar-gutter: stable`:** reserves the scrollbar's width, so pages don't shift sideways between a short page and a long one.
- **Smooth scrolling only under `prefers-reduced-motion: no-preference`:** in-page links glide for people who are fine with motion and jump for people who aren't.
- **Media (`img`, `picture`, `svg`, `video`) as `display: block`, `max-width: 100%`, `height: auto`:** no stray gap under images, and nothing wider than its container. Always still give images `width` and `height` attributes so the page doesn't jump while they load.
- **Form controls inherit font and color:** inputs, buttons and textareas otherwise use the system font and ignore the site's type.
- **`b` and `strong` as `bolder`:** fixes a bold-weight bug in Chrome, Edge and Safari.

## Optional additions

Add these only when a site needs them, and put them in the site's global styles, not the reset:

- `overflow-wrap: break-word` on text elements, for sites with user-generated text or long URLs.
- `text-wrap: balance` on headings and `text-wrap: pretty` on paragraphs, for nicer line breaks.
