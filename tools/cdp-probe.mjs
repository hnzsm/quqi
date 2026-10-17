/* 本地调试用：用 CDP 起一个真实前台 headless 页面，跑真实帧循环后取数据/截图。
   用法：node tools/cdp-probe.mjs <url> <ms> [expr] [out.png] [--w=1280] [--h=900] */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const url = args[0];
const waitMs = Number(args[1] ?? 2000);
const expr = args[2] ?? "(() => { const s = document.querySelector('.spider'); return s ? s.style.transform : 'no-spider'; })()";
const out = args.find((a) => a.endsWith(".png"));
const w = Number((args.find((a) => a.startsWith("--w=")) ?? "--w=1280").slice(4));
const h = Number((args.find((a) => a.startsWith("--h=")) ?? "--h=900").slice(4));
if (!url) throw new Error("need url");

const port = 9333;
const profile = join(tmpdir(), `cdp-probe-${Date.now()}`);

execFile(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, url,
], () => {});

let target;
for (let i = 0; i < 60; i += 1) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
}
if (!target) throw new Error("no devtools target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Log.entryAdded") {
    logs.push(JSON.stringify(msg.params).slice(0, 300));
  }
  const p = pending.get(msg.id);
  if (p) {
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = (id += 1);
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

const dw = (args.find((a) => a.startsWith("--dw=")) ?? "").slice(5);
if (dw) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: Number(dw), height: Number(args.find((a) => a.startsWith("--dh="))?.slice(5) ?? 844),
    deviceScaleFactor: 2, mobile: true,
  });
}

if (process.env.CDP_TOUCH) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url });
}

if (process.env.CDP_UA) {
  await send("Network.enable");
  await send("Network.setUserAgentOverride", { userAgent: process.env.CDP_UA });
  await send("Page.navigate", { url });
}

if (process.env.CDP_REDUCED) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await send("Page.navigate", { url });
}

for (let i = 0; i < 80; i += 1) {
  await sleep(250);
  try {
    const rs = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (rs.result.value === "complete") break;
  } catch {}
}
await sleep(500);

const frameCount = await send("Runtime.evaluate", {
  expression: "new Promise(r=>{let n=0;const t=performance.now();const f=()=>{n++;if(performance.now()-t<1000)requestAnimationFrame(f);else r(n)};requestAnimationFrame(f)})",
  awaitPromise: true, returnByValue: true,
});

const clickSel = process.env.CDP_CLICK;
for (const one of (clickSel ? clickSel.split("|") : [])) {
  const pos = await send("Runtime.evaluate", {
    expression: `(() => { const e = document.querySelector('${one}'); e.scrollIntoView({block:'center', behavior:'instant'}); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return JSON.stringify({x:r.x + r.width/2, y:r.y + r.height/2, text:e.textContent.trim(), hit: top ? top.tagName + '.' + top.className : 'none'}); })()`,
    returnByValue: true,
  });
  const p = JSON.parse(pos.result.value);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
  }
  console.log("clicked", one, p.text);
  await sleep(1700);
}

const hoverSel = process.env.CDP_HOVER;
if (hoverSel) {
  const hp = await send("Runtime.evaluate", {
    expression: `(() => { const e = document.querySelector('${hoverSel}'); e.scrollIntoView({block:'center', behavior:'instant'}); const r = e.getBoundingClientRect(); return JSON.stringify({x:r.x + r.width/2, y:r.y + r.height/2}); })()`,
    returnByValue: true,
  });
  const p = JSON.parse(hp.result.value);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await sleep(400);
}

const before = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
await sleep(waitMs);
const after = await send("Runtime.evaluate", { expression: expr, returnByValue: true });

console.log(JSON.stringify({
  fpsIn1s: frameCount.result.value,
  before: before.result.value,
  after: after.result.value,
  changed: before.result.value !== after.result.value,
  logs,
}, null, 2));

if (out) {
  const clipParams = { format: "png" };
  if (process.env.CDP_CLIP_SPIDER) {
    const rect = await send("Runtime.evaluate", {
      expression: "(() => { const r = document.querySelector('.spider').getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()",
      returnByValue: true,
    });
    const b = JSON.parse(rect.result.value);
    const pad = 90;
    clipParams.clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2, scale: 3 };
  } else if (process.env.CDP_FULL) {
    const dims = await send("Runtime.evaluate", {
      expression: "JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})",
      returnByValue: true,
    });
    const d = JSON.parse(dims.result.value);
    clipParams.captureBeyondViewport = true;
    clipParams.clip = { x: 0, y: 0, width: d.w, height: d.h, scale: 1 };
  }
  const shot = await send("Page.captureScreenshot", clipParams);
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log("written", out);
}
ws.close();
process.exit(0);
