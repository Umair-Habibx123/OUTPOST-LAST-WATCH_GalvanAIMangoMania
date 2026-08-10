// src/stream.js

/* ================================================================
   OLW.Stream — Full-HD adaptive screen mirror (host kiosk → phone).

   This is DASH/ABR logic mapped onto a live WebRTC transport:

     DASH concept              →  what we use here
     ------------------------------------------------------------
     renditions (144p..1080p)  →  LADDER[] (bitrate + scale + fps)
     .mpd manifest             →  LADDER is known to both peers up
                                   front, so a switch is just an
                                   index — no renegotiation, no new
                                   offer/answer. setParameters()
                                   swaps the rendition mid-flight.
     segment download time     →  inbound bytes/sec (EWMA smoothed)
     player buffer occupancy   →  jitterBufferDelay / emittedCount
                                   (the real playout buffer, in ms)
     rebuffering / stall       →  freezeCount + totalFreezesDuration
     client-side pull decision →  RECEIVER decides the level and
                                   asks the host for it ('pull')
     server push               →  (not used — host only CAPS the
                                   request to what its uplink can
                                   physically carry)

   Priority order, exactly as in ABR: never stall > keep framerate >
   maximise resolution. Down-switches are fast and may skip several
   rungs at once; up-switches need sustained headroom + hysteresis so
   the picture never "flaps".

   ONE DELIBERATE DEPARTURE FROM DASH. There, a segment is a fixed-size
   file, so download time measures link capacity directly. Live is not
   like that: a quiet frame compresses to almost nothing, so a low
   received bitrate usually means "the scene was static", not "the link
   is congested". Treating it as congestion would drop the picture every
   time the player stood still. So authority is split:

     receiver -> owns QUALITY OF EXPERIENCE. Freezes, packet loss,
                 playout-buffer growth and decode drops are unambiguous,
                 and it steps DOWN on them immediately.
     host     -> owns CAPACITY. availableOutgoingBitrate comes from the
                 congestion controller actively probing the link, which
                 is the only trustworthy headroom measurement, and it
                 publishes it as a ceiling the receiver may not exceed.

   Received throughput is still tracked, but only as corroboration for a
   down-switch — never as a trigger on its own.
   ================================================================ */

window.OLW = window.OLW || {};

