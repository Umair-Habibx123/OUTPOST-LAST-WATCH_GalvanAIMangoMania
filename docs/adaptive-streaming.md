# Adaptive Bitrate Streaming over WebRTC

How the Full-HD host→phone screen mirror works in `public/src/stream.js`, why it is
built this way, and which parts transfer to other projects.

The short version: this is YouTube/DASH adaptive-bitrate logic — a closed control
loop of *measure → decide → switch → repeat* — running on top of WebRTC instead of
HTTP segments. Most of the ideas port directly. A few **do not**, and those are the
expensive ones to learn the hard way, so they are called out explicitly below.

---

## 1. The problem this solves

Two players share one screen: the desktop kiosk runs the game, the phone is Player 2's
controller and needs to *see* the battlefield.

The original implementation captured the canvas to a 640×360 WebP data-URL every 70ms
and pushed it through Socket.IO. That is a slideshow, not a stream:

| | WebP-over-Socket.IO | WebRTC ABR |
|---|---|---|
| Resolution | 640×360, fixed | up to 1920×1080, adaptive |
| Frame rate | ~14fps | up to 60fps |
| Compression | every frame standalone | inter-frame (only what *moved*) |
| Transport | TCP (head-of-line blocking) | UDP (a lost packet is skipped, not retried) |
| CPU | `toDataURL` blocks the main thread every frame | GPU encode, off the main thread |
| Congestion | none — it floods until it drowns | built-in congestion control |

The inter-frame point is the big one. A game frame usually differs from the previous
frame in a small region. A video codec sends *that difference*; a chain of WebP stills
re-sends the entire picture every time. Same visual result, an order of magnitude more
bytes.

---

## 2. The DASH concepts, and where they land in WebRTC

| DASH / YouTube | Here |
|---|---|
| Renditions (144p…4K) | `LADDER[]` — bitrate + resolution divisor + fps per rung |
| `.mpd` manifest | `LADDER` is compiled into both peers, so a switch is just an index |
| Requesting the next segment at a new bitrate | `sender.setParameters()` — no renegotiation, no new offer/answer |
| Segment download time (bytes ÷ seconds) | `inbound-rtp.bytesReceived` delta, EWMA-smoothed |
| Player buffer occupancy | `jitterBufferDelay / jitterBufferEmittedCount` — a real playout buffer, in ms |
| Rebuffering / stall | `inbound-rtp.freezeCount` |
| Client-side pull decision | the phone decides and asks the host for a rung |

**The thing worth internalising:** a rendition switch costs nothing. Same track, same
peer connection, same ICE candidates — you re-declare the encoding and the next frame
comes out at the new size. That is what makes second-by-second adaptation viable at all,
and it is the exact analogue of DASH just requesting a different segment URL.

```js
const params = sender.getParameters();
params.encodings[0].scaleResolutionDownBy = rung.scale;   // 1 = 1080p, 2 = 540p …
params.encodings[0].maxBitrate            = rung.bitrate;
params.encodings[0].maxFramerate          = rung.fps;
sender.setParameters(params);
```

---

## 3. ⚠️ The one place the DASH model breaks

This is the most important section in this document.

In DASH, a segment is a **fixed-size file**. Download time therefore measures link
capacity directly: a segment that should take 2 seconds arriving in 4 means you have
half the bandwidth you need. Clean signal.

**In live video, that inference is invalid.** The sender encodes what is actually on
screen. A still scene compresses to almost nothing. So low received bitrate has two
completely different causes that look identical from the receiver:

1. the network is congested — step down, urgently; or
2. nothing is happening on screen — everything is fine, do nothing.

Porting the rule literally means the quality drops every time the player stands still,
then climbs back when they move. The first version of this file had exactly that bug.

**The fix is to split authority by what each side can actually observe:**

- **Receiver owns quality of experience.** Freezes, packet loss, playout-buffer growth
  and decode drops are unambiguous — they mean the picture is *already* suffering. It
  steps down on those immediately, and it is the only side allowed to do so.
- **Host owns capacity.** `availableOutgoingBitrate` comes from the congestion
  controller *actively probing* the link, which is the only trustworthy headroom
  measurement available. The host publishes it as a ceiling (`stream:cap`) that the
  receiver may not exceed.

Throughput is still tracked, but only as **corroboration** for a step down — it must be
accompanied by a real symptom:

