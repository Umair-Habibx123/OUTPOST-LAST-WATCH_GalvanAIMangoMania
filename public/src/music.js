// src/music.js
/* Mood-based music manager with cross-fades, a layered danger track, and
   stingers. Loops/stingers live in public/assets/audio/music/ (ogg + mp3
   fallback). Uses HTMLAudio elements with volume-ramp cross-fades so moods
   blend smoothly instead of hard cut. Respects the sound setting/mute.

   Moods:  title → gameplay → (danger layers in on low integrity) → game-over
           stinger → menu ambience; Armory/Settings/etc. → menu; back restores. */
window.OLW = window.OLW || {};

OLW.Music = (function () {
  const BASE = 'assets/audio/music/';
  const canOgg = (() => {
    const a = document.createElement('audio');
    return !!(a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"'));
  })();
  const EXT = canOgg ? 'ogg' : 'mp3';

  const LOOPS = {
    title: 'title_ominous_loop',
    gameplay: 'gameplay_watch_loop',
    menu: 'menu_modal_ambient_loop',
    danger: 'danger_layer_loop',
  };
  const STINGERS = {
    enter: 'stinger_enter_watch',
    gameover: 'stinger_game_over',
    roomready: 'stinger_room_ready',
  };
  const VOL = { title: 0.55, gameplay: 0.5, menu: 0.42, danger: 0.55 };

  const cache = {};
  const fades = new Map();
  let current = null;      // active loop key
  let prev = null;         // loop to restore after a menu
  let dangerOn = false;
  let muted = false;
  let unlocked = false;

  function audio(file, loop) {
    if (cache[file]) return cache[file];
    const a = new Audio(BASE + file + '.' + EXT);
    a.loop = !!loop;
    a.preload = 'auto';
    a.volume = 0;
    cache[file] = a;
    return a;
  }

  function fadeTo(a, target, ms) {
    if (fades.has(a)) { clearInterval(fades.get(a)); fades.delete(a); }
    if (muted) target = 0;
    if (target > 0 && a.paused) { a.play().catch(() => {}); }
    const start = a.volume;
    const t0 = performance.now();
    const iv = setInterval(() => {
      const k = ms <= 0 ? 1 : Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) {
        clearInterval(iv); fades.delete(a);
        if (target <= 0) { try { a.pause(); } catch (e) {} }
      }
    }, 30);
    fades.set(a, iv);
  }

  function playLoop(key, ms) {
    ms = ms == null ? 900 : ms;
    if (current === key) return;
    current = key;
    // EXCLUSIVE: fade in the target and fade out/stop every other loop, so e.g.
    // the title track can never keep playing during gameplay.
    for (const k in LOOPS) {
      if (k === 'danger') continue;
      const a = audio(LOOPS[k], true);
      if (k === key) fadeTo(a, VOL[k], ms);
      else if (!a.paused || a.volume > 0) fadeTo(a, 0, ms);
    }
    if (key !== 'gameplay' && dangerOn) { dangerOn = false; fadeTo(audio(LOOPS.danger, true), 0, ms); }
  }

  function resumeCurrent() {
    if (muted) return;
    if (current && LOOPS[current]) fadeTo(audio(LOOPS[current], true), VOL[current], 400);
    if (dangerOn) fadeTo(audio(LOOPS.danger, true), VOL.danger, 400);
  }

  const M = {
    title() { prev = null; playLoop('title'); },
    gameplay() { prev = null; playLoop('gameplay'); },
    menu() { if (current !== 'menu') { prev = current; playLoop('menu', 650); } },
    back() { const p = prev; prev = null; playLoop(p || 'title', 650); },
    stop() { playLoop(null); },

    setDanger(on) {
      if (current !== 'gameplay') on = false;
      if (on === dangerOn) return;
      dangerOn = on;
      fadeTo(audio(LOOPS.danger, true), on ? VOL.danger : 0, on ? 1200 : 800);
    },

    stinger(name) {
      const file = STINGERS[name];
      if (!file || muted || !unlocked) return;
      const a = new Audio(BASE + file + '.' + EXT);
      a.volume = 0.75;
      a.play().catch(() => {});
    },

    isMuted() { return muted; },

    setMuted(m) {
      muted = !!m;
      if (muted) { for (const a of Object.values(cache)) { try { a.pause(); } catch (e) {} } }
      else resumeCurrent();
    },

    unlock() {
      if (unlocked) return;
      unlocked = true;
      resumeCurrent();     // browsers only allow audio after a gesture
    },
  };

  /* ---------- autoplay unlock on first gesture ---------- */
  const onGesture = () => { M.unlock(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, onGesture, { once: false, passive: true }));

  /* ---------- wire game state → music ---------- */
  function install() {
    if (!OLW.Game || OLW.Game.__music) return true;
    OLW.Game.__music = true;
    const P = OLW.Game.prototype;

    const origStart = P.start;
    P.start = function () { origStart.call(this); M.stinger('enter'); M.gameplay(); };

    const origOver = P.gameOver;
    P.gameOver = function () {
      const was = this.state;
      origOver.call(this);
      if (was !== 'over' && this.state === 'over') { M.stinger('gameover'); M.menu(); }
    };

    const origUpdate = P.update;
    P.update = function (dt) {
      origUpdate.call(this, dt);
      if (this.state === 'playing') {
        const pct = this.integrity / (OLW.CONFIG.INTEGRITY_MAX || 100);
        M.setDanger(pct <= 0.3);
      }
    };
    return true;
  }
  if (!install()) {
    const t = setInterval(() => { if (install()) clearInterval(t); }, 200);
  }

  /* ---------- menus / title via delegated clicks ---------- */
  const OPEN_MENU = ['#btn-armory-launch', '#btn-settings-launch', '#btn-scores', '#btn-how', '#btn-qr', '#btn-armory'];
  const BACK = ['.ars-shop-close', '.ars-shop-x', '.set-close', '[data-back]', '#btn-room-back'];
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (OPEN_MENU.some((s) => t.closest(s))) M.menu();
    else if (t.closest('#btn-menu')) M.title();       // game-over → main menu
    else if (BACK.some((s) => t.closest(s))) M.back();
    if (t.closest('#mute-btn')) setTimeout(() => M.setMuted(OLW.Audio && OLW.Audio.isMuted && OLW.Audio.isMuted()), 0);
  }, true);

  /* ---------- multiplayer: player 2 joins ---------- */
  function wireMP() {
    if (!OLW.Multiplayer || !OLW.Multiplayer.on) return false;
    OLW.Multiplayer.on('roomState', (room) => { if (room && room.controller && room.controller.connected) M.stinger('roomready'); });
    return true;
  }
  if (!wireMP()) { const t = setInterval(() => { if (wireMP()) clearInterval(t); }, 300); }

  /* Honour the saved sound setting BEFORE the first loop is armed. settings.js
     loads earlier than this file, so its boot-time apply() ran when OLW.Music
     did not exist yet and the mute never reached us — which is why sound-off
     devices still got a burst of music on a hard refresh. Settings are read
     from the local mirror, so this is available immediately. */
  try {
    if (OLW.Settings && typeof OLW.Settings.get === 'function') {
      muted = !OLW.Settings.get('sound');
    }
  } catch (e) { /* defaults to unmuted */ }

  // start the title mood (will actually sound once the first gesture unlocks it)
  M.title();
  return M;
})();
