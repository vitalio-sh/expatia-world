# Spanish input and conversation recovery

- Spoken language now defaults explicitly to Spanish (`es`) in browser, Node relay, Worker relay and file transcription. A persistent Spanish / English selector is available before answering and beside the microphone. Courier speech stays Spanish.
- The 14-second recording limit delivers its final transcript to the current conversation, instead of leaving the recognized text unsent. Microphone completion is scoped to the owning session and turn. Deadline cancellation releases capture without cancelling the courier's drop-off decision.
- STT startup queues retain audio, intermediate committed segments are retained, and commit gets its own finalization timeout. Explicit language is returned in ready/final events for verification.
- Streamed courier phrases update one complete history entry. Dialogue receives real preceding speaker turns, actual entrance questions and route progress. Spanish confirmations, entrance corrections and short side answers retain context; the preposition `para` no longer means STOP.
- Demo suggestions use complete conversation, actual questions, current destination and visible landmarks. Errors preserve progress instead of restoring the opening greeting. Manual controls remain available.

Verification: full automated suite, TypeScript, production build, 360px mobile UI, and real provider probes. `spanish-stt-language-worker.json` verifies default es and exact synthetic Spanish recognition; `conversation-recovery-live.json` verifies a live six-turn wrong-entrance correction and physical handoff. Synthetic audio probes do not claim a test of the user's microphone, accent or venue acoustics.

Provider language reference: https://elevenlabs.io/docs/es/api-reference/speech-to-text/v-1-speech-to-text-realtime
