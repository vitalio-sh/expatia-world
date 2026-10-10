# Bilingual arrival release — 2026-10-10

Published Site version 15 to https://expatia.world/ from source commit `2fc9d67ab88224f215c0aacf32258fee924b4b3c`.
Deployment `appgdep_6aca34a481f08191bfb6f7227c7fb6bf` succeeded at 12:51:04 UTC; production health confirms `2026-10-10-bilingual-arrival`.

- 109 automated tests passed; TypeScript and production build passed.
- Both Spanish and English generated audio transcribed exactly on the same default-Spanish production connection; finalization 509 ms and 494 ms. See `bilingual-stt-production-live.json`. These are synthetic audio probes, not a human microphone/accent test.
- Actual JEV probes selected west for Spanish and English left commands while facing south; all four headings covered by regression tests.
- Provider errors, nested error frames, and service diagnostics are rejected before transcription/caption/history callbacks. UI shows safe connection notices outside the dialogue.
- Local desktop and 390×844 mobile browser delivery completed using the large animated Collect your parcel button.
- Production browser accepted an English instruction, replied in Spanish, showed the arrival CTA, and completed with Parcel received after click. Demo mode remained enabled and its script made room for the collection CTA.
- Screenshots: `arrival-cta-desktop.png`, `arrival-cta-mobile.png`, `arrival-cta-production.png`.
