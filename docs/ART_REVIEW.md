# Expatia World art production and review

The default playable world now uses a complete original Barcelona map, two original human characters with real generated idle and walking states in all four directions, a generated foliage loop, and a parcel prop. Runtime assets are `public/art/`; the source work is preserved locally in ignored `art-work/`.

## Coverage

| Asset | Coverage | Production |
| --- | --- | --- |
| Barcelona scene | Complete 960 × 960 scene with central chamfered residence/courtyard, visible south entrance, connected streets, two distinct bars, market, fruit shop, bakery, hairdresser, trees, balconies, awnings, panot tile sidewalks | Builtin image generation, original pixel art |
| Courier | South, west, north, east; idle and parcel-carrying walk for each | Four-direction builtin reference strip; GMI Cloud Seedance 2.5 idle and walk videos; eight extracted animated states |
| Resident | South, west, north, east; idle and walk for each | Four-direction builtin reference strip; GMI Cloud Seedance 2.5 idle and walk videos; eight extracted animated states |
| Orange tree | Subtle leaf rustle, fixed planter and trunk | Builtin cutout; GMI Cloud Seedance 2.5 loop |
| Parcel | Clean transparent parcel for drop/handoff display | Builtin generation and builtin revision; alpha export/crop |

There is no pilot toggle. Sixteen character states contain real video-generated articulated motion, not a still sprite translated or bobbed. The courier visibly keeps a parcel against the torso; resident phone stays low. The footage generation used first/last reference anchors and locked cameras, with four separate directional views animated simultaneously per video. The gameplay renderer owns world translation and collision.

## Geometry and scale

The attractive map generated a taller central home than the numeric starting contract. The lead/world lane accepted its actual normalized outline: `(364,220),(594,220),(679,304),(679,537),(592,629),(364,629),(279,543),(279,304)`. South entrance remains approximately `(480,645)`, with resident foyer `(480,565)`. This change was shared before integration so collisions and visible geometry can agree.

Human animation cells are 128 × 160, feet anchor 0.95, with approximately 140 pixels of actual human height. The client uses 58 world units high. All clips preserve the character identity, clothing, facing and baseline. Per-state crop bounds and scale are recorded in each sheet JSON. Tree cells are 144 × 176, with a planted baseline and a suggested nonblocking peripheral placement `(100,785)`, world width 82/height 100; the lead may tune placement.

## Frame and alpha review

Contact sheets for all sixteen character states and the environment are preserved under `docs/art/proofs/`. Direct frame inspection verified alternating legs, knees and free-arm motion in walks; blinking and small breathing in idle; a stable planter and subtle leaf rustle. South/north steps have smaller screen displacement than side views, as expected from the overhead camera, but are actual articulated steps.

Uniform green footage is keyed with `00ff00` similarity 0.18/blend 0.05. Partial-alpha edge spill is removed; opaque green-dominant edge colors are also corrected on the humans, whose wardrobe contains no green. Opaque tree green is preserved. Cells retain a fixed crop over the full clip rather than re-centering every frame, keeping planted-foot motion stable. Small generated hair/cloth variation remains; the restrained pixel style is coherent at phone scale.

Each source video is 4.041667 seconds at 24 fps. Runtime extraction uses 12 fps. Most states use 48 frames. Resident walk footage did not return closely enough to its starting pose; the processor selects a repeated stance from the actual source frames: south 23 frames, west/east 29, north 15. These trimmed cycles preserve real source motion, with seam mean RGBA differences reduced from approximately 5–8 to 1.06–1.41 on a 0–255 channel scale. Source frame ranges and untouched source videos remain available. No invented poses or procedural leg gait were added.

`docs/art/qa-measurements.json` records final file hashes, opaque foot bounds, frame counts, spill metrics, and measured source dimensions/durations. Alpha and source scaling have been inspected on the contact proofs. Final gameplay/mobile rendering and its world translation are integration QA owned by the lead; this document does not claim a real-device check.

The finalized runtime manifest was checked against all sheet dimensions and counts: sixteen generated human states, all nonempty. All nineteen referenced runtime images returned HTTP 200 from the local server on port 3317. Both provider/processing scripts pass Python syntax compilation.

## Runtime size and provenance

The runtime art directory is approximately 3.02 MB before HTTP compression, including map, sixteen optimized character sheets, one environment sheet, eight reference cutouts, parcel, manifests and review HTML. Production MP4s, full keyed frame sets, originals and animated preview files are retained outside `public/` in `art-work/`, so they are not shipped to players. A lossless WebP comparison produced approximately 6.83 MB versus 2.36 MB for the sheet set; quality-92 WebP sheets were retained after visual review because they preserve the pixel shapes at the actual gameplay scale.

Prompts: `docs/art/image-prompts.json`. Job parameters, request IDs, source hashes and sanitized statuses: `docs/art/jobs/`. Provider schema snapshot: `docs/art/gmi-current-schema.json`. Resumable provider script: `scripts/art/gmi.py`. Reproducible key/crop/seam/sheet processing: `scripts/art/process.py`. Review page: `/art/review.html`. Original URLs and signed upload URLs are never persisted.

## Provider usage boundary

Builtin imagegen was called six times: map, courier directional references, resident directional references, tree, parcel, parcel revision. Its exact cost, image tokens and billing were not returned to this lane. Development chat tokens are tracked separately by the lead for thread `01a12543-e1d9-7c70-a19f-15b9b82dc507`.

GMI recorded seven request IDs: five successful four-second animations and two immediate courier reference-validation failures. The failed reference had aspect ratio 3:1; the provider returned a maximum of 2.5:1. These jobs were reconciled in provider history before any retry, then a padded 2.4:1 reference was submitted. No duplicate active/finished request was retried. The two failures' billing status was not exposed.

The authenticated model catalog returned `price_info.price=231000`, unit `second`. Five successful requested clips total 20 requested seconds, giving an estimate of 4,620,000 catalog price units. The catalog did not document their currency conversion here and request responses returned no charge/credits/billing units. Dollar spend and billed charges are therefore unavailable, not asserted as zero or estimated as an invoice. The physical footage totals approximately 20.208 seconds; that duration is not assumed to be the provider's billing basis.
