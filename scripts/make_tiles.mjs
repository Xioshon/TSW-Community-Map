// Pre-render site/img/map.svg into WebP tiles so phones never rasterise the vector map while panning.
// Output: site/img/map_base.webp (whole map at 0.5x) and site/img/tiles/<level>/<col>_<row>.webp,
// each tile 512 px plus a 1 px bleed on every side (hides seams when the browser scales tiles).
// Usage: node scripts/make_tiles.mjs   (needs Google Chrome and the site served on :8765)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname;
const LEVELS = [1, 2, 3], TILE = 512, BLEED = 1, W = 1800, H = 2472;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=/tmp/tsw-tiles-prof`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40; i++) { try { const t = (await (await fetch("http://127.0.0.1:9335/json")).json()).find((x) => x.type === "page"); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.navigate", { url: "http://localhost:8765/img/map.svg" });
await sleep(1500);
await ev(`window.img = new Image(); img.src = location.href; img.decode().then(() => 1)`);
const shot = (sx, sy, s, w, h, q) => ev(`(() => { const c = new OffscreenCanvas(${w}, ${h}), g = c.getContext("2d");
  g.fillStyle = "#F4EADA"; g.fillRect(0, 0, ${w}, ${h});
  g.drawImage(img, ${-sx}, ${-sy}, ${W * s}, ${H * s});
  return c.convertToBlob({ type: "image/webp", quality: ${q} }).then((b) => b.arrayBuffer()).then((a) => { let s = ""; const u = new Uint8Array(a); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }); })()`);
const out = ROOT + "site/img/";
writeFileSync(out + "map_base.webp", Buffer.from(await shot(0, 0, .5, W / 2, H / 2, .82), "base64"));
rmSync(out + "tiles", { recursive: true, force: true });
let n = 0;
for (const s of LEVELS) {
  const cols = Math.ceil((W * s) / TILE), rows = Math.ceil((H * s) / TILE);
  mkdirSync(`${out}tiles/${s}`, { recursive: true });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const b64 = await shot(c * TILE - BLEED, r * TILE - BLEED, s, TILE + 2 * BLEED, TILE + 2 * BLEED, .86);
    writeFileSync(`${out}tiles/${s}/${c}_${r}.webp`, Buffer.from(b64, "base64")); n++;
  }
  console.log(`level ${s}: ${cols}x${rows}`);
}
console.log(n, "tiles"); ws.close(); chrome.kill();
