/* ============================================================
   KeyFlow — main application logic
   Parts: helpers → settings → sound → typing engine →
          test controller → practice → history → boot
 ============================================================ */
'use strict';

/* ---------------- helpers ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const fmt = (v, d = 0) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ---------------- toasts ---------------- */
function toast(msg, kind = 'info', ttl = 2600) {
  const c = $('#toasts');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 320); }, ttl);
}

/* ---------------- settings & config ---------------- */
const DEFAULT_SETTINGS = { theme: 'dark', accent: 'teal', sound: true, smoothCaret: true, showKb: false, fontSize: 30, caretStyle: 'line', suggestWords: true };
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('keyflow.settings.v1', {}));
const saveSettings = () => store.set('keyflow.settings.v1', settings);

const DEFAULT_CONFIG = { mode: 'time', time: 60, words: 25, level: 'easy', punct: false, nums: false };
let config = Object.assign({}, DEFAULT_CONFIG, store.get('keyflow.config.v1', {}));
const saveConfig = () => store.set('keyflow.config.v1', config);

let soundOn = settings.sound;

/* ---------------- sound ---------------- */
const Sfx = {
  ctx: null,
  ac() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, vol) {
    const c = this.ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  },
  key()  { if (soundOn) this.tone(430 + Math.random() * 120, 0.05, 'triangle', 0.045); },
  err()  { if (soundOn) this.tone(150, 0.1, 'sawtooth', 0.05); },
  done() { if (soundOn) { this.tone(523, 0.12, 'triangle', 0.05); setTimeout(() => this.tone(659, 0.14, 'triangle', 0.05), 110); setTimeout(() => this.tone(784, 0.2, 'triangle', 0.05), 230); } }
};

/* ============================================================
   Typing Engine — powers both the main test and practice
 ============================================================ */
class Engine {
  constructor(o) {
    this.o = o; // { container, onFinish, onTick, onSample, onStart, onCaret, onWrong, finite, })
    this.errKeys = {};
    this.stopTimers();
  }

  setWords(words) {
    this.finiteMode = typeof this.o.finite === 'function' ? !!this.o.finite() : !!this.o.finite;
    if (this.limitWatch) { clearInterval(this.limitWatch); this.limitWatch = null; }
    document.body.classList.remove('typing');
    this.words = words.slice();
    this.typed = this.words.map(() => '');
    this.w = 0; this.c = 0;
    this.started = false; this.done = false;
    this.startTime = null; this.finishedAt = null;
    this.samples = []; this.secondErr = 0;
    this.errKeys = {}; this.secondErrSaved = 0;
    this.stopTimers();
    this.buildDOM();
    this.k = { correct: 0, incorrect: 0, extra: 0, raw: 0 };
    this.updateTick();
  }

  stopTimers() {
    if (this.sampling) { clearInterval(this.sampling); this.sampling = null; }
  }

  buildDOM() {
    const cont = this.o.container;
    cont.innerHTML = '';
    cont.scrollTop = 0;
    this.wordEls = []; this.charEls = [];
    const frag = document.createDocumentFragment();
    this.words.forEach(g => {
      const wd = document.createElement('div');
      wd.className = 'word';
      const spans = [];
      [...g].forEach(ch => {
        const s = document.createElement('span');
        s.className = 'char'; s.textContent = ch;
        wd.appendChild(s); spans.push(s);
      });
      frag.appendChild(wd);
      this.wordEls.push(wd); this.charEls.push(spans);
    });
    cont.appendChild(frag);
    this.caret = document.createElement('div');
    this.caret.className = 'caret';
    cont.appendChild(this.caret);
    cont.classList.remove('done');
    this.measureLines();
    this.placeCaret();
    this.ensureVisible();
    this.o.onCaret && this.o.onCaret(this.nextHintChar());
  }

  measureLines() {
    let step = 0;
    if (this.wordEls.length > 1) {
      const top0 = this.wordEls[0].offsetTop;
      const second = this.wordEls.find(el => el.offsetTop > top0);
      if (second) step = second.offsetTop - top0;
    }
    this.lineStep = step;
    if (step > 0) this.o.container.style.height = (step * 3) + 'px';
  }

  ensureVisible() {
    if (!this.lineStep) return;
    const cont = this.o.container;
    const word = this.wordEls[this.w];
    if (!word) return;
    const top = word.offsetTop;
    if (top - cont.scrollTop >= this.lineStep * 1.5) cont.scrollTop = top - this.lineStep;
  }

  /* ----- processing ----- */
  begin() {
    if (this.started) return;
    this.started = true;
    this.startTime = performance.now();
    this.sampling = setInterval(() => this.sampleSecond(), 1000);
    document.body.classList.add('typing');
    this.o.onStart && this.o.onStart();
  }

  processKey(char) {
    if (this.done) return false;
    if (!this.started) this.begin();
    const g = this.words[this.w];

    if (char === ' ') {
      const t = this.typed[this.w] || '';
      if (t.length === 0) return true;             // ignore leading space
      this.wordEls[this.w].classList.toggle('error', t !== g);
      this.w++; this.c = 0;
      this.typed[this.w] = '';
      if (this.w >= this.words.length - 25 && this.o.autoAppend) {
        const more = this.o.autoAppend();
        if (more && more.length) this.appendWords(more);
      }
      this.afterChange();
      return true;
    }

    const t = this.typed[this.w] || '';
    const j = t.length;
    if (j < g.length) {
      const span = this.charEls[this.w][j];
      const ok = char === g[j];
      span.classList.remove('correct', 'incorrect');
      span.classList.add(ok ? 'correct' : 'incorrect');
      if (!ok) { this.secondErr++; this.errKeys[char] = (this.errKeys[char] || 0) + 1; }
    } else {
      const span = document.createElement('span');
      span.className = 'char extra'; span.textContent = char;
      this.wordEls[this.w].appendChild(span);
      this.charEls[this.w].push(span);
      this.secondErr++; this.errKeys[char] = (this.errKeys[char] || 0) + 1;
    }
    this.typed[this.w] = t + char;
    this.c = j + 1;

    this.afterChange();
    if (this.finiteMode && this.w === this.words.length - 1 && this.typed[this.w].length >= g.length) {
      this.finish('complete');
    }
    return true;
  }

