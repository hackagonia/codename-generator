// Simple PCG-ish RNG for reproducible runs via seed
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRng(seed) {
  if (!seed) return Math.random;
  const h = xmur3(String(seed))();
  return mulberry32(h);
}

const state = {
  adjectives: [],
  nouns: [],
  usedGlobal: new Set(), // persisted across sessions
  usedSession: new Set(),
  rng: Math.random,
};

const LS_KEY = "cnci_used_names_v1";

// Load persisted used list
function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(n => state.usedGlobal.add(n));
  } catch (_) {}
}
function savePersisted() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(state.usedGlobal).sort()));
  } catch (_) {}
}

// Normalize for comparison and persistence
function normalizeName(name, sep, casing) {
  let s = name.trim();
  // apply casing
  if (casing === "upper") s = s.toUpperCase();
  else if (casing === "lower") s = s.toLowerCase();
  else if (casing === "title") {
    s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  // apply separator (convert any whitespace between words to chosen sep)
  s = s.replace(/\s+/g, sep);
  return s;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function buildBlacklistSet(text, sep, casing) {
  const set = new Set();
  if (!text) return set;
  text.split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (t) set.add(normalizeName(t, sep, casing));
  });
  return set;
}

function generateOne(mode, sep, casing, rng) {
  let adj = pick(state.adjectives, rng);
  let second = (mode === "adj-bee") ? "BEE" : pick(state.nouns, rng);
  // Uppercase wordlists assumed; casing & sep are applied later
  return `${adj} ${second}`;
}

async function ensureWordlists() {
  if (state.adjectives.length && state.nouns.length) return;
  const [adjText, nounText] = await Promise.all([
    fetch("adjectives.txt").then(r => {
      if (!r.ok) throw new Error("Failed to load adjectives.txt");
      return r.text();
    }),
    fetch("nouns.txt").then(r => {
      if (!r.ok) throw new Error("Failed to load nouns.txt");
      return r.text();
    })
  ]);
  state.adjectives = adjText
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());

  state.nouns = nounText
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function attachHandlers() {
  const $ = id => document.getElementById(id);
  const countEl = $("count");
  const seedEl = $("seed");
  const sepEl = $("separator");
  const caseEl = $("casing");
  const modeEl = $("mode");
  const uniqEl = $("forceUnique");
  const blEl = $("blacklist");
  const outEl = $("output");

  $("generateBtn").addEventListener("click", async () => {
    await ensureWordlists();
    // seed
    state.rng = seededRng(seedEl.value.trim());

    const count = Math.max(1, Math.min(1000, parseInt(countEl.value || "1", 10)));
    const sep = sepEl.value;
    const casing = caseEl.value;
    const mode = modeEl.value;
    const uniqMode = uniqEl.value;
    const blacklist = buildBlacklistSet(blEl.value, sep, casing);

    const sessionSet = (uniqMode === "session") ? state.usedSession : null;
    const globalSet  = (uniqMode === "global")  ? state.usedGlobal  : null;

    const results = [];
    let attempts = 0;
    const maxAttempts = count * 20; // avoid infinite loops

    while (results.length < count && attempts < maxAttempts) {
      attempts++;
      const raw = generateOne(mode, sep, casing, state.rng);
      const name = normalizeName(raw, sep, casing);

      if (blacklist.has(name)) continue;
      if (sessionSet && sessionSet.has(name)) continue;
      if (globalSet && globalSet.has(name)) continue;

      results.push(name);
      if (sessionSet) sessionSet.add(name);
      if (globalSet) {
        globalSet.add(name);
        savePersisted();
      }
    }

    if (results.length < count) {
      results.push(`// Only generated ${results.length}/${count} before exhausting unique combos or hitting blacklist.`);
    }

    outEl.textContent = results.join("\n");
  });

  $("downloadUsedBtn").addEventListener("click", () => {
    download("used_names.json", JSON.stringify(Array.from(state.usedGlobal).sort(), null, 2));
  });

  $("clearUsedBtn").addEventListener("click", () => {
    if (!confirm("Clear persisted used names? This cannot be undone.")) return;
    state.usedGlobal.clear();
    localStorage.removeItem(LS_KEY);
    alert("Persisted used names cleared.");
  });
}

window.addEventListener("DOMContentLoaded", () => {
  loadPersisted();
  attachHandlers();
});
