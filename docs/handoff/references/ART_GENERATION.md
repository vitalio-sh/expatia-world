# Asset generation and provenance

Review date: 2026-10-10. Skills applied: builtin `imagegen`, `seedance-video-prompts`, `animation-principles`. New generated files belong to this game; no Soviet Godot art was copied.

## ImageGen output

Five separate builtin image generation calls (no OpenAI CLI/API fallback):

1. **Pip** — transparent full body, slightly overhead three-quarter front view; rust-orange compact maintenance robot, black face, two pale tired mint eyes, two arms/two legs, cream trim, scuffs and 42 stencil. Mature matte 1970s utilitarian retrofuture; no weapon, floor or extra object. Output `public/art/meridian/pip-original.png`, optimized alpha-preserving `pip.png`.
2. **Deck** — opaque top-down floor material only; worn warm gray/olive metal-linoleum tiles, seams, recessed screws, subtle wear, low contrast and diffuse illumination; no walls or clutter. Output `deck-original.png`, runtime `deck.webp`.
3. **Crate** — transparent square top-down expedition crate with shallow front lip; sage lid, oxidized copper side, cream corners and blank label; parallel sides rather than isometric diamond. Output `crate-original.png`, cropped alpha bounds and optimized `crate.png`. The game's number overlay is authoritative.

4. **Wood crate** — transparent square wooden slats and diagonal timber brace, cream corner caps. Generated after browser QA found that a shared metal skin contradicted the first room’s material labels. `wood-original.png`, `wood.png`.
5. **Cardboard** — transparent top-down tan kraft box, unmistakable cream tape cross and dented corners, no metal fittings. `cardboard-original.png`, `cardboard.png`.

Source images were visibly inspected after generation. Pip is aesthetically suitable for the optional pilot but lacks directional action variants. This limitation is surfaced in the mode description.

## Seedance pilot

Provider: GMI Cloud. Authenticated live catalog saved in `ART-GMI-LIVE-SCHEMA.json`. Actual model: `seedance-2-5-260628`. The live parameter schema supports duration minimum 4, maximum 30, and 480p / 720p / 1080p. Its prose has older 4–15/480p–720p text, so the pilot uses the common conservative subset: 4 seconds, 480p, no generated audio, fixed camera, seed 42, same first and last frame.

Official API reference (checked): https://docs.gmicloud.ai/inference-engine/api-reference/video-api-reference

Endpoints used:
- GET `/api/v1/ie/requestqueue/apikey/models/seedance-2-5-260628`
- POST `/api/v1/ie/requestqueue/apikey/upload-url`, then PUT generated PNG to the returned signed upload URL
- POST `/api/v1/ie/requestqueue/apikey/requests`
- GET `/api/v1/ie/requestqueue/apikey/requests/{request_id}`

The signed upload URL and API key are never persisted. The stable generated-input public URL is kept as provenance. `scripts/art/gmi-loop.py` durably records a reservation before submission, refuses a second POST on an ambiguous outcome, and resumes the recorded job on future invocations. Only one paid generation was requested. A $2 budget reservation is **not** a verified charge; the catalog exposes raw price 231000/second without a clear dollar conversion in that response, and the actual bill remains unknown unless the provider returns it.

The user explicitly authorized chroma-key compositing. Pip's transparent image was placed onto pure green solely as the first/last-frame reference. The complete animation prompt is stored with the job at `public/art/meridian/seedance-job.json`. It requests a small tired shoulder sigh, one blink, original resting posture, locked feet/framing and flat green background. A movie is never used as a substitute for collision or interaction state.

Run `python3 scripts/art/gmi-loop.py` to observe/download the existing job. Do not use `--submit` for a new variant until the previous outcome has been inspected. A reserved/uncertain record with no request ID intentionally blocks resubmission.

## Reference project findings

Read-only reference: `/Users/neo/CodeProejcts/soviet-godot/tools/visual_pilot/gmi_production.py`, `gmi_upload.py`, and `production/research/gmi-seedance-live-schema.json`. Useful proven practices transferred: record request ID before retries, first-frame anchoring, minimum-size pilot, 480p 4-second duration, retain originals, separate generation success from visual acceptance, and never put credentials in a game client. Soviet Godot's canon/budget/approval system belongs to that project and was not imported as a constraint on this user-authorized worktree.

## Completed animation review

Request `7b2a6add-7fda-481a-9efd-5ef1c97eeda7` returned success. Source: `pip-idle-source.mp4`. `scripts/art/process-loop.py` uses ffmpeg RGBA colorkey (00ff00, similarity .22, blend .08), fits transparent 128×144 cells and samples 12 fps. Outputs: 48-frame `pip-idle.webp` (4 seconds), 12×4 `pip-idle-sheet.png`, metadata JSON, individual PNG frames and 12-sample `pip-idle-proof.jpg`.

Visually inspected all 12 spread-out samples: consistent whole robot, stable feet/frame, visible blink and subtle sigh, no added objects. Small green edge spill is visible when enlarged; suitable for optional small game-sprite audition, not final production closeups. Source returned to approximately the starting posture; first/last frame difference is quantified in the lane QA log. The generated mode uses this real loop only for idle. All other pilot actions remain procedural transforms of the still sprite. Reduced-motion displays the still image. No complete generated walk/carry/press cycle is claimed.

Measured source video is 620×660 at 24 fps, 4.041667 seconds (the API request was 480p/4 seconds with adaptive aspect). Delivery loop is exactly 48 frames at 12 fps / 4 seconds. Mean absolute first/last channel difference is RGB [6.34, 3.91, 6.07], alpha 0.175 on 0–255 scale. This is close, not mathematically identical; it is an audition loop, with original source retained for further cleanup.

Browser QA: desktop modes switch correctly; generated room 1 wood/cardboard identities, room 3 metal weight 2 and square/circle glyphs, room 5 passage boundaries inspected. Blue/yellow crates received a broad colored paint overlay after border-only coloring proved too weak. At 390×844 viewport, document width and scroll width both 390 (no horizontal overflow), Pip/props stay inside room. Screenshots in `ART-generated-desktop.jpg`, `ART-generated-mobile.jpg`.

## Additional video reference

Located the user-referenced public video: [Игра с GPT-6 Astra за 24 часа — от идеи до публикации](https://www.youtube.com/watch?v=Pirm1NA0yj4). The browser's transcript exporter reported that no transcript was available. No claims about its detailed technique are based on an invented transcript. The reproducible implementation above instead uses the verified GMI schema and the local Soviet Godot pipeline reference. Private Telegram conversation content is not included in the repository.
