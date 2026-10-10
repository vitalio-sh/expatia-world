# Eleven v4 Turbo model guide

Reviewed October 10, 2026. See the [source catalog](SOURCES.md) for update and compatibility notes.

## What the model does

Eleven v4 Turbo is a speech synthesis model. Supply text and a voice identity; receive generated audio. Delivery instructions can be embedded in square brackets, for example `[whispering]`. Its intended use is expressive speech with low latency in conversations and interactive experiences. The regular v4 variant prioritizes production quality. [Eleven v4 overview](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4).

For an NPC, the application first decides what the character should say. That decision can come from a language model, a dialogue tree, a quest system, or an authored line. Eleven v4 Turbo performs the line. It does not itself maintain inventory, understand a microphone stream, choose an action, or guarantee a fact about the game world.

For example, the game may determine that the player has not found a key. The dialogue system generates an impatient hint, and synthesis gives it a recognizable voice:

```text
[annoyed] The warehouse is still locked. Ask the dock keeper about the missing key.
```

The emotional instruction changes the performance; the game state determines the content.

## Model selection

| Model | Exact ID | Typical purpose | Relevant distinction |
| --- | --- | --- | --- |
| Eleven v4 Turbo | `eleven_v4_turbo` | Live NPC replies and conversational agents | Advertised approximately 100 ms inference; one voice per TTD WebSocket |
| Eleven v4 | `eleven_v4` | Recorded scenes, voiceovers, and dialogue assets | Quality-oriented; up to 10 registered voices on the single TTD WebSocket |
| Eleven v3 Conversational | `eleven_v3_conversational` | Existing expressive realtime integrations | Previous conversational generation; do not leave it selected accidentally through a stale default |
| Eleven v3 | `eleven_v3` | Existing dramatic speech and dialogue assets | Previous expressive generation |
| Eleven Flash v2.5 | `eleven_flash_v2_5` | Latency-focused speech using the older TTS protocol | Different model family and WebSocket messages |
| Eleven Multilingual v2 | `eleven_multilingual_v2` | Existing long narration workflows | Different model family and protocol |

