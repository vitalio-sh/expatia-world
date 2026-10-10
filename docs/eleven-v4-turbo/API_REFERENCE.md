# Eleven v4 Turbo API reference

Reviewed October 10, 2026. This reference combines the current v4 realtime guide with endpoint schemas. See [compatibility notes](SOURCES.md) where those sources disagree.

## Authentication and discovery

Use HTTPS or WSS. A server API request carries `xi-api-key`. Limit the key's permissions and quota; keep it outside browser bundles, repositories, client logs, and downloadable configuration. [Authentication](https://elevenlabs.io/docs/api-reference/authentication), [API security](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/security).

| Request | Purpose |
| --- | --- |
| `GET https://api.elevenlabs.io/v1/models` | Inspect current model IDs, capabilities, and available model metadata |
| `GET https://api.elevenlabs.io/v2/voices` | Search and paginate account-accessible voices |
| `GET https://api.elevenlabs.io/v1/voices/{voice_id}/settings` | Inspect generic voice settings; do not infer v4 endpoint support from every returned field |
| `POST https://api.elevenlabs.io/v1/single-use-token/tts_websocket` | Mint a temporary token server-side for an eligible WebSocket client |

Source references: [Models](https://elevenlabs.io/docs/api-reference/models/list), [Voices](https://elevenlabs.io/docs/api-reference/voices/search), [Voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get), [Token creation](https://elevenlabs.io/docs/api-reference/tokens/create).

The token reference describes a single-use token valid for 15 minutes. The TTD schema accepts a `single_use_token`, but the token creation endpoint uses the generic `tts_websocket` type. Test the exact v4 Turbo combination before making it the default browser transport. A backend relay is the documented pack's baseline and does not require exposing a permanent key.

## Realtime connection

```text
wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000
```

Set `model_id` explicitly. Some reference defaults still select v3 Conversational. For Turbo, register exactly one voice. Regular v4 can register up to ten on this endpoint. [Current realtime guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd).

### Initialization

With server-side `xi-api-key` header:

```json
{"voices":["VOICE_ID"]}
```

If authentication is sent in the first message instead:

```json
{"voices":["VOICE_ID"],"xi_api_key":"SERVER_API_KEY"}
```

Do not include both methods unnecessarily. Optional settings and dictionary locators belong only in this first message. Subsequent messages must not repeat credentials or voice registration. [TTD schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket).

### Dialogue input

```json
{
  "inputs": [
    {
      "text": "[curious] You found the key. Where was it?",
      "voice_id": "VOICE_ID",
      "new_turn": false
    }
  ]
}
```

`voice_id` must be registered. Keep spaces between incremental text segments. Never split a bracketed instruction into separate sends. The realtime guide describes a context buffer of approximately 40 characters and eight words before automatic synthesis; a short complete reply should be explicitly flushed.

### Control messages

| Message | Meaning |
| --- | --- |
| `{"flush":true}` | Generate buffered text while keeping the socket open |
| `{"keep_alive":true}` | Reset the 20-second client inactivity timer without synthesis |
| `{"close_socket":true}` | Flush remaining audio, emit the closing final message, and close |
| `new_turn:true` on an input | Finalize the pending segment before applying that input |

The schema's order of operations makes `new_turn:true` appropriate on the first segment of a subsequent utterance; use `false` for its continuation segments and `flush` after the final text. The guide describes the boundary more loosely, so verify repeated turns in a smoke test. A one-shot client can send input followed by `close_socket` and wait for all remaining audio.

**Neither `flush` nor `close_socket` is an immediate cancellation command.** Handle interruption in the application's player and generation ownership. For a persistent connection, send a heartbeat while it is intentionally retained; an application interval of ten seconds is a reasonable starting choice, not a provider requirement.

### Server events

```json
{"audio":"BASE64_AUDIO_BYTES"}
```

```json
{"is_final_audio_for_turn":true}
```

```json
{"is_final":true}
```

```json
{
  "error":"authentication_required",
  "message":"Human-readable explanation",
  "code":1008,
  "param":null
}
```

Decode `audio` from base64 to the selected audio format. Process any audio in a message before handling final flags. `is_final_audio_for_turn` ends an audio turn; `is_final` ends the closing flush sequence. Record error identifiers and close codes without logging credentials. Fields use snake case.

### Query and initialization options

| Field | Location | Guidance |
| --- | --- | --- |
| `model_id` | Query | Always set `eleven_v4_turbo` for this integration |
| `output_format` | Query | Start with `pcm_24000` or the guide's `mp3_44100_128`; verify tier support |
| `language_code` | Query | Optional supported ISO 639-1 language code |
| `sync_alignment` | Query | Request alignment where available; default false |
| `apply_text_normalization` | Query | `auto`, `on`, or `off`; test numbers and abbreviations |
| `seed` | Query | Reviewed WS schema: 1–4,294,967,295; best-effort reproducibility |
| `enable_logging` | Query | Defaults true; disabling provider retention requires eligible account features |
| `voice_settings` | First message | Reviewed schema lists `stability` from 0 to 1, default 0.5; v4-specific optional controls need verification |
| `pronunciation_dictionary_locators` | First message | Dictionary ID and version ID in each locator |

The v4 product page describes Stability and Similarity, while the reviewed TTD wire schema exposes only Stability. Do not invent `similarity`, copy `similarity_boost`, or send legacy `style` and `speed` into this socket. The minimal examples omit these optional controls. Confirm supported v4 settings through the current schema and a live request before extending them.

Optional dictionary example:

```json
{
  "voices":["VOICE_ID"],
  "pronunciation_dictionary_locators":[
    {"pronunciation_dictionary_id":"DICTIONARY_ID","version_id":"VERSION_ID"}
  ]
}
```

### Protocols that must remain separate

The older TTS endpoint `/v1/text-to-speech/{voice_id}/stream-input` uses a different message shape. Do not send its `text`, `try_trigger_generation`, or `chunk_length_schedule` controls to TTD. [Protocol comparison](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets).

The multi-context endpoint `/v1/text-to-dialogue/multi-stream-input` documents v3 models, context IDs, and up to five concurrent contexts. Current v4 Turbo support is not established by the reviewed reference. Treat it as a separate candidate requiring verification. In its documented protocol, `close_context` flushes and closes a context; an invalid context or voice can close the complete socket. [Multi-context reference](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-multi-websocket).

## HTTP dialogue generation

Use regular `eleven_v4` for the offline examples below. This pack does not assume that the realtime Turbo model is supported on every HTTP endpoint.

| Method and path | Response | Useful for |
| --- | --- | --- |
| `POST /v1/text-to-dialogue` | Audio bytes | Complete recorded dialogue |
| `POST /v1/text-to-dialogue/stream` | Streaming audio bytes | Progressive receipt of recorded dialogue |
| `POST /v1/text-to-dialogue/with-timestamps` | JSON containing base64 audio and timing | Caption and scene preparation |
| `POST /v1/text-to-dialogue/stream/with-timestamps` | Streaming JSON objects | Progressive audio with timing metadata |

Sources: [Create](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert), [Stream](https://elevenlabs.io/docs/api-reference/text-to-dialogue/stream), [Create with timestamps](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert-with-timestamps), [Stream with timestamps](https://elevenlabs.io/docs/api-reference/text-to-dialogue/stream-with-timestamps).

Original request body:

```json
{
  "model_id":"eleven_v4",
  "inputs":[
    {"text":"[curious] Is the archive open?","voice_id":"GUIDE_VOICE_ID"},
    {"text":"[serious] Only until sunset.","voice_id":"KEEPER_VOICE_ID"}
  ],
  "settings":{"stability":0.5,"similarity":0.75},
  "apply_text_normalization":"auto"
}
```

The HTTP envelope is `settings`, not WebSocket `voice_settings`. The reference recommends a combined text length of at most 2,000 characters for reliability and up to ten distinct voice IDs. Optional fields vary by endpoint and model; confirm before reuse:

- `language_code`, `seed` from 0–4,294,967,295, and normalization mode.
- Up to three pronunciation dictionary locators; HTTP permits omission of version to use the latest.
- `previous_text` and `future_text`, each up to 100 characters, where supported.
- `previous_request_ids` and `next_request_ids`, up to three each, where supported.
- `use_pvc_as_ivc`, where applicable, to change how a professional voice is used.

An audio response is binary. Save or decode it as audio; do not call `response.json()` on raw audio endpoints. HTTP network read boundaries are not necessarily audio frames or JSON object boundaries. Use the endpoint's actual framing for timestamp streams rather than parsing each TCP chunk as a complete JSON document. [Streaming reference](https://elevenlabs.io/docs/api-reference/streaming).

## Audio formats

The HTTP dialogue references enumerate the following formats. Check the selected endpoint and subscription rather than assuming every format is universal:

| Family | Listed formats |
| --- | --- |
| MP3 | `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32`, `mp3_44100_64`, `mp3_44100_96`, `mp3_44100_128`, `mp3_44100_192` |
| Raw PCM | `pcm_8000`, `pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_32000`, `pcm_44100`, `pcm_48000` |
| Telephony | `ulaw_8000`, `alaw_8000` |
| Opus | `opus_48000_32`, `opus_48000_64`, `opus_48000_96`, `opus_48000_128`, `opus_48000_192` |
| WAV on create endpoint | `wav_8000`, `wav_16000`, `wav_22050`, `wav_24000`, `wav_32000`, `wav_44100`, `wav_48000` |

The reviewed references gate 192 kbps MP3 to Creator or above and 44.1 kHz PCM or WAV to Pro or above. WAV appears in the create endpoint list and should not be inferred as supported on the streaming endpoints.

Raw PCM is signed 16-bit little-endian audio without a file header. For mono `pcm_24000`, one second contains 48,000 bytes before base64 overhead. Convert to floating samples and schedule using a 24,000 Hz source rate. A mismatch changes speed and pitch. [Audio streaming concepts](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming).

MP3 chunks may depend on neighboring bytes for decoding. An incremental audio decoder or appropriate streaming player is required; repeatedly calling a whole-file decoder on arbitrary chunks is not a reliable design. For the first browser implementation, PCM makes sample scheduling explicit.

## Timing metadata

WebSocket alignment uses `chars`, `char_start_times_ms`, and `char_durations_ms`. It may be absent even when requested. The reviewed `normalized_alignment` field is reserved and currently unused; do not make it a required dependency.

HTTP timestamps use `characters`, `character_start_times_seconds`, and `character_end_times_seconds`. Dialogue voice segments include `voice_id`, start and end seconds, character indexes, and `dialogue_input_index`; the end character index is exclusive. These units and field names differ from WebSocket alignment. [HTTP timestamp schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert-with-timestamps).

Drive captions against the audio playback clock, including initial buffering and interruption. Character timing is not a phoneme or facial animation contract. If lip movement must be precise, add a separate viseme pipeline or use a simpler audio-energy animation for the prototype.
