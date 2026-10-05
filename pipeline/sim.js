/* Flag Duel – deterministische Simulation (Browser + Node) */
(function (root) {
  const CFG = {
    W: 1080, H: 1920,
    cx: 540, cy: 1130, R: 450,      // Arena
    r: 66,                           // Kugelradius
    speed: 620,                      // px/s, für beide gleich
    itemR: 38,
    lives: 5,
    intro: 2.2,                      // Sekunden vor dem Start
    spikeFirst: 1.0, spikeRespawn: [1.0, 2.0],
    shieldFirst: 5.0, shieldRespawn: [10.0, 14.0],
    overtimeAt: 45,                  // danach wird es schneller
    hitCooldown: 0.25,
    outro: 4.5
  };

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Duel(nCountries, seed, opts) {
    this.cfg = Object.assign({}, CFG, opts || {});
    this.rnd = mulberry(seed);
    const rnd = this.rnd, c = this.cfg;
    const a = Math.floor(rnd() * nCountries);
    let b = Math.floor(rnd() * (nCountries - 1)); if (b >= a) b++;
    // Wunsch-Duell: Länder fest vorgeben, Zufallsfolge bleibt identisch
    this.ids = (opts && opts.ids) ? opts.ids.slice(0, 2) : [a, b];
    this.t = 0;              // Gesamtzeit
    this.phase = 'intro';
    this.events = [];
    this.winner = null;
    this.endT = null;
    // Startpositionen links/rechts, Richtungen zufällig aber nicht frontal
    this.m = [0, 1].map(i => {
      const ang = (i === 0 ? Math.PI * 0.75 : -Math.PI * 0.25) + (rnd() - 0.5) * 1.2;
      return {
        id: this.ids[i],
        x: c.cx + (i === 0 ? -1 : 1) * c.R * 0.45, y: c.cy + (rnd() - 0.5) * 120,
        vx: Math.cos(ang) * c.speed, vy: Math.sin(ang) * c.speed,
        lives: c.lives, spikes: false, shield: false, cd: 0, flash: 0, rot: 0, wob: 0
      };
    });
    this.items = [];          // {type:'spike'|'shield', x, y, born}
    this.next = { spike: c.spikeFirst, shield: c.shieldFirst };
    this.stats = { hits: 0, blocks: 0, wall: 0 };
  }

  Duel.prototype.speedNow = function () {
    const c = this.cfg, gt = this.gameT();
    return gt > c.overtimeAt ? c.speed * (1 + 0.03 * (gt - c.overtimeAt)) : c.speed;
  };
  Duel.prototype.gameT = function () { return Math.max(0, this.t - this.cfg.intro); };

  Duel.prototype.spawn = function (type) {
    const c = this.cfg, rnd = this.rnd;
    for (let k = 0; k < 40; k++) {
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * (c.R - c.itemR - 40);
      const x = c.cx + Math.cos(ang) * rad, y = c.cy + Math.sin(ang) * rad;
      const free = this.m.every(m => Math.hypot(m.x - x, m.y - y) > c.r + c.itemR + 60) &&
        this.items.every(it => Math.hypot(it.x - x, it.y - y) > c.itemR * 3);
      if (free) { this.items.push({ type, x, y, born: this.t }); this.events.push({ t: this.t, type: 'spawn', item: type, x, y }); return; }
    }
    this.next[type] = this.gameT() + 0.5; // später erneut versuchen
  };

  Duel.prototype.step = function (dt) {
    const c = this.cfg;
    this.t += dt;
    for (const m of this.m) { m.flash = Math.max(0, m.flash - dt * 2.5); m.wob = Math.max(0, m.wob - dt * 3); }
    if (this.phase === 'intro') { if (this.t >= c.intro) { this.phase = 'fight'; this.events.push({ t: this.t, type: 'go' }); } return; }
    if (this.phase === 'end') return;

    const gt = this.gameT();
    // Items spawnen
    for (const type of ['spike', 'shield']) {
      if (this.next[type] !== null && gt >= this.next[type] && !this.items.some(i => i.type === type)) {
        this.next[type] = null; this.spawn(type);
      }
    }
    const v = this.speedNow();
    const sub = 4, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const m of this.m) {
        m.cd = Math.max(0, m.cd - h);
        m.x += m.vx * h; m.y += m.vy * h;
        m.rot += (m.vx > 0 ? 1 : -1) * v * h / c.r * 0.6;
        // Wand
        const dx = m.x - c.cx, dy = m.y - c.cy, d = Math.hypot(dx, dy);
        if (d + c.r > c.R) {
          const nx = dx / d, ny = dy / d, dot = m.vx * nx + m.vy * ny;
          if (dot > 0) {
            m.vx -= 2 * dot * nx; m.vy -= 2 * dot * ny;
            // leichte Zufallsabweichung gegen Endlosschleifen
            const j = (this.rnd() - 0.5) * 0.16, cs = Math.cos(j), sn = Math.sin(j);
            const vx = m.vx * cs - m.vy * sn, vy = m.vx * sn + m.vy * cs; m.vx = vx; m.vy = vy;
            this.stats.wall++;
            this.events.push({ t: this.t, type: 'wall', who: this.m.indexOf(m), x: c.cx + nx * c.R, y: c.cy + ny * c.R });
          }
          m.x = c.cx + nx * (c.R - c.r); m.y = c.cy + ny * (c.R - c.r);
        }
      }
      // Kugel-Kugel
      const [A, B] = this.m;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < 2 * c.r && d > 0) {
        const nx = dx / d, ny = dy / d;
        const rel = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
        const ov = 2 * c.r - d;
        A.x -= nx * ov / 2; A.y -= ny * ov / 2; B.x += nx * ov / 2; B.y += ny * ov / 2;
        if (rel > 0) {
          A.vx -= rel * nx; A.vy -= rel * ny; B.vx += rel * nx; B.vy += rel * ny;
          if (A.cd <= 0 && B.cd <= 0) this.clash(A, B, (A.x + B.x) / 2, (A.y + B.y) / 2);
        }
      }
      // Geschwindigkeit konstant halten
      for (const m of this.m) {
        const sp = Math.hypot(m.vx, m.vy) || 1;
        // nie zu steil horizontal/vertikal festfahren: minimale Querkomponente
        m.vx = m.vx / sp * v; m.vy = m.vy / sp * v;
      }
      // Items einsammeln
      for (const m of this.m) {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i];
          if (Math.hypot(m.x - it.x, m.y - it.y) > c.r + c.itemR * 0.8) continue;
          if (it.type === 'spike' && !m.spikes) {
            m.spikes = true; this.items.splice(i, 1);
            this.next.spike = this.gameT() + c.spikeRespawn[0] + this.rnd() * (c.spikeRespawn[1] - c.spikeRespawn[0]);
            this.events.push({ t: this.t, type: 'pickup', item: 'spike', who: this.m.indexOf(m), x: it.x, y: it.y });
          } else if (it.type === 'shield' && !m.shield) {
            m.shield = true; this.items.splice(i, 1);
            this.next.shield = this.gameT() + c.shieldRespawn[0] + this.rnd() * (c.shieldRespawn[1] - c.shieldRespawn[0]);
            this.events.push({ t: this.t, type: 'pickup', item: 'shield', who: this.m.indexOf(m), x: it.x, y: it.y });
          }
        }
      }
      if (this.phase === 'end') break;
    }
  };

  Duel.prototype.clash = function (A, B, x, y) {
    const c = this.cfg, pair = [[A, B], [B, A]];
    let any = false;
    const res = [];
    for (const [att, def] of pair) {
      if (!att.spikes) continue;
      any = true;
      if (def.shield) { def.shield = false; res.push(['block', att, def]); this.stats.blocks++; }
      else { def.lives--; def.flash = 1; def.wob = 1; res.push(['hit', att, def]); this.stats.hits++; }
    }
    for (const [, att] of res) att.spikes = false;
    A.cd = B.cd = c.hitCooldown;
    if (!any) { this.events.push({ t: this.t, type: 'bump', x, y }); return; }
    for (const [kind, att, def] of res) {
      this.events.push({ t: this.t, type: kind, att: this.m.indexOf(att), def: this.m.indexOf(def), lives: def.lives, x: def.x, y: def.y });
    }
    const dead = this.m.filter(m => m.lives <= 0);
    if (dead.length) {
      // gleichzeitiger K.o. (sehr selten): wer mehr Leben hatte, ist egal – Gleichstand löst der Zufall
      const loser = dead.length === 2 ? dead[this.rnd() < 0.5 ? 0 : 1] : dead[0];
      if (dead.length === 2) { const other = dead.find(d => d !== loser); other.lives = 1; }
      const winner = this.m.find(m => m !== loser);
      this.winner = this.m.indexOf(winner);
      this.phase = 'end'; this.endT = this.t;
      this.events.push({ t: this.t, type: 'ko', winner: this.winner, loser: this.m.indexOf(loser), x: loser.x, y: loser.y });
    }
  };

  Duel.prototype.done = function () { return this.phase === 'end' && this.t - this.endT >= this.cfg.outro; };

  root.FlagDuel = { Duel, CFG, mulberry };
})(typeof window !== 'undefined' ? window : globalThis);
