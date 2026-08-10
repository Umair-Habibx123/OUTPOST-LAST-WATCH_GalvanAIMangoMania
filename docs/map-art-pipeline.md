# Map art pipeline

How the three battlefield backgrounds are generated and fitted, and the one rule
you cannot break when replacing them.

## The rule

**The painted palisade and the collision ellipse must be the same ellipse.**

`OLW.CONFIG.WALL_RADIUS` / `WALL_RADIUS_Y` define where raiders stop and attack,
and where the dashed integrity ring is drawn. If the painted wall is larger,
raiders stop in mid-courtyard; if it is smaller, they stop short of the wall in
open ground. Either way it reads as broken.

Current values, **measured from the art** (not chosen freely):

| | value | meaning |
|---|---|---|
| `WALL_RADIUS` | 180 | horizontal half-axis, px, in the 960x540 logical space |
| `WALL_RADIUS_Y` | 117 | vertical half-axis |
| fort centre | (480, 270) | canvas centre — the art must be translated so its fort lands here |
| warden footings | (428, 330) and (532, 330) | front half of the courtyard, clear of the tower |

If you regenerate the maps, re-measure and update **all** of these together.

## Composition requirements

Anything replacing these maps must have:

1. An **oval** palisade ring (wider than tall — the view is isometric), centred.
2. The watchtower in the **back half** of the courtyard. The two wardens are
   drawn at y = 330, so a centred tower buries them.
3. The **front half** of the courtyard kept open — that is where the wardens
   stand and where the campfire sits between them.
4. Darker ground outside the wall than inside, so raider silhouettes read.
5. Four approach roads to the frame corners (cosmetic, but raiders walk in from
   all angles and the roads sell it).

## Generating

Currently generated with Higgsfield's `z_image` (text-to-image). Two constraints
worth knowing before you start:

- On the **free plan `z_image` is the only usable model**, and it takes no
  reference image (`medias: []`). Every image-to-image model — `nano_banana`,
  `seedream_*`, `flux_2`, `recraft_v4_1`, `soul_location` — returns
  `job_minimum_basic_plan_required`. So the composition has to be carried by
  the prompt text alone. On a paid plan, feeding an existing map in as a
  reference would make matching the composition far easier.
- `z_image` **will not draw the fort small**. Asked for "one quarter of the
  image width" it reliably lands at 35-40%. Don't fight it; fit it afterwards
  (below). Prompts that push the camera back — "wide aerial establishing shot
  from very high above", "small subject, enormous surroundings" — help but do
  not fully win.

The three maps are the same arena re-graded, which is what `maps.js` assumes:

- **frontier** — wild dark forest, gnarled broadleaf trees, blue night
- **frost** — the same forest under deep snow
- **orchard** — the same forest with hell over it: charred trees on fire,
  molten ground cracks, embers, smoke

## Fitting

`tools/map-fit.mjs` is a small local harness that does the geometry:

```bash
node tools/map-fit.mjs
# then open http://localhost:3999/fit.html
```

Put the source renders next to the script (or in `tools/src/`). In the page
console:

```js
await loadSrc('/my-render.png');
compose({ scale: 0.45, sy: 0.51, cx: 922, cy: 671 });  // fit + centre the fort
overlayCustom({ cx:480, cy:270, rx:180, ry:117, wx:52, wy:330 });  // check it
vignette(0.5);                                          // hide edge fill
await save('map-frontier-960.webp', 'image/webp', 0.93);
```

- `scale` / `sy` map source px to canvas px. Separate values are allowed and
  useful: generated ovals are often flatter or rounder than the target, and a
  few percent of vertical stretch is invisible on this art.
- `cx` / `cy` are the **fort centre in source coordinates**; that point is placed
  at the canvas centre.
- `overlayCustom` draws the collision ellipse in red and the warden footings in
  green. Iterate until the red ellipse sits on the painted palisade — that is
  the whole job.
- Margins left by centring are filled by **mirroring** the adjacent strip, not
  by stretching the edge pixel (a clamp smears into obvious vertical streaks).
- `vignette` darkens the frame edge, which hides the mirrored strip and pushes
  focus to the lit courtyard.

Only files named `map-{frontier,orchard,frost}[-960].webp` are written to
`public/assets/art/maps/`; everything else stays local, so a stray screenshot
cannot land in the assets folder.

The originals are preserved in `public/assets/art/maps/_original/`.

## Character scale

Sprite sizes are tuned against the map art, so replacing the maps may mean
retuning them. The warden draw height lives in `render.js` (`w.height || 98`);
it should read as a person standing beside the watchtower. Raider draw sizes are
in `entities.js`. Note these are **draw** sizes only — raider collision uses
`r` from `RAIDER_TYPES` and is unaffected.
