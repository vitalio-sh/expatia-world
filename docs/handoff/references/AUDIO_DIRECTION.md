# Pip / Meridian — audio direction and integration

Implemented 10 October 2026. All 26 assets are real generated MP3s in `public/audio`; no runtime provider dependency for the authored soundscape. Audition every asset through the Content Studio audio library.

## Creative direction

Pip is a natural speaking person inhabiting a maintenance robot: a little worn out, intelligent, patient, with dry original humor. No vocoder, metallic voice filter, synthetic syllable chops, or imitation of an actor/fictional performance. His complaint targets absurd bureaucracy and the ship, never the player. He helps clearly before making a joke. He does not know private puzzle rules or the truth of the Quiet Shift.

Chosen library voice: **George — Warm, Captivating Storyteller**, `JBFqnCBsd6RMkjVDRZzb`, British male. This choice is based on the available voice descriptions and intended character; it is a first audition candidate, not a claim that multiple voices were blind listening tested. Alternatives in the actual account library: Roger (casual American), Daniel (formal British), Callum (gravelly character voice). George best matches understated warmth without announcing villainy.

16 lines cover first contact, readiness, first door, room completion, blocked movement, retry, carrying, robot weight, remembered sequence, preserving a path, ticket forty-two, waiting, listening, success, the identifier clue, and mission reflection. All scripts are original. “Forty-two” is a maintenance ticket, not a puzzle solution. The identifier and mission lines are reserved narrative beats: never fire the mystery revelation as a random quip.

The ship sounds inhabited by aging systems rather than a generic space battle. There are eight close foley/confirmation effects, a ventilation/transformer bed, and a restrained instrumental analog synth piece. Music has no lyrics and is subordinate to speech. Both beds use a two-second cyclic crossfade. No new gameplay information depends on hearing.

## Models and prompting (verified)

