// Phone-friendly chrome: compact top bar (one line + drawer), slim CPU strip, minimizing bottom breeding sheet.
// Pure DOM helpers + a matchMedia switch (#app.mob-compact). Styles: mobilebar.css. Nothing here touches game logic.
const MQ = '(max-width: 900px), (pointer: coarse)';
export const MB = { compact: false, cpuOpen: false, breedMin: false, breedKey: '' };
let mql = null;

export function mbInit(app, onChange) {
  try {
    mql = window.matchMedia(MQ);
    const apply = () => { MB.compact = !!mql.matches; app.classList.toggle('mob-compact', MB.compact); if (!MB.compact) { app.classList.remove('mb-menu-open'); MB.cpuOpen = false; } };
    apply();
    const changed = () => { const was = MB.compact; apply(); if (was !== MB.compact && onChange) onChange(); };
    if (mql.addEventListener) mql.addEventListener('change', changed); else if (mql.addListener) mql.addListener(changed);
    window.addEventListener('resize', changed);
  } catch (e) { /* ignore */ }
  // outside tap closes the drawer / the CPU popover
  document.addEventListener('pointerdown', (e) => {
    if (!MB.compact) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (app.classList.contains('mb-menu-open') && !(t.closest('.mb-drawer') || t.closest('.mb-menu-btn'))) app.classList.remove('mb-menu-open');
    if (MB.cpuOpen && !t.closest('.cpu-bar')) { MB.cpuOpen = false; const c = app.querySelector('.cpu-bar'); if (c) c.classList.remove('mb-open'); }
    // touching the board minimizes the breeding sheet down to its primary button
    if (t.closest('.board') && !MB.breedMin) { const b = app.querySelector('.breed-bar'); if (b) { MB.breedMin = true; b.classList.add('min'); } }
  }, true);
  // any button tapped inside the drawer closes it after acting (inputs/selects keep it open)
  app.addEventListener('click', (e) => {
    const d = e.target.closest && e.target.closest('.mb-drawer');
    if (d && e.target.closest('button')) setTimeout(() => app.classList.remove('mb-menu-open'), 0);
  });
}

export function mbMenuButton(app, h) {
  return h('button', { className: 'mb-menu-btn', title: '메뉴 (되돌리기·저장·투항·설정)', 'aria-label': '메뉴', onClick: (e) => { e.stopPropagation(); app.classList.toggle('mb-menu-open'); } }, '☰');
}

// compact one-line status: 턴 1 · P1 · 육성 · 메모리 +3
export function mbSummary(h, { turn, player, phase, memory }) {
  const m = (memory > 0 ? '+' : '') + memory;
  return h('span', { className: 'mb-sum' }, [`턴 ${turn} · ${player} · ${phase} · 메모리 `, h('span', { className: 'mem-top' + (memory > 0 ? ' plus' : memory < 0 ? ' minus' : '') }, m)]);
}

export function mbCpuToggle(e) { // strip tap on the CPU bar (compact only)
  if (!MB.compact || (e.target.closest && e.target.closest('.cpu-pop'))) return;
  MB.cpuOpen = !MB.cpuOpen; e.currentTarget.classList.toggle('mb-open', MB.cpuOpen);
}

// breeding sheet: reset the minimized state for a new breeding phase; returns whether it starts minimized
export function mbBreedKey(key) { if (MB.breedKey !== key) { MB.breedKey = key; MB.breedMin = false; } return MB.breedMin; }
export function mbBreedExpand(e) { MB.breedMin = false; const b = e.currentTarget.closest('.breed-bar'); if (b) b.classList.remove('min'); }
