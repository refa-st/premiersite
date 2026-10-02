const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const levelEl = document.getElementById("level");
const hitsEl = document.getElementById("hits");
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
const ACCEL = 32; // force de l'inclinaison
const MAX_SPEED = 7; // vitesse maximale de la bille
const FRICTION = 3; // frottements normaux
const ICE_FRICTION = 0.35; // frottements sur la glace (la bille glisse)
const BOUNCE = 0.3; // rebond contre les murs
const RADIUS = 0.3; // rayon de la bille
const GHOST_R = 0.34; // rayon (dessin) du fantôme
const HIT_DIST = RADIUS + GHOST_R * 0.75; // distance de touche du fantôme
const SPIKE_HIT = 0.35; // zone mortelle d'un pic (en cases, autour de son centre)
const SPIKE_UP = 0.45; // part du cycle pendant laquelle les pics sont sortis
const SPIKE_WARN = 0.45; // durée (en secondes) de l'avertissement avant la sortie des pics

/* Ce qui est nouveau à chaque niveau (annoncé avant d'y entrer) */
const NEWS = {
  2: "Nouveau : des zones de glace. La bille glisse, anticipe tes freinages !",
  3: "Un deuxième fantôme arrive, et le labyrinthe se complique.",
  5: "Un troisième fantôme patrouille. Les pièges se multiplient !",
  7: "Un quatrième fantôme. Bonne chance !",
};

let maze,
  W,
  H,
  cell = 20;
let ball = { x: 1.5, y: 1.5, vx: 0, vy: 0 };
let ghosts = [];
let spikes = [];
let iceSet = new Set();
let spikePeriod = 3;
let level = 1;
let deaths = 0;
let levelDeaths = 0;
let flash = 0;
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

/* Chemin le plus court du départ à la sortie (parcours en largeur) */
function solvePath(g, w, h) {
  const key = (x, y) => y * w + x;
  const goal = [w - 2, h - 2];
  const prev = new Map([[key(1, 1), null]]);
  const queue = [[1, 1]];

  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === goal[0] && y === goal[1]) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (g[ny][nx] === 0 && !prev.has(key(nx, ny))) {
        prev.set(key(nx, ny), [x, y]);
        queue.push([nx, ny]);
      }
    }
  }

  const path = [];
  let cur = goal;
  while (cur) {
    path.push(cur);
    cur = prev.get(key(cur[0], cur[1]));
  }
  return path.reverse();
}

/* Cherche les carrefours où le chemin de la sortie traverse (en ligne droite,
   verticalement) une branche horizontale. Le fantôme patrouillera dans cette
   branche : le joueur attend avant le carrefour, puis traverse quand le
   fantôme est loin. */
function findCrossings(g, path) {
  const out = [];
  for (let i = 2; i < path.length - 1; i++) {
    const [x, y] = path[i];
    const prev = path[i - 1];
    const next = path[i + 1];
    if (x % 2 !== 1 || y % 2 !== 1) continue; // un carrefour est une « vraie » case
    if (prev[0] !== x || next[0] !== x) continue; // le chemin doit traverser en ligne droite

    let l = 0;
    while (l < 3 && g[y][x - 1 - l] === 0) l++;
    let r = 0;
    while (r < 3 && g[y][x + 1 + r] === 0) r++;
    if (l + r < 3) continue; // branche trop courte pour patrouiller

    out.push({ idx: i, x, y, l, r });
  }
  return out;
}

function pickCrossings(list, count) {
  const pool = [...list].sort(() => Math.random() - 0.5);
  const chosen = [];
  for (const c of pool) {
    if (chosen.length >= count) break;
    if (chosen.every((o) => o.y !== c.y && Math.abs(o.idx - c.idx) > 6))
      chosen.push(c);
  }
  return chosen;
}

/* ---------- Difficulté selon le niveau ---------- */

function ghostCount(lv) {
  return Math.min(1 + Math.floor((lv - 1) / 2), 4);
}
function ghostSpeed(lv) {
  return Math.min(1.0 + lv * 0.12, 2.2);
} // cases par seconde
function spikeCount(lv) {
  return Math.min(2 + (lv - 1) * 2, 16);
} // pics sur le chemin
function decoyCount(lv) {
  return Math.min(lv * 2, 14);
} // pics cachés dans les culs-de-sac
function iceCount(lv) {
  return lv >= 2 ? Math.min(lv - 1, 6) : 0;
} // bandes de glace
function spikeCycle(lv) {
  return Math.max(3.0 - lv * 0.12, 2.0);
} // secondes par cycle

