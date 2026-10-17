/* 页面上的机械蜘蛛：绘制交给 spider-draw.js（MIT，见 LICENSE-prompt-spider.txt），
   这里只管它在页面里怎么走——垂丝落下、停顿、横爬、再落丝。
   整层 pointer-events 关掉，不挡点击；标签页不可见时停帧。 */
import { drawSpider } from "./spider-draw.js";

const canvas = document.createElement("canvas");
canvas.className = "spider-stage";
canvas.setAttribute("aria-hidden", "true");
document.body.append(canvas);

const ctx = canvas.getContext("2d");
if (!ctx.roundRect) {
  ctx.roundRect = function (x, y, w, h, r) {
    this.beginPath();
    this.rect(x, y, w, h);
  };
}

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (min, max) => min + Math.random() * (max - min);
const view = () => ({ w: innerWidth, h: innerHeight });

let scale = 1;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const { w, h } = view();
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.max(0.62, Math.min(w / 1150, 1.05));
}
resize();

const state = {
  x: 0, y: 0, vx: 0, vy: 0,
  mode: "drop",
  dropFrom: 0, dropTo: 0,
  targetX: 0, targetY: 0,
  restUntil: 0,
  silk: 0,
};

function startDrop(fromTop = true) {
  const { w, h } = view();
  state.mode = "drop";
  if (fromTop) state.x = rand(70, w - 70);
  state.dropFrom = state.y;
  state.y = -60 * scale;
  state.dropTo = rand(h * 0.26, h * 0.6);
  state.silk = 1;
}

function pickTarget() {
  const { w, h } = view();
  let x = state.x;
  let y = state.y;
  for (let i = 0; i < 8; i += 1) {
    x = rand(64, w - 64);
    y = rand(96, h - 84);
    if (Math.hypot(x - state.x, y - state.y) > 200) break;
  }
  state.targetX = x;
  state.targetY = y;
}

state.x = view().w * 0.72;
startDrop();

const WALK = 92;
const DROP = 118;

function step(dt, now) {
  const { w, h } = view();
  state.vx = 0;
  state.vy = 0;

  if (state.mode === "drop") {
    state.vy = DROP;
    state.y += state.vy * dt;
    if (state.y >= state.dropTo) {
      state.y = state.dropTo;
      state.mode = "rest";
      state.restUntil = now + rand(900, 2000);
    }
  } else if (state.mode === "rest") {
    state.y += Math.sin(now / 620) * 0.12;
    if (now >= state.restUntil) {
      state.mode = "climb";
      state.dropTo = rand(40, h * 0.22);
    }
  } else if (state.mode === "climb") {
    state.vy = -DROP * 0.72;
    state.y += state.vy * dt;
    if (state.y <= state.dropTo) {
      state.y = state.dropTo;
      state.mode = "walk";
      state.silk = 0;
      pickTarget();
    }
  } else if (state.mode === "walk") {
    const dx = state.targetX - state.x;
    const dy = state.targetY - state.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) {
      state.mode = Math.random() < 0.45 ? "drop" : "rest";
      if (state.mode === "drop") startDrop();
      else state.restUntil = now + rand(700, 1800);
    } else {
      state.vx = (dx / dist) * WALK;
      state.vy = (dy / dist) * WALK;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
    }
  }

  state.x = Math.max(40, Math.min(w - 40, state.x));
  state.y = Math.max(-60, Math.min(h - 40, state.y));
}

function drawThread() {
  if (state.silk <= 0 || state.y <= 0) return;
  const grad = ctx.createLinearGradient(0, 0, 0, state.y);
  grad.addColorStop(0, "rgba(53, 240, 255, 0)");
  grad.addColorStop(0.35, "rgba(53, 240, 255, 0.34)");
  grad.addColorStop(1, "rgba(255, 47, 126, 0.5)");
  ctx.beginPath();
  ctx.moveTo(state.x + Math.sin(state.y / 90) * 1.6, 0);
  ctx.lineTo(state.x, state.y - 26 * scale);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1;
  ctx.stroke();
}

let time = 0;
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawThread();
  ctx.save();
  ctx.translate(state.x, state.y);
  ctx.scale(scale, scale);
  ctx.translate(-state.x, -state.y);
  drawSpider(ctx, {
    x: state.x, y: state.y, time, vx: state.vx, vy: state.vy,
    activeProbes: 16, phase: 0, score: 0.95, reducedMotion: reduce,
  });
  ctx.restore();
}

if (reduce) {
  state.x = view().w * 0.78;
  state.y = 150;
  render();
  addEventListener("resize", () => {
    resize();
    state.x = Math.min(view().w * 0.78, view().w - 40);
    render();
  });
} else {
  let last = performance.now();
  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) last = performance.now();
  });
  addEventListener("resize", resize);
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (!running) return;
    const dt = Math.min(0.048, (now - last) / 1000);
    last = now;
    time += dt;
    step(dt, now);
    render();
  };
  requestAnimationFrame(frame);
}
