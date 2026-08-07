window.OLW = window.OLW || {};

OLW.Assets = (function () {
  const files = {
    raiders:
      'assets/art/optimized/raider-atlas.webp',

    warden:
      'assets/art/optimized/warden-atlas.webp',

    portrait:
      'assets/art/optimized/warden-portrait.webp',

    title:
      'assets/art/optimized/outpost-title-backdrop.webp',

    dragon:
      'assets/art/characters/dragon.webp',

    warBeast:
      'assets/art/characters/war-beast.webp',

    backupGuard:
      'assets/art/characters/backup-guard.webp',

    wardenAction:
      'assets/art/characters/warden-action-atlas.webp',

    wardenIdle:
      'assets/art/characters/warden-idle.webp',

    mapFrontier:
      'assets/art/maps/map-frontier.webp',

    mapOrchard:
      'assets/art/maps/map-orchard.webp',

    mapFrost:
      'assets/art/maps/map-frost.webp'
  };

  const images = {};

  function load(key, url) {
    const image = new Image();

    image.decoding = 'async';

    image.src = url;

    images[key] = image;

    /*
     * Ask the browser to decode early.
     * Failure here is harmless because drawImage()
     * still works after normal loading.
     */
    image.decode?.().catch(() => {});

    return image;
  }

  Object.entries(files).forEach(
    ([key, url]) => load(key, url)
  );

  function ready(key) {
    const image = images[key];

    return Boolean(
      image &&
      image.complete &&
      image.naturalWidth > 0
    );
  }

  function mapKey(id) {
    switch (id) {
      case 'orchard':
        return 'mapOrchard';

      case 'frost':
        return 'mapFrost';

      default:
        return 'mapFrontier';
    }
  }

  function map(id) {
    const key = mapKey(id);

    return ready(key)
      ? images[key]
      : null;
  }

  return {
    files,
    images,
    ready,
    map
  };
})();