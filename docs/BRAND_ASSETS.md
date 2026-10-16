# Avatar brand update — 2026-10-16

The Creator supplied the anonymous avatar with pixel sunglasses and requested a
professional site logo plus the exact ASCII header wordmark `naoeumfa.com`.
A8 governs spacing, legibility and touch controls. The existing SVG brand pipeline
keeps the mark sharp at header and favicon sizes; live text renders the domain.

Source: `scripts/generate-brand.mjs`. Installed assets:
`public/brand/naoeumfa-mark.svg`, `public/favicon.svg` and
`public/brand/naoeumfa-mark-512.png` for apple-touch.
The PNG is a 512px browser raster export of the exact SVG, not a different mark.

Built-in imagegen produced two raster studies; the retained second study and
prompt are local `renders/brand/` artifacts. Those studies had edge defects and
were not shipped. The final native vector uses the same avatar identity with
flat grayscale fills and a clipped circular silhouette.

Verification: production TypeScript/build passed. The real local header passed
320, 390, 768, 1440 and 1920px checks: exact text, loaded image, no child beyond
its container and no document overflow. Screenshots were visually inspected.
The preview intentionally kept API requests unavailable; this is branding/layout
acceptance, not gameplay or backend acceptance. Evidence:
`~/.kray/work/naoeumfa-brand-20261016/report.json` and `header-*.png`.

Discarded branch: ship a generated bitmap with visible edge artifacts or keep
an old UFO apple-touch icon alongside the new avatar.
