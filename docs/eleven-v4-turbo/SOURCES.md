# Sources and compatibility notes

Research snapshot: **October 10, 2026**. All provider references below are official ElevenLabs pages. The Python transport reference is the library's own documentation. The guides are an original synthesis with original implementation examples; full copyrighted documentation and media are linked rather than reproduced.

## How to interpret this pack

- An endpoint schema establishes message fields and response types.
- The updated realtime guide establishes the documented v4 Turbo connection pattern.
- Product overviews describe model capabilities, which may precede an endpoint schema update.
- Prices, account limits, voice availability, and regional access must be refreshed before deployment.
- The NPC architecture, acceptance targets, sample lines, and relay messages are project recommendations.
- Syntax validation does not establish that an account accepts a model, voice, optional setting, or format.

## Documentation discrepancies

| Topic | Observed difference | Implementation decision |
| --- | --- | --- |
| v4 Turbo WebSocket support | The current realtime guide explicitly uses `eleven_v4_turbo`; parts of the TTD reference still describe only v3 | Use the updated guide's minimal v4 pattern and an explicit model ID |
| Voice settings | The v4 overview describes Stability and Similarity; TTD `voice_settings` lists only Stability | Omit optional settings in the starter clients; verify additional fields before enabling them |
| Model defaults | Reference defaults can still point to v3 Conversational | Always send the required exact model ID |
| New turn boundary | The guide loosely describes when a turn finishes; the schema says pending text is finalized before new input | Follow the schema's ordering and smoke-test repeated turns |
| Multi-context socket | Reviewed multi-context documentation explicitly covers v3 | Do not claim v4 Turbo support without a live capability check or updated reference |
| Language coverage | The model catalog and v4 FAQ list slightly different languages | Use the dated catalog snapshot and audition each intended language |
| Request size and speakers | A model-wide limit and capability copy can be broader than the HTTP endpoint reference | Use endpoint-specific limits; keep HTTP dialogue within its recommended size |
| HTTP stream framing | General streaming copy is broader than endpoint-specific raw-audio and JSON responses | Parse the actual selected endpoint's response type |
| PVC availability | The v4 page says supported but retains a rollout notice | Confirm readiness for the account's actual voice and model |
| Single-use tokens | TTD accepts a token field; token creation uses a generic `tts_websocket` type | Verify the exact combination before direct browser use; start with a relay |
| Speech Engine | The overview describes orchestration but the reviewed quickstart does not establish exact v4 Turbo selection | Confirm model configuration before treating it as a replacement for direct TTD |
| Scribe latency | Approximate low-latency advertising coexists with a startup buffering note | Measure startup, committed turns, and retained sessions separately |

Supporting references: [v4 overview](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4), [Realtime guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd), [TTD schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket), [Multi-context schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-multi-websocket), [Model catalog](https://elevenlabs.io/docs/overview/models), [HTTP create reference](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert), [Streaming concepts](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming), [Token reference](https://elevenlabs.io/docs/api-reference/tokens/create), [Speech Engine cookbook](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine), [Scribe commit guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies).

## Live verification questions

1. Does the target account expose `eleven_v4_turbo`, and is the chosen voice usable on it?
2. Which optional v4 settings are accepted on the exact TTD endpoint?
3. Which formats and alignment events does the account actually receive?
4. Does `tts_websocket` token creation authorize the intended v4 Turbo browser flow?
5. Is v4 Turbo supported on the multi-context endpoint or inside the selected Speech Engine configuration?
6. What are the account's current effective rate, remaining quota, and session limits?
7. What onset and interruption latency does the target browser and deployment achieve?

The starter implementation does not depend on questions 2, 4, or 5 being resolved. It uses a backend key, one voice, the minimal TTD envelope, and an explicit supported format.

## Maintaining the source record

`sources.json` records source titles, URLs, review dates, and fingerprints of the provider documentation text retrieved for research. Fingerprints help identify changes but do not imply that the provider publishes immutable versions. The original source text is not stored in the project.

The official [documentation index](https://elevenlabs.io/docs/llms.txt) can locate moved pages. Many documentation pages also offer a Markdown representation at the canonical URL plus `.md`. Re-check changed pages, update factual tables, run the live protocol smoke test, and date the revised pack.

## Reviewed references

1. [Models](https://elevenlabs.io/docs/overview/models)
2. [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
3. [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
4. [Text to Dialogue](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue)
5. [Stream dialogue in real-time](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd)
6. [Text to Speech vs Text to Dialogue WebSockets](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets)
7. [WebSocket](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket)
8. [Multi-Context WebSocket](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-multi-websocket)
9. [Create dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert)
10. [Stream dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/stream)
11. [Create dialogue with timestamps](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert-with-timestamps)
12. [Stream dialogue with timestamps](https://elevenlabs.io/docs/api-reference/text-to-dialogue/stream-with-timestamps)
13. [API Authentication](https://elevenlabs.io/docs/api-reference/authentication)
14. [Secure by design](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/security)
15. [Understanding latency](https://elevenlabs.io/docs/eleven-api/concepts/latency)
16. [Understanding audio streaming](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming)
17. [Streaming](https://elevenlabs.io/docs/api-reference/streaming)
18. [Using pronunciation dictionaries](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries)
19. [Voice cloning: how it works](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning)
20. [Libraries & SDKs](https://elevenlabs.io/docs/eleven-api/resources/libraries)
21. [List voices](https://elevenlabs.io/docs/api-reference/voices/search)
22. [Get voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get)
23. [List models](https://elevenlabs.io/docs/api-reference/models/list)
24. [Create Single Use Token](https://elevenlabs.io/docs/api-reference/tokens/create)
25. [How do audio tags work with Eleven v3 and v4?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4)
26. [How can I add pauses?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses)
27. [How do I select the language and accent?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-i-select-the-language-and-accent)
28. [What is Eleven v4?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/what-is-eleven-v4)
29. [Instant Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning)
30. [Professional Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning)
31. [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design)
32. [Speech Engine](https://elevenlabs.io/docs/overview/capabilities/speech-engine)
33. [Speech Engine quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine)
34. [Transcripts and commit strategies](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies)
35. [Client-side streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming)
36. [Zero Retention Mode (Enterprise)](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode)
37. [Data residency](https://elevenlabs.io/docs/overview/administration/data-residency)
38. [Voice Library](https://elevenlabs.io/docs/eleven-creative/voices/voice-library)
39. [API - Error Code 400 or 401](https://elevenlabs.io/docs/help-center/technical/api-error-code-400-or-401)
40. [API - Error Code 422](https://elevenlabs.io/docs/help-center/technical/api-error-code-422)
41. [API - Error Code 429](https://elevenlabs.io/docs/help-center/technical/api-error-code-429)
42. [Latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)
43. [Text to Dialogue quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/text-to-dialogue)
44. [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
45. [websockets 14.0 asyncio client reference](https://github.com/python-websockets/websockets/blob/14.0/docs/reference/asyncio/client.md)
