/* Asset-fit harness.

   Generated map art never lands with its wall ring at the exact size the game's
   collision ellipse expects, so this fits it: load a source image into a
   960x540 canvas under a chosen scale/offset, overlay the TRUE play boundary
   (WALL_RADIUS 138 x WALL_RADIUS_Y 92 at 480,270) plus the two warden footings,
   eyeball the alignment, then export the fitted WebP.

   Same-origin server so the canvas is never tainted and getImageData/toDataURL
   both work. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// decodeURIComponent matters: this path contains a space, which a file URL escapes
// decodeURIComponent matters: a path containing a space is escaped in a file URL
const HERE = path.dirname(
  decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
);
// put source renders (png/jpg) alongside this script, or in tools/src/
const SCRATCH = fs.existsSync(path.join(HERE, 'src')) ? path.join(HERE, 'src') : HERE;
const OUT_DIR = path.resolve(HERE, '../public/assets/art/maps');

const PAGE = `<!doctype html><meta charset=utf-8><title>asset fit</title>
<body style="margin:0;background:#111;color:#ddd;font:12px system-ui">
<canvas id=c width=960 height=540 style="display:block"></canvas>
<script>
const c = document.getElementById('c'), x = c.getContext('2d');
window.SRC = null;
window.loadSrc = (url) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => { window.SRC = i; res([i.naturalWidth, i.naturalHeight]); };
  i.onerror = rej; i.src = url;
});

/* scale: source px -> canvas px. cx,cy: source-space point placed at canvas centre. */
window.compose = (o) => {
  const { scale, cx, cy, sy } = o;
  const vs = sy || scale;
  x.setTransform(1,0,0,1,0,0);
  x.fillStyle = '#0b0e14'; x.fillRect(0,0,960,540);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  const w = SRC.naturalWidth * scale, h = SRC.naturalHeight * vs;
  const dx = 480 - cx * scale, dy = 270 - cy * vs;
  /* Centring the fort can leave a margin the source doesn't cover. Fill it by
     MIRRORING the adjacent strip rather than stretching the edge pixel: on
     dense forest texture a mirror is nearly invisible, while a clamp smears
     into obvious vertical streaks. */
  x.drawImage(SRC, dx, dy, w, h);
  const mirror = (sx, sy2, sw, sh, tx, ty, tw, th, flipX, flipY) => {
    x.save();
    x.translate(flipX ? tx + tw : tx, flipY ? ty + th : ty);
    x.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    x.drawImage(SRC, sx, sy2, sw, sh, 0, 0, tw, th);
    x.restore();
  };
  const sW = SRC.naturalWidth, sH = SRC.naturalHeight;
  if (dx > 0) mirror(0, 0, Math.ceil(dx / scale) + 2, sH, 0, dy, dx + 1, h, true, false);
  if (dx + w < 960) {
    const need = 960 - (dx + w) + 1, srcNeed = Math.ceil(need / scale) + 2;
    mirror(sW - srcNeed, 0, srcNeed, sH, dx + w - 1, dy, need, h, true, false);
  }
  if (dy > 0) mirror(0, 0, sW, Math.ceil(dy / vs) + 2, dx, 0, w, dy + 1, false, true);
  if (dy + h < 540) {
    const need = 540 - (dy + h) + 1, srcNeed = Math.ceil(need / vs) + 2;
    mirror(0, sH - srcNeed, sW, srcNeed, dx, dy + h - 1, w, need, false, true);
  }
};

/* Bake a soft edge vignette. Two jobs: it hides the mirrored fill strip at the
   frame edges, and it darkens the outer ground so raider silhouettes read
   against it while the lit courtyard stays the focus. */
window.vignette = (strength) => {
  const s = strength == null ? 0.55 : strength;
  const g = x.createRadialGradient(480, 270, 200, 480, 270, 620);
  g.addColorStop(0, 'rgba(4,6,10,0)');
  g.addColorStop(0.55, 'rgba(4,6,10,' + (s * 0.35).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(4,6,10,' + s.toFixed(3) + ')');
  x.save(); x.fillStyle = g; x.fillRect(0, 0, 960, 540); x.restore();
};

/* the geometry the art has to agree with */
window.overlay = () => {
  x.save();
  x.strokeStyle = '#ff2d2d'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(480, 270, 138, 92, 0, 0, Math.PI*2); x.stroke();
  x.strokeStyle = '#00ff88'; x.lineWidth = 1.5;
  [[432,280],[528,280]].forEach(([px,py]) => {
    x.beginPath(); x.ellipse(px, py+7, 16, 6, 0, 0, Math.PI*2); x.stroke();
    x.beginPath(); x.moveTo(px, py+7); x.lineTo(px, py-55); x.stroke();
  });
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(480,0); x.lineTo(480,540); x.moveTo(0,270); x.lineTo(960,270); x.stroke();
  x.restore();
};

/* candidate boundary + warden footings, for deriving the constants from the art */
window.overlayCustom = (o) => {
  const { cx, cy, rx, ry, wx, wy } = o;
  x.save();
  x.strokeStyle = '#ff2d2d'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); x.stroke();
  x.strokeStyle = '#00ff88'; x.lineWidth = 1.5;
  [[cx - wx, wy],[cx + wx, wy]].forEach(([px,py]) => {
    x.beginPath(); x.ellipse(px, py+7, 16, 6, 0, 0, Math.PI*2); x.stroke();
    x.beginPath(); x.moveTo(px, py+7); x.lineTo(px, py-55); x.stroke();
  });
  x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(cx,0); x.lineTo(cx,540); x.moveTo(0,cy); x.lineTo(960,cy); x.stroke();
  x.restore();
};

window.save = async (name, type, quality) => {
  const data = c.toDataURL(type || 'image/webp', quality == null ? 0.92 : quality);
  const r = await fetch('/save?name=' + encodeURIComponent(name), { method:'POST', body: data });
  return r.text();
};
</script>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  // let the game page (port 3000) post its canvas here for inspection
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'POST' && u.pathname === '/save') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const name = path.basename(u.searchParams.get('name') || '');
      const b64 = body.slice(body.indexOf(',') + 1);
      const buf = Buffer.from(b64, 'base64');
      // Only real map assets go to the game; anything else stays local. Guard on
      // the ASSET name rather than a "preview" prefix — a stray screenshot must
      // never be able to land in the assets folder.
      const isAsset = /^map-(frontier|orchard|frost)(-960)?\.webp$/.test(name);
      const dest = isAsset ? path.join(OUT_DIR, name) : path.join(SCRATCH, name);
      fs.writeFileSync(dest, buf);
      res.writeHead(200); res.end(dest + ' ' + buf.length + 'B');
    });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/fit.html') {
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return;
  }
  const f = path.join(SCRATCH, path.basename(u.pathname));
  if (fs.existsSync(f)) {
    res.writeHead(200, { 'content-type': 'image/png' });
    fs.createReadStream(f).pipe(res); return;
  }
  res.writeHead(404); res.end('no');
}).listen(3999, () => console.log('fit harness on http://localhost:3999'));
