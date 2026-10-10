# Expatia World

A short English conversation game for everyday life abroad. The Barcelona courier scenario combines generated pixel art, limited NPC sight, actual JEV decisions, adaptive dialogue and streaming voice. Other scenarios are marked Coming soon.

Live at [expatia.world](https://expatia.world/) and [www.expatia.world](https://www.expatia.world/).

## Run

Node.js 22+ is supported. Install with `npm ci`. Keep provider values in ignored `.env.local`:

- `JEV_API_KEY`
- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`
- `EXPATIA_SESSION_SECRET` — a random server-only value of at least32 characters

`npm run dev` opens the portable Node backend on port3317. `npm run dev:worker` uses the production Cloudflare runtime on port3318. `npm test` runs focused state, perception, protocol and dialogue checks. `npm run build` typechecks and builds Worker and client into `dist/server` and `dist/client`. `npm run build:node` builds the Node SPA; run `NODE_ENV=production npm start` afterward.

Production uses Sites on Cloudflare, without Vercel. The tracked `.openai/hosting.json` contains the existing Site identity. Do not create another Site for updates. Configure secrets using the Sites environment-variable tools, then use the official source workflow to push the exact build, save a version and deploy it. Never place secrets in Vite client variables.

## Behavior and limits

Answer starts the authoritative60-second clock once. The resident stays in their apartment. The player speaks or types directions to guide the courier to the entrance, then explicitly accepts the parcel. A missed handoff can result in a physically completed collection drop at an observed suitable open shop. Opening hours are authored; Barcelona weather uses current model/forecast data from Open-Meteo, with MET Norway as a fallback. The interface gives the source, forecast validity and retrieval time, plus attribution. Stale/offline results remain explicit. Barcelona time uses Europe/Madrid.

The Worker keeps a round on its owning WebSocket connection. Disconnecting ends that connection; start another call. It does not silently resume or restart the clock. No identity, permanent session storage or user-history database is required for this demo. Per-round provider usage is visible through the decision inspector; it is not a billing invoice.

## Evidence

- [Progress](docs/PLAN.md) and [implementation contracts](docs/CONTRACTS.md)
- [QA](docs/qa/) and [provider/development accounting](docs/usage/)
- [Art review and provenance](docs/ART_REVIEW.md), [runtime manifest](public/art/manifest.json), and `/art/review.html`
- [Eleven v4 Turbo documentation](docs/eleven-v4-turbo/README.md)

`plan.jpg` is the supplied layout reference. Generated originals and raw keyed frames are preserved locally in ignored `art-work/`; deployable sprites are tracked under `public/art/`.
