# Zuryo web client

React + TypeScript single-page app for the three roles (customer, trainer, admin). It talks to the REST API in [`../api`](../api/README.md); endpoint reference in [`../docs/api.md`](../docs/api.md).

## Stack, and why

| Piece                     | Used for                                                                                                                          | Why this and not something bigger                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite + React + TypeScript | build and UI                                                                                                                      | static output, fast dev server, types catch API-shape mistakes                                                                                                                                                          |
| React Router              | routes per role, guarded by the signed-in role                                                                                    |                                                                                                                                                                                                                         |
| TanStack Query            | all server data: loading/error states, 30 s polling on booking, session and notification views, invalidation after every mutation | server state is cache plus refetching, not something to hand-write in a store                                                                                                                                           |
| Zustand                   | exactly two client-only things: auth (token + user) and the checkout draft (slot, mode, trainer, package, idempotency key)        | two small values; Redux Toolkit's slices and provider are built for much larger shared client state. Both are persisted to `sessionStorage` so a refresh keeps the signed-in user and a retried Pay reuses the same key |
| Tailwind CSS v4           | styling, tokens in `src/zuryo-theme.css` (copied from the approved mockups)                                                       |                                                                                                                                                                                                                         |
| zod                       | form validation (login, profile, session record, hours, time off, pricing)                                                        |                                                                                                                                                                                                                         |
| `@fontsource/manrope`     | self-hosted font, no request to Google                                                                                            |                                                                                                                                                                                                                         |

`src/api.ts` is the only place that calls `fetch`: base URL from `VITE_API_URL`, bearer header, the API's error shape turned into a typed `ApiError` (branch on `code`), a 15 s timeout (`NETWORK` error), and every response's `serverNow` recorded into a clock offset (`src/lib/clock.ts`). Every countdown uses `Date.now() + offset`, never the device clock alone.

## Setup

Needs Node 24 (`nvm use`).

```bash
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:4000
npm run dev                 # http://localhost:5173
```

Start the API first (see `../api/README.md`; its `CORS_ORIGINS` must include the client's origin). Demo accounts are listed on the login screen; every seeded password is `Demo@12345`.

| Variable       | Meaning                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `VITE_API_URL` | API origin, no trailing slash and no `/v1`. Baked into the bundle at build time. |

## Scripts

```bash
npm run dev         # dev server
npm run build       # type-check, then production bundle in dist/
npm run preview     # serve dist/ locally
npm run typecheck
npm test            # vitest: money formatting, Kolkata dates, clock offset, timer phase
```

## Deploy as a static site

`npm run build` produces `dist/`, plain files. Host it on any static host (Render static site, Netlify, Vercel, Cloudflare Pages).

- Build command: `npm ci && npm run build`. Publish directory: `dist`.
- Set `VITE_API_URL` to the deployed API origin before building.
- Single-page app: add a rewrite of every path to `/index.html` (Render: rewrite `/*` to `/index.html`), otherwise a refresh on `/bookings` is a 404.
- Add the site's origin to the API's `CORS_ORIGINS`.

## Where things are

```
src/api.ts            fetch wrapper, ApiError, clock offset
src/queries.ts        shared TanStack Query hooks
src/useQuote.ts       server price for the current choice
src/stores/           auth.ts, checkout.ts (the two Zustand stores)
src/lib/              pure helpers with tests: format, clock, timer; buzzer.ts (WebAudio), useNow.ts
src/components/       Layout (nav), ui (buttons, states, form bits), Price (breakdown, pay choice)
src/pages/            customer/, trainer/, admin/, Login
```

## Behaviour worth knowing

- **Price is never computed on the device.** Book and Checkout show the `/quote` response; the booking request carries only the slot, preferred trainer and package choice.
- **Idempotency.** The draft holds one `Idempotency-Key`. It is reused for every retry of the same Pay (also after a refresh), replaced after a successful booking and whenever the slot, mode, trainer or package changes. `422 IDEMPOTENCY_KEY_REUSED` starts a fresh attempt and tells the customer nothing was charged; a network timeout keeps the key so retrying cannot double charge.
- **No trainer free** (`409 NO_TRAINER_AVAILABLE`): the API's alternative slots are shown as tappable times on the checkout screen.
- **Timers** count down to the server's `session.endsAt`. The trainer's buzzer sounds on the tick that crosses `warningAt` (55 min) and `endsAt` (60 min), so a page opened late never buzzes for the past. Browsers need one tap before they allow sound, so the Start button (or "Turn on buzzer sound" after a refresh) unlocks audio.
- **Roles.** The route guard only decides which screens to show; the API checks the role and ownership on every call.

## Limits of this client

- Lists load the newest 100 items; there is no "load more".
- Trainer photos are not available from the API, so avatars are initials. The home hero is a hotlinked stock photo.
