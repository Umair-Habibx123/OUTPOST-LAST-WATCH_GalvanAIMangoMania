// src/device.js
/* Per-device identity + persistent profile, synced to Neon.

   - Every browser gets a stable ID (cookie + localStorage, survives either being
     cleared). It's the primary key for the player's server-side profile.
   - The profile (coins, level, xp, unlocks, ammo, upgrades, settings, best) is
     the SAME shape locally and in Neon. On boot we load the server copy (source
     of truth); every save writes localStorage instantly (offline cache) and
     debounce-pushes to Neon.
   - When the server copy arrives we fire `olw:profilesync` so UIs can refresh. */
window.OLW = window.OLW || {};

OLW.Device = (function () {
  const ID_KEY = 'olw_device_id';
  const PROFILE_KEY = 'olw_profile_v1';
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

  // resolve a stable id from any surviving store, then re-seed the others
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch (e) {}
  if (!id) id = readCookie(COOKIE);
  if (!id) id = uuid();
  try { localStorage.setItem(ID_KEY, id); } catch (e) {}
  writeCookie(COOKIE, id);

  function defaults() {
    return {
      stash: 0, unlocked: [], ammo: {}, items: {}, upgrades: {},
      xp: 0, level: 1, settings: {},
      loadout: 'sidearm', map: 'frontier', bestScore: 0, name: '',
    };
  }

  function loadLocal() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch (e) {}
    if (!p || typeof p !== 'object') p = {};
    return Object.assign(defaults(), p);
  }

  let profile = loadLocal();

  function saveLocal() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) {}
  }

  let pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToServer, 800);
  }
  async function pushToServer() {
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: id, profile }),
      });
    } catch (e) { /* offline — localStorage still holds it */ }
  }

  function save() { saveLocal(); schedulePush(); }

  let synced = false;
  async function syncFromServer() {
    try {
      const r = await fetch('/api/profile?deviceId=' + encodeURIComponent(id), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.profile && typeof j.profile === 'object') {
          profile = Object.assign(defaults(), j.profile);  // server wins on boot
          saveLocal();
        } else {
          pushToServer();  // brand-new device → create the row from local cache
        }
      }
    } catch (e) { /* offline — keep local cache */ }
    synced = true;
    window.dispatchEvent(new CustomEvent('olw:profilesync'));
  }

  const api = {
    id,
    get profile() { return profile; },
    get synced() { return synced; },
    save,
    sync: syncFromServer,
    patch(delta) { Object.assign(profile, delta); save(); },

    addStash(n) { profile.stash = Math.max(0, Math.round(profile.stash + n)); save(); return profile.stash; },
    spendStash(n) { if (profile.stash < n) return false; profile.stash -= n; save(); return true; },

    isUnlocked(weaponId) { return profile.unlocked.indexOf(weaponId) !== -1; },
    unlock(weaponId) { if (!this.isUnlocked(weaponId)) { profile.unlocked.push(weaponId); save(); } },

    upgradeLevel(key) { return profile.upgrades[key] || 0; },
    setUpgradeLevel(key, lvl) { profile.upgrades[key] = lvl; save(); },

    rememberBest(score) { if (score > (profile.bestScore || 0)) { profile.bestScore = score; save(); } return profile.bestScore; },
  };

  // kick off the server load (async; UIs refresh on olw:profilesync)
  syncFromServer();

  return api;
})();