  processBackspace() {
    if (this.done || !this.started) return;
    const t = this.typed[this.w] || '';
    if (this.c > 0) {
      const nl = this.c - 1;
      if (nl >= (this.words[this.w] || '').length) {
        const arr = this.charEls[this.w];
        const sp = arr.pop();
        if (sp) sp.remove();
      } else {
        const s = this.charEls[this.w][nl];
        if (s) s.classList.remove('correct', 'incorrect');
      }
      this.typed[this.w] = t.slice(0, nl);
      this.c = nl;
    } else if (this.w > 0) {
      this.w--;
      this.c = (this.typed[this.w] || '').length;
    }
    this.afterChange();
  }

  afterChange() {
    this.recompute();
    this.placeCaret();
    this.ensureVisible();
    this.updateTick();
    this.o.onCaret && this.o.onCaret(this.nextHintChar());
  }

  appendWords(list) {
    const cont = this.o.container;
    const frag = document.createDocumentFragment();
    list.forEach(g => {
      this.words.push(g); this.typed.push('');
      const wd = document.createElement('div'); wd.className = 'word';
      const spans = [];
      [...g].forEach(ch => {
        const s = document.createElement('span'); s.className = 'char'; s.textContent = ch;
        wd.appendChild(s); spans.push(s);
      });
      frag.appendChild(wd);
      this.wordEls.push(wd); this.charEls.push(spans);
    });
    cont.insertBefore(frag, this.caret);
    this.measureLines();
    this.ensureVisible();
  }

  nextHintChar() {
    if (this.done) return null;
    const g = this.words[this.w], t = this.typed[this.w] || '';
    if (this.c < g.length) return g[this.c];
    return this.w < this.words.length - 1 ? ' ' : null;
  }

  /* ----- counting ----- */
  recompute() {
    let correct = 0, incorrect = 0, extra = 0, raw = 0;
    for (let i = 0; i <= this.w && i < this.words.length; i++) {
      const t = this.typed[i] || '', g = this.words[i];
      const len = Math.min(t.length, g.length);
      for (let j = 0; j < len; j++) {
        if (t[j] === g[j]) correct++; else incorrect++;
        raw++;
      }
      if (t.length > g.length) { extra += t.length - g.length; raw += t.length - g.length; }
      if (i < this.w) { // space-trailing committed word
        if (t === g && t.length === g.length) correct++; else incorrect++;
        raw++;
      }
    }
    this.k = { correct, incorrect, extra, raw };
  }

  metrics() {
    const now = this.started ? (this.done ? this.finishedAt : performance.now()) : 0;
    const sec = this.started ? (now - this.startTime) / 1000 : 0;
    const min = Math.max(sec, 0.05) / 60; // seconds → minutes, floored to 50 ms
    const k = this.k || { correct: 0, incorrect: 0, extra: 0, raw: 0 };
    const wpm = (k.correct / 5) / min;
    const rawWpm = (k.raw / 5) / min;
    const denom = k.correct + k.incorrect + k.extra;
    const acc = denom === 0 ? 100 : (k.correct / denom) * 100;
    return { sec, wpm, rawWpm, acc, ...k, wordsLeft: this.words.length - this.w };
  }

  sampleSecond() {
    const m = this.metrics();
    this.samples.push({ t: Math.round(m.sec * 10) / 10, wpm: m.wpm, raw: m.rawWpm, err: this.secondErrSaved });
    this.secondErrSaved = this.secondErr;
    this.secondErr = 0;
    this.o.onSample && this.o.onSample(this.samples);
  }

  updateTick() { this.o.onTick && this.o.onTick(this); }

  finish(reason) {
    if (this.done) return;
    this.finishedAt = performance.now();
    this.done = true;
    this.stopTimers();
    document.body.classList.remove('typing');
    if (this.started) {
      this.sampleSecond(); // final partial sample
      this.o.onSample && this.o.onSample(this.samples);
    }
    this.recompute();
    this.o.container.classList.add('done');
    this.updateTick();           // final HUD pass with done=true (hides suggestions etc.)
    this.o.onFinish && this.o.onFinish({ reason: reason || 'complete' });
  }

  /* ----- caret rendering ----- */
  placeCaret() {
    const word = this.wordEls[this.w];
    if (!word || !this.caret) return;
    const arr = this.charEls[this.w];
    let x;
    if (arr && arr.length > 0) {
      if (this.c === 0) {
        x = arr[0].offsetLeft;
      } else if (this.c <= arr.length) {
        const prev = arr[this.c - 1];
        x = prev.offsetLeft + prev.offsetWidth;
        // caret at start of next char visually = end of previous char
        if (this.c < arr.length) x = arr[this.c].offsetLeft;
      } else {
        const last = arr[arr.length - 1];
        x = last.offsetLeft + last.offsetWidth;
      }
    } else {
      x = word.offsetLeft;
    }
    const lineH = word.offsetHeight || 20;
    const st = settings.caretStyle || 'line';
    let w, h, y, op = 1;
    let cw = 18;
    if (arr && arr.length) {
      cw = arr[Math.min(this.c, arr.length - 1)].offsetWidth || 18;
    }
    if (st === 'block') {
      w = cw; h = lineH * 0.74; y = word.offsetTop + (lineH - h) / 2; op = 0.32;
    } else if (st === 'underline') {
      w = cw; h = 3; y = word.offsetTop + lineH * 0.84; op = 1;
    } else {
      w = 3; h = lineH * 0.68; y = word.offsetTop + (lineH - h) / 2; op = 1;
    }
    this.caret.style.height = h + 'px';
    this.caret.style.width = w + 'px';
    this.caret.style.opacity = op;
    this.caret.style.transform = `translate(${x}px, ${y}px)`;
  }

  onResize() {
    if (!this.wordEls || !this.wordEls.length) return;
    this.measureLines();
    this.placeCaret();
    this.ensureVisible();
  }
}

/* ---------------- stats helpers ---------------- */
function consistencyOf(rawValues) {
  const vals = rawValues.filter(v => isFinite(v) && v > 0);
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean <= 0) return null;
  const v = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const cv = Math.sqrt(v) / mean;
  return clamp(Math.round((1 - cv) * 100), 0, 100);
}

/* ============================================================
   Word generation
 ============================================================ */
function transformWord(w, opts) {
  if (opts.nums && Math.random() < 0.13) {
    const digits = 2 + Math.floor(Math.random() * 3);
    return String(Math.floor(Math.random() * Math.pow(10, digits)));
  }
  return w;
}

