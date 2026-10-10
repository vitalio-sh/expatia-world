# Provider and code transfer — verified prior implementation

This is a reuse map, not proof that the new Expatia product is already implemented. Source root is `/Users/neo/CodeProejcts/BCN-AI-HACK/03-iteration-3` at `eb42a71`. Recheck changing provider details against official docs/current account catalog before new paid generation; use the local working examples to avoid starting research from zero.

## Code to inspect and selectively adapt

| Need | Existing source |
| --- | --- |
| Deterministic state, navigation, interaction execution | `src/world/` |
| Scene rendering, sprite positioning and room scale | `src/components/room/RoomView.tsx` and adjacent components |
| Request epochs, execution lifecycle, cancel/undo and saved scene | `src/client/useRoomGame.ts` |
| Natural-language command contract and observed-state projection | `src/server/ai/contract.ts`, `robot-view.ts`, `service.ts`, `request.ts`, `schema.ts` |
| Provider selection and OpenRouter structured-output support | `src/server/ai/provider.ts`, `live.ts` |
| Microphone controls/transcription | `src/client/voice/`, `src/server/ai/transcribe.ts`; locate actual callers with `rg` |
| Audio playback, cancellation and channel mixing | `src/client/sound.ts`, `src/client/audio/`, `src/server/audio/speech.ts` |
| Real JEV request/schema/client ownership | `src/server/director/`, `src/client/director/`, `src/shared/director.ts` |
| Browser persistence patterns | `src/client/storage.ts`, `procedures.ts`, `upgrades.ts` |
| Tests to adapt conceptually | `tests/`: deterministic world, provider failure/stale-response, audio and director tests |

Some subdirectories may differ; inspect rather than assume every path exists. Reuse working mechanisms while designing Expatia's own world schema and UI. Do not transplant the old puzzle/robot prompt, hidden-rule constraints, branding, server-only model names, default host or limited director decision options unexamined.

### Important prior limitations

The old dialogue interpreter held8recent player/robot/result exchanges within one room. JEV held6player quotes,6action reports and4recent line IDs; its jokes were not added to interpreter history. Saved “procedures” were manually named command bookmarks, not learned general skills. The cleanup-autonomy sequence was an authored isolated rehearsal. Expatia requires real unified scenario state and actual JEV movement/drop decisions, not renamed versions of those features.

The old visual Meridian mode mostly recolored/extended SVG; generated mode contained5images and1idle loop. Walking/carrying that bitmap used procedural transforms. The user rejected calling this a complete visual upgrade. Reuse pipeline code, not that definition of done.

## ElevenLabs

Prefer this project's `docs/eleven-v4-turbo/` over the legacy buffered speech endpoint. Its research snapshot is10October2026. TTD documentation and examples distinguish support from untested account-specific capability.

Documented minimal transport:

```text
wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000
Header: xi-api-key: <server-side secret>
Initialize: {"voices":["<account-accessible voice_id>"]}
Input: {"inputs":[{"text":"[curious] Which entrance do you mean?","voice_id":"<voice_id>","new_turn":false}]}
Flush: {"flush":true}
Receive incremental base64 PCM; relay with application session/turn identity.
```

Check exact protocol against the provided API_REFERENCE before use. `examples/pcm-player.mjs` shows queue/sample-rate/cancellation ownership; examples do not by themselves implement a live NPC. Use no permanent provider keys in the browser. An aborted generation must never speak later. V4 expressive square-bracket tags are suggestions, not guaranteed performance; SSML break handling should follow current docs. Natural courier voice should be auditioned; do not retain Pip's British weary storyteller voice merely because its ID is already configured.

Legacy `references/AUDIO_DIRECTION.md` documents the old game's actually generated16voice clips,8SFX, air and music, plus sound API. It is useful for mixer and failure handling, not the courier creative direction or proof of current balance.

## JEV

Existing live integration:

```text
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <JEV_API_KEY>
model: jev-1.13.0
body: { model, state, questions: { name: { type: "choice", instructions, criteria: {option_id: description} } } }
response: answers[name].choice, probabilities, confidence; model; optional usage.input_tokens
```

`src/server/director/provider.ts` validates returned options, probabilities summing approximately1 and chosen option consistency. `service.ts` handles timeout/fallback/confidence and stale requests. A prior live proof is copied into `references/JEV_LIVE_PROOF.json`; prior small request returned roughly300ms, not a promise for Expatia. Confirm current model compatibility. Preserve actual response metadata and connect selections to validated world actions. Do not reuse the old fixed effects-only menu or its42-call cap without considering the60-second conversational loop.

