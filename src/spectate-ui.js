// "🍿 CPU끼리 구경하기" start-screen section (DOM glue for src/spectate.js).  main.js only calls spectateSection(api) inside renderSetup().
//   api = { resolveKey(key) -> deck object | null   (saved:/cpu: keys, same resolver as the normal start),
//           savedOptions() -> [{key,label}], PR (practice.js), CD (cpudeck.js), DB (deckbuilder.js), S (state.js), Cpu (cpu.js) }
import { runSpectateGame } from './spectate.js';

const LS = 'digimon_spectate_cfg_v1';
const CFG = { a: null, b: null, la: 'normal', lb: 'normal' };
try { Object.assign(CFG, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* ignore */ }
const save = () => { try { localStorage.setItem(LS, JSON.stringify(CFG)); } catch (e) { /* ignore */ } };
const RUN = { running: false, ctl: null, text: '', error: '' }; // one spectate simulation at a time (module level: survives renderSetup rebuilds)
let statusEl = null;

const h = (tag, attrs = {}, children = []) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'onClick') el.addEventListener('click', v); else if (k === 'className') el.className = v; else if (typeof v === 'boolean') el[k] = v; else el.setAttribute(k, v); }
  for (const c of [].concat(children)) { if (c == null || c === false) continue; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return el;
};
const paintStatus = () => { if (statusEl && statusEl.isConnected) { statusEl.textContent = RUN.error || RUN.text; statusEl.classList.toggle('su-spec-err', !!RUN.error); } };

function deckChoices(api) {
  const saved = api.savedOptions();
  const cpuDecks = (api.CD && api.CD.getLoadedDecks && api.CD.getLoadedDecks()) || [];
  const dot = (d) => (d.colors || []).map((c) => ({ red: '🔴', blue: '🔵', yellow: '🟡', green: '🟢', black: '⚫', purple: '🟣', white: '⚪' }[c] || '')).join('');
  const groups = [];
  groups.push(['🎲 무작위', [['rand:any', '🎲 무작위 (내 덱 + CPU 덱 중)']]]);
  if (saved.length) groups.push(['내 덱', saved.map((o) => [o.key, o.label])]);
  if (cpuDecks.length) groups.push(['CPU 추천/진화 덱', [['cpu:__random', '🎲 랜덤 CPU 덱'], ...cpuDecks.map((d) => ['cpu:' + d.name, dot(d) + ' ' + d.name + (d.winrate != null ? ' · ' + Math.round(d.winrate * 100) + '%' : '')])]]);
  return { groups, saved, cpuDecks };
}
function pickDeck(api, key, ch) {
  if (key === 'rand:any' || (key === 'cpu:__random' && !ch.cpuDecks.length)) {
    const all = [...ch.saved.map((o) => o.key), ...ch.cpuDecks.map((d) => 'cpu:' + d.name)];
    if (!all.length) return null; key = all[Math.floor(Math.random() * all.length)];
  } else if (key === 'cpu:__random') key = 'cpu:' + ch.cpuDecks[Math.floor(Math.random() * ch.cpuDecks.length)].name;
  return api.resolveKey(key);
}