function decorateWord(w, opts, capNext) {
  if (opts.punct) {
    if (capNext) { w = w[0].toUpperCase() + w.slice(1); }
    if (Math.random() < 0.16) {
      const sym = pick([',', '.', '!', '?', ';', ':']);
      w += sym;
      if (Math.random() < 0.55) return { w, capNext: sym !== ',' };
      return { w, capNext: Math.random() < 0.25 };
    }
    if (capNext) return { w, capNext: Math.random() < 0.3 };
    return { w, capNext: false };
  }
  return { w, capNext: false };
}

function genWords(count, opts = {}) {
  const level = opts.level || config.level;
  const pools = {
    beginner: WORDS.beginner, easy: WORDS.easy, medium: WORDS.medium,
    hard: WORDS.hard, expert: WORDS.expert
  };
  let pool = pools[level] || WORDS.easy;
  if (opts.mix) {
    pool = WORDS.easy.concat(WORDS.medium, WORDS.hard);
    if (level === 'hard' || level === 'expert') pool = pool.concat(WORDS.expert);
  }
  const o = { punct: opts.punct != null ? opts.punct : config.punct, nums: opts.nums != null ? opts.nums : config.nums };
  const out = [];
  let capNext = false;
  for (let i = 0; i < count; i++) {
    let { w, capNext: nc } = decorateWord(transformWord(pick(pool), o), o, capNext);
    capNext = nc;
    out.push(w);
  }
  return out;
}

function genQuote() {
  // avoid repeating the last quote
  if (typeof genQuote._last === 'undefined') genQuote._last = -1;
  let i;
  do { i = Math.floor(Math.random() * QUOTES.length); } while (i === genQuote._last && QUOTES.length > 1);
  genQuote._last = i;
  return QUOTES[i];
}

/* ============================================================
   Test controller
 ============================================================ */
let currentView = 'view-test';
let testEngine = null, practiceEngine = null;
let activeLesson = null;
let lastTest = { words: null, label: '', quote: null };

function timerPrefix() { return { time: 'Time', words: 'Words', quote: 'Words', custom: 'Words' }[config.mode]; }

function testTimeValue() {
  if (config.mode === 'time') return config.time;
  if (config.mode === 'quote') return lastTest.quote ? lastTest.quote.text.split(' ').length : config.words;
  if (config.mode === 'custom') return testEngine && testEngine.words ? testEngine.words.length : config.words;
  return config.words;
}

function relevantChips() {
  return config.mode !== 'quote';
}

function loadCustomText() {
  const s = store.get('keyflow.customText.v1', '');
  return s;
}

function initialWordsForTest() {
  if (config.mode === 'custom') {
    const txt = loadCustomText();
    const clean = txt && txt.trim().replace(/\s+/g, ' ');
    if (clean && clean.split(' ').length >= 3) return clean.split(' ');
    return genWords(30, { level: config.level, punct: false, nums: false });
  }
  const n = config.mode === 'time'
    ? Math.ceil(config.time * 2.2) + 30      // generous buffer for fast typists
    : config.words;
  return genWords(n, { level: config.level, punct: config.punct, nums: config.nums });
}

function newTest(regen = true, sameWords = false) {
  if (!testEngine) return;
  document.title = 'KeyFlow — Typing Speed Test & Practice';
  let words;
  if (sameWords && lastTest.words) {
    words = lastTest.words.slice();
  } else {
    if (config.mode === 'quote') {
      const q = genQuote();
      lastTest.quote = q;
      words = q.text.split(' ');
    } else {
      lastTest.quote = null;
      words = initialWordsForTest();
    }
    lastTest.words = words.slice();
  }
  const showQuote = config.mode === 'quote' && lastTest.quote;
  $('#quoteBy').hidden = !showQuote;
  if (showQuote) $('#quoteBy').textContent = '— ' + lastTest.quote.source;

  renderCfgSub();
  sgCache.w = -1; sgCache.words = '';
  testEngine.setWords(words);
  updateTimerDisplay(testEngine, true);
  $('#liveChartHolder').classList.remove('show');
  ChartLib.erase($('#liveCanvas'));
  $('#focusOverlay').classList.remove('hidden');
  $('#statStrip').classList.add('idle');
  $('#testKb').classList.toggle('hidden', !settings.showKb);
  if (testEngine && testEngine.o.onCaret) testEngine.o.onCaret(testEngine.nextHintChar());
}

function restartSameWords() {
  showView('view-test');
  newTest(false, true);
}

/* ---------------- next-word suggestions ---------------- */
let sgCache = { w: -1, words: '' };
function renderSuggestions(engine) {
  const bar = $('#suggestBar');
  if (!bar) return;
  const on = settings.suggestWords !== false && currentView === 'view-test';
  bar.classList.toggle('hidden', !on);
  if (!on || !engine || !engine.words) return;
  if (engine.done || !engine.words.length) { bar.classList.add('hidden'); return; }
  if (engine.w === sgCache.w) return;
  sgCache.w = engine.w;
  const holder = $('#suggestWords');
  const next = [];
  for (let i = 0; i < 3 && engine.w + i < engine.words.length; i++) next.push(engine.words[engine.w + i]);
  const key = next.join(' ');
  if (key === sgCache.words) return;
  sgCache.words = key;
  holder.innerHTML = next.map((w, i) => `<b class="sg-word${i === 0 ? ' first' : ''}">${w}</b>`).join('');
}

function updateTimerDisplay(engine, force) {
  const tv = $('#statTimer');
  const m = engine.metrics();
  if (!engine.done) {
    // progress meter
    const meter = $('#progressMeter');
    let pct = 0;
    if (engine.started) {
      pct = config.mode === 'time'
        ? clamp((m.sec / config.time) * 100, 0, 100)
        : clamp((engine.w / engine.words.length) * 100, 0, 100);
    }
    meter.classList.toggle('active', engine.started);
    meter.firstElementChild.style.width = pct + '%';
  }
  renderSuggestions(engine);
  if (engine.done) return;
  if (config.mode === 'time') {
    const remaining = engine.started ? Math.max(0, Math.ceil(config.time - m.sec)) : config.time;
    tv.textContent = remaining;
    tv.classList.toggle('flash', engine.started && remaining <= 3 && remaining > 0);
  } else {
    tv.textContent = engine.started ? Math.max(0, m.wordsLeft) : testTimeValue();
    tv.classList.remove('flash');
  }
  $('#statTimerLabel').textContent = timerPrefix();
  const live = $('#statWpm'), la = $('#statAcc');
  if (engine.started) {
    live.textContent = Math.max(0, Math.round(m.wpm));
    la.textContent = Math.round(m.acc);
  }
  $('#statStrip').classList.toggle('idle', !engine.started);
}