The current model catalog lists 90+ languages for v4 and a 10,000-character model limit for regular v4. Endpoint constraints can be narrower: the HTTP dialogue reference recommends no more than 2,000 characters across inputs and permits up to ten distinct voices. Do not apply a model-wide number as a universal request limit. [Model catalog](https://elevenlabs.io/docs/overview/models), [HTTP dialogue reference](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert).

The direct API exposes the audio protocol needed here. An OpenAI-compatible text routing service is only useful if it explicitly supports the same audio model, streaming transport, voice IDs, and controls. Use a separate LLM router for NPC reasoning if desired; establish the speech connection directly until equivalent support is verified.

## What “100 ms” means

The advertised number describes model inference, not the complete player interaction. A first audible reply also depends on:

1. Detecting that the player has stopped talking.
2. Receiving a stable transcript.
3. Producing the first useful NPC phrase.
4. Sending enough text for synthesis to start.
5. Transporting, decoding, and scheduling the audio.

Measure TTS request to first received audio separately from end of player speech to first audible sample. Network distance, connection setup, buffering, and concurrency change the result. The provider's latency guide explicitly separates inference from other delays. [Latency concepts](https://elevenlabs.io/docs/eleven-api/concepts/latency).

A ten-second spoken reply can begin before its complete audio has been generated. Streaming onset and complete file generation are different measurements. Waiting for an entire MP3 or WAV file before playback removes much of the benefit of a streaming model.

## Capabilities and limits

| Topic | Practical interpretation |
| --- | --- |
| Expressive speech | Use short delivery tags and suitable voices; audition the resulting performance |
| Multiple characters | Keep voice IDs stable; v4 Turbo registers one voice per connection |
| Nonverbal delivery | Laughs, sighs, and similar tags are performance cues, with variable adherence |
| Timing | Punctuation and phrasing guide rhythm; exact pause durations require editing or application playback control |
| Settings | v4 supports Stability and Similarity conceptually; the reviewed TTD wire schema exposes only Stability |
| Legacy controls | Do not assume Style, Speed, or SSML support in v4 |
| Reproducibility | Seed is a best-effort aid; cache approved audio for repeatable assets |
| Lip synchronization | Character timing can support captions; phoneme or viseme animation needs an additional process |
| Game effects | Use dedicated sound assets for required footsteps, impacts, alarms, and other gameplay cues |

The protocol settings discrepancy is detailed in the [API reference](API_REFERENCE.md). Audio tags are prompts rather than a closed, deterministic command language. [Audio tag help](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4), [Timing guidance](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses).

## Languages

The model catalog reviewed for this pack lists the following languages. This is a catalog snapshot, not a claim that every voice has equal quality in every language. Test actual character lines, proper nouns, and mixed-language turns. [Model language catalog](https://elevenlabs.io/docs/overview/models).

| Languages A–G | Languages G–M | Languages M–S | Languages S–Z |
| --- | --- | --- | --- |
| Afrikaans | Gujarati | Māori | Slovak |
| Amharic | Hausa | Marathi | Slovenian |
| Arabic | Hebrew | Mongolian | Somali |
| Armenian | Hindi | Nepali | Sorani Kurdish |
| Assamese | Hungarian | Norwegian Bokmål | Spanish (Latin America) |
| Asturian | Icelandic | Occitan | Swahili |
| Azerbaijani | Indonesian | Odia | Swedish |
| Belarusian | Italian | Pashto | Tajik |
| Bengali | Japanese | Persian | Tamil |
| Bosnian | Javanese | Polish | Telugu |
| Bulgarian | Kamba | Portuguese (Brazil) | Thai |
| Burmese | Kannada | Punjabi | Turkish |
| Cantonese | Kazakh | Romanian | Ukrainian |
| Catalan | Korean | Russian | Urdu |
| Cebuano | Kyrgyz | Serbian | Uzbek |
| Croatian | Lao | Shona | Vietnamese |
| Czech | Latvian | Sindhi | Welsh |
| Danish | Lingala |  | Wolof |
| Dutch | Lithuanian |  | Zulu |
| English | Luganda |  |  |
| Estonian | Luxembourgish |  |  |
| Filipino | Macedonian |  |  |
| Finnish | Malay |  |  |
| French | Malayalam |  |  |
| Fula / Pulaar | Maltese |  |  |
| Galician | Mandarin Chinese |  |  |
| Georgian |  |  |  |
| German |  |  |  |
| Greek |  |  |  |

Catalog language codes can be ISO 639-3, whereas the request `language_code` uses ISO 639-1 where supported, such as `en`, `es`, or `ru`. Do not send a catalog display code without checking the endpoint. An explicit language can improve disambiguation in short phrases; an unsupported code may be ignored. [Language and accent guidance](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-i-select-the-language-and-accent).

## Accent and voice migration

In v4, generating the reference language retains its accent. Generating another language aims for a natural target-language accent. Migration can therefore change a character's multilingual identity. Source recording noise, cadence, and loudness can also become more apparent in a more faithful clone. Audition both ordinary lines and emotional extremes before replacing an existing voice. [v4 accent and cloning notes](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4).

Store a voice manifest with the model ID, voice ID, language, recording or design provenance, approved test lines, and review date. This makes an unexpected performance change easier to diagnose. A model identifier alone is not a permanent guarantee of identical output; the provider describes v4 as evolving after launch.

## When to use each workflow

Use Turbo for live questions, greetings that depend on player state, conversational hints, and short reactive remarks. Use regular v4 HTTP generation for authored scenes and assets that can be reviewed before release. Cache frequently repeated approved lines such as opening greetings, but key them by voice, model, language, text, and settings so that a character never receives another character's audio.

For critical quest facts, let game logic produce or validate the statement before synthesis. For rapid interaction, ask the dialogue generator for one useful sentence before a longer explanation. For overlapping characters, maintain separate voices and playback ownership in the application; a synthesis endpoint does not decide who should be audible in the scene.

## Common questions

**Can the model answer the player directly?** It can speak text supplied by the application. Add transcription and NPC reasoning for open-ended conversation.

**Do I need a voice clone?** No. Choose an available library voice or a designed voice. Cloning is useful when the project requires a specific authorized vocal identity.

**Can an emotion tag guarantee the same performance every time?** No. Keep representative auditions and reuse approved audio where exact delivery matters.

**Can I use the standard TTS WebSocket example?** The v4 family uses the TTD protocol documented in this pack. Its input envelope is `inputs`, not the older TTS `text` message. [Protocol comparison](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets).

**Does a short reply always start immediately?** Buffered text may require `flush`; the server does not necessarily generate from every individual token. See the API reference.

**Can I assume a particular tier or optional setting works?** Query the account, run a smoke test, and consult the compatibility table. The examples deliberately use the smallest documented v4 Turbo configuration.
