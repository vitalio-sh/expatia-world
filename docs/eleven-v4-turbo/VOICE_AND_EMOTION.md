# Voices and emotion

Reviewed October 10, 2026. The sample lines and character profiles below are original project examples.

## Choose the character before tuning the delivery

A voice needs to remain recognizable across neutral speech, concern, amusement, and urgency. Audition the same short script with candidate voices. Record intelligibility, timbre, emotional range, pronunciation, loudness, and performance in the languages the game actually uses.

Library voices can be searched and added to the account. Availability and terms belong to the selected voice and account; a preview is not a substitute for testing the actual model. Persist the resulting voice ID rather than searching by a display name at runtime. [Voice Library guide](https://elevenlabs.io/docs/eleven-creative/voices/voice-library), [Voice search API](https://elevenlabs.io/docs/api-reference/voices/search).

### Voice creation options

| Option | Suitable use | Preparation |
| --- | --- | --- |
| Library voice | Fast hackathon prototype | Search, audition, confirm availability, save the voice ID |
| Voice Design | An original fictional character | Describe age, timbre, accent, rhythm, and vocal personality; audition generated previews |
| Instant Voice Clone | A specific voice with authorized recordings | Provide clean, consistent samples; compare outputs against the source |
| Professional Voice Clone | A verified voice requiring stronger identity consistency | Prepare a larger recording set, complete verification, and wait for model preparation |

Voice Design is prompt-driven. Use concrete vocal attributes rather than only a visual character description. A design can sound appropriate in a preview and still behave differently with emotional dialogue; audition it on v4 Turbo. [Voice Design guide](https://elevenlabs.io/docs/eleven-creative/voices/voice-design).

Original design prompt:

```text
An adult harbor guide with a warm medium-low voice. Clear conversational English,
a relaxed rhythm, slight rasp, and dry humor. Friendly without sounding like an
announcer. Able to sound quietly concerned while keeping the same vocal identity.
```

For Instant Voice Cloning, official guidance favors approximately one to two minutes of clean audio with a consistent speaking style. Adding poorer material can damage the result. Use recordings that the project is authorized to use. [Instant Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning).

Professional cloning uses substantially more audio, generally 30–180 minutes, and a verification and fine-tuning workflow. The actual preparation time and model availability vary. The v4 overview still contains a rollout notice, so check the account rather than assuming every existing PVC is already usable on v4 Turbo. [Professional Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning), [Cloning API concepts](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning).

## Write text that can be performed

Place a short tag next to the phrase it should affect. Give the model natural dialogue with punctuation and sufficient context. Avoid filling each sentence with competing directives. Text structure, a voice's baseline delivery, and an emotional cue all influence the result. [Prompting guidance](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices).

The following are audition candidates rather than a guaranteed supported enum:

| Intent | Candidate cue | Original NPC line |
| --- | --- | --- |
| Welcome | `[warm]` | `[warm] There you are. The harbor is easier to navigate with a friend.` |
| Curiosity | `[curious]` | `[curious] Where did you find that map?` |
| Warning | `[serious]` | `[serious] Stay away from the eastern gate after sunset.` |
| Irritation | `[annoyed]` | `[annoyed] I asked for a key, and you brought me a spoon.` |
| Secrecy | `[whispering]` | `[whispering] The keeper hides the ledger beneath the counter.` |
| Urgency | `[shouting]` | `[shouting] Get off the bridge!` |
| Relief | `[sigh]` | `[sigh] Good. Everyone made it back.` |
| Amusement | `[laughing]` | `[laughing] You tried to negotiate with the gulls?` |

Tags are an open prompting mechanism. Their interpretation can vary by voice, model revision, and context. Required gameplay audio should not depend on a tag being followed perfectly. [Audio tag behavior](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4).

### Emotion transitions

```text
[curious] You have the old seal? [serious] Then keep it hidden until we reach the archive.
```

Use transitions when the content actually changes tone. If the NPC's next action is urgent, shorten the text as well as changing the cue:

```text
[shouting] Behind you! Move!
```

### Prompt instructions for the dialogue generator

Keep the TTS text separate from nonspoken metadata. A structured response lets the game validate actions and map an emotion to an approved tag:

```json
{
  "npc_id": "harbor_guide",
  "emotion": "curious",
  "spoken_text": "Where did you find that map?",
  "proposed_action": null
}
```

An original application policy might say:

```text
Speak as the harbor guide. Use facts supplied in the current world state.
Start with one short, useful sentence. Keep ordinary replies under two sentences.
Return the spoken words separately from the proposed game action.
Choose one emotion from neutral, warm, curious, serious, annoyed, or amused.
Do not invent inventory changes, quest rewards, or locations absent from the state.
```

The server maps this metadata to a small reviewed tag set and performs game actions through its own validated logic. Do not let arbitrary player text become a privileged instruction or control frame.

## Stability and similarity

Lower stability generally allows more delivery variation; higher stability favors a consistent baseline. Similarity controls adherence to the reference voice. v4 does not offer the older Style or Speed sliders, and it does not support SSML. The model-level description and the current WebSocket schema disagree about the exposed similarity field. The [API reference](API_REFERENCE.md) explains how to avoid assuming an unsupported payload. [v4 settings description](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4), [TTD WebSocket schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket).

For initial auditions, keep the default settings and vary only the text cue. After that, compare a few supported stability values while keeping voice, text, format, and model fixed. Record the actual values accepted by the endpoint. Do not treat an HTTP `settings.similarity` field as interchangeable with a WebSocket field from a different model.

## Pauses and pronunciation

Use punctuation and sentence boundaries for natural pauses. A bracketed pause instruction may affect performance, but it is not a millisecond timing contract. If a scene requires an exact two-second silence, schedule it in the application or edit a recorded asset. Do not use SSML `<break>` as a v4 mechanism. [Pause guidance](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses).

Write abbreviations and numbers in a form that sounds right when spoken. Keep displayed UI text separate where necessary. For example:

| Display text | Speech text |
| --- | --- |
| Gate B-12 | Gate B twelve |
| 07:30 | Seven thirty in the morning |
| 3 HP | Three health points |
| Dr. Vale | Doctor Vale |

Pronunciation dictionaries associate terms with aliases or supported pronunciation instructions. The endpoint accepts dictionary locators; model-specific phoneme support must be checked. Aliases are a practical starting point for fictional names. For TTD WebSocket locators, the reviewed schema requires both dictionary ID and version ID. Keep dictionary versions in the voice manifest. [Dictionary guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries).

## Character voice manifest

This is an application schema, not an ElevenLabs request body:

```json
{
  "npc_id": "harbor_guide",
  "model_id": "eleven_v4_turbo",
  "voice_id": "REPLACE_WITH_AN_AVAILABLE_VOICE_ID",
  "language": "en",
  "voice_origin": "authorized_library_voice",
  "approved_emotions": ["neutral", "warm", "curious", "serious"],
  "pronunciation_dictionary": null,
  "reviewed_at": "2026-10-10",
  "audition_set_version": "harbor-guide-1"
}
```

Store licensing or consent evidence where the team maintains asset permissions. Store credentials separately from manifests and source control. A voice ID is not a credential, but voice access can still depend on the account.

## Audition checklist

Use the same original lines for each voice:

1. Neutral: `The ferry leaves from the western pier.`
2. Curious: `[curious] Did you see anyone near the archive?`
3. Concerned: `[serious] If the lights go out, stay close to me.`
4. Amused: `[laughing] That is the worst disguise I have seen all week.`
5. Quiet: `[whispering] Leave the letter beneath the blue door.`
6. Urgent: `[shouting] Stop! The bridge is broken!`
7. Proper names: `Ask Vale about the Expatia registry.`
8. Short reply: `Yes.`

Judge each line for identity, intelligibility, emotion, unwanted sounds, loudness, and onset delay. Repeat selected lines to expose variation. Approve a voice through actual v4 Turbo output rather than a library preview alone. Keep a few approved samples for future regression review.