function drawLiveChart(samples) {
  if (!samples || samples.length < 2) return;
  $('#liveChartHolder').classList.add('show');
  ChartLib.draw($('#liveCanvas'), samples, { small: true, maxT: config.mode === 'time' ? config.time : 0 });
}

function onTestFinish(res) {
  const engine = testEngine;
  const m = engine.metrics();
  const cons = consistencyOf(engine.samples.map(s => s.raw));
  const totalTargetChars = engine.words.reduce((a, w) => a + w.length, 0);
  const tr = {
    ts: Date.now(),
    modeKey: config.mode === 'time' ? 'time-' + config.time
           : config.mode === 'words' ? 'words-' + config.words
           : config.mode === 'custom' ? 'custom' : 'quote',
    label: config.mode === 'time' ? 'time · ' + config.time + 's'
         : config.mode === 'words' ? 'words · ' + config.words
         : config.mode === 'custom' ? 'custom text'
         : 'quote',
    level: config.mode === 'quote' ? 'quote'
         : config.mode === 'custom' ? ''
         : (config.level + (config.punct ? ' @' : '') + (config.nums ? ' #' : '')),
    wpm: Math.max(0, m.wpm), raw: Math.max(0, m.rawWpm),
    acc: m.acc, cons, dur: m.sec,
    correct: m.correct, incorrect: m.incorrect, extra: m.extra,
    chars: totalTargetChars
  };
  const H = historyList();
  const prevSame = H.filter(r => r.modeKey === tr.modeKey);
  const pb = prevSame.reduce((a, r) => Math.max(a, r.wpm), 0);
  const pool = prevSame.length >= 3 ? prevSame.slice(0, 10) : H.slice(0, 10);
  const prevAvg = pool.length ? pool.reduce((a, r) => a + r.wpm, 0) / pool.length : null;
  H.unshift(tr); if (H.length > 400) H.length = 400;
  saveHistory(H);

  renderResults(tr, engine.samples, m, pb, prevAvg, res.reason, engine.errKeys);
  document.title = Math.round(Math.max(0, m.wpm)) + ' WPM · KeyFlow';
  if (pb > 0 && m.wpm > pb) toast('🏆 New personal best — ' + Math.round(m.wpm) + ' WPM', 'good', 3400);
  Sfx.done();
  showView('view-results');
}

