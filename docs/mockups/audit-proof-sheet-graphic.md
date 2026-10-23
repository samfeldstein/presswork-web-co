# Proof sheet graphic (saved 2026-10-20, "in our back pocket")

A small animated drawing for the free site audit on the pricing page: a line drawing of a web page that a gold proofreader's pen marks up one mark at a time (circle round the image, a caret, a squiggle under text, a tick on the header, then "OK" in the margin). It plays once on page load and then stays still. Reduced motion shows the finished proof. It was suggested by an Opus agent and judged "not bad" by the user; the other ideas (registration marks, pulling a proof) were rejected. Other ideas from the brainstorm that were never mocked up: type-high gauge, composing stick, loupe over a halftone, four stamps, color-control strip, three-day calendar, audit receipt (only if the home printer stays).

Markup (viewBox cropped to the page so it fills its container):

```html
<svg viewBox="76 0 232 220" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="var(--color-ink-dim)" stroke-width="1.5">
    <rect x="90" y="8" width="170" height="204" rx="2"/>
    <rect x="104" y="22" width="142" height="14" rx="1"/>
    <path d="M104 52h96M104 66h142M104 78h120M104 90h134"/>
    <rect x="104" y="106" width="142" height="54" rx="1"/>
    <path d="M104 160l34-30 24 20 28-28 56 38"/>
    <path d="M104 176h142M104 190h100"/>
  </g>
  <g stroke="var(--color-accent)" stroke-width="3">
    <ellipse class="pf-m1" cx="175" cy="133" rx="88" ry="38"/>
    <path class="pf-m2" d="M96 170l8-12 8 12" transform="translate(120 12)"/>
    <path class="pf-m3" d="M104 186q6-8 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0"/>
    <path class="pf-m4" d="M252 26l7 8 14-16"/>
  </g>
  <text class="pf-m5" x="272" y="198" fill="var(--color-accent)" font-family="var(--font-display)" font-size="26" font-style="italic">OK</text>
</svg>
```

CSS (marks appear on a 0.5 s beat over 3 s, then hold; transform-free, opacity only):

```css
.pf-m1 { animation: pf-m1 3s steps(1, end) both; }  /* ...m2 to m5 the same */
@keyframes pf-m1 { 0%, 16.67% { opacity: 0 } 16.68%, 100% { opacity: 1 } }  /* start at 0.5 s */
/* m2 at 1.0 s (33.33%), m3 at 1.5 s (50%), m4 at 2.0 s (66.67%), m5 at 2.5 s (83.33%) */
@media (prefers-reduced-motion: reduce) { .audit-art svg * { animation: none !important; opacity: 1 !important; } }
```

If used, start it when it scrolls into view (a few lines with IntersectionObserver) so visitors don't miss it, and follow the project's rule against explanatory comments (the comments above are for this note only).