The official docs and live `GET /v1/models` both expose **`eleven_v4`** and **`eleven_v4_turbo`**. Authored lines use V4; dynamic responses use V4 Turbo. This is not a guessed “B4” alias. [Model catalog](https://elevenlabs.io/docs/overview/models).

Use square-bracket performance directions near the intended phrase; punctuation helps phrasing. V4 does not use SSML break tags. We use sparse directions such as `[sighs]`, `[gently]`, `[dryly]` and `[softly]`; delivery instructions are suggestions, not deterministic controls. The actual scripts are saved in `scripts/audio/generate.mjs` and the public manifest. A neutral `.5` stability, `.75` similarity and `.91` speed were used for authored lines. Dynamic text gets server-owned `[gently]` with `.93` speed, and caller-provided tags are stripped. [Official prompting guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [V4 audio tags](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4).

Effects use `eleven_text_to_sound_v2`, explicit durations, and `loop:true` for ship air. Music uses `music_v2`, `force_instrumental:true`, and a bounded 60-second request. [SFX endpoint](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [music endpoint](https://elevenlabs.io/docs/api-reference/music/compose), [speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

## Client contract

Import from `src/client/sound.ts`:

- `setSoundEnabled(on)`: activate inside a real click/tap. Sound remains opt-in and every channel is silent while disabled.
- `configureAudio({master,music,sfx,voice})`, `getAudioLevels()`: independent 0–1 levels, retained in localStorage. Ambience shares the music bus.
- `beginAudioScene(roomId)`: stop previous room speech, footsteps and effects; pending results cannot play across the boundary. Beds continue.
- `setMicrophoneActive(bool)`: immediately cancel voice and heavily duck beds/effects while recording.
- `setWalking(bool)`: quiet footfalls every 440ms while actual movement occurs.
- `play(cue)`: compatible with the existing cue union; uses actual files.
- `speakLine(id)`: play an authored line; IDs are listed by the voice entries of the manifest.
- `speakText(text)`: request dynamic speech; cancellable and epoch checked. If generation fails, play the short authored retry line. Always retain the visible reply as the authoritative accessible text.
- `stopSpeech()`: abort current client request and stop the voice immediately.

Voice ducks music to 20%; mic recording ducks music to 4% and SFX to 8%. Hidden tabs suspend the context. Effects never block physics. The mixer drops a late response rather than playing it over a new scene. All game animation/event decisions remain deterministic; this module changes sound only.

Do not trigger voice every frame or every picked-up box. Prefer first contact, a completed instruction, authored milestones, and optional contextual responses. Let important subtitles persist for the clip duration. One voice plays at once.

## Dynamic speech API and spend controls

`POST /api/speech` accepts `{ "text": "A brief Pip line." }`, returns `audio/mpeg`. Secrets stay server side. Only the official ElevenLabs hostname is called. `ELEVENLABS_API_KEY` is required; optional `ELEVENLABS_VOICE_ID` and `ELEVENLABS_SPEECH_MODEL=eleven_v4` override the default library voice / Turbo model.

Runtime safeguards: same-origin check, 2KB streamed request limit, 240 normalized characters, stripped tags, eight requests/IP/minute, 12-second provider timeout, in-flight duplicate coalescing, 30-minute memory cache bounded to 12MB, and 100 new provider attempts per warm process (including provider/network errors). Cache keys include voice, model and normalized text. Dialogue cache is volatile and is not written to disk or logs. The provider may retain TTS text under its account settings; zero-retention was not requested because the documented option requires enterprise entitlement.

These are **per-process** controls, not a distributed billing cap. Set an account/provider spend cap before wide public deployment; restarting or scaling the server resets memory limits. A client abort stops playback and response consumption; an already accepted provider request may still be charged. Audio failure never fails a game action.

## Generation and cost ledger

Run `node --env-file=.env.local scripts/audio/generate.mjs` from the game directory. Existing files are skipped; there are no automatic paid retries. The script is an explicitly bounded authored batch, not a crawler. Keep the ledger when re-running. Replacing an existing file deliberately requires moving/removing that asset first.

`AUDIO_GENERATION_LEDGER.json` contains 26 successful calls and provider request IDs, models, input lengths/durations, timestamps and the raw `character-cost` response values. Total: **1,158 voice input characters, 34.5 generated SFX/ambience seconds, 60 generated music seconds**. Provider-reported character-cost values total **471**; these are not USD and must not be described as a dollar bill.

The key lacks `user_read`, so subscription/billing read returned `missing_permissions`. Actual charged USD is **unverified**. An illustrative estimate using the public generic $0.08/1,000-character speech rate, $0.12/minute effects and $0.15/minute music is **about $0.31 before taxes**, not an invoice and not a verified V4 promotional/account rate. This is far below the lane's authorized $40 budget. No attempt was made to spend the remaining budget unnecessarily. [Public pricing](https://elevenlabs.io/pricing/api).

## Verification and remaining audition

- 26/26 MP3 files decode successfully in FFmpeg; durations and manifest paths verified.
- Voice clips: 3.2–6.8 seconds, measured peaks −3.4 to −2.2 dBFS after mastering. No sample clipping.
- Effects: 0.48–2 seconds; air originally 24 seconds, music originally 60 seconds. Cyclic preparation shortens each loop by two seconds.
- Music measured mean −26.5 dBFS; air −29.4 dBFS before cyclic preparation. Voice is intentionally foregrounded.
- 14 tests cover input bounds, markup stripping, cache reuse, concurrent deduplication, provider failure, budget limits, autoplay opt-in, room cancellation, microphone cancellation, channel level clamping, muted-channel cost suppression, hidden-tab suppression and delayed-response dropping.
- TypeScript passes for this lane.

Technical checks establish playable files and safe state transitions. They do not substitute for a human listening review of tone, loop join and the final mix on laptop speakers/headphones. The Studio labels these first takes for audition; do not claim subjective voice approval until that listening review happens.
