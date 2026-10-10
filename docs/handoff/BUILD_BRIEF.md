# Expatia World — build and publish the courier demo

User-requested handoff, 10 October 2026, Europe/Madrid. This is the scope for a new dedicated development chat. Start implementing, use parallel agents, commit milestones, and carry the product through deployment and mobile QA. This is a new product using useful code from Blind Builder, not another skin of that game.

## Locations and ownership

- New product root: `/Users/neo/CodeProejcts/BCN-AI-HACK/expatia-world`.
- Existing user reference image: `plan.jpg` in this root. Inspect it before designing the map. It shows a central chamfered building, player inside, entrance at the bottom, courier at the upper left, streets above and below with routes around the block.
- Existing speech documentation: `docs/eleven-v4-turbo/`, including working-pattern examples. Preserve these files.
- Source implementation to selectively reuse: `/Users/neo/CodeProejcts/BCN-AI-HACK/03-iteration-3`, branch `codex/iteration-3`, checkpoint `eb42a71`.
- Older staging: `/Users/neo/CodeProejcts/BCN-AI-HACK/03`, baseline `937da3d`. Do not edit, reset, stop, or replace the old game as part of this build. Its existing local preview uses port3304; use another free port for Expatia World.
- `.env.local` has been copied from iteration3 to this new root and protected by `.gitignore`. Read values only inside server-side code or provider scripts. Never display them, add them to prompts, commit them, or bundle them into the browser. Preserve any newly added configuration; do not recopy over this file blindly.
- Optional read-only pipeline reference: `/Users/neo/CodeProejcts/soviet-godot/tools/visual_pilot/`. Its game art, character canon and project-specific approval processes are not this product's requirements.

## Product and scope

Expatia World helps people rehearse everyday situations in a new country: understand someone, clarify uncertainty, act, and reach a practical result. All product UI, onboarding, dialogue, subtitles, errors and judge-facing explanations must be English. Spanish/Catalan business signs and place names supply local character. User-facing development updates may be Russian.

Build two short onboarding screens, then scenario selection, then a fully working delivery scenario. Other selectable-looking situations can include a hospital appointment, plumber visit, pharmacy, café, or rental handover, but unfinished ones must be clearly marked coming soon. Do not spend the demo budget implementing all scenarios. The delivery scenario must be complete and genuinely playable.

The human's goal: receive their parcel. The central challenge is communicating useful directions and asking clarifying questions under time pressure. This is not a quiz with a fixed correct sentence and not a scripted chatbot.

## The sixty-second delivery

1. Entering the scenario shows an incoming call and gives the player time to understand the map. The clock has not started.
2. The player taps **Answer call**. Unlock audio through that gesture and start exactly60seconds. Prepare providers before this point when possible so cold-start setup does not consume the round.
3. The courier begins at the upper-left street position. The player avatar begins inside the central building. The actual home entrance is on the lower side of the block, as in `plan.jpg`.
4. Courier speech is heard in English and shown as a transcript. The player can speak using a clear microphone control, with a typed alternative. On mobile the map, countdown and active conversation remain readable together.
5. The courier's first description deliberately omits a distinguishing detail. For example, a category such as a shop or bar is available initially; the name/sign can be disclosed after a clarifying question if it is actually visible. Enforce this as a state/knowledge rule while generating natural wording dynamically. Do not fake missing visibility by inventing observations or require a magic keyword.
6. Include ambiguous landmarks, such as two bars, alongside visibly distinct local shops. The courier can genuinely misunderstand and move toward the wrong plausible destination after vague directions, then recover as the player clarifies. Do not force failure on every first turn.
7. Both courier and resident have visible animated movement. Define intuitive mobile controls for the resident and interaction/handoff. Give directions over the call; guide the courier to the correct entrance and complete an explicit parcel handoff. A spoken claim is not delivery unless world state confirms it.
8. At deadline, if handoff has not happened, JEV selects an appropriate visible alternative drop location based on current position, known opening hours, day/time, shelter/weather, access and parcel suitability. Show the actual resulting choice, reason and outcome. If none is suitable, a defensible return/failed-delivery outcome is allowed. Never teleport to an unseen convenient destination. Describe the remaining collection step clearly; do not call a dropped parcel a received parcel.
9. Provide a clear outcome and short helpful communication feedback, then replay. Replays reset turn ownership, knowledge, positions, timer and parcel state correctly.

