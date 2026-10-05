// Wählt passende Duelle für den nächsten Stapel.
// Aufruf: node pick.js '{"count":9,"requests":[["de","fr"]],"avoidRecent":40}'
// Ausgabe: JSON-Liste [{seed, ids, codes, names, dur, left, changes, requested}]
require('./sim.js');
const fs = require('fs');
const { Duel } = globalThis.FlagDuel;
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

function simulate(seed, ids) {
  const d = new Duel(C.length, seed, ids ? { ids } : undefined);
  let n = 0; while (d.phase !== 'end' && n < 60 * 300) { d.step(1 / 60); n++; }
  if (d.phase !== 'end') return null;
  const L = [d.cfg.lives, d.cfg.lives]; let lead = 0, changes = 0;
  for (const e of d.events) if (e.type === 'hit') {
    L[e.def] = e.lives; const nl = Math.sign(L[0] - L[1]);
    if (nl && nl !== lead) { if (lead) changes++; lead = nl; }
  }
  return { dur: +(d.endT - d.cfg.intro).toFixed(1), left: d.m[d.winner].lives, changes, ids: d.ids };
}
const good = r => r && r.dur >= 52 && r.dur <= 60 && r.left === 1;
const out = [], taken = new Set();
let seed = (Date.now() % 1e9) | 0;

// 1) Wunsch-Duelle aus den Kommentaren
for (const [a, b] of (args.requests || [])) {
  if (out.length >= count) break;
  if (!(a in byCode) || !(b in byCode) || a === b) { console.error('unbekannt/ungültig:', a, b); continue; }
  if (blocked.has(key(a, b))) { console.error('gesperrt (Konflikt):', a, b); continue; }
  if (taken.has(key(a, b))) continue;
  let best = null;
  for (let k = 0; k < 4000; k++) {
    seed++; if (usedSeeds.has(seed)) continue;
    const r = simulate(seed, [byCode[a], byCode[b]]);
    if (good(r) && (!best || r.changes > best.changes)) best = { seed, ...r };
    if (best && best.changes >= 2) break;
  }
  if (best) { out.push({ ...best, requested: true }); taken.add(key(a, b)); }
}
// 2) Zufallsduelle
let tries = 0;
while (out.length < count && tries < 200000) {
  tries++; seed++;
  if (usedSeeds.has(seed)) continue;
  const r = simulate(seed);
  if (!good(r) || r.changes < 1) continue;
  const codes = r.ids.map(i => C[i].c), k = key(...codes);
  if (blocked.has(k) || recent.has(k) || taken.has(k)) continue;
  const bigCount = codes.filter(c => BIG.has(c)).length;
  if (bigCount === 0) continue;                       // mindestens ein bekanntes Land
  if (bigCount === 1 && (seed % 3) !== 0) continue;   // meistens zwei bekannte
  out.push({ seed, ...r, requested: false }); taken.add(k);
}
for (const o of out) { o.codes = o.ids.map(i => C[i].c); o.names = o.ids.map(i => C[i].n); }
console.log(JSON.stringify(out));
