"""Save one v4 Turbo utterance as incoming audio chunks arrive.

Requires Python 3.11+, websockets >=14,<16, and python-dotenv.
This is a server-side, billable API example; it does not play audio live.
"""

import argparse
import asyncio
import base64
import json
import os
import time
import wave
from pathlib import Path
from urllib.parse import urlencode

from dotenv import load_dotenv
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException


MODEL_ID = "eleven_v4_turbo"


async def generate(args):
    load_dotenv(Path(__file__).with_name(".env"))
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "")
    if not api_key or not voice_id or api_key.startswith("replace_") or voice_id.startswith("replace_"):
        raise RuntimeError("Configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID first.")
    if not args.text.strip():
        raise RuntimeError("Speech text must not be empty.")

    query = {"model_id": MODEL_ID, "output_format": args.format}
    if args.language:
        query["language_code"] = args.language
    uri = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?" + urlencode(query)
    output = Path(args.output or ("output/dialogue.wav" if args.format == "pcm_24000" else "output/dialogue.mp3"))
    output.parent.mkdir(parents=True, exist_ok=True)

    bytes_received = 0
    first_audio_ms = None
    final_received = False
    # A failed request can leave a partial file; only a successful final event
    # establishes complete output. The WAV context finalizes its container.
    sink = wave.open(str(output), "wb") if args.format == "pcm_24000" else output.open("wb")
    try:
        if args.format == "pcm_24000":
            sink.setnchannels(1)
            sink.setsampwidth(2)
            sink.setframerate(24000)
        async with asyncio.timeout(args.timeout):
            async with connect(
                uri,
                additional_headers={"xi-api-key": api_key},
                open_timeout=10,
                max_size=4 * 1024 * 1024,
            ) as socket:
                await socket.send(json.dumps({"voices": [voice_id]}))
                text_sent_at = time.perf_counter()
                await socket.send(json.dumps({
                    "inputs": [{"text": args.text, "voice_id": voice_id, "new_turn": False}]
                }))
                # Closing flush is intentional for this one-shot example.
                await socket.send(json.dumps({"close_socket": True}))
                async for frame in socket:
                    message = json.loads(frame)
                    if message.get("error"):
                        raise RuntimeError(f"Provider error: {message['error']} (code {message.get('code')})")
                    if message.get("audio"):
                        chunk = base64.b64decode(message["audio"], validate=True)
                        if chunk:
                            if first_audio_ms is None:
                                first_audio_ms = (time.perf_counter() - text_sent_at) * 1000
                            if args.format == "pcm_24000":
                                sink.writeframesraw(chunk)
                            else:
                                sink.write(chunk)
                            bytes_received += len(chunk)
                    if message.get("is_final"):
                        final_received = True
                        break
    finally:
        sink.close()

    if not final_received or not bytes_received:
        raise RuntimeError("Connection ended without complete, nonempty audio; output may be partial.")
    if args.format == "pcm_24000" and bytes_received % 2:
        raise RuntimeError("PCM output ended with an incomplete 16-bit sample.")
    print(json.dumps({
        "model_id": MODEL_ID,
        "output_format": args.format,
        "output": str(output.resolve()),
        "audio_bytes": bytes_received,
        "tts_first_chunk_ms": round(first_audio_ms, 1),
        "metric_scope": "text submission to first received audio; excludes connection setup and playback",
    }, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True)
    parser.add_argument("--format", choices=["pcm_24000", "mp3_44100_128"], default="pcm_24000")
    parser.add_argument("--output")
    parser.add_argument("--language", help="Optional supported ISO 639-1 language code")
    parser.add_argument("--timeout", type=float, default=45)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    try:
        asyncio.run(generate(args))
    except TimeoutError:
        parser.exit(1, "Generation timed out; output may be partial.\n")
    except (RuntimeError, ValueError, OSError, WebSocketException) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