function gradeOf(wpm) {
  if (wpm >= 90) return ['S', 'grade-s'];
  if (wpm >= 70) return ['A+', 'grade-a'];
  if (wpm >= 55) return ['A', 'grade-a'];
  if (wpm >= 45) return ['B', 'grade-b'];
  if (wpm >= 35) return ['C', 'grade-c'];
  if (wpm >= 25) return ['D', 'grade-d'];
  return ['E', 'grade-d'];
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function renderResults(tr, samples, m, pb, prevAvg, reason, errKeys) {
  $('#resTitle').textContent = reason === 'timeout' ? "Time's up!" : 'Test complete';
  $('#resMeta').textContent = [tr.label, tr.level, new Date(tr.ts).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ');
  $('#resWpm').textContent = fmt(m.wpm, 1);
  $('#resAcc').textContent = fmt(m.acc, 1) + '%';
  $('#resRaw').textContent = fmt(m.rawWpm, 1);
  $('#resCons').textContent = tr.cons == null ? '—' : tr.cons + '%';
  $('#resTime').textContent = fmt(m.sec, 1) + 's';
  $('#resChars').innerHTML =
    `<b>${m.correct}</b> correct · <b>${m.incorrect}</b> wrong · <b>${m.extra}</b> extra` +
    ` · <b>${Math.max(0, tr.chars - m.correct)}</b> missed`;

  // grade badge
  const badge = $('#resBadge');
  const [g, gcls] = gradeOf(Math.max(0, m.wpm));
  badge.textContent = g;
  badge.className = 'grade-badge ' + gcls;

  // recent-average comparison
  const cmp = $('#resCompare');
  if (prevAvg != null) {
    const d = m.wpm - prevAvg;
    cmp.textContent = `${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d), 1)} vs your recent average (${fmt(prevAvg, 1)} wpm)`;
    cmp.style.color = d >= 0 ? 'var(--good)' : 'var(--muted)';
  } else {
    cmp.textContent = '';
  }

  // weak keys panel
  const wk = Object.entries(errKeys || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const weakBox = $('#resWeak');
  if (wk.length) {
    weakBox.classList.remove('hidden');
    $('#resWeakLine').innerHTML =
      '<div class="wk-label">keys to improve</div><div class="wk-caps">' +
      wk.map(([k, c]) => `<span class="wk"><kbd>${k === ' ' ? '␣' : esc(k)}</kbd><em>${c}×</em></span>`).join('') +
      '</div>';
    lastTest.weakKeys = wk.map(([k]) => k);
  } else {
    weakBox.classList.add('hidden');
    lastTest.weakKeys = null;
  }

  const isNewPB = pb > 0 && m.wpm > pb;
  $('#pbNote').innerHTML = isNewPB
    ? `<span class="pb-hot">🏆 New personal best for this mode — previous best ${fmt(pb, 1)} WPM</span>`
    : pb > 0 ? `Personal best for this mode: ${fmt(pb, 1)} WPM` : 'First time in this mode — this sets your baseline.';
  const refs = [
    prevAvg != null ? { value: prevAvg, label: 'avg' } : null,
    pb > 0 ? { value: pb, label: 'best' } : null
  ].filter(Boolean);
  lastTest.refs = refs;
  ChartLib.draw($('#resCanvas'), samples, { maxT: config.mode === 'time' ? config.time : 0, refs });
  lastTest.samples = samples;
}

function startWeakDrill(keys) {
  if (!keys || !keys.length) return;
  const L = {
    id: 'weak-drill', num: '★', title: 'Weak Keys Drill',
    desc: 'Targeted drilling for your most-missed keys — aim for accuracy first, the speed will follow.',
    keys: keys.slice(0, 6), type: 'pool', target: { wpm: 25, acc: 94 }
  };
  showView('view-practice');
  startLesson(L);
  toast('Drilling weak keys: ' + L.keys.join(' '), 'good');
}
$('#btnWeakDrill').addEventListener('click', () => startWeakDrill(lastTest.weakKeys));

/* ============================================================
   Practice controller
 ============================================================ */
const lessonRecords = () => store.get('keyflow.lessons.v1', {});
const saveLessonRecords = r => store.set('keyflow.lessons.v1', r);

function lessonWordsGen(lesson, n) {
  const words = [];
  for (let i = 0; i < n; i++) {
    if (lesson.type === 'list' || lesson.type === 'mix') {
      let src = lesson.src === 'all' ? null : lesson.src;
      let word;
      if (lesson.type === 'mix') word = Math.random() < 0.6 ? pick(WORDS.medium) : pick(WORDS.hard);
      else word = pick(WORDS[src] || WORDS.easy);
      words.push(word);
      continue;
    }
    // random pseudo-words from a character pool
    let chars;
    if (lesson.capital || lesson.punct) {
      chars = lesson.pool || ['a','e','t','n','o','r','s','l'];
    } else {
      chars = lesson.keys.filter(k => k.length === 1);
    }
    const len = 3 + Math.floor(Math.random() * 2);
    let w = '';
    for (let j = 0; j < len; j++) w += pick(chars);
    if (lesson.capital && Math.random() < 0.5) w = w[0].toUpperCase() + w.slice(1);
    if (lesson.punct) {
      w = w[0].toUpperCase() + w.slice(1);
      if (Math.random() < 0.6) w += pick([',', '.', ';', ':', '?', '!', "'", '"']);
    }
    words.push(w);
  }
  return words;
}

function renderLessons() {
  const recs = lessonRecords();
  const el = $('#lessonList');
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'practice-empty';
  head.innerHTML = '<b style="color:var(--text);font-size:15px">Guided lessons</b><br>Train each row until it is automatic. Click a lesson to start.';
  el.appendChild(head);
  LESSONS.forEach(L => {
    const rec = recs[L.id];
    const card = document.createElement('button');
    card.className = 'lesson-card' + (rec && rec.passed ? ' passed' : '') + (activeLesson && activeLesson.id === L.id ? ' active' : '');
    const keycaps = L.keys.slice(0, 8).map(k => `<kbd>${k}</kbd>`).join('');
    const best = rec && rec.bestWpm != null
      ? `<span>best <b>${Math.round(rec.bestWpm)}</b> wpm</span><span class="${rec.passed ? 'ok' : ''}">${Math.round(rec.bestAcc)}% acc</span>`
      : '<span>no attempt yet</span>';
    card.innerHTML = `
      <div class="lesson-top"><span class="lesson-num">${L.num}</span><span class="lesson-title">${L.title}</span></div>
      <div class="lesson-desc">${L.desc}</div>
      <div class="lesson-keys">${keycaps}</div>
      <div class="lesson-best">${best}<span>target ${L.target.wpm} wpm · ${L.target.acc}%</span></div>`;
    card.addEventListener('click', () => startLesson(L));
    el.appendChild(card);
  });
}

function startLesson(lesson, keepWords) {
  activeLesson = lesson;
  if (!practiceEngine) {
    practiceEngine = new Engine({
      container: $('#pWords'),
      finite: true,
      onCaret: c => { if (kbPractice) kbPractice.highlight(c); },
      onWrong: () => Sfx.err(),
      onTick: (e) => {
        const m = e.metrics();
        $('#pStatWpm').textContent = e.started ? Math.max(0, Math.round(m.wpm)) : 0;
        $('#pStatAcc').textContent = e.started ? Math.round(m.acc) : 100;
        $('#pStatLeft').textContent = Math.max(0, e.words.length - e.w);
      },
      onSample: null,
      onStart: () => {},
      onFinish: onLessonFinish
    });
  }
  const words = keepWords && lastPracticeWords ? lastPracticeWords : lessonWordsGen(lesson, 25);
  lastPracticeWords = words.slice();
  practiceEngine.setWords(words);
  const li = LESSONS.findIndex(x => x.id === lesson.id);
  $('#pSub').textContent = li >= 0 ? `Lesson ${li + 1} of ${LESSONS.length}` : 'Targeted drill';
  $('#pTitle').textContent = lesson.title;
  $('#pDesc').textContent = lesson.desc + ' — target: ' + lesson.target.wpm + ' WPM · ' + lesson.target.acc + '% accuracy';
  $('#pStatTarget').textContent = lesson.target.wpm + '/' + lesson.target.acc;
  $('#pStatWpm').textContent = '0';
  $('#pStatAcc').textContent = '100';
  $('#pStatLeft').textContent = words.length;
  $('#pResult').classList.add('hidden');
  $('#pStrip').classList.remove('idle');
  $('#practicePane').classList.remove('hidden');
  renderLessons();
  renderRoadmap();
}

/** Clickable lesson progress dots. */
function renderRoadmap() {
  const el = $('#lessonRoadmap');
  if (!el) return;
  const recs = lessonRecords();
  el.innerHTML = '';
  LESSONS.forEach(L => {
    const rec = recs[L.id];
    const b = document.createElement('button');
    b.textContent = L.num;
    b.title = L.title + (rec && rec.passed ? ' — passed' : '');
    b.className =
      (rec && rec.passed ? 'passed ' : '') +
      (activeLesson && activeLesson.id === L.id ? 'current' : '');
    b.addEventListener('click', () => startLesson(L));
    el.appendChild(b);
  });
}

function restartLessonSame() { if (activeLesson) startLesson(activeLesson, false); }

function onLessonFinish(res) {
  const engine = practiceEngine;
  const m = engine.metrics();
  const cons = consistencyOf(engine.samples.map(s => s.raw));
  const L = activeLesson;
  const recs = lessonRecords();
  const rec = recs[L.id] || {};
  const prevBest = rec.bestWpm || 0;
  rec.bestWpm = Math.max(prevBest, m.wpm);
  rec.bestAcc = Math.max(rec.bestAcc || 0, m.acc);
  rec.attempts = (rec.attempts || 0) + 1;
  const passed = m.wpm >= L.target.wpm && m.acc >= L.target.acc;
  if (passed) rec.passed = true;
  recs[L.id] = rec;
  saveLessonRecords(recs);

  const v = $('#prVerdict');
  v.textContent = passed ? 'PASSED' : 'ALMOST';
  v.className = 'pr-verdict ' + (passed ? 'pass' : 'fail');
  $('#prLesson').textContent = L.title + ' · target ' + L.target.wpm + ' wpm / ' + L.target.acc + '%';
  $('#prWpm').textContent = fmt(m.wpm, 1);
  $('#prAcc').textContent = fmt(m.acc, 1) + '%';
  $('#prCons').textContent = cons == null ? '—' : cons + '%';
  $('#prBest').textContent = Math.round(rec.bestWpm) + ' wpm';
  $('#prNote').innerHTML = passed
    ? (rec.attempts > 1 ? `Great — lesson unlocked consistently. Next up: <b>${nextLesson(L) ? nextLesson(L).title : 'your own practice'}</b>.`
                        : 'Clean and fast. Move to the next lesson.')
    : (m.acc < L.target.acc
        ? `Accuracy is the bottleneck (${fmt(m.acc, 0)}% — needs ${L.target.acc}%). Slow down ~10% and aim for zero errors: speed follows precision.`
        : `Accuracy is fine — you need ${Math.max(0, Math.ceil(L.target.wpm - m.wpm))} more WPM to pass. Try small bursts of speed while keeping the keyboard highlighted.`);
  $('#pResult').classList.remove('hidden');
  if (practiceEngine.o.onCaret) practiceEngine.o.onCaret(null);
  Sfx.done();
  toast(passed ? '✅ Lesson passed — well done' : 'Almost… check the tips below', passed ? 'good' : 'warn');
  renderLessons();
  renderRoadmap();
}

function nextLesson(L) {
  const i = LESSONS.findIndex(x => x.id === L.id);
  return i >= 0 && i < LESSONS.length - 1 ? LESSONS[i + 1] : null;
}

function exitLesson() {
  activeLesson = null;
  $('#practicePane').classList.add('hidden');
  renderLessons();
  if (kbPractice) kbPractice.clear();
}
let lastPracticeWords = null;

/* ============================================================
   History
 ============================================================ */
function historyList() { return store.get('keyflow.history.v1', []); }
function saveHistory(list) { store.set('keyflow.history.v1', list); }

function humanDur(s) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}m ${r}s` : `${r}s`;
}

function calcStreak(entryList) {
  const days = new Set(entryList.map(r => new Date(r.ts).toDateString()));
  let n = 0;
  const d = new Date();
  while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHistory() {
  const H = historyList();
  const cards = $('#hCards');
  const best = H.reduce((a, r) => Math.max(a, r.wpm), 0);
  const last10 = H.slice(0, 10);
  const avg10 = last10.length ? last10.reduce((a, r) => a + r.wpm, 0) / last10.length : null;
  const avgAcc = last10.length ? last10.reduce((a, r) => a + r.acc, 0) / last10.length : null;
  const total = H.reduce((a, r) => a + r.dur, 0);
  const todayCount = H.filter(r => new Date(r.ts).toDateString() === new Date().toDateString()).length;
  const streak = calcStreak(H);
  const cardsHtml = [
    { label: 'BEST WPM', value: H.length ? Math.round(best) : '—' },
    { label: 'AVG · LAST 10', value: avg10 == null ? '—' : Math.round(avg10) },
    { label: 'AVG ACCURACY', value: avgAcc == null ? '—' : Math.round(avgAcc) + '%' },
    { label: 'TESTS', value: H.length },
    { label: 'STREAK', value: H.length ? streak + ' d' : '—', cls: streak > 0 ? ' streak' : '' },
    { label: 'TODAY', value: todayCount },
    { label: 'TIME TYPED', value: humanDur(total) }
  ].map(c => `<div class="h-card"><div class="label">${c.label}</div><div class="value mono${c.cls || ''}">${c.value}</div></div>`).join('');
  cards.innerHTML = cardsHtml;

  const body = $('#hBody');
  body.innerHTML = '';
  $('#hEmpty').style.display = H.length ? 'none' : 'block';
  H.slice(0, 60).forEach(r => {
    const tr = document.createElement('tr');
    const barW = Math.min(100, Math.max(2, (r.wpm / 120) * 100)).toFixed(0);
    tr.innerHTML = `
      <td>${new Date(r.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${new Date(r.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
      <td><span class="mode-tag">${[r.label, r.level].filter(Boolean).join(' · ')}</span></td>
      <td class="mono">${fmt(r.wpm, 1)}<span class="wbar"><i style="width:${barW}%"></i></span></td>
      <td class="mono">${fmt(r.raw, 1)}</td>
      <td class="mono">${fmt(r.acc, 1)}%</td>
      <td class="mono">${r.cons == null ? '—' : r.cons + '%'}</td>
      <td class="mono">${r.incorrect + r.extra}</td>
      <td>${humanDur(r.dur)}</td>`;
    body.appendChild(tr);
  });
}

$('#btnClearHistory').addEventListener('click', () => {
  if (!historyList().length) return;
  if (confirm('Delete all saved test history? This cannot be undone.')) {
    store.del('keyflow.history.v1');
    renderHistory();
    toast('History cleared', 'warn');
  }
});

/* ============================================================
   Config chips UI
 ============================================================ */
function renderCfgSub() {
  const sub = $('#cfgSub');
  const isQuote = config.mode === 'quote';
  const isCustom = config.mode === 'custom';
  const hideAux = isQuote || isCustom;
  document.querySelectorAll('#cfgLevel, #cfgToggles').forEach(g => g.classList.toggle('hidden', hideAux));
  $('#sepLevel').classList.toggle('hidden', hideAux);
  $('#sepSub').classList.toggle('hidden', isQuote);
  sub.classList.toggle('hidden', isQuote);
  sub.innerHTML = '';
  if (isQuote) {
    document.querySelectorAll('#cfgModes .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === 'quote'));
    return;
  }
  if (isCustom) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.id = 'chipCustomEdit';
    b.textContent = '✎ edit text';
    b.title = 'Change the custom text';
    b.addEventListener('click', () => openCustomDialog());
    sub.appendChild(b);
    document.querySelectorAll('#cfgModes .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === 'custom'));
    return;
  }
  const options = config.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
  options.forEach(v => {
    const b = document.createElement('button');
    b.className = 'chip' + (String(v) === String(config[config.mode]) ? ' active' : '');
    b.textContent = v;
    b.addEventListener('click', () => {
      config[config.mode] = v; saveConfig();
      newTest(true);
    });
    sub.appendChild(b);
  });
  document.querySelectorAll('#cfgModes .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === config.mode));
  document.querySelectorAll('#cfgLevel .chip').forEach(c => c.classList.toggle('active', c.dataset.level === config.level));
  $('#chipPunct').classList.toggle('on', config.punct);
  $('#chipNums').classList.toggle('on', config.nums);
}

$$('#cfgModes .chip').forEach(c => c.addEventListener('click', () => {
  if (config.mode !== c.dataset.mode) {
    const wasMode = config.mode;
    config.mode = c.dataset.mode; saveConfig();
    if (config.mode === 'custom' && !loadCustomText()) {
      newTest(true);          // engine shows fallback words, stays consistent
      renderCfgSub();
      openCustomDialog();     // prompt for the real text
      return;
    }
    newTest(true);
  }
}));
$$('#cfgLevel .chip').forEach(c => c.addEventListener('click', () => {
  if (config.level !== c.dataset.level) { config.level = c.dataset.level; saveConfig(); newTest(true); }
}));
$('#chipPunct').addEventListener('click', () => { config.punct = !config.punct; saveConfig(); newTest(true); });
$('#chipNums').addEventListener('click', () => { config.nums = !config.nums; saveConfig(); newTest(true); });
$('#chipKb').addEventListener('click', () => {
  settings.showKb = !settings.showKb; saveSettings(); syncSettingsUI();
  $('#testKb').classList.toggle('hidden', !settings.showKb);
});
$('#btnNewTest').addEventListener('click', () => newTest(true));

/* ============================================================
   Views & nav
 ============================================================ */
function showView(id) {
  currentView = id;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  window.scrollTo({ top: 0 });
  if (id === 'view-history') renderHistory();
}
$$('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

/* ============================================================
   Settings dialog
 ============================================================ */
function syncSettingsUI() {
  $('#setTheme').value = settings.theme;
  $('#setAccent').value = settings.accent || 'teal';
  $('#setSound').checked = settings.sound;
  $('#setSuggest').checked = settings.suggestWords !== false;
  $('#setCaret').checked = settings.smoothCaret;
  $('#setCaretStyle').value = settings.caretStyle || 'line';
  $('#setKb').checked = settings.showKb;
  $('#setFontSize').value = settings.fontSize;
  $('#setFontVal').textContent = settings.fontSize + 'px';
}

function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.accent = settings.accent || 'teal';
  document.documentElement.dataset.caret = settings.caretStyle || 'line';
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  document.documentElement.classList.toggle('no-smooth', !settings.smoothCaret);
  soundOn = settings.sound;
  const tIcon = $('#themeIcon');
  if (tIcon) tIcon.textContent = settings.theme === 'light' ? '☀' : '☾';
  if (testEngine) $('#testKb').classList.toggle('hidden', !settings.showKb);
  syncSettingsUI();
}

const dlg = $('#settingsDialog');
$('#btnTheme').addEventListener('click', () => {
  settings.theme = settings.theme === 'light' ? 'dark' : 'light';
  saveSettings();
  applySettings();
  reflowCharts();
});
$('#btnSettings').addEventListener('click', () => { syncSettingsUI(); dlg.classList.add('open'); });
$('#btnSettingsClose').addEventListener('click', () => dlg.classList.remove('open'));
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.classList.remove('open'); });

const hdlg = $('#helpDialog');
$('#btnHelp').addEventListener('click', () => hdlg.classList.add('open'));
$('#btnHelpClose').addEventListener('click', () => hdlg.classList.remove('open'));
hdlg.addEventListener('click', e => { if (e.target === hdlg) hdlg.classList.remove('open'); });

/* ---------------- custom text mode ---------------- */
const cdlg = $('#customDialog');
function openCustomDialog() {
  $('#customText').value = loadCustomText();
  updateCustomCount();
  cdlg.classList.add('open');
  requestAnimationFrame(() => $('#customText').focus());
}
function updateCustomCount() {
  const s = $('#customText').value.trim();
  const n = s ? s.replace(/\s+/g, ' ').split(' ').length : 0;
  $('#customCount').textContent = n + (n === 1 ? ' word' : ' words');
}
$('#customText').addEventListener('input', updateCustomCount);
$('#btnCustomClose').addEventListener('click', () => cdlg.classList.remove('open'));
cdlg.addEventListener('click', e => { if (e.target === cdlg) cdlg.classList.remove('open'); });
$('#btnCustomClear').addEventListener('click', () => { $('#customText').value = ''; updateCustomCount(); $('#customText').focus(); });
$('#btnCustomStart').addEventListener('click', () => {
  const raw = $('#customText').value;
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.split(' ').filter(Boolean).length < 3) {
    toast('Add a few words first — 3 at minimum', 'warn');
    return;
  }
  store.set('keyflow.customText.v1', clean);
  cdlg.classList.remove('open');
  toast('Custom text saved — test updated', 'good');
  showView('view-test');
  newTest(true);
});

/* ---------------- share result ---------------- */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  return ok;
}
function buildShareText() {
  const l = historyList()[0];
  if (!l) return 'KeyFlow typing test';
  const parts = [
    `⌨️ KeyFlow — ${l.label}${l.level && l.level !== 'quote' ? ' · ' + l.level : ''}`,
    `${Math.round(l.wpm)} WPM · ${Math.round(l.acc)}% accuracy` +
    (l.cons != null ? ` · ${l.cons}% consistency` : '')
  ];
  return parts.join('\n');
}
$('#btnShare').addEventListener('click', () => {
  const text = buildShareText();
  copyText(text).then(() => toast('Result copied — paste it anywhere you like', 'good'));
});

$('#setTheme').addEventListener('change', () => { settings.theme = $('#setTheme').value; saveSettings(); applySettings(); reflowCharts(); });
$('#setAccent').addEventListener('change', () => { settings.accent = $('#setAccent').value; saveSettings(); applySettings(); reflowCharts(); });
$('#setSound').addEventListener('change', () => { settings.sound = $('#setSound').checked; saveSettings(); applySettings(); });
$('#setSuggest').addEventListener('change', () => { settings.suggestWords = $('#setSuggest').checked; saveSettings(); sgCache.w = -1; sgCache.words = ''; updateTimerDisplay(testEngine, true); });
$('#setCaret').addEventListener('change', () => { settings.smoothCaret = $('#setCaret').checked; saveSettings(); applySettings(); });
$('#setCaretStyle').addEventListener('change', () => {
  settings.caretStyle = $('#setCaretStyle').value; saveSettings(); applySettings();
  requestAnimationFrame(() => {
    if (testEngine) { testEngine.placeCaret(); }
    if (practiceEngine) { practiceEngine.placeCaret(); }
  });
});
$('#setKb').addEventListener('change', () => { settings.showKb = $('#setKb').checked; saveSettings(); applySettings(); $('#chipKb').classList.toggle('on', settings.showKb); });
$('#setFontSize').addEventListener('input', () => {
  settings.fontSize = parseInt($('#setFontSize').value, 10);
  saveSettings(); applySettings();
  requestAnimationFrame(() => { if (testEngine) testEngine.onResize(); if (practiceEngine) practiceEngine.onResize(); });
});
$('#chipKb').classList.toggle('on', settings.showKb);

function reflowCharts() {
  if (currentView === 'view-results' && lastTest.samples) {
    ChartLib.draw($('#resCanvas'), lastTest.samples, {
      maxT: config.mode === 'time' ? config.time : 0,
      refs: lastTest.refs || []
    });
  }
}

/* ---------------- chart hover ---------------- */
[['#resCanvas'], ['#liveCanvas']].forEach(([sel]) => {
  const c = $(sel);
  if (!c) return;
  c.addEventListener('mousemove', e => ChartLib.hover(c, e));
  c.addEventListener('mouseleave', () => ChartLib.hover(c, null));
});

/* ============================================================
   Results buttons
 ============================================================ */
$('#btnNextTest').addEventListener('click', () => { showView('view-test'); newTest(true); });
$('#btnRepeat').addEventListener('click', () => restartSameWords());
$('#btnGoTest').addEventListener('click', () => showView('view-test'));

/* ============================================================
   Practice buttons
 ============================================================ */
$('#btnLessonExit').addEventListener('click', exitLesson);
$('#btnPExit2').addEventListener('click', exitLesson);
$('#btnPRetry').addEventListener('click', () => restartLessonSame());
$('#btnPNext').addEventListener('click', () => {
  const next = activeLesson && nextLesson(activeLesson);
  if (next) startLesson(next, false);
  else exitLesson();
});

/* ============================================================
   Keyboards
 ============================================================ */
const kbTest = new KeyboardUI($('#testKb'));
const kbPractice = new KeyboardUI($('#practiceKb'));
function testCaretHint(ch) { if (settings.showKb) kbTest.highlight(ch); }

/* ============================================================
   Test engine wiring
 ============================================================ */
testEngine = new Engine({
  container: $('#words'),
  finite: () => config.mode !== 'time',
  autoAppend: () => { // time mode: keep a healthy buffer of words
    if (config.mode !== 'time') return null;
    return genWords(40, { level: config.level, punct: config.punct, nums: config.nums });
  },
  onStart: () => {
    if (config.mode === 'time' && !testEngine.limitWatch) {
      testEngine.limitWatch = setInterval(() => {
        const e = testEngine;
        if (!e || e.done) return;
        const m = e.metrics();
        if (config.mode === 'time' && m.sec >= config.time) {
          clearInterval(e.limitWatch); e.limitWatch = null;
          e.finish('timeout');
        }
      }, 100);
    }
  },
  onTick: e => updateTimerDisplay(e),
  onSample: s => drawLiveChart(s),
  onWrong: () => Sfx.err(),
  onCaret: c => testCaretHint(c),
  onFinish: (res) => {
    if (testEngine.limitWatch) { clearInterval(testEngine.limitWatch); testEngine.limitWatch = null; }
    onTestFinish(res);
  }
});

/* ============================================================
   Global key handling
 ============================================================ */
window.addEventListener('keydown', e => {
  const dlgOpen = dlg.classList.contains('open');
  const helpOpen = hdlg.classList.contains('open');
  const customOpen = cdlg.classList.contains('open');
  if (dlgOpen || helpOpen || customOpen) {
    if (e.key === 'Escape') { dlg.classList.remove('open'); hdlg.classList.remove('open'); cdlg.classList.remove('open'); }
    return;  // don't drive the test while a dialog is open
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (currentView === 'view-test') newTest(true);
    else if (currentView === 'view-practice' && activeLesson) restartLessonSame();
    else showView('view-test');
    return;
  }
  if (e.key === 'Escape') {
    if (currentView === 'view-results') restartSameWords();
    else if (currentView === 'view-test') newTest(false, true);
    else if (currentView === 'view-practice' && activeLesson) restartLessonSame();
    return;
  }
  if (currentView === 'view-results') {
    if (e.key === 'Enter') { e.preventDefault(); showView('view-test'); newTest(true); }
    return;
  }

  const isPractice = currentView === 'view-practice' && activeLesson;
  const eng = isPractice ? practiceEngine : (currentView === 'view-test' ? testEngine : null);
  if (!eng || eng.done) {
    if (e.key === 'Enter' && eng && eng.done) {
      if (isPractice) restartLessonSame();
      else { showView('view-test'); newTest(true); }
    }
    return;
  }

  const altGr = e.ctrlKey && e.altKey;
  if ((e.ctrlKey && !altGr) || e.metaKey || (e.altKey && !altGr)) return;

  if (e.key.length === 1) {
    if (eng.processKey(e.key)) e.preventDefault();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    eng.processBackspace();
  } else if (e.key === ' ') {
    // handled by length===1 above in all modern browsers
  }
});

/* ============================================================
   Resize
 ============================================================ */
window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    if (currentView === 'view-test' && testEngine) testEngine.onResize();
    if (currentView === 'view-practice' && practiceEngine) practiceEngine.onResize();
    reflowCharts();
  });
});

/* ============================================================
   Boot
 ============================================================ */
applySettings();
renderCfgSub();
renderLessons();
newTest(true);
showView('view-test');

