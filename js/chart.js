/* ============================================================
   KeyFlow — dependency-free canvas chart (WPM over time)
   Supports hover tooltips and dashed reference lines (avg/best).
 ============================================================ */

const ChartLib = (() => {
  function theme() {
    const s = getComputedStyle(document.documentElement);
    const v = n => s.getPropertyValue(n).trim();
    return {
      grid: v('--chart-grid'), axis: v('--chart-axis'),
      accent: v('--accent'), faint: v('--faint'),
      error: v('--error'), text: v('--text'), accent2: v('--accent-2')
    };
  }

  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 20;
    const steps = [10, 20, 30, 40, 60, 80, 100, 120, 150, 180, 200, 240, 300, 400];
    for (const s of steps) { if (v <= s) return s; }
    return Math.ceil(v / 50) * 50;
  }

  /**
   * samples: [{t, wpm, raw, err}] — t in seconds (floats ok)
   * o: { maxT, small, refs: [{value, label}] }
   */
  function draw(canvas, samples, o = {}) {
    if (!samples || samples.length < 2) { erase(canvas); canvas.__geom = null; return null; }
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 600;
    const ch = canvas.clientHeight || (o.small ? 64 : 280);
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const C = theme();
    const L = o.small ? 36 : 46, R = o.small ? 10 : 14;
    const T = o.small ? 10 : 16, B = o.small ? 18 : 28;
    const pw = Math.max(10, cw - L - R), ph = Math.max(10, ch - T - B);

    const t0 = 0;
    const t1 = Math.max(o.maxT || 0, ...samples.map(s => s.t)) || 1;
    const maxV = niceMax(Math.max(...samples.map(s => Math.max(s.wpm, s.raw || 0))) * 1.12);

    const X = t => L + (t - t0) / (t1 - t0) * pw;
    const Y = v => T + ph - (v / maxV) * ph;

    // grid + y labels
    ctx.font = (o.small ? '9px' : '10px') + ' "JetBrains Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const rows = o.small ? 2 : 4;
    for (let i = 0; i <= rows; i++) {
      const v = maxV * i / rows, y = Y(v);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.fillText(String(Math.round(v)), L - 6, y);
    }
    // x labels
    const span = t1 - t0;
    const per = span <= 6 ? 1 : span <= 12 ? 2 : span <= 40 ? 5 : span <= 90 ? 10 : span <= 180 ? 20 : 30;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = 0; t <= span + 0.01; t += per) {
      const x = X(t);
      ctx.fillStyle = C.axis;
      ctx.fillText(t === 0 ? String(Math.round(t)) : Math.round(t) + 's', x, T + ph + 6);
      ctx.strokeStyle = C.grid;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    }

    // reference lines (avg / personal best)
    (o.refs || []).forEach(ref => {
      if (!isFinite(ref.value) || ref.value <= 0) return;
      const y = Y(Math.min(ref.value, maxV));
      ctx.save();
      ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.axis;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(ref.label, L + 4, y - 2);
      ctx.restore();
    });

    // area under net
    const drawLine = (val, color, width, fill) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (fill) {
        const g = ctx.createLinearGradient(0, T, 0, T + ph);
        g.addColorStop(0, fill); g.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.moveTo(X(samples[0].t), Y(samples[0][val]));
        samples.forEach(s => ctx.lineTo(X(s.t), Y(s[val])));
        ctx.lineTo(X(samples[samples.length - 1].t), T + ph);
        ctx.lineTo(X(samples[0].t), T + ph); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
      }
      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = X(s.t), y = Y(s[val]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    };

    drawLine('raw', C.faint, 1.5);
    if (!o.small) drawLine('wpm', C.accent, 2.4, C.grid); else drawLine('wpm', C.accent, 2);

    // error markers
    ctx.fillStyle = C.error;
    samples.forEach(s => {
      if (s.err > 0) {
        const x = X(s.t), y = Y(s.raw || 0);
        ctx.beginPath(); ctx.arc(x, y, o.small ? 2 : 3, 0, Math.PI * 2); ctx.fill();
      }
    });

    const geom = { L, T, R, B, pw, ph, t0, t1, maxV, dpr, cw, ch, samples, o };
    canvas.__geom = geom;
    canvas.__data = { samples, o };
    return geom;
  }

  /** Draw hover tooltip; pass a mouse event (or null to clear). */
  function hover(canvas, ev) {
    const base = canvas.__data;
    if (!base) return;
    const geom = draw(canvas, base.samples, base.o);
    if (!ev || !geom) return;
    const ctx = canvas.getContext('2d');
    const dpr = geom.dpr;
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const C = theme();
    const { L, T, pw, ph, t1, samples } = geom;

    if (mx < L - 14 || mx > L + pw + 14) return;

    // nearest sample by x
    const tpx = (mx - L) / pw * t1;
    let best = samples[0], bd = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.t - tpx);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return;
    const x = L + (best.t - geom.t0) / geom.t1 * pw;

    // vertical guide
    ctx.save();
    ctx.translate(x * dpr / dpr, 0); // no-op keeps coordinates in CSS px space
    ctx.restore();
    ctx.strokeStyle = C.faint; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    ctx.globalAlpha = 1;

    // marker dot
    const yv = T + ph - (Math.min(best.wpm, geom.maxV) / geom.maxV) * ph;
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(x, yv, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.text; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, yv, 4, 0, Math.PI * 2); ctx.stroke();

    // tooltip box
    const lines = [
      `${best.t % 1 ? best.t.toFixed(1) : Math.round(best.t)}s`,
      `${Math.round(best.wpm)} wpm`,
      best.raw != null ? `${Math.round(best.raw)} raw` : null,
      best.err ? `${best.err} ${best.err === 1 ? 'error' : 'errors'}` : null
    ].filter(Boolean);
    ctx.font = '10.5px "JetBrains Mono", monospace';
    const bw = Math.max(...lines.map(s => ctx.measureText(s).width), 52) + 16;
    const bh = lines.length * 15 + 12;
    let bx = x + 12; if (bx + bw > L + pw + geom.R) bx = x - bw - 12;
    let by = Math.max(T + 2, Math.min(yv - bh / 2, T + ph - bh - 2));
    ctx.fillStyle = C.accent + '14';
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, 8); ctx.clip();
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((txt, i) => {
      ctx.fillStyle = i === 1 ? C.accent : C.text;
      ctx.fillText(txt, bx + 8, by + 7 + i * 15);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function sampleAt(canvas, t) {
    const d = canvas.__data;
    return d ? d.samples.find(s => s.t === t) : null;
  }

  function erase(canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, hover, erase, sampleAt };
})();
