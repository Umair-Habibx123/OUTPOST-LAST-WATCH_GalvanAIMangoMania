/* Atlas builder.

   Generated sprite SHEETS never obey a grid — rows wrap, cells drift, the
   background is flat white or grey instead of transparent, and the requested
   facing order is ignored. But the individual sprites on them are clean and
   consistent. So this tool ignores the source layout entirely: it finds every
   sprite, cuts it out, and rebuilds the exact grid the game slices by
   arithmetic.

   Pipeline:
     loadSheet(url)          key the background to alpha, find sprite boxes
     showDetection()         draw numbered boxes so you can see what is what
     buildAtlas(spec)        place chosen sprites into an exact cols x rows grid
     saveAtlas(name)         write the .webp into public/assets/art/characters

   ANCHORING: every consumer draws a cell with
       drawImage(..., x - w/2, y - h*0.78, w, h)
   so the world position sits 78% down the cell. Sprite FEET must therefore
   land on 78% of the cell height, or characters hover / sink. buildAtlas does
   this for you (see FOOT_ANCHOR).

   Run:  node tools/atlas-build.mjs      then open http://localhost:3998
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(
  decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
);
const SRC_DIR = fs.existsSync(path.join(HERE, 'src')) ? path.join(HERE, 'src') : HERE;
const OUT_DIR = path.resolve(HERE, '../public/assets/art/characters');
const ICON_DIR = path.resolve(HERE, '../public/assets/art/icons');

const PAGE = `<!doctype html><meta charset=utf-8><title>atlas build</title>
<body style="margin:0;background:#14161a;color:#ddd;font:12px system-ui">
<canvas id=c width=1200 height=800 style="display:block;max-width:100vw"></canvas>
<script>
const c = document.getElementById('c'), x = c.getContext('2d', { willReadFrequently: true });
const FOOT_ANCHOR = 0.78;          // must match drawAtlasFrame / drawSilhouette
window.SPRITES = [];               // detected sprites: {i, canvas, w, h}
window.SHEET = null;

/* ---------- background keying ----------
   Flood fill inward from the border only. A plain colour-distance threshold
   would also punch holes in light parts of the sprite itself (the warden's
   pale fur trim, the dragon's bone horns); anything reachable from the edge
   is genuinely background. */
