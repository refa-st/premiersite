const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const levelEl = document.getElementById("level");
const timeEl = document.getElementById("time");
const hintEl = document.getElementById("hint");
const recalBtn = document.getElementById("recal");
const overlay = document.getElementById("overlay");
const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const startBtn = document.getElementById("start");
const msgEl = document.getElementById("msg");

/* Réglages (les distances sont en « cases » du labyrinthe) */
const MAX_ANGLE = 25; // inclinaison (en degrés) pour la force maximale
const ACCEL = 35; // force de l'inclinaison
const MAX_SPEED = 9; // vitesse maximale de la bille
const FRICTION = 2.5; // frottements
const BOUNCE = 0.3; // rebond contre les murs
const RADIUS = 0.3; // rayon de la bille

let maze,
  W,
  H,
  cell = 20;
let ball = { x: 1.5, y: 1.5, vx: 0, vy: 0 };
let level = 1;
let running = false;
let startTime = 0;
let elapsed = 0;
let lastFrame = 0;

/* ---------- Capteur d'inclinaison ---------- */

let hasSensor = false;
const raw = { beta: 0, gamma: 0 };
let offset = { x: 0, y: 0 };
const keys = {};

window.addEventListener("deviceorientation", (e) => {
  if (e.beta === null || e.gamma === null) return;
  hasSensor = true;
  raw.beta = e.beta;
  raw.gamma = e.gamma;
});

/* Inclinaison dans le repère de l'écran, selon l'orientation du téléphone */
function sensorXY() {
  const a = screen.orientation
    ? screen.orientation.angle
    : window.orientation || 0;
  const angle = (a + 360) % 360;
  switch (angle) {
    case 90:
      return { x: -raw.beta, y: -raw.gamma };
    case 180:
      return { x: -raw.gamma, y: -raw.beta };
    case 270:
      return { x: raw.beta, y: raw.gamma };
    default:
      return { x: raw.gamma, y: raw.beta };
  }
}

function calibrate() {
  offset = sensorXY();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* Renvoie une inclinaison entre -1 et 1 sur chaque axe */
function getTilt() {
  if (hasSensor) {
    const s = sensorXY();
    return {
      x: clamp((s.x - offset.x) / MAX_ANGLE, -1, 1),
      y: clamp((s.y - offset.y) / MAX_ANGLE, -1, 1),
    };
  }
  // Secours pour tester sur ordinateur : les flèches du clavier
  return {
    x: (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0),
    y: (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0),
  };
}

window.addEventListener("keydown", (e) => {
  if (e.key.startsWith("Arrow")) {
    keys[e.key] = true;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key.startsWith("Arrow")) keys[e.key] = false;
});

/* iPhone : il faut demander l'autorisation, depuis un clic */
async function enableSensors() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    try {
      const result = await DOE.requestPermission();
      if (result !== "granted") {
        msgEl.textContent =
          "Accès au capteur refusé. Sur iPhone, ferme l'onglet Safari, rouvre la page puis accepte la demande.";
        return false;
      }
    } catch (err) {
      msgEl.textContent = "Impossible d'activer le capteur : " + err.message;
      return false;
    }
  }
  return true;
}

function waitForSensor(ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function check() {
      if (hasSensor || performance.now() - t0 > ms) resolve();
      else setTimeout(check, 50);
    })();
  });
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch (e) {
    /* facultatif */
  }
}

/* ---------- Labyrinthe ---------- */

/* 1 = mur, 0 = couloir. Algorithme du « parcours en profondeur ». */
function generateMaze(cols, rows) {
  const w = cols * 2 + 1;
  const h = rows * 2 + 1;
  const g = Array.from({ length: h }, () => Array(w).fill(1));
  const stack = [[1, 1]];
  g[1][1] = 0;

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ].filter(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && g[ny][nx] === 1;
    });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[Math.floor(Math.random() * options.length)];
    g[y + dy / 2][x + dx / 2] = 0;
    g[y + dy][x + dx] = 0;
    stack.push([x + dx, y + dy]);
  }
  return g;
}

