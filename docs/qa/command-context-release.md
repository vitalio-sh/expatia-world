# Command and dialogue context release — 2026-10-10

Published Site version 16 from `131fca60913e70b3e6c6e5cfcb4ae42558fb9e79`; deployment `appgdep_6aca374f23448191b2265e2e0e16a8f6` succeeded at 13:02:24 UTC. Production health confirms `2026-10-10-command-context`.

- Before-fix production reproduction: interrupt greeting before its first caption, look south, then say Ve hacia el sur. The model selected look again instead of walking. Full history was present, but first-clue restrictions still applied and clear movement was allowed to become another question.
- After-fix actual production probe: look:south → walk:south → home:south → continue; courier physically moved and all four commands remained in history. No repeated entrance-side question after it was supplied. See interrupted-commands-production-after.json.
- Showing a phrase records it immediately; interruption preserves visible speech and already applied routes. Microphone controls are enabled while a courier reply is pending, with setup/transcription guarded separately.
- Demo prompts now offer a single short phrase (at most 11 words in the core cases), one action at a time. Walking cue explicitly says there is no need to speak.
- Local UI walkthrough used only Como se llama el bar / Mi portal esta en el lado sur and reached the collection CTA. Microphone remained enabled during the pending reply.
- 124 automated tests passed; TypeScript, diff check, and production build passed.
