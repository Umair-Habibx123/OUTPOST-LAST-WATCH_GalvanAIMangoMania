# Outpost: Last Watch

A web-based **wave-survival defense game** built for **GalvanAI · Mango Mania · Innovista (Aug 13)**.

You hold a lone border watchtower overnight while raiders — and later beast-creatures — converge from every direction. Aim and fire to stop them before they breach the wall. **Wall Integrity carries between waves and never fully heals**, so damage compounds; waves escalate in count, speed, direction and difficulty, with a harder **Raid** surge every 5th wave. Survive as long as you can; your score feeds a shared **leaderboard (The Watch Roll)** that resets each event day.

**Mango element:** a **mango supply cart** crosses the field and is the only in-run repair — mango = lifeline, not set-dressing.

---

## Tech stack

Full-stack, no build step for the client:

- **Client** — vanilla JS + HTML Canvas in `public/` (`public/src/*.js`), plus illustrated art in `public/assets/`.
- **Server** — Node **Express** (`server.js`, `server/*.js`) serving `public/` + a REST API, with **Socket.IO** for realtime 2-player rooms.
- **Database** — **Neon Postgres** (`@neondatabase/serverless`). Schema in `database/schema.sql`, applied by `database/setup.js`.

## Run it

```bash
npm install
# create .env with your Neon connection string:
#   DATABASE_URL=postgres://...
#   (optional) PORT=3000, ADMIN_SECRET=..., WS_GRACE_MS=20000
npm run db:setup     # create/upgrade tables (idempotent)
npm start            # or: npm run dev  (node --watch)
```

Then open **http://localhost:3000**.

> ⚠️ Always run through the server URL. Opening `public/index.html` directly (`file://`) has no backend, so leaderboard / profile / economy / multiplayer won't work.

## Core gameplay

- **Aim & fire** — mouse aims; **left-click or Space** fires. Strike raiders before they reach the wall.
- **Combo streak** (×5) for rapid clean kills; **Signal Volley** (Q) shockwave when charged.
- **Escalating waves** from all directions; **Raid** surge every 5th wave; beast-creature raiders mix in from wave 3.
- **Three battlefields** (Dust Frontier / Burnt Orchard / Frostwatch Ridge) with distinct colour-grade + a signature hazard each.

## Economy & progression (server-authoritative)

All coins/unlocks/ammo/upgrades live in **Neon**, keyed by a per-device id. The browser stores **only** that id — editing anything client-side grants nothing. Purchases and run rewards are validated + capped in `server/economy.js`.

- **Coins** earned per kill / perfect wave / mango cart; leftover banks to a persistent **stash**.
- **Player level** (XP across runs) raises ammo caps, item limits, and item power.
- **Weapons** — start with the infinite **Sidearm**; buy others as one-time unlocks, then buy **limited ammo** per gun (consumed per run), and **upgrade each weapon's level (×5)** for more impact:
  - Repeater (rapid), Scattergun (spread), Siege Cannon (splash), **Mortar (wipes its whole blast radius)**, Tesla Coil (chain).
  - Each weapon has a distinct **muzzle + impact** (pistol tick → mortar BOOM).
- **Field Kit** consumables (used in-run, keys Z X C V): Supply Line (repair), Backup Team, War Beast, Dragon Strike — each an **on-screen ally with its own health meter** that fights raiders near the wall.
- **Permanent upgrades** (Armory): Warden Armour, Rapid Reload, Field Kit, Wall Mender, Coin Runners, War Chest.

## Controls & accessibility (Settings)

Device mouse/keyboard is always active as the fallback. Selectable **control modes**: Device, **AI aim-assist**, **Hand gesture** (webcam), **Face + blink** (webcam), **Voice** (mic). Also: sound, reticle style, screen-shake, and **Player-2 backup** (if the phone controller drops mid-match, the host drives P2 via AI auto-defend / keyboard).

## Multiplayer (Shared Watch)

Create a room → a **QR code / room code** lets a second player join **on their phone as a controller** (Play Together or Play Against). Realtime via Socket.IO with a **persistent client id + 20s reconnect grace**, so a refresh rejoins the same seat instead of dropping.

## Leaderboard

`The Watch Roll` — per-event-day top scores from Neon (`/api/leaderboard`). Host reset via `DELETE /api/admin/leaderboard` with the `x-admin-secret` header.

## Project layout

```
server.js                 Express + Socket.IO entry
server/                   database.js · rooms.js · socket.js · validation.js · economy.js
database/                 schema.sql · setup.js
public/index.html         markup: canvas, HUD, all screens
public/styles*.css        base · responsive · ui-assets (asset-driven skin)
public/src/               config, utils, assets, audio, device, leaderboard, multiplayer,
                          entities, waves, render, game, arsenal, maps, settings,
                          backup-controls, controls-ai, controller, main
public/assets/            art/characters · art/maps · art/ui · art/icons · branding
```

## Deploy

Any Node host that supports WebSockets (Render, Railway, Fly, a VPS, etc.) with `DATABASE_URL` set. Run `npm run db:setup` once, then `npm start`. Set `PUBLIC_URL`/`ALLOWED_ORIGIN` to the deployed origin so the multiplayer join-QR points at it.

## Poster (event day)

Key art + logos live in `public/assets/branding/` and `public/assets/`. Still to add: participant photo + a QR to your LinkedIn.