/* Place les pièges : sur le chemin de la sortie (le joueur doit les traverser)
   et dans les culs-de-sac (ils punissent les mauvais détours). Distances de
   sécurité avec les fantômes et entre pièges : chaque niveau reste faisable. */
function placeHazards(path, crossings, ghostList) {
  const last = path.length - 1;
  const nearGhost = (i, d) => crossings.some((c) => Math.abs(c.idx - i) <= d);
  const order = () =>
    [...Array(path.length).keys()].sort(() => Math.random() - 0.5);

  // 1) pics sur le chemin
  const newSpikes = [];
  for (const i of order()) {
    if (newSpikes.length >= spikeCount(level)) break;
    if (i < 3 || i > last - 2) continue;
    if (nearGhost(i, 3)) continue;
    if (newSpikes.some((s) => Math.abs(s.idx - i) < 3)) continue;
    newSpikes.push({
      idx: i,
      x: path[i][0] + 0.5,
      y: path[i][1] + 0.5,
      phase: Math.random() * spikePeriod,
    });
  }

  // 2) bandes de glace (3 cases) sur le chemin
  const strips = [];
  const used = new Set();
  for (const s of order()) {
    if (strips.length >= iceCount(level)) break;
    if (s < 3 || s + 2 > last - 2) continue;
    const strip = [s, s + 1, s + 2];
    const bad = strip.some(
      (i) =>
        used.has(i) ||
        nearGhost(i, 3) ||
        newSpikes.some((sp) => Math.abs(sp.idx - i) <= 2),
    );
    if (bad) continue;
    strip.forEach((i) => used.add(i));
    strips.push(strip);
  }
  const ice = new Set();
  strips.flat().forEach((i) => ice.add(path[i][1] * W + path[i][0]));

  // 3) pics cachés dans les culs-de-sac (hors du chemin)
  const onPath = new Set(path.map(([x, y]) => y * W + x));
  const candidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (maze[y][x] !== 0 || onPath.has(y * W + x)) continue;
      if (x + y < 6) continue; // zone de départ
      if (Math.abs(x - (W - 2)) + Math.abs(y - (H - 2)) < 4) continue; // zone de la sortie
      if (path.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) <= 1))
        continue; // pas collé au chemin
      if (
        ghostList.some(
          (g) =>
            Math.floor(g.y) === y &&
            x + 0.5 >= g.x1 - 0.5 &&
            x + 0.5 <= g.x2 + 0.5,
        )
      )
        continue;
      candidates.push([x, y]);
    }
  }
  candidates.sort(() => Math.random() - 0.5);

  const decoys = [];
  for (const [x, y] of candidates) {
    if (decoys.length >= decoyCount(level)) break;
    if (
      decoys.some((d) => Math.abs(d.x - 0.5 - x) + Math.abs(d.y - 0.5 - y) < 3)
    )
      continue;
    decoys.push({
      idx: -1,
      x: x + 0.5,
      y: y + 0.5,
      phase: Math.random() * spikePeriod,
    });
  }

  return { newSpikes: newSpikes.concat(decoys), ice };
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

