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
      loadout: 'sidearm', map: 'frontier', bestScore: 0, name: '',
    };
  }

  let profile = defaults();   // in-memory only; replaced by the server copy
  let synced = false;

  function applyServerProfile(p) {
    if (p && typeof p === 'object') profile = Object.assign(defaults(), p);
    window.dispatchEvent(new CustomEvent('olw:profilesync'));
  }

  async function post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ ok: false, message: 'Bad response.' }));
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
    prefTimer = setTimeout(async () => {
      const prefs = pendingPrefs; pendingPrefs = {}; prefTimer = null;
      const res = await post('/api/profile', {
        deviceId: id,
        profile: {
          settings: prefs.settings,
          name: prefs.name,
          loadout: prefs.loadout,
          map: prefs.map,
        },
      });
      if (res && res.ok && res.profile) profile = Object.assign(defaults(), res.profile);
    }, 600);
  }

  const api = {
    id,
    get profile() { return profile; },
    get synced() { return synced; },
    load,
    applyServerProfile,

    // non-economy prefs (settings/name/loadout/map). Economy fields are ignored.
    patch(delta) {
      const clean = {};
      ['settings', 'name', 'loadout', 'map'].forEach(k => { if (k in delta) clean[k] = delta[k]; });
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
  };

  load();   // pull the authoritative profile on boot
  return api;
})();
