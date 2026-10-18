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

  const MODES = ['classic', 'pinball', 'shrink', 'spinner', 'storm'];
  const MODE_INFO = { classic: 'CLASSIC ARENA', pinball: 'PINBALL ARENA', shrink: 'SHRINKING ARENA', spinner: 'SPINNER ARENA', storm: 'SPIKE STORM', web: 'CONNECTIONS' };
  const MODE_PARAMS = { pegR: 54, pegDist: 200, spinLen: 200, spinTh: 24, spinW: 1.15, fidArm: 190, fidLobeR: 52, fidHub: 48, fidTh: 16, fidW: 0.9, shrinkTo: 320, shrinkFrom: 10, shrinkDur: 32 };

  const MODE_LIVES = { classic: 5, pinball: 4, spinner: 4, storm: 10, shrink: 7 };

  // eigene Hypotenuse (nur + * sqrt, exakt IEEE) – Math.hypot liefert in Node und Chromium teils andere letzte Stellen
  const hyp = (a, b) => Math.sqrt(a * a + b * b);

  // eigene sin/cos (nur + * /), weil Math.sin/cos in Node und Chromium in der letzten Stelle abweichen
  // und die chaotische Simulation sonst im Video anders endet als bei der Auswahl.
  const TWO_PI = 6.283185307179586;
  function sinD(x) {
    x -= TWO_PI * Math.round(x / TWO_PI);
    const x2 = x * x; let term = x, sum = x;
    for (let k = 1; k <= 12; k++) { term *= -x2 / ((2 * k) * (2 * k + 1)); sum += term; }
    return sum;
  }
  function cosD(x) {
    x -= TWO_PI * Math.round(x / TWO_PI);
    const x2 = x * x; let term = 1, sum = 1;
    for (let k = 1; k <= 12; k++) { term *= -x2 / ((2 * k - 1) * (2 * k)); sum += term; }
    return sum;
  }

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
    this.mode = (opts && opts.mode) || 'classic';
    if (!(opts && opts.lives)) c.lives = MODE_LIVES[this.mode] || c.lives;
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
        vx: cosD(ang) * c.speed, vy: sinD(ang) * c.speed,
        lives: c.lives, spikes: false, shield: false, cd: 0, flash: 0, rot: 0, wob: 0
      };
    });
    this.items = [];          // {type:'spike'|'shield', x, y, born}
    this.next = { spike: c.spikeFirst, shield: c.shieldFirst };
    this.stats = { hits: 0, blocks: 0, wall: 0 };
    // Arena-Modus (macht jedes Short anders)
    this.R = c.R; this.pegs = []; this.spin = null;
    const P = MODE_PARAMS;
    this.fid = null;
    // Pinball: dreiarmiger Fidget-Spinner in der Mitte (drehend) statt fester Pfosten – schiebt die Kugeln aus allen Ecken
    if (this.mode === 'pinball') this.fid = { a: rnd() * Math.PI * 2, w: (rnd() < 0.5 ? -1 : 1) * P.fidW, arm: P.fidArm, lobeR: P.fidLobeR, hub: P.fidHub, th: P.fidTh };
    if (this.mode === 'spinner') this.spin = { a: rnd() * Math.PI, w: (rnd() < 0.5 ? -1 : 1) * P.spinW, len: P.spinLen, th: P.spinTh };
    if (this.mode === 'storm') { this.cfg.spikeRespawn = [0.5, 1.1]; }
  }

  // Fidget-Spinner: Teile (Nabe, 3 Arme als Kapseln, 3 Kugeln an den Spitzen) als Kreise/Strecken
  Duel.prototype.fidLobes = function () {
    const f = this.fid, c = this.cfg, out = [];
    for (let k = 0; k < 3; k++) { const a = f.a + k * TWO_PI / 3; out.push({ x: c.cx + cosD(a) * f.arm, y: c.cy + sinD(a) * f.arm }); }
    return out;
  };
  Duel.prototype.fidClear = function (x, y, pad) {
    const f = this.fid, c = this.cfg;
    if (hyp(x - c.cx, y - c.cy) < f.hub + pad) return false;
    for (const l of this.fidLobes()) {
      if (hyp(x - l.x, y - l.y) < f.lobeR + pad) return false;
      const ex = l.x - c.cx, ey = l.y - c.cy, tt = Math.max(0, Math.min(1, ((x - c.cx) * ex + (y - c.cy) * ey) / (ex * ex + ey * ey)));
      if (hyp(x - (c.cx + ex * tt), y - (c.cy + ey * tt)) < f.th + pad) return false;
    }
    return true;
  };

  Duel.prototype.speedNow = function () {
    const c = this.cfg, gt = this.gameT();
    return gt > c.overtimeAt ? c.speed * (1 + 0.03 * (gt - c.overtimeAt)) : c.speed;
  };
  Duel.prototype.gameT = function () { return Math.max(0, this.t - this.cfg.intro); };

  Duel.prototype.spawn = function (type) {
    const c = this.cfg, rnd = this.rnd;
    for (let k = 0; k < 40; k++) {
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * (this.R - c.itemR - 40);
      const x = c.cx + cosD(ang) * rad, y = c.cy + sinD(ang) * rad;
      const free = this.m.every(m => hyp(m.x - x, m.y - y) > c.r + c.itemR + 60) &&
        this.items.every(it => hyp(it.x - x, it.y - y) > c.itemR * 3) &&
        this.pegs.every(p => hyp(p.x - x, p.y - y) > p.r + c.itemR + 24) &&
        (!this.spin || hyp(x - c.cx, y - c.cy) > this.spin.len + c.itemR + 30) &&
        (!this.fid || this.fidClear(x, y, c.itemR + 26));
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
    if (this.mode === 'shrink') {
      const P = MODE_PARAMS, k = Math.min(1, Math.max(0, (gt - P.shrinkFrom) / P.shrinkDur));
      this.R = c.R - (c.R - P.shrinkTo) * k;
      for (const it of this.items) { const d = hyp(it.x - c.cx, it.y - c.cy), lim = this.R - c.itemR - 20; if (d > lim) { it.x = c.cx + (it.x - c.cx) * lim / d; it.y = c.cy + (it.y - c.cy) * lim / d; } }
    }
    if (this.spin) this.spin.a += this.spin.w * dt;
    if (this.fid) this.fid.a += this.fid.w * dt;
    for (const type of ['spike', 'shield']) {
      const cnt = this.items.filter(i => i.type === type).length, max = (this.mode === 'storm' && type === 'spike') ? 2 : 1;
      if (this.next[type] !== null && gt >= this.next[type] && cnt < max) {
        this.next[type] = null; this.spawn(type);
        if (max > 1 && cnt + 1 < max) this.next[type] = gt + 0.4;
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
        const dx = m.x - c.cx, dy = m.y - c.cy, d = hyp(dx, dy);
        if (d + c.r > this.R) {
          const nx = dx / d, ny = dy / d, dot = m.vx * nx + m.vy * ny;
          if (dot > 0) {
            m.vx -= 2 * dot * nx; m.vy -= 2 * dot * ny;
            // leichte Zufallsabweichung gegen Endlosschleifen
            const j = (this.rnd() - 0.5) * 0.16, cs = cosD(j), sn = sinD(j);
            const vx = m.vx * cs - m.vy * sn, vy = m.vx * sn + m.vy * cs; m.vx = vx; m.vy = vy;
            this.stats.wall++;
            this.events.push({ t: this.t, type: 'wall', who: this.m.indexOf(m), x: c.cx + nx * this.R, y: c.cy + ny * this.R });
          }
          m.x = c.cx + nx * (this.R - c.r); m.y = c.cy + ny * (this.R - c.r);
        }
      }
      // Hindernisse (Pinball-Pfosten, Spinner)
      for (const m of this.m) {
        const hitObs = (ox, oy, rad, w) => {
          const dx = m.x - ox, dy = m.y - oy, d = hyp(dx, dy) || 1e-6;
          if (d >= c.r + rad) return;
          const nx = dx / d, ny = dy / d;
          m.x = ox + nx * (c.r + rad); m.y = oy + ny * (c.r + rad);
          // bewegte Wand (Fidget-Spinner): Reflexion in Relativgeschwindigkeit, Oberflächentempo kommt dazu
          const qx = ox + nx * rad, qy = oy + ny * rad;
          const ovx = w ? -w * (qy - c.cy) : 0, ovy = w ? w * (qx - c.cx) : 0;
          const dot = (m.vx - ovx) * nx + (m.vy - ovy) * ny;
          if (dot < 0) { m.vx -= 2 * dot * nx; m.vy -= 2 * dot * ny; this.events.push({ t: this.t, type: 'wall', who: this.m.indexOf(m), x: qx, y: qy }); }
        };
        for (const p of this.pegs) hitObs(p.x, p.y, p.r);
        if (this.fid) {
          const f = this.fid;
          hitObs(c.cx, c.cy, f.hub, f.w);
          for (const l of this.fidLobes()) {
            hitObs(l.x, l.y, f.lobeR, f.w);
            const ex = l.x - c.cx, ey = l.y - c.cy, tt = Math.max(0, Math.min(1, ((m.x - c.cx) * ex + (m.y - c.cy) * ey) / (ex * ex + ey * ey)));
            hitObs(c.cx + ex * tt, c.cy + ey * tt, f.th, f.w);
          }
        }
        if (this.spin) {
          const sp = this.spin, ax = c.cx - cosD(sp.a) * sp.len, ay = c.cy - sinD(sp.a) * sp.len, bx = c.cx + cosD(sp.a) * sp.len, by = c.cy + sinD(sp.a) * sp.len;
          const ex = bx - ax, ey = by - ay, tt = Math.max(0, Math.min(1, ((m.x - ax) * ex + (m.y - ay) * ey) / (ex * ex + ey * ey)));
          hitObs(ax + ex * tt, ay + ey * tt, sp.th);
        }
      }
      // Kugel-Kugel
      const [A, B] = this.m;
      const dx = B.x - A.x, dy = B.y - A.y, d = hyp(dx, dy);
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
        const sp = hyp(m.vx, m.vy) || 1;
        // nie zu steil horizontal/vertikal festfahren: minimale Querkomponente
        m.vx = m.vx / sp * v; m.vy = m.vy / sp * v;
      }
      // Items einsammeln
      for (const m of this.m) {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i];
          if (hyp(m.x - it.x, m.y - it.y) > c.r + c.itemR * 0.8) continue;
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


  /* ---------- Connections-Modus (mehrere Länder, Fäden zur Wand) ---------- */
  const WEB = { n: 5, lives: 5, speed: 480, initTethers: 3, maxTethers: 12, respawnDelay: 3.5, minLen: 60, cutWindow: 99, bounceFan: 3, overtimeAt: 52, spread: 0.85 };
  const WEB_COLORS = 4;

  function Web(nCountries, seed, opts) {
    this.cfg = Object.assign({}, CFG, WEB, opts || {});
    this.rnd = mulberry(seed);
    const rnd = this.rnd, c = this.cfg, n = c.n;
    this.mode = 'web';
    // Länder: vorgegeben oder zufällig und verschieden
    let ids = (opts && opts.ids) ? opts.ids.slice(0, n) : [];
    while (ids.length < n) { const k = Math.floor(rnd() * nCountries); if (ids.indexOf(k) < 0) ids.push(k); }
    this.ids = ids;
    this.t = 0; this.phase = 'intro'; this.events = []; this.winner = null; this.endT = null;
    this.R = c.R; this.pegs = []; this.spin = null; this.fid = null; this.items = [];
    this.tethers = []; this.seq = 0; this.stats = { cuts: 0, wall: 0 };
    const a0 = rnd() * TWO_PI;
    this.m = ids.map((id, i) => {
      const a = a0 + i * TWO_PI / n, ang = a + Math.PI + (rnd() - 0.5) * 1.6;
      return { id, x: c.cx + cosD(a) * c.R * 0.5, y: c.cy + sinD(a) * c.R * 0.5, vx: cosD(ang) * c.speed, vy: sinD(ang) * c.speed,
        lives: c.lives, spikes: false, shield: false, cd: 0, flash: 0, rot: 0, wob: 0, out: false, down: 0 };
    });
    this.m.forEach((m, i) => this.connect(i, true));
  }
  Web.prototype.gameT = Duel.prototype.gameT;
  Web.prototype.speedNow = function () {
    const c = this.cfg, gt = this.gameT();
    return gt > c.overtimeAt ? c.speed * (1 + 0.03 * (gt - c.overtimeAt)) : c.speed;
  };
  // neue Fäden vom Land zur nächsten Wand (drei Anker, fächerförmig um die Richtung zur Wand)
  Web.prototype.connect = function (i, silent) {
    const m = this.m[i], c = this.cfg, dx = m.x - c.cx, dy = m.y - c.cy, d = hyp(dx, dy) || 1e-6, nx = dx / d, ny = dy / d;
    const k = c.initTethers;
    for (let j = 0; j < k; j++) {
      const off = (j - (k - 1) / 2) * c.spread, co = cosD(off), so = sinD(off);
      const ux = nx * co - ny * so, uy = nx * so + ny * co;
      this.tethers.push({ owner: i, ax: c.cx + ux * this.R, ay: c.cy + uy * this.R, seq: this.seq++, born: this.t });
    }
    if (!silent) this.events.push({ t: this.t, type: 'rewire', who: i, x: m.x, y: m.y });
  };
  Web.prototype.addTether = function (i, x, y) {
    const c = this.cfg;
    this.tethers.push({ owner: i, ax: x, ay: y, seq: this.seq++, born: this.t });
    const mine = this.tethers.filter(t => t.owner === i);
    if (mine.length > c.maxTethers) { const old = mine[0]; this.tethers.splice(this.tethers.indexOf(old), 1); }
  };
  const segX = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy, den = d1x * d2y - d1y * d2x;
    if (den === 0) return null;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den, u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
    return (t > 0 && t < 1 && u > 0 && u < 1) ? { x: ax + d1x * t, y: ay + d1y * t } : null;
  };

  Web.prototype.step = function (dt) {
    const c = this.cfg;
    this.t += dt;
    for (const m of this.m) { m.flash = Math.max(0, m.flash - dt * 2.5); m.wob = Math.max(0, m.wob - dt * 3); }
    if (this.phase === 'intro') { if (this.t >= c.intro) { this.phase = 'fight'; this.events.push({ t: this.t, type: 'go' }); } return; }
    if (this.phase === 'end') return;
    const v = this.speedNow(), sub = 4, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < this.m.length; i++) {
        const m = this.m[i]; if (m.out) continue;
        m.x += m.vx * h; m.y += m.vy * h;
        m.rot += (m.vx > 0 ? 1 : -1) * v * h / c.r * 0.6;
        const dx = m.x - c.cx, dy = m.y - c.cy, d = hyp(dx, dy);
        if (d + c.r > this.R) {
          const nx = dx / d, ny = dy / d, dot = m.vx * nx + m.vy * ny;
          if (dot > 0) {
            m.vx -= 2 * dot * nx; m.vy -= 2 * dot * ny;
            const j = (this.rnd() - 0.5) * 0.16, cs = cosD(j), sn = sinD(j);
            const vx = m.vx * cs - m.vy * sn, vy = m.vx * sn + m.vy * cs; m.vx = vx; m.vy = vy;
            this.stats.wall++;
            const wx = c.cx + nx * this.R, wy = c.cy + ny * this.R;
            this.events.push({ t: this.t, type: 'wall', who: i, x: wx, y: wy });
            if (m.down <= 0) {
              this.addTether(i, wx, wy);
              // Fächer: weitere Anker links/rechts neben dem Aufprallpunkt an der Wand
              for (let q = 1; q < c.bounceFan; q++) {
                const off = (q % 2 ? 1 : -1) * Math.ceil(q / 2) * 0.32, co = cosD(off), so = sinD(off);
                this.addTether(i, c.cx + (nx * co - ny * so) * this.R, c.cy + (nx * so + ny * co) * this.R);
              }
            }
          }
          m.x = c.cx + nx * (this.R - c.r); m.y = c.cy + ny * (this.R - c.r);
        }
      }
      // Kugel-Kugel: elastischer Stoß, kein Schaden
      for (let i = 0; i < this.m.length; i++) for (let j = i + 1; j < this.m.length; j++) {
        const A = this.m[i], B = this.m[j]; if (A.out || B.out) continue;
        const dx = B.x - A.x, dy = B.y - A.y, d = hyp(dx, dy);
        if (d < 2 * c.r && d > 0) {
          const nx = dx / d, ny = dy / d, rel = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny, ov = 2 * c.r - d;
          A.x -= nx * ov / 2; A.y -= ny * ov / 2; B.x += nx * ov / 2; B.y += ny * ov / 2;
          if (rel > 0) {
            A.vx -= rel * nx; A.vy -= rel * ny; B.vx += rel * nx; B.vy += rel * ny;
            if (A.cd <= 0 && B.cd <= 0) { this.events.push({ t: this.t, type: 'bump', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }); A.cd = B.cd = 0.2; }
          }
        }
      }
      for (const m of this.m) { m.cd = Math.max(0, m.cd - h); const sp = hyp(m.vx, m.vy) || 1; m.vx = m.vx / sp * v; m.vy = m.vy / sp * v; }
    }
    // Fäden: wer einen älteren fremden Faden kreuzt, kappt ihn
    const T = this.tethers, dead = new Set();
    for (let a = 0; a < T.length; a++) for (let b = a + 1; b < T.length; b++) {
      const A = T[a], B = T[b]; if (A.owner === B.owner || dead.has(A) || dead.has(B)) continue;
      const mA = this.m[A.owner], mB = this.m[B.owner];
      if (hyp(mA.x - A.ax, mA.y - A.ay) < c.minLen || hyp(mB.x - B.ax, mB.y - B.ay) < c.minLen) continue;
      const p = segX(mA.x, mA.y, A.ax, A.ay, mB.x, mB.y, B.ax, B.ay);
      if (!p) continue;
      const older = A.seq < B.seq ? A : B, newer = older === A ? B : A;
      if (this.t - newer.born > c.cutWindow) continue;   // nur frische Fäden können kappen
      dead.add(older); this.stats.cuts++;
      this.events.push({ t: this.t, type: 'cut', who: older.owner, by: newer.owner, x: p.x, y: p.y });
    }
    if (dead.size) this.tethers = T.filter(t => !dead.has(t));
    // Länder ohne Fäden: Herz verlieren, nach kurzer Pause neu verbinden
    for (let i = 0; i < this.m.length; i++) {
      const m = this.m[i]; if (m.out) continue;
      if (m.down > 0) { m.down -= dt; if (m.down <= 0) { m.down = 0; this.connect(i); } continue; }
      if (this.tethers.some(t => t.owner === i)) continue;
      m.lives--; m.flash = 1; m.wob = 1;
      this.events.push({ t: this.t, type: 'hit', att: -1, def: i, lives: m.lives, x: m.x, y: m.y });
      if (m.lives <= 0) {
        m.out = true; this.events.push({ t: this.t, type: 'out', who: i, x: m.x, y: m.y });
        const alive = this.m.filter(q => !q.out);
        if (alive.length <= 1) {
          this.winner = this.m.indexOf(alive[0]); this.phase = 'end'; this.endT = this.t;
          this.events.push({ t: this.t, type: 'ko', winner: this.winner, loser: i, x: m.x, y: m.y });
          return;
        }
      } else m.down = c.respawnDelay;
    }
  };
  Web.prototype.done = Duel.prototype.done;

  root.FlagDuel = { Duel, Web, CFG, WEB, mulberry, MODES, MODE_INFO, MODE_PARAMS };
})(typeof window !== 'undefined' ? window : globalThis);
