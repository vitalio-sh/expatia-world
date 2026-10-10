# Iteration 3 — Meridian visual lane

The playable default alternative is **Meridian**: a worn, inhabited, analog expedition ship. Copper-orange Pip remains the warm focal point in olive/khaki metal, cream labels and amber lamps. The mood is quiet fatigue rather than horror spectacle. Service stencil 42 is a background joke, never a solution or an invented game rule.

## Modes and integration

`RoomView` accepts optional `visualMode: "classic" | "meridian" | "generated"`; omitted means `classic`. Import `src/app/meridian-theme.css` after the existing game CSS. `src/shared/visuals.ts` exports `VisualMode`, `VISUAL_MODES` and `isVisualMode`.

- **Classic:** original scene, original colors, full original directional SVG rig.
- **Meridian:** complete existing SVG cast, new metal deck, warm wall rails and low intensity service lights, restrained palette and heavier door timing. All original furniture, plate shapes, button glyphs, weights, status colors and labels retain their semantics.
- **Art pilot:** real generated deck, crate texture and transparent Pip sprite. Weight and color identity (broad painted tint plus border for named blue/yellow/red crates) are rendered on top of the correct metal/wood/cardboard material. Pip has a heading chevron and procedural pose motion. This is a *front-view art pilot*, not a finished four-direction animation rig. It must remain optional until carrying/pressing/direction poses have been art-directed.

Content Studio consumes `/art/manifest.json`. Source textures are kept alongside optimized delivery images. Only runtime copies are used by the game. No API credential or provider network call is required to display an asset.

## Art coverage

| Element | Meridian | Art pilot |
|---|---|---|
| Floor | New panel pattern, corner wear, service stencil | Generated deck image |
| Walls | Desaturated layered metal palette, rail accents | Same readable geometry |
| Lamps | Very slow shallow brightness drift; no strobe | Same |
| Doors | Existing exact state; 640 ms heavy slide, 240 ms bolt | Same |
| Crates | Existing shapes and encoded look, harmonized heavy crate | Generated square sprite, engine weight stamp and look border |
| Plates / lamps | Existing state colors and glyphs retained | Same |
| Buttons / sequence | Existing symbols, exact progress and reset | Same |
| Furniture / clutter | Existing silhouettes, harmonized core palette | Same |
| Pip | Full directional procedural rig | Generated front sprite with action bob, explicit heading |
| Victory | Restrained robot movement, confetti suppressed | Same |

## Motion numbers

Emotional intent: tired competence, not elastic toy energy. Primary = robot action; secondary = carried crate and door bolt; ambient = ship breathing. Door slide 640 ms `cubic-bezier(.65,0,.35,1)`, bolt 240 ms `cubic-bezier(.16,1,.3,1)`. Robot step 550 ms with 1.4 px vertical travel; idle 5–6 seconds and 1 px travel. Lamp cycle 14 seconds, only 14% opacity variation. Ambient motion never encodes a puzzle rule. Reduced-motion disables all newly introduced ambient and pilot animation, removes new door transitions, and preserves state changes.

## Invariants and review

No engine, room physical definition or rule was changed by the art lane. Sprite placement remains inside the original robot anchor and clip. Crate delivery art uses exact engine width. Existing labels stay above the scene. The generated pilot does not replace invisible physics with a movie. The Seedance clip is an audition asset; acceptance and limitations are recorded in the manifest and `ART_GENERATION.md`.

QA completed in lane: TypeScript no-emit passed after component changes; alpha verified on Pip and crate; no clipped feet/antenna/edges in inspected source images; source PNGs retained. Parent integration performs browser/mobile and game-flow QA after app wiring. No claim of complete generated directional/action coverage.