```js
const starved = thrEwma < cur.bitrate * DOWN_MARGIN &&
                (loss > 0.01 || bufMs > BUF_LOW_MS);   // never on its own
```

> **General principle:** before porting a metric between architectures, ask what it
> *physically measures* in each. "Bytes per second" means capacity when the payload size
> is fixed, and means scene complexity when the encoder chooses the size.

---

## 4. The control loop

One tick per second on the receiver. Priority order is the ABR priority order:
**never stall > keep framerate > maximise resolution.** A smooth 360p beats a frozen
1080p, every time.

```
1. PANIC      freeze | loss > 8% | buffer > 450ms   → drop TWO rungs, now
2. STEP DOWN  loss > 3% | buffer > 250ms |
              decode drops > 20% | corroborated starvation → drop ONE rung
3. STEP UP    4 consecutive clean ticks
              AND no downshift in the last 6 ticks
              AND below the host's published ceiling        → climb ONE rung
```

Asymmetry is deliberate and is the heart of ABR:

- **Down is fast and can skip rungs.** Recovering from a stall costs seconds of frozen
  picture; over-correcting costs some sharpness nobody notices.
- **Up is slow, single-rung, and gated by hysteresis.** Quality that oscillates is more
  irritating to watch than quality that is simply lower. That is what `UP_STABLE_TICKS`
  and the post-downshift cooldown exist for.

Throughput is smoothed with an EWMA (α = 0.35, ≈ a 5-sample memory) so one slow second
cannot move the picture — while the unsmoothed signals (freeze, loss, buffer) stay free
to fire instantly. **Smooth the noisy input; leave the emergency inputs raw.**

---

## 5. Gotchas that cost real debugging time

Each of these was hit while building this. They are not specific to this game.

### 5.1 The bitrate-starvation trap

WebRTC's bandwidth estimate **starts around 300kbps** and probes upward. Cap the ladder
to the instantaneous estimate and you pin yourself at 240p — and then, because you are
only sending 240p worth of data, the probe has nothing to ramp *with*, so the estimate
never rises. The stream deadlocks at its worst quality on a gigabit LAN.

Three defences, all needed:

- an 8-tick **warm-up** during which the estimate is ignored entirely;
- the ceiling may **rise instantly but fall only one rung per tick**;
- an SDP hint telling the encoder where to *begin* rather than crawling up from 300kbps:

```
b=AS:6500
a=fmtp:96 …;x-google-start-bitrate=2500;x-google-max-bitrate=6500;x-google-min-bitrate=300
```

Chromium-family hint; ignored elsewhere; worth roughly 30 seconds of soft picture at
the start of every session.

### 5.2 `addTransceiver` without `streams`

```js
pc.addTransceiver(track, { direction: 'sendonly', sendEncodings: [...] });   // ✗
```

The handshake completes, ICE connects, `connectionState` reads `connected` — and the
receiver's `ontrack` fires with an **empty** `e.streams`, so `srcObject = e.streams[0]`
silently assigns `undefined`. Everything looks healthy; no video. Pass `streams: [stream]`,
and defend on the receiving side too:

```js
const ms = (e.streams && e.streams[0]) || new MediaStream([e.track]);
```

### 5.3 Adaptive resolution needs a source that is actually that big

The ladder tops out at 1080p, but this game's canvas backing store was 960×540 — so the
top rung was upscaling, not detail. `RENDER_SCALE` supersamples the backing store to
1920×1080 while all game logic stays in 960×540 logical coordinates:

```js
cv.width  = C.WIDTH  * s;
cv.height = C.HEIGHT * s;
ctx.setTransform(s, 0, 0, s, 0, 0);   // logic never learns about this
```

Input mapping was unaffected because it already used `getBoundingClientRect()` (CSS
pixels) rather than the backing store. **Worth checking before you scale any canvas.**

### 5.4 Encoding competes with the thing you are encoding

The kiosk renders 1080p *and* encodes it. When `qualityLimitationReason === 'cpu'`
persists, the host sheds supersampling before the game itself starts stuttering — the
frame rate of the actual game outranks the fidelity of the mirror.

### 5.5 `canvas.captureStream` stops when the tab is not compositing

Backgrounded or hidden tab → no frames captured → the remote picture freezes while every
connection metric still reads healthy. The kiosk window must stay visible. This also
makes the feature awkward to verify in a headless browser (see below).

### 5.6 Codec order matters for battery and latency

