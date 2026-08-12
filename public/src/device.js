// src/device.js
/* Per-device identity — the ONLY thing persisted in the browser is a stable id
   (cookie + localStorage). The actual profile (coins, unlocks, ammo, items,
   upgrades, level) is NEVER stored client-side and is never client-authoritative:
   it lives in Neon and is mutated only through validated server endpoints
   (/api/purchase, /api/run). Editing anything in the browser can't grant coins.

   Non-sensitive prefs (settings / name / loadout / map) may be written back via
   /api/profile, which ignores economy fields server-side. */
window.OLW = window.OLW || {};

OLW.Device = (function () {
  const ID_KEY = 'olw_device_id';
  const COOKIE = 'olw_did';
  const YEAR = 60 * 60 * 24 * 365;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, val) {
    try { document.cookie = `${name}=${encodeURIComponent(val)}; max-age=${YEAR}; path=/; SameSite=Lax`; } catch (e) {}
  }

  // resolve / persist ONLY the id
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch (e) {}
  if (!id) id = readCookie(COOKIE);
  if (!id) id = uuid();
  try { localStorage.setItem(ID_KEY, id); } catch (e) {}
  writeCookie(COOKIE, id);

  // one-time cleanup of the old insecure client-side profile blob
  try { localStorage.removeItem('olw_profile_v1'); } catch (e) {}

  function defaults() {
    return {
      stash: 0, unlocked: ['sidearm'], ammo: {}, items: {}, upgrades: {}, weaponLevels: {},
      xp: 0, level: 1, settings: {},
      loadout: 'sidearm', map: 'frontier', bestScore: 0, name: '', company: '',
      versusWins: 0, versusLosses: 0,
    };
  }

  /* ---------- settings mirror (display prefs ONLY) ----------
     Economy stays server-authoritative and is never cached. Settings are
     different: they must be readable SYNCHRONOUSLY on the very first frame.
     They used to live only in the server profile, which arrives ~1s after
     boot — so with sound turned off the music still played that first second
     and then cut out once /api/profile resolved. Mirroring just the settings
     object in localStorage closes that window. The server copy still wins the
     moment it lands; this is a cache, not a source of truth. */
  const SETTINGS_KEY = 'olw_settings_v1';
  function readCachedSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  }
  function cacheSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || {})); } catch (e) {}
  }

  let profile = defaults();   // in-memory only; replaced by the server copy
  profile.settings = readCachedSettings();   // available before the first paint
  let synced = false;

  function applyServerProfile(p) {
    if (p && typeof p === 'object') {
      const cached = profile.settings || {};
      profile = Object.assign(defaults(), p);
      // A device that has never written prefs comes back with {} — don't let
      // that erase what this browser already had.
      const fromServer = p.settings;
      profile.settings = (fromServer && Object.keys(fromServer).length)
        ? fromServer
        : cached;
      cacheSettings(profile.settings);
    }
    window.dispatchEvent(new CustomEvent('olw:profilesync'));
  }

  /* Never rejects. Callers treat a failure as { ok: false } and carry on, so a
     dead network must not become an unhandled rejection — this runs on every
     settings toggle and on every purchase, and an offline kiosk would otherwise
     spew errors on each click. */
  async function post(path, body) {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await r.json().catch(() => ({ ok: false, message: 'Bad response.' }));
    } catch (e) {
      return { ok: false, message: 'Network unavailable.' };
    }
  }

  async function load() {
    try {
      const r = await fetch('/api/profile?deviceId=' + encodeURIComponent(id), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.profile) applyServerProfile(j.profile); }
    } catch (e) { /* offline: keep defaults for this session */ }
    synced = true;
    window.dispatchEvent(new CustomEvent('olw:profilesync'));
  }

  // debounced write of NON-economy prefs only
  let prefTimer = null, pendingPrefs = {};
  function queuePrefs(delta) {
    Object.assign(pendingPrefs, delta);
    Object.assign(profile, delta);                 // reflect locally for snappy UI
    if (prefTimer) clearTimeout(prefTimer);
    if ('settings' in delta) cacheSettings(delta.settings);   // instant on next boot
    prefTimer = setTimeout(async () => {
      const prefs = pendingPrefs; pendingPrefs = {}; prefTimer = null;
      // post() never rejects; a failed sync is silent because the local mirror
      // and in-memory profile already hold the value.
      const res = await post('/api/profile', {
        deviceId: id,
        profile: {
          settings: prefs.settings,
          name: prefs.name,
          company: prefs.company,
          loadout: prefs.loadout,
          map: prefs.map,
        },
      });
      if (res && res.ok && res.profile) {
        const local = profile.settings;
        profile = Object.assign(defaults(), res.profile);
        // never let a round-trip clobber a setting the player just changed
        profile.settings = local;
      }
    }, 600);
  }

  const api = {
    // live getter — reset() swaps the id, and readers (leaderboard, multiplayer)
    // must see the current one, not the boot-time value.
    get id() { return id; },
    get profile() { return profile; },
    get synced() { return synced; },
    load,
    applyServerProfile,

    /* EVENT-DAY BUILD: start a brand-new participant.
       One kiosk, many players in a queue — when a game ends we wipe to a clean
       slate so the previous player's level/coins/unlocks never advantage the
       next. A new device id keeps leaderboard rows attributed cleanly; the
       economy resets to Lv 1 / sidearm only / 0 coins. Display prefs
       (sound, reticle, shake, warden voice…) belong to the KIOSK, so they are
       preserved across players. */
    reset() {
      const keepSettings = profile.settings || {};
      id = uuid();
      try { localStorage.setItem(ID_KEY, id); } catch (e) {}
      writeCookie(COOKIE, id);
      profile = defaults();
      profile.settings = keepSettings;
      cacheSettings(profile.settings);
      // A fresh device has no server row; skip the fetch (it would just return
      // defaults) and mark synced so nothing re-seeds a live run from the server.
      synced = true;
      window.dispatchEvent(new CustomEvent('olw:profilesync'));
    },

    // non-economy prefs (settings/name/loadout/map). Economy fields are ignored.
    patch(delta) {
      const clean = {};
      ['settings', 'name', 'company', 'loadout', 'map'].forEach(k => { if (k in delta) clean[k] = delta[k]; });
      if (Object.keys(clean).length) queuePrefs(clean);
    },

    // read-only helpers
    isUnlocked(weaponId) { return (profile.unlocked || []).indexOf(weaponId) !== -1; },
    upgradeLevel(key) { return (profile.upgrades || {})[key] || 0; },

    // server-authoritative economy
    async purchase(kind, id2, options) {
      const res = await post('/api/purchase', { deviceId: id, kind, id: id2 });
      // Armory can opt out of applying each intermediate server response while
      // it has optimistic purchases queued. The server stays authoritative;
      // the final response (or load() after an error) reconciles the UI.
      if ((!options || options.applyProfile !== false) && res && res.ok && res.profile) {
        applyServerProfile(res.profile);
      }
      return res;
    },
    async submitRun(stats) {
      const res = await post('/api/run', { deviceId: id, stats });
      if (res && res.ok && res.profile) applyServerProfile(res.profile);
      return res;
    },

    // 1v1 win/loss record. Updates locally for instant display, then persists
    // server-side (server stays the source of truth).
    recordVersus(outcome) {
      profile.versusWins = profile.versusWins || 0;
      profile.versusLosses = profile.versusLosses || 0;
      if (outcome === 'win') profile.versusWins += 1; else profile.versusLosses += 1;
      post('/api/versus-result', { deviceId: id, outcome })
        .then((res) => { if (res && res.ok && res.profile) applyServerProfile(res.profile); })
        .catch(() => {});
      return { versusWins: profile.versusWins, versusLosses: profile.versusLosses };
    },
  };

  load();   // pull the authoritative profile on boot
  return api;
})();