function startLevel(isRetry) {
  const cols = Math.min(4 + level, 9);
  const rows = Math.min(7 + level * 2, 16);
  W = cols * 2 + 1;
  H = rows * 2 + 1;
  spikePeriod = spikeCycle(level);
  if (!isRetry) levelDeaths = 0;

  // On génère plusieurs labyrinthes et on garde celui dont le chemin de la sortie
  // est le plus long (donc le plus tortueux), avec assez de carrefours pour les fantômes.
  const wanted = ghostCount(level);
  let best = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const m = generateMaze(cols, rows);
    const path = solvePath(m, W, H);
    const chosen = pickCrossings(findCrossings(m, path), wanted);
    const score =
      (chosen.length >= wanted ? 1000 : chosen.length * 100) + path.length;
    if (!best || score > best.score) best = { m, path, chosen, score };
    if (attempt >= 30 && best.chosen.length >= wanted) break;
  }
  maze = best.m;

  const speed = ghostSpeed(level);
  ghosts = best.chosen.map((c) => {
    const x1 = c.x - c.l + 0.5;
    const x2 = c.x + c.r + 0.5;
    return {
      x1,
      x2,
      y: c.y + 0.5,
      x: x1,
      dir: 1,
      speed,
      t: Math.random() * 2 * (x2 - x1),
    };
  });

  const hazards = placeHazards(best.path, best.chosen, ghosts);
  spikes = hazards.newSpikes;
  iceSet = hazards.ice;

  ball = { x: 1.5, y: 1.5, vx: 0, vy: 0 };
  flash = 0;
  hitsEl.textContent = deaths;
  levelEl.textContent = level;
  timeEl.textContent = "0.0 s";
  startBtn.dataset.mode = "";
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
  const news = NEWS[level + 1];
  textEl.textContent =
    `Niveau ${level} terminé en ${elapsed.toFixed(1)} s` +
    (levelDeaths
      ? ` après ${levelDeaths} mort${levelDeaths > 1 ? "s" : ""}.`
      : ", sans mourir 👏") +
    (news ? " " + news : "");
  startBtn.textContent = "Niveau suivant";
  startBtn.dataset.mode = "next";
  overlay.hidden = false;
}

/* Un fantôme ou des pics t'ont touché : c'est perdu */
function die(cause) {
  if (!running) return;
  running = false;
  deaths++;
  levelDeaths++;
  hitsEl.textContent = deaths;
  flash = 0.8;
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);

  setTimeout(() => {
    titleEl.textContent = "💀 Perdu !";
    textEl.textContent =
      cause === "ghost"
        ? "Un fantôme t'a attrapé… Le labyrinthe est regénéré."
        : "Tu as marché sur des pics… Le labyrinthe est regénéré.";
    startBtn.textContent = "Rejouer le niveau " + level;
    startBtn.dataset.mode = "retry";
    overlay.hidden = false;
  }, 700);
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

    const onIce = iceSet.has(Math.floor(ball.y) * W + Math.floor(ball.x));
    const f = Math.max(0, 1 - (onIce ? ICE_FRICTION : FRICTION) * h);
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

/* Les fantômes font des allers-retours, de gauche à droite et inversement */
function updateGhosts(dt) {
  for (const g of ghosts) {
    const len = g.x2 - g.x1;
    g.t = (g.t + g.speed * dt) % (2 * len);
    const forward = g.t < len;
    g.x = g.x1 + (forward ? g.t : 2 * len - g.t);
    g.dir = forward ? 1 : -1;
  }
}

function checkGhosts() {
  for (const g of ghosts) {
    if (Math.hypot(ball.x - g.x, ball.y - g.y) < HIT_DIST) {
      die("ghost");
      return;
    }
  }
}

/* État d'un pic : 0 = rentré (sûr), 1 = avertissement, 2 = sorti (mortel) */
function spikeState(s, now) {
  const t = (((now + s.phase) % spikePeriod) + spikePeriod) % spikePeriod;
  const up = spikePeriod * SPIKE_UP;
  if (t >= spikePeriod - up) return 2;
  if (t >= spikePeriod - up - SPIKE_WARN) return 1;
  return 0;
}

function checkSpikes() {
  const now = performance.now() / 1000;
  for (const s of spikes) {
    if (
      spikeState(s, now) === 2 &&
      Math.abs(ball.x - s.x) < SPIKE_HIT &&
      Math.abs(ball.y - s.y) < SPIKE_HIT
    ) {
      die("spikes");
      return;
    }
  }
}

/* ---------- Dessin ---------- */

/* Fantôme en pixel art 8x8 : X = corps, E = blanc de l'œil */
const GHOST_BODY = [
  "..XXXX..",
  ".XXXXXX.",
  "XXXXXXXX",
  "XEEXXEEX",
  "XEEXXEEX",
  "XXXXXXXX",
  "XXXXXXXX",
];
const GHOST_SKIRT = ["XX.XX.XX", ".XX.XX.X"]; // alterne pour donner l'impression de flotter

