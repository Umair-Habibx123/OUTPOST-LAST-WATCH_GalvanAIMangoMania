window.OLW = window.OLW || {};

OLW.Assets = (function () {
  /*
   * IMPORTANT:
   * These paths match the redesigned assets library exactly.
   * Character artwork in the supplied assets archive is PNG; maps/UI are WebP/PNG.
   */
  const files = {
    raiders: [
      'assets/art/characters/raider_atlas.webp',
      'assets/art/characters/raider_atlas.png'
    ],

    wardenDirectional: ['assets/art/characters/warden-directional-atlas.webp'],
    backupGuardAtlas: ['assets/art/characters/backup-guard-atlas.webp'],
    warBeastAtlas: ['assets/art/characters/war-beast-atlas.webp'],
    dragonAtlas: ['assets/art/characters/dragon-atlas.webp'],
    raiderCreatures: ['assets/art/characters/raider-creature-atlas.webp'],
    supplyCartAtlas: ['assets/art/characters/supply-cart-atlas.webp'],

    // Current redesigned warden sheet.
    // The renderer treats it as a horizontal action sheet when possible.
    warden: [
      'assets/art/characters/warden.webp',
      'assets/art/characters/warden.png'
    ],

    portrait: [
      'assets/branding/warden-portrait.webp'
    ],

    title: [
      'assets/branding/outpost-title-backdrop.webp'
    ],

    dragon: [
      'assets/art/characters/dragon.webp',
      'assets/art/characters/dragon.png'
    ],

    warBeast: [
      'assets/art/characters/war-beast.webp',
      'assets/art/characters/war-beast.png'
    ],

    backupGuard: [
      'assets/art/characters/backup-guard.webp',
      'assets/art/characters/backup-guard.png'
    ],

    // Prefer the true 16:9 (-960) variants so the map fills 960x540 without stretch.
    mapFrontier: [
      'assets/art/maps/map-frontier-960.webp',
      'assets/art/maps/map-frontier.webp'
    ],

    mapOrchard: [
      'assets/art/maps/map-orchard-960.webp',
      'assets/art/maps/map-orchard.webp'
    ],

    mapFrost: [
      'assets/art/maps/map-frost-960.webp',
      'assets/art/maps/map-frost.webp'
    ]
  };

  const images = {};
  const loadedUrl = {};

  // ---- progress tracking so a loading screen can gate game start ----
  const total = Object.keys(files).length;
  let settled = 0;                 // keys that have loaded OR exhausted all candidates
  const waiters = [];
  function markSettled() {
    settled++;
    if (settled >= total) {
      const pending = waiters.splice(0);
      pending.forEach((fn) => { try { fn(); } catch (e) {} });
    }
  }

  function loadCandidates(key, candidates) {
    const list = Array.isArray(candidates) ? candidates.slice() : [candidates];
    const image = new Image();
    image.decoding = 'async';
    images[key] = image;

    let index = 0;
    let done = false;
    const settleOnce = () => { if (!done) { done = true; markSettled(); } };

    const tryNext = () => {
      if (index >= list.length) {
        console.warn(`[Outpost Assets] Unable to load ${key}`, list);
        settleOnce();
        return;
      }

      const url = list[index++];
      image.onload = () => {
        loadedUrl[key] = url;
        image.decode?.().catch(() => {});
        settleOnce();
      };
      image.onerror = tryNext;
      image.src = url;
    };

    tryNext();
    return image;
  }

  Object.entries(files).forEach(([key, value]) => loadCandidates(key, value));

  // Resolve when every asset has settled (loaded or failed-over). Fires
  // immediately if already done. A loading screen uses this to gate game start.
  function whenLoaded(cb) {
    if (settled >= total) { try { cb(); } catch (e) {} return; }
    waiters.push(cb);
  }
  function progress() { return { loaded: settled, total }; }

  function ready(key) {
    const image = images[key];
    return Boolean(image && image.complete && image.naturalWidth > 0);
  }

  function mapKey(id) {
    if (id === 'orchard') return 'mapOrchard';
    if (id === 'frost') return 'mapFrost';
    return 'mapFrontier';
  }

  function map(id) {
    const key = mapKey(id);
    return ready(key) ? images[key] : null;
  }

  return {
    files,
    images,
    loadedUrl,
    ready,
    whenLoaded,
    progress,
    map
  };
})();