The timer must start on Answer, not page load, scenario selection, microphone permission or onboarding. Use an authoritative deadline and handle backgrounding and late provider responses. Do not silently restart or extend the timer to manufacture success.

## Map, perception and real JEV decisions

Create a coherent, top-down Barcelona/Eixample-inspired block with chamfered corners, streets above/below, sidewalks, crosswalks, central residence and connected traversable paths. Use the reference image as geometry inspiration. Add recognizable local storefronts: a supermarket, bar/café, fruit shop, bakery/hairdresser and a second bar with different signs. Verify any claimed real brand/local fact; fictional storefront names and authored opening hours are fine when presented as scenario data rather than live business facts.

Each building needs identity, category, map footprint, readable sign, entrance, opening intervals by weekday, whether it accepts parcels, accessibility and shelter attributes. Buildings and terrain must have matching visuals and collision geometry.

Implement finite cardinal-direction sight with distance and building occlusion; choose and document a sensible range. The deterministic world computes what could be seen. JEV then selects among grounded observations/interpretations and legal actions using only that perception, prior observations and facts learned through conversation. Keep belief uncertainty distinct from physical visibility. A confidence score must not make a courier see through a building.

JEV is mandatory for meaningful decisions: interpret ambiguous landmark candidates, choose the next legal destination/route action after directions, choose whether clarification is needed, and select a drop-off at timeout. Validate its choices and apply them to the real world. The dialogue LLM voices those decisions; it must not overwrite them or access hidden map facts through a back channel. The game server may know the entire map, but the NPC context must be a scoped projection of that state.

Provide a compact, collapsible **Why this choice? / JEV** view for judges: actual candidates, returned probabilities/confidence, selected action, relevant observable evidence and live/fallback status. Explain that these are model scores, not calibrated guarantees. Do not invent a trace or reveal private chain-of-thought. Keep technical inspection secondary to the player's main experience. A labelled fallback can preserve play during outages, but must never be presented as a live model decision.

## Conversation and scenario memory

Maintain one coherent, session-scoped state for the entire delivery: positions, active route, visibility, known landmarks, ambiguous references, last clarification, parcel ownership, delivery phase, time remaining, weather, facts shared, promises, misunderstandings and corrections. Retain the complete short scenario conversation or an explicitly bounded summary plus recent exact turns. Store the words actually spoken, not only the desired output. Both JEV decisions and dialogue generation must receive the consistent relevant state.

All NPC turns—including spontaneous courier remarks—must enter the shared history so a player can reply to them. The previous game failed to connect director quips to the interpreter; do not carry over that separation. Names like “that shop,” “the other bar,” “go back,” and answers to an open question must work naturally.

Use fast currently available models, preferably via the existing OpenRouter configuration if available. User mentioned Haiku/Sonnet and GPT as examples, not immutable model IDs. Check the live catalog and run small latency/quality probes; choose based on measured end-to-end responsiveness. Do not spend hours researching model rankings or silently use an unverified model alias. Short contextual replies, streaming and explicit action validation matter more than long reasoning.

Dialogue must be generated dynamically, relevant to the parcel situation, with light humane humor. No canned multi-turn script disguised as AI. Prepared ringing/SFX or a short opening cue are fine; disclose any outage fallback. Weather and observed surroundings can affect phrasing without swamping the conversation with small talk.

## Voice and latency

Read `docs/eleven-v4-turbo/README.md`, `API_REFERENCE.md`, `NPC_REALTIME_ARCHITECTURE.md`, `OPERATIONS_AND_EVALUATION.md` and the examples before implementing. This newly supplied documentation is more suitable for Expatia than blindly copying the old buffered `/api/speech` implementation.

Preferred documented route: server-side ElevenLabs Text-to-Dialogue WebSocket, `eleven_v4_turbo`, one consistent account-accessible courier voice, incremental PCM playback. Express emotion with sparse supported delivery tags; use a natural voice, not the old weary robot performance. Keep tags out of visible subtitles. Verify the actual account/model/voice compatibility with one live smoke test; docs/examples were researched and syntax checked, not authenticated end-to-end tested.

Use phrase streaming, early useful speech, turn IDs, interruption/cancellation, stale-result disposal, microphone echo management and a single audio queue. Maintain caption readability. Follow documented boundaries when reusing a provider connection; do not misattribute late chunks to a new turn. Start with reliable push-to-talk and typed input, then improve automatic turn detection if time permits.

