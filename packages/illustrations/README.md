# @wordwise/illustrations

Shared vector artwork consumed by both the web app (`frontend/`) and the
mobile app (`apps/mobile/`). Drop SVGs into the subfolders below and they
become available on both platforms via the same import path.

## Folder layout

| Folder           | What goes here                                                     |
|------------------|--------------------------------------------------------------------|
| `journey/`       | Quiz journey art — tree stumps per CEFR level, biome backdrops.    |
| `celebrations/`  | Stars, confetti, badges, "you did it" art shown after a session.   |
| `ui/`            | Empty states, paywall hero, error/success illustrations.           |

Subfolders are fine — organize however helps. Don't put raster images here.

## File format rules

1. **SVG only.** If the asset is painterly/photographic, export it as a
   separate WebP and put it under the consuming app's `assets/` instead.
2. **Optimize before committing.** Run `npx svgo <file>` (or use
   [svgomg.net](https://svgomg.net) in a browser). Raw exports from
   Figma/Illustrator carry ~50–70% metadata overhead.
3. **`viewBox` yes, `width`/`height` no.** Remove hardcoded dimensions so
   the React component controls sizing.
4. **Use `currentColor` for tintable parts.** Functional icons (stars,
   locks, checks) should fill with `currentColor` so one SVG can render in
   any color. Keep literal hex for multi-color scenery art.
5. **kebab-case names.** `stump-a1.svg`, not `Stump A1.svg` or
   `stumpA1.svg`.

## Consuming on mobile

`apps/mobile` uses `react-native-svg-transformer` to import SVGs as React
components:

```tsx
import StumpA1 from '@wordwise/illustrations/journey/stump-a1.svg';

<StumpA1 width={110} height={110} />
```

Requires `react-native-svg` + `react-native-svg-transformer` in
`apps/mobile/package.json`, plus metro config wiring.

## Consuming on web

`frontend/` (Vite) imports SVGs as React components with the
`?react` query suffix (or `vite-plugin-svgr`):

```tsx
import StumpA1 from '@wordwise/illustrations/journey/stump-a1.svg?react';

<StumpA1 width={110} height={110} />
```

## Checklist before uploading a new illustration

- [ ] Saved as `.svg` (not `.ai`, `.fig`, or a rasterized export)
- [ ] Filename is kebab-case and under 60 chars
- [ ] `viewBox` is set, no hardcoded width/height
- [ ] Ran through SVGO or svgomg.net
- [ ] Tintable parts use `currentColor`
- [ ] Lives in the right subfolder (journey / ui / celebrations)
