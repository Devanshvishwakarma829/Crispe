/* CRISPÉ — mobile-safe canvas scroll film
   Scroll position drives an image sequence.
   The important rule: NEVER decode hundreds of full-resolution frames at once.
   Mobile devices get a small decoded window and frames are fetched on demand. */

const canvas = document.getElementById("film");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const track = document.getElementById("track");
const loader = document.getElementById("loader");
const loadbar = document.getElementById("loadbar");
const scrollCue = document.getElementById("scroll-cue");
const captions = [...document.querySelectorAll(".caption")];

const IS_MOBILE = matchMedia("(max-width: 800px), (pointer: coarse)").matches;
const KEEP = IS_MOBILE ? 10 : 18;          // decoded frames kept around playhead
const AHEAD = IS_MOBILE ? 5 : 10;          // frames fetched/decoded ahead
const MAX_DECODE_W = IS_MOBILE ? 720 : 1400;
const FETCH_CONCURRENCY = IS_MOBILE ? 2 : 4;

const state = {
  blobs: [],
  bitmaps: new Map(),
  count: 0,
  pattern: "",
  current: -1,
  target: 0,
  smooth: 0,
  dir: 1,
  ready: false,
  decoding: new Set(),
  fetching: new Set(),
  requested: new Set(),
  queue: [],
  active: 0,
};

function loadManifest() {
  return fetch("frames/frames.json", { cache: "force-cache" }).then(res => {
    if (!res.ok) throw new Error("no manifest");
    return res.json();
  });
}

function frameURL(i) {
  return state.pattern.replace("%04d", String(i + 1).padStart(4, "0"));
}

async function fetchBlob(i) {
  if (i < 0 || i >= state.count) return null;
  if (state.blobs[i]) return state.blobs[i];
  if (state.fetching.has(i)) {
    while (state.fetching.has(i) && !state.blobs[i]) {
      await new Promise(r => setTimeout(r, 10));
    }
    return state.blobs[i] || null;
  }

  state.fetching.add(i);
  try {
    const res = await fetch(frameURL(i), { cache: "force-cache" });
    if (!res.ok) throw new Error(`frame ${i + 1} failed`);
    const blob = await res.blob();
    state.blobs[i] = blob;
    return blob;
  } catch {
    return null;
  } finally {
    state.fetching.delete(i);
  }
}

async function decode(i) {
  if (i < 0 || i >= state.count) return;
  if (state.bitmaps.has(i) || state.decoding.has(i)) return;
  const blob = state.blobs[i];
  if (!blob) return;

  state.decoding.add(i);
  try {
    const maxW = Math.max(320, Math.min(MAX_DECODE_W, Math.round(canvas.clientWidth * (IS_MOBILE ? 1.15 : 1.25))));
    const bmp = await createImageBitmap(blob, {
      resizeWidth: maxW,
      resizeHeight: Math.round(maxW * 788 / 1400),
      resizeQuality: IS_MOBILE ? "low" : "medium",
    });
    // A frame may have been evicted while decode was in flight.
    if (!state.bitmaps.has(i)) state.bitmaps.set(i, bmp);
    else bmp.close();
  } catch {
    // Retry when this frame becomes important again.
  } finally {
    state.decoding.delete(i);
  }
}

async function fetchAndDecode(i) {
  const blob = await fetchBlob(i);
  if (blob) await decode(i);
}

function requestFrame(i) {
  if (i < 0 || i >= state.count || state.requested.has(i)) return;
  state.requested.add(i);
  state.queue.push(i);
  pumpQueue();
}

function pumpQueue() {
  while (state.active < FETCH_CONCURRENCY && state.queue.length) {
    // Prefer the newest request so a fast swipe does not waste time decoding
    // frames the user has already scrolled past.
    const i = state.queue.pop();
    state.active++;
    fetchAndDecode(i).finally(() => {
      state.active--;
      state.requested.delete(i);
      pumpQueue();
    });
  }
}

function manageWindow(center) {
  // Queue nearby frames first, then put the current frame last so it is
  // popped first by the LIFO queue.
  for (let d = AHEAD; d >= 1; d--) {
    const fwd = center + d * state.dir;
    const back = center - Math.min(d, 3) * state.dir;
    requestFrame(fwd);
    requestFrame(back);
  }
  requestFrame(center);

  // Keep RAM bounded. A decoded 1400×788 RGB frame is several MB.
  for (const [idx, bmp] of state.bitmaps) {
    if (Math.abs(idx - center) > KEEP) {
      bmp.close();
      state.bitmaps.delete(idx);
    }
  }
}

function nearestDecoded(i) {
  if (state.bitmaps.has(i)) return i;

  // Only search locally. Scanning hundreds of frames on every scroll tick
  // is unnecessary and can make a mobile main thread feel frozen.
  for (let d = 1; d <= KEEP + AHEAD + 4; d++) {
    const a = i - d;
    const b = i + d;
    if (a >= 0 && state.bitmaps.has(a)) return a;
    if (b < state.count && state.bitmaps.has(b)) return b;
  }
  return -1;
}

