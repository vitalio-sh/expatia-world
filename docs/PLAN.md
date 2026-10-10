# Expatia World — delivery build progress

Owner: the dedicated Expatia World development chat. Update this as implementation progresses. Definition of done: `handoff/BUILD_BRIEF.md`.

- [x] Preserve supplied map sketch and Eleven v4 Turbo documentation.
- [x] Transfer provider knowledge and private server environment from Blind Builder iteration3.
- [x] Save the user's new product scope, acceptance criteria and previous implementation limitations.
- [x] Establish development-token baseline and runtime/provider usage ledger. Exact cumulative log deltas registered for this chat and three implementation agents; costs remain separately measured.
- [x] Inspect source reuse points; agree state, perception, action, dialogue and asset contracts in CONTRACTS.md.
- [x] Spawn parallel implementation agents with clear ownership: world/JEV, voice/dialogue, generated art/animation.
- [x] Implement mobile onboarding, scenario selection and initial Barcelona map.
- [x] Complete sixty-second delivery state machine, limited perception and actual JEV actions.
- [x] Integrate adaptive dialogue, shared scenario memory and streaming English voice.
- [x] Generate and integrate coherent Barcelona art and both characters' animation states.
- [x] Add live Barcelona weather/time and weather-aware drop-off decisions.
- [x] Test mobile flow, outcomes, provider failures, latency and visual consistency.
- [x] Deploy outside Vercel, connect expatia.world, verify HTTPS/voice services on the public domain. Hardware microphone limitations are explicit.
- [x] Save usage report, QA evidence, checkpoint list and exact remaining limitations.

Checkpoint0 `1f7eb37` preserved the handoff; foundation `518024b` established contracts and accounting. The current integrated build includes full art, live JEV, v4 Turbo PCM, Scribe realtime, and a signed-capability Cloudflare Worker with connection-owned WebSocket RPC.

Published: [expatia.world](https://expatia.world/) and [www.expatia.world](https://www.expatia.world/), Sites/Cloudflare with active HTTPS. Application source/version identity and deployment metadata are in `docs/qa/deployment-final.json`. Subsequent verification/accounting commits only update evidence, not deployed application code. DNS preserves existing email forwarding/SPF. No Vercel or new paid hosting subscription was used.

49 focused tests pass, including perception, collision/legal routes, physical handoff/drop, deadlines, rain/closed/no-valid-shop cases, interruptions, duplicated RPC, first-clue and disclosure guards, six weather/cache tests, and client microphone permission races, spontaneous speech after cancellation and resident stop-to-idle transitions. Typecheck and production build pass. The 55-file, 3,440,640-byte archive was checked for private provider values; none were present.

Actual provider/public-domain evidence:

- `docs/qa/live-domain.json`: version2 live clarification → wrong north entrance → south correction → physical handoff; actual timeout observed after60,155ms and physically completed Bar Llevant collection drop.
- `docs/qa/live-domain-final.json`: version5 repeated both complete outcomes with live forecast input; timeout observed after60,097ms, then actual collection drop.
- `docs/qa/domain-final.json`: current version7 client, healthy HTTPS origins, real MET forecast fallback following measured Open-Meteo429, and correct generated WebP serving. All19 art responses matched local bytes in version4; the unchanged main image and final bundle were rechecked in version7.
- `docs/qa/mobile-final.json`: final version7 browser UI at360×800 and390×844, full square map,44×44 movement buttons,16px active input, no horizontal overflow. Live JEV south route → explicit Parcel received while another reply was pending, with no false error afterward. Earlier version5 pending-microphone → typed clarification proof is retained. Replay preserved mute and the untimed incoming call; voice was restored and the temporary viewport reset. Screenshots: `mobile-360-final.jpg`, `mobile-final.jpg`.
- `docs/usage/browser-voice-published.json`: two real browser PCM scheduling samples,923.8ms opening and1280.9ms typed clarification; JEV203/202ms. These are samples, not percentiles.
- `docs/usage/domain-voice-final.json`: version5 public domain v4Turbo first received PCM1217ms; Scribe synthetic generated-PCM commit-to-final891ms (server243ms), exact-word match. No extra TTS request was needed for the STT input.
- `docs/usage/final-report.json`: disjoint captured runtime cohorts, returned OpenRouter cost fields, separate JEV/Eleven estimates, GMI job counts and unknown billing units. `development-report.json` sums each registered chat's cumulative delta once.

Remaining limits: this is the complete parcel demo; other scenarios remain Coming soon. A Worker round belongs to its open WebSocket connection and cannot be resumed after disconnection. Worker usage is isolate-local unless captured before closure. Real-device microphone capture/denial, physical speaker audibility and mobile hardware latency were unavailable. The IAB microphone permission request remained pending; typing worked, and late grant/denial/cancellation are regression-tested with fake devices. No claimed p50/p95 or unreturned provider invoice.

Checkpoints after foundation: `517c2eb` integrated art/world/voice; `93464cf` Sites source; `37a9b53` public outcomes/voice and touch controls; `aa45003` mobile square map/weather diagnosis; `503ba1c` working MET fallback/art media route; `56d357b` client microphone lifecycle, replay and final public flow. Originals, prompts, jobs and processed art are preserved in the documented locations.

Independent integration review found and fixed cancelled NPC turn ownership, an outer audio-unlock permission race, retained mute across replay, and resident walking after release. No further material findings in hook order or art/secret dispatch.

Final application source checkpoint `afb57cb59aac55c825961fb1f5bc613a730ae2be` is deployed as Site version7. A handoff invalidates pending dialogue UI updates, preventing cancelled replies from restoring old state or showing a false error on a successful result.