Measure player-end-of-speech to transcript, decision, first text, first audible reply and turn completion separately. The local documentation's p50≤800ms/p95≤1.5s are targets to test, not achieved facts or vendor guarantees. Record real timings on the deployed build. A “100ms model latency” claim alone does not establish a fast game.

## Visual production is required, not an optional pilot

Art direction: contemporary restrained pixel art inspired by the readability and warmth of Stardew Valley/Terraria, adapted to recognizable Barcelona. Moderate pixel density, cohesive palette, not huge blocky pixels, generic glossy sci-fi, placeholder rectangles, or a CSS recolor of Blind Builder. Use original assets, not copied game sprites.

Generate the map/environment elements, buildings/storefronts, streets/sidewalks, both human characters and interaction props using the image-generation tool. Plan shared camera angle, pixel scale, palette, lighting and contact shadows so assets fit the same world. Shop signs should remain legible; overlay text if image-generated text is unreliable. Include visible people-scale details, Catalan/Spanish street character, awnings, balconies, pavement and trees. A generic parcel-company courier with a playful original brand cue is fine; an Amazon reference was optional, not a requirement to impersonate an official product.

Use GMI Cloud Seedance for actual short animation assets where appropriate: courier and resident both need believable idle and movement states; use directional walk cycles or a clearly coherent rig, not a single front-facing still merely sliding and bobbing. Add restrained environmental motion such as foliage or awnings. Keep camera fixed and assets reusable. Coordinate batch generation and budgets across agents. Review actual frames, alpha edges, scale, foot contact, seams and consistency, then integrate approved assets into the default playable view.

The prior iteration generated five images and one robot idle loop, leaving the full directional set incomplete and hiding it in a pilot mode. The user explicitly objected to that shortfall. Do not repeat it and do not report a comprehensive visual upgrade after producing a few samples. If anything is incomplete, state the exact missing asset/state and keep working within authorization.

Preserve generation prompts, provider job IDs, originals, processed files, provenance and acceptance status. A compact internal art/voice review page is useful if it speeds QA, but building a large dashboard is secondary to the playable product.

## Time, weather and opening hours

Show Barcelona, local time and current temperature/weather in a small unobtrusive HUD. Use Europe/Madrid. Fetch weather server-side for fixed Barcelona coordinates; no need to request the player's personal location. Include retrieval timestamp and honest stale/offline status. Do not claim it is sunny unless data says so.

The user described Saturday,10October2026, as the initial demo day. Prefer real Barcelona day/time for live display and hours evaluation. If a reproducible Saturday demo snapshot is needed, label scenario time separately from live time; do not silently mix clocks. Weather is an input to JEV shelter/drop-off choice and courier dialogue. Test rainy and closed-shop conditions too even if the live weather is sunny. Opening hours are authored scenario data unless separately verified.

## Hackathon context, not a rigid creative template

Barcelona AI Hackathon,9–10October2026. Prior research is included in `references/HACKATHON_CONTEXT.md` with original sources. It recorded tracks Game/Tool/Habit, judging emphasis on a working product and product quality, and a stranger understanding a phone demo in roughly60seconds. Recorded rubric: functionality30%, product quality30%, originality20%, build process20%. Treat this as previously researched context; check current organizer materials before quoting exact requirements externally.

Mentors/judges named in the prior materials: Alex Carbajo, Gustavo Comitre, Breno Oliveira and Antonella Sassu. Broad useful emphasis: human value, understandable UX, coherent design and demonstrable engineering. Do not invent individual preferences, guarantee a win or contort the concept to stereotypes. The team's new Expatia direction is authoritative. The game itself uses a60-second round as explicitly requested, independently of any hackathon presentation format.

Original context links: Notion `https://befitting-touch-ead.notion.site/Barcelona-AI-Hackathon-20623b21c94c80a68205fcc546d6bd0c?pvs=149`; event `https://luma.com/m0byiqzd`.

## Parallel work, checkpoints and evidence

The user explicitly requests parallel agents. Start them early with non-overlapping ownership and shared contracts. Suggested lanes: (1) world/perception/JEV and scenario state, (2) realtime conversation/voice and usage telemetry, (3) visual generation/animation. The lead integrates mobile onboarding/game UI, coordinates changes and runs QA; delegate an independent review as capacity frees. Do not only delegate research while leaving the core implementation serial. Agree API/state schemas before parallel edits collide.

