/* 项目卡片的内容写在 index.html 里（搜索引擎和不执行 JS 的抓取才能看到），
   这里只负责筛选、首屏计数和入场动画。新增项目：在 HTML 的 #project-grid 里加一张卡片，
   data-kind 用 mini / app / web / plugin / ai / game / tool，同时补进 head 的 JSON-LD。 */

const cards = [...document.querySelectorAll("#project-grid .card")];
const emptyState = document.getElementById("empty-state");
const filterButtons = [...document.querySelectorAll(".chip")];

function applyFilter(filter) {
  let shown = 0;
  for (const card of cards) {
    const on = filter === "all" || card.dataset.kind === filter;
    card.hidden = !on;
    if (on) shown += 1;
  }
  emptyState.hidden = shown > 0;
}

function countUp(el, target) {
  if (target <= 0) {
    el.textContent = "0";
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = String(target);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 700);
    el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  /* 后台标签页会挂起动画帧，这里保证数字最终落位 */
  setTimeout(() => {
    el.textContent = String(target);
  }, 800);
}

function fillStats() {
  const counts = {
    live: cards.filter((c) => c.querySelector(".status-live")).length,
    total: cards.length,
    kinds: new Set(cards.map((c) => c.dataset.kind)).size,
  };
  for (const el of document.querySelectorAll("[data-count]")) {
    countUp(el, counts[el.dataset.count] ?? 0);
  }
}

/* 入场动画的初始隐藏状态由脚本加上，禁用 JS 时卡片照常完整显示 */
function setupReveal() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;
  for (const card of cards) card.classList.add("reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  for (const card of cards) observer.observe(card);
  /* 观察器没机会触发时（打印、极短页面、面板被隐藏）也必须让内容可见 */
  setTimeout(() => {
    for (const card of cards) card.classList.add("is-in");
  }, 900);
}

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    for (const other of filterButtons) {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", String(on));
    }
    applyFilter(button.dataset.filter);
  });
}

/* 小程序没法用链接从网页里直接唤起（微信禁止在微信内再用 scheme 跳小程序，
   scheme 还要后台声明页面路径），所以点开后在卡片里就地展开小程序码。
   这里刻意不用 fixed 浮层：微信的长按识别是长按时截屏跑识码算法，
   iOS 上码被 position:fixed 的祖先包住时经常识别不出来。 */
const mpPanel = document.getElementById("mp-panel");
const mpTip = document.getElementById("mp-tip");
const mpBtn = document.querySelector(".mp-link");
const isMobile = window.matchMedia("(pointer: coarse)").matches || /Mobile/i.test(navigator.userAgent);
const mpTipText = /MicroMessenger/i.test(navigator.userAgent)
  ? "长按上方图片，选「识别图中小程序码」。"
  : isMobile
    ? "长按保存图片，再到微信「扫一扫」右上角选相册。"
    : "用微信「扫一扫」对准这个码。";

mpBtn.addEventListener("click", () => {
  const open = mpPanel.hidden;
  mpPanel.hidden = !open;
  mpBtn.setAttribute("aria-expanded", String(open));
  mpBtn.textContent = open ? "收起小程序码" : "在微信中打开";
  if (open) {
    mpTip.textContent = mpTipText;
    /* 顶栏会盖住一部分，居中展开保证码完整落在屏幕里 */
    mpPanel.scrollIntoView({ block: "center" });
  }
});

document.getElementById("year").textContent = String(new Date().getFullYear());
fillStats();
setupReveal();
