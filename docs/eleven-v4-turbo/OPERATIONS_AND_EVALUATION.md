# Operations and evaluation

Reviewed October 10, 2026. Prices and limits are a dated snapshot; account terms and the current dashboard take precedence.

## Pricing and budgeting

| Product | Advertised regular rate | Temporary rate visible on review date |
| --- | --- | --- |
| Eleven v4 Turbo | $0.04 per 1,000 characters | $0.011 per 1,000 characters; promotion says until October 12 |
| Eleven v4 | $0.08 per 1,000 characters | $0.022 per 1,000 characters; same promotion |
| Scribe v2 Realtime | $0.39 per audio hour | No promotion assumed here |
| Speech Engine | $0.08 per minute | Burst pricing shown as $0.16 per minute |

Text synthesis is billed by characters. Speech Engine has its own pricing; do not automatically add separate TTS and STT charges to its bundled rate without checking the contract. Taxes are excluded. Voice-specific pricing and subscription allowances can affect the actual bill. [Official API pricing](https://elevenlabs.io/pricing/api).

Budget against the regular rate because the promotion ends shortly after this research date. An original arithmetic example: 1,000 NPC replies averaging 180 billed characters total 180,000 characters. At $0.04 per thousand, the synthesis component is **$7.20**; at the displayed promotional rate, it is **$1.98**. This excludes transcription, dialogue generation, hosting, and any account-specific adjustments.

```text
estimated_synthesis_cost = total_billed_characters / 1000 × effective_rate
```

A fixed dollars-per-minute approximation depends on speaking density and is unsuitable for a precise NPC budget. Compare requested text length with actual billed usage; do not assume how tags, normalization, cancellation, or retries are charged. Set a daily spend cap and monitor provider usage.

## Concurrent sessions

The reviewed model catalog gives these TTD WebSocket session limits:

| Plan | Open TTD WebSocket sessions |
| --- | ---: |
| Free | 14 |
| Starter | 21 |
| Creator | 35 |
| Pro | 70 |
| Scale | 105 |
| Business | 105 |
| Enterprise | Elevated; contract-specific |

An open socket occupies one session even when it is idle. The dedicated session pool differs from normal HTTP generation concurrency. HTTP dialogue requests count against standard concurrency while generating. The dashboard reports TTD WebSocket Sessions separately. [TTD concurrency](https://elevenlabs.io/docs/overview/models#text-to-dialogue-concurrency).

A pool of 20 persistent voice connections consumes 20 sessions, regardless of whether anyone is currently hearing speech. Heartbeats retain those reservations. Close unused conversations, bound retained sockets per player, and reserve headroom for reconnects. Load-test simulated player interactions rather than assuming a marketing estimate of simultaneous broadcasts describes a persistent TTD pool.

## Credentials, data, and deployment

Use separate development and deployment keys with minimum permissions, quotas, and server-side storage. Avoid placing API keys in a frontend `.env` variable that the build exposes. Restrict who can select voices, create conversations, and send speech text. [Security practices](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/security).

Provider Zero Retention Mode is an eligible Enterprise API feature. Disabling logging changes provider history and can remove capabilities that depend on stored requests. It does not disable the project's own logs. Confirm eligibility before relying on `enable_logging=false`. [Zero Retention Mode](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode).

Regional residency uses isolated account infrastructure and may require separate resources. Do not substitute `api.eu.residency.elevenlabs.io` for the global host while assuming the same credentials and voices remain available. [Regional residency](https://elevenlabs.io/docs/overview/administration/data-residency).

Record operational metadata by default: turn ID, model, voice, character count, timings, byte counts, outcome, and error identifier. If the team needs transcripts or recordings for QA, define their retention and access separately. Keep voice permissions and any cloning consent with the asset records.

## Error handling

| Symptom | Likely checks | Response |
| --- | --- | --- |
| 400 or 401 | Key, permissions, voice availability, quota, request constraints | Read the error detail; fix permanent configuration failures |
| 403 | IP restrictions or account access | Check key restrictions and the deployment route |
| 422 | Schema, enum, or field validation | Inspect the response details; correct the request |
| 429 `too_many_concurrent_requests` | Session pool or generation concurrency | Release unused resources or apply an application admission policy |
| 429 `system_busy` | Temporary provider capacity | Retry only the current needed turn with a bounded backoff and jitter |
| WS error followed by close | Error identifier, `param`, and close code | Fail the owning generation; do not let old cleanup affect a new turn |

Sources: [400 and 401](https://elevenlabs.io/docs/help-center/technical/api-error-code-400-or-401), [422](https://elevenlabs.io/docs/help-center/technical/api-error-code-422), [429](https://elevenlabs.io/docs/help-center/technical/api-error-code-429), [WebSocket errors](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket).

Do not retry an authentication or exhausted-quota failure indefinitely. Do not replay a complete reply after the player has already heard part of it. On partial speech failure, stop the affected stream and choose a state-appropriate recovery. Retry ownership must be tied to the current application generation.

## Troubleshooting

| Problem | First diagnostic |
| --- | --- |
| A short line never starts | Send `flush:true` after the complete phrase |
| Socket closes during silence | Inspect the 20-second inactivity behavior and heartbeat policy |
| Wrong voice or voice error | Confirm account-accessible voice ID and initial registration |
| Old speech resumes after interruption | Check generation IDs, queued buffers, and stale socket callbacks |
| Speech sounds too fast, slow, or pitched | Check PCM encoding, sample rate, and byte boundaries |
| Audio chunks overlap | Use a sequential audio clock instead of starting each chunk immediately |
| Tags are spoken or ignored | Reduce cue complexity, use a compatible voice, and audition another phrasing |
| Long dialogue request fails | Apply the endpoint-specific character and voice constraints |
| Settings are rejected | Distinguish HTTP `settings`, TTD `voice_settings`, and legacy TTS fields |
| First turn is much slower than later turns | Measure connection establishment, transcription startup, model response, and playback resume |
| More than one character leaks into a reply | Check application state, voice mapping, and turn ownership |

## Benchmark the interaction

Record these milestones using monotonic clocks:

| Milestone | Meaning |
| --- | --- |
| `player_speech_end` | Last player speech sample or push to talk release |
| `player_turn_committed` | Stable transcript available |
| `llm_request_started` | NPC dialogue request sent |
| `first_spoken_phrase_ready` | First usable phrase extracted |
| `tts_text_sent` | Phrase submitted to the TTD socket |
| `first_audio_received` | First nonempty audio bytes reach the application |
| `first_audio_played` | First sample becomes audible in the player |
| `last_audio_played` | Reply finishes |
| `interruption_detected` | Application decides the player has interrupted |
| `playback_stopped` | Last old sample stops playing |

Compute:

```text
user_perceived_onset = first_audio_played - player_speech_end
tts_first_chunk = first_audio_received - tts_text_sent
playback_delay = first_audio_played - first_audio_received
interruption_stop = playback_stopped - interruption_detected
```

Do not subtract raw timestamps from different machines without clock alignment. Measure durations within each process; correlate turn IDs across browser and server. Browser scheduling time is not necessarily audible hardware time, so label that limitation in reports and use a recorded loopback measurement for rigorous validation.

Start with 30–50 representative turns per configuration as a practical prototype sample, then expand if tails or failures remain unclear. Include:

- A one-word answer requiring flush.
- An ordinary short answer and a longer streamed answer.
- A proper name, a number, and mixed-language content.
- Cold and retained connections.
- A player interrupting before and during audio playback.
- A second speaker arriving while another conversation is active.
- Realistic network latency and the intended deployment region.
- Increasing users up to the account's allowed capacity.

Report p50, p95, failures, underruns, stale audio incidents, character usage, and perceived voice quality. Keep text, voice, model, and settings constant when comparing a transport or buffering change. Optimize the stage that actually dominates. [Latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization).

## Prototype acceptance criteria

These are proposed project criteria, not ElevenLabs SLAs:

| Criterion | Initial target |
| --- | --- |
| End of player speech to audible reply | p50 ≤ 800 ms, p95 ≤ 1.5 s |
| Local playback stop after interruption | Aim for ≤ 20 ms; report actual browser behavior |
| Stale audio after a new turn | Zero observed in the interruption scenario set |
| Character identity | Correct voice on every test turn |
| Quest actions | Validated once against authoritative state |
| Browser credentials | No permanent provider key exposed |
| Failing synthesis | Visible, state-appropriate recovery with bounded retries |
| Cost and capacity | Usage and active session counts stay within configured caps |

If onset misses the target, use the milestone measurements to decide whether endpointing, transcription, LLM output, phrase buffering, network, synthesis, or playback is responsible. A faster TTS model will not fix a slow endpoint detector or a dialogue generator that waits to complete its full answer.

## Release and update procedure

Before a demo, verify the actual model and voice IDs, test a short flush, test repeated turns, listen to the audition set, verify interruption, check quotas and sessions, and inspect client bundles for secrets. Repeat the voice and protocol smoke tests when the model or SDK changes.

For a documentation update, follow the source catalog, refresh prices and session limits, resolve compatibility questions against the current endpoint schema, and record the new review date. Retain prior benchmark results so that quality and onset changes can be compared.
