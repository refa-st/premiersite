const SIZE = 10;
const MAX_SPELLS = 35;
const FLEET = [
  { name: "Le Navire de Durmstrang", size: 5 },
  { name: "L'Hippogriffe des mers", size: 4 },
  { name: "La Barque de Hagrid", size: 3 },
  { name: "Le Chaudron flottant", size: 3 },
  { name: "Le Gobelet de Feu", size: 2 },
];

const gridEl = document.getElementById("grid");
const messageEl = document.getElementById("message");
const spellsEl = document.getElementById("spells");
const shipsLeftEl = document.getElementById("ships-left");
const targetEl = document.getElementById("target");
const fleetEl = document.getElementById("fleet");
const micBtn = document.getElementById("mic-btn");
const heardEl = document.getElementById("heard");
const formEl = document.getElementById("spell-form");
const inputEl = document.getElementById("spell-input");

let cells, ships, spellsLeft, selected, gameOver;
let lastCast = 0;

/* ---------- Partie ---------- */

function newGame() {
  cells = Array.from({ length: SIZE * SIZE }, () => ({
    ship: null,
    state: "hidden",
    fresh: false,
  }));
  ships = FLEET.map((f) => ({ ...f, cells: [], sunk: false }));
  placeShips();
  spellsLeft = MAX_SPELLS;
  selected = null;
  gameOver = false;
  setMessage("Les navires ennemis rôdent… Choisis une case !");
  render();
}

function placeShips() {
  ships.forEach((ship, id) => {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const row = Math.floor(
        Math.random() * (horizontal ? SIZE : SIZE - ship.size + 1),
      );
      const col = Math.floor(
        Math.random() * (horizontal ? SIZE - ship.size + 1 : SIZE),
      );
      const idx = [];
      for (let k = 0; k < ship.size; k++) {
        idx.push(
          (row + (horizontal ? 0 : k)) * SIZE + col + (horizontal ? k : 0),
        );
      }
      if (idx.every((i) => cells[i].ship === null)) {
        idx.forEach((i) => (cells[i].ship = id));
        ship.cells = idx;
        placed = true;
      }
    }
  });
}

function label(i) {
  return String.fromCharCode(65 + (i % SIZE)) + (Math.floor(i / SIZE) + 1);
}

function setMessage(text) {
  messageEl.textContent = text;
}

/* ---------- Affichage ---------- */

function render() {
  gridEl.innerHTML = "";
  cells.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className =
      "cell " +
      c.state +
      (i === selected ? " selected" : "") +
      (c.fresh ? " fresh" : "");
    b.dataset.index = i;
    b.setAttribute("aria-label", "Case " + label(i));
    gridEl.appendChild(b);
  });

  spellsEl.textContent = spellsLeft;
  shipsLeftEl.textContent = ships.filter((s) => !s.sunk).length;
  targetEl.textContent = selected === null ? "—" : label(selected);
  fleetEl.innerHTML = ships
    .map(
      (s) => `<li class="${s.sunk ? "sunk" : ""}">${s.name} (${s.size})</li>`,
    )
    .join("");

  cells.forEach((c) => (c.fresh = false));
}

function shake() {
  gridEl.classList.add("shake");
  setTimeout(() => gridEl.classList.remove("shake"), 500);
}

/* ---------- Sons (Web Audio, sans fichier) ---------- */

let audioCtx;
function noise(duration, cutoff) {
  try {
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume();
    const len = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    src.connect(filter).connect(audioCtx.destination);
    src.start();
  } catch (e) {
    /* le son est un bonus : on ignore les erreurs */
  }
}

/* ---------- Sortilège ---------- */

function cast() {
  if (gameOver) return;

  const now = Date.now();
  if (now - lastCast < 1500) return; // évite les doubles déclenchements de la voix
  lastCast = now;

  if (selected === null) {
    setMessage("Choisis d'abord une case à viser !");
    return;
  }

  const cell = cells[selected];
  const target = label(selected);
  spellsLeft--;

  if (cell.ship !== null) {
    const ship = ships[cell.ship];
    ship.sunk = true;
    ship.cells.forEach((i) => {
      cells[i].state = "boom";
      cells[i].fresh = true;
    });
    shake();
    noise(1.0, 400);
    setMessage(`💥 BOOM ! ${ship.name} explose en ${target} !`);
  } else {
    cell.state = "miss";
    cell.fresh = true;
    noise(0.25, 2500);
    setMessage(`💧 Plouf… rien en ${target}.`);
  }

  selected = null;
  checkEnd();
  render();
}

function checkEnd() {
  if (ships.every((s) => s.sunk)) {
    gameOver = true;
    setMessage(
      `🏆 Victoire ! Toute la flotte est détruite, il te reste ${spellsLeft} sortilège(s).`,
    );
  } else if (spellsLeft === 0) {
    gameOver = true;
    cells.forEach((c) => {
      if (c.ship !== null && c.state === "hidden") c.state = "reveal";
    });
    setMessage(
      "☠️ Plus de sortilèges… la flotte ennemie s'échappe. Retente ta chance !",
    );
  }
}

function isSpell(text) {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return t.includes("bomb") && t.includes("max");
}

/* ---------- Clic sur la grille ---------- */

gridEl.addEventListener("click", (e) => {
  const b = e.target.closest(".cell");
  if (!b || gameOver) return;
  const i = Number(b.dataset.index);
  if (cells[i].state !== "hidden") return;
  selected = i;
  setMessage(`Cible verrouillée : ${label(i)}. Dis « Bombarda Maxima » !`);
  render();
});

/* ---------- Saisie au clavier (secours) ---------- */

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value;
  inputEl.value = "";
  if (isSpell(text)) cast();
  else setMessage("Ce sortilège est inconnu… essaie « Bombarda Maxima ».");
});

/* ---------- Reconnaissance vocale ---------- */

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

function toggleMic() {
  if (listening) {
    listening = false;
    recognition.stop();
    micBtn.textContent = "🎤 Activer le micro";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      heardEl.textContent = `« ${text.trim()} »`;
      if (isSpell(text)) cast();
    }
  };

  recognition.onerror = (event) => {
    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed"
    ) {
      listening = false;
      micBtn.textContent = "🎤 Activer le micro";
      setMessage(
        "Micro refusé : autorise-le dans ton navigateur, ou écris le sortilège.",
      );
    }
  };

  recognition.onend = () => {
    if (listening) {
      try {
        recognition.start();
      } catch (e) {
        /* déjà relancé */
      }
    }
  };

  listening = true;
  recognition.start();
  micBtn.textContent = "🛑 Couper le micro";
}

if (!SpeechRecognition) {
  micBtn.disabled = true;
  heardEl.textContent =
    "Voix non supportée ici : utilise Chrome ou Edge, ou écris le sortilège.";
} else {
  micBtn.addEventListener("click", toggleMic);
}

document.getElementById("new-game").addEventListener("click", newGame);

newGame();