Preference here is **H.264 → VP9 → VP8 → AV1**. H.264 has hardware encode on the desktop
and hardware decode on the phone, which is what makes 1080p60 affordable. VP9 compresses
better per bit but software-encoding it at 1080p60 will melt a CPU.

---

## 6. Signalling

The server is a **dumb relay** (`server/socket.js`) — it forwards `rtc:*` and `stream:*`
between the two peers in a room and never inspects media. Membership is checked; nothing
else is.

```
phone                     server                      kiosk
  │   rtc:request  ───────────────────────────────────▶ │
  │ ◀───────────────────────────────  rtc:offer  (SDP)  │
  │   rtc:answer   ───────────────────────────────────▶ │
  │  ◀────────────  rtc:ice  (both ways) ─────────────▶ │
  │                    ── connected ──                  │
  │   stream:quality (receiver's ABR verdict) ────────▶ │
  │ ◀──────────  stream:cap (host's uplink ceiling)     │
```

Only STUN is configured. Kiosk and phone on the same venue Wi-Fi connect directly. A
network that blocks peer-to-peer entirely would need a TURN relay — that is the main
thing to add if this is ever deployed somewhere hostile.

The old WebP path still exists deliberately: it is the bootstrap picture while WebRTC
handshakes, and the fallback if it never connects. It stops the moment the stream is live.

---

## 7. Testing this without a browser

WebRTC looks untestable — it needs two peers, real network, real media. The decision
logic does not.

`getStats()` returns a plain Map, so the entire ABR loop can be driven with scripted
stats in Node: stub `RTCPeerConnection`, capture the `setInterval` callback, feed it
counter values, and assert which rungs get requested. That covers the part most likely
to be wrong — the *policy* — with no browser at all, including cases that are painful to
produce for real (12% packet loss, a freeze at exactly the wrong moment, a scene that
compresses to nothing).

What that approach cannot cover: actual pixels arriving. Codec negotiation, hardware
encode and `captureStream` all need a real, *compositing* browser (see 5.5).

---

## 8. Reusing this

`public/src/stream.js` has no game dependencies. It takes a canvas, a Socket.IO-ish
`emit`, and a room id:

```js
const host = OLW.Stream.createHost({
  canvas, socket, getRoomCode: () => code,
  onLevel: (rung, why) => …,
  onCpuPressure: () => …          // shed render quality before gameplay suffers
});

const rx = OLW.Stream.createReceiver({
  socket, getRoomCode: () => code, video: videoEl,
  onLevel: (rung, why, isDown) => …
});
```

To adapt it: any `MediaStream` source works in place of the canvas (`getDisplayMedia`
for real screen share, `getUserMedia` for camera). Retune `LADDER` for the content —
these bitrates suit high-motion game footage; a slide presentation would want far less,
a static camera less still. Swap the Socket.IO relay for whatever signalling you have.

Both sides expose `debug()` for live inspection:

```js
OLW_MIRROR.debug()      // kiosk: { conn, ice, level, cap, uplink, live }
OLW_MIRROR_RX.debug()   // phone: { conn, ice, level, thr, stable, cooldown, live }
```

---

## 9. Tuning reference

All in `public/src/stream.js`.

| Constant | Value | Meaning |
|---|---|---|
| `TICK_MS` | 1000 | one control-loop iteration ≈ one "segment" |
| `EWMA_ALPHA` | 0.35 | throughput smoothing (≈5-sample memory) |
| `UP_HEADROOM` | 1.35 | spare capacity required to climb |
| `DOWN_MARGIN` | 0.85 | below this fraction of the rung, treat as starved |
| `UP_STABLE_TICKS` | 4 | clean seconds required before climbing |
| `DOWN_COOLDOWN` | 6 | ticks after a downshift before climbing is allowed |
| `BUF_LOW_MS` / `DRAIN` / `PANIC` | 120 / 250 / 450 | playout-buffer thresholds |
| `LOSS_WARN` / `LOSS_PANIC` | 3% / 8% | packet-loss thresholds |
| `WARMUP_TICKS` | 8 | ignore the bandwidth estimate while it probes |
| `START_KBPS` | 2500 | SDP start-bitrate hint |

Rules of thumb when retuning: **raise `UP_STABLE_TICKS`** if the quality visibly
oscillates; **lower the buffer thresholds** if stalls are being detected too late;
**never raise `DOWN_MARGIN` toward 1.0** — that makes normal encoder variation look like
congestion, and you are back to the §3 bug.