function drawGhost(g, ts) {
  const size = GHOST_R * 2 * cell;
  const px = size / 8;
  const left = g.x * cell - size / 2;
  const top = g.y * cell - size / 2 + Math.sin(ts / 250) * cell * 0.03;
  const rows = [...GHOST_BODY, GHOST_SKIRT[Math.floor(ts / 250) % 2]];

  ctx.save();
  ctx.shadowColor = "#ff3b3b";
  ctx.shadowBlur = cell * 0.5;
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < 8; rx++) {
      const c = row[rx];
      if (c === ".") continue;
      ctx.fillStyle = c === "E" ? "#ffffff" : "#ff4d4d";
      ctx.fillRect(left + rx * px, top + ry * px, px + 0.5, px + 0.5);
    }
  });
  ctx.restore();

  // pupilles : elles regardent dans le sens du déplacement
  ctx.fillStyle = "#1b2a8a";
  const leftEye = g.dir > 0 ? 2 : 1;
  const rightEye = g.dir > 0 ? 6 : 5;
  ctx.fillRect(left + leftEye * px, top + 4 * px, px, px);
  ctx.fillRect(left + rightEye * px, top + 4 * px, px, px);
}

function drawSpike(s, ts) {
  const state = spikeState(s, ts / 1000);
  const x = (s.x - 0.5) * cell;
  const y = (s.y - 0.5) * cell;

  // plaque au sol
  ctx.fillStyle = "#2a2f4d";
  ctx.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);

  const warnOn = Math.floor(ts / 110) % 2 === 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const cx = x + cell * (0.3 + 0.4 * i);
      const baseY = y + cell * (0.45 + 0.4 * j);
      const half = cell * 0.15;

      if (state === 0) {
        // pics rentrés : petits trous sombres
        ctx.fillStyle = "#12142a";
        ctx.beginPath();
        ctx.arc(cx, baseY - cell * 0.1, cell * 0.05, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const height = state === 2 ? cell * 0.38 : cell * 0.14;
        ctx.fillStyle =
          state === 2 ? "#ff4040" : warnOn ? "#ffb347" : "#7a4a1a";
        ctx.beginPath();
        ctx.moveTo(cx - half, baseY);
        ctx.lineTo(cx + half, baseY);
        ctx.lineTo(cx, baseY - height);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function draw(ts) {
  if (!maze) return;

  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(0, 0, W * cell, H * cell);

  ctx.fillStyle = "#3a4a8c";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (maze[y][x] === 1) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // zones de glace
  iceSet.forEach((k) => {
    const x = k % W;
    const y = Math.floor(k / W);
    ctx.fillStyle = "rgba(140, 215, 255, 0.45)";
    ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.beginPath();
    ctx.moveTo(x * cell + cell * 0.2, y * cell + cell * 0.8);
    ctx.lineTo(x * cell + cell * 0.5, y * cell + cell * 0.2);
    ctx.stroke();
  });

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

  // trajet des fantômes (discret, pour pouvoir analyser leur mouvement)
  ctx.strokeStyle = "rgba(255, 80, 80, 0.3)";
  ctx.lineWidth = Math.max(2, cell * 0.08);
  ctx.setLineDash([cell * 0.2, cell * 0.2]);
  ghosts.forEach((g) => {
    ctx.beginPath();
    ctx.moveTo(g.x1 * cell, g.y * cell);
    ctx.lineTo(g.x2 * cell, g.y * cell);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  spikes.forEach((s) => drawSpike(s, ts));
  ghosts.forEach((g) => drawGhost(g, ts));

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

  // éclair rouge quand on meurt
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 40, 40, ${Math.min(flash * 1.5, 0.6)})`;
    ctx.fillRect(0, 0, W * cell, H * cell);
  }
}

/* ---------- Boucle principale ---------- */

function frame(ts) {
  const dt = Math.min((ts - lastFrame) / 1000, 1 / 30);
  lastFrame = ts;
  flash = Math.max(0, flash - dt);

  if (running) {
    update(dt);
    updateGhosts(dt);
    checkGhosts();
    checkSpikes();
    if (running) {
      elapsed = (performance.now() - startTime) / 1000;
      timeEl.textContent = elapsed.toFixed(1) + " s";
      if (Math.hypot(ball.x - (W - 1.5), ball.y - (H - 1.5)) < 0.5) win();
    }
  }

  draw(ts);
  requestAnimationFrame(frame);
}

/* ---------- Boutons et événements ---------- */

startBtn.addEventListener("click", async () => {
  if (startBtn.dataset.mode === "next") {
    level++;
    startLevel(false);
    return;
  }
  if (startBtn.dataset.mode === "retry") {
    startLevel(true);
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
  startLevel(false);
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