async function preload() {
  const EAGER = IS_MOBILE ? 12 : 24;
  let done = 0;
  const first = Math.min(EAGER, state.count);

  // Only load a tiny opening window before unlocking the page.
  await Promise.all(
    Array.from({ length: first }, async (_, i) => {
      await fetchAndDecode(i);
      done++;
      loadbar.style.width = `${(done / first) * 100}%`;
    })
  );

  state.ready = true;
  loader.classList.add("done");

  // Do NOT fetch the whole film here. It wastes bandwidth and memory on
  // phones. Frames are fetched just ahead of the user's scroll position.
  manageWindow(0);
}

/* ── drawing ───────────────────────────────────────────── */

let lastW = 0, lastH = 0;
function doResize() {
  const dpr = IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w === canvas.width && h === canvas.height) return;

  canvas.width = w;
  canvas.height = h;
  state.current = -1;

  // Old decoded frames may have been sized for the previous viewport.
  if (state.bitmaps.size > KEEP + 4) {
    for (const [idx, bmp] of state.bitmaps) {
      if (Math.abs(idx - Math.round(state.target)) > KEEP) {
        bmp.close();
        state.bitmaps.delete(idx);
      }
    }
  }
}

// Ignore mobile browser toolbar-height jitter. Only a real width/orientation
// change should recreate the canvas.
let resizeTimer = null;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const widthChanged = w !== lastW;
  const heightChangedALot = Math.abs(h - lastH) > Math.max(160, lastH * 0.3);

  lastW = w;
  lastH = h;

  if (!widthChanged && !heightChangedALot) return;

  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    doResize();
    requestFrame(Math.round(state.target));
  }, 150);
}

function drawFrame(i) {
  const j = nearestDecoded(i);
  if (j < 0) return;

  const bmp = state.bitmaps.get(j);
  if (!bmp) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, cw, ch);

  const s = Math.min(cw / bmp.width, ch / bmp.height) * 1.04;
  const w = bmp.width * s;
  const h = bmp.height * s;
  ctx.drawImage(bmp, (cw - w) / 2, (ch - h) / 2, w, h);

  state.current = j;
}

/* ── scroll mapping ────────────────────────────────────── */

function progress() {
  const max = track.offsetHeight - window.innerHeight;
  return max > 0
    ? Math.min(1, Math.max(0, window.scrollY / max))
    : 0;
}

function updateCaptions(p) {
  for (const el of captions) {
    const tIn = +el.dataset.in;
    const tHold = +el.dataset.hold;
    const tOut = +el.dataset.out;
    const rise = Math.max((tHold - tIn) * 0.4, 0.008);
    const fall = Math.max((tOut - tHold) * 0.6, 0.008);
    let o = 0;

    if (p >= tIn && p <= tOut) {
      o = Math.min((p - tIn) / rise, 1) *
          Math.min((tOut - p) / fall, 1);
      o = Math.min(Math.max(o, 0), 1);
    }

    el.style.opacity = o.toFixed(3);
    const drift = (p - tHold) * -40;
    el.style.transform =
      `${transformBase(el)} translateY(${drift.toFixed(1)}px)`;
  }

  scrollCue.style.opacity = p < 0.015 ? 1 : 0;
}

function transformBase(el) {
  if (el.classList.contains("cap-center")) return "translate(-50%, -50%)";
  if (el.classList.contains("cap-top") || el.classList.contains("cap-bottom")) {
    return "translateX(-50%)";
  }
  return "translateY(-50%)";
}

/* ── main loop ─────────────────────────────────────────── */

let lastT = performance.now();
function tick(now) {
  const dt = Math.min((now - lastT) / 1000, 0.25) || 0.016;
  lastT = now;

  if (state.ready) {
    const p = progress();
    const prevTarget = state.target;
    state.target = p * (state.count - 1);

    if (state.target !== prevTarget) {
      state.dir = state.target >= prevTarget ? 1 : -1;
    }

    // Slightly faster response so touch scrolling doesn't feel like it is
    // fighting the animation.
    const k = 1 - Math.exp(-dt * (IS_MOBILE ? 20 : 16));
    state.smooth += (state.target - state.smooth) * k;

    if (Math.abs(state.target - state.smooth) < 0.35) {
      state.smooth = state.target;
    }

    const i = Math.round(state.smooth);
    manageWindow(i);

    if (i !== state.current) drawFrame(i);
    updateCaptions(p);
  }

  requestAnimationFrame(tick);
}

/* ── boot ──────────────────────────────────────────────── */

function devPlaceholder(msg) {
  loader.classList.add("done");
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, "#141210");
    g.addColorStop(1, "#050505");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(212,175,90,0.85)";
    ctx.font = `${16 * (window.devicePixelRatio || 1)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
  };
  draw();
  window.addEventListener("resize", () => {
    resize();
    setTimeout(draw, 130);
  });
}

window.addEventListener("resize", resize);
lastW = window.innerWidth;
lastH = window.innerHeight;
doResize();

loadManifest()
  .then((m) => {
    state.count = m.count;
    state.pattern = m.pattern;
    state.blobs = new Array(m.count).fill(null);
    requestAnimationFrame(tick);
    return preload();
  })
  .catch(() => devPlaceholder("frames not built yet — run tools/build_frames.py"));
