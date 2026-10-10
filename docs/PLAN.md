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
- [ ] Test mobile flow, outcomes, provider failures, latency and visual consistency.
- [ ] Deploy outside Vercel, connect expatia.world, verify HTTPS/voice on the public domain.
- [ ] Deliver usage report, QA evidence, checkpoint list and exact remaining limitations.

Checkpoint0 `1f7eb37` preserved the handoff; foundation `518024b` established contracts and accounting. The current integrated build includes full art, live JEV, v4 Turbo PCM, Scribe realtime, and a signed-capability Cloudflare Worker with connection-owned WebSocket RPC.

Verified: live Node physical handoff (`docs/qa/live-node.json`), five live JEV grounding probes, generated sheet dimensions/HTTP assets, production build. 36 focused tests cover perception, routes, weather, deadlines, interruptions, duplicate RPC and disclosure/outcome guards. Browser timing has two local samples; scheduling is measured, hardware audibility is not. Current activity: Worker/mobile QA, Sites publication and Namecheap domain records. No real-device microphone result is claimed.
