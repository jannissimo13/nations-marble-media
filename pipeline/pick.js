// Wählt passende Duelle für den nächsten Stapel.
// Aufruf: node pick.js '{"count":9,"requests":[["de","fr"]],"avoidRecent":40}'
// Ausgabe: JSON-Liste [{seed, ids, codes, names, dur, left, changes, requested}]
require('./sim.js');
const fs = require('fs');
const { Duel, Web, MODES } = globalThis.FlagDuel;
const C = JSON.parse(fs.readFileSync(__dirname + '/countries.json', 'utf8'));
const byCode = Object.fromEntries(C.map(x => [x.c, x.i]));
const conf = JSON.parse(fs.readFileSync(__dirname + '/conflicts.json', 'utf8'));
const state = JSON.parse(fs.readFileSync(__dirname + '/state.json', 'utf8'));
const args = JSON.parse(process.argv[2] || '{}');
const count = args.count || 9, avoidRecent = args.avoidRecent || 40;

const key = (a, b) => [a, b].sort().join('-');
const blocked = new Set(conf.pairs.map(p => key(p[0], p[1])));
const recent = new Set(state.posts.slice(-avoidRecent).map(p => key(p.codes[0], p.codes[1])));
const usedSeeds = new Set(state.posts.map(p => p.seed));
// bekannte Länder kommen bei Zufallsduellen häufiger dran
const BIG = new Set(['de','fr','gb','us','br','it','es','jp','cn','in','mx','ca','ar','pt','nl','tr','kr','au','pl','ua','se','ch','at','eg','ng','za','sa','ma','gr','ie','dk','no','co','id','ph','vn']);

function simulate(seed, ids, mode) {
  const d = new Duel(C.length, seed, { ids: ids || undefined, mode });
  let n = 0; while (d.phase !== 'end' && n < 60 * 300) { d.step(1 / 60); n++; }
  if (d.phase !== 'end') return null;
  const L = [d.cfg.lives, d.cfg.lives]; let lead = 0, changes = 0;
  for (const e of d.events) if (e.type === 'hit') {
    L[e.def] = e.lives; const nl = Math.sign(L[0] - L[1]);
    if (nl && nl !== lead) { if (lead) changes++; lead = nl; }
  }
  return { dur: +(d.endT - d.cfg.intro).toFixed(1), left: d.m[d.winner].lives, changes, ids: d.ids, mode };
}
// Modi reihum (gemischt), damit jedes Short im Stapel anders aussieht
const lastMode = (state.posts.slice(-1)[0] || {}).mode;
const modeOrder = (() => { const a = MODES.slice(); let x = (Date.now() / 1000 | 0) % 997 + 1; for (let i = a.length - 1; i > 0; i--) { x = (x * 48271) % 2147483647; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } if (a[0] === lastMode) a.push(a.shift()); return a; })();
const wantMode = () => modeOrder[out.length % modeOrder.length];
const good = r => r && r.dur >= 56 && r.dur <= 62 && r.left === 1;
const out = [], taken = new Set(), usedCountries = new Set();
let seed = (Date.now() % 1e9) | 0;


// Connections (5 Länder): jedes 4. Video im Stapel
function webPick() {
  const pool = [...BIG].filter(c => c in byCode && !usedCountries.has(c));
  for (let t = 0; t < 400; t++) {
    const codes = []; const p = pool.slice();
    while (codes.length < 5 && p.length) codes.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
    if (codes.length < 5) return null;
    if (codes.some((a, i) => codes.some((b, j) => j > i && blocked.has(key(a, b))))) continue;
    const ids = codes.map(c => byCode[c]);
    for (let k = 0; k < 40; k++) {
      seed++; if (usedSeeds.has(seed)) continue;
      const d = new Web(C.length, seed, { ids });
      let n = 0; while (d.phase !== 'end' && n < 60 * 200) { d.step(1 / 60); n++; }
      if (d.phase !== 'end') continue;
      const dur = +(d.endT - d.cfg.intro).toFixed(1);
      if (dur >= 60 && dur <= 65 && d.m[d.winner].lives >= 1) return { seed, dur, left: d.m[d.winner].lives, changes: 0, ids: d.ids, mode: 'web', requested: false };
    }
  }
  return null;
}
// 1) Wunsch-Duelle aus den Kommentaren
for (const [a, b] of (args.requests || [])) {
  if (out.length >= count) break;
  if (!(a in byCode) || !(b in byCode) || a === b) { console.error('unbekannt/ungültig:', a, b); continue; }
  if (blocked.has(key(a, b))) { console.error('gesperrt (Konflikt):', a, b); continue; }
  if (taken.has(key(a, b))) continue;
  let best = null; const mode = wantMode();
  for (let k = 0; k < 8000; k++) {
    seed++; if (usedSeeds.has(seed)) continue;
    const r = simulate(seed, [byCode[a], byCode[b]], mode);
    if (good(r) && (!best || r.changes > best.changes)) best = { seed, ...r };
    if (best && best.changes >= 2) break;
  }
  if (best) { out.push({ ...best, requested: true }); taken.add(key(a, b)); usedCountries.add(a); usedCountries.add(b); }
}
// 2) Zufallsduelle
let tries = 0;
while (out.length < count && tries < 200000) {
  tries++;
  if ((state.posts.length + out.length + 1) % 4 === 0) {
    const w = webPick();
    if (w) { out.push(w); w.ids.forEach(i => usedCountries.add(C[i].c)); continue; }
  }
  seed++;
  if (usedSeeds.has(seed)) continue;
  const r = simulate(seed, null, wantMode());
  if (!good(r) || r.changes < 1) continue;
  const codes = r.ids.map(i => C[i].c), k = key(...codes);
  if (blocked.has(k) || recent.has(k) || taken.has(k)) continue;
  if (codes.some(c => usedCountries.has(c))) continue;      // jedes Land max. 1x pro Stapel
  const bigCount = codes.filter(c => BIG.has(c)).length;
  if (bigCount === 0) continue;                       // mindestens ein bekanntes Land
  if (bigCount === 1 && (seed % 3) !== 0) continue;   // meistens zwei bekannte
  out.push({ seed, ...r, requested: false }); taken.add(k); codes.forEach(c => usedCountries.add(c));
}
for (const o of out) { o.codes = o.ids.map(i => C[i].c); o.names = o.ids.map(i => C[i].n); }
console.log(JSON.stringify(out));
