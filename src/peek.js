// 👁 필드 보기 — any pending prompt (choice picker / confirm / attack-flow / jogress) can be folded into a small floating
// pill so the player can read the board, then reopened exactly where they left off. Pure presentation: collapsing never
// resolves anything (the prompt's resolve callback stays pending, busy() rules are unchanged); all partial selections
// live in `state` (_multiPick/_orderPick), so a re-render while collapsed loses nothing. Collapse state is per prompt:
// a new prompt (new key) always opens expanded.
const P = { key: null, collapsed: false, scroll: 0, cancelable: false, title: '' };
const ids = new WeakMap(); let idSeq = 0;
export const peekIdOf = (o) => { if (!o) return 'none'; if (typeof o !== 'object') return String(o); if (!ids.has(o)) ids.set(o, ++idSeq); return 'o' + ids.get(o); };
export const peekState = () => ({ ...P });

function el(tag, cls, text, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
  return e;
}
const wrapEl = () => document.querySelector('.peek-wrap');

// measure the fixed bottom sheet (phone action sheet / breeding bar) so the pill floats just above it
function placePill() {
  const w = wrapEl(); if (!w) return;
  let bottom = 0;
  for (const s of ['.breed-bar', '.actions']) {
    const n = document.querySelector(s);
    if (n && getComputedStyle(n).position === 'fixed') bottom = Math.max(bottom, n.getBoundingClientRect().height);
  }
  w.style.setProperty('--peek-bottom', (bottom ? bottom + 8 : 12) + 'px');
}

function apply(collapsed, opts) {
  const w = wrapEl(); if (!w) return;
  const panel = w.querySelector('.modal-panel');
  if (collapsed && !P.collapsed && panel) P.scroll = panel.scrollTop;
  P.collapsed = collapsed;
  w.classList.remove('peeking');
  w.classList.toggle('collapsed', collapsed);
  const btn = w.querySelector('.peek-btn'), pill = w.querySelector('.peek-pill');
  if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
  if (pill) pill.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed) { placePill(); if (!(opts && opts.noFocus) && pill) pill.focus({ preventScroll: true }); }
  else if (panel) {
    panel.scrollTop = P.scroll;
    if (!(opts && opts.noFocus)) { const f = panel.querySelector('button.primary:not([disabled])') || panel.querySelector('button:not(.peek-btn):not([disabled])') || btn; if (f) f.focus({ preventScroll: true }); }
  }
}
export const peekToggle = () => apply(!P.collapsed);

// wrap a rendered `.modal-backdrop` node. o = { key, title, pill, cancelable }
export function peekWrap(backdrop, o) {
  const key = o.key || 'x';
  if (P.key !== key) { P.key = key; P.collapsed = false; P.scroll = 0; }
  P.cancelable = !!o.cancelable; P.title = o.title || '';
  const panel = backdrop.querySelector('.modal-panel');
  const btn = el('button', 'peek-btn', '👁 필드 보기', { type: 'button', 'aria-expanded': String(!P.collapsed), 'aria-label': '필드 보기 (창 접기)', title: '눌러서 접기 (V / Esc) · 누르고 있으면 반투명하게 미리보기' });
  btn.addEventListener('click', (e) => { if (btn._held) { btn._held = false; e.preventDefault(); return; } apply(true); });
  // peek: hover (mouse) or press-and-hold (touch) fades the dialog so the board shows through, nothing is toggled
  let timer = 0;
  const peekOn = () => { const w = wrapEl(); if (w) w.classList.add('peeking'); };
  const peekOff = () => { clearTimeout(timer); const w = wrapEl(); if (w) w.classList.remove('peeking'); };
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') peekOn(); });
  btn.addEventListener('pointerleave', peekOff);
  btn.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { btn._held = false; timer = setTimeout(() => { btn._held = true; peekOn(); }, 320); } });
  for (const t of ['pointerup', 'pointercancel']) btn.addEventListener(t, () => { clearTimeout(timer); const w = wrapEl(); if (btn._held && w) w.classList.remove('peeking'); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  const head = el('div', 'peek-head');
  head.appendChild(el('span', 'peek-title', o.title || '선택'));
  head.appendChild(btn);
  if (panel) panel.insertBefore(head, panel.firstChild);

  const pill = el('button', 'peek-pill', null, { type: 'button', 'aria-expanded': String(!P.collapsed), 'aria-label': '선택창 다시 열기', title: '누르면 선택창을 다시 엽니다 (V)' });
  pill.appendChild(el('span', 'peek-pill-t', o.pill || o.title || '선택 대기'));
  pill.appendChild(el('span', 'peek-pill-x', '↥ 열기'));
  pill.addEventListener('click', () => apply(false));

  const wrap = el('div', 'peek-wrap' + (P.collapsed ? ' collapsed' : ''));
  wrap.appendChild(backdrop); wrap.appendChild(pill);
  if (P.collapsed) requestAnimationFrame(placePill);
  return wrap;
}

// no prompt on screen any more: forget the collapse state
export function peekNone() { P.key = null; P.collapsed = false; P.scroll = 0; }

if (typeof document !== 'undefined' && !window.__peekKeys) {
  window.__peekKeys = true; // single document-level listener (never re-added)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !wrapEl()) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.key === 'v' || e.key === 'V' || e.key === 'ㅍ') { e.preventDefault(); peekToggle(); }
    else if (e.key === 'Escape') {
      // required prompts: Esc folds/unfolds. Cancelable ones keep Esc for their own cancel behaviour (V toggles instead)
      if (P.collapsed) { e.preventDefault(); apply(false); } else if (!P.cancelable) { e.preventDefault(); apply(true); }
    }
  });
  window.addEventListener('resize', () => { if (P.collapsed) placePill(); });
}
