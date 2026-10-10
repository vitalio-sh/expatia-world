# Eleven v4 Turbo documentation

**Project:** Expatia World / Blind Build hackathon  
**Reviewed:** October 10, 2026  
**Model identifier:** `eleven_v4_turbo`

Eleven v4 Turbo turns text into expressive speech for interactive characters. The practical starting point for this project is a backend connection to the Text to Dialogue WebSocket, one registered NPC voice per connection, and audio playback as chunks arrive. The player microphone, transcription, NPC reasoning, and game actions belong to the surrounding application.

ElevenLabs advertises approximately **100 ms model inference latency**. This is only one part of the delay between a player finishing a sentence and hearing an NPC. Measure that complete interaction in the game. [Official model overview](https://elevenlabs.io/docs/overview/models).

## Read the documentation

| Document | What it covers |
| --- | --- |
| [Model guide](MODEL_GUIDE.md) | Purpose, model variants, capabilities, limits, languages, and selection |
| [API reference](API_REFERENCE.md) | Authentication, exact WebSocket messages, HTTP dialogue generation, audio formats, and timestamps |
| [Voices and emotion](VOICE_AND_EMOTION.md) | Voice selection and cloning, audio tags, original NPC examples, pronunciation, and auditioning |
| [NPC architecture](NPC_REALTIME_ARCHITECTURE.md) | Microphone to speaker pipeline, game state, streaming, interruptions, and connection management |
| [Operations and evaluation](OPERATIONS_AND_EVALUATION.md) | Pricing, concurrency, deployment, errors, benchmarks, and release checks |
| [Sources and compatibility notes](SOURCES.md) | Official references, documentation conflicts, and facts requiring live verification |
| [Examples](examples/README.md) | Python and Node.js streaming clients and a browser PCM playback helper |

The prose and examples are an original technical synthesis. Linked official pages remain the authority for changes; this pack is not a verbatim mirror of the provider's documentation. [sources.json](sources.json) records the reviewed URLs for future updates.

## First successful request

1. Create an ElevenLabs API key with Text to Speech permission.
2. Choose a voice available to that account and record its `voice_id`.
3. Follow the [Python or Node.js setup](examples/README.md).
4. Generate a short line, confirm that the output is audible, and record the first audio chunk timing.
5. Integrate the browser playback and NPC turn handling described in the architecture document.

The minimal server-side protocol is:

```text
CONNECT wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input
        ?model_id=eleven_v4_turbo&output_format=pcm_24000
HEADER  xi-api-key: <server-side API key>
SEND    {"voices":["<voice_id>"]}
SEND    {"inputs":[{"text":"[curious] What brings you to the harbor?","voice_id":"<voice_id>","new_turn":false}]}
SEND    {"flush":true}
RECEIVE {"audio":"<base64-encoded audio>", ...}
```

Use this TTD protocol rather than older TTS WebSocket examples. The current official realtime guide explicitly uses v4 Turbo with a single voice. [Realtime dialogue guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd).

## Decisions for the first prototype

These are project recommendations, not vendor guarantees:

- Use the direct ElevenLabs API and a server relay.
- Start with push to talk, a short NPC answer, and one active speaker.
- Start with `pcm_24000` for incremental browser playback.
- Preserve the NPC voice ID across turns, but bound the lifetime of idle connections.
- Stop playback immediately when the player interrupts; discard stale audio by application turn ID.
- Keep quest actions separate from spoken dialogue and validate them against game state.
- Establish an end-to-end target of p50 at or below 800 ms and p95 at or below 1.5 seconds, then measure whether the actual deployment meets it.

## Verification status

The documentation was checked against official sources. The examples are checked locally for syntax and internal consistency; no authenticated generation or account-specific capability test is included. A successful live smoke test is still required for credentials, voices, settings, tiers, latency, and playback. The source guide identifies the specific uncertainties rather than treating undocumented combinations as supported.