Maintain a concise live `docs/PLAN.md` with completed/active/next steps and evidence. Commit meaningful checkpoints frequently: foundation, playable mechanics, voice/JEV, art, mobile integration, deployment/QA. Preserve ability to roll back. Do not commit secrets, giant caches, unrelated project files or private chat transcripts. Update the user during work and show a playable vertical slice early.

Suggested implementation order: inspect docs/image and reuse inventory; establish state/API contracts and agents; make Answer→talk→JEV action→movement→handoff/timeout work; stream voice; integrate generated art as it arrives; measure latency, perception and mobile behavior; deploy; run final real-domain tests. Do not stop at a plan, scaffold or localhost-only build.

## Token and spend accounting

The user wants actual tokens consumed by the new development session. Establish a measurement start point now. Keep separate ledgers for:

1. Development chat/model tokens, including spawned agents when those counters are accessible. Read only this task and its children's usage records; do not scan unrelated chats. Record per-thread start/end counters and summed deltas without double-counting cumulative events. Distinguish input, cached input, output and reasoning where available. If a category is not exposed, say unavailable rather than inventing precision.
2. Runtime player sessions: actual OpenRouter/LLM and JEV usage, voice characters/credits or returned billing units, GMI jobs and timings, grouped by scenario/session and provider. Label estimates separately from billed charges. Audio/video usage is not automatically a token count.

Provide a final usage report and, if helpful, a compact judge-facing session counter. Do not mistake remaining account quota percentages for this session's token usage. Final reporting may necessarily end at the last measured checkpoint; state that boundary.

The user previously authorized roughly$50 for ElevenLabs and described roughly$10 available JEV credit, and authorizes use of GMI generation. Previous small charges and exact remaining balances are not fully known. Use credits sensibly, check current permissions/balance/pricing where available, record generation jobs before retrying, and do not assume an unlimited hosting or recurring-subscription budget. Existing scripts' reservations are estimates, not invoices.

## Deployment

The user explicitly requests deployment and domain connection. Domain: **expatia.world**, purchased at **Namecheap**. **Do not use Vercel**. Choose an accessible non-Vercel host suited to server-side secrets and long-lived audio WebSockets; a portable container/Node deployment is a reasonable starting point. Inspect existing authorized hosting/account options, build the deployable artifact and proceed with the already requested publication when access permits. Do not purchase a new paid subscription without a concrete authorized budget.

Inspect existing DNS before changing it; preserve unrelated email/MX/TXT records. Verify HTTPS, secure WebSocket, mobile microphone, API auth boundaries, live model calls, weather, caching and actual generated asset loading on the final domain. If credentials or an account owner action are truly missing, ask only for that specific missing prerequisite while finishing all independent work. Never call localhost a deployed product or claim domain success without checking it.

## Acceptance evidence

- Two-screen onboarding and clear scenario selection work on portrait mobile; delivery is playable without verbal coaching.
- Only Answer starts the60-second clock, once; scene transitions, retries and delayed AI/audio do not corrupt it.
- First clue is incomplete by policy; relevant clarification unlocks visible information. The NPC never names an unseen place or reads private target coordinates.
- Different directions produce real different JEV choices/routes and recoverable misunderstandings. Show actual returned scores and distinguish fallback.
- Adaptive English voice and captions share one context; interruptions stop old speech. Replies to NPC remarks and referential instructions work.
- Arrival and handoff produce success; timeout produces a world-valid JEV drop-off/return outcome, including closed/rain/none-valid cases.
- Generated Barcelona art is the default game view; both characters visibly animate, with coherent direction, scale and foot contact.
- Weather/time state is clear and honest; hours, sight, paths, parcel state and stale responses are covered by focused tests.
- Browser QA on desktop and at least390×844/360px portrait checks touch targets, caption length, keyboard, scrolling, permission denial, audio start, latency and replay. Include a real-device check if available; don't claim one from a viewport emulation.
- Build/typecheck/meaningful tests pass, deployment at the real domain is verified, checkpoints and remaining limitations are recorded, and usage is reported with actual measurement scope.

## First action in the new chat

Read this brief, `plan.jpg`, the supplied Eleven v4 Turbo docs and `PROVIDER_AND_CODE_TRANSFER.md`. Inspect the new repo without overwriting existing research. Establish usage tracking, update the plan, spawn implementation agents, and begin building. The user has authorized the work; do not stop to ask whether to proceed.