function layout() {
  if (!maze) return;
  const availW = window.innerWidth;
  const availH = window.innerHeight - hudEl.offsetHeight - 8;
  cell = Math.max(8, Math.floor(Math.min(availW / W, availH / H)));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * cell * dpr;
  canvas.height = H * cell * dpr;
  canvas.style.width = W * cell + "px";
  canvas.style.height = H * cell + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startLevel() {
  const cols = Math.min(3 + level, 8);
  const rows = Math.min(5 + level * 2, 14);
  maze = generateMaze(cols, rows);
  W = cols * 2 + 1;
  H = rows * 2 + 1;
  ball = { x: 1.5, y: 1.5, vx: 0, vy: 0 };
  levelEl.textContent = level;
  timeEl.textContent = "0.0 s";
  layout();
  overlay.hidden = true;
  running = true;
  startTime = performance.now();
  lastFrame = performance.now();
}

function win() {
  running = false;
  if (navigator.vibrate) navigator.vibrate(200);
  titleEl.textContent = "🎉 Sortie atteinte !";
  textEl.textContent = `Niveau ${level} terminé en ${elapsed.toFixed(1)} s.`;
  startBtn.textContent = "Niveau suivant";
  startBtn.dataset.mode = "next";
  overlay.hidden = false;
}

/* ---------- Physique ---------- */

function collide() {
  const r = RADIUS;
  const x0 = Math.floor(ball.x - r),
    x1 = Math.floor(ball.x + r);
  const y0 = Math.floor(ball.y - r),
    y1 = Math.floor(ball.y + r);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if ((maze[ty] || [])[tx] !== 1) continue;

      // point du mur (la case) le plus proche du centre de la bille
      const cx = clamp(ball.x, tx, tx + 1);
      const cy = clamp(ball.y, ty, ty + 1);
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;

      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      ball.x = cx + nx * r;
      ball.y = cy + ny * r;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= (1 + BOUNCE) * vn * nx;
        ball.vy -= (1 + BOUNCE) * vn * ny;
      }
    }
  }
}

function update(dt) {
  const t = getTilt();
  const steps = 4;
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    ball.vx += t.x * ACCEL * h;
    ball.vy += t.y * ACCEL * h;

    const f = Math.max(0, 1 - FRICTION * h);
    ball.vx *= f;
    ball.vy *= f;

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      ball.vx *= MAX_SPEED / speed;
      ball.vy *= MAX_SPEED / speed;
    }

    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    collide();
  }
}

/* ---------- Dessin ---------- */

function draw() {
  if (!maze) return;

  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(0, 0, W * cell, H * cell);

  ctx.fillStyle = "#3a4a8c";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (maze[y][x] === 1) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // sortie
  const ex = (W - 1.5) * cell;
  const ey = (H - 1.5) * cell;
  ctx.save();
  ctx.shadowColor = "#f5c542";
  ctx.shadowBlur = cell;
  ctx.fillStyle = "#f5c542";
  ctx.beginPath();
  ctx.arc(ex, ey, cell * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // bille
  const bx = ball.x * cell;
  const by = ball.y * cell;
  const br = RADIUS * cell;
  const grad = ctx.createRadialGradient(
    bx - br * 0.3,
    by - br * 0.3,
    br * 0.1,
    bx,
    by,
    br,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#6fb1ff");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------- Boucle principale ---------- */

function frame(ts) {
  const dt = Math.min((ts - lastFrame) / 1000, 1 / 30);
  lastFrame = ts;

  if (running) {
    update(dt);
    elapsed = (performance.now() - startTime) / 1000;
    timeEl.textContent = elapsed.toFixed(1) + " s";
    if (Math.hypot(ball.x - (W - 1.5), ball.y - (H - 1.5)) < 0.5) win();
  }

  draw();
  requestAnimationFrame(frame);
}

/* ---------- Boutons et événements ---------- */

startBtn.addEventListener("click", async () => {
  if (startBtn.dataset.mode === "next") {
    level++;
    startLevel();
    return;
  }

  msgEl.textContent = "";
  const ok = await enableSensors();
  if (!ok) return;

  await waitForSensor(800);
  if (hasSensor) {
    calibrate();
    hintEl.textContent = "";
  } else {
    hintEl.textContent =
      "Aucun capteur détecté (sur téléphone, la page doit être en HTTPS). Flèches du clavier activées.";
  }

  keepAwake();
  startLevel();
});

recalBtn.addEventListener("click", () => {
  if (hasSensor) calibrate();
});

window.addEventListener("resize", layout);

const onRotate = () =>
  setTimeout(() => {
    if (hasSensor) calibrate();
    layout();
  }, 300);
if (screen.orientation) screen.orientation.addEventListener("change", onRotate);
else window.addEventListener("orientationchange", onRotate);

requestAnimationFrame(frame);
