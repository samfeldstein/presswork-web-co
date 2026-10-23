# Design decisions and gotchas

Not a component catalog: the CSS is the reference (`site/css/tokens.css` for colors, type, and spacing; `site/css/components.css` for sitewide pieces). This file keeps what the code can't show: why we chose something, what we passed on, and the traps we've already hit. When a piece used on one page is needed on a second, move it from that page's `<style>` block into `components.css` as a real class.

## Dividers

Chosen 2026-10-20 for the pricing page, after comparing seven options (`docs/mockups/pricing-dividers-2026-10-20.html`).

- **Chosen: a tapering hairline.** A gold line, 8rem wide and 2px thick, that fades to transparent at both ends (`linear-gradient(90deg, transparent, var(--color-accent), transparent)`). Pure CSS, quiet, and it reads as refined where a plain bar did not. It is the `.divider` in `site/pricing/index.html`.
- **Close second:** a small four-point gold star with fading hairlines on each side (inline SVG, about 14px star).
- **Also tried:** a plain gold bar, a diamond between two lines, a single gold dot (echoes the period in the logo), and three dots.
- Dividers are decorative: use `aria-hidden="true"`, and keep equal space above and below.
- Prefer CSS or SVG over decorative characters: glyphs like ❦ aren't in the Latin font subsets we ship, and `check.mjs` requires decorative characters to be in `allowedChars` in `shared/facts.json`.

## Section headings

The pricing page's "How we price." heading (2026-10-20) is right-aligned beside its text with a gold period, which echoes the period in the logo. Options we compared and passed on are in `docs/mockups/pricing-heading-options-2026-10-20.html`: a tapering bar above, a line below, a gold eyebrow, a vertical gold rule between heading and text (runner-up), one italic gold word, a sparkle, and a line running into the heading.

When a heading and a paragraph sit side by side, equal box tops are not equal letter tops: the larger heading with tighter line spacing puts its capitals lower. The h2 is pulled up by `calc(0.624 * var(--text-lg) - 0.474em)` (constants measured for Noto Serif at line heights 1.1 and 1.55); re-measure if the font or line heights change.

## Gotchas

- **`components.css` sets `margin-inline: auto` and `inline-size: 100%` on direct children of `.body`.** A `max-width` or margin on a section that is a direct child gets overridden, so put width limits on the elements inside the section.
- **Put paragraphs and boxes that should line up in one wrapper.** On the pricing page's "How we price" section the text and the example box were sized by separate rules, and their edges drifted apart as the window changed width (the box looked left- or right-aligned depending on the viewport). A single wrapper with the padding and `max-width`, and the box at 100% of it, keeps both edges identical. Also, `ch` units depend on each element's own font size, so two elements with the same `max-width` in `ch` can still differ.
- **Heading beside text.** A two-column grid (`1fr 2fr`) with the heading in the first column and one wrapper in the second; below 60rem it collapses to one column. See "Section headings" above for lining up the heading's letters with the first line.
- **Fonts are trimmed, so ranges are limits.** The preloaded Latin files cover weight 300 to 700 and width 72% to 100% (italic: weight 300 to 700 at width 100% only). A heavier weight, a width outside that range, or a condensed italic needs the file re-made with fontTools `instancer` from the original (in git history before commit `17c88f8`); until then the browser clamps. The files are cached as immutable, so a re-made file needs a new filename (and new names in `fonts.css` and the preloads in `shared/head.html`).