function keyBackground(img, tol) {
  tol = tol == null ? 46 : tol;
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const im = cx.getImageData(0, 0, w, h), d = im.data;

  // background colour = median of border samples
  const samples = [];
  for (let i = 0; i < w; i += Math.max(1, (w / 60) | 0)) {
    samples.push([d[(i) * 4], d[(i) * 4 + 1], d[(i) * 4 + 2]]);
    const b = ((h - 1) * w + i) * 4;
    samples.push([d[b], d[b + 1], d[b + 2]]);
  }
  const med = (k) => samples.map(s => s[k]).sort((a, b) => a - b)[samples.length >> 1];
  const bg = [med(0), med(1), med(2)];

  const near = (i) => {
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) < tol;
  };

  // iterative flood fill from every border pixel
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w; i++) { stack.push(i, (h - 1) * w + i); }
  for (let j = 0; j < h; j++) { stack.push(j * w, j * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i4 = p * 4;
    if (!near(i4)) continue;
    d[i4 + 3] = 0;
    const px = p % w, py = (p / w) | 0;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  /* Soft edge pass. The flood fill only clears pixels it can REACH, so a soft
     halo (a fire breath's glow bleeding into the backdrop) stays fully opaque
     and shows up as a pale rectangle once the sprite is cut out. Ramp alpha for
     surviving pixels that are still close to the background colour, so halos
     dissolve while the sprite body — far from bg — is untouched. */
  const soft = tol * 1.9;
  for (let p = 0; p < w * h; p++) {
    const i4 = p * 4;
    if (d[i4 + 3] === 0) continue;
    const dr = d[i4] - bg[0], dg = d[i4 + 1] - bg[1], db = d[i4 + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < soft) {
      const t = Math.max(0, Math.min(1, (dist - tol * 0.55) / (soft - tol * 0.55)));
      d[i4 + 3] = Math.round(d[i4 + 3] * t);
    }
  }
  cx.putImageData(im, 0, 0);
  return cv;
}

/* ---------- sprite detection ----------
   Connected components over the opaque pixels. Sheets also contain junk
   (separator bands, shadow smears); minArea + aspect filtering drops most of
   it and showDetection() lets you eyeball the rest. */
function findSprites(cv, minArea) {
  const w = cv.width, h = cv.height;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const seen = new Uint8Array(w * h);
  /* Which component each pixel belongs to. Bounding boxes overlap all the time
     on a generated sheet — a long rifle's box swallows the barrel of the object
     below it — so cutting a plain rectangle drags in a neighbour's pixels. The
     label map lets the cut keep only the sprite it actually belongs to. */
  const label = new Int32Array(w * h).fill(-1);
  const boxes = [];
  let comp = 0;
  const step = 2;                                   // subsample: sheets are huge
  for (let y = 0; y < h; y += step) {
    for (let xx = 0; xx < w; xx += step) {
      const p = y * w + xx;
      if (seen[p] || d[p * 4 + 3] < 24) continue;
      let x0 = xx, x1 = xx, y0 = y, y1 = y, n = 0;
      // unique per component scanned, NOT per accepted box: a blob rejected by
      // minArea must not hand its label id to the next one that is kept
      const id = comp++;
      const st = [p];
      while (st.length) {
        const q = st.pop();
        if (seen[q]) continue;
        seen[q] = 1;
        if (d[q * 4 + 3] < 24) continue;
        n++;
        label[q] = id;
        const qx = q % w, qy = (q / w) | 0;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        if (qx > 0) st.push(q - 1);
        if (qx < w - 1) st.push(q + 1);
        if (qy > 0) st.push(q - w);
        if (qy < h - 1) st.push(q + w);
      }
      const bw = x1 - x0, bh = y1 - y0;
      if (n >= (minArea || 900) && bw > 24 && bh > 24) boxes.push({ x: x0, y: y0, w: bw, h: bh, n, comp: id });
    }
  }
  // reading order: top-to-bottom in bands, then left-to-right
  const band = Math.max(40, Math.round(h / 24));
  boxes.sort((a, b) => (Math.round(a.y / band) - Math.round(b.y / band)) || (a.x - b.x));
  return { boxes, label, w, h };
}

window.loadSheet = (url, opts) => new Promise((res, rej) => {
  opts = opts || {};
  const img = new Image();
  img.onload = () => {
    const keyed = keyBackground(img, opts.tol);
    const det = findSprites(keyed, opts.minArea);
    SHEET = keyed;
    const sheetCx = keyed.getContext('2d', { willReadFrequently: true });
    SPRITES = det.boxes.map((b, i) => {
      const cv = document.createElement('canvas');
      cv.width = b.w; cv.height = b.h;
      const g = cv.getContext('2d');
      g.drawImage(keyed, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      // erase anything inside the box that belongs to a DIFFERENT component,
      // so a neighbour overlapping this bounding box is not cut out with it
      const im = g.getImageData(0, 0, b.w, b.h), px = im.data;
      for (let yy = 0; yy < b.h; yy++) {
        for (let xx2 = 0; xx2 < b.w; xx2++) {
          const lab = det.label[(b.y + yy) * det.w + (b.x + xx2)];
          if (lab !== -1 && lab !== b.comp) px[(yy * b.w + xx2) * 4 + 3] = 0;
        }
      }
      g.putImageData(im, 0, 0);
      return { i, canvas: cv, w: b.w, h: b.h, box: b };
    });
    res({ count: SPRITES.length, boxes: SPRITES.map(s => ({ i: s.i, w: s.w, h: s.h, x: s.box.x, y: s.box.y })) });
  };
  img.onerror = rej;
  img.src = url;
});

/* Cut an arbitrary region of the keyed sheet into a new sprite index. Detection
   merges anything that physically touches — a dragon joined to another by its
   own fire breath comes back as one blob — so regions get carved by hand. */
window.crop = (sx, sy, sw, sh, opts) => {
  opts = opts || {};
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(SHEET, sx, sy, sw, sh, 0, 0, sw, sh);
  /* Cutting mid-flame leaves a hard vertical edge that reads as a torn
     rectangle in game. Ramp alpha out over the last fadeRight px so the breath
     dissolves instead of being guillotined. */
  if (opts.fadeRight) {
    const im = g.getImageData(0, 0, sw, sh), d2 = im.data;
    const f = Math.min(opts.fadeRight, sw);
    for (let y = 0; y < sh; y++) {
      for (let i = sw - f; i < sw; i++) {
        const t = 1 - (i - (sw - f)) / f;
        const p = (y * sw + i) * 4 + 3;
        d2[p] = Math.round(d2[p] * t * t);
      }
    }
    g.putImageData(im, 0, 0);
  }
  const sp = { i: SPRITES.length, canvas: cv, w: sw, h: sh, box: { x: sx, y: sy, w: sw, h: sh } };
  SPRITES.push(sp);
  return sp.i;
};

/* draw the keyed sheet with numbered boxes, for picking indices by eye */
window.showDetection = () => {
  const s = Math.min(1200 / SHEET.width, 800 / SHEET.height);
  c.width = Math.round(SHEET.width * s); c.height = Math.round(SHEET.height * s);
  x.setTransform(1,0,0,1,0,0);
  x.fillStyle = '#181b20'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(SHEET, 0, 0, c.width, c.height);
  x.lineWidth = 2; x.font = '700 16px system-ui'; x.textBaseline = 'top';
  SPRITES.forEach(sp => {
    const b = sp.box;
    x.strokeStyle = '#00ff88';
    x.strokeRect(b.x * s, b.y * s, b.w * s, b.h * s);
    x.fillStyle = 'rgba(0,0,0,.8)';
    x.fillRect(b.x * s, b.y * s, 26, 18);
    x.fillStyle = '#00ff88';
    x.fillText(String(sp.i), b.x * s + 5, b.y * s + 2);
  });
};

/* ---------- assembly ----------
   spec = { cols, rows, cellW, cellH, pad, cells:[{col,row,sprite,flip,scale}] }
   Each sprite is fitted into its cell preserving aspect, then anchored so its
   feet sit on FOOT_ANCHOR of the cell height. */
window.buildAtlas = (spec) => {
  const { cols, rows, cellW, cellH } = spec;
  const pad = spec.pad == null ? 0.06 : spec.pad;
  /* Characters hang from the foot anchor so they stand on the ground. An
     inventory ICON has no ground — it wants to sit in the middle of its tile,
     so those pass anchor:0.5. */
  const anchor = spec.anchor == null ? FOOT_ANCHOR : spec.anchor;
  c.width = cols * cellW; c.height = rows * cellH;
  x.setTransform(1,0,0,1,0,0);
  x.clearRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';

  spec.cells.forEach(cell => {
    const sp = SPRITES[cell.sprite];
    if (!sp) return;
    const availW = cellW * (1 - pad * 2);
    /* The usable height is the space ABOVE the foot anchor, not the whole cell.
       Feet land on FOOT_ANCHOR, so a sprite scaled to the full cell height
       starts above the cell top and the per-cell clip decapitates it. Only
       cellH * FOOT_ANCHOR is actually available for the body. */
    const availH = cellH * (anchor >= FOOT_ANCHOR ? anchor : 1) - cellH * pad * 2;
    /* refH keeps ONE scale across every cell. Fitting each sprite to its cell
       individually looks right frame-by-frame but animates horribly: a crouched
       or leaning pose is shorter in pixels, gets scaled up more, and the
       character visibly pulses. With refH (the tallest source sprite) all poses
       keep their true relative size. */
    /* rowRefH normalises PER ROW instead of globally. Raider classes already
       differ in on-screen size through the renderer's own size multiplier;
       baking the size gap into the art as well would double it and shrink the
       scouts to a few unreadable pixels. Each class therefore fills its own
       cell, and the game keeps sole control of relative scale. */
    const refH = (spec.rowRefH && spec.rowRefH[cell.row]) || spec.refH;
    const refW = (spec.rowRefW && spec.rowRefW[cell.row]) || spec.refW;
    let k = refH
      ? Math.min(availH / refH, refW ? availW / refW : Infinity) * (cell.scale || 1)
      : Math.min(availW / sp.w, availH / sp.h) * (cell.scale || 1);
    const dw = sp.w * k, dh = sp.h * k;
    const ox = cell.col * cellW + (cellW - dw) / 2 + (cell.dx || 0);
    // feet (sprite bottom) land on the anchor line
    const oy = cell.row * cellH + cellH * anchor - dh * (anchor === 0.5 ? 0.5 : 1) + (cell.dy || 0);
    x.save();
    // Clip to the cell. Frames that deliberately overflow (a fire breath held
    // at the same body scale as its neighbours) must not bleed into the next
    // cell, or the neighbouring frame renders with someone else's flame in it.
    x.beginPath();
    x.rect(cell.col * cellW, cell.row * cellH, cellW, cellH);
    x.clip();
    if (cell.flip) { x.translate(ox + dw, oy); x.scale(-1, 1); x.drawImage(sp.canvas, 0, 0, dw, dh); }
    else x.drawImage(sp.canvas, ox, oy, dw, dh);
    x.restore();
  });
};

/* preview the built atlas on a dark background with cell guides */
window.showGrid = (cols, rows) => {
  const cw = c.width / cols, ch = c.height / rows;
  x.save();
  x.strokeStyle = 'rgba(255,60,60,.55)'; x.lineWidth = 1;
  for (let i = 1; i < cols; i++) { x.beginPath(); x.moveTo(i*cw,0); x.lineTo(i*cw,c.height); x.stroke(); }
  for (let j = 1; j < rows; j++) { x.beginPath(); x.moveTo(0,j*ch); x.lineTo(c.width,j*ch); x.stroke(); }
  x.strokeStyle = 'rgba(0,255,136,.5)';
  for (let j = 0; j < rows; j++) { const y = j*ch + ch*${'0.78'};
    x.beginPath(); x.moveTo(0,y); x.lineTo(c.width,y); x.stroke(); }
  x.restore();
};

window.save = async (name, type, quality, dir) => {
  const data = c.toDataURL(type || 'image/webp', quality == null ? 0.95 : quality);
  const q = '/save?name=' + encodeURIComponent(name) + (dir ? '&dir=' + dir : '');
  const r = await fetch(q, { method: 'POST', body: data });
  return r.text();
};

/* One inventory icon: centre-anchored, square, transparent. Writes both the
   full-size file and the -192 variant the armory uses for its small tiles. */
window.saveIcon = async (spriteIndex, id) => {
  const out = [];
  for (const size of [256, 192]) {
    buildAtlas({ cols:1, rows:1, cellW:size, cellH:size, pad:0.06, anchor:0.5,
                 cells:[{ col:0, row:0, sprite:spriteIndex }] });
    out.push(await save(id + (size === 192 ? '-192' : '') + '.webp', 'image/webp', 0.95, 'icons'));
  }
  return out;
};
</script>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && u.pathname === '/save') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const name = path.basename(u.searchParams.get('name') || '');
      const buf = Buffer.from(body.slice(body.indexOf(',') + 1), 'base64');
      // Only real character atlases reach the game; previews stay local.
      // underscores are allowed: the game ships raider_atlas.webp
      const isAsset = /^[a-z0-9_-]+\.(webp|png)$/.test(name) && !name.startsWith('preview');
      const dir = u.searchParams.get('dir') === 'icons' ? ICON_DIR : OUT_DIR;
      const dest = isAsset ? path.join(dir, name) : path.join(SRC_DIR, name);
      fs.writeFileSync(dest, buf);
      res.writeHead(200); res.end(dest + ' ' + buf.length + 'B');
    });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/atlas.html') {
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return;
  }
  const f = path.join(SRC_DIR, path.basename(u.pathname));
  if (fs.existsSync(f)) {
    res.writeHead(200, { 'content-type': f.endsWith('.webp') ? 'image/webp' : 'image/png' });
    fs.createReadStream(f).pipe(res); return;
  }
  res.writeHead(404); res.end('no');
}).listen(3998, () => console.log('atlas builder on http://localhost:3998'));