OLW.Stream = (function () {
  'use strict';

  /* ---------------- the rendition ladder ----------------
     Source canvas is rendered at 1920x1080 on the host, so level 5 is
     a true 1:1 Full-HD mirror. scale is scaleResolutionDownBy, i.e.
     the divisor applied to the 1080p source. */
  const LADDER = [
    { i: 0, label: '240p',  h: 240,  scale: 4.5, bitrate:   350000, fps: 24 },
    { i: 1, label: '360p',  h: 360,  scale: 3.0, bitrate:   750000, fps: 30 },
    { i: 2, label: '540p',  h: 540,  scale: 2.0, bitrate:  1600000, fps: 45 },
    { i: 3, label: '720p',  h: 720,  scale: 1.5, bitrate:  3000000, fps: 60 },
    { i: 4, label: '900p',  h: 900,  scale: 1.2, bitrate:  4500000, fps: 60 },
    { i: 5, label: '1080p', h: 1080, scale: 1.0, bitrate:  6500000, fps: 60 }
  ];
  const TOP = LADDER.length - 1;
  const START_LEVEL = 3;          // start at 720p and climb — never start blind at the top

  /* ---------------- ABR tuning ---------------- */
  const TICK_MS          = 1000;  // one control-loop iteration ~= one "segment"
  const EWMA_ALPHA       = 0.35;  // throughput smoothing (hysteresis)
  const UP_HEADROOM      = 1.35;  // need 35% spare capacity before stepping up
  const DOWN_MARGIN      = 0.85;  // below 85% of current rung → step down
  const UP_STABLE_TICKS  = 4;     // ~4s of clean samples before any up-switch
  const DOWN_COOLDOWN    = 6;     // ticks to wait after a down-switch
  const BUF_LOW_MS       = 120;   // healthy playout buffer ceiling
  const BUF_DRAIN_MS     = 250;   // buffer under stress → step down
  const BUF_PANIC_MS     = 450;   // buffer collapsing → multi-step down
  const LOSS_WARN        = 0.03;  // 3% packet loss → step down
  const LOSS_PANIC       = 0.08;  // 8% packet loss → multi-step down
  const WARMUP_TICKS     = 8;     // let the bandwidth estimator probe before capping
  const START_KBPS       = 2500;  // SDP start bitrate: reach HD in ~2s, not ~30s

  const RTC_CONFIG = {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    bundlePolicy: 'max-bundle'
  };

  function clampLevel(i) { return Math.max(0, Math.min(TOP, i | 0)); }
  function now() { return (performance && performance.now) ? performance.now() : Date.now(); }

  /* Prefer hardware codecs: H264 encodes on the kiosk GPU and decodes on
     phone silicon, which is what keeps 1080p60 cheap and low-latency.
     VP9/VP8 stay as fallbacks for browsers without an H264 pipeline. */
  function preferCodecs(transceiver) {
    try {
      if (!transceiver.setCodecPreferences || !window.RTCRtpSender ||
          !RTCRtpSender.getCapabilities) return;
      const codecs = RTCRtpSender.getCapabilities('video').codecs || [];
      const rank = (c) => {
        const m = (c.mimeType || '').toLowerCase();
        if (m === 'video/h264') return 0;
        if (m === 'video/vp9')  return 1;
        if (m === 'video/vp8')  return 2;
        if (m === 'video/av1')  return 3;
        return 4;                                // rtx/red/ulpfec keep their order
      };
      transceiver.setCodecPreferences(codecs.slice().sort((a, b) => rank(a) - rank(b)));
    } catch (e) { /* codec preference is an optimisation, never fatal */ }
  }

  /* WebRTC's congestion controller starts conservatively (~300kbps) and probes
     upward, which on a LAN means half a minute of soft picture before it finds
     the headroom that was there all along. These two SDP hints tell it the
     ceiling and where to begin, so the mirror opens near HD and the ABR loop
     only has to trim from there. Both are Chromium-family hints and are simply
     ignored elsewhere — the ladder still works without them. */
  function tuneSdp(sdp) {
    try {
      const sections = sdp.split(/(?=^m=)/m);
      return sections.map((sec) => {
        if (!sec.startsWith('m=video')) return sec;
        // bandwidth ceiling for the media section (kbps), after c= as required
        if (!/^b=AS:/m.test(sec)) {
          sec = sec.replace(/^(c=IN .*\r?\n)/m,
            '$1b=AS:' + Math.round(LADDER[TOP].bitrate / 1000) + '\r\n');
        }
        // start bitrate hint on every video codec fmtp line
        sec = sec.replace(/^a=fmtp:(\d+) (.*)$/gm, (line, pt, params) =>
          /x-google-start-bitrate/.test(params)
            ? line
            : 'a=fmtp:' + pt + ' ' + params + ';x-google-start-bitrate=' + START_KBPS +
              ';x-google-max-bitrate=' + Math.round(LADDER[TOP].bitrate / 1000) +
              ';x-google-min-bitrate=300');
        return sec;
      }).join('');
    } catch (e) { return sdp; }
  }

  /* ================================================================
     HOST SIDE — captures the game canvas, sends it, and enforces a
     ceiling derived from what the uplink can actually carry.
     ================================================================ */
  function createHost(opts) {
    const canvas   = opts.canvas;
    const socket   = opts.socket;
    const getRoom  = opts.getRoomCode;
    const onLevel  = opts.onLevel || function () {};
    const onCpu    = opts.onCpuPressure || function () {};

    let pc = null, sender = null, track = null, stream = null;
    let live = false, negotiating = false, retryTimer = null, statsTimer = null;
    let level = START_LEVEL;        // what we are actually sending
    let requested = START_LEVEL;    // what the receiver last asked for
    let cap = TOP;                  // uplink ceiling measured on this side
    let prevOut = null;
    let cpuStrikes = 0, uplinkEwma = 0;
    let warmup = WARMUP_TICKS;
    let lastSentCap = -1;
    const pendingIce = [];

    function roomCode() { return getRoom && getRoom(); }
    function emit(ev, payload) {
      const code = roomCode();
      if (socket && code) socket.emit(ev, Object.assign({ roomCode: code }, payload || {}));
    }

    /* Swap rendition in-flight. No renegotiation: same track, same
       transport, we just re-declare the encoding — the WebRTC analogue
       of asking the manifest for a different segment URL. */
    function applyLevel(next, why) {
      next = clampLevel(Math.min(next, cap));
      if (!sender || next === level) { level = next; return; }
      const rung = LADDER[next];
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].scaleResolutionDownBy = rung.scale;
        params.encodings[0].maxBitrate = rung.bitrate;
        params.encodings[0].maxFramerate = rung.fps;
        params.degradationPreference = 'balanced';
        sender.setParameters(params);
        level = next;
        onLevel(rung, why);
      } catch (e) { /* keep sending at the old rung rather than dying */ }
    }

    /* Send-side guard. The receiver cannot see an uplink limit until loss has
       already happened, so the host keeps a ceiling of its own. It is
       deliberately a slow safety net, not the decision maker:

         - WARMUP ticks are ignored entirely. WebRTC's bandwidth estimate
           STARTS around 300kbps and ramps as it probes; clamping to it
           immediately would pin us at 240p and then starve the probe, so the
           estimate would never grow. Classic bitrate-starvation trap.
         - After warmup the ceiling may rise instantly but only fall one rung
           per tick, so a single noisy estimate can't collapse the picture.
         - 'bandwidth' quality-limitation is the encoder itself saying it can't
           deliver, and that is acted on straight away. */
    async function pollSendStats() {
      if (!pc || !sender) return;
      let report;
      try { report = await pc.getStats(sender.track); } catch (e) { return; }

      let out = null, pair = null;
      report.forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video' && !s.isRemote) out = s;
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded')) pair = s;
      });
      if (!out) return;

      // what we are actually pushing right now (bits/sec)
      let sent = 0;
      if (prevOut && out.timestamp > prevOut.timestamp) {
        sent = ((out.bytesSent - prevOut.bytesSent) * 8) /
               ((out.timestamp - prevOut.timestamp) / 1000);
      }

      // available uplink, smoothed the same way the receiver smooths throughput
      const avail = Math.max(pair ? (pair.availableOutgoingBitrate || 0) : 0, sent);
      if (avail > 0) uplinkEwma = uplinkEwma ? (EWMA_ALPHA * avail + (1 - EWMA_ALPHA) * uplinkEwma) : avail;

      if (warmup > 0) {
        warmup--;
        cap = TOP;
      } else {
        let ceiling = TOP;
        if (uplinkEwma > 0) {
          ceiling = 0;
          for (let i = TOP; i >= 0; i--) {
            if (uplinkEwma >= LADDER[i].bitrate * 1.05) { ceiling = i; break; }
          }
        }
        // fall at most one rung per tick; rise freely
        cap = clampLevel(ceiling < cap ? cap - 1 : ceiling);
      }
      if (out.qualityLimitationReason === 'bandwidth') cap = clampLevel(Math.min(cap, level - 1));

      if (level > cap) applyLevel(cap, 'uplink-cap');
      else if (requested > level && level < cap) applyLevel(Math.min(requested, cap), 'cap-lifted');

      // publish the ceiling so the phone stops asking for rungs this uplink
      // cannot carry (and starts asking again the moment it can)
      if (cap !== lastSentCap) { lastSentCap = cap; emit('stream:cap', { level: cap }); }

      /* CPU pressure: the kiosk is rendering 1080p AND encoding it. If the
         encoder is CPU-bound, tell main.js to drop the render supersample
         instead of letting the whole game stutter. */
      if (out.qualityLimitationReason === 'cpu') {
        if (++cpuStrikes >= 3) { cpuStrikes = 0; onCpu(); }
      } else if (cpuStrikes > 0) cpuStrikes--;

      prevOut = out;
    }

    async function negotiate() {
      if (!pc || negotiating) return;
      negotiating = true;
      try {
        const offer = await pc.createOffer();
        offer.sdp = tuneSdp(offer.sdp);
        await pc.setLocalDescription(offer);
        emit('rtc:offer', { sdp: pc.localDescription, ladder: LADDER.map((l) => l.label) });
      } catch (e) { scheduleRetry(); }
      negotiating = false;
    }

    function scheduleRetry() {
      if (retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = null; if (pc) start(); }, 2500);
    }

    function start() {
      if (!canvas || !canvas.captureStream || !window.RTCPeerConnection) return false;
      // Both peers can trigger a start (host on match:started, phone via
      // rtc:request). A handshake already in flight must not be torn down —
      // but a fresh request while live means the phone reloaded and needs a
      // brand-new peer connection, so that case does restart.
      if (pc && !live &&
          (pc.connectionState === 'new' || pc.connectionState === 'connecting')) {
        return true;
      }
      stop(true);
      try {
        stream = canvas.captureStream(60);
        track = stream.getVideoTracks()[0];
        if (!track) return false;
        track.contentHint = 'motion';   // game footage: favour framerate over sharpness

        pc = new RTCPeerConnection(RTC_CONFIG);
        const rung = LADDER[START_LEVEL];
        const tc = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],          // without this the receiver's ontrack has no stream
          sendEncodings: [{
            maxBitrate: rung.bitrate,
            maxFramerate: rung.fps,
            scaleResolutionDownBy: rung.scale,
            networkPriority: 'high',
            priority: 'high'
          }]
        });
        preferCodecs(tc);
        sender = tc.sender;
        level = requested = START_LEVEL;
        cap = TOP; uplinkEwma = 0; cpuStrikes = 0;

        pc.onicecandidate = (e) => { if (e.candidate) emit('rtc:ice', { candidate: e.candidate }); };
        pc.onnegotiationneeded = () => negotiate();
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'connected') {
            live = true;
            if (!statsTimer) statsTimer = setInterval(pollSendStats, TICK_MS);
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            live = false;
            scheduleRetry();
          }
        };
        negotiate();
        return true;
      } catch (e) { return false; }
    }

    function stop(quiet) {
      live = false;
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (pc) { try { pc.close(); } catch (e) {} pc = null; }
      if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} stream = null; }
      sender = null; track = null; prevOut = null; pendingIce.length = 0;
      if (!quiet) emit('rtc:down', {});
    }

    /* signalling from the phone */
    async function onAnswer(p) {
      if (!pc || !p || !p.sdp) return;
      try {
        await pc.setRemoteDescription(p.sdp);
        while (pendingIce.length) { try { await pc.addIceCandidate(pendingIce.shift()); } catch (e) {} }
      } catch (e) { scheduleRetry(); }
    }
    async function onIce(p) {
      if (!p || !p.candidate) return;
      if (!pc) return;
      if (!pc.remoteDescription) { pendingIce.push(p.candidate); return; }
      try { await pc.addIceCandidate(p.candidate); } catch (e) {}
    }
    // The receiver's ABR verdict arrives here. We honour it, but never
    // above what our own uplink measurement says is deliverable.
    function onQualityRequest(p) {
      if (!p || typeof p.level !== 'number') return;
      requested = clampLevel(p.level);
      applyLevel(requested, p.why || 'receiver');
    }

    return {
      start, stop, onAnswer, onIce, onQualityRequest,
      isLive: () => live,
      level: () => LADDER[level],
      stats: () => ({ level: LADDER[level], cap: LADDER[cap], uplink: Math.round(uplinkEwma) }),
      debug: () => ({
        conn: pc && pc.connectionState, ice: pc && pc.iceConnectionState,
        sig: pc && pc.signalingState, level: LADDER[level].label,
        cap: LADDER[cap].label, uplink: Math.round(uplinkEwma), live: live
      })
    };
  }

  /* ================================================================
     RECEIVER SIDE (the phone) — this is where the ABR decision is
     actually made, from the playout buffer + throughput, exactly like
     a DASH player choosing its next segment.
     ================================================================ */
  function createReceiver(opts) {
    const socket   = opts.socket;
    const getRoom  = opts.getRoomCode;
    const video    = opts.video;
    const onUp     = opts.onUp || function () {};
    const onDown   = opts.onDown || function () {};
    const onLevel  = opts.onLevel || function () {};

    let pc = null, timer = null, live = false;
    let level = START_LEVEL;
    let thrEwma = 0;            // smoothed throughput, bits/sec
    let stable = 0;             // consecutive clean ticks (up-switch hysteresis)
    let cooldown = 0;           // ticks left before an up-switch is allowed
    let hostCap = TOP;          // ceiling the host measured on its uplink
    let prev = null;
    const pendingIce = [];

    function emit(ev, payload) {
      const code = getRoom && getRoom();
      if (socket && code) socket.emit(ev, Object.assign({ roomCode: code }, payload || {}));
    }

    function requestLevel(next, why) {
      next = clampLevel(Math.min(next, hostCap));
      if (next === level) return;
      const down = next < level;
      level = next;
      if (down) { cooldown = DOWN_COOLDOWN; stable = 0; }
      emit('stream:quality', { level: level, why: why });
      onLevel(LADDER[level], why, down);
    }

    /* One control-loop iteration == one ABR decision. */
    async function tick() {
      if (!pc) return;
      let report;
      try { report = await pc.getStats(); } catch (e) { return; }

      let inb = null;
      report.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s; });
      if (!inb) return;

      const t = now();
      if (!prev) { prev = { t: t, s: inb }; return; }
      const dt = (t - prev.t) / 1000;
      if (dt <= 0) return;
      const p = prev.s;
      prev = { t: t, s: inb };

      // --- throughput: bytes ÷ time, smoothed so one slow tick can't flap us ---
      const bits = Math.max(0, (inb.bytesReceived || 0) - (p.bytesReceived || 0)) * 8;
      const thr = bits / dt;
      thrEwma = thrEwma ? (EWMA_ALPHA * thr + (1 - EWMA_ALPHA) * thrEwma) : thr;

      // --- loss ratio over this interval ---
      const dLost = Math.max(0, (inb.packetsLost || 0) - (p.packetsLost || 0));
      const dRecv = Math.max(0, (inb.packetsReceived || 0) - (p.packetsReceived || 0));
      const loss = (dLost + dRecv) > 0 ? dLost / (dLost + dRecv) : 0;

      // --- buffer occupancy: the real playout buffer, in milliseconds ---
      const dDelay = (inb.jitterBufferDelay || 0) - (p.jitterBufferDelay || 0);
      const dEmit  = (inb.jitterBufferEmittedCount || 0) - (p.jitterBufferEmittedCount || 0);
      const bufMs  = dEmit > 0 ? (dDelay / dEmit) * 1000 : 0;

      // --- the rebuffer signal: a freeze is the thing we sacrifice quality to avoid ---
      const froze = ((inb.freezeCount || 0) - (p.freezeCount || 0)) > 0;

      // --- decode health: frames arriving but not making it to the screen ---
      const dDec  = Math.max(0, (inb.framesDecoded || 0) - (p.framesDecoded || 0));
      const dDrop = Math.max(0, (inb.framesDropped || 0) - (p.framesDropped || 0));
      const dropRatio = (dDec + dDrop) > 0 ? dDrop / (dDec + dDrop) : 0;

      if (cooldown > 0) cooldown--;

      const cur = LADDER[level];

      /* 1. PANIC — stalling now. Skip several rungs at once; a smooth
            360p picture beats a frozen 1080p one, always. */
      if (froze || loss > LOSS_PANIC || bufMs > BUF_PANIC_MS) {
        requestLevel(level - 2, froze ? 'freeze' : (loss > LOSS_PANIC ? 'loss' : 'buffer-collapse'));
        onDown({ loss: loss, bufMs: bufMs, thr: thrEwma, panic: true });
        return;
      }

      /* 2. STEP DOWN — under stress but not stalling yet. Note the
            throughput clause is corroborated: starved of bits AND showing
            an actual symptom, so a static scene can't fake congestion. */
      const starved = thrEwma < cur.bitrate * DOWN_MARGIN &&
                      (loss > 0.01 || bufMs > BUF_LOW_MS);
      if (starved || loss > LOSS_WARN || bufMs > BUF_DRAIN_MS || dropRatio > 0.20) {
        requestLevel(level - 1, 'drain');
        onDown({ loss: loss, bufMs: bufMs, thr: thrEwma, panic: false });
        return;
      }

      /* 3. STEP UP — sustained clean playback, no recent down-switch, and
            never past the ceiling the host measured on its uplink. One
            rung at a time, never a leap. */
      const clean = loss < 0.005 && bufMs < BUF_LOW_MS && dropRatio < 0.02;
      if (clean) stable++; else stable = 0;

      if (level < Math.min(TOP, hostCap) && stable >= UP_STABLE_TICKS && cooldown === 0) {
        stable = 0;
        requestLevel(level + 1, 'headroom');
        onUp({ thr: thrEwma, bufMs: bufMs });
      }
    }

    async function onOffer(p) {
      if (!p || !p.sdp || !window.RTCPeerConnection) return;
      teardown();
      pc = new RTCPeerConnection(RTC_CONFIG);
      level = START_LEVEL; thrEwma = 0; stable = 0; cooldown = 0; prev = null;

      pc.onicecandidate = (e) => { if (e.candidate) emit('rtc:ice', { candidate: e.candidate }); };
      pc.ontrack = (e) => {
        if (!video) return;
        // some senders deliver a track with no stream attached — wrap it
        const ms = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        video.srcObject = ms;
        video.play().catch(() => {});
        live = true;
        emit('rtc:up', {});
        opts.onLive && opts.onLive(true);
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          live = false;
          opts.onLive && opts.onLive(false);
          emit('rtc:down', {});
        }
      };

      try {
        await pc.setRemoteDescription(p.sdp);
        while (pendingIce.length) { try { await pc.addIceCandidate(pendingIce.shift()); } catch (e) {} }
        const ans = await pc.createAnswer();
        ans.sdp = tuneSdp(ans.sdp);   // the receive-side ceiling has to match
        await pc.setLocalDescription(ans);
        emit('rtc:answer', { sdp: pc.localDescription });
        if (!timer) timer = setInterval(tick, TICK_MS);
      } catch (e) { teardown(); }
    }

    async function onIce(p) {
      if (!p || !p.candidate) return;
      if (!pc || !pc.remoteDescription) { pendingIce.push(p && p.candidate); return; }
      try { await pc.addIceCandidate(p.candidate); } catch (e) {}
    }

    function teardown() {
      live = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (pc) { try { pc.close(); } catch (e) {} pc = null; }
      if (video) video.srcObject = null;
      prev = null; pendingIce.length = 0;
    }

    function request() { emit('rtc:request', {}); }

    // the host's measured uplink ceiling
    function onCap(p) {
      if (!p || typeof p.level !== 'number') return;
      hostCap = clampLevel(p.level);
      if (level > hostCap) requestLevel(hostCap, 'host-cap');
    }

    return {
      onOffer, onIce, request, onCap,
      stop: function () { teardown(); emit('rtc:down', {}); },
      isLive: () => live,
      level: () => LADDER[level],
      stats: () => ({ level: LADDER[level], thr: Math.round(thrEwma), stable: stable }),
      debug: () => ({
        conn: pc && pc.connectionState, ice: pc && pc.iceConnectionState,
        sig: pc && pc.signalingState, level: LADDER[level].label,
        thr: Math.round(thrEwma), stable: stable, cooldown: cooldown, live: live
      })
    };
  }

  return { LADDER: LADDER, createHost: createHost, createReceiver: createReceiver };
})();
