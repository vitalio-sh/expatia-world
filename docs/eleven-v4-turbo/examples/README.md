# Streaming examples

These original examples use the minimal documented v4 Turbo TTD protocol. They save incoming audio incrementally and report the time from submitting text to receiving the first audio bytes. That metric excludes connection establishment and is not the player's complete response latency.

No credentials are included. Running either client sends a billable generation request to ElevenLabs. The scripts are examples rather than an implemented Expatia World backend.

## Configuration

Copy `.env.example` to `.env` in this directory and set an account-accessible voice ID and a restricted API key. Both clients load that file through the runtime commands below. Do not commit `.env`.

```dotenv
ELEVENLABS_API_KEY=replace_with_your_server_api_key
ELEVENLABS_VOICE_ID=replace_with_your_available_voice_id
```

For a deployed application, load these values from server-side environment variables or a secret store. A browser must not receive this file or the permanent key.

## Python client

Requires Python 3.11 or later and the modern `websockets` package with `websockets.asyncio.client` and `additional_headers`. This example selects a bounded 14–15 library version range rather than relying on an untested future major version. The relevant client API was checked against the [official 14.0 reference](https://github.com/python-websockets/websockets/blob/14.0/docs/reference/asyncio/client.md). Use an isolated environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install 'websockets>=14,<16' python-dotenv
python stream_dialogue.py --text '[curious] What brings you to the harbor?'
```

The default output is `output/dialogue.wav`, built from `pcm_24000`. To request the guide's MP3 format:

```bash
python stream_dialogue.py --format mp3_44100_128 --output output/dialogue.mp3 --text '[warm] Welcome back. The ferry is ready.'
```

The client intentionally sends `close_socket:true` after its one utterance so the provider flushes the remainder and ends the connection. For a persistent NPC socket, use `flush:true` after the phrase and implement heartbeat, turn boundaries, and cancellation ownership separately.

## Node.js client

Requires a modern Node.js runtime supporting `--env-file` and ES modules, and the `ws` package. Install dependencies in this examples directory:

```bash
npm install --no-save --package-lock=false ws
node --env-file=.env stream-dialogue.mjs '[curious] What brings you to the harbor?'
```

It writes `output/dialogue.mp3`. Optional environment variables:

```dotenv
ELEVENLABS_OUTPUT_FILE=output/my-dialogue.mp3
ELEVENLABS_LANGUAGE_CODE=en
```

The Node example fixes `mp3_44100_128` so that its output file and stream format agree. It saves received chunks directly and does not provide browser playback. The `ws` dependency and runtime compatibility should be checked in the target environment before integrating it into the project.

## Browser PCM player

`pcm-player.mjs` is an independent playback helper. Import it in a browser app, create it during a user gesture, and feed it the **application relay** audio messages described in the architecture document:

```javascript
import { PcmPlayer } from './pcm-player.mjs';

const player = new PcmPlayer({ sampleRate: 24000 });
await player.resume(); // Run from a click, tap, or another allowed user gesture.
player.beginTurn(12);

// In your authenticated application relay's message handler:
player.enqueueBase64(message.audio, message.turn_id);

// On interruption or replacement:
player.beginTurn(13); // Stops turn 12 and rejects any late turn 12 audio.
```

Match the relay's exact format to the player source rate. The helper handles little-endian PCM, incomplete sample boundaries, sequential scheduling, and local cancellation. It does not implement microphone capture, auth, provider sockets, transcription, dialogue generation, or game actions.

For production, add queue limits, underrun telemetry, an appropriate audio worklet or decoder, and device lifecycle handling. Do not use this PCM helper on MP3, Opus, WAV containers, or a different sample encoding.

## Validation and smoke test

The examples were checked locally for syntax. No live generation has been performed as part of creating this documentation.

With your configured account, check:

1. The selected voice is available and the key has Text to Speech permission.
2. A normal line produces nonempty audible output.
3. A very short line such as `Yes.` is returned after the closing flush.
4. The saved file sounds correct at its specified sample rate.
5. The reported first-chunk timing is recorded separately from complete file duration.
6. A failed request produces an error and releases the connection.

For an actual realtime game, listen while audio arrives through the browser queue. Playing these scripts' saved files only after they finish does not demonstrate streaming onset.

Sources: [TTD realtime guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd), [Audio streaming](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming), [API security](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/security).
