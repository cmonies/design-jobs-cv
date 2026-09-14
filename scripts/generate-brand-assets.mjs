// One-shot: render favicon PNGs (all sizes) + og-image.png from the pixel bread mark.
// Usage: node scripts/generate-brand-assets.mjs
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const BREAD_PATHS = `
  <path d="m30.47 4.57 -1.52 0 0 -1.52 -1.53 0 0 -1.53 -3.04 0 0 -1.52L7.61 0l0 1.52 10.67 0 0 1.53 3.05 0 0 1.52 1.52 0 0 1.53 1.53 0 0 7.61 -1.53 0 0 1.53 -1.52 0 0 15.24 -16.76 0 0 1.52 21.33 0 0 -1.52 1.52 0 0 -1.53 1.53 0 0 -1.52 1.52 0 0 -13.72 1.53 0 0 -7.61 -1.53 0 0 -1.53z"/>
  <path d="M15.23 21.33h1.53v1.53h-1.53Z"/><path d="M13.71 18.29h1.52v1.52h-1.52Z"/><path d="M9.14 22.86h6.09v1.52H9.14Z"/><path d="M9.14 18.29h1.52v1.52H9.14Z"/><path d="M7.61 21.33h1.53v1.53H7.61Z"/><path d="M4.57 1.52h3.04v1.53H4.57Z"/><path d="M3.04 15.24h1.53v15.24H3.04Z"/><path d="M3.04 3.05h1.53v1.52H3.04Z"/><path d="M1.52 13.71h1.52v1.53H1.52Z"/><path d="M1.52 4.57h1.52V6.1H1.52Z"/><path d="M0 6.1h1.52v7.61H0Z"/>`;

// Icon: amber bread on transparent, drawn pixel-crisp with padding proportional to size
const iconHtml = (size, pad, bg) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg}">
  <svg width="${size - pad * 2}" height="${size - pad * 2}" viewBox="0 0 32 32" fill="#C0722A" shape-rendering="crispEdges">${BREAD_PATHS}</svg>
</div></body></html>`;

const ogHtml = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
<style>
  * { margin:0; box-sizing:border-box; }
  body { width:1200px; height:630px; background:#FFFFFF; font-family:'Bricolage Grotesque',sans-serif; color:#161512;
         display:flex; flex-direction:column; justify-content:space-between; padding:72px 80px; }
  .top { display:flex; align-items:center; gap:18px; }
  .wordmark { font-size:30px; font-weight:600; letter-spacing:-0.02em; }
  h1 { font-size:104px; font-weight:650; letter-spacing:-0.035em; line-height:0.98; max-width:950px; }
  .bottom { display:flex; align-items:center; gap:14px; font-size:22px; color:#77746B; letter-spacing:0.01em; }
  .dot { width:6px; height:6px; border-radius:50%; background:#C0722A; }
</style></head><body>
  <div class="top">
    <svg width="44" height="44" viewBox="0 0 32 32" fill="#C0722A" shape-rendering="crispEdges">${BREAD_PATHS}</svg>
    <span class="wordmark">designjobs.cv</span>
  </div>
  <h1>Design work worth&nbsp;doing.</h1>
  <div class="bottom">Verified design roles at startups<span class="dot"></span>Full-time &amp; contract<span class="dot"></span>Free forever</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();

// Favicon PNGs — transparent bg
for (const [file, size, pad] of [
  ['public/favicon-16x16.png', 16, 0],
  ['public/favicon-32x32.png', 32, 1],
  ['public/android-chrome-192x192.png', 192, 12],
  ['public/android-chrome-512x512.png', 512, 32],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(iconHtml(size, pad, 'transparent'));
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(file, buf);
  console.log('wrote', file);
}

// Apple touch icon — solid white bg (iOS composites black behind transparency)
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(iconHtml(180, 26, '#FFFFFF'));
writeFileSync('public/apple-touch-icon.png', await page.screenshot({ clip: { x: 0, y: 0, width: 180, height: 180 } }));
console.log('wrote public/apple-touch-icon.png');

// OG image
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHtml, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
writeFileSync('public/og-image.png', await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } }));
console.log('wrote public/og-image.png');

await browser.close();

// favicon.ico — ICO container with the 16 + 32 PNGs (PNG-in-ICO is valid)
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  const bufs = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e); bufs.push(data);
  }
  return Buffer.concat([header, ...entries, ...bufs]);
}
const ico = buildIco([
  { size: 16, data: readFileSync('public/favicon-16x16.png') },
  { size: 32, data: readFileSync('public/favicon-32x32.png') },
]);
writeFileSync('public/favicon.ico', ico);
console.log('wrote public/favicon.ico');
