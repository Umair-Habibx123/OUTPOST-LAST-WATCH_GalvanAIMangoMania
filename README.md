# Outpost: Last Watch

A web-based wave-defense arcade game built for **GalvanAI · Mango Mania · Innovista (Aug 13)**.

You're a lone guard holding a border watchtower overnight. Bandits converge from
every direction across open dark terrain. Aim and strike them down before they
reach the wall — every raider that gets through chips the wall's **Integrity**,
and that damage **carries between waves and never fully heals**. Waves escalate
in count, speed, and number of directions, with a harder **Raid** surge every 5th
wave. Survive as long as you can; clean (no-damage) waves grant a small repair and
a bonus. Score feeds a **leaderboard** that can be reset per event day.

**Mango element:** a **mango supply cart** 🥭 crosses the field now and then —
strike it to grab a repair. It's the *only* thing that mends the wall, so the
mango is your lifeline, not set dressing.

Two skill layers reward good play:

- **Combo streak** — rapid clean kills raise a points multiplier (up to ×5). A
  miss, or letting a raider reach the wall, breaks it.
- **Signal Volley** — kills charge a meter; when full, press **Q** (or tap the
  button) to fire a shockwave that clears every raider near the tower.

---

## Run it locally

It's plain HTML/CSS/JS — no build step, no dependencies. Any static server works:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. (Opening `index.html` directly via `file://`
also works because scripts are loaded as classic scripts, not ES modules.)

## Deploy to itch.io

1. Zip the project so `index.html` sits at the **root of the zip** (not inside a
   subfolder):
   ```
   index.html
   styles.css
   src/...
   ```
2. On itch.io: create a new project → **Kind of project: HTML** → upload the zip →
   tick **"This file will be played in the browser"**.
3. Set the embed/viewport size to **960 × 600** and enable **Fullscreen button**.
4. Mobile players can play directly (touch = aim + tap to strike).

Any static host works too (GitHub Pages, Netlify, Vercel) — just serve the folder.

---

## Tuning for event day

All balance lives in [`src/config.js`](src/config.js) (`OLW.CONFIG`). Common knobs:

| Setting | Meaning |
| --- | --- |
| `INTEGRITY_START` / `INTEGRITY_MAX` | Wall health |
| `PERFECT_WAVE_REPAIR` / `MANGO_REPAIR` | How much the wall can mend (kept small on purpose) |
| `RAID_EVERY` | Every Nth wave is a harder surge |
| `MANGO_CHANCE` | Per-wave chance a supply cart appears |
| `STRIKE_COOLDOWN` | Seconds between strikes (caps your effective DPS) |
| `AIM_ASSIST_RADIUS` | Forgiveness on aim (bigger = easier, touch-friendly) |

Wave escalation (counts, speed, directions, enemy mix) lives in
[`src/waves.js`](src/waves.js) → `plan(wave)`.

**Setting the "beat this to win a mango" target:** playtest with your own team
first — a focused ~2-minute run currently lands in the **~3,000–4,000** range and a
strong run pushes past **6,000**. Pick a target your booth staff can consistently
hit but that takes real attention, then post it at the kiosk.

## Leaderboard

Ships with a **localStorage** provider (see [`src/leaderboard.js`](src/leaderboard.js))
so it works offline with zero backend — perfect for a **single-kiosk** setup where
everyone plays on the same machine.

- Reset between event sessions with the **"Reset (event host)"** button on the
  Leaderboard screen.
- For **cross-device** scoring (attendees on their own phones), the provider API
  (`submit` / `top` / `clear`) is intentionally tiny — drop in a remote provider
  on event day via `OLW.Leaderboard.setProvider(...)`. A ~30-line serverless
  endpoint or a Supabase table is enough. Ask and I'll wire one up.

---

## Project structure

```
index.html          markup: canvas, HUD, and all screens
styles.css          cohesive dusty desert-night UI theme
src/config.js       tuning + color palette
src/utils.js        math/helpers
src/audio.js        procedural WebAudio SFX (no audio files)
src/leaderboard.js  score store (local, pluggable)
src/entities.js     raiders, mango cart, particles/floaters
src/waves.js        wave director + escalation
src/render.js       ground, outpost/watchfire, reticle, vignette
src/game.js         state machine, loop, collisions, scoring
src/main.js         DOM wiring, input, screen flow
```

## Controls

- **Mouse / touch:** move to aim, click / tap to strike.
- **Space:** strike at current aim.
- **Q** (or the on-screen button): fire the Signal Volley when charged.
- **P / Esc:** pause. On-screen buttons toggle **pause** and **sound**.

## Poster / key art

`assets/` holds the pieces for the event-day poster:

- `outpost-title-backdrop.png` — the game's key art / banner (also the title
  screen background), generated from the game's own renderer for a perfect
  style match.
- `Galvan AI logo transparent.png`, `InnoVista-rawal-logo.png` — official logos.

Still to add for the poster: participant photo(s) and a QR code linking to your
LinkedIn profile.

## Art & audio

Everything is drawn procedurally on canvas (no image assets) and all SFX are
generated at runtime — a deliberate choice for a cohesive, hand-built look and a
tiny download. Palette is a stark dusty desert-night: deep terrain, warm
watchfire amber, type-coded raider rim-light. No stock textures, gradients, or
generator dumps.