async function startSpectate(api) {
  if (RUN.running) return;
  const ch = deckChoices(api);
  RUN.error = '';
  const A = pickDeck(api, CFG.a, ch), B = pickDeck(api, CFG.b, ch);
  for (const [nm, d] of [['P1', A], ['P2', B]]) {
    const v = d && typeof d === 'object' ? api.S.deckLegality(d) : { ok: false, errors: ['덱을 찾을 수 없음'] };
    if (!v.ok) { RUN.error = `${nm} 덱을 사용할 수 없습니다: ${v.errors.join(' / ')}`; paintStatus(); return; }
  }
  const sig = { aborted: false };
  RUN.running = true; RUN.ctl = sig; RUN.text = '시뮬레이션 준비 중…';
  api.rerender(); // shows the running state (cancel button)
  let opened = false, lastPaint = 0;
  const openViewer = (list, done, meta) => {
    if (opened) return; opened = true;
    api.PR.openReplayList(list, 'CPU 대전', { autoplay: true, standalone: true, live: !done, meta, onExit: () => { sig.aborted = true; RUN.running = false; RUN.text = ''; } });
  };
  const res = await runSpectateGame({
    deckA: A, deckB: B, levelA: CFG.la, levelB: CFG.lb, signal: sig,
    onProgress: (p) => {
      const txt = `시뮬레이션 중… ${p.turn}턴 · ${p.steps}스텝 · ${Math.round(p.ms / 1000)}초`;
      RUN.text = txt;
      if (opened) { api.PR.replayLiveUpdate({ text: `시뮬레이션 ${p.turn}턴 (${p.steps}스텝)` }); return; }
      const t = Date.now(); if (t - lastPaint > 150) { lastPaint = t; paintStatus(); }
      if (p.steps >= 8 && !p.done) openViewer(p.list, false, null); // "watch live": start playing while the game is still being simulated
    },
  });
  RUN.running = false;
  if (sig.aborted && !opened) { RUN.text = ''; RUN.error = '취소했습니다'; api.rerender(); return; }
  if (sig.aborted) return; // the viewer was closed -> already back on the start screen
  if (!res.list || res.list.length < 2) { RUN.error = '시뮬레이션에 실패했습니다' + (res.errors && res.errors[0] ? ': ' + res.errors[0] : ''); RUN.text = ''; api.rerender(); return; }
  if (!opened) openViewer(res.list, true, res.meta); else api.PR.replayLiveUpdate({ done: true, meta: res.meta });
  RUN.text = '';
}

export function spectateSection(api) {
  const ch = deckChoices(api);
  const valid = new Set(ch.groups.flatMap(([, items]) => items.map((i) => i[0])));
  if (!CFG.a || !valid.has(CFG.a)) CFG.a = 'rand:any';
  if (!CFG.b || !valid.has(CFG.b)) CFG.b = 'rand:any';
  const deckSel = (which) => {
    const sel = h('select', { className: 'su-select su-spec-deck', disabled: RUN.running }, ch.groups.map(([g, items]) => h('optgroup', { label: g }, items.map(([v, l]) => h('option', { value: v }, l)))));
    sel.value = CFG[which]; sel.addEventListener('change', () => { CFG[which] = sel.value; save(); });
    return sel;
  };
  const lvSel = (which) => {
    const sel = h('select', { className: 'su-select su-spec-lv', disabled: RUN.running, title: '쉬움·보통은 빠르게, 어려움·전문가는 수 읽기 때문에 시뮬레이션이 오래 걸립니다' }, Object.entries(api.Cpu.LEVEL_LABEL).map(([v, l]) => h('option', { value: v }, l + ((v === 'hard' || v === 'expert') ? ' (느림)' : ''))));
    sel.value = CFG[which]; sel.addEventListener('change', () => { CFG[which] = sel.value; save(); });
    return sel;
  };
  statusEl = h('div', { className: 'su-spec-status' + (RUN.error ? ' su-spec-err' : '') }, RUN.error || RUN.text);
  return h('div', { className: 'su-card su-spec' }, [
    h('div', { className: 'su-h' }, '🍿 CPU끼리 구경하기'),
    h('div', { className: 'su-spec-row' }, [h('span', { className: 'su-spec-tag su-spec-p1' }, 'P1'), deckSel('a'), lvSel('la')]),
    h('div', { className: 'su-spec-row' }, [h('span', { className: 'su-spec-tag su-spec-p2' }, 'P2'), deckSel('b'), lvSel('lb')]),
    h('div', { className: 'su-spec-row su-spec-act' }, [
      RUN.running
        ? h('button', { className: 'su-spec-cancel', onClick: () => { if (RUN.ctl) RUN.ctl.aborted = true; RUN.text = '취소하는 중…'; paintStatus(); } }, '✖ 취소')
        : h('button', { className: 'primary su-spec-go', onClick: () => startSpectate(api) }, '🍿 구경 시작'),
      statusEl,
    ]),
    h('div', { className: 'su-note' }, '두 CPU가 끝까지 대전하는 모습을 자동 재생으로 봅니다 (재생/속도/스텝 이동/저장 가능). 게임이 몇 스텝 쌓이면 바로 재생을 시작합니다.'),
  ]);
}
