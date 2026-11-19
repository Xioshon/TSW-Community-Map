// Convert PNG stickers (with alpha) to WebP using headless Chrome's encoder.
// Usage: node scripts/to_webp.mjs <quality 0-1> <file.png> [...]   → writes file.webp next to each
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [, , q, ...files] = process.argv;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9336", "--user-data-dir=/tmp/tsw-webp-prof", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40; i++) { try { const t = (await (await fetch("http://127.0.0.1:9336/json")).json()).find((x) => x.type === "page"); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
for (const f of files) {
  const b64 = readFileSync(f).toString("base64");
  const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const img = new Image(); img.src = "data:image/png;base64,${b64}"; await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight); c.getContext("2d").drawImage(img, 0, 0);
    const a = new Uint8Array(await (await c.convertToBlob({ type: "image/webp", quality: ${q} })).arrayBuffer());
    let s = ""; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); })()` });
  const out = f.replace(/\.png$/, ".webp");
  writeFileSync(out, Buffer.from(r.result.result.value, "base64"));
  console.log(out);
}
ws.close(); chrome.kill();