The candidate set must come from physically visible/remembered eligible places and legal movements, not an omniscient full map. Provide the relevant opening hours and weather facts only when known/observable. The UI can inspect model scores separately without feeding judge-only omniscient information back into the courier.

## Image and animation generation

Use builtin image-generation capabilities for new original bitmap art, with transparent backgrounds for cutouts. Read the imagegen skill when applying it. For Seedance prompting and motion quality use the available seedance-video-prompts and animation-principles skills as relevant. The user authorizes actual generation and subsequent chroma-key video processing, not only writing prompt suggestions.

Copied prior files under `references/`:

- `ART_GENERATION.md`: actual image calls, source files, GMI process, outcomes and limitations.
- `ART_DIRECTION.md`: prior visual direction; transfer technical discipline, not space-robot styling.
- `ART-GMI-LIVE-SCHEMA.json`: authenticated catalog snapshot for the exact model.
- `gmi-loop.py`, `process-loop.py`: proven old scripts. **Reference only: they contain paths and robot-specific assumptions. Adapt them into new project scripts with new job IDs/output directories before running.**

GMI flow used successfully:

```text
Base: https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey
Authorization: Bearer <GMI_CLOUD_API_KEY>
GET  /models/seedance-2-5-260628
POST /upload-url   {"file_type":"png"}
PUT generated PNG bytes to returned upload_url (Content-Type:image/png; no bearer header to signed upload URL)
POST /requests    {"model":"seedance-2-5-260628","payload":{...}}
GET  /requests/{request_id}
Completed output: outcome.video_url
```

Previously accepted payload fields: prompt, first_frame, last_frame, duration:4, resolution:"480p", ratio:"adaptive", seed:42, watermark:false, generate_audio:false, web_search:false. First and last frame can use the same uploaded reference for a loop. Current live catalog remains authoritative. Record a local pending job and source hash before submitting; persist returned request_id immediately. After network ambiguity reconcile the existing job; don't submit duplicates automatically. Poll existing jobs with bounded waits while doing useful independent work. Download and retain source only after successful completion. Never persist signed upload URLs or credentials.

Animation prompt structure that worked: locked orthographic camera; same full character, framing, feet baseline, scale, lighting and uniform chroma background; explicit brief timeline; cycle returns to the starting pose; no camera pan/zoom, added objects or baked ground shadow. Walking should be in place for game-controlled translation; request relevant facings. Character identity must remain consistent across both reference images and loops. Use green only if wardrobe does not conflict; choose another key color if needed.

Old processing: ffmpeg RGBA colorkey `0x00FF00:0.22:0.08`, transparent padding,12fps,48frames for4seconds, animated WebP and spritesheet+JSON. Cell dimensions128×144 were robot-specific; derive new consistent human scale. A sample proof sheet showed every4thframe plus last. Green fringe and seam mismatch remained in the old pilot, so review/fix them for this build rather than inheriting those acceptance limits. Never present procedural transforms of one still as a generated walk animation.

Store original, keyed frames, sheet metadata, contact sheet, runtime optimized assets and generation manifest. Verify first/last seam, alpha edge spill, limb consistency, feet/camera stability, apparent speed against game movement and readability at phone size. Enforce world collisions independently of any generated visuals. Honor reduced-motion settings.

## Performance and deployment transfer

The old app is Next/React/TypeScript with deterministic client animation and server AI routes. Existing `npm run build` uses Next webpack after a Turbopack font-resolution failure; don't reproduce the font/network dependency by accident. You are free to choose a better fitting stack for the new realtime voice relay; avoid a gratuitous rewrite of usable logic. Do not copy old Vercel deployment settings or assume Vercel AI Gateway is the selected provider simply because it is the old default.

Track startup, STT, LLM/JEV, TTS-first-byte and audible response latency independently; do not serialize independent provider work unnecessarily, but do not voice a decision before its owning state is validated. Keep short turns, deterministic movement, stale-event rejection and timeout-safe outcomes.

## What was prepared in the sending chat

The sending chat inspected the supplied plan image, preserved the existing Eleven documentation and README, copied `.env.local` privately, copied these provider references, and wrote a detailed build brief. It did not implement the new game, select/pay for hosting, change DNS, generate new Expatia art, or claim new-chat token totals. Those are the new dedicated chat's requested work.
