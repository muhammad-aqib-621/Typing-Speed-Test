/* ============================================================
   KeyFlow — on-screen keyboard rendering & next-key highlighting
 ============================================================ */

const KB_ROWS = [
  [['`','`',1],['1','1',1],['2','2',1],['3','3',1],['4','4',1],['5','5',1],['6','6',1],['7','7',1],['8','8',1],['9','9',1],['0','0',1],['-','-',1],['=','=',1],['Backspace','⌫',2]],
  [['Tab','Tab',1.5],['q','q',1],['w','w',1],['e','e',1],['r','r',1],['t','t',1],['y','y',1],['u','u',1],['i','i',1],['o','o',1],['p','p',1],['[','[',1],[']',']',1],['\\','\\',1.5]],
  [['CapsLock','Caps',1.75],['a','a',1],['s','s',1],['d','d',1],['f','f',1],['g','g',1],['h','h',1],['j','j',1],['k','k',1],['l','l',1],[';',';',1],["'", "'",1],['Enter','⏎',2.25]],
  [['ShiftLeft','⇧ Shift',2.25],['z','z',1],['x','x',1],['c','c',1],['v','v',1],['b','b',1],['n','n',1],['m','m',1],[',',',',1],['.','.',1],['/','/',1],['ShiftRight','Shift ⇧',2.75]],
  [['Space','space',6.25]]
];

const SHIFT_MAP = {
  '~':'`', '!':'1', '@':'2', '#':'3', '$':'4', '%':'5', '^':'6', '&':'7', '*':'8',
  '(':'9', ')':'0', '_':'-', '+':'=', '{':'[', '}':']', '|':'\\', ':':';', '"':"'",
  '<':',', '>':'.', '?':'/'
};

class KeyboardUI {
  constructor(root) {
    this.root = root;
    this.map = {};
    this.shiftEls = [];
    this.lastKey = null;
    this.lastShift = [];
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.map = {};
    this.shiftEls = [];
    root: {
      KB_ROWS.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'kb-row';
        row.forEach(([k, label, w]) => {
          const el = document.createElement('div');
          const suffix = { 1: '1', 1.5: '15', 1.75: '175', 2: '2', 2.25: '225', 2.75: '275', 6.25: '625' }[w] || '1';
          el.className = 'key key' + suffix;
          el.textContent = label;
          rowEl.appendChild(el);
          if (k === 'ShiftLeft' || k === 'ShiftRight') this.shiftEls.push(el);
          else this.map[k] = el;
        });
        this.root.appendChild(rowEl);
      });
    }
  }

  /** Highlight the key used to type `ch` (next expected char). */
  highlight(ch) {
    if (this.lastKey) { this.lastKey.classList.remove('kb-next'); this.lastKey = null; }
    this.lastShift.forEach(e => e.classList.remove('kb-shift'));
    this.lastShift = [];
    if (!ch) return;
    let needShift = false;
    let base;
    if (ch === ' ') { base = 'Space'; }
    else if (SHIFT_MAP[ch]) { base = SHIFT_MAP[ch]; needShift = true; }
    else if (/[A-Z]/.test(ch)) { base = ch.toLowerCase(); needShift = true; }
    else { base = ch; }
    const el = this.map[base];
    if (el) { el.classList.add('kb-next'); this.lastKey = el; }
    if (needShift) {
      this.shiftEls.forEach(e => e.classList.add('kb-shift'));
      this.lastShift = this.shiftEls.slice();
    }
  }

  clear() { this.highlight(null); }
}
