import * as S from './state.js';
import { MB, mbInit, mbMenuButton, mbSummary, mbCpuToggle, mbBreedKey, mbBreedExpand } from './mobilebar.js'; // phone chrome: compact top bar + drawer, CPU strip, breeding sheet minimize
import * as PR from './practice.js'; // undo/redo, save/load, replay, cheat drawer (logic: snapshot.js / savegame.js / replay.js)
import * as E from './engine.js';
import * as Effects from './effects.js';
import * as DB from './deckbuilder.js';
import * as DBS from './dbsearch.js'; // deck-builder search/filter (pure)
import { createDeckAnalysis } from './decktools-ui.js'; // deck stats / checkup / sample hand / deck management (logic: decktools.js)
import * as DT from './decktools.js';
import * as CD from './cpudeck.js'; // CPU-evolved decks (data/cpu-decks.json, optional) + 'CPU가 덱 짜주기'
import { parseDeckText, deckToText } from './deckimport.js'; // 붙여넣기 덱 가져오기/내보내기
import { exportDeckRecipeDocx } from './deckrecipe.js'; // 덱 레시피(.docx) 내보내기 (대회 제출 서식)
import { fxFieldOn, fxFieldSetOn, fxFieldSync, fxFieldRender, FIELD_LABELS } from './fxfield.js'; // on-field effect annotations (presentation only)
import { peekWrap, peekNone, peekIdOf } from './peek.js'; // 👁 필드 보기: fold any prompt into a pill
import { renderSecurityZone } from './securityui.js'; // 시큐리티 존 (스택/TOP/체크 연출)
import { fxEmit, fxGetMode, fxSetMode, fxWhenIdle, fxBusyMs, fxUnbooked, FX_MODE_LABELS } from './fx.js'; // activation VFX overlay (presentation only)
import * as CpuSearch from './cpusearch.js'; // 어려움 lookahead (registers itself into Cpu.HOOKS.search)
import { spectateSection } from './spectate-ui.js'; // 🍿 CPU끼리 구경하기 (start screen)
import * as Cpu from './cpu.js'; // vs-CPU opponent (decisions + UI driver); the glue lives in the "vs CPU" section below
import * as Net from './netplay.js'; // 🌐 온라인 대전 (host-authoritative P2P over WebRTC via PeerJS) — design: docs/netplay-design.md

const PHASE_LABEL = { unsuspend: '액티브 페이즈', draw: '드로우 페이즈', breeding: '육성 페이즈', main: '메인 페이즈' };

const app = document.getElementById('app');
let state = null;
let sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1', declineAllRemaining: null }; // UI selection only. declineAllRemaining: 클릭 시점에 대기 중이던 효과 uid의 Set(단발성 — 그 묶음에만 적용, 이후 새로 발동 대기하는 효과는 다시 물어봄), 게임마다 초기화
let dragData = null; // { kind: 'hand', player, idx, cardId } | { kind: 'stack', player, uid, zone }
let panelsOpen = { actions: false, log: false, advancedTools: false }; // everything but the field starts collapsed

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'className') el.className = v;
    else if (typeof v === 'boolean') el[k] = v; // disabled/checked/etc — set as DOM property, not attribute
    else if (/^on[a-z]/.test(k) && typeof v === 'function') el[k] = v; // ondragover/ondrop/etc — assign as IDL property
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

async function init() {
  await S.loadData();
  try { await Cpu.loadParams(); } catch (e) { /* data/cpu-params.json is optional: the 전문가 level falls back to built-in params */ }
  try { await CD.loadCpuDecks('./data/cpu-decks.json'); } catch (e) { /* optional data file: no CPU decks offered */ }
  S.REPL.interactive = true; // optional survive/replacement effects ask the player (state.deleteStack → pendingReplacements)
  S.REPL.onPending = () => { if (state) render(); };
  PR.init({ getState: () => state, setState: (s2) => { state = s2; cpuSyncFromState(); }, render: () => render(), resetSel: () => { sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1', declineAllRemaining: null }; }, uiFlags: () => ({ pendingAttack: sel.pendingAttack, atkQueued: sel.atkQueued, cpuOn, cpuBusy: cpuOn && (cpuActing || cpuHumanLocked()), netLocked: !!Net.NET.role }), restartHand: () => restartHand() });
  mbInit(app, () => { if (state) render(); });
  renderSetup();
}

// ---------- vs CPU (P2 is played by src/cpu.js) ----------
// Decisions live in cpu.js; here is only the wiring: the settings (persisted), the lock that keeps the human's hands off P2's side,
// routing of ctx.choose() prompts by owner (uc.by), and the small `cpuApiObj` of real game actions the CPU driver performs
// (the very same functions the UI buttons / drag-drops call: doPlayFromHand, doEvolve, runJogress, attackFlow, pa* attack steps …).
const CPU_KEY = 'digimon_cpu_cfg_v1';
const CPU_CFG = { mode: '2p', level: 'normal', speed: 'normal', reveal: false, search: true, showLine: false, budget: 900 };
try { Object.assign(CPU_CFG, JSON.parse(localStorage.getItem(CPU_KEY) || '{}')); } catch (e) { /* ignore */ }
const saveCpuCfg = () => { try { localStorage.setItem(CPU_KEY, JSON.stringify(CPU_CFG)); } catch (e) { /* ignore */ } };
const CPU_P = 'p2';
let cpuOn = false;      // the running game is vs the CPU
let cpuActing = false;  // the CPU driver is inside one of its own actions (its prompts / attack calls are allowed)
let cpuDrv = null;
const isCpuSide = (p) => cpuOn && p === CPU_P;
// 🌐 온라인 대전: the HOST's own `state` is the real, unredacted authoritative object (only the copy sent to the
// GUEST over the wire is redacted — see netplay.buildSnapshot) — so without this, the host's own screen would
// still show the guest's real hand locally. Mirrors isCpuSide's hand-hiding for the seat that is NOT this
// client's own seat while hosting; a guest's `state` already arrives pre-redacted (opponent hand = null ids),
// so this is a no-op for the guest (its own `state.players[p].hand` already has the right values either way).
const netHideHand = (p) => Net.NET.role === 'host' && p !== Net.NET.mySeat;
// during the CPU's turn the human may not act (drag, pass, breeding…) — they still answer prompts / blocks that belong to them
const cpuHumanLocked = () => cpuOn && !cpuActing && !!state && !state.winner && state.activePlayer === CPU_P;
const cpuTurnView = () => cpuOn && !!state && !state.winner && state.activePlayer === CPU_P; // for rendering (disabled buttons): true for the whole CPU turn, even while the CPU is mid-action
const cpuPendingOwner = () => { const t = state && runningPendingUid ? state.pending.find(x => x.uid === runningPendingUid) : null; return t ? t.player : null; };
const uiChoiceByCpu = (uc) => cpuOn && !!uc && (uc.by ? uc.by === CPU_P : Cpu.deciderFor(state, uc.kind, uc.payload, { pendingOwner: cpuPendingOwner() }) === CPU_P);
// 🌐 온라인 대전: 이 선택이 "내 자리"의 결정이 아니라 상대(다른 컴퓨터의 사람) 몫이면 — 버튼을 그대로 보여주면 상대의 결정을
// 내 화면에서 대신 눌러버릴 수 있다 (예: 상대의 시큐리티 체크 순서 선택을 내가 가로채는 것과 같음). uiChoiceByCpu와 같은
// deciderFor 폴백을 그대로 재사용해, 이미 buildSnapshot()이 게스트에게 보낼 때 쓰는 것과 동일한 기준으로 판단한다.
const uiChoiceByOpponentOnline = (uc) => !!(Net.NET.role && uc && (uc.by || Cpu.deciderFor(state, uc.kind, uc.payload, { pendingOwner: cpuPendingOwner() })) !== Net.NET.mySeat);
const cpuApiObj = {
  getState: () => (cpuOn && !PR.isReplay() ? state : null), // (never play inside the replay viewer's scratch state)
  busy: () => busy(),
  pendingAttack: () => (attackActive() ? sel.pendingAttack : null), // (룰상 끝난 어택의 결과 패널은 CPU/구동기에 보이지 않는다)
  pendingOwner: cpuPendingOwner,
  hasScript: (t) => !t.manualOnly && scriptFor(t).length > 0,
  closePending: (uid) => { S.resolvePending(state, uid); render(); },
  answer: (uc, val) => { state._multiPick = []; state._orderPick = []; uc.resolve(val); },
  fxBusyMs: () => fxBusyMs(),
  setActing: (b) => { cpuActing = !!b; },
  dbgPending: () => JSON.stringify({ runner: !!pendingRunner, run: runningPendingUid, att: [...autoRunAttempted], sameState: attemptedFor === state }), // (opt-in diagnostics: window.__cpuDebug = true)
  retryPending: () => { syncAttempted(); for (const t of state.pending) if (!t.resolved) autoRunAttempted.delete(t.uid); pendingRunner = null; runnerTok = null; runningPendingUid = null; healLeakedFxState(); render(); }, // watchdog: re-arm a parked effect runner (the abandoned run may still hold _rcDepth/_fxSrc: without healing, 17-1-3 rule checks would be deferred forever)
  thinkUpdate: () => { try { const bar = document.querySelector('.cpu-bar'); if (!bar || !cpuDrv) return; const b = bar.querySelector('b'); if (b) b.textContent = `${cpuBarLabel()} · ${Cpu.LEVEL_LABEL[CPU_CFG.level]}`; bar.classList.toggle('thinking', cpuDrv.isThinking()); } catch (e) { /* ignore */ } },
  skipBreeding: () => { E.nextPhase(state); render(); },
  hatch: (p) => { S.hatchDigitama(state, p); render(); },
  move: (p) => { S.moveRaisingToBattle(state, p); render(); },
  pass: () => { E.declarePass(state); render(); },
  play: (p, idx) => doPlayFromHand(p, idx),
  evolve: (p, uid, idx) => doEvolve(p, uid, idx),
  jogress: async (p, a, b, cardId) => { await runJogress(p, a, b, cardId); jgCache.clear(); render(); },
  attack: (p, uid, target) => attackFlow(p, uid, target),
  train: (p, uid) => { S.useTraining(state, p, uid); render(); },
  useDelay: (p, uid) => { // 16-17 ≪딜레이≫ (CPU): same as the 🗑딜레이 button in stackActionList
    const st = findStack({ player: p, uid });
    const body = st ? S.parseDelayEffect(S.card(st.cardId).effectKo) : null;
    if (!st || !body || state.turnNumber <= st.placedTurn) return;
    const cardId = S.discardForDelay(state, p, uid);
    if (cardId) state.pending.push({ uid: 'delay' + Math.random().toString(36).slice(2), player: p, cardId, stackUid: null, tags: ['메인'], text: body, resolved: false });
    render();
  },
  useMain: (p, uid, idx) => {
    const st = findStack({ player: p, uid });
    if (!st) return;
    const ab = S.activatableMainAbilities(state, p, st, state.players[p].raising?.uid === uid ? 'raising' : 'battle')[idx];
    if (!ab || !Effects.mainAbilityPayable(state, S, p, uid, ab.cardId, ab.tags, ab.text)) return;
    state.pending.push({ uid: 'main' + Math.random().toString(36).slice(2), player: p, cardId: ab.cardId, stackUid: uid, tags: ab.tags, text: ab.text, resolved: false });
    render();
  },
  pa: {
    chooseTarget: (pa, tgt) => paChooseTarget(pa, tgt),
    passRedirect: (pa) => { enterCounterTiming(pa); render(); },
    passCounter: (pa) => { enterBlockCheck(pa); render(); },
    useCounter: (pa, opt) => paUseCounter(pa, opt),
    block: (pa, uid) => paBlock(pa, uid),
    passBlock: (pa) => { resolveFinalTarget(pa); render(); },
    pierce: (pa) => { pa.targetKind = 'player'; runSecurityCheck(pa); render(); },
    close: (pa) => { endAttack(); render(); },
  },
};

// ---------- 🌐 온라인 대전 (host-authoritative P2P over WebRTC; design: docs/netplay-design.md) ----------
// The host runs the exact same engine/state as solo play and additionally broadcasts a redacted snapshot after
// every render(); intents from the guest are applied through `cpuApiObj` above (zero duplicated game logic —
// it's the same table the CPU driver already calls into). The guest's `state`/`sel.pendingAttack` are pure
// mirrors, assigned wholesale from whatever the host last sent; see netIntercept() for how a guest's own clicks
// become intents instead of local mutations.
let netStatus = '';
Net.NET.onStatus = (t) => { netStatus = t; render(); };
function netApplyIntent(action, args) {
  if (!state) return;
  // 호스트는 항상 'p1', 접속한 게스트는 항상 그 반대 자리 — 게스트가 보낸 의도(intent)의 "누구 몫인지"는 게스트 쪽 화면 버그나
  // 조작으로 바뀔 수 있으니, args가 주장하는 자리를 그대로 믿지 않고 실제 접속 자리로 강제한다 (호스트 자신의 결정을 게스트가
  // 원격으로 가로채 대신 눌러버리는 것을 막는다 — renderMulliganStage/renderModal의 화면단 가림과 짝을 이루는 서버측 검증).
  const guestSeat = S.opponentOf(Net.NET.mySeat);
  // 게스트가 보낸 의도 중 "어느 자리가 하는 행동인지"를 명시한 인자(첫 번째 또는 playFreshFromDrag의 두 번째)는 반드시 게스트 자리여야 한다
  // ('answer'의 값이나 'closePending'의 대기 효과 id는 'p1'/'p2' 문자열일 수 있어 자리 인자가 아니다 — 자리 인자를 갖는 행동만 검사)
  const seatArg = action === 'playFreshFromDrag' ? args[1] : args[0];
  const noSeat = action === 'answer' || action === 'closePending' || action.startsWith('pa.');
  if (!noSeat && typeof seatArg === 'string' && /^p[12]$/.test(seatArg) && seatArg !== guestSeat) { console.warn('netplay: rejected intent for the wrong seat', action, seatArg); return; }
  try {
    if (action === 'mulligan') { const p = guestSeat; E.mulligan(state, p); mulliganDealFlash[p] = true; mulliganDecided[p] = true; afterMulliganCheck(); return; }
    if (action === 'linkDrop') {
      const [lp, stackUid, drag] = args;
      const st = findStack({ player: lp, uid: stackUid });
      const okDrag = drag && ((drag.kind === 'hand' && state.players[lp].hand[drag.idx] === drag.cardId) || (drag.kind === 'stack' && drag.zone === 'battle'));
      if (st && okDrag) handleLinkDrop(lp, st, drag);
      return;
    }
    if (action === 'zoneMain') {
      const [zp, zone, zidx] = args;
      const abs = [...S.zoneMainAbilities(state, zp, 'hand').map(x => ({ ...x, zone: 'hand' })), ...S.zoneMainAbilities(state, zp, 'trash').map(x => ({ ...x, zone: 'trash' }))];
      const a = abs.find(x => x.zone === zone && x.idx === zidx);
      if (a && !blockIfBusy()) state.pending.push({ uid: 'zmain' + Math.random().toString(36).slice(2), player: zp, cardId: a.cardId, stackUid: null, tags: a.tags, text: a.text, resolved: false, zoneMain: a.zone, zoneIdx: a.idx });
      render(); return;
    }
    if (action === 'jogressCancel') { jogressModal = null; render(); return; }
    if (action === 'jogress') { jogressModal = null; }
    if (action === 'surrender') { E.surrender(state, guestSeat); render(); return; }
    if (action === 'keepHand') { const p = guestSeat; mulliganDecided[p] = true; afterMulliganCheck(); return; }
    if (action === 'answer') {
      const uc = state.uiChoice;
      const owner = uc && (uc.by || Cpu.deciderFor(state, uc.kind, uc.payload, { pendingOwner: cpuPendingOwner() }));
      if (uc && owner === guestSeat) cpuApiObj.answer(uc, args[0]);
      return;
    }
    if (action === 'stackDrop') { const [p, stackUid, zoneKind, drag] = args; const st = findStack({ player: p, uid: stackUid }); if (st) handleStackDrop(p, st, zoneKind, drag); return; }
    if (action === 'playFreshFromDrag') { const [drag, p] = args; playFreshFromDrag(drag, p); return; }
    // redirect options carry a closure (`opt.pay`) that can't cross the wire — sent by index into the HOST's own
    // (never-serialized) `pa.redirectOptions` instead of the option object itself (see the '변경' onClick above).
    if (action === 'pa.useRedirect') {
      const pa = sel.pendingAttack; const opt = pa && pa.redirectOptions && pa.redirectOptions[args[0]];
      if (!pa || !opt) return;
      (async () => {
        if (opt.pay) { const paid = await opt.pay(ctxChoose); if (!paid) { render(); return; } }
        if (opt.endsAttack) { endAttack(); render(); return; }
        const tUid = opt.targetUid || opt.stackUid;
        if (opt.toPlayer) { pa.targetKind = 'player'; pa.targetUid = null; } else { pa.targetKind = 'digimon'; pa.targetUid = tUid; }
        if (opt.limit != null) S.markRedirectUsed(state, pa.opp, opt.stackUid, opt.cardId);
        noteRedirect(pa);
        enterCounterTiming(pa); render();
      })();
      return;
    }
    if (action === 'pa.unsuspendAfterBattle') { const pa = sel.pendingAttack; if (pa) S.unsuspendStack(state, pa.attacker, args[0]); render(); return; }
    if (action.startsWith('pa.')) { const sub = action.slice(3); const pa = sel.pendingAttack; if (pa && typeof cpuApiObj.pa[sub] === 'function') cpuApiObj.pa[sub](pa, ...args); return; }
    if (typeof cpuApiObj[action] === 'function') { cpuApiObj[action](...args); return; }
    console.warn('netplay: unknown intent', action);
  } catch (e) { console.warn('netplay: intent failed', action, args, e); }
}
Net.NET.onIntent = netApplyIntent;
// 게스트는 상태가 올 때마다 새 객체를 받는다 — 효과 연출(fx.js)은 rec/로그 "객체 동일성"으로 진행 여부를 기억하므로,
// 같은 id(rec)·같은 줄(로그)은 이전 객체를 재사용해서 매 수신마다 연출이 처음부터 다시 재생되지 않게 한다.
const netRecCache = new Map();
function netCanonicalize(st, prev) {
  const canon = (r) => { if (!r) return r; const c = netRecCache.get(r.id); if (c && c.t === r.t) { Object.assign(c, r); return c; } netRecCache.set(r.id, r); return r; };
  st.fxHistory = (st.fxHistory || []).map(canon);
  st._fxRec = canon(st._fxRec);
  const live = new Set((st.fxHistory || []).map(r => r.id)); if (st._fxRec) live.add(st._fxRec.id);
  for (const id of [...netRecCache.keys()]) if (!live.has(id)) netRecCache.delete(id);
  const old = new Map(); for (const e of (prev && prev.log) || []) old.set(e.t + '|' + e.msg, e);
  st.log = (st.log || []).map(e => old.get(e.t + '|' + e.msg) || e);
}
function netOnState(msg) {
  const rev = Net.reviveIncoming(msg);
  netCanonicalize(rev.state, state);
  state = rev.state;
  if (rev.mulliganDecided) mulliganDecided = rev.mulliganDecided;
  jogressModal = rev.jogressModal; // 조그레스 재료 선택창은 호스트 로컬 UI 상태라, 게스트 몫이면 호스트가 실어 보낸다
  sel.pendingAttack = rev.pa;
  cpuOn = false; // an online match is never also a CPU match
  if (state.phase === 'setup') renderMulliganStage(); else render();
}
Net.NET.onState = netOnState;
// Host: broadcast after anything that changes what the guest should see. Safe/cheap to call when not hosting
// (no-op — see netplay.broadcastState) or when `sel.pendingAttack` doesn't exist yet (null is a valid "no
// attack in progress" value on the wire too).
function netBroadcast() {
  if (Net.NET.role !== 'host' || !state) return;
  Net.broadcastState(state, sel.pendingAttack, { mulliganDecided: { ...mulliganDecided }, jogressModal: jogressModal && jogressModal.player === S.opponentOf(Net.NET.mySeat) ? jogressModal : null });
  // 패 추가/소멸 표시는 "한 번 보이고 지워지는" 플래그라 호스트 렌더가 이미 지웠다 — 그 값을 netXxx에 모아 두었다가 한 번 보낸 뒤 비운다
  for (const q of ['p1', 'p2']) if (state.players[q]) state.players[q].netDrawFlash = 0;
  state.netVanish = null;
}
// A network GUEST's own click that would otherwise mutate shared engine state: send it to the host instead and
// bail out of the local handler. Host / CPU / local-2p: always false (Net.NET.role is null there), so this is
// fully inert outside online play — those modes' behavior is unchanged byte-for-byte.
function netIntercept(action, args) { if (Net.NET.role !== 'guest') return false; Net.sendIntent(action, args); return true; }

// coming back to a hidden tab: the CPU carries on immediately (its heartbeat timer was throttled) and the view is refreshed
try { document.addEventListener('visibilitychange', () => { if (!document.hidden && cpuOn && cpuDrv && state && !state.winner) { cpuDrv.beat().catch(() => {}); render(); } }); } catch (e) { /* ignore */ }
function cpuApplySearchCfg() { if (cpuDrv) cpuDrv.setSearch({ enabled: CPU_CFG.search !== false, budgetMs: Math.max(200, Math.min(2500, Number(CPU_CFG.budget) || 900)), hardCapMs: 2500, showLine: !!CPU_CFG.showLine }); }
function cpuBarLabel() {
  const thinking = cpuDrv.isThinking();
  if (cpuDrv.paused) return '⏸ CPU 일시정지';
  if (thinking && cpuDrv.searching) { const i = cpuDrv.thinkInfo || {}; return `🤖 CPU 4수 앞을 읽는 중… (깊이 ${i.depth || 0}/4 · ${i.nodes || 0}노드)`; }
  return thinking ? '🤖 CPU 생각 중…' : (state.activePlayer === CPU_P ? '🤖 CPU 진행 중…' : '🤖 CPU 대기 (당신의 차례)');
}
function cpuStart() { // called when a new game begins
  cpuScrollTurn = -1;
  cpuOn = CPU_CFG.mode === 'cpu';
  if (state) state.vsCpu = cpuOn ? { level: CPU_CFG.level } : null; // travels with saves / undo snapshots (see cpuSyncFromState)
  if (cpuOn) { cpuDrv = cpuDrv || Cpu.createUiDriver(cpuApiObj); cpuDrv.start(CPU_CFG.level); cpuDrv.setSpeed(CPU_CFG.speed); cpuApplySearchCfg(); }
  else if (cpuDrv) cpuDrv.stop();
}
// after undo / load / resume replaced the game state: CPU mode follows the state's own flag
function cpuSyncFromState() {
  const v = state && state.vsCpu;
  if (v) { cpuOn = true; if (v.level && Cpu.LEVEL_LABEL[v.level]) CPU_CFG.level = v.level; cpuDrv = cpuDrv || Cpu.createUiDriver(cpuApiObj); cpuDrv.start(CPU_CFG.level); cpuDrv.setSpeed(CPU_CFG.speed); cpuApplySearchCfg(); }
  else { cpuOn = false; if (cpuDrv) cpuDrv.stop(); }
}
let cpuMullTimer = null;
let cpuScrollTurn = -1;
function cpuMulliganMaybe() { // the CPU decides its opening hand (룰 5-2-1-4: after the first player) with a short pause
  if (!cpuOn || mulliganDecided[CPU_P]) return;
  if (CPU_P !== state.firstPlayer && !mulliganDecided[state.firstPlayer]) return;
  const st = state;
  clearTimeout(cpuMullTimer);
  cpuMullTimer = setTimeout(() => {
    if (state !== st || mulliganDecided[CPU_P]) return;
    if (Cpu.shouldMulligan(state, CPU_P, CPU_CFG.level)) { E.mulligan(state, CPU_P); mulliganDealFlash[CPU_P] = true; state.cpuMulled = true; }
    mulliganDecided[CPU_P] = true;
    afterMulliganCheck();
  }, 900);
}
function renderCpuBar() {
  if (!cpuOn || !state || state.winner || !cpuDrv) return null;
  const thinking = cpuDrv.isThinking();
  const label = cpuBarLabel();
  let fold = false; try { fold = localStorage.getItem('digimon_cpu_fold') === '1'; } catch (e) { /* ignore */ }
  const lastNote = state.log.find(e => typeof e.msg === 'string' && e.msg.startsWith('🤖 CPU: '));
  return h('div', { className: 'cpu-bar' + (thinking ? ' thinking' : '') + (cpuDrv.paused ? ' paused' : '') + (fold ? ' cpu-min' : '') + (MB.compact && MB.cpuOpen ? ' mb-open' : ''), onClick: mbCpuToggle }, [
    h('b', {}, `${label} · ${Cpu.LEVEL_LABEL[CPU_CFG.level]}`),
    h('button', { className: 'cpu-fold', title: 'CPU 패널 접기/펼치기', onClick: (e) => { e.stopPropagation(); try { localStorage.setItem('digimon_cpu_fold', fold ? '0' : '1'); } catch (err) { /* ignore */ } render(); } }, fold ? '▸' : '▾'),
    h('span', { className: 'cpu-strip-last' }, lastNote ? '· ' + lastNote.msg.slice(8) : '· 최근 행동 없음'),
    h('div', { className: 'cpu-pop' }, [
    h('button', { onClick: () => { cpuDrv.setPaused(!cpuDrv.paused); render(); } }, cpuDrv.paused ? '▶ 재개' : '⏸ 일시정지'),
    h('label', { className: 'meta' }, ['속도 ', h('select', { onchange: (e) => { CPU_CFG.speed = e.target.value; saveCpuCfg(); cpuDrv.setSpeed(CPU_CFG.speed); } },
      Object.entries(Cpu.SPEED_LABEL).map(([v, l]) => { const o = h('option', { value: v }, l); if (v === CPU_CFG.speed) o.selected = true; return o; }))]),
    Cpu.isHardLike(CPU_CFG.level) ? h('label', { className: 'meta', title: '어려움/전문가: 4수(내 행동·상대 턴 포함) 앞을 탐색해 행동을 고릅니다' }, [h('input', { type: 'checkbox', checked: CPU_CFG.search !== false, onchange: (e) => { CPU_CFG.search = !!e.target.checked; saveCpuCfg(); cpuApplySearchCfg(); } }), ' 4수 읽기']) : null,
    Cpu.isHardLike(CPU_CFG.level) && CPU_CFG.search !== false ? h('label', { className: 'meta', title: '읽은 수순을 효과 로그에 남깁니다' }, [h('input', { type: 'checkbox', checked: !!CPU_CFG.showLine, onchange: (e) => { CPU_CFG.showLine = !!e.target.checked; saveCpuCfg(); cpuApplySearchCfg(); } }), ' 수순 로그']) : null,
    h('label', { className: 'meta' }, [h('input', { type: 'checkbox', checked: !!CPU_CFG.reveal, onchange: (e) => { CPU_CFG.reveal = !!e.target.checked; saveCpuCfg(); render(); } }), ' CPU 패 보기']),
    cpuLastActionLine(),
    cpuHintLine(),
    ]),
  ]);
}
// what the human is expected to do right now (one line, only during their own turn)
function cpuHintLine() {
  if (state.activePlayer === CPU_P || !state.phase) return null;
  const mem = state.memory;
  let t = null;
  if (state.phase === 'breeding') t = '육성 페이즈 — 디지타마 부화 / 육성 카드 이동 (선택). 아무것도 안 하려면 아래 버튼 또는 Space.';
  else if (state.phase === 'main') t = `내 메인 페이즈 — 남은 메모리 ${mem}. 카드를 눌러 선택 후 ▶등장/진화, 어택은 내 디지몬 → 상대. 메모리가 0 아래로 내려가면 상대 턴(패스하면 상대 3으로 시작). 초록 테두리 = 지금 낼 수 있는 카드.`;
  return t ? h('div', { className: 'cpu-hint meta' }, '👉 ' + t) : null;
}
// persistent "what did the CPU just do" line: newest CPU note + a chronological digest of that CPU turn + the newest log line
function cpuLastActionLine() {
  const isNote = (e) => typeof e.msg === 'string' && e.msg.startsWith('🤖 CPU: ');
  const last = state.log.find(isNote);
  if (!last) return h('div', { className: 'cpu-last meta' }, '🤖 CPU 최근 행동: 아직 없음');
  const mine = state.log.filter(e => isNote(e) && e.turn === last.turn).slice(0, 8).reverse().map(e => e.msg.slice(8));
  const now = state.activePlayer === CPU_P;
  const newest = state.log[0];
  const extra = now && newest && newest !== last && !isNote(newest) ? String(newest.msg).slice(0, 90) : '';
  return h('div', { className: 'cpu-last', title: 'CPU가 이번(또는 직전) 턴에 한 행동 요약 — 전체 기록은 오른쪽 로그' }, [
    h('b', {}, now ? '방금 CPU: ' : '직전 CPU 턴(' + last.turn + '): '), h('span', { className: 'cpu-last-now' }, last.msg.slice(8)),
    mine.length > 1 ? h('span', { className: 'meta' }, ' · 이 턴: ' + mine.join(' → ')) : null,
    extra ? h('span', { className: 'meta cpu-last-res' }, ' · ' + extra) : null,
  ]);
}
// grey out the buttons/chips of an attack panel step that the CPU decides (the human must not click for it)
function cpuLockPanel(panel) {
  panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
  panel.querySelectorAll('.card-chip').forEach(c => { c.style.pointerEvents = 'none'; });
  panel.insertBefore(h('div', { className: 'cpu-think-row' }, '🤖 CPU가 결정 중…'), panel.firstChild);
}

let setupPick = { p1: null, p2: null };
let setupError = '';

function deckOptionsList() {
  const saved = DB.loadSavedDecks();
  return Object.keys(saved).map(name => ({ key: 'saved:' + name, label: name }));
}

let cpuRandomDeck = null; // the '🎲 랜덤 CPU 덱' pick, rolled once per game start
function cpuDeckByKey(key) {
  if (key === 'cpu:__random') return cpuRandomDeck;
  const nm = key.slice(4);
  const d = (CD.getLoadedDecks() || []).find(x => x.name === nm);
  return d ? { name: d.name, main: { ...d.main }, digitama: { ...d.digitama } } : null;
}
function resolveDeckPick(key) {
  if (key.startsWith('cpu:')) return cpuDeckByKey(key);
  if (key === 'net:guest') return Net.NET.guestDeck || null; // 온라인: 게스트가 고른 덱 (호스트 화면에서만 의미 있음)
  if (key.startsWith('saved:')) {
    const saved = DB.loadSavedDecks();
    const d = saved[key.slice(6)];
    return d && !d.name ? { ...d, name: key.slice(6) } : d;
  }
  return key; // built-in key string, looked up inside state.newGame
}

const SETUP_COLORS = { red: ['#e0524a', '레드'], blue: ['#3f8fe0', '블루'], yellow: ['#e8c53a', '옐로'], green: ['#4cb26a', '그린'], black: ['#6b6f78', '블랙'], purple: ['#9a63d6', '퍼플'], white: ['#e8e8e6', '화이트'] };
function setupDeckInfo(key) {
  try {
    const d = resolveDeckPick(key);
    if (!d || typeof d !== 'object') return { main: 0, egg: 0, colors: [] };
    const cnt = (o) => Object.values(o || {}).reduce((a, n) => a + n, 0);
    const cols = new Set();
    for (const id of [...Object.keys(d.main || {}), ...Object.keys(d.digitama || {})]) for (const c of (S.card(id).colors || [])) cols.add(c);
    return { main: cnt(d.main), egg: cnt(d.digitama), colors: [...cols] };
  } catch (e) { return { main: 0, egg: 0, colors: [] }; }
}

// 🌐 온라인 대전: local-only UI state for the room-code input box (not persisted, not part of `state`/`sel`).
let netJoinCode = '';
// ---- 게스트가 자기 브라우저에 저장된 덱을 골라 호스트에 보낸다 (호스트는 P2 덱으로 사용) ----
let netMyDeckKey = ''; // guest: 'saved:<name>' of the deck I picked
let netDeckAck = null; // guest: host's verdict on the deck I sent ({ok, errors, name})
let netDeckErr = ''; // host: why the guest's last deck was rejected
function netCleanDeck(d) { // 호스트: 네트워크로 받은 덱은 믿지 않고 카드 번호/장수를 걸러낸다
  if (!d || typeof d !== 'object') return null;
  const clean = (mp) => {
    const o = {};
    for (const [k, v] of Object.entries(mp && typeof mp === 'object' ? mp : {})) {
      let ok = false; try { const c = S.card(k); ok = !!(c && c.nameKo); } catch (e) { ok = false; }
      const n = Math.floor(Number(v));
      if (ok && n >= 1 && n <= 50) o[k] = n;
    }
    return o;
  };
  return { name: String(d.name || '게스트 덱').slice(0, 40), main: clean(d.main), digitama: clean(d.digitama) };
}
function netSendMyDeck() {
  if (Net.NET.role !== 'guest') return;
  const d = netMyDeckKey ? resolveDeckPick(netMyDeckKey) : null;
  netDeckAck = null;
  Net.sendDeck(d && typeof d === 'object' ? { name: d.name || netMyDeckKey.slice(6), main: d.main, digitama: d.digitama } : null);
}
Net.NET.onDeck = (deck) => { // host
  if (Net.NET.role !== 'host') return;
  const d = netCleanDeck(deck);
  if (!d) { Net.NET.guestDeck = null; Net.sendDeckAck({ ok: false, errors: [], name: '' }); if (!state) render(); return; }
  const v = S.deckLegality(d);
  if (v.ok) { Net.NET.guestDeck = d; netDeckErr = ''; } else { Net.NET.guestDeck = null; netDeckErr = v.errors.join(' / '); }
  Net.sendDeckAck({ ok: v.ok, errors: v.ok ? [] : v.errors, name: d.name });
  if (!state) render();
};
Net.NET.onDeckAck = (ack) => { netDeckAck = ack; if (!state) render(); }; // guest
Net.NET.onOpen = () => { netSendMyDeck(); };
function netRoomCard() {
  const role = Net.NET.role;
  const rows = [h('div', { className: 'su-h' }, '🌐 온라인 대전 (베타)')];
  if (!role) {
    rows.push(h('div', { className: 'su-note' }, '호스트가 방을 만들고 코드를 게스트에게 알려주면, 게스트가 그 코드로 참가합니다. 서버 없이 P2P(WebRTC)로 직접 연결됩니다 — 계정이 필요하지 않습니다.'));
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { className: 'primary', onClick: () => { netStatus = '방 만드는 중…'; render(); Net.hostRoom().then(() => render()).catch((e) => { netStatus = '방 생성 실패: ' + (e && e.message || e); render(); }); } }, '🚪 방 만들기 (호스트)'),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('input', { type: 'text', id: 'netJoinCodeInput', placeholder: '방 코드 입력 (예: AB12CD)', value: netJoinCode, style: 'text-transform:uppercase;width:12em', oninput: (e) => { netJoinCode = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') document.getElementById('netJoinBtn').click(); } }),
      h('button', { id: 'netJoinBtn', onClick: () => {
        const code = (document.getElementById('netJoinCodeInput').value || netJoinCode || '').trim();
        if (!code) return;
        netJoinCode = code; netStatus = '연결 중…'; render();
        Net.joinRoom(code).then(() => render()).catch((e) => { netStatus = '참가 실패: ' + (e && e.message || e); render(); });
      } }, '🔗 참가하기 (게스트)'),
    ]));
  } else if (role === 'host') {
    rows.push(h('div', { className: 'su-note' }, [
      h('b', {}, '방 코드: '), h('span', { style: 'font-size:1.3em;letter-spacing:.15em;font-weight:bold' }, Net.NET.roomCode),
      h('button', { style: 'margin-left:8px', onClick: () => { try { navigator.clipboard.writeText(Net.NET.roomCode); } catch (e) { /* ignore */ } } }, '📋 복사'),
    ]));
    rows.push(h('div', { className: 'su-note' }, Net.NET.connected ? '✅ 게스트와 연결됨 — 아래에서 양쪽 덱을 고르고 시작하세요 (P2 = 게스트).' : '⏳ ' + (netStatus || '게스트의 접속을 기다리는 중…')));
  } else if (role === 'guest') {
    rows.push(h('div', { className: 'su-note' }, Net.NET.connected ? '✅ 호스트와 연결됨 — 호스트가 게임을 시작하면 자동으로 화면이 전환됩니다.' : '⏳ ' + (netStatus || '연결 중…')));
  }
  if (role) rows.push(h('div', { className: 'actions-row' }, [h('button', { onClick: () => { Net.reset(); netStatus = ''; renderSetup(); } }, '✖ 연결 끊기')]));
  return h('div', { className: 'su-card' }, rows);
}
// Guest, before the host has started a game: nothing to pick (host owns both deck choices — see docs/netplay-design.md)
// — just the connection card, no deck grid / start button (which wouldn't do anything on a guest anyway).
function guestDeckCardForHost() {
  const g = Net.NET.guestDeck;
  const i = g ? setupDeckInfo('net:guest') : null;
  return h('div', { className: 'su-card su-p2' }, [
    h('div', { className: 'su-h' }, 'P2 덱 (게스트) — 게스트가 고름'),
    g ? h('div', { className: 'su-note' }, `✅ 「${g.name}」 — 메인 ${i.main}장 · 디지타마 ${i.egg}장`) : h('div', { className: 'su-note' }, netDeckErr ? `⚠ 게스트의 덱을 사용할 수 없습니다: ${netDeckErr}` : '⏳ 게스트가 덱을 고르는 중…'),
  ]);
}
function renderNetGuestWaiting() {
  app.innerHTML = '';
  const hero = h('div', { className: 'su-hero' }, [
    h('div', { className: 'su-logo' }, '⟁'),
    h('div', {}, [h('div', { className: 'su-title' }, '디지몬 카드게임'), h('div', { className: 'su-sub' }, '시뮬레이터 · 🌐 온라인 대전 (게스트)')]),
  ]);
  // 내 덱 고르기: 이 브라우저에 저장된 덱 중에서 — 고르는 즉시 호스트에 보내고, 호스트가 규칙 검사 결과를 돌려준다
  const options = deckOptionsList();
  const hadKey = netMyDeckKey;
  if (!options.some(o => o.key === netMyDeckKey)) netMyDeckKey = options[0] ? options[0].key : '';
  if (netMyDeckKey !== hadKey && Net.NET.connected) setTimeout(netSendMyDeck, 0);
  const sel = h('select', { className: 'su-select' }, options.map(o => h('option', { value: o.key }, o.label)));
  sel.value = netMyDeckKey;
  const info = h('div', { className: 'su-deckinfo' });
  const paint = () => {
    const i = setupDeckInfo(netMyDeckKey);
    info.replaceChildren(h('span', {}, `메인 ${i.main}장 · 디지타마 ${i.egg}장`), h('span', { className: 'su-dots' }, i.colors.map(c => h('i', { className: 'su-dot', title: (SETUP_COLORS[c] || [])[1] || c, style: `background:${(SETUP_COLORS[c] || ['#888'])[0]}` }))));
  };
  sel.addEventListener('change', (e) => { netMyDeckKey = e.target.value; paint(); netSendMyDeck(); renderNetGuestWaiting(); });
  paint();
  const status = !options.length ? '저장된 덱이 없습니다 — 아래 덱 빌더에서 먼저 덱을 만들어 저장하세요.'
    : !Net.NET.connected ? '호스트와 연결되면 자동으로 보냅니다.'
    : netDeckAck == null ? '⏳ 호스트에 보내는 중…'
    : netDeckAck.ok ? `✅ 「${netDeckAck.name}」 덱이 확인되었습니다 — 호스트가 시작하기를 기다립니다.`
    : `⚠ 이 덱은 사용할 수 없습니다: ${(netDeckAck.errors || []).join(' / ') || '덱을 고르세요'}`;
  const deckCardG = h('div', { className: 'su-card su-p2' }, [
    h('div', { className: 'su-h' }, '🃏 내 덱 (P2 · 게스트)'),
    options.length ? sel : null, options.length ? info : null,
    h('div', { className: 'su-note' }, status),
    h('div', { className: 'actions-row' }, [h('button', { onClick: () => { openDeckBuilder(); } }, '🛠 덱 빌더')]),
  ].filter(Boolean));
  app.appendChild(h('div', { className: 'su-wrap' }, [hero, netRoomCard(), deckCardG]));
}

function renderSetup() {
  if (CPU_CFG.mode === 'net' && Net.NET.role === 'guest') return renderNetGuestWaiting();
  app.innerHTML = '';
  const options = deckOptionsList();
  if (!setupPick.p1 && options[0]) setupPick.p1 = options[0].key;
  if (!setupPick.p2 && options[1]) setupPick.p2 = options[1].key;
  if (!setupPick.p2 && options[0]) setupPick.p2 = options[0].key;

  const hero = h('div', { className: 'su-hero' }, [
    h('div', { className: 'su-logo' }, '⟁'),
    h('div', {}, [h('div', { className: 'su-title' }, '디지몬 카드게임'), h('div', { className: 'su-sub' }, '시뮬레이터 · 룰 엔진 + CPU 대전')]),
  ]);

  if (!options.length) {
    app.appendChild(h('div', { className: 'su-wrap' }, [hero, h('div', { className: 'su-card' }, [
      h('div', { className: 'su-h' }, '저장된 덱이 없습니다'),
      h('div', { className: 'su-note' }, '덱 빌더에서 먼저 덱을 만들어 주세요.'),
      h('button', { className: 'primary su-start', onClick: openDeckBuilder }, '🛠 덱 빌더 열기'),
    ]), h('div', { className: 'su-more' }, [
      h('button', { title: '플레이 중 발견한 버그나 이상한 동작을 신고해주세요', onClick: () => window.open('https://forms.gle/uLfLuPv9bnvkxauZ6', '_blank', 'noopener') }, '🐛 버그 리포트'),
    ])]));
    return;
  }

  // deck picker card (P1 / P2): a big select + summary (card counts, colour dots)
  const deckCard = (p, title) => {
    const cpuDecks = (p === 'p2' && CPU_CFG.mode === 'cpu') ? (CD.getLoadedDecks() || []) : [];
    const savedOpts = options.map(o => h('option', { value: o.key }, o.label));
    let selKids = savedOpts;
    if (cpuDecks.length) {
      const wr = (d) => d.winrate != null ? ' · ' + Math.round(d.winrate * 100) + '%' : '';
      const dot = (d) => (d.colors || []).map(c => ({ red: '🔴', blue: '🔵', yellow: '🟡', green: '🟢', black: '⚫', purple: '🟣', white: '⚪' }[c] || '')).join('');
      selKids = [h('optgroup', { label: '내 덱' }, savedOpts), h('optgroup', { label: 'CPU 추천/진화 덱' }, [h('option', { value: 'cpu:__random' }, '🎲 랜덤 CPU 덱'), ...cpuDecks.map(d => h('option', { value: 'cpu:' + d.name }, dot(d) + ' ' + d.name + wr(d)))])];
    } else if (p === 'p2' && setupPick.p2 && setupPick.p2.startsWith('cpu:')) setupPick.p2 = options[1] ? options[1].key : options[0].key;
    const sel = h('select', { className: 'su-select' }, selKids);
    sel.value = setupPick[p];
    const info = h('div', { className: 'su-deckinfo' });
    const paint = () => {
      if (setupPick[p] === 'cpu:__random') { info.replaceChildren(h('span', {}, '진화된 CPU 덱 중 무작위 (시작할 때 정해집니다)')); return; }
      const i = setupDeckInfo(setupPick[p]);
      info.replaceChildren(h('span', {}, `메인 ${i.main}장 · 디지타마 ${i.egg}장`), h('span', { className: 'su-dots' }, i.colors.map(c => h('i', { className: 'su-dot', title: (SETUP_COLORS[c] || [])[1] || c, style: `background:${(SETUP_COLORS[c] || ['#888'])[0]}` }))));
    };
    sel.addEventListener('change', (e) => { setupPick[p] = e.target.value; paint(); });
    paint();
    return h('div', { className: `su-card su-${p}` }, [h('div', { className: 'su-h' }, title), sel, info]);
  };
  const cpu = CPU_CFG.mode === 'cpu';
  const seg = (items, cur, onPick) => h('div', { className: 'su-seg', role: 'group' }, items.map(([v, l, tip]) => h('button', { className: 'su-segbtn' + (v === cur ? ' on' : ''), title: tip || '', onClick: () => onPick(v) }, l)));
  const modeSeg = seg([['cpu', '🤖 CPU 대전', '당신은 P1, P2는 CPU가 조작합니다 (CPU의 패는 가려집니다)'], ['2p', '👥 2인 (한 화면)', '한 화면에서 번갈아 조작'], ['net', '🌐 온라인 대전', 'WebRTC로 다른 브라우저와 온라인 대전 (베타)']], CPU_CFG.mode, (v) => { if (v !== 'net' && Net.NET.role) { Net.reset(); netStatus = ''; } CPU_CFG.mode = v; saveCpuCfg(); renderSetup(); });
  const net = CPU_CFG.mode === 'net';
  const lvSeg = cpu ? seg(Object.entries(Cpu.LEVEL_LABEL).map(([v, l]) => [v, l, { easy: '실수가 잦은 연습 상대', normal: '기본 판단', hard: '4수 앞을 내다보는 상대', expert: '자가대전으로 조정한 파라미터 + 더 깊은 수 읽기' }[v]]), CPU_CFG.level, (v) => { CPU_CFG.level = v; saveCpuCfg(); renderSetup(); }) : null;

  const heroWithBug = h('div', { className: 'su-hero' }, [
    h('div', { className: 'su-logo' }, '⟁'),
    h('div', {}, [h('div', { className: 'su-title' }, '디지몬 카드게임'), h('div', { className: 'su-sub' }, '시뮬레이터 · 룰 엔진 + CPU 대전')]),
    h('button', { className: 'su-bugreport', title: '플레이 중 발견한 버그나 이상한 동작을 신고해주세요', onClick: () => window.open('https://forms.gle/uLfLuPv9bnvkxauZ6', '_blank', 'noopener') }, '🐛 버그 리포트'),
  ]);
  const ext = PR.startScreenExtras();
  const netReady = net && Net.NET.role === 'host' && Net.NET.connected; // host-only gate: guest never sees this screen (see renderNetGuestWaiting)
  app.appendChild(h('div', { className: 'su-wrap' }, [
    heroWithBug,
    h('div', { className: 'su-card' }, [
      h('div', { className: 'su-h' }, '대전 방식'), modeSeg,
      cpu ? h('div', { className: 'su-h su-h2' }, 'CPU 강도') : null, lvSeg,
      cpu ? h('div', { className: 'su-note' }, '당신은 P1, P2는 CPU가 조작합니다 (CPU의 패는 가려집니다).') : null,
    ].filter(Boolean)),
    net ? netRoomCard() : null,
    (!net || netReady) ? h('div', { className: 'su-grid' }, [deckCard('p1', cpu ? '🧑 내 덱 (P1)' : (net ? 'P1 덱 (호스트=나)' : 'P1 덱')), net ? guestDeckCardForHost() : deckCard('p2', cpu ? '🤖 상대 덱 (P2 · CPU)' : 'P2 덱')]) : null,
    setupError ? h('div', { className: 'effect-box', style: 'color:var(--danger)' }, setupError) : null,
    (!net || netReady) ? h('button', { className: 'primary su-start', disabled: net && !Net.NET.guestDeck, title: net && !Net.NET.guestDeck ? '게스트가 덱을 고를 때까지 기다려 주세요' : '', onClick: startNewGame }, net && !Net.NET.guestDeck ? '⏳ 게스트가 덱을 고르는 중…' : '⚔ 새 게임 시작') : null,
    net ? null : spectateSection({ resolveKey: (k) => { const d = resolveDeckPick(k); return d && typeof d === 'object' ? d : null; }, savedOptions: deckOptionsList, PR, CD, S, Cpu, rerender: renderSetup }), // 🍿 CPU끼리 구경하기 (src/spectate-ui.js) — irrelevant once a network room is open
    h('div', { className: 'su-more' }, [
      h('button', { onClick: openDeckBuilder }, '🛠 덱 빌더'),
      ext,
    ]),
  ].filter(Boolean)));
}

// ---------- deck builder ----------
// The search box / filter controls / deck-name input are created ONCE per builder screen and stay in the DOM;
// filter changes only rebuild the results grid (debounced), deck lists and preview panel — never the inputs.

const DBS_KEY = 'digimon_dbfilter_v1';
let dbDraft = null;
let dbFilter = DBS.defaultFilter();
let dbSavedName = '';
let dbLastError = '';
let dbIndex = null, dbOpts = null;
let dbPreview = null;      // card id shown in the preview panel
let dbMatched = [];        // ids matching the current filter (preview ◀ ▶ browses these)
let dbTerms = [];          // highlight terms of the current query
let dbPanelOpen = false;   // filter accordion
let dbEls = null;          // live DOM refs of the current builder screen
let dbSyncers = [];        // functions that re-sync chip/input state from dbFilter
let dbTimer = null;
let dbIdFilter = null;     // { ids:Set, label } — checkup warning → show only the related cards in the grid
let dbDA = null;           // deck-analysis panels (decktools-ui.js) of the current builder screen
let dbDeckSort = 'none';   // right-hand deck list sort mode (decktools SORT_MODES)
let dbKeyBound = false;
const dbLP = { timer: null, fired: false };
let dbLastTap = { id: '', t: 0 };

function loadDbFilter() {
  const def = DBS.defaultFilter();
  try {
    const j = JSON.parse(localStorage.getItem(DBS_KEY) || 'null');
    if (!j || typeof j !== 'object') return def;
    const out = { ...def };
    for (const k of Object.keys(def)) {
      if (j[k] === undefined) continue;
      if (Array.isArray(def[k])) { if (Array.isArray(j[k])) out[k] = j[k]; }
      else if (def[k] && typeof def[k] === 'object') out[k] = { ...def[k], ...j[k] };
      else if (typeof def[k] === typeof j[k]) out[k] = j[k];
    }
    out.pageSize = 60;
    return out;
  } catch { return def; }
}
function saveDbFilter() { try { localStorage.setItem(DBS_KEY, JSON.stringify({ ...dbFilter, pageSize: 60 })); } catch { /* storage unavailable */ } }

// 🤖 CPU가 덱 짜주기: colour (or auto) + optional set -> CD.buildDeckFromCollection fills the draft; the checkup panel shows the result and the user can tweak.
function cpuBuildRow() {
  const colSel = h('select', { className: 'db-scope', title: '색' }, [h('option', { value: '' }, '색: 자동'), ...Object.entries(SETUP_COLORS).map(([k, v]) => h('option', { value: k }, '색: ' + v[1]))]);
  const setSel = h('select', { className: 'db-scope', title: '세트' }, [h('option', { value: '' }, '세트: 전체/자동'), ...(dbOpts ? dbOpts.sets : []).map(x => h('option', { value: x }, '세트: ' + x))]);
  const btn = h('button', { className: 'primary', title: '진화로 다듬어진 CPU 덱/생성기로 40+5장 합법 덱을 채웁니다', onClick: () => {
    btn.disabled = true; btn.textContent = '🤖 짜는 중…';
    setTimeout(() => {
      try {
        const r = CD.buildDeckFromCollection({ colors: colSel.value ? [colSel.value] : undefined, sets: setSel.value ? [setSel.value] : undefined });
        if (!r || !r.deck) { dbLastError = 'CPU 덱 짜기 실패 — ' + ((r && r.reason) || '알 수 없음'); }
        else { dbDraft = { name: r.deck.name || 'CPU 덱', main: { ...r.deck.main }, digitama: { ...r.deck.digitama }, art: {} }; dbSavedName = r.deck.name || 'CPU 덱'; if (dbEls && dbEls.name) dbEls.name.value = dbSavedName; dbLastError = ''; showToast(r.source === 'evolved' ? '진화 덱을 불러왔습니다 — 체크업을 확인하고 자유롭게 고치세요' : 'CPU가 덱을 짰습니다 — 체크업을 확인하고 자유롭게 고치세요'); }
      } catch (e) { dbLastError = 'CPU 덱 짜기 오류: ' + (e.message || e); }
      btn.disabled = false; btn.textContent = '🤖 CPU가 덱 짜주기'; dbRefreshDeck();
    }, 30);
  } }, '🤖 CPU가 덱 짜주기');
  return h('div', { className: 'actions-row' }, [btn, colSel, setSel]);
}

function openDeckBuilder() {
  dbDraft = DB.newDraft();
  dbFilter = loadDbFilter();
  dbSavedName = '';
  dbPreview = null;
  dbLastError = '';
  renderDeckBuilderScreen();
}

function dbEnsureIndex() {
  if (!dbIndex) { dbIndex = DBS.buildIndex(S.CARDS, S.PARALLELS); dbOpts = DBS.buildOptions(S.CARDS, dbIndex); }
}
function dbCtx() { return { copies: (id) => DB.copiesInDeck(dbDraft, id), max: (id) => DB.maxCopiesFor(id) }; }

function dbSchedule() { // coalesce bursts of keystrokes into one grid refresh
  clearTimeout(dbTimer);
  dbTimer = setTimeout(() => { dbFilter.pageSize = 60; saveDbFilter(); dbRefreshResults(); }, 120);
}
function dbFilterChanged() { dbSyncers.forEach(f => f()); dbFilter.pageSize = 60; saveDbFilter(); dbRefreshResults(); }
function toggleIn(arr, v) { const i = arr.indexOf(v); if (i === -1) arr.push(v); else arr.splice(i, 1); }

function openDeckImport(prefill = '') {
  document.getElementById('deck-import-overlay')?.remove();
  const ta = h('textarea', { className: 'di-text', rows: 12, placeholder: '한 줄에 하나씩 붙여넣기:\n4 EX1-066\n1 BT7-107\n3 LM-032\n…\n(수량 카드번호 / 카드번호 x수량 / 카드번호,수량 모두 가능. 디지타마는 자동으로 디지타마 덱으로 들어갑니다)' });
  ta.value = prefill;
  const nameIn = h('input', { className: 'di-name', placeholder: '덱 이름 (저장할 때 사용)', value: dbSavedName || '' });
  const summary = h('div', { className: 'di-summary meta' });
  const list = h('div', { className: 'di-list' });
  let parsed = null;
  const update = () => {
    parsed = parseDeckText(ta.value, S);
    const parts = [`메인 ${parsed.mainN}/50`, `디지타마 ${parsed.digN}/5`, `인식한 줄 ${parsed.lines}`];
    summary.replaceChildren(h('b', { style: parsed.mainN === 50 && parsed.digN <= 5 && !parsed.errors.length ? 'color:var(--ok)' : 'color:var(--danger)' }, parts.join(' · ')));
    list.replaceChildren(
      ...parsed.errors.map(e => h('div', { className: 'di-err' }, `⚠ ${e.line}행 「${e.text}」: ${e.reason}`)),
      ...parsed.warnings.map(w => h('div', { className: 'di-warn' }, `• ${w}`)),
      ...Object.entries({ ...parsed.main, ...parsed.digitama }).map(([id, n]) => h('div', { className: 'di-row' }, `${n} × ${S.card(id).nameKo} (${id})${S.card(id).category === 'digitama' ? ' — 디지타마' : ''}`)),
    );
  };
  let timer = null;
  ta.addEventListener('input', (e) => { if (e.isComposing) return; clearTimeout(timer); timer = setTimeout(update, 120); });
  ta.addEventListener('compositionend', update);
  const apply = (merge) => {
    update();
    if (!parsed.lines) { summary.replaceChildren(h('b', { style: 'color:var(--danger)' }, '인식된 카드가 없습니다')); return; }
    const base = merge ? dbDraft : DB.newDraft();
    for (const zone of ['main', 'digitama']) for (const [id, n] of Object.entries(parsed[zone])) base[zone][id] = (base[zone][id] || 0) + n;
    dbDraft = base;
    if (nameIn.value.trim()) dbSavedName = nameIn.value.trim();
    dbLastError = parsed.errors.length ? `가져오기 완료 — 인식하지 못한 줄 ${parsed.errors.length}개` : '';
    overlay.remove();
    if (dbEls && dbEls.name) dbEls.name.value = dbSavedName || '';
    dbRefreshDeck();
  };
  const close = () => overlay.remove();
  const overlay = h('div', { id: 'deck-import-overlay', className: 'di-overlay', onClick: (e) => { if (e.target === overlay) close(); } }, [
    h('div', { className: 'di-panel' }, [
      h('div', { className: 'section-title' }, '덱 리스트 가져오기'),
      ta, nameIn, summary, list,
      h('div', { className: 'actions-row' }, [
        h('button', { className: 'primary', onClick: () => apply(false) }, '새 덱으로 가져오기'),
        h('button', { onClick: () => apply(true) }, '현재 덱에 합치기'),
        h('button', { onClick: close }, '닫기'),
      ]),
    ]),
  ]);
  document.body.appendChild(overlay);
  update();
  setTimeout(() => ta.focus(), 30);
}
// Parallel (alternate-art) helpers. Art is display-only: zones/decks hold canonical card numbers (2-12-1).
function dbArtKey(id) { const k = dbDraft?.art?.[id]; return k && S.parallelOf(k) && k.startsWith(id + '_P') ? k : null; }
function dbArtUrl(id) { const k = dbArtKey(id); return k ? S.parallelOf(k).imgUrl : S.card(id).imgUrl; }
// <img> that falls back to the base art if a variant image fails to load (CDN 404 / blocked).
function artImg(src, base, props) {
  const img = h('img', { ...props, src });
  if (base && src !== base) img.addEventListener('error', () => { img.src = base; }, { once: true });
  return img;
}
function dbAdd(id) { const r = DB.addCard(dbDraft, id); dbLastError = r.ok ? '' : r.reason; dbRefreshDeck(); }
function dbRemove(id) { DB.removeCard(dbDraft, id); dbLastError = ''; dbRefreshDeck(); }
function dbOpenPreview(id) { dbPreview = id; dbRefreshPreview(); }
function dbStepPreview(d) {
  const i = dbMatched.indexOf(dbPreview);
  if (i === -1) return;
  const n = dbMatched[i + d];
  if (n) { if (dbMatched.indexOf(n) >= dbFilter.pageSize) { dbFilter.pageSize += 60; dbRefreshResults(); } dbOpenPreview(n); }
}

function dbChip(label, isOn, toggle, title, extraCls = '') {
  const b = h('button', { className: 'db-chip ' + extraCls, title: title || undefined, onClick: () => { toggle(); dbFilterChanged(); } }, label);
  const sync = () => b.classList.toggle('primary', !!isOn());
  dbSyncers.push(sync); sync();
  return b;
}
function dbRange(key, label, step) {
  const mk = (bound, ph) => {
    const inp = h('input', { type: 'number', className: 'db-num', placeholder: ph, min: '0', step: String(step), inputmode: 'numeric' });
    inp.value = dbFilter[key][bound];
    inp.addEventListener('input', () => { dbFilter[key][bound] = inp.value; dbSchedule(); });
    dbSyncers.push(() => { if (document.activeElement !== inp) inp.value = dbFilter[key][bound]; });
    return inp;
  };
  return h('div', { className: 'db-row' }, [h('span', { className: 'db-lbl' }, label), mk('min', '최소'), '~', mk('max', '최대')]);
}

function renderDeckBuilderScreen() {
  dbEnsureIndex();
  dbSyncers = [];
  const prevScroll = app.querySelector('.board')?.scrollTop || 0;
  app.innerHTML = '';
  const els = dbEls = {};

  els.mainN = h('span'); els.digN = h('span');
  app.appendChild(h('div', { className: 'topbar' }, [h('div', { className: 'topbar-row' }, [
    h('b', {}, '덱 빌더'), els.mainN, els.digN,
    h('button', { onClick: () => { const el = document.getElementById('db-deck'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '내 덱 ↓'),
    h('button', { onClick: () => { state = null; render(); } }, '나가기'),
  ])]));

  // --- search row (created once) ---
  const inp = h('input', { className: 'db-search', placeholder: '검색: 이름·번호·특징·효과 …', value: dbFilter.q, autocomplete: 'off', enterkeyhint: 'search' });
  let composing = false;
  inp.addEventListener('compositionstart', () => { composing = true; });
  inp.addEventListener('input', (e) => { dbFilter.q = inp.value; if (e.isComposing || composing) return; dbSchedule(); }); // IME: don't refresh mid-composition
  inp.addEventListener('compositionend', () => { composing = false; dbFilter.q = inp.value; dbSchedule(); });
  els.search = inp;
  const scopeSel = h('select', { className: 'db-scope', title: '검색 범위' }, DBS.SCOPES.map(([v, l]) => h('option', { value: v }, l)));
  scopeSel.value = dbFilter.scope;
  scopeSel.addEventListener('change', () => { dbFilter.scope = scopeSel.value; dbFilterChanged(); });
  dbSyncers.push(() => { scopeSel.value = dbFilter.scope; });
  const help = h('span', { className: 'db-help', tabindex: '0', title: '검색 문법\n· 공백 = AND  (예: 옐로 퍼플)\n· "따옴표" = 구문 그대로  (예: "덱 위에서부터 3장")\n· -단어 = 제외  (예: 블로커 -재밍)\n· a|b = 또는  (예: 리커버리|세이브)\n대소문자·띄어쓰기는 무시합니다.' }, '?');
  const sortSel = h('select', { className: 'db-sort', title: '정렬' }, DBS.SORTS.map(([v, l]) => h('option', { value: v }, '정렬: ' + l)));
  sortSel.value = dbFilter.sort;
  sortSel.addEventListener('change', () => { dbFilter.sort = sortSel.value; dbFilterChanged(); });
  dbSyncers.push(() => { sortSel.value = dbFilter.sort; });
  els.count = h('span', { className: 'meta db-count' });
  els.toggle = h('button', { onClick: () => { dbPanelOpen = !dbPanelOpen; els.panel.style.display = dbPanelOpen ? '' : 'none'; dbUpdateBar(); } });
  const resetBtn = h('button', { onClick: () => {
    const keep = dbFilter.sort; dbFilter = DBS.defaultFilter(); dbFilter.sort = keep;
    els.search.value = ''; dbFilterChanged();
  } }, '필터 초기화');
  const searchRow = h('div', { className: 'db-row db-searchrow' }, [inp, scopeSel, help]);
  const barRow = h('div', { className: 'db-row' }, [els.toggle, sortSel, resetBtn, els.count]);

  // --- filter panel (accordion) ---
  const traitInput = h('input', { className: 'db-trait-in', placeholder: '특징 추가 (자동완성)', list: 'db-trait-list', autocomplete: 'off' });
  const traitList = h('datalist', { id: 'db-trait-list' }, dbOpts.traits.map(t => h('option', { value: t })));
  els.traitChips = h('span', { className: 'db-chips' });
  const renderTraitChips = () => els.traitChips.replaceChildren(...dbFilter.traits.map(t => h('button', { className: 'db-chip primary', title: '클릭하면 제거', onClick: () => { toggleIn(dbFilter.traits, t); dbFilterChanged(); } }, t + ' ✕')));
  dbSyncers.push(renderTraitChips); renderTraitChips();
  const addTrait = () => { const v = traitInput.value.trim(); if (v && dbOpts.traits.includes(v) && !dbFilter.traits.includes(v)) { dbFilter.traits.push(v); traitInput.value = ''; dbFilterChanged(); } };
  traitInput.addEventListener('change', addTrait);
  traitInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTrait(); } });

  const colorKo = Object.fromEntries(DBS.COLORS.map(([k, ko]) => [k, ko]));
  const sect = (label, ...kids) => h('div', { className: 'db-row' }, [h('span', { className: 'db-lbl' }, label), ...kids]);
  const setSel = h('select', { className: 'db-scope', title: '세트' }, [h('option', { value: '' }, '전체 세트'), ...dbOpts.sets.map(s => h('option', { value: s }, s))]);
  setSel.value = dbFilter.setKey;
  setSel.addEventListener('change', () => { dbFilter.setKey = setSel.value; dbFilterChanged(); });
  dbSyncers.push(() => { setSel.value = dbFilter.setKey; });

  els.panel = h('div', { className: 'db-panel', style: dbPanelOpen ? '' : 'display:none' }, [
    sect('종류', ...DBS.CATS.map(([v, l]) => dbChip(l, () => dbFilter.cats.includes(v), () => toggleIn(dbFilter.cats, v)))),
    sect('색', ...DBS.COLORS.map(([v, l]) => dbChip(l, () => dbFilter.colors.includes(v), () => toggleIn(dbFilter.colors, v), '', 'col-' + v)),
      dbChip('단색만', () => dbFilter.mono, () => { dbFilter.mono = !dbFilter.mono; }, '체크 해제 = 다색 포함'),
      dbChip('모두 포함 (AND)', () => dbFilter.colorAnd, () => { dbFilter.colorAnd = !dbFilter.colorAnd; }, '켜면 선택한 색을 전부 가진 카드만 (예: 레드+블루 = 두 색을 모두 가진 카드). 끄면 선택한 색 중 하나라도 가진 카드 (OR)')),
    sect('Lv', ...[2, 3, 4, 5, 6, 7].map(n => dbChip('Lv.' + n, () => dbFilter.levels.includes(n), () => toggleIn(dbFilter.levels, n)))),
    dbRange('cost', '등장·사용 코스트', 1), dbRange('dp', 'DP', 1000), dbRange('evo', '진화 코스트', 1),
    sect('특징', traitInput, traitList, els.traitChips),
    sect('키워드', ...dbOpts.keywords.map(k => dbChip(k, () => dbFilter.keywords.includes(k), () => toggleIn(dbFilter.keywords, k), '《' + k + '》'))),
    sect('효과 타입', ...dbOpts.tags.map(k => dbChip('【' + DBS.tagLabel(k) + '】', () => dbFilter.tags.includes(k), () => toggleIn(dbFilter.tags, k)))),
    sect('팩', ...['ST', 'BT', 'EX', 'P', 'LM', 'AD', 'RB'].map(p => dbChip(p, () => dbFilter.packs.includes(p), () => toggleIn(dbFilter.packs, p))), setSel),
    sect('레어도', ...dbOpts.rarities.map(r => dbChip(r, () => dbFilter.rarities.includes(r), () => toggleIn(dbFilter.rarities, r)))),
    sect('패러렐', dbChip('패러렐 있음 (🎨)', () => dbFilter.hasPar, () => { dbFilter.hasPar = !dbFilter.hasPar; }, '대체 일러스트가 있는 카드만')),
    sect('덱', dbChip('내 덱에 있는 카드만', () => dbFilter.inDeck, () => { dbFilter.inDeck = !dbFilter.inDeck; }),
      dbChip('한도(4장) 찬 카드 숨기기', () => dbFilter.hideMax, () => { dbFilter.hideMax = !dbFilter.hideMax; })),
  ]);

  els.err = h('div', { className: 'meta', style: 'color:var(--danger)' });
  els.grid = h('div', { className: 'hand-list' });
  els.more = h('div', { className: 'actions-row' });

  // --- right column: deck ---
  els.deckErrors = h('div');
  els.mainList = h('div', { className: 'stack-list' });
  els.digList = h('div', { className: 'stack-list' });
  els.mainLbl = h('div', { className: 'zone-label' }); els.digLbl = h('div', { className: 'zone-label' });
  els.saved = h('div');
  const nameInput = h('input', { placeholder: '덱 이름', value: dbSavedName });
  nameInput.addEventListener('input', (e) => { dbSavedName = e.target.value; });
  els.name = nameInput;
  dbDA = createDeckAnalysis({
    h, S, E, DB, cardChip, showToast,
    getDraft: () => dbDraft, getSavedName: () => dbSavedName, refreshDeck: () => dbRefreshDeck(),
    openPreview: (id) => dbOpenPreview(id), artUrl: (id) => dbArtUrl(id),
    loadDeck: (name, def) => { dbDraft = { name, main: { ...def.main }, digitama: { ...def.digitama }, art: { ...(def.art || {}) } }; dbSavedName = name; dbLastError = ''; dbRefreshDeck(); },
    setIdFilter: (ids, label) => { dbIdFilter = ids && ids.length ? { ids: new Set(ids), label: label || '' } : null; dbRefreshResults(); if (dbIdFilter) els.board.querySelector('.db-left')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  });
  const sortSelDeck = h('select', { className: 'db-scope', title: '내 덱 정렬' }, DT.SORT_MODES.map(([v, l]) => h('option', { value: v }, '덱 정렬: ' + l)));
  sortSelDeck.value = dbDeckSort;
  sortSelDeck.addEventListener('change', () => { dbDeckSort = sortSelDeck.value; dbRefreshDeck(); });
  const rightCol = h('div', { className: 'player-panel', id: 'db-deck', style: 'min-width:260px;' }, [
    h('div', { className: 'section-title' }, '내 덱 (카드를 탭하면 미리보기 · ＋/－ 수량 · ✕ 전부 제거)'),
    els.deckErrors, sortSelDeck, els.mainLbl, els.mainList, els.digLbl, els.digList,
    h('div', { className: 'actions-row' }, [nameInput, h('button', { className: 'primary', onClick: () => {
      if (!dbSavedName.trim()) { dbLastError = '덱 이름을 입력하세요'; dbRefreshDeck(); return; }
      // 1-4-1: an illegal deck (not exactly 50 / >5 digitama / over the copy limit) cannot be saved.
      const legal = DB.validate(dbDraft);
      if (!legal.ok) { dbLastError = '저장 불가 — ' + legal.errors.join(' / '); dbRefreshDeck(); return; }
      dbLastError = '';
      const all = DB.loadSavedDecks();
      all[dbSavedName.trim()] = DB.toDeckDefRecord({ ...dbDraft, name: dbSavedName.trim() });
      DB.saveSavedDecks(all);
      dbRefreshDeck();
    } }, '저장')]),
    els.saved,
    h('div', { className: 'actions-row' }, [
      h('button', { className: 'primary', onClick: () => openDeckImport() }, '📋 덱 가져오기 (붙여넣기)'),
      h('button', { onClick: () => { const t = deckToText(dbDraft, S); if (!t) { dbLastError = '내보낼 카드가 없습니다'; dbRefreshDeck(); return; } (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => { dbLastError = ''; showToast('덱 리스트를 복사했습니다'); }).catch(() => { openDeckImport(t); }); } }, '덱 복사(내보내기)'),
      h('button', { onClick: async () => { const r = await exportDeckRecipeDocx(dbDraft, S); if (!r.ok) { dbLastError = r.error || '레시피 파일을 만들지 못했습니다'; dbRefreshDeck(); return; } dbLastError = ''; showToast('덱 레시피(.docx)를 다운로드했습니다'); dbRefreshDeck(); } }, '📄 레시피 다운로드(docx)'),
      h('button', { onClick: () => { dbDraft = DB.newDraft(); dbSavedName = ''; dbLastError = ''; dbRefreshDeck(); } }, '새로 만들기(초기화)'),
    ]),
    cpuBuildRow(),
    dbDA.el,
  ]);

  els.board = h('div', { className: 'board' }, [
    h('div', { className: 'player-panel db-left' }, [searchRow, barRow, els.panel, els.err, els.grid, els.more]),
    rightCol,
  ]);
  app.appendChild(els.board);
  els.preview = h('div', { id: 'db-preview', className: 'db-preview', style: 'display:none' });
  app.appendChild(els.preview);

  if (!dbKeyBound) {
    dbKeyBound = true;
    document.addEventListener('keydown', (e) => {
      if (!dbEls || !dbEls.board.isConnected || !dbPreview) return;
      if (e.key === 'Escape') { dbPreview = null; dbRefreshPreview(); return; }
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') dbStepPreview(-1); else if (e.key === 'ArrowRight') dbStepPreview(1);
    });
  }

  dbRefreshDeck();
  if (prevScroll) els.board.scrollTop = prevScroll;
}

function dbUpdateBar() {
  if (!dbEls) return;
  const n = DBS.activeFilterCount(dbFilter);
  dbEls.toggle.textContent = `필터 ${dbPanelOpen ? '▴' : '▾'}${n ? ` (${n})` : ''}`;
  dbEls.count.textContent = `${dbMatched.length}장`;
}

function dbTile(id) {
  const have = DB.copiesInDeck(dbDraft, id);
  const chip = cardChip(id, {
    showId: true,
    selected: have > 0,
    deckCount: have || undefined,
    art: dbArtUrl(id), parBadge: !!dbArtKey(id), parCount: (S.PARALLELS[id] || []).length || undefined,
    onClick: () => {
      if (dbLP.fired) { dbLP.fired = false; return; } // long-press already added
      const now = Date.now();
      if (dbLastTap.id === id && now - dbLastTap.t < 350) { dbLastTap = { id: '', t: 0 }; dbAdd(id); return; } // double-click = add
      dbLastTap = { id, t: now };
      dbOpenPreview(id);
    },
  });
  chip.style.position = 'relative';
  chip.appendChild(h('button', { className: 'db-quick', title: '덱에 1장 추가', onClick: (e) => { e.stopPropagation(); dbAdd(id); } }, '＋'));
  chip.addEventListener('pointerdown', () => { dbLP.fired = false; clearTimeout(dbLP.timer); dbLP.timer = setTimeout(() => { dbLP.fired = true; dbAdd(id); }, 600); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) chip.addEventListener(ev, () => clearTimeout(dbLP.timer));
  return chip;
}

// 목록을 통째로 다시 그릴 때 잠깐 문서 높이가 줄어 스크롤이 맨 위로 튀는 것을 막는다 (+ 버튼 등)
function dbKeepScroll(fn) {
  const sc = [dbEls && dbEls.board, document.scrollingElement].filter(Boolean).map(el => [el, el.scrollTop]);
  const minH = dbEls && dbEls.board ? dbEls.board.scrollHeight : 0;
  if (dbEls && dbEls.board && minH) dbEls.board.style.minHeight = minH + 'px'; // 다시 그리는 동안 높이 유지
  try { fn(); } finally {
    for (const [el, t] of sc) el.scrollTop = t;
    if (dbEls && dbEls.board) dbEls.board.style.minHeight = '';
  }
}
function dbRefreshResults() { dbKeepScroll(dbRefreshResultsInner); }
function dbRefreshResultsInner() {
  if (!dbEls) return;
  const r = DBS.runSearch(dbFilter, S.CARDS, dbIndex, dbCtx());
  dbMatched = r.ids; dbTerms = r.terms;
  if (dbIdFilter) dbMatched = Object.keys(S.CARDS).filter(id => dbIdFilter.ids.has(id)).sort(DBS.cardNoCompare); // checkup warning: only the related cards (other filters ignored), still in card-number order
  const shown = dbMatched.slice(0, dbFilter.pageSize);
  dbEls.grid.replaceChildren(...(dbIdFilter ? [h('div', { className: 'dt-idfilter' }, [`🩺 점검 항목 「${dbIdFilter.label}」 관련 카드만 표시 중 (${dbMatched.length}장) `, h('button', { onClick: () => { dbIdFilter = null; dbRefreshResults(); } }, '해제 ✕')])] : []), ...shown.map(dbTile));
  dbEls.more.replaceChildren(dbMatched.length > shown.length
    ? h('button', { onClick: () => { dbFilter.pageSize += 60; dbRefreshResults(); } }, `더 보기 (${dbMatched.length - shown.length}장 더 있음)`)
    : h('span', { className: 'meta' }, dbMatched.length ? `총 ${dbMatched.length}장 검색됨` : '검색 결과가 없습니다'));
  dbUpdateBar();
  if (dbPreview) dbRefreshPreview(); // ◀ ▶ position / highlight follow the new results
}

function dbRefreshDeck() { dbKeepScroll(dbRefreshDeckInner); }
function dbRefreshDeckInner() {
  if (!dbEls) return;
  const els = dbEls;
  const v = DB.validate(dbDraft);
  els.mainN.textContent = `메인 ${v.mainN}/50`;
  els.digN.textContent = `디지타마 ${v.digitamaN}/5`;
  els.digN.style.color = v.digitamaN > 5 ? 'var(--danger)' : '';
  els.deckErrors.replaceChildren(v.errors.length ? h('div', { className: 'effect-box' }, v.errors.join(' / ')) : h('div', { className: 'meta', style: 'color:var(--ok)' }, '유효한 덱 구성입니다'));
  els.mainLbl.textContent = `메인덱 (${v.mainN}/50)`;
  els.digLbl.textContent = `디지타마덱 (${v.digitamaN}/5)`;
  els.mainList.replaceChildren(...DT.sortEntries(Object.entries(dbDraft.main), dbDeckSort, S.card).map(([id, n]) => deckLineItem(id, n)));
  els.digList.replaceChildren(...DT.sortEntries(Object.entries(dbDraft.digitama), dbDeckSort, S.card).map(([id, n]) => deckLineItem(id, n)));
  els.err.textContent = dbLastError;
  if (document.activeElement !== els.name) els.name.value = dbSavedName;
  if (dbDA) { dbDA.renderSaved(els.saved); dbDA.refresh(); } // saved-deck manager + live stats/checkup panels
  dbRefreshResults(); // tile copy counts, in-deck / at-limit filters
}

function deckLineItem(id, n) {
  const chip = cardChip(id, { showId: true, deckCount: n, art: dbArtUrl(id), parBadge: !!dbArtKey(id), onClick: () => dbOpenPreview(id) });
  chip.style.position = 'relative';
  chip.appendChild(h('button', { className: 'db-quick db-minus', title: '덱에서 1장 빼기', onClick: (e) => { e.stopPropagation(); dbRemove(id); } }, '－'));
  const ctl = h('div', { className: 'dt-line-ctl' }, [
    h('button', { title: '1장 추가', onClick: () => dbAdd(id) }, '＋'),
    h('button', { title: '1장 빼기', onClick: () => dbRemove(id) }, '－'),
    h('button', { className: 'danger', title: '이 카드 전부 제거', onClick: () => { DT.setCount(dbDraft, id, 0, dbDA.env); dbLastError = ''; dbRefreshDeck(); } }, '✕'),
  ]);
  return h('div', { className: 'dt-line' }, [chip, ctl]);
}

// ---- preview panel (right side on desktop, bottom sheet on phones) ----
function dbHl(text) { return DBS.splitHighlight(text, dbTerms).map(p => p.hit ? h('mark', {}, p.t) : p.t); }
function dbArtPicker(id, c) {
  const vars = S.PARALLELS[id] || [];
  if (!vars.length) return null;
  const cur = dbArtKey(id);
  const opt = (key, url, label) => h('button', { className: 'db-art' + (cur === key ? ' on' : ''), title: label + ' — 이 덱에서 사용할 일러스트', onClick: () => { DB.setArt(dbDraft, id, key); dbRefreshDeck(); } }, [
    artImg(url, c.imgUrl, { alt: label, loading: 'lazy' }), h('span', {}, label)]);
  return h('div', { className: 'db-art-row' }, [
    h('div', { className: 'zone-label' }, `일러스트 선택 (패러렐 ${vars.length}종 · 게임 규칙상 동일한 카드)`),
    h('div', { className: 'db-art-list' }, [opt(null, c.imgUrl, `일반 ${c.rarity || ''}`.trim()),
      ...vars.map((v, i) => opt(v.key, v.imgUrl, `패러렐${vars.length > 1 ? i + 1 : ''} ${v.rarity || ''}`.trim()))]),
  ]);
}
function dbRefreshPreview() {
  if (!dbEls) return;
  const box = dbEls.preview;
  dbEls.board.classList.toggle('db-preview-open', !!dbPreview);
  if (!dbPreview || !S.CARDS[dbPreview]) { dbPreview = null; box.style.display = 'none'; box.replaceChildren(); return; }
  const id = dbPreview, c = S.card(id);
  const have = DB.copiesInDeck(dbDraft, id), max = DB.maxCopiesFor(id);
  const zone = c.category === 'digitama' ? 'digitama' : 'main';
  const zoneN = DB.totalCount(dbDraft[zone]), zoneMax = zone === 'digitama' ? 5 : 50;
  const inZone = dbDraft[zone][id] || 0;
  const canAdd = have < max && zoneN < zoneMax;
  const idx = dbMatched.indexOf(id);
  const CAT_KO = { digimon: '디지몬', tamer: '테이머', option: '옵션', digitama: '디지타마' };
  const COL_KO = Object.fromEntries(DBS.COLORS.map(([k, ko]) => [k, ko]));
  const line = (k, val) => (val == null || val === '' ? null : h('div', { className: 'db-pv-line' }, [h('b', {}, k + ' '), val]));
  const textBox = (label, text) => (text ? h('div', { className: 'db-pv-box' }, [h('div', { className: 'zone-label' }, label), h('div', { className: 'db-pv-text' }, dbHl(text))]) : null);
  const all = (c.effectKo || '') + '\n' + (c.inheritedKo || '') + '\n' + (c.optionKo || '');
  const linesOf = (re) => all.split('\n').filter(l => re.test(l)).join('\n');
  const security = linesOf(/^\s*【시큐리티】/);
  const linkish = linesOf(/링크|크로스|조그레스|Xros|Jogress|링크/i);
  const evo = c.evoNormal ? `${c.evoNormal.conditionText || ('Lv.' + c.evoNormal.level)} → 진화 코스트 ${c.evoNormal.cost}` : null;
  box.replaceChildren(
    h('div', { className: 'db-pv-head' }, [
      h('button', { disabled: idx <= 0, title: '이전 카드 (←)', onClick: () => dbStepPreview(-1) }, '◀'),
      h('span', { className: 'meta' }, idx >= 0 ? `${idx + 1} / ${dbMatched.length}` : '검색 결과 밖'),
      h('button', { disabled: idx === -1 || idx >= dbMatched.length - 1, title: '다음 카드 (→)', onClick: () => dbStepPreview(1) }, '▶'),
      h('button', { className: 'db-pv-close', title: '닫기 (Esc)', onClick: () => { dbPreview = null; dbRefreshPreview(); } }, '✕'),
    ]),
    h('div', { className: 'db-pv-body' }, [
      c.imgUrl ? artImg(dbArtUrl(id), c.imgUrl, { className: 'db-pv-img', alt: c.nameKo }) : null,
      dbArtPicker(id, c),
      h('div', { className: 'db-pv-name' }, dbHl(c.nameDisplayKo || c.nameKo)),
      h('div', { className: 'meta' }, [c.id, ' · ', CAT_KO[c.category] || c.category, c.rarity ? ` · ${c.rarity}` : '', c.setName ? ` · ${c.setName}` : '']),
      line('Lv', c.level != null ? String(c.level) : null),
      line(c.category === 'option' ? '사용 코스트' : '등장 코스트', c.cost != null ? String(c.cost) : null),
      line('DP', c.dp != null ? String(c.dp) : null),
      line('색', (c.colors || []).map(k => COL_KO[k] || k).join(' / ')),
      line('특징', [...(c.types || []), c.attribute && /^[가-힣]/.test(c.attribute) ? c.attribute : null, c.form && /^[가-힣]/.test(c.form) ? c.form : null].filter(Boolean).join(' / ')),
      line('진화', evo),
      textBox('효과', c.effectKo),
      textBox('진화원 효과', (c.inheritedKo || '').split('\n').filter(l => !/^\s*【시큐리티】/.test(l)).join('\n')), // (【시큐리티】 줄은 진화원 효과가 아니라 아래 시큐리티 효과)
      c.dual ? textBox(`옵션 쪽 (사용 코스트 ${S.optionView(id).cost} · ${(S.optionView(id).colors || []).map(k => COL_KO[k] || k).join('/')})`, c.optionKo) : null, // 듀얼 카드 (룰 4-6)
      textBox('시큐리티 효과', security),
      textBox('링크 / 크로스 / 조그레스', linkish),
    ]),
    h('div', { className: 'db-pv-foot' }, [
      h('span', {}, `덱 ${inZone}장 (동일 넘버 ${have}/${max}) · ${zone === 'digitama' ? '디지타마' : '메인'} ${zoneN}/${zoneMax}`),
      h('button', { className: 'primary', disabled: !canAdd, title: canAdd ? '' : (have >= max ? `같은 카드 넘버 최대 ${max}장` : '덱이 가득 찼습니다'), onClick: () => dbAdd(id) }, '＋ 덱에 추가'),
      h('button', { disabled: inZone <= 0, onClick: () => dbRemove(id) }, '－ 덱에서 빼기'),
    ]),
  );
  box.style.display = '';
}

let mulliganDecided = { p1: false, p2: false };
// Tracks whose hand was JUST dealt (initial deal, or that player's own
// mulligan) so the deal-in animation only plays for that hand's cards, not
// replayed across both hands on every re-render of this screen (e.g. when
// the other player clicks "이 핸드 유지" after you already mulliganed).
let mulliganDealFlash = { p1: false, p2: false };

let lastStartPick = null; // remembered across reloads too, so 🔁 재대전 also works after '이어하기'
try { const v = JSON.parse(localStorage.getItem('digimon_last_pick_v1') || 'null'); if (v && v.p1 && v.p2) lastStartPick = { p1: v.p1, p2: v.p2 }; } catch (e) { /* ignore */ }
// 🎲 restart the same decks with a fresh shuffle / opening hand (solo practice)
function restartHand() { if (lastStartPick) setupPick = { ...lastStartPick }; if (!setupPick.p1 || !setupPick.p2) { state = null; render(); return; } startNewGame(); }
function startNewGame() {
  cpuRandomDeck = null;
  if (CPU_CFG.mode !== 'net' && Net.NET.role) { Net.reset(); netStatus = ''; } // 온라인 접속이 남은 채로 CPU/2인 대전을 시작하면 자리·화면 방향이 뒤집히므로 끊는다
  if (Net.NET.role === 'host') setupPick.p2 = 'net:guest'; // 온라인: P2 덱은 게스트가 보낸 것
  if (setupPick.p2 === 'cpu:__random') { try { cpuRandomDeck = CD.pickCpuDeck({ style: 'random' }); } catch (e) { /* ignore */ } if (!cpuRandomDeck) { setupError = 'CPU 덱 데이터를 불러오지 못했습니다.'; renderSetup(); return; } }
  // 1-4-1: refuse to start with an illegal deck (previously-saved decks may predate the save check).
  for (const p of ['p1', 'p2']) {
    const def = resolveDeckPick(setupPick[p]);
    const d = typeof def === 'string' ? S.DECKS[def] : def;
    const v = d ? S.deckLegality(d) : { ok: false, errors: ['덱을 찾을 수 없음'] };
    if (!v.ok) { setupError = `${p.toUpperCase()} 덱 "${d?.name || setupPick[p]}"은(는) 게임에 사용할 수 없습니다: ` + v.errors.join(' / '); renderSetup(); return; }
  }
  setupError = '';
  lastStartPick = { p1: setupPick.p1, p2: setupPick.p2 };
  if (Net.NET.role !== 'host') { try { localStorage.setItem('digimon_last_pick_v1', JSON.stringify(lastStartPick)); } catch (e) { /* ignore */ } }
  PR.newGameStarted();
  sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1' };
  state = S.newGame(resolveDeckPick(setupPick.p1), resolveDeckPick(setupPick.p2));
  E.drawOpeningHand(state, 'p1');
  E.drawOpeningHand(state, 'p2');
  mulliganDecided = { p1: false, p2: false };
  mulliganDealFlash = { p1: true, p2: true };
  state.firstPlayer = E.coinFlip(); // 5-2-1-3: first player is decided BEFORE hands/mulligans (rock-paper-scissors); 5-2-1-4: mulligan goes first player first
  cpuStart(); // vs-CPU mode: P2 is played by src/cpu.js (its opening hand is hidden and decided automatically)
  renderMulliganStage();
}

function renderMulliganStage() {
  app.innerHTML = '';
  const hero = h('div', { className: 'su-hero' }, [
    h('div', { className: 'su-logo' }, '⟁'),
    h('div', {}, [h('div', { className: 'su-title' }, '오프닝 핸드 확인'), h('div', { className: 'su-sub' }, '멀리건 여부를 정하세요 (룰 5-2-1)')]),
  ]);
  // 🌐 온라인 대전: renderBoard()와 동일하게 "자신의 진영은 항상 자기 화면 아래쪽" 원칙 적용 (Net.NET.mySeat가 null이면 기존처럼 p1-then-p2 고정 순서).
  const bottomSeat = Net.NET.mySeat || 'p1';
  const topSeat = S.opponentOf(bottomSeat);
  const panels = [topSeat, bottomSeat].map(p => {
    const pl = state.players[p];
    const justDealt = mulliganDealFlash[p];
    mulliganDealFlash[p] = false;
    return h('div', { className: `su-card su-${p}` }, [
      h('div', { className: 'su-h' }, `${p.toUpperCase()} · ${pl.deckName}`),
      h('div', { className: 'hand-list' + (justDealt ? ' mulligan-hand' : '') }, pl.hand.map(id => ((isCpuSide(p) && !CPU_CFG.reveal && !state.winner) || id == null || netHideHand(p)) ? h('div', { className: 'card-chip cpu-hidden' }, '🂠') : cardChip(id, { owner: p }))),
      isCpuSide(p) ? h('div', { className: 'actions-row' }, [h('span', {}, mulliganDecided[p] ? ('🤖 CPU 결정 완료 ✔' + (state.cpuMulled ? ' (멀리건함)' : ' (핸드 유지)')) : '🤖 CPU가 결정 중…')]) :
      // 🌐 온라인 대전: 상대 자리의 멀리건 버튼을 내 화면에 보여주면, 그걸 눌러 상대의 결정을 내가 대신 내려버릴 수 있다
      // (netIntercept는 "내 클릭을 상대에게 보낼지"만 가릴 뿐, 애초에 상대 몫 버튼이 내 화면에 떠 있는 것 자체를 막지 않는다).
      // 상대 자리는 읽기 전용 문구로만 보여준다.
      (Net.NET.role && p !== Net.NET.mySeat) ? h('div', { className: 'actions-row' }, [h('span', {}, mulliganDecided[p] ? '결정 완료 ✔' : (p !== state.firstPlayer && !mulliganDecided[state.firstPlayer]) ? `선공(${state.firstPlayer.toUpperCase()})이 먼저 멀리건 여부를 결정합니다 (룰 5-2-1-4)` : '⏳ 상대가 결정 중…')]) :
      h('div', { className: 'actions-row' }, [
        mulliganDecided[p]
          ? h('span', {}, '결정 완료 ✔')
          : (p !== state.firstPlayer && !mulliganDecided[state.firstPlayer])
          ? h('span', {}, `선공(${state.firstPlayer.toUpperCase()})이 먼저 멀리건 여부를 결정합니다 (룰 5-2-1-4)`)
          : h('button', {
              className: 'primary',
              onClick: () => { if (netIntercept('mulligan', [p])) return; E.mulligan(state, p); mulliganDealFlash[p] = true; mulliganDecided[p] = true; afterMulliganCheck(); },
            }, '멀리건 (새로 5장)'),
        !mulliganDecided[p] && (p === state.firstPlayer || mulliganDecided[state.firstPlayer]) && h('button', {
          onClick: () => { if (netIntercept('keepHand', [p])) return; mulliganDecided[p] = true; afterMulliganCheck(); },
        }, '이 핸드 유지'),
      ].filter(Boolean)),
    ]);
  });
  app.appendChild(h('div', { className: 'su-wrap' }, [
    hero,
    Net.NET.role === 'guest' ? h('div', { className: 'su-note' }, '🌐 온라인 대전 (게스트) — 방장의 화면을 따라갑니다') : h('div', { className: 'su-more', style: 'margin-bottom:2px' }, [h('button', { title: '같은 덱으로 새로 셔플해 오프닝 핸드부터 다시 (혼자 연습용)', onClick: () => restartHand() }, '🎲 시작 핸드 다시 뽑기')]),
    ...panels,
  ]));
  cpuMulliganMaybe();
  netBroadcast();
}

function afterMulliganCheck() {
  if (mulliganDecided.p1 && mulliganDecided.p2) {
    E.setSecurityStacks(state);
    E.beginGame(state, state.firstPlayer);
    render();
  } else {
    renderMulliganStage();
  }
}

// ---------- render ----------

// 6-5-1: main-phase actions (play / evolve / use / link / attack / activate / pass) may only be
// taken while NOTHING is left unresolved — no waiting effect, open choice, or attack in progress.
function busy() {
  return !!state.uiChoice || attackActive() || !!sel.atkQueued || !!state.turnEnding || !!state._scriptedPierce || state.pending.some(t => !t.resolved);
}
// 6-6-2/6-6-3: a begun turn end finishes only once nothing is left to resolve (no waiting effect, choice, or
// attack — including one an end-of-turn effect has queued to start).
function settleTurnEndIfIdle() {
  if (state.turnEnding && !state.uiChoice && !attackActive() && !sel.atkQueued && !state._scriptedPierce && !state.pending.some(t => !t.resolved)) E.settleTurnEnd(state);
}
function blockIfBusy() {
  if (cpuHumanLocked()) return true; // vs CPU: nothing on the CPU's turn is the human's to do (silently ignored)
  if (!busy()) return false;
  S.log(state, '해결 중인 처리(효과/선택/어택)가 남아 있어 지금은 행동할 수 없음 (룰 6-5-1)');
  render();
  return true;
}

// A deletion parked by state.deleteStack on an OPTIONAL survive ability (회피/세이브/디코이/printed "…하는 것으로 소멸하지 않는다"):
// ask the owner whether to use it; resumeReplacement re-runs the deletion with that ability allowed / declined.
// 대체 효과 확인창은 실제로 처리하기 전에 미리 돌려 본 로그 줄을 보여 준다. 시큐리티는 비공개 정보라서(주인도 내용을 볼 수 없다) 방벽처럼 시큐리티를 파기하는
// 효과의 안내에는 파기될 시큐리티 카드의 이름이 나오면 안 된다 — 이름 부분을 지우고 "시큐리티 1장 파기"로만 보여 준다.
const promptSafeLine = (l) => String(l).replace(/(시큐리티[^:]*(?:파기|공개|추가|되돌림)[^:]*):\s*.+$/, '$1').replace(/\s*\(효과 트리거 대상일 수 있음[^)]*\)/, '');
const promptSafeLines = (lines) => (lines || []).map(promptSafeLine);
function pumpReplacementPrompt() {
  const pr = state.pendingReplacements;
  if (!pr || !pr.length || state.uiChoice) return;
  const e = pr[0];
  const nm = e.cardId ? S.card(e.cardId).nameDisplayKo || S.card(e.cardId).nameKo : '';
  const verb = e.kind === 'leave' ? '배틀 에어리어를 벗어나려' : '소멸하려';
  if (e.cands.length > 1) { // 18-2: several replacements could be used — the player picks which one (or none)
    state.uiChoice = {
      kind: 'multipleChoice',
      payload: { player: e.p, prompt: `${e.p}: ${nm}이(가) ${verb} 합니다 — 대신 사용할 효과를 선택하세요 (룰 18-2, 즉시형 15-8-5)`, options: [...e.cands.map((c, i) => `${i + 1}. ${promptSafeLines(c.lines).filter(l => !/스택 소멸/.test(l)).join(' / ') || '(생존 효과)'}`), '사용하지 않는다'] },
      resolve: (val) => { state.uiChoice = null; S.resumeReplacement(state, e, val == null || val >= e.cands.length ? -1 : val); render(); },
    };
    return;
  }
  state.uiChoice = {
    kind: 'confirmEffect',
    payload: { player: e.p, yesLabel: '사용한다', noLabel: '사용하지 않는다', prompt: `${e.p}: ${nm}이(가) ${verb} 합니다 — 대신 다음 효과를 사용할 수 있습니다: ${promptSafeLines(e.lines).join(' / ') || '(생존 효과)'}` },
    resolve: (val) => { state.uiChoice = null; S.resumeReplacement(state, e, val ? 0 : -1); render(); },
  };
}

// 화면 그리기 중 예외가 나도 빈 화면으로 멈추지 않게: 오류 내용을 화면에 보여 주고 복구 버튼을 준다 (폰에서는 콘솔을 볼 수 없으므로)
let renderErrCount = 0;
function render() {
  { const pa0 = sel && sel.pendingAttack; if (pa0 && pa0.rulesEnded && state && (state.turnNumber !== pa0.turn0 || state.phase !== 'main')) sel.pendingAttack = null; }
  try { renderInner(); renderErrCount = 0; netBroadcast(); }
  catch (e) {
    console.error('render failed', e);
    try {
      renderErrCount++;
      const msg = [String(e && e.message ? e.message : e), ...String(e && e.stack || '').split('\n').slice(0, 6)].join('\n');
      const info = ['[화면 오류] 턴 ' + (state ? state.turnNumber : '-') + ' / ' + (state ? state.phase : '-') + ' / ' + navigator.userAgent, msg].join('\n');
      app.innerHTML = '';
      app.appendChild(h('div', { className: 'su-wrap' }, [
        h('div', { className: 'su-card' }, [
          h('div', { className: 'su-h' }, '⚠ 화면을 그리는 중 오류가 발생했습니다'),
          h('div', { className: 'su-note' }, '아래 내용을 알려 주시면 바로 고칠 수 있습니다. 게임 데이터는 그대로입니다.'),
          h('pre', { style: 'white-space:pre-wrap;word-break:break-all;font-size:11px;background:#0008;padding:8px;border-radius:8px;max-height:40vh;overflow:auto;' }, info),
          h('div', { className: 'su-more' }, [
            h('button', { className: 'primary', onClick: () => { try { render(); } catch (e2) { /* ignore */ } } }, '🔄 다시 시도'),
            h('button', { onClick: () => { try { navigator.clipboard.writeText(info); } catch (e3) { /* ignore */ } } }, '📋 오류 복사'),
            h('button', { onClick: () => { state = null; sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1' }; render(); } }, '새 게임 (덱 선택으로)'),
          ]),
        ]),
      ]));
    } catch (e4) { /* nothing more we can do */ }
  }
}
// Effect-runner bookkeeping (state._rcDepth = 17-1-2-2 "no rule check while an effect resolves", _fxSrc, _caster) is restored by runScript's finally.
// A run that is parked forever and then orphaned (watchdog retry / replaced game) never gets there: _rcDepth stays >0 and EVERY later rule check
// (DP<=0 deletion, 17-1-3-1) is deferred for the rest of the game (save c8f45ab9: a DP -10000 Magnetdramon lived on). Heal it.
function healLeakedFxState() {
  if (!state || !(state._rcDepth > 0)) return;
  S.log(state, '효과 처리 상태 복구: 멈춘 효과의 잔여 상태를 정리하고 룰체크를 수행합니다');
  state._rcDepth = 0; state._fxSrc = null; state._caster = null; state._fxOp = null; state._fxRec = null;
  try { S.flushLeaves(state); S.flushRuleChecks(state); } catch (e) { /* never block */ }
}
let rcIdleSince = 0;
function healIdleLeak() {
  if (!state || !(state._rcDepth > 0)) { rcIdleSince = 0; return; }
  const idle = !pendingRunner && !state.uiChoice && !attackActive() && !sel.atkQueued && !state.pending.some(t => !t.resolved) && !(state.pendingReplacements || []).length && fxBusyMs() <= 0;
  if (!idle) { rcIdleSince = 0; return; }
  if (!rcIdleSince) { rcIdleSince = Date.now(); setTimeout(() => { if (state) render(); }, 3200); return; }
  if (Date.now() - rcIdleSince > 3000) { rcIdleSince = 0; healLeakedFxState(); }
}
function renderInner() {
  if (!state) return renderSetup();
  // A network GUEST's `state` is a thin mirror assigned wholesale from the host's last broadcast (see
  // netOnState) — never actually driven by this engine locally. Running the same auto-advance/rule-check
  // machinery the HOST runs here would, at best, duplicate work the host already did and re-broadcast, and at
  // worst crash or diverge: the guest's copy is missing real ids for hidden zones (opponent hand/either deck)
  // and `state.pending` entries had their script closures stripped by JSON transit (see docs/netplay-design.md).
  // Only the host (netIntercept()===false path, i.e. Net.NET.role !== 'guest') runs this block.
  if (Net.NET.role !== 'guest') {
    healIdleLeak();
    settleTurnEndIfIdle();
    pumpReplacementPrompt();
    if (state._rcPending && !(state._rcDepth > 0)) S.flushRuleChecks(state); // 17-1-3-1 (rule-oracle): a recorded DP penalty that took effect lazily while no effect was resolving (15-15-5-2) is rule-checked at the next safe point
    if (BREED.auto && state.phase === 'breeding' && state.breedingActionTaken && !busy() && !state.winner) E.nextPhase(state); // setting: leave the breeding phase right after the hatch/move
    E.autoAdvance(state);
    autoRunMandatoryPending();
    // 6-1-4: once memory sits on the opponent's side and there's genuinely
    // nothing left to resolve (no pending effect, no attack/choice in
    // progress), the turn ends immediately — don't wait for a manual "다음
    // 페이즈" click. Checked on every render, so it also catches memory
    // shifted by a card effect (e.g. an "어택 시 메모리 -2" effect) finishing
    // resolution, not just the direct memory-spending actions that already
    // called checkAutoEndTurn themselves.
    if (state.phase === 'main' && !state.pending.length && !attackActive() && !state.uiChoice && !state.turnEnding) {
      if (E.checkAutoEndTurn(state)) { // turn end begun (6-6-1): start resolving its effects / finish right away when none
        settleTurnEndIfIdle();
        E.autoAdvance(state);
        autoRunMandatoryPending();
      }
    }
  }
  // a full rebuild resets scroll positions — remember/restore them (essential on a phone where the board scrolls)
  const prevBoard = app.querySelector('.board');
  const prevScroll = prevBoard ? prevBoard.scrollTop : 0;
  const prevModal = app.querySelector('.modal-panel');
  const prevModalScroll = prevModal ? prevModal.scrollTop : 0;
  app.innerHTML = '';
  jgCache.clear();
  app.classList.toggle('log-open', panelsOpen.log);
  app.classList.toggle('sheet-open', !!(sel.hand || sel.stack));
  try { fxSync(); } catch (e) { console.warn('fxSync', e); } // effect-visibility bookkeeping (queue, ghosts, markers)
  app.appendChild(renderTopbar());
  { const cpuBar = renderCpuBar(); if (cpuBar) app.appendChild(cpuBar); } // vs CPU: status / pause / speed
  app.appendChild(renderBoard());
  app.appendChild(renderActions());
  const breedBar = renderBreedingBar();
  app.classList.toggle('breeding-bar-on', !!breedBar);
  if (breedBar) app.appendChild(breedBar);
  app.appendChild(renderLog());
  const modal = renderModal();
  if (modal) app.appendChild(modal);
  app.classList.toggle('dock-left-open', !!app.querySelector('.dock-left'));
  app.classList.toggle('dock-right-open', !!app.querySelector('.dock-right'));
  const newBoard = app.querySelector('.board');
  if (newBoard && prevScroll) newBoard.scrollTop = prevScroll;
  // vs CPU: at the start of MY turn bring my own area (hand + field) into view once — on small screens it sits below the CPU's board
  if (cpuOn && !PR.isReplay() && newBoard && !state.winner && state.activePlayer !== CPU_P && state.phase && cpuScrollTurn !== state.turnNumber) { cpuScrollTurn = state.turnNumber; newBoard.scrollTop = newBoard.scrollHeight; }
  const newModal = app.querySelector('.modal-panel');
  if (newModal && prevModalScroll) newModal.scrollTop = prevModalScroll;
  const vanishToast = renderVanishToast();
  if (vanishToast) app.appendChild(vanishToast);
  app.appendChild(renderFxLayer());
  try { fxFieldRender(state); } catch (e) { console.warn('fxField', e); } // on-field annotations: re-anchor to the rebuilt tiles
  fxEmit('render', { state }); // VFX overlay: snapshot tile geometry, watch battle log lines, play queued effect animations
  PR.afterRender(); // undo timeline (stable points), auto-save, cheat drawer
}

// deleteStack() (rule-check DP<=0, battle losses, 【소멸】 effects — every
// route a stack can be destroyed through) pushes the destroyed card's name
// here. Consumed once so it only shows for the render right after it
// happened, similar to pl.pendingDrawFlash.
function renderVanishToast() {
  let names = state.pendingVanishFlash || [];
  let srcs = [...new Set(state.pendingVanishSrc || [])];
  if (Net.NET.role === 'guest') { const nv = state.netVanish; names = nv ? nv.names : []; srcs = nv ? nv.srcs : []; state.netVanish = null; }
  else if (Net.NET.role === 'host' && names.length) state.netVanish = { names: [...names], srcs: [...srcs] };
  state.pendingVanishFlash = []; state.pendingVanishSrc = [];
  if (!names.length) return null;
  return h('div', { className: 'vanish-toast' }, `💀 소멸: ${names.join(', ')}` + (srcs.length ? `\n원인: ${srcs.join(', ')}` : ''));
}

function renderTopbar() {
  const pct = ((state.memory + 10) / 20) * 100;
  const bar = h('div', { className: 'gauge-track' }, [
    h('div', { className: 'gauge-mid' }),
    h('div', { className: 'gauge-fill', style: '' }),
  ]);
  bar.querySelector('.gauge-fill').style.left = state.memory >= 0 ? `${50 - state.memory / 20 * 100}%` : '50%';
  bar.querySelector('.gauge-fill').style.width = `${Math.abs(state.memory) / 20 * 100}%`;
  if (state.winner) {
    const why = (state.log.find(e => /승리|패배|투항|무승부/.test(String(e.msg))) || {}).msg || '';
    const head = state.winner === 'draw' ? '게임 종료 — 무승부 (영구 순환, 18-3-2)'
      : cpuOn ? (state.winner === 'p1' ? '🎉 승리! 당신(P1)이 이겼습니다' : '💀 패배… CPU(P2)가 이겼습니다') : Net.NET.role ? (state.winner === Net.NET.mySeat ? '🎉 승리! 당신이 이겼습니다' : '💀 패배… 상대가 이겼습니다') : `게임 종료 — 승자: ${state.winner}`;
    return h('div', { className: 'topbar' }, [h('div', { className: 'topbar-row gameover' }, [
      h('b', {}, head),
      why ? h('span', { className: 'meta gameover-why' }, `사유: ${String(why).replace(/^🤖 CPU: /, '')}`) : null,
      (Net.NET.role === 'guest') ? null : (lastStartPick && lastStartPick.p1 && lastStartPick.p2) ? h('button', { className: 'primary', title: '같은 덱으로 바로 다시 시작 (CPU 강도도 그대로)', onClick: () => { restartHand(); } }, '🔁 같은 덱으로 재대전') : null,
      (Net.NET.role === 'guest') ? null : h('button', { className: lastStartPick ? '' : 'primary', onClick: () => { state = null; sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1' }; render(); } }, '새 게임 (덱 선택으로)'),
      PR.topbarButtons(),
    ])]);
  }
  const mainRow = h('div', { className: 'topbar-row' }, [
    h('b', {}, `턴 ${state.turnNumber}`),
    h('span', {}, `활성: ${state.activePlayer}`),
    h('span', {}, `페이즈: ${PHASE_LABEL[state.phase] || state.phase}`),
    bar,
    mbSummary(h, { turn: state.turnNumber, player: state.activePlayer.toUpperCase(), phase: PHASE_LABEL[state.phase] || state.phase, memory: state.memory }),
    h('span', { className: 'mem-top' + (state.memory > 0 ? ' plus' : state.memory < 0 ? ' minus' : '') }, `메모리 ${state.memory > 0 ? '+' : ''}${state.memory}`),
    h('button', { className: state.phase === 'main' ? 'mb-hide-m' : '', disabled: state.phase === 'main' || cpuTurnView(), title: state.phase === 'main' ? '메인 페이즈는 패스로만 끝낼 수 있음 (룰 6-5-1-7)' : '', onClick: () => { if (netIntercept('skipBreeding', [])) return; if (blockIfBusy()) return; E.nextPhase(state); render(); } }, '다음 페이즈 ▶'),
    h('button', {
      className: 'danger' + (state.phase !== 'main' ? ' mb-hide-m' : ''), disabled: state.phase !== 'main' || cpuTurnView(),
      onClick: () => { if (netIntercept('pass', [])) return; if (blockIfBusy()) return; if (passNeedsConfirm()) return; E.declarePass(state); render(); },
    }, ['패스', passArmed() ? h('span', { className: 'pass-warn' }, ` ⚠ 지금 낼 수 있는 카드 ${passFreeCount()}장 — 한 번 더 누르면 패스`) : h('span', { className: 'lbl-long' }, ' (메모리 상대측 3으로 고정하고 턴종료)')]),
    h('div', { className: 'mb-drawer' }, [
      PR.topbarButtons(),
      ...['p1', 'p2'].filter(pp => !isCpuSide(pp) && (!Net.NET.role || pp === Net.NET.mySeat)).map(pp => h('button', { title: '투항: 즉시 패배 (룰 1-2-4, 효과는 유발하지 않음)', onClick: async () => {
        // 온라인 대전: 내 자리만 투항할 수 있고, 게스트는 호스트에게 의도만 보낸다 (확인창은 게스트 화면이 상태 수신으로 덮어써질 수 있어 브라우저 confirm 사용)
        const ok = Net.NET.role ? window.confirm(`${pp.toUpperCase()} 투항하시겠습니까?`) : await ctxChoose('confirmEffect', { player: pp, prompt: `${pp.toUpperCase()} 투항하시겠습니까?`, yesLabel: '투항한다', noLabel: '취소' });
        if (!ok) return;
        if (netIntercept('surrender', [])) return;
        E.surrender(state, pp); render();
      } }, `🏳 ${pp.toUpperCase()} 투항`)),
      h('label', { className: 'mb-only' }, [
        h('input', { type: 'checkbox', checked: BREED.auto, onchange: (e) => { BREED.auto = !!e.target.checked; try { localStorage.setItem('digimon_breed_auto', BREED.auto ? '1' : '0'); } catch (err) { /* ignore */ } render(); } }),
        ' 육성 페이즈 자동 넘김',
      ]),
    ]),
    mbMenuButton(app, h),
  ]);
  const rows = [mainRow];
  // Selected-card info (including 진화원효과) lives here — part of the
  // topbar's own normal layout flow, so it can never float on top of a
  // board drag target the way a fixed-position overlay could.
  const infoText = describeSelectedEffects();
  if (infoText) {
    const selStack = findStack(sel.stack);
    rows.push(h('div', { className: 'topbar-info' }, [
      h('div', { className: 'topbar-info-text', onClick: (e) => e.currentTarget.classList.toggle('open') }, infoText),
      h('div', { className: 'info-actions' }, [
        ...selectionActionButtons(),
        h('button', { className: 'info-close', onClick: () => { sel.hand = null; sel.stack = null; sel.stack2 = null; render(); } }, '✕'),
      ]),
    ]));
  }
  return h('div', { className: 'topbar' }, rows);
}

// Selection action bar (touch-friendly; also fine on desktop): what the selected hand card / own stack can do.
function selectionActionButtons() {
  const out = [];
  if (busy()) return out;
  if (sel.hand && handPlayable(sel.hand.player)) {
    const p = sel.hand.player, hcid = state.players[p].hand[sel.hand.idx], dualC = S.isDual(hcid), cat = S.card(hcid).category;
    out.push(h('button', { className: 'primary', title: dualC ? '듀얼 카드: 옵션 쪽으로 사용 (사용 후 《아츠 진화》 가능). 디지몬 쪽으로 진화하려면 카드를 고른 뒤 진화시킬 디지몬을 탭/드래그' : '', onClick: () => { const hi = sel.hand.idx; sel.hand = null; doPlayFromHand(p, hi); } }, (cat === 'option' || dualC) ? (dualC ? '▶ 옵션으로 사용' : '▶ 사용') : '▶ 등장'));
    // 조그레스: a hand card with a 〔조그레스〕 line gets its own obvious action (a disabled-looking one still explains itself when tapped)
    const jinfo = cat === 'digimon' ? jogressInfo(p, state.players[p].hand[sel.hand.idx]) : null;
    if (jinfo) {
      const hc = state.players[p].hand[sel.hand.idx], n = jinfo.pairs.length;
      out.push(h('button', { className: 'jg-btn' + (n ? '' : ' jg-none'), title: `〔조그레스〕 ${jinfo.cond}`, onClick: () => openJogress(p, hc, null) }, n ? `🧬 조그레스 진화 (${n}조합)` : '🧬 조그레스 (재료 없음)'));
    }
  }
  const st = findStack(sel.stack);
  if (st && sel.stack.player === state.activePlayer && state.phase === 'main') {
    const p = sel.stack.player;
    if (sel.stack.zone === 'battle' && !st.suspended && S.card(st.cardId).category === 'digimon') {
      let can = false;
      try { can = S.canAttackPlayer(state, p, st.uid) || S.legalDigimonTargets(state, p, st.uid).length > 0; } catch (e) { can = false; }
      out.push(h('button', { className: 'danger', disabled: !can, title: '공격 대상 목록을 엽니다 (또는 보드의 빨간 테두리 대상을 직접 탭)', onClick: () => { const u = st.uid; sel.stack = null; attackFlow(p, u); } }, '⚔ 공격'));
    }
    if (sel.stack.zone === 'battle' && S.card(st.cardId).category === 'digimon') { // board-first start: which hand cards could fuse this Digimon?
      const cands = [...new Set(state.players[p].hand)].filter(id => jogressInfo(p, id)?.pairs.some(pr => pr.top.uid === st.uid || pr.bottom.uid === st.uid));
      if (cands.length) {
        out.push(h('span', { className: 'jg-hint' }, `🧬 조그레스 가능: ${cands.map(id => S.card(id).nameDisplayKo || S.card(id).nameKo).join(', ')}`));
        for (const id of cands) out.push(h('button', { className: 'jg-btn', onClick: () => openJogress(p, id, st.uid) }, `🧬 ${S.card(id).nameDisplayKo || S.card(id).nameKo}`));
      }
    }
    for (const a of stackActionList(p, st, sel.stack.zone)) out.push(h('button', { disabled: a.disabled, title: a.title, onClick: () => a.run() }, a.label));
  }
  return out;
}

function cardChip(cardId, opts = {}) {
  const c = S.card(cardId);
  const cls = ['card-chip'];
  if (opts.selected) cls.push('selected');
  if (opts.suspended) cls.push('suspended');
  if (opts.attackable) cls.push('attackable');
  if (opts.target) cls.push('tap-target');
  if (opts.jogress) cls.push('jogress-mat');
  if (opts.justDrawn) cls.push('just-drawn');
  if (opts.hint) cls.push(opts.hint.cls);
  // Show the LIVE effective DP (temp/inherited/turn-conditional modifiers
  // all folded in — see S.effectiveDP) rather than always the static
  // printed value, so buffs/debuffs from this session's many DP-modifying
  // effects actually show up somewhere instead of only affecting battle
  // math invisibly. Only for cards that print a DP stat at all (Tamers/
  // Options have none) — effectiveDP would otherwise return a bare 0.
  const dpModified = c.dp && opts.effectiveDp != null && opts.effectiveDp !== c.dp;
  const dpNode = c.dp
    ? h('span', { className: dpModified ? (opts.effectiveDp > c.dp ? 'dp-buffed' : 'dp-debuffed') : '' },
        dpModified ? `DP${c.dp}→${opts.effectiveDp}` : `DP${c.dp}`)
    : null;
  const metaParts = [c.level ? `Lv.${c.level}` : c.category, dpNode, opts.showId ? cardId : (c.cost != null ? `C${c.cost}` : null)].filter(x => x != null); // 덱 빌더: 'C7' 대신 카드 번호
  const metaChildren = metaParts.flatMap((part, i) => i === 0 ? [part] : [' · ', part]);
  const attrs = { className: cls.join(' '), onClick: opts.onClick };
  if (opts.hint && opts.hint.title) attrs.title = opts.hint.title;
  if (opts.draggable) {
    attrs.draggable = true;
    attrs.ondragstart = (e) => { dragData = opts.dragPayload; e.target.classList.add('dragging'); };
    attrs.ondragend = (e) => { e.target.classList.remove('dragging'); };
  }
  if (opts.onDrop) {
    attrs.ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); };
    attrs.ondragleave = (e) => { e.currentTarget.classList.remove('drop-hover'); };
    attrs.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-hover'); opts.onDrop(dragData); };
  }
  const artSrc = opts.art || (opts.owner ? S.artUrl(state, opts.owner, cardId) : null) || c.imgUrl;
  return h('div', attrs, [
    artSrc ? artImg(artSrc, c.imgUrl, { alt: c.nameKo, loading: 'lazy' }) : null,
    opts.parBadge ? h('span', { className: 'par-badge', title: '패러렐(대체 일러스트)' }, '패러렐') : null,
    opts.parCount ? h('span', { className: 'par-count', title: `패러렐 ${opts.parCount}종` }, `🎨×${opts.parCount}`) : null,
    h('div', { className: 'nm' }, c.nameDisplayKo || c.nameKo),
    h('div', { className: 'meta' }, metaChildren),
    opts.keywordBadges?.length ? h('div', { className: 'keyword-badges' }, opts.keywordBadges.map(k => h('span', { className: 'kw-badge' }, k))) : null,
    opts.sourcesCount ? h('div', { className: 'stack-src' }, `진화원 ${opts.sourcesCount}장`) : null,
    opts.deckCount ? h('div', { className: 'stack-src' }, `${opts.deckCount}장 투입`) : null,
  ]);
}

// Short labels for every keyword this session's many systems can actually
// grant a stack — shown on the card chip itself instead of only affecting
// game logic invisibly, same motivation as showing effectiveDp: none of
// these ever appeared anywhere on the board before.
const KEYWORD_BADGE_LABEL = {
  블로커: '🛡블로커', 재밍: '🌀재밍', 관통: '🗡관통', 재기동: '🔄재기동',
  속공: '⚡속공', 진격: '⚔진격', 길동무: '🤝길동무', 방벽: '🧱방벽', 아머퍼지: '🛡아머퍼지', 회피: '💨회피', 스케이프고트: '🐐스케이프고트', 불굴: '🔥불굴', 돌진: '🐗돌진', 연계: '🔗연계', 빙장: '🧊빙장', 트레이닝: '🏋트레이닝', 프래그먼트: '🧩프래그먼트', DP감소무효: '🚫DP감소무효',
  무진화원액티브공격: '🎯무진화원액티브공격', 액티브공격: '🎯액티브공격',
  수호: '🛡수호', 급습: '🗡급습', 프로그레스: '⏩프로그레스',
};
function activeKeywordBadges(stack) {
  const badges = [];
  const seen = new Set();
  for (const src of [stack.keywords, stack.inheritedKeywords]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (!v || seen.has(k)) continue;
      seen.add(k);
      if (k === '시큐리티어택') badges.push(`S어택+${v}`);
      else if (KEYWORD_BADGE_LABEL[k]) badges.push(KEYWORD_BADGE_LABEL[k]);
    }
  }
  return badges;
}

// Shared by the desktop drop handler AND the tap flow (doEvolve/doFuse): a hand card (or, for attacks, an
// opposing stack) being "dropped" on `stack`. Everything the drop did lives here so a tap does exactly the same.
async function handleStackDrop(p, stack, zoneKind, drag) {
  if (!drag) return;
  if (netIntercept('stackDrop', [p, stack.uid, zoneKind, drag])) return; // drag-drop evolve/attack — see doEvolve/attackFlow for the tap-flow equivalents
  // An opposing battle stack dropped directly onto this one is a direct
  // attack declaration on THIS specific digimon — no separate target-
  // choice menu needed, the drop location already said which target.
  if (drag.kind === 'stack' && drag.player !== p && drag.zone === 'battle' && zoneKind === 'battle') {
    attackFlow(drag.player, drag.uid, stack.uid);
    dragData = null; render();
    return;
  }
  if (drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main' || S.card(drag.cardId).category !== 'digimon') return;
  if (blockIfBusy()) return;
  // 조그레스 (8-2): a hand card with a printed 〔조그레스〕 line dropped/tapped on a battle Digimon opens the jogress modal
  // (pairs containing that Digimon pre-selected) — or explains why it can't (or asks which method if normal evolution also fits).
  if (zoneKind === 'battle' && S.parseJogress(drag.cardId)) {
    jgCache.clear();
    const info = jogressInfo(p, drag.cardId);
    const withStack = !!info && info.pairs.some(pr => pr.top.uid === stack.uid || pr.bottom.uid === stack.uid);
    let canNormal = false;
    try {
      const r0 = S.evolveTargetRestriction(state, p, stack), x0 = S.evoExtraArg(state, p, stack);
      canNormal = ['digimon', 'tamer'].includes(S.card(stack.cardId).category) && (E.evolutionMethods(stack.cardId, drag.cardId, x0, r0, { state, p, stack }).length > 0 || E.canEvolveAny(stack.cardId, drag.cardId, x0, r0).ok);
    } catch (e) { canNormal = false; }
    if (withStack) {
      if (canNormal) {
        const pick = await ctxChoose('multipleChoice', { player: p, prompt: `${S.card(drag.cardId).nameKo}: 일반 진화와 조그레스 진화가 모두 가능합니다. 어느 쪽으로 진화하시겠습니까?`, options: ['일반 진화', '🧬 조그레스 진화', '취소'] });
        if (pick === 1) { dragData = null; openJogress(p, drag.cardId, stack.uid); return; }
        if (pick !== 0) { dragData = null; render(); return; }
        // pick === 0: fall through to normal evolution
      } else { dragData = null; openJogress(p, drag.cardId, stack.uid); return; }
    } else if (!canNormal) {
      dragData = null; render(); showToast(jogressReason(p, drag.cardId));
      return;
    }
  }
  // canEvolveAny checks evoNormal AND every special "〔진화〕 <이름/특징>"
  // line on the target — a failure here means NO printed condition
  // justifies this evolution, so the drop must be rejected outright
  // rather than silently let through for cost 0.
  if (!['digimon', 'digitama'].includes(S.card(stack.cardId).category) && !(S.card(stack.cardId).category === 'tamer' && E.evolutionMethods(stack.cardId, drag.cardId, S.evoExtraArg(state, p, stack), S.evolveTargetRestriction(state, p, stack), { state, p, stack }).length)) { S.log(state, `${p} 진화 거부: ${S.card(stack.cardId).nameKo}는 디지몬이 아님 (8-1-1)`); dragData = null; render(); return; }
  // 8-1-2-1 / 8-1-3-1: the PLAYER picks which way to evolve (every satisfied printed condition, 버스트 진화, 어플 합체, effect-granted alternatives).
  const evoRestr = S.evolveTargetRestriction(state, p, stack);
  const methods = E.evolutionMethods(stack.cardId, drag.cardId, S.evoExtraArg(state, p, stack), evoRestr, { state, p, stack });
  let check = methods.length ? { ok: true } : E.canEvolveAny(stack.cardId, drag.cardId, S.evoExtraArg(state, p, stack), evoRestr);
  let method = methods[0] || null;
  if (method && (methods.length > 1 || method.sideEffect)) {
    const mDelta = S.previewEvoCostDelta(state, p, stack, drag.cardId);
    const options = methods.map((m, i) => `${i + 1}. ${m.label}${m.conditionText ? ` (${m.conditionText})` : ''} — 기본 코스트 ${m.baseCost}, 효과 반영 후 ${Math.max(0, m.baseCost + mDelta)}`);
    const pick = await ctxChoose('multipleChoice', { player: p, prompt: `${p}: ${S.card(stack.cardId).nameKo} → ${S.card(drag.cardId).nameKo} — 진화 방법을 선택하세요 (룰 8-1-2-1)`, options: [...options, '취소'] });
    if (pick == null || pick < 0 || pick >= methods.length) { S.log(state, `${p} 진화 취소`); dragData = null; render(); return; }
    method = methods[pick];
  }
  if (method) check = { ok: true, cost: method.baseCost, raw: method.conditionText };
  const special = method && (method.kind === 'burst' || method.kind === 'app') ? method.kind : null;
  if (special) {
    const evoSnap2 = S.snapshotEvoCostMods(state, p);
    const burst = method, baseCost = method.baseCost;
    const cost2 = Math.max(0, baseCost + S.consumeEvoCostMod(state, p, drag.cardId) + S.continuousEvoCostDiscount(state, p, stack, drag.cardId) + S.hookEvoCostDiscount(state, p, stack, drag.cardId)); // 8-3-2-3 / 8-4-2-3
    let tUid = null;
    if (special === 'burst' && burst.tamerUids.length > 1) { tUid = await ctxChoose('pickStack', { player: p, uids: burst.tamerUids, required: true, prompt: '《버스트 진화》 — 패로 되돌릴 자신의 테이머를 선택하세요' }) || burst.tamerUids[0]; }
    const res = special === 'burst' ? S.burstEvolve(state, p, stack.uid, drag.cardId, cost2, tUid) : S.appFusion(state, p, stack.uid, drag.cardId, cost2);
    if (!res) S.restoreEvoCostMods(evoSnap2);
    E.checkAutoEndTurn(state);
    dragData = null; render();
    return;
  }
  if (!check.ok) {
    S.log(state, `${p} 진화 조건 불일치로 거부: ${S.card(stack.cardId).nameKo} → ${S.card(drag.cardId).nameKo} (${check.reason})`);
    dragData = null; render();
    return;
  }
  const evoSnap = S.snapshotEvoCostMods(state, p); // a rejected evolution must not burn the one-time discount
  let evoModDelta = S.consumeEvoCostMod(state, p, drag.cardId) + S.continuousEvoCostDiscount(state, p, stack, drag.cardId);
  evoModDelta += S.hookEvoCostDiscount(state, p, stack, drag.cardId);
  evoModDelta += S.s1EvoAuto(state, p, stack, drag.cardId); // shard1
  for (const o of S.s1EvoOptions(state, p, stack, drag.cardId)) { if (await askYN(p, o.label)) evoModDelta += await o.apply(ctxChoose) || 0; }
  for (const o of S.hookEvoCostOptions(state, p, stack, drag.cardId)) { if (await askYN(p, o.label)) evoModDelta += await o.apply(ctxChoose) || 0; }
  if (state._evoAbort) { state._evoAbort = false; S.restoreEvoCostMods(evoSnap); S.log(state, `${p} 진화 실패: 진화하려던 디지몬이 효과로 소멸함 (진화 코스트 지불 없음)`); dragData = null; render(); return; } // EX2-064 (Q3350)
  const absorb = S.absorbEvolveOption(state, p, stack, drag.cardId);
  if (absorb && absorb.candidates.length && await askYN(p, `《흡수진화》 — 다른 액티브 디지몬 1마리를 레스트시켜 진화 코스트 ${absorb.delta}?`)) {
    // the player picks WHICH active Digimon is rested (8-x 《흡수진화》)
    const au = absorb.candidates.length > 1 ? await ctxChoose('pickStack', { player: p, uids: absorb.candidates, required: true, prompt: '《흡수진화》 — 레스트시킬 자신의 액티브 디지몬을 선택하세요' }) : absorb.candidates[0];
    S.restStack(state, p, au || absorb.candidates[0]);
    evoModDelta += absorb.delta;
  } else if (absorb && absorb.oppCandidates && absorb.oppCandidates.length && await askYN(p, `《흡수진화》 — 상대의 액티브 디지몬 1마리를 레스트시켜 진화 코스트 ${absorb.delta}?`)) {
    const ou = absorb.oppCandidates.length > 1 ? await ctxChoose('pickStack', { player: S.opponentOf(p), uids: absorb.oppCandidates, required: true, prompt: '《흡수진화》 — 레스트시킬 상대의 액티브 디지몬을 선택하세요' }) : absorb.oppCandidates[0];
    S.restStack(state, S.opponentOf(p), ou || absorb.oppCandidates[0]); // shard1 (BT3-056)
    evoModDelta += absorb.delta;
  }
  const cost = Math.max(0, check.cost + evoModDelta);
  if (method && method.id === 'tamer10') { // BT7-112: pay "패 또는 트래시에서 테이머/하이브리드체 카드 N장을 (원하는 순서대로) 덱 아래로 되돌린다" before digivolving
    if (!S.canPayCost(state, cost)) { S.log(state, `${p} ${S.card(drag.cardId).nameKo} 진화 불가: 코스트 ${cost}를 지불할 수 없음`); S.evolveAttempt(state, p, stack, drag.cardId); S.restoreEvoCostMods(evoSnap); dragData = null; render(); return; }
    const plR = state.players[p], okR = (id) => S.card(id).category === 'tamer' || (S.card(id).types || []).includes(method.returnTrait);
    const elig = (z) => plR[z].map((id, i) => i).filter(i => okR(plR[z][i]) && !(z === 'hand' && plR.hand[i] === drag.cardId && i === plR.hand.indexOf(drag.cardId)));
    for (let k = 0; k < method.returnN; k++) {
      const zs = ['hand', 'trash'].filter(z => elig(z).length);
      if (!zs.length) break;
      let z = zs[0];
      if (zs.length > 1) { const kz = await ctxChoose('multipleChoice', { player: p, prompt: `덱 아래로 되돌릴 카드 (${k + 1}/${method.returnN}) — 영역`, options: zs.map(x => (x === 'hand' ? '패' : '트래시')) }); z = zs[kz] || zs[0]; }
      const ix = await ctxChoose('pickFromZoneIndex', { player: p, zone: z, eligibleIdxs: elig(z), prompt: `덱 아래로 되돌릴 테이머/하이브리드체 카드 (${k + 1}/${method.returnN}, 놓는 순서)` });
      const [rid] = plR[z].splice(ix ?? elig(z)[0], 1);
      plR.deck.push(rid);
      S.log(state, `${p} ${S.card(rid).nameKo}을(를) 덱 아래로 되돌림 (${S.card(drag.cardId).nameKo} 진화 코스트)`);
    }
  }
  state._evoTamerDirect = !!(method && method.id !== 'tamer-as-digimon' && method.id !== 'tamer10' && S.card(stack.cardId).category === 'tamer'); // QA-S6 Q6583: printed condition on a Tamer = direct evolution (no digimon-evolve events)
  const evoRes = S.digivolve(state, p, stack.uid, drag.cardId, cost, 'hand'); state._evoTamerDirect = false;
  if (!evoRes) S.restoreEvoCostMods(evoSnap);
  E.checkAutoEndTurn(state);
  dragData = null; render();
}
function handDrag(p, idx) { const cardId = state.players[p].hand[idx]; return cardId == null ? null : { kind: 'hand', player: p, idx, cardId }; }
// Tap-flow entry points (same code path as the drops).
const doEvolve = (p, stackUid, handIdx) => { if (netIntercept('evolve', [p, stackUid, handIdx])) return; const st = findStack({ player: p, uid: stackUid }); const d = handDrag(p, handIdx); return st && d ? handleStackDrop(p, st, state.players[p].raising?.uid === st.uid ? 'raising' : 'battle', d) : undefined; };
const doPlayFromHand = (p, handIdx) => { if (netIntercept('play', [p, handIdx])) return; return playFreshFromDrag(handDrag(p, handIdx), p); };

// Shared by the 🔗 badge drop AND the badge tap (hand card or another battle stack → link onto `stack`).
async function handleLinkDrop(p, stack, drag) {
  if (netIntercept('linkDrop', [p, stack.uid, drag])) return; // 온라인 게스트: 링크(패/배틀 → 🔗 배지)는 호스트가 실행
  // 6-5-1-4-1: a Digimon standing in the battle area can be linked to another Digimon too (drag its stack onto the 🔗 badge).
  if (drag && drag.kind === 'stack' && drag.zone === 'battle' && drag.player === p && drag.uid !== stack.uid && p === state.activePlayer && state.phase === 'main') {
    if (blockIfBusy()) return;
    const src = findStack({ player: p, uid: drag.uid });
    const lk2 = src ? S.linkCheck(state, p, stack, src.cardId) : { ok: false, reason: '카드 없음' };
    if (!lk2.ok) { S.log(state, `${p} 링크 거부: ${src ? S.card(src.cardId).nameKo : '?'} → ${S.card(stack.cardId).nameKo} (${lk2.reason})`); dragData = null; render(); return; }
    S.linkFromBattle(state, p, drag.uid, stack.uid, Math.max(0, lk2.cost + (S.s7LinkCostDelta ? S.s7LinkCostDelta(state, p, stack, src.cardId) : 0)));
    E.checkAutoEndTurn(state);
    dragData = null; render();
    return;
  }
  if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
  if (blockIfBusy()) return; // 6-5-1: no link while something is unresolved
  if (blockIfBusy()) return;
  const lk = S.linkCheck(state, p, stack, drag.cardId);
  if (!lk.ok) { S.log(state, `${p} 링크 거부: ${S.card(drag.cardId).nameKo} → ${S.card(stack.cardId).nameKo} (${lk.reason})`); dragData = null; render(); return; }
  dragData = null;
  const lcost = Math.max(0, lk.cost + (S.s7LinkCostDelta ? S.s7LinkCostDelta(state, p, stack, drag.cardId) : 0));
  const dIdx = await S.linkDiscardIdx(state, p, stack.uid, ctxChoose); // 4-9-5: the player picks which old link card goes
  S.linkCardTo(state, p, stack.uid, drag.cardId, drag.cardId, lcost, 'hand', dIdx);
  E.checkAutoEndTurn(state);
  render();
}
// The per-stack activated actions (≪딜레이≫ / ≪트레이닝≫ / 【메인】): descriptors shared by the little overlay buttons on
// the card (desktop) and the selection action bar (touch). Same handlers as before — only relocated.
function stackActionList(p, stack, zoneKind) {
  const out = [];
  // 16-17 ≪딜레이≫: this placed card can be discarded (from turns after the one it was placed on) to run its listed
  // bullet effect, rerouted through state.pending like every other triggered effect.
  const delayBody = zoneKind === 'battle' ? S.parseDelayEffect(S.card(stack.cardId).effectKo) : null;
  if (delayBody && p === state.activePlayer && state.phase === 'main' && state.turnNumber > stack.placedTurn) {
    out.push({ kind: 'delay', label: '🗑딜레이', title: `《딜레이》 발동: ${delayBody}`, run: () => {
      if (netIntercept('useDelay', [p, stack.uid])) return;
      if (blockIfBusy()) return;
      const cardId = S.discardForDelay(state, p, stack.uid);
      if (cardId) state.pending.push({ uid: 'delay' + Math.random().toString(36).slice(2), player: p, cardId, stackUid: null, tags: ['메인'], text: delayBody, resolved: false });
      render();
    } });
  }
  // ≪트레이닝≫ — activated main-phase ability (also usable from the raising area).
  if ((zoneKind === 'battle' || zoneKind === 'raising') && p === state.activePlayer && state.phase === 'main'
    && S.hasKeyword(stack, '트레이닝') && !stack.suspended && state.players[p].deck.length > 0) {
    out.push({ kind: 'train', label: '🏋트레이닝', title: '《트레이닝》 — 이 디지몬을 레스트시키고 덱 위 1장을 진화원 아래에 놓음', run: () => { if (netIntercept('train', [p, stack.uid])) return; if (blockIfBusy()) return; S.useTraining(state, p, stack.uid); render(); } });
  }
  // Activated 【메인】 abilities printed on Digimon/Tamer cards (incl. 《디지버스트》).
  const mainAbilities = (zoneKind === 'battle' || zoneKind === 'raising') ? S.activatableMainAbilities(state, p, stack, zoneKind) : [];
  mainAbilities.forEach((ab, i) => {
    const payable = Effects.mainAbilityPayable(state, S, p, stack.uid, ab.cardId, ab.tags, ab.text);
    out.push({ kind: 'main', label: mainAbilities.length > 1 ? `⚡메인${i + 1} · ${S.card(ab.cardId).nameKo}${ab.cardId === stack.cardId ? '' : '(진화원)'}` : '⚡메인', disabled: !payable, // 여러 개일 때 어느 카드의 효과인지(진화원 효과 포함) 이름으로 구분 // 15-8-4-4-1
      title: `【메인】 ${ab.text.replace(/\n/g, ' ')}${payable ? '' : ' — 처리 조건(비용)을 지금 실행할 수 없어 발동을 선언할 수 없음 (룰 15-8-4-4-1)'}`,
      run: () => {
        if (netIntercept('useMain', [p, stack.uid, i])) return;
        if (blockIfBusy()) return;
        if (!Effects.mainAbilityPayable(state, S, p, stack.uid, ab.cardId, ab.tags, ab.text)) { S.log(state, '처리 조건을 실행할 수 없어 발동을 선언할 수 없음 (룰 15-8-4-4-1)'); render(); return; }
        state.pending.push({ uid: 'main' + Math.random().toString(36).slice(2), player: p, cardId: ab.cardId, stackUid: stack.uid, tags: ab.tags, text: ab.text, resolved: false });
        render();
      } });
  });
  return out;
}

// ---- 조그레스 (DNA 진화, 룰 8-2) UI ----
// One modal ("X + Y → Z", every legal pair) is the single entry: opened from the info-panel button, from tapping/dropping the
// hand card on a material, or from a selected material's action bar. Legality/cost come from the SAME S.canJogress /
// S.previewEvoCostDelta the engine path (runJogress → S.fuseStacks) uses.
let jogressModal = null; // { player, cardId, preUid, showAll } — UI only
const jgCache = new Map(); // per-render memo of jogressInfo
function showToast(msg) {
  if (state) S.log(state, msg); // (the deck builder has no game state)
  const el = h('div', { className: 'ui-toast', role: 'alert' }, msg);
  app.appendChild(el);
  setTimeout(() => el.remove(), Math.max(4200, readMs(msg, 3000, 12000)));
}
const jogressCond = (cardId) => { const l = (S.card(cardId).effectKo || '').split('\n').find(x => /〔조그레스〕/.test(x)); return l ? l.replace(/^.*?〔조그레스〕\s*/, '').trim() : ''; };
// -> null (no printed jogress line / not a digimon) | { cond, pairs:[{top,bottom,base,delta,cost,ok}], restricted }
function jogressInfo(p, cardId) {
  const key = p + '|' + cardId;
  if (jgCache.has(key)) return jgCache.get(key);
  let out = null;
  try {
    const jg = S.card(cardId).category === 'digimon' ? S.parseJogress(cardId) : null;
    if (jg) {
      const bat = state.players[p].battle.filter(s => S.card(s.cardId).category === 'digimon');
      const pairs = []; let restricted = null;
      for (let i = 0; i < bat.length; i++) for (let j = i + 1; j < bat.length; j++) {
        const a = bat[i], b = bat[j];
        if (!S.canJogress(a, b, cardId).ok) continue;
        const rr = [a, b].map(s => E.evoRestrictionCheck(cardId, S.evolveTargetRestriction(state, p, s))).find(r => !r.ok);
        if (rr) { restricted = rr.reason; continue; }
        // 8-2-2-2: the material written on the LEFT of the 〔조그레스〕 condition ends up on top (same rule as S.fuseStacks)
        const ca = S.card(a.cardId), cb = S.card(b.cardId);
        const aTop = (jg.left(ca) && jg.right(cb)) || !(jg.left(cb) && jg.right(ca));
        const [top, bottom] = aTop ? [a, b] : [b, a];
        const delta = S.previewEvoCostDelta(state, p, S.jogressCostStack(a, b), cardId); // (Q3387/3388: one evolution, source-less material counts)
        const cost = Math.max(0, jg.cost + delta);
        pairs.push({ top, bottom, base: jg.cost, delta, cost, ok: S.canPayCost(state, cost) });
      }
      out = { cond: jogressCond(cardId), pairs, restricted, matCount: bat.length };
    }
  } catch (e) { out = null; }
  jgCache.set(key, out);
  return out;
}
function jogressReason(p, cardId) {
  const info = jogressInfo(p, cardId);
  if (!info) return '이 카드에는 조그레스 조건이 없음';
  if (info.restricted) return `조그레스 불가: ${info.restricted}`;
  if (info.matCount < 2) return `재료 부족: 배틀 에어리어에 디지몬 2장이 필요함 (${info.cond})`;
  return `재료가 조건에 맞지 않음: ${info.cond}`;
}
function jogressMatUids() { // own battle digimon that could be a material for the selected hand card
  const out = new Set();
  if (!sel.hand || sel.hand.player !== state.activePlayer || state.phase !== 'main' || busy()) return out;
  const hc = state.players[sel.hand.player].hand[sel.hand.idx];
  const info = hc != null ? jogressInfo(sel.hand.player, hc) : null;
  if (info) for (const pr of info.pairs) { out.add(pr.top.uid); out.add(pr.bottom.uid); }
  return out;
}
function openJogress(p, cardId, preUid) {
  jgCache.clear();
  if (blockIfBusy()) return;
  if (p !== state.activePlayer || state.phase !== 'main') { render(); showToast('조그레스는 자신의 메인 페이즈에만 할 수 있음'); return; }
  const info = jogressInfo(p, cardId);
  if (!info || !info.pairs.length) { render(); showToast(jogressReason(p, cardId)); return; }
  jogressModal = { player: p, cardId, preUid: preUid || null, showAll: false };
  render();
}
// The one engine path (rule 8-2): validate → cost incl. evolve-cost modifiers (8-2-2-5) → S.fuseStacks (stacking order 8-2-2-2, attack cleanup).
async function runJogress(p, uidA, uidB, cardId) {
  if (netIntercept('jogress', [p, uidA, uidB, cardId])) return false;
  const stA = findStack({ player: p, uid: uidA }), stB = findStack({ player: p, uid: uidB });
  if (!stA || !stB || !state.players[p].hand.includes(cardId)) return false;
  const jr = S.canJogress(stA, stB, cardId);
  if (!jr.ok) { S.log(state, `${p} ${S.card(cardId).nameKo} 조그레스 거부: ${S.card(stA.cardId).nameKo}+${S.card(stB.cardId).nameKo} (${jr.reason})`); return false; }
  // 8-2-3-2 / 8-2-2-5: pay the printed jogress cost, adjusted by evolve-cost effects (falls back to the manual input only for unparsed lines).
  const evoSnap = S.snapshotEvoCostMods(state, p); // a rejected jogress must not burn the one-time discount
  let jcost = jr.cost != null ? jr.cost : Number(val('costInput')) || 0;
  if (jr.cost != null) { const cs = S.jogressCostStack(stA, stB); jcost = Math.max(0, jcost + S.consumeEvoCostMod(state, p, cardId) + S.continuousEvoCostDiscount(state, p, cs, cardId) + S.hookEvoCostDiscount(state, p, cs, cardId)); } // slice3 r2 Q3387/3388: a source-less material makes the (single) jogress evolution count as source-less
  const res = S.fuseStacks(state, p, uidA, uidB, cardId, jcost, 'hand');
  if (!res) S.restoreEvoCostMods(evoSnap);
  E.checkAutoEndTurn(state);
  return !!res;
}
function renderJogressModal() {
  const m = jogressModal;
  if (!m) return null;
  if (Net.NET.role && m.player !== Net.NET.mySeat) return null; // 온라인: 상대 자리의 조그레스 창은 내 화면에 띄우지 않는다
  const p = m.player, info = jogressInfo(p, m.cardId);
  if (!info || !info.pairs.length || state.activePlayer !== p || state.phase !== 'main' || !state.players[p].hand.includes(m.cardId)) { jogressModal = null; return null; }
  const pre = m.preUid ? info.pairs.filter(x => x.top.uid === m.preUid || x.bottom.uid === m.preUid) : [];
  const filtered = pre.length > 0 && pre.length < info.pairs.length && !m.showAll;
  const shown = filtered ? pre : info.pairs;
  const nm = (id) => S.card(id).nameDisplayKo || S.card(id).nameKo;
  const memAfter = (cost) => Math.max(-10, Math.min(10, state.memory + (p === 'p1' ? -cost : cost)));
  const fmt = (n) => (n > 0 ? '+' : '') + n;
  const posOf = (uid) => { const bl = state.players[p].battle; const i = bl.findIndex(x => x.uid === uid); return i >= 0 ? `배틀 ${i + 1}번째` : (state.players[p].raising && state.players[p].raising.uid === uid ? '육성' : '?'); };
  const stInfo = (st) => `${posOf(st.uid)} · 진화원 ${st.sources.length}장 · ${st.suspended ? '레스트' : '액티브'} · DP ${S.effectiveDP(state, p, st)}`;
  const srcNames = (st) => st.sources.length ? '진화원: ' + st.sources.slice().reverse().slice(0, 4).map(nm).join(', ') + (st.sources.length > 4 ? ' …' : '') : '진화원 없음';
  const hl = (uid, on) => { document.querySelectorAll('[data-suid="' + uid + '"]').forEach(el => el.classList.toggle('jg-hl', on)); };
  const matBox = (st, tag) => h('div', { className: 'jg-mat', onmouseenter: () => hl(st.uid, true), onmouseleave: () => hl(st.uid, false), ontouchstart: () => { hl(pr0uid, false); } }, [
    h('span', { className: 'jg-tag' }, tag), cardChip(st.cardId, { owner: p, sourcesCount: st.sources.length }),
    h('div', { className: 'jg-mat-info' }, stInfo(st)), h('div', { className: 'jg-mat-src' }, srcNames(st)),
  ]);
  const pr0uid = null;
  const rows = shown.map(pr => {
    const go = async () => {
      if (blockIfBusy()) return;
      jogressModal = null; sel.hand = null; sel.stack = null; sel.stack2 = null; dragData = null;
      await runJogress(p, pr.top.uid, pr.bottom.uid, m.cardId);
      jgCache.clear(); render();
    };
    return h('div', { className: 'jg-row' + (shown.length === 1 ? ' pre' : '') }, [
      h('div', { className: 'jg-cards' }, [
        matBox(pr.top, 'A'), h('span', { className: 'jg-op' }, '＋'),
        matBox(pr.bottom, 'B'), h('span', { className: 'jg-op' }, '→'),
        cardChip(m.cardId, { owner: p }),
      ]),
      h('div', { className: 'jg-cost' }, [
        h('b', {}, `코스트 ${pr.cost}`), pr.delta ? ` (기본 ${pr.base}, 효과 ${fmt(pr.delta)})` : '',
        ` · 메모리 ${fmt(state.memory)} → `, h('b', {}, fmt(memAfter(pr.cost))),
      ]),
      h('button', { className: 'primary jg-confirm', disabled: !pr.ok, onClick: go }, pr.ok ? `🧬 ${nm(pr.top.cardId)} + ${nm(pr.bottom.cardId)} → ${nm(m.cardId)}` : `메모리 부족 (코스트 ${pr.cost})`),
    ]);
  });
  return h('div', { className: 'player-panel jg-modal' }, [
    h('h3', {}, `🧬 조그레스 진화 → ${nm(m.cardId)}`),
    h('div', { className: 'step-info' }, `조건: ${info.cond}${info.pairs.length > 1 ? ` — 가능한 조합 ${info.pairs.length}개, 하나를 고르세요` : ''}`),
    ...rows,
    h('div', { className: 'actions-row' }, [
      filtered ? h('button', { onClick: () => { m.showAll = true; render(); } }, `다른 조합도 보기 (${info.pairs.length}개)`) : null,
      h('button', { onClick: () => { jogressModal = null; if (netIntercept('jogressCancel', [])) { render(); return; } render(); } }, '취소'),
    ].filter(Boolean)),
  ]);
}

// Tap flow: with a hand card selected, which own stacks can it act on? 'evolve' = every printed/granted evolution condition
// satisfied — the SAME legality functions handleStackDrop uses; 'jogress' = a legal DNA material (opens the jogress modal).
function handTargetKind(p, stack, zoneKind) {
  if (!sel.hand || sel.hand.player !== p || p !== state.activePlayer || state.phase !== 'main') return null;
  if (zoneKind !== 'battle' && zoneKind !== 'raising') return null;
  const hc = state.players[p].hand[sel.hand.idx];
  if (hc == null || S.card(hc).category !== 'digimon') return null;
  if (!['digimon', 'digitama', 'tamer'].includes(S.card(stack.cardId).category)) return null; // (tamer: 「테이머를 Lv.N 디지몬으로서 취급하여 진화」 cards)
  try {
    const restr = S.evolveTargetRestriction(state, p, stack);
    const extra = S.evoExtraArg(state, p, stack);
    if (E.evolutionMethods(stack.cardId, hc, extra, restr, { state, p, stack }).length) return 'evolve';
    if (E.canEvolveAny(stack.cardId, hc, extra, restr).ok) return 'evolve';
  } catch (e) { /* fall through */ }
  return zoneKind === 'battle' && jogressMatUids().has(stack.uid) ? 'jogress' : null;
}
// Can the selected hand card be played/used from the hand right now (tap the battle area / the ▶ button)?
// Which hand cards can be used RIGHT NOW (main phase, my turn)? Free = paid from the memory I still have; costly = legal but the memory
// goes past 0 so the turn passes; evolve = at least one of my stacks can take it. Purely presentational (never gates an action).
function handHint(p, id, i) {
  if (!state || state.winner || p !== state.activePlayer || state.phase !== 'main' || isCpuSide(p) || busy()) return null;
  const c = S.card(id), pl = state.players[p], mem = p === 'p1' ? state.memory : -state.memory;
  let evo = null;
  if (c.category === 'digimon') {
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) {
      if (!['digimon', 'digitama'].includes(S.card(st.cardId).category)) continue;
      let ck; try { ck = E.canEvolveAny(st.cardId, id, S.evoExtraArg(state, p, st), S.evolveTargetRestriction(state, p, st)); } catch (e) { continue; }
      if (ck && ck.ok && (!evo || ck.cost < evo.cost)) evo = { cost: ck.cost, from: S.card(st.cardId).nameKo };
    }
  }
  const room = c.category !== 'digimon' || pl.battle.length < 6;
  const playOk = c.cost != null && room;
  if (evo && evo.cost <= mem) return { cls: 'hint-evo', title: `진화 가능: ${evo.from} → 코스트 ${evo.cost} (메모리 ${mem} 이내)` };
  if (S.isDual(id) && !evo) { // 듀얼 카드: Digimon side has no play cost -> the only way to play it from hand is the Option side (룰 4-6-2)
    let oc = null; try { if (S.optionColorOk(state, p, id)) oc = Math.max(0, S.optionBaseCost(state, p, id)); } catch (e) { oc = null; }
    if (oc != null) return oc <= mem ? { cls: 'hint-free', title: `옵션으로 사용 가능 — 사용 코스트 ${oc} ≤ 내 메모리 ${mem} (사용 후 《아츠 진화》 가능)` } : { cls: 'hint-costly', title: `옵션으로 사용 가능하지만 사용 코스트 ${oc}가 메모리 ${mem}을 넘어 상대에게 턴이 넘어감` };
  }
  if (playOk && c.cost <= mem) return { cls: 'hint-free', title: `지금 낼 수 있음 — 코스트 ${c.cost} ≤ 내 메모리 ${mem}` + (evo ? ` · 진화도 가능(${evo.cost})` : '') };
  if (evo || playOk) return { cls: 'hint-costly', title: `낼 수는 있지만 메모리 ${mem}을 넘어 상대에게 턴이 넘어감 (필요 ${evo ? Math.min(evo.cost, playOk ? c.cost : 99) : c.cost})` };
  return { cls: 'hint-none', title: c.category === 'digimon' && pl.battle.length >= 6 ? '배틀 에어리어가 가득 참' : '지금은 낼 수 없음' };
}
// vs-CPU mis-click guard: passing while the hand still holds a card I can pay for from my memory arms the button for 4 s (second click passes).
let passArmUntil = 0, passArmTurn = -1;
const passFreeCount = () => { const p = state.activePlayer; return state.players[p].hand.filter((id, i) => { const h2 = handHint(p, id, i); return h2 && (h2.cls === 'hint-free' || h2.cls === 'hint-evo'); }).length; };
const passArmed = () => passArmTurn === state.turnNumber && Date.now() < passArmUntil;
function passNeedsConfirm() {
  if (!cpuOn || state.activePlayer === CPU_P) return false;
  if (passArmed()) { passArmUntil = 0; return false; }
  const mem = state.activePlayer === 'p1' ? state.memory : -state.memory;
  if (mem <= 0 || passFreeCount() === 0) return false;
  passArmTurn = state.turnNumber; passArmUntil = Date.now() + 4000;
  setTimeout(() => { if (state && !passArmed()) render(); }, 4100);
  render(); return true;
}
function handPlayable(p) {
  if (!sel.hand || sel.hand.player !== p || p !== state.activePlayer || state.phase !== 'main') return false;
  const hc = state.players[p].hand[sel.hand.idx];
  return hc != null;
}

function renderStack(p, stack, zoneKind, opts = {}) {
  const isSelected = sel.stack && sel.stack.uid === stack.uid;
  const isSecondSelected = sel.stack2 && sel.stack2.uid === stack.uid;
  const isOwnActiveBattle = p === state.activePlayer && zoneKind === 'battle' && !stack.suspended && state.phase === 'main';
  const jgMat = zoneKind === 'battle' && p === state.activePlayer && jogressMatUids().has(stack.uid);
  const chip = cardChip(stack.cardId, {
    owner: p,
    selected: isSelected || isSecondSelected,
    suspended: stack.suspended,
    sourcesCount: stack.sources.length,
    effectiveDp: zoneKind === 'raising' ? undefined : S.effectiveDP(state, p, stack),
    keywordBadges: [...activeKeywordBadges(stack), ...(jgMat ? ['🧬재료'] : [])],
    jogress: jgMat,
    draggable: isOwnActiveBattle && !isCpuSide(p) && S.card(stack.cardId).category === 'digimon', // 테이머는 어택할 수 없으므로 드래그 어택 없음
    dragPayload: { kind: 'stack', player: p, uid: stack.uid, zone: zoneKind },
    attackable: !!opts.attackTarget,
    target: !!handTargetKind(p, stack, zoneKind),
    onDrop: (drag) => handleStackDrop(p, stack, zoneKind, drag),
    onClick: opts.onClickOverride || (opts.attackTarget
      ? (() => { attackFlow(opts.attackTarget.attackerP, opts.attackTarget.attackerUid, stack.uid); sel.stack = null; render(); })
      : (() => {
        // Tap flow: a hand card is selected and this stack is a legal evolve / DNA target → same action as dropping it here.
        const tk = handTargetKind(p, stack, zoneKind);
        if (tk === 'jogress') { openJogress(p, state.players[p].hand[sel.hand.idx], stack.uid); return; }
        if (!tk && sel.hand && sel.hand.player === p && zoneKind === 'battle' && p === state.activePlayer && state.phase === 'main' && jogressInfo(p, state.players[p].hand[sel.hand.idx])) {
          render(); showToast(jogressReason(p, state.players[p].hand[sel.hand.idx])); return; // a jogress card is selected: explain instead of silently swapping the selection
        }
        if (tk) {
          const hi = sel.hand.idx; sel.hand = null;
          sel.stack = null; sel.stack2 = null;
          doEvolve(p, stack.uid, hi);
          return;
        }
        if (sel.stack && sel.stack.uid === stack.uid) sel.stack = null;
        else {
          sel.stack = { player: p, uid: stack.uid, zone: zoneKind };
          sel.stack2 = null;
          sel.hand = null; // one thing selected at a time
        }
        render();
      })),
  });
  chip.dataset.suid = stack.uid; // 조그레스 창에서 같은 스택을 필드에서 강조하기 위한 표식

  chip.dataset.fxp = p; chip.dataset.fxu = stack.uid; chip.dataset.fxn = S.card(stack.cardId).nameKo; chip.dataset.fxc = stack.cardId; // VFX overlay anchors
  const fxHit = fxHitFor(p, stack);
  if (fxHit) { chip.classList.add('fx-hit', fxHit); chip.appendChild(h('div', { className: 'fx-badge' }, '🎯')); }
  const acts = stackActionList(p, stack, zoneKind);
  const actBtn =(a, cls) => h('button', { className: cls, title: a.title, disabled: a.disabled, onClick: (e) => { e.stopPropagation(); a.run(); } }, a.label);
  const delayBtn = acts.find(a => a.kind === 'delay') ? actBtn(acts.find(a => a.kind === 'delay'), 'delay-btn') : null;
  const trainBtn = acts.find(a => a.kind === 'train') ? actBtn(acts.find(a => a.kind === 'train'), 'delay-btn train-btn') : null;
  const mainActs = acts.filter(a => a.kind === 'main');
  const mainBtns = mainActs.length ? h('div', { className: 'main-btns' }, mainActs.map(a => actBtn(a, 'delay-btn main-btn'))) : null;
  const extraBtns = [delayBtn, trainBtn, mainBtns].filter(Boolean);

  // 10-1-1: the link condition/cost are printed on the card being linked (S.linkCheck); any own battle Digimon can be a host candidate.
  // 10-1-1: a raising-area Digimon can be a Link host too
  const linkSlots = ((zoneKind === 'battle' || zoneKind === 'raising') && S.card(stack.cardId).category === 'digimon' && p === state.activePlayer) ? [{ grantedBy: stack.cardId, conditionText: '드롭한 카드의 링크 조건', cost: '?' }] : [];
  if (!linkSlots.length) return extraBtns.length ? h('div', { className: 'stack-wrap' }, [chip, ...extraBtns]) : chip;
  // Small overlay badge, separately droppable, so dragging a hand card onto
  // it links instead of digivolving — distinct from dropping on the card art.
  let linkOk = false;
  try {
    if (sel.hand && sel.hand.player === p && state.phase === 'main') { const hc = state.players[p].hand[sel.hand.idx]; linkOk = hc != null && S.linkCheck(state, p, stack, hc).ok; }
    else if (sel.stack && sel.stack.player === p && sel.stack.zone === 'battle' && sel.stack.uid !== stack.uid && state.phase === 'main') { const src = findStack(sel.stack); linkOk = !!src && S.linkCheck(state, p, stack, src.cardId).ok; }
  } catch (e) { linkOk = false; }
  const badge = h('div', {
    className: 'link-badge' + (linkOk ? ' tap-target' : ''),
    title: linkSlots.map(s => `${S.card(s.grantedBy).nameKo} 링크: ${s.conditionText} (코스트 ${s.cost})`).join('\n'),
    ondragover: (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-hover'); },
    ondragleave: (e) => { e.currentTarget.classList.remove('drop-hover'); },
    onClick: (e) => { e.stopPropagation(); const d = sel.hand && sel.hand.player === p ? handDrag(p, sel.hand.idx) : (sel.stack && sel.stack.player === p && sel.stack.zone === 'battle' ? { kind: 'stack', player: p, uid: sel.stack.uid, zone: 'battle' } : null); if (!d) return; if (d.kind === 'hand') sel.hand = null; else sel.stack = null; handleLinkDrop(p, stack, d); },
    ondrop: (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-hover'); handleLinkDrop(p, stack, dragData); },
  }, '🔗' + (stack.linkCards?.length ? stack.linkCards.length : ''));
  return h('div', { className: 'stack-wrap' }, [chip, badge, ...extraBtns]);
}

// Yes/no through the game's own modal (ctxChoose) instead of a blocking browser dialog.
const askYN = (player, prompt) => ctxChoose('confirmEffect', { player, prompt, yesLabel: '예', noLabel: '아니오' });

async function playFreshFromDrag(drag, p) {
  if (netIntercept('playFreshFromDrag', [drag, p])) return;
  if (blockIfBusy()) return;
  if (!drag || drag.kind !== 'hand' || drag.player !== p || p !== state.activePlayer || state.phase !== 'main') return;
  const category = S.isDual(drag.cardId) ? 'option' : S.card(drag.cardId).category; // 4-6-2: a dual card dropped on the board is USED (option side); dropped on a Digimon it evolves (Digimon side)
  if (category === 'digimon' && S.isPlayRestricted(state, drag.player, drag.cardId)) { S.log(state, `${drag.player} ${S.card(drag.cardId).nameKo}: 효과로 등장시킬 수 없음 (DP 제한)`); dragData = null; render(); return; }
  if (category === 'option') {
    let optDelta = 0; // s8: HOOKS.playDiscount also applies to Option cards ("…옵션 카드를 사용할 때, …사용 코스트 -N")
    for (const o of [...S.hookPlayCostOptions(state, drag.player, drag.cardId), ...(S.optionColorOk(state, drag.player, drag.cardId) ? S.optionCostOptions(state, drag.player, drag.cardId) : [])]) { if (await askYN(drag.player, o.label)) optDelta += await o.apply(ctxChoose) || 0; }
    S.useOptionCard(state, drag.player, drag.idx, { costDelta: optDelta });
  } else {
    let discount = S.card(drag.cardId).category === 'digimon' ? S.tamerPlayCostDiscount(state, drag.player, drag.cardId) + S.traitPlayCostDiscount(state, drag.player, drag.cardId) : 0;
    // 《디지크로스》 (7-2): optionally place matching hand/battle cards under this card for -N each.
    let materials = [], restTamers = [];
    // 7-2-2-3/4: the player picks which candidate cards (from hand / battle area / tamer / trash) go under, at least 1.
    const xrOpts = category === 'digimon' ? S.digiXrosOptions(state, drag.player, drag.idx) : [];
    if (xrOpts.length && await askYN(drag.player, `《디지크로스》 — 재료를 아래에 놓고 등장 코스트를 줄이시겠습니까? (후보: ${xrOpts.map(o => S.card(o.cardId).nameKo).join(', ')})`)) {
      const KIND = { hand: '패', battle: '배틀 에어리어', tamer: '테이머 아래', trash: '트래시' };
      const keys = new Set();
      for (const o of xrOpts) if (xrOpts.length === 1 || await askYN(drag.player, `${S.card(o.cardId).nameKo} (${KIND[o.kind] || o.kind})을(를) 아래에 놓겠습니까?`)) keys.add(o.key);
      const xr = keys.size ? S.planDigiXrosPicked(state, drag.player, drag.idx, keys) : null;
      if (xr) { materials = xr.materials; discount -= xr.discount; restTamers = xr.restTamers || []; }
    }
    // 《어셈블리》 (7-3): place exactly the required trash cards under the card for a fixed play-cost reduction (all or nothing).
    let assembly = [];
    const asmPlan = category === 'digimon' ? S.planAssembly(state, drag.player, drag.idx) : null;
    if (asmPlan && await askYN(drag.player, `《어셈블리 -${asmPlan.per}》 — 트래시의 ${asmPlan.materials.map(m => S.card(m.cardId).nameKo).join(', ')}을(를) 아래에 놓고 등장 코스트 -${asmPlan.discount}?`)) {
      assembly = asmPlan.materials; discount -= asmPlan.discount;
    }
    // Card-specific "…등장할 때, <비용>하는 것으로 지불하는 등장 코스트 -N" abilities (HOOKS.playDiscount) — confirmed one by one.
    for (const o of S.hookPlayCostOptions(state, drag.player, drag.cardId)) { if (await askYN(drag.player, o.label)) discount += await o.apply(ctxChoose) || 0; }
    { const hl = state.players[drag.player].hand; if (hl[drag.idx] !== drag.cardId) { const hi = hl.indexOf(drag.cardId); if (hi >= 0) drag.idx = hi; } } // a cost option that discards from the hand (EX9-018/043/064) shifts the played card's index
    if (category === 'digimon') discount += S.s1PlayDiscount(state, drag.player, drag.cardId); // shard1
    if (category === 'digimon') discount += S.handSelfPlayDiscount(state, drag.player, drag.cardId); // shard7: printed "이 카드가 등장할 때, …등장 코스트 -N"
    if (category === 'digimon' && discount < 0 && S.isPlayCostLocked(state)) { S.log(state, `${drag.player} 등장 코스트 감소 무효 (서로는 지불하는 등장 코스트를 마이너스할 수 없다)`); discount = 0; } // ST13-08/EX7-015: covers every reduction source (hand self-discount, Xros, assembly, hook options)
    const cost = Math.max(0, (S.card(drag.cardId).cost || 0) + discount);
    if (!S.canPayCost(state, cost)) { S.log(state, `${drag.player} ${S.card(drag.cardId).nameKo} 등장 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); dragData = null; render(); return; }
    if (cost > 0) S.spendMemory(state, cost);
    S.playDigimonFresh(state, drag.player, drag.idx, { materials, restTamers, assembly });
  }
  E.checkAutoEndTurn(state);
  dragData = null; render();
}

// A small square tile showing a face-down pile's count + label — deck/
// security/digitama/trash, styled like the reference layout's side piles
// instead of plain text.
function pileChip(label, count, extraClass = '', onClick) {
  return h('div', { className: `pile-chip ${extraClass}${onClick ? ' clickable' : ''}`, onClick }, [
    h('div', { className: 'pile-count' }, String(count)),
    h('div', { className: 'pile-label' }, label),
  ]);
}

function zonePill(text) {
  return h('div', { className: 'zone-pill' }, text);
}

function renderPlayerPanel(p) {
  const pl = state.players[p];
  const isActive = state.activePlayer === p;
  const canAttackThisPlayerByDrag = dragData && dragData.kind === 'stack' && dragData.player !== p && S.canAttackPlayer(state, dragData.player, dragData.uid);
  // Selecting your own eligible attacker (click, same as picking DNA/link
  // targets) highlights every legal target on the OPPONENT's side directly
  // on the board — the player and each attackable Digimon — as a second,
  // more discoverable way to attack besides dragging.
  const selectedEnemyAttacker = (sel.stack && sel.stack.player !== p && sel.stack.zone === 'battle' && sel.stack.player === state.activePlayer && state.phase === 'main')
    ? findStack(sel.stack) : null; // (테이머는 canAttackPlayer가 false라 대상 강조가 나오지 않는다)
  const canAttackThisPlayerByClick = selectedEnemyAttacker && !selectedEnemyAttacker.suspended && S.canAttackPlayer(state, sel.stack.player, sel.stack.uid);
  const canAttackThisPlayer = canAttackThisPlayerByDrag || canAttackThisPlayerByClick;
  const legalClickTargets = canAttackThisPlayerByClick ? new Set(S.legalDigimonTargets(state, sel.stack.player, sel.stack.uid)) : new Set();
  const header = h('div', {
    className: `player-header${canAttackThisPlayer ? ' attackable' : ''}`,
    // dragData is only set at dragstart (no re-render), so the legality check must happen at event time, not render time.
    ondragover: (e) => { if (dragData && dragData.kind === 'stack' && dragData.player !== p && S.canAttackPlayer(state, dragData.player, dragData.uid)) { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('drop-hover'),
    ondrop: (e) => {
      e.currentTarget.classList.remove('drop-hover');
      if (dragData && dragData.kind === 'stack' && dragData.zone === 'battle' && dragData.player !== p && S.canAttackPlayer(state, dragData.player, dragData.uid)) { e.preventDefault(); attackFlow(dragData.player, dragData.uid, 'PLAYER'); }
      dragData = null;
    },
    onClick: canAttackThisPlayerByClick ? () => { attackFlow(sel.stack.player, sel.stack.uid, 'PLAYER'); sel.stack = null; render(); } : undefined,
  }, [
    h('b', {}, p.toUpperCase()),
    h('span', {}, pl.deckName),
    canAttackThisPlayer ? h('span', { style: 'color:var(--danger)' }, '← 탭/드래그로 이 플레이어 공격') : null,
  ]);

  // 6-4: hatch OR move, not both, per breeding phase visit
  const canHatch = state.phase === 'breeding' && p === state.activePlayer && !state.breedingActionTaken && !pl.raising && pl.digitamaDeck.length > 0;
  // 실제 대전 배치: 시큐리티는 각 플레이어 기준 왼쪽(아래쪽 P1=화면 왼쪽, 맞은편 P2=화면 오른쪽), 카드는 옆으로 눕혀 쌓인다
  const secZone = renderSecurityZone({ h, S, state, p, pa: sel.pendingAttack, mode: fxGetMode(), cardChip, artUrl: (id) => S.artUrl(state, p, id) || S.card(id).imgUrl, onChange: () => render(),
    // 시큐리티를 눌러도(또는 드래그해 놓아도) 플레이어 어택 대상으로 선택된다
    onAttack: canAttackThisPlayerByClick ? () => { attackFlow(sel.stack.player, sel.stack.uid, 'PLAYER'); sel.stack = null; render(); } : null,
    onDropAttack: (e, over) => {
      if (!(dragData && dragData.kind === 'stack' && dragData.zone === 'battle' && dragData.player !== p && S.canAttackPlayer(state, dragData.player, dragData.uid))) return false;
      if (!over) { attackFlow(dragData.player, dragData.uid, 'PLAYER'); dragData = null; }
      return true;
    } });
  const pileRail = h('div', { className: 'pile-rail', 'data-fxpile': p }, [
    pileChip('덱', pl.deck.length, 'pile-deck'),
    // 3-1-2-1 / 3-6-3: the trash is a public zone — its cards (and order, top = last) can be inspected by anyone at any time.
    pileChip(panelsOpen.trashOf?.[p] ? '트래시 ▼' : '트래시', pl.trash.length, 'pile-trash', () => { (panelsOpen.trashOf ||= {})[p] = !panelsOpen.trashOf[p]; render(); }),
    panelsOpen.trashOf?.[p] ? h('div', { className: 'hand-list trash-list' }, pl.trash.length ? pl.trash.slice().reverse().map(id => cardChip(id, { owner: p })) : [h('span', {}, '(비어 있음)')]) : null,
  ].filter(Boolean));

  const canMoveRaising = state.phase === 'breeding' && p === state.activePlayer && !state.breedingActionTaken && pl.raising && S.canMoveFromRaising(pl.raising);
  const raisingZone = h('div', { className: 'zone hex-field' }, [
    zonePill(canMoveRaising ? '육성 에어리어 (카드 탭=배틀 이동)' : '육성 에어리어'),
    h('div', { className: 'hex-slot-row' }, [
      pl.raising
        ? renderStack(p, pl.raising, 'raising', canMoveRaising ? { onClickOverride: () => { if (netIntercept('move', [p])) return; if (blockIfBusy()) return; S.moveRaisingToBattle(state, p); render(); } } : {})
        : h('div', { className: 'empty-slot' }, '비어있음'),
      // digitama pile lives right next to the raising area it feeds, not
      // grouped with the unrelated deck/security/trash counters
      pileChip(canHatch ? '디지타마 (탭=부화)' : '디지타마', pl.digitamaDeck.length, 'pile-digitama', canHatch ? () => { if (netIntercept('hatch', [p])) return; if (blockIfBusy()) return; S.hatchDigitama(state, p); render(); } : undefined),
    ]),
  ]);

  const playTap = handPlayable(p);
  const battleZone = h('div', { className: 'zone drop-zone hex-field' + (playTap ? ' tap-target' : '') }, [
    zonePill(playTap ? ['배틀 에어리어 ', h('b', { style: 'color:var(--ok)' }, '(여기를 탭하면 등장/사용)')] : ['배틀 에어리어', h('span', { className: 'desk' }, ' (핸드카드를 여기로 드래그하면 등장)')]),
    h('div', {
      className: 'stack-list hex-slot-row',
      onClick: (e) => { // tap flow: empty space in the battle area = play the selected hand card (same as dropping it)
        if (!handPlayable(p) || e.target.closest('.card-chip, .link-badge, button')) return;
        const hi = sel.hand.idx; sel.hand = null; doPlayFromHand(p, hi);
      },
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-hover'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); playFreshFromDrag(dragData, p); },
    }, [
      ...pl.battle.map(s => renderStack(p, s, 'battle', legalClickTargets.has(s.uid) ? { attackTarget: { attackerP: sel.stack.player, attackerUid: sel.stack.uid } } : {})),
      ...fxGhostNodes(p), // 소멸한 카드의 흔적 (효과 출처 표시, 눌러서 닫기)
      // Always show plenty of open slots to drop a new card into — at
      // least 3 empty ones, more if the area is still mostly empty —
      // instead of only appearing once and disappearing the moment the
      // area has a single card in it.
      ...Array(Math.max(3, 6 - pl.battle.length)).fill(0).map(() => h('div', { className: 'empty-slot' }, '비어있음')),
    ]),
  ]);

  // Explicit counter set by S.drawCards, not a hand.length diff — a
  // digivolve's bonus draw nets to a ZERO length change (one card spent on
  // the evolution, one drawn back), which silently hid it from a length-
  // diff detector. Consumed (reset to 0) right after reading so it only
  // flashes once, on the render right after the draw happened.
  const guestView = Net.NET.role === 'guest';
  const justDrawnCount = guestView ? (pl.netDrawFlash || 0) : (pl.pendingDrawFlash || 0);
  pl.pendingDrawFlash = 0;
  if (guestView) pl.netDrawFlash = 0;
  else if (Net.NET.role === 'host' && justDrawnCount) pl.netDrawFlash = (pl.netDrawFlash || 0) + justDrawnCount;
  const handZone = h('div', { className: 'zone hand-zone', style: 'flex:1' }, [
    zonePill((isCpuSide(p) && !CPU_CFG.reveal && !state.winner) ? `🤖 CPU 핸드 (${pl.hand.length}장, 비공개)` : netHideHand(p) ? `🌐 상대 핸드 (${pl.hand.length}장, 비공개)` : [`핸드 (${pl.hand.length}장, 연습용 전체 공개)`, h('span', { className: 'desk' }, ' — 배틀 에어리어로 드래그=등장, 내 스택 위로 드래그=진화, 상대 이름 위로 스택 드래그=공격'), h('span', { className: 'touch-only' }, ' — 카드를 탭해서 선택'), (p === state.activePlayer && state.phase === 'main' && !isCpuSide(p)) ? h('span', { className: 'hint-legend' }, [' ', h('i', { className: 'lg-free' }, '■'), '지금 가능 ', h('i', { className: 'lg-evo' }, '■'), '진화 가능 ', h('i', { className: 'lg-costly' }, '■'), '메모리 초과(턴 넘어감) ', h('i', { className: 'lg-none' }, '■'), '불가']) : null]),
    ...(() => {
      if (isCpuSide(p)) return []; // the CPU's hand abilities are its own business
      // "[패]【메인】"/"[트래시]【메인】" abilities printed on Digimon/Tamer cards (usable from hand / trash in the main phase)
      const abs = [...S.zoneMainAbilities(state, p, 'hand').map(a => ({ ...a, zone: 'hand' })), ...S.zoneMainAbilities(state, p, 'trash').map(a => ({ ...a, zone: 'trash' }))];
      return abs.length ? [h('div', { className: 'actions-row' }, abs.map(a => h('button', {
        className: 'delay-btn main-btn', title: `【메인】 ${a.text.replace(/\n/g, ' ')}`,
        onClick: () => {
          if (netIntercept('zoneMain', [p, a.zone, a.idx])) return;
          if (blockIfBusy()) return;
          state.pending.push({ uid: 'zmain' + Math.random().toString(36).slice(2), player: p, cardId: a.cardId, stackUid: null, tags: a.tags, text: a.text, resolved: false, zoneMain: a.zone, zoneIdx: a.idx });
          render();
        },
      }, `⚡메인(${a.zone === 'hand' ? '패' : '트래시'}) ${S.card(a.cardId).nameKo}`)))] : [];
    })(),
    h('div', { className: 'hand-list', 'data-fxhand': p }, pl.hand.map((id, i) => ((isCpuSide(p) && !CPU_CFG.reveal && !state.winner) || id == null || netHideHand(p)) ? h('div', { className: 'card-chip cpu-hidden' }, '🂠') : cardChip(id, {
      owner: p,
      selected: sel.hand && sel.hand.player === p && sel.hand.idx === i,
      draggable: p === state.activePlayer && state.phase === 'main' && !isCpuSide(p),
      dragPayload: { kind: 'hand', player: p, idx: i, cardId: id },
      justDrawn: i >= pl.hand.length - justDrawnCount,
      hint: handHint(p, id, i),
      keywordBadges: (p === state.activePlayer && state.phase === 'main' && jogressInfo(p, id)?.pairs.length) ? ['🧬조그레스 가능'] : undefined,
      onClick: () => {
        sel.hand = (sel.hand && sel.hand.idx === i && sel.hand.player === p) ? null : { player: p, idx: i, cardId: id };
        if (sel.hand) sel.stack = null; // tap flow: the hand card is the only selection
        render();
      },
    }))),
  ]);

  // 육성 에어리어는 패 옆으로 붙이고, 배틀 에어리어는 혼자 한 줄 전체를 써서 더 넓게 보이도록 한다.
  const raisingHandRow = h('div', { className: 'zone-row raising-hand-row' }, [raisingZone, handZone]);
  const fieldRow = h('div', { className: 'field-row' }, [
      h('div', { className: 'field-zones' }, p === 'p2'
        ? [raisingHandRow, battleZone] // 위쪽 플레이어: 육성+패가 필드보다 위(테이블 맞은편에 앉은 배치)
        : [battleZone, raisingHandRow]),
      pileRail,
    ]);
  fieldRow.insertBefore(secZone, p === 'p2' ? null : fieldRow.firstChild);
  // 위쪽 플레이어(P2)를 어택하는 대상 바는 메모리 게이지 바로 위(패널 맨 아래)에 둔다. 아래쪽 P1의 바는 게이지 바로 아래(패널 맨 위).
  return h('div', { className: `player-panel${isActive ? ' active' : ''}` }, p === 'p2' ? [fieldRow, header] : [header, fieldRow]);
}

// Horizontal memory-gauge number line (-10..0..+10 with a position marker),
// shared between both panels — mirrors the physical "메모리 게이지" strip.
function renderMemoryTrack() {
  // 아래쪽 플레이어(P1)가 플러스, 위쪽 플레이어(P2)가 마이너스. 플러스는 왼쪽으로 진행 (이 좌우 배치는 엔진 부호
  // 규약이라 화면과 무관하게 고정). 단, "아래/위"라는 방향 단어 자체는 온라인 대전에서 게스트 화면처럼 P1/P2가
  // 뒤집혀 보일 때는 실제 패널 위치(bottomSeat)에 맞게 바꿔줘야 한다 — renderBoard()와 같은 원칙.
  const bottomSeat = Net.NET.mySeat || 'p1';
  // 요청: 게스트 화면은 메모리 게이지 자체를 좌우반전해서 보여준다 (호스트 화면은 기존 그대로 왼쪽=P1/플러스, 오른쪽=P2/마이너스).
  const mirror = Net.NET.role === 'guest';
  const leftSeat = mirror ? 'p2' : 'p1';
  const rightSeat = mirror ? 'p1' : 'p2';
  const leftWord = leftSeat === bottomSeat ? '아래' : '위';
  const rightWord = rightSeat === bottomSeat ? '아래' : '위';
  const m = state.memory; // 엔진 규약: m>0=P1측 유리, m<0=P2측 유리 (부호 자체는 화면 좌우/반전과 무관하게 고정)
  const magnitude = Math.abs(m);
  const leftFavored = mirror ? m < 0 : m > 0;
  const rightFavored = mirror ? m > 0 : m < 0;
  const cells = [];
  for (let n = 10; n >= 1; n--) cells.push({ n, side: 'bottom' });
  cells.push({ n: 0, side: 'zero' });
  for (let n = 1; n <= 10; n++) cells.push({ n, side: 'top' });
  const activeIdx = m === 0 ? 10 : leftFavored ? 10 - magnitude : 10 + magnitude;
  const numRow = h('div', { className: 'mem-numbers' },
    cells.map((c, i) => h('span', { className: `mem-num mem-${c.side}` + (i === activeIdx ? ' mem-active' : '') }, String(c.n))));
  const who = leftFavored ? `${leftWord} ${leftSeat.toUpperCase()}` : rightFavored ? `${rightWord} ${rightSeat.toUpperCase()}` : '';
  const signOf = (seat) => (seat === 'p1' ? '+' : '-');
  const wordOf = (seat) => (seat === 'p1' ? '플러스' : '마이너스');
  return h('div', { className: 'mem-track' }, [
    h('div', { className: 'mem-head' }, [
      h('div', { className: 'mem-side mem-side-bottom' + (leftFavored ? ' on' : '') }, [h('span', {}, `◀ ${leftWord} ${leftSeat.toUpperCase()} (${wordOf(leftSeat)})`), leftFavored ? h('b', {}, `${signOf(leftSeat)}${magnitude}`) : null]),
      h('div', { className: 'mem-readout' }, m === 0 ? '메모리 0' : `메모리 ${who} ${magnitude}`),
      h('div', { className: 'mem-side mem-side-top' + (rightFavored ? ' on' : '') }, [rightFavored ? h('b', {}, `${signOf(rightSeat)}${magnitude}`) : null, h('span', {}, `${rightWord} ${rightSeat.toUpperCase()} (${wordOf(rightSeat)}) ▶`)]),
    ]),
    numRow,
  ]);
}

function renderBoard() {
  const over = !!state.winner; // game over: keep the final position visible (read-only) so the player can see why it ended
  // 🌐 온라인 대전: each side's own field always renders at the BOTTOM of THEIR OWN screen (sit-across-the-table
  // orientation), symmetric on both ends — host is always 'p1', guest is always 'p2' (see docs/netplay-design.md).
  // Outside online play `Net.NET.mySeat` is null, so bottomSeat is always 'p1' here: byte-for-byte the previous
  // fixed p2-top/p1-bottom order for CPU mode (human is always p1) and local 2p (an arbitrary shared convention
  // that doesn't depend on orientation anyway) — this is additive-only for netplay.
  const bottomSeat = Net.NET.mySeat || 'p1';
  const topSeat = S.opponentOf(bottomSeat);
  return h('div', { className: 'board' + (over ? ' gameover-board' : '') }, [
    h('div', { className: 'table-surface' }, [
      renderPlayerPanel(topSeat),
      renderMemoryTrack(),
      renderPlayerPanel(bottomSeat),
    ]),
  ]);
}

// ---------- action panel ----------

function numInput(id, value = 1) {
  return h('input', { type: 'number', id, value, min: '0' });
}
function val(id) { return Number(document.getElementById(id)?.value || 0); }

// Best-effort pattern → one-click-action compiler over the OFFICIAL Korean
// effect text. This is intentionally NOT a full NLP parser — natural-language
// game text has too much conditional/branching structure to fully automate.
// It recognizes the common, unconditional numeric patterns that make up a
// large share of card text, and leaves everything else for manual handling
// via the generic tools (which stay visible either way).
function quickApplyButtonsFor(text, player) {
  if (Net.NET.role === 'guest') return []; // 온라인: 즉석 적용 버튼은 상태를 직접 바꾸는 수동 도구라 호스트에서만
  const opp = S.opponentOf(player);
  const btns = [];
  let m;

  if ((m = text.match(/[≪《]\s*(\d+)\s*드로우\s*[≫》]/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.drawCards(state, player, n); render(); } }, `${player} ${n}드로우`));
  }
  if ((m = text.match(/메모리(?:를|을)?\s*\+\s*(\d+)/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.grantMemory(state, player, n); render(); } }, `${player} 메모리+${n}`));
  }
  if ((m = text.match(/메모리(?:를|을)?\s*-\s*(\d+)/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.grantMemory(state, player, -n); render(); } }, `${player} 메모리-${n}`));
  }
  if ((m = text.match(/(?:자신의\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.trashTopOfDeck(state, player, n); render(); } }, `${player} 덱 위 ${n}장 파기`));
  }
  if ((m = text.match(/상대(?:의)?\s*덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { S.trashTopOfDeck(state, opp, n); render(); } }, `${opp}(상대) 덱 위 ${n}장 파기`));
  }
  if (/패(?:를)?\s*전부\s*파기|핸드(?:를)?\s*전부\s*파기/.test(text)) {
    btns.push(h('button', { onClick: () => { const n = state.players[player].hand.length; for (let i=0;i<n;i++) S.trashFromHand(state, player, 0); render(); } }, `${player} 핸드 전부 파기`));
  }
  if ((m = text.match(/자신의\s*시큐리티(?:를)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { for (let i=0;i<n;i++) S.trashTopSecurityByEffect(state, player); render(); } }, `${player} 자기 시큐리티 위 ${n}장 파기`));
  }
  if ((m = text.match(/상대(?:의)?\s*시큐리티(?:를)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기/))) {
    const n = Number(m[1]);
    btns.push(h('button', { onClick: () => { for (let i=0;i<n;i++) S.trashTopSecurityByEffect(state, opp); render(); } }, `${opp}(상대) 시큐리티 위 ${n}장 파기`));
  }
  if (/자신의\s*시큐리티(?:를)?\s*아래(?:에서)?\s*(?:부터)?\s*1\s*장(?:을)?\s*파기/.test(text)) {
    btns.push(h('button', { onClick: () => { S.trashBottomSecurityByEffect(state, player); render(); } }, `${player} 자기 시큐리티 맨 밑 1장 파기`));
  }
  return btns;
}

async function ctxChoose(kind, payload) {
  // nothing to pick from: skip the "대상 없음 / 취소"-only prompt (same result as cancelling it)
  if (kind === 'pickStack' && payload && Array.isArray(payload.uids) && !payload.uids.length && !payload.required) return null;
  // 사용자가 "이후 전부 발휘하지 않음"을 선택함 — confirmEffect는 항상 "아니오"가 유효한 응답이므로(강제 효과라도
  // 룰 15-15-7-4에 의해 임의 처리 여부는 플레이어 선택) 사람 쪽 결정에 한해 자동으로 거절 처리한다. payload.player
  // 가 CPU 좌석(CPU_P)이면 이 지름길을 타지 않고 그대로 진행시켜, CPU 자신의 판단(uc.by)에 맡긴다.
  // 단발성: sel.declineAllRemaining은 버튼을 누른 "그 순간 이미 대기 중이던" 효과 uid의 Set — 그 이후 새로 발동
  // 대기하는 효과(payload._triggerUid가 Set에 없음)는 다시 정상적으로 물어본다. payload._pendingResolution(발동
  // 대기 큐 처리 중에만 runPendingScript가 붙임)이 없으면 건드리지 않는다 — 그렇지 않으면 카드를 낼 때의
  // 《어셈블리》/《디지크로스》/코스트 할인 확인창(main.js의 askYN, 대기 큐와 무관)까지 전부 자동 거절돼 버려서,
  // "이후 전부 발휘하지 않음"을 한 번 누르면 그 게임 내내 어셈블리 등을 영영 못 쓰게 되는 버그가 있었다
  // (실전 리포트: 슬레이어드라몬 《어셈블리》가 매번 먹통 / "내가 조작한 적 없는데 자꾸 진행된다").
  if (kind === 'confirmEffect' && sel.declineAllRemaining && payload && payload._pendingResolution && sel.declineAllRemaining.has(payload._triggerUid) && (!cpuOn || payload.player !== CPU_P)) return false;
  return new Promise(resolve => {
    // Presentation order: activation VFX (banner / play flourish) FIRST, then the modal. `hold` keeps the choice registered (engine-side
    // busy checks still see it) but renderModal draws nothing until the fx timeline is idle (hard timeout inside fxWhenIdle).
    const st = state;
    const uc = { kind, payload, hold: false, by: (cpuOn || Net.NET.role) ? Cpu.deciderFor(st, kind, payload, { pendingOwner: cpuPendingOwner() || (Net.NET.role && payload && payload._self) || undefined, override: cpuActing ? CPU_P : null }) : null, resolve: (val) => { if (st.uiChoice === uc) st.uiChoice = null; resolve(val); if (state) render(); } };
    st.uiChoice = uc;
    try {
      const rec = st._fxRec;
      if (rec && rec.src && rec.src.kind === 'effect') fxEmit('effect', { rec, state: st }); // make sure this effect's banner is booked before we wait
      uc.hold = fxGetMode() !== 'off';
      if (uc.hold) {
        const release = () => { if (uc.hold) { uc.hold = false; if (state === st && st.uiChoice === uc) render(); } };
        fxWhenIdle().then(release, release);
        setTimeout(release, 3500); // last-resort fallback: the choice must always become answerable
      }
    } catch (e) { uc.hold = false; }
    render();
  });
}

// "이 카드의 【메인】 효과를 발휘한다." — near-universal boilerplate printed as
// EVERY Option card's inheritedKo (its "when revealed by a security check"
// text): reroute into compiling that same card's own 【메인】 segment
// (effectKo) instead of trying to pattern-match this sentence itself.
// Confirmed via a full-DB audit: 168 of 175 occurrences of this exact
// sentence are on Option cards' inheritedKo, always paired with a plain
// 【메인】-tagged effectKo to re-run.
const tagLbl = (x) => (x === '__ownDiscard' ? '파기 시' : String(x).replace(/^__/, '')); // pseudo-tags ('__…') shown without the prefix
function scriptFor(trigger) {
  if (trigger.schedFn) return [{ op: 'sched' }]; // held end-of-turn effect (18-1): run via trigger.schedFn in runPendingScript
  const specific = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text, !!trigger.inherited);
  if (specific) return specific;
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(trigger.text.trim())) {
    const { segments } = S.parseEffectSegments(S.card(trigger.cardId).effectKo || '');
    const mainSeg = segments.find(seg => seg.tags.includes('메인'));
    if (mainSeg) return Effects.lookupCardSpecific(trigger.cardId, mainSeg.tags, mainSeg.body) || Effects.compileToScript(mainSeg.body); // bespoke 【메인】 scripts (BT25-093 …) must win over the generic compile
  }
  // 16-17 《딜레이》 trigger sentence ("【자신의 턴】 …했을 때, 《딜레이》."): compiles to [] (the bullet is an optional cost-effect), which made the runner treat the
  // queued trigger as "no script → 자동 인식 실패" and never prompt (유니크 엠블럼 안 터짐). A placeholder marks it runnable; runPendingScript's delay branch handles it.
  const compiled = Effects.compileToScript(trigger.text);
  if (!compiled.length && Effects.delayBulletPlan(S, trigger.cardId, trigger.tags, trigger.text)) return [{ op: 'delayTrigger' }];
  return compiled;
}

// "[턴에 N회]"/"[턴 N회]" printed at the start of a segment's body caps how
// many times THIS SPECIFIC effect can fire per turn — e.g. ST2-11
// MetalGarurumon's "【어택 시】[턴에 1회] 이 디지몬을 액티브로 한다." should
// only re-activate it once per turn, not every time it attacks.
function parseOnceLimit(text) {
  const m = text.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
  return m ? Number(m[1]) : null;
}

// Printed "…할 수 있다" effects are OPTIONAL — but a script made only of ops that never
// ask the player anything (draw, memory, mill, own-stack changes…) used to just fire.
// Those get an explicit "발동한다 / 발동하지 않는다" prompt; scripts that already let the
// player pick/cancel (playFree, jogress, targets…) keep their own cancel button.
const NO_CHOICE_OPS = new Set(['draw', 'gainMemory', 'trashDeckTop', 'recoverTop', 'restStack', 'removeSecurity', 'securityTopToHand', 'securityBottomToHand', 'unsuspend', 'modifyDP', 'grantKeyword', 'securityDPMod', 'addSecurity']);
function isOptionalAutoEffect(text, script) {
  const bare = text.replace(/\([^()]*\)/g, '').replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '').trim();
  if (/^상대는/.test(bare)) return false;
  if (!/(?:할|시킬|놓을|추가할|등장시킬|사용할|오픈할|파기할|되돌릴|이동시킬|진화시킬|레스트시킬)\s*수\s*있다/.test(bare)) return false;
  const flat = script.flatMap(o => o.op === 'costGroup' ? [...o.cost, ...o.then] : o.op === 'condition' ? [...o.then, ...(o.else || [])] : [o]);
  return flat.length > 0 && flat.every(o => NO_CHOICE_OPS.has(o.op) && (o.op !== 'unsuspend' || o.target === 'thisStack' || true));
}

async function runPendingScript(trigger, opts = {}) {
  const st0 = state, stale = () => state !== st0; // game-epoch guard: a continuation of a replaced game must not touch the new one
  // marks this trigger as already executing further up the call stack — a nested resolver (drainNestedPending,
  // used by scriptedSecurityCheck's ≪관통≫ bonus check) must skip it and only pick up genuinely NEW pending items.
  trigger._running = true;
  if (trigger.schedFn) { // 18-1: a held "이 턴 종료 시 …" effect resolves like any other trigger
    if (opts.delay) await new Promise(r => setTimeout(r, Math.round(900 * READ_SPEEDS[READ.speed] / 1.7)));
    if (stale()) return;
    try { await trigger.schedFn(); } catch (e) { S.log(state, `예약된 턴 종료 효과 처리 오류: ${e && e.message}`); }
    if (stale()) return;
    S.resolvePending(state, trigger.uid);
    render();
    return;
  }
  if (S.waitingDestroyEffectGone(state, trigger)) { S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo}의 【소멸 시】 효과: 카드가 이미 트래시를 벗어나 발휘하지 못함`); S.resolvePending(state, trigger.uid); render(); return; }
  // 15-4-4-3: a waiting effect can't resolve if its card left the area or turned into a NEW card
  // (evolved / fused) before its turn came. 【소멸 시】 effects are meant to wait after leaving.
  if (trigger.stackUid && trigger.topId && !trigger.evt?.leaving && !trigger.tags.some(t => t.includes('소멸 시'))) {
    const stNow = findStack({ player: trigger.player, uid: trigger.stackUid });
    let why = null;
    if (!stNow || stNow.cardId !== trigger.topId) why = '카드가 벗어나거나 새 카드가 되어 (15-4-4-3)';
    // 15-4-4-4: the card no longer has this effect (an inherited effect whose source card left the stack)
    else if (trigger.inherited && !stNow.sources.includes(trigger.cardId) && !(stNow.linkCards || []).some(l => l.cardId === trigger.cardId)) why = '그 효과를 잃어 (15-4-4-4)';
    // 15-4-4-5: the trigger condition ("자신의 턴"/"상대의 턴") no longer holds
    else if (trigger.tags.includes('자신의 턴') && trigger.player !== state.activePlayer) why = '유발 조건(자신의 턴)을 잃어 (15-4-4-5)';
    else if (trigger.tags.includes('상대의 턴') && trigger.player === state.activePlayer) why = '유발 조건(상대의 턴)을 잃어 (15-4-4-5)';
    if (why) {
      S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 발동 대기 효과는 ${why} 발휘하지 못함`);
      S.resolvePending(state, trigger.uid);
      render();
      return;
    }
  }
  if (S.pendingCardLeftZone(state, trigger)) { // Q5230/5593/5758/5905: the deleted card left the trash before this 【소멸 시】 effect resolved
    S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 발동 대기 효과는 소멸한 카드가 트래시를 벗어나 발휘하지 못함`);
    S.resolvePending(state, trigger.uid);
    render();
    return;
  }
  const limit = parseOnceLimit(trigger.text);
  let onceMark = null;
  if (limit != null && trigger.stackUid) {
    const stack = findStack({ player: trigger.player, uid: trigger.stackUid });
    if (stack) {
      const key = S.onceLimitKey(trigger.cardId, trigger.tags);
      if (S.turnUsesRemaining(stack, key, limit) <= 0) {
        S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 효과는 이번 턴 사용 횟수(${limit}회)를 넘어서 건너뜀`);
        S.resolvePending(state, trigger.uid);
        render();
        return;
      }
      onceMark = { stack, key }; // consumed only once the player actually chooses to activate (15-14-1-1)
    }
  }
  // A deliberate pause before actually resolving — auto-running instantly
  // (previous behavior) meant the effect banner appeared and vanished on
  // the same render tick, too fast to actually read. Skipped for effects
  // that need a real choice (ctx.choose already pauses those naturally).
  if (opts.delay) await new Promise(r => setTimeout(r, Math.round(1500 * READ_SPEEDS[READ.speed] / 1.7)));
  if (stale()) return;
  const ctx = { state, S, E, self: trigger.player, opp: S.opponentOf(trigger.player), sourceCardId: trigger.cardId, sourceStackUid: trigger.stackUid, choose: (k, pl) => (stale() ? new Promise(() => {}) : ctxChoose(k, k === 'confirmEffect' ? { ...pl, _pendingResolution: true, _triggerUid: trigger.uid } : pl)), trigger, attack: () => sel.pendingAttack, endAttack: () => { endAttack(); render(); },
    // 11-2-2/11-2-3: the DECLARATION (S.declareAttack + pa/state.attackCtx setup, and — once a target is already
    // known — the same fireDeclare/queueTriggersForStack(...,'attack') path a normal attack uses) must happen AT
    // ONCE as part of resolving the triggering effect, not one JS tick later via setTimeout. The old deferred
    // version let a fully synchronous turn-end (checkAutoEndTurn -> beginTurnEnd+settleTurnEnd, main.js render())
    // complete first whenever the triggering script had nothing left to await (no opponent digimon to ask about a
    // bonus battle, e.g.) — observed on EX13-045: the forced attack either fired one turn late (already the wrong
    // activePlayer, so S.declareAttack's 11-2-1 check silently refused it) or was lost outright. attackFlow()
    // itself already only fires the declaration triggers once a target is fixed (immediately for a directTarget,
    // otherwise once the player/CPU picks one) — calling it synchronously here just lets that existing state
    // machine carry the attack the rest of the way, instead of inventing a separate deferred path. sel.atkQueued
    // still brackets the call (kept for busy()/settleTurnEndIfIdle()/snapshot.js, and as a defensive marker in
    // case attackFlow's own render() re-enters before pa is assigned).
    startAttack: (p, uid, directTarget, atkOpts) => {
      if (stale()) return;
      sel.atkQueued = (sel.atkQueued || 0) + 1;
      try {
        if (sel.pendingAttack) { // 11-2-3 / 공식 Q&A 3123: 어택이 이미 진행 중이면 새 어택은 선언될 수 없음 — 조용히 버리지 않고 로그를 남긴다
          const st0 = findStack({ player: p, uid });
          S.log(state, `${p} ${st0 ? S.card(st0.cardId).nameKo : uid} 효과의 어택 — 이미 다른 어택이 진행 중이라 선언하지 못함 (룰 11-2-3)`);
          return;
        }
        attackFlow(p, uid, directTarget, true, atkOpts);
      } finally {
        sel.atkQueued--;
        render();
      }
    },
    // ≪관통≫ bonus check for a scripted "can battle" op (S.resolveDigimonBattle called directly by a card script) — capped at once per attack (S.consumePierceCheck).
    securityCheck: async (p, uid, op) => { if (stale() || !S.consumePierceCheck(state, p, uid)) return; await scriptedSecurityCheck(p, uid, op || S.opponentOf(p)); } };
  // 16-17 ≪딜레이≫ on an event/turn-triggered PLACED Option without a bespoke script (BT17-096, BT24-098, P-2xx 유니크 엠블럼 …): the watcher queued only the trigger
  // sentence; the bullet is read from the card, the option can only be discarded from the turn after it was placed, and discarding it is a player choice.
  const delayPlan = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text, !!trigger.inherited) ? null : Effects.delayBulletPlan(S, trigger.cardId, trigger.tags, trigger.text);
  if (delayPlan) {
    const dst = findStack({ player: trigger.player, uid: trigger.stackUid });
    const cn = S.card(trigger.cardId).nameKo;
    let why = null, gateFailed = false;
    if (!dst || S.card(dst.cardId).category !== 'option') why = '배틀 에어리어에 없어';
    else if (state.turnNumber <= dst.placedTurn) why = '놓인 턴에는 사용할 수 없어';
    else if (!(await Effects.delayGateOk(delayPlan, ctx))) gateFailed = true; // Q5710: the bullet's condition is only read when the effect resolves — 《딜레이》 may still discard the option (no effect)
    if (stale()) return;
    if (why) { S.log(state, `${trigger.player} ${cn} 《딜레이》 — ${why} 발동하지 않음`); S.resolvePending(state, trigger.uid); render(); return; }
    if (!(await ctxChoose('confirmEffect', { player: trigger.player, prompt: `《딜레이》 — ${cn}을(를) 파기하고 효과를 발휘할까요? ${gateFailed ? '(조건 불충족 — 파기만 하고 효과는 발휘되지 않음) ' : ''}${delayPlan.text.slice(0, 90)}` }))) { S.log(state, `${trigger.player} ${cn} 《딜레이》를 발동하지 않음`); S.resolvePending(state, trigger.uid); render(); return; }
    S.discardForDelay(state, trigger.player, dst.uid);
    ctx.sourceStackUid = null;
    if (gateFailed) S.log(state, `${trigger.player} ${cn}: 《딜레이》 효과의 조건을 만족하지 않아 파기만 함`);
    else if (delayPlan.script.length) await Effects.runScript(delayPlan.script, ctx);
    else state.pending.push({ uid: 'rem' + Math.random().toString(36).slice(2), player: trigger.player, cardId: trigger.cardId, stackUid: null, tags: trigger.tags, text: delayPlan.text, resolved: false, manualOnly: true, note: '《딜레이》 효과를 자동 처리할 수 없음 — 직접 처리하세요' });
    S.resolvePending(state, trigger.uid);
    render();
    return;
  }
  const script = scriptFor(trigger);
  if (isOptionalAutoEffect(trigger.text, script)) {
    const yes = await ctxChoose('confirmEffect', { player: trigger.player, prompt: `【${trigger.tags.map(tagLbl).join('】【')}】 ${S.card(trigger.cardId).nameKo}: ${trigger.text.replace(/\([^()]*\)/g, '').slice(0, 90)} — 발동할까요?` });
    if (!yes) {
      S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 효과를 발동하지 않음`);
      S.refundOnceUse(state, trigger); // Q1180: a declined optional watcher effect does not use up its 〔턴에 1회〕
      S.resolvePending(state, trigger.uid);
      render();
      return;
    }
    ctx._optAsked = true; // the "할 수 있다" prompt above already covers the optional processing condition (no second prompt from costGroup)
  }
  if (onceMark && script.length === 1 && script[0].op === 'condition' && !(script[0].else || []).length && !(await Effects.evalConditionPublic(script[0].if, ctx))) onceMark = null;
  if (trigger.onceKey && script.length === 1 && script[0].op === 'condition' && !(script[0].else || []).length && !(await Effects.evalConditionPublic(script[0].if, ctx))) S.refundOnceUse(state, trigger); // Q1431: watcher whose leading condition is unmet was never activated
  if (stale()) return; // unmet leading condition: effect not activated -> no 〔턴에 1회〕 use
  if (onceMark) S.markTurnEffectUsed(onceMark.stack, onceMark.key);
  const onceGuard = (onceMark || trigger.onceKey) ? Effects.onceGuard(ctx) : null; // unresolved-b Q3: cancelled pick + no state change = never activated
  await Effects.runScript(script, ctx);
  if (stale()) return; // (only reachable if the script parked on something other than ctx.choose)
  if (onceGuard && !ctx._declined && onceGuard.noop()) { S.log(state, `${trigger.player} ${S.card(trigger.cardId).nameKo} 선택을 취소해 효과를 발휘하지 않음 (〔턴에 1회〕 소모 안 함)`); ctx._declined = true; }
  if (ctx._declined) { S.refundOnceUse(state, trigger); S.resolvePending(state, trigger.uid); render(); if (onceMark) { const u = onceMark.stack.turnEffectUses; if (u && u[onceMark.key] > 0) u[onceMark.key]--; } return; } // 15-7-1 / 15-14-1: a declined optional cost = the effect was never activated (no 〔턴에 1회〕 use consumed, nothing else runs)
  if (trigger.onceKey && ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup') S.refundOnceUse(state, trigger);
  if (onceMark && ctx._costUnpaid && script.length === 1 && script[0].op === 'costGroup') { const u = onceMark.stack.turnEffectUses; if (u && u[onceMark.key] > 0) u[onceMark.key]--; } // shard45: a sole cost that could not be paid means the effect was never activated -> its 〔턴에 N회〕 use is not consumed
  // Sentences the compiler can't express are handed to the player instead of silently vanishing.
  if (!trigger.manualOnly && !Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text, !!trigger.inherited)) { // bespoke scripts cover the whole segment
    const dropped = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text, !!trigger.inherited) ? [] : Effects.droppedSentences(trigger.text); // bespoke scripts implement the whole text
    if (dropped.length) {
      state.pending.push({ uid: 'rem' + Math.random().toString(36).slice(2), player: trigger.player, cardId: trigger.cardId, stackUid: trigger.stackUid, tags: trigger.tags, text: dropped.join(' '), resolved: false, manualOnly: true, note: '자동 처리되지 않은 나머지 효과 — 직접 처리하세요' });
    }
  }
  S.resolvePending(state, trigger.uid);
  render();
}

// 15-8-3-1: a triggered effect ALWAYS triggers once its condition is met —
// there's no top-level "activate or not" for the trigger itself in this
// game's rules (any real optionality is a sub-decision WITHIN resolution,
// e.g. "up to N cards" or picking a target, which the compiled script
// already pauses for via ctx.choose). So a pending item with a
// successfully-compiled script should just run the instant it appears,
// not sit waiting for a redundant "run it?" click. Only genuinely
// uncompiled text (script.length === 0) needs the manual fallback UI.
// NOTE: pending uids ('p1', 'p2', …) restart in every game, so this set is only valid for the game it was filled in (see syncAttempted) —
// otherwise a rematch / new game reuses the uids of an earlier game and its triggered effects would never auto-run (a softlock).
const autoRunAttempted = new Set();
let attemptedFor = null;
function syncAttempted() { if (attemptedFor !== state) { autoRunAttempted.clear(); attemptedFor = state; } }
let pendingRunner = null; // uid of the effect currently resolving — effects resolve ONE AT A TIME
let runningPendingUid = null;
// Game-epoch guard: the runner (and every async continuation of an effect) belongs to ONE state object. When the game is replaced
// (rematch, new game, undo, snapshot restore, load) the old runner is orphaned: it may be parked forever on a prompt of the dead
// state, and must neither block the new game's runner nor touch the new state when it finally wakes up (see docs/cpu-stall-fix.md).
let runnerTok = null;
const cpuDebug = (...a) => { try { if (window.__cpuDebug) console.log('[cpu-debug]', ...a); } catch (e) { /* ignore */ } };
function autoRunMandatoryPending() {
  syncAttempted();
  if (pendingRunner && runnerTok && runnerTok.st !== state) { cpuDebug('orphaned runner of a replaced game'); pendingRunner = null; runnerTok = null; runningPendingUid = null; }
  if (pendingRunner) return;
  // 4-3-2 simultaneous triggers: the TURN player resolves their waiting effects first (choosing the
  // order when there are several); only when none are left does the non-turn player's queue start.
  const waiting = state.pending.filter(t => !t.resolved && !t._running && !t.manualOnly && !autoRunAttempted.has(t.uid) && scriptFor(t).length);
  if (!waiting.length) return;
  // 15-16-10-2: a triggered 【시큐리티】 effect skips the waiting line and resolves at once. 15-4-5: effects that
  // triggered WHILE simultaneous ones were resolving (derived triggers, t.depth) resolve before the older waiting ones.
  const secNow = waiting.filter(t => t.evt && t.evt.kind === 'security');
  const tier = secNow.length ? secNow : (() => { const md = Math.max(...waiting.map(t => t.depth || 0)); return waiting.filter(t => (t.depth || 0) === md); })();
  const mine = tier.filter(t => t.player === state.activePlayer);
  const pool = mine.length ? mine : tier;
  const st0 = state;
  const tok = runnerTok = { st: st0 };
  pendingRunner = true; // set BEFORE the async body runs — ctxChoose renders synchronously and would re-enter here
  pendingRunner = (async () => {
    let next = pool[0];
    if (pool.length > 1) {
      const uid = await ctxChoose('pickPendingOrder', {
        player: pool[0].player,
        items: pool.map(t => ({ uid: t.uid, label: `${S.card(t.cardId).nameKo} 【${t.tags.map(tagLbl).join('】【')}】 ${t.text.replace(/\([^()]*\)/g, '').slice(0, 60)}` })),
        prompt: `${pool[0].player}: 동시에 발동 대기 중인 효과 ${pool.length}개 — 먼저 처리할 효과를 선택하세요 (룰 4-3-2${mine.length ? ', 턴 플레이어 우선' : ''})`,
      });
      // 단발성: 이 묶음만 무작위로 정하고 끝 — 예전에는 세션 내내 자동 랜덤으로 고정되는 플래그였는데,
      // 그 뒤로 묻지도 않고 계속 자동 처리되는 게 "내가 조작한 적 없는데 자꾸 (알아서) 진행된다"는 혼란을 줘서 매번 다시 물어보도록 변경.
      if (uid === '__random__') { next = pool[Math.floor(Math.random() * pool.length)]; S.log(state, `${pool[0].player} 동시 발동 효과 ${pool.length}개 — 이번만 무작위 순서로 처리: ${S.card(next.cardId).nameKo}`); }
      else next = pool.find(t => t.uid === uid) || pool[0];
    }
    if (state !== st0 || next.resolved) return; // the game was replaced (rematch / new game / undo / load) while the order prompt was open, or the effect was closed meanwhile
    autoRunAttempted.add(next.uid);
    runningPendingUid = next.uid;
    const knownUids = new Set(state.pending.map(x => x.uid));
    try { await runPendingScript(next, { delay: true }); }
    finally { if (state === st0) for (const x of state.pending) if (!knownUids.has(x.uid) && x.depth == null) x.depth = (next.depth || 0) + (x.rcSim ? 0 : 1); } // rcSim: 15-4-3-3 rule-check deletion triggers alongside the waiting ones // 15-4-5 derived triggers
  })().catch((err) => { try { console.warn('[effect runner]', err); if (state === st0) S.log(state, '효과 처리 오류(무시): ' + (err && err.message)); } catch (e2) { /* ignore */ } }).finally(() => {
    if (runnerTok !== tok) return; // orphaned (game replaced / watchdog re-armed): a newer runner owns the flags now
    pendingRunner = null; runnerTok = null; runningPendingUid = null;
    render(); // chains into the next queued effect
  });
}

function renderPendingEffects() {
  if (!state.pending.length) return null;
  const rows = state.pending.map(t => {
    const c = S.card(t.cardId);
    const script = t.manualOnly ? [] : scriptFor(t);
    return h('div', { className: `effect-box${script.length && t.uid === runningPendingUid ? ' effect-firing' : ''}`, style: `margin-bottom:6px;${script.length && t.uid !== runningPendingUid ? 'opacity:.6;' : ''}` }, [
      h('div', { className: 'effect-firing-title' }, `⚡ ${c.nameKo} 【${t.tags.map(tagLbl).join('】【')}】 발동`),
      h('div', {}, t.text),
      t.note ? h('div', { className: 'meta' }, '⚠ ' + t.note) : null,
      h('div', { className: 'actions-row', style: 'margin-top:6px;' }, [
        script.length
          ? h('span', { className: 'meta' }, t.uid === runningPendingUid ? '▶ 처리 중…' : t.resolved ? '완료' : `⏳ 대기 중 (순서 ${state.pending.filter(x => !x.resolved && scriptFor(x).length).indexOf(t) + 1})`)
          : h('span', { className: 'meta' }, '자동 인식 실패 — 아래 버튼이나 범용 도구로 수동 처리'),
        ...quickApplyButtonsFor(t.text, t.player),
        h('button', { className: 'danger', onClick: () => { if (netIntercept('closePending', [t.uid])) return; S.resolvePending(state, t.uid); render(); } }, '처리 완료 (닫기)'),
      ]),
    ]);
  });
  return h('div', {}, [h('div', { className: 'section-title' }, '발동 대기 중인 효과'), ...rows]);
}

function renderUiChoice() {
  const uc = state.uiChoice;
  if (!uc) return null;
  const { kind, payload, resolve } = uc;
  const fxr = state._fxRec; // which card is asking (shown inline at the top of every choice modal)
  const rows = [fxr && fxr.src && fxr.src.kind === 'effect' && (fxFieldOn() || cpuOn) ? h('div', { className: 'fxf-modal-src fxf-' + fxr.src.owner }, ['📌 ' + fxSrcLabel(fxr), fxWhyNote(fxr, true) ? h('div', { className: 'meta' }, fxWhyNote(fxr, true)) : null]) : null, h('div', { className: 'effect-box' }, payload.prompt || '선택하세요')].filter(Boolean);

  if (kind === 'pickPendingOrder') {
    payload.items.forEach((it, i) => rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${i + 1}. ${it.label}`),
      h('button', { className: 'primary', onClick: () => resolve(it.uid) }, '먼저 처리'),
    ])));
    rows.push(h('div', { className: 'actions-row', style: 'margin-top:4px;border-top:1px solid var(--holo-line);padding-top:6px;' }, [
      h('button', { title: '이번에 동시에 발동 대기 중인 효과들 중 하나를 무작위로 골라 먼저 처리합니다 (이번 한 번만 — 다음에 또 동시 발동이 생기면 다시 물어봅니다)', onClick: () => resolve('__random__') }, '🎲 무작위로 하나 선택 (이번만)'),
    ]));
  } else if (kind === 'confirmEffect') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { className: 'primary', onClick: () => resolve(true) }, payload.yesLabel || '발동한다'),
      h('button', { onClick: () => resolve(false) }, payload.noLabel || '발동하지 않는다'),
    ]));
    // 발동 대기 큐를 처리 중인 확인창에서만 보여준다 — 카드를 낼 때의 《어셈블리》/《디지크로스》/코스트 할인
    // 확인창(main.js askYN)은 대기 큐와 무관하므로 여기서 끄면 안 됨 (ctxChoose의 payload._pendingResolution 체크와 짝)
    if (payload._pendingResolution) rows.push(h('div', { className: 'actions-row', style: 'margin-top:4px;border-top:1px solid var(--holo-line);padding-top:6px;' }, [
      h('button', {
        title: '지금 대기 중인 효과들(이 선택 포함)만 전부 발휘하지 않는 것으로 자동 응답합니다 — 단발성이라 이후 새로 발동 대기하는 효과는 다시 물어봅니다',
        onClick: () => { sel.declineAllRemaining = new Set(state.pending.filter(t => !t.resolved).map(t => t.uid)); resolve(false); },
      }, '🚫 지금 대기 중인 효과 전부 발휘하지 않음'),
    ]));
  } else if (kind === 'pickStack') {
    // uids are usually payload.player's own stacks, but some pickers (《돌진》의 어택 대상 변경 등) hand over the OPPONENT's
    // uids while payload.player stays the decision-maker — looking them up only on payload.player's side silently found
    // nothing, so the picker rendered as if there were no targets at all. Fall back to the other side before giving up.
    const cards = payload.uids.map(uid => {
      let owner = payload.player, pl = state.players[owner];
      let st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
      if (!st) { owner = S.opponentOf(payload.player); pl = state.players[owner]; st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid); }
      return { uid, cardId: st?.cardId, owner };
    }).filter(x => x.cardId);
    rows.push(h('div', { className: 'stack-list' }, cards.map(x => cardChip(x.cardId, { owner: x.owner, onClick: () => resolve(x.uid) }))));
    if (!(payload.required && cards.length)) rows.push(h('button', { onClick: () => resolve(null) }, '대상 없음 / 취소')); // 1-3-6: a required choice can't pick zero
  } else if (kind === 'pickStackAnySide') {
    const cards = payload.entries.map(({ player, uid }) => {
      const pl = state.players[player];
      const st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
      return { player, uid, cardId: st?.cardId };
    }).filter(x => x.cardId);
    rows.push(h('div', { className: 'stack-list' }, cards.map(x => cardChip(x.cardId, {
      owner: x.player,
      selected: false,
      onClick: () => resolve({ player: x.player, uid: x.uid }),
    }))));
    if (!(payload.required && cards.length)) rows.push(h('button', { onClick: () => resolve(null) }, '대상 없음 / 취소'));
  } else if (kind === 'pickFromHand') {
    const pl = state.players[payload.player];
    const idxs = pl.hand.map((id, i) => i);
    rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl.hand[i], { owner: payload.player, onClick: () => resolve(pl.hand[i]) }))));
    if (!(payload.required && idxs.length)) rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
  } else if (kind === 'pickFromHandIndexes' || kind === 'pickFromZoneIndex') {
    const pl = state.players[payload.player];
    const zone = payload.zone || 'hand';
    const idxs = payload.eligibleIdxs;
    if (kind === 'pickFromZoneIndex') {
      rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl[zone][i], { owner: payload.player, onClick: () => resolve(i) }))));
      if (!(payload.required && idxs.length)) rows.push(h('button', { onClick: () => resolve(null) }, '선택 안 함'));
    } else {
      if (!state._multiPick) state._multiPick = [];
      const picked = state._multiPick;
      rows.push(h('div', { className: 'hand-list' }, idxs.map(i => cardChip(pl.hand[i], {
        owner: payload.player,
        selected: picked.includes(i),
        onClick: () => { const p = picked.indexOf(i); if (p === -1) { if (payload.n === 1) picked.length = 0; /* pick-exactly-1: choosing another card swaps the choice (used to give "2/1장 선택됨" + a dead 확인) */ picked.push(i); } else picked.splice(p, 1); render(); },
      }))));
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, `${picked.length}/${payload.n}장 선택됨`),
        h('button', {
          className: 'primary', disabled: picked.length !== payload.n,
          onClick: () => { const result = picked.slice(); state._multiPick = []; resolve(result); },
        }, '확인'),
      ]));
    }
  } else if (kind === 'pickFromRevealed') {
    if (!state._multiPick) state._multiPick = [];
    const picked = state._multiPick;
    if (payload.eligible.length && payload.min >= payload.eligible.length && payload.max >= payload.eligible.length && !picked.length && !state._multiPickTouched) picked.push(...payload.eligible.map(x => x.i)); // "전부": every eligible card is preselected (nothing to decide)
    rows.push(h('div', { className: 'hand-list' }, payload.revealed.map((id, i) => {
      const eligible = payload.eligible.some(x => x.i === i);
      return cardChip(id, {
        selected: picked.includes(i), target: eligible,
        onClick: eligible ?() => { const p = picked.indexOf(i); if (p === -1 && payload.max === 1) { picked.length = 0; picked.push(i); } else if (p === -1 && picked.length < payload.max) picked.push(i); else if (p !== -1) picked.splice(p, 1); render(); } : undefined,
      });
    })));
    { // eligible cards are marked in the list above ("✔ 선택 가능" chips are clickable); with none, say so and let the player just continue
      const noEl = !payload.eligible.length;
      const DEST_TXT = {
        play: '코스트 없이 등장', hand: '패에 추가', trash: '파기', evolve: '코스트 없이 진화', useOption: '코스트 없이 사용', use: '코스트 없이 사용', security: '시큐리티 위에 놓기',
        srcThis: '진화원 아래에 놓기', srcOwn: '진화원 아래에 놓기', tamerUnder: '테이머 아래에 놓기', sourcesOf: '진화원 아래에 놓기',
        // moveEach 연산(effects.js case 'moveEach')이 쓰는 dest 값들 — 위의 srcThis/srcOwn/sourcesOf(다른 메커니즘)와는 이름이 다르다
        thisSources: '이 카드의 진화원 아래에 놓기', otherSources: '다른 디지몬의 진화원 아래에 놓기', securityBottom: '시큐리티 아래에 놓기',
        eggBottom: '디지타마 덱 아래로 되돌림', deckTop: '덱 위로 되돌림', deckBottom: '덱 아래로 되돌림',
      };
      const destTxt = !payload.dest ? '패에 추가' : (DEST_TXT[payload.dest] || payload.dest);
      const lookOnly = payload.dest === 'none'; // reveal-only prompt (nothing may be picked): just show the cards
      rows.push(h('div', { className: 'step-info' }, lookOnly ? '오픈한 카드를 확인하세요 — 확인을 누르면 계속합니다.' : noEl ? '조건에 맞는 카드가 없습니다 — 그대로 진행합니다.' : `조건에 맞는 카드 ${payload.eligible.length}장 (${destTxt}) — 선택 가능한 카드만 클릭할 수 있습니다.${payload.required ? ' (반드시 선택)' : ''}`));
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, `${picked.length}장 선택 (최대 ${payload.max})`),
        h('button', { className: 'primary', disabled: picked.length < Math.max(payload.min || 0, payload.required && payload.eligible.length ? 1 : 0), onClick: () => { const result = picked.slice(); state._multiPick = []; resolve(result); } }, noEl ? '확인 (나머지 자동 처리)' : `확인 (${destTxt}, 나머지 자동 처리)`),
      ]));
    }
  } else if (kind === 'pickSourcesMulti') {
    if (!state._multiPick) state._multiPick = [];
    const picked = state._multiPick;
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => cardChip(id, {
      selected: picked.includes(i),
      onClick: () => { const k = picked.indexOf(i); if (k === -1) { if (payload.n === 1) picked.length = 0; if (picked.length < payload.n) picked.push(i); } else picked.splice(k, 1); render(); },
    }))));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `${picked.length}/${payload.n}장 선택됨`),
      h('button', { className: 'primary', disabled: picked.length !== payload.n, onClick: () => { const r = picked.slice().sort((a, b) => a - b); state._multiPick = []; resolve(r); } }, '확인'),
    ]));
  } else if (kind === 'pickLinkCard') {
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => cardChip(id, { onClick: () => resolve(i) }))));
  } else if (kind === 'orderCards') {
    // 3-1-3-4 / 15-15-3-6: the owner picks the order in which several cards are placed at once (click in order; first = top)
    if (!state._orderPick) state._orderPick = [];
    const ord = state._orderPick;
    rows.push(h('div', { className: 'hand-list' }, payload.ids.map((id, i) => {
      const pos = ord.indexOf(i);
      return cardChip(id, { selected: pos !== -1, keywordBadges: pos !== -1 ? [`#${pos + 1}`] : undefined, onClick: () => { if (pos === -1) ord.push(i); else ord.splice(pos, 1); render(); } });
    })));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, `순서 ${ord.length}/${payload.ids.length} (숫자 = 위에서부터의 순서, 다시 누르면 취소)`),
      h('button', { onClick: () => { state._orderPick = []; render(); } }, '초기화'),
      h('button', { className: 'primary', disabled: ord.length !== payload.ids.length, onClick: () => { const r = ord.slice(); state._orderPick = []; resolve(r); } }, '확인'),
    ]));
  } else if (kind === 'multipleChoice') {
    rows.push(h('div', { className: 'actions-row' }, payload.options.map((label, i) => h('button', { onClick: () => resolve(i) }, label))));
  }

  return h('div', { className: 'player-panel' }, rows);
}

// The attack flow (declaration → counter → block → result) and any
// ctx.choose() prompt are both "must address now" dialogs — floated as a
// centered modal instead of buried in the bottom actions bar, which could
// be scrolled/collapsed out of view. Checked in render() before the
// regular actions panel; whichever of these exists takes over the screen.
const gameOverAt = { state: null, t: 0 };
let gameOverSeen = null; // the state object whose result popup the player already closed
function renderGameOverModal() {
  if (gameOverSeen === state) return null;
  // 마지막 시큐리티 체크 연출을 잠깐(약 1.4초) 보여 준 뒤, 어택 창이 열려 있어도 그 위를 덮어 종료를 확실히 알린다
  if (gameOverAt.state !== state) { gameOverAt.state = state; gameOverAt.t = Date.now(); }
  const wait = 1400 - (Date.now() - gameOverAt.t);
  if (wait > 0) { setTimeout(() => { if (state && state.winner) render(); }, wait + 30); return null; }
  const w = state.winner;
  const why = ((state.log.find(e => /승리|패배|투항|무승부/.test(String(e.msg))) || {}).msg || '').replace(/^🤖 CPU: /, '');
  const mine = cpuOn ? (w === 'p1' ? 'win' : w === 'draw' ? 'draw' : 'lose') : Net.NET.role ? (w === 'draw' ? 'draw' : w === Net.NET.mySeat ? 'win' : 'lose') : (w === 'draw' ? 'draw' : 'win');
  const title = w === 'draw' ? '🤝 무승부' : cpuOn ? (w === 'p1' ? '🎉 승리!' : '💀 패배…') : Net.NET.role ? (w === Net.NET.mySeat ? '🎉 승리!' : '💀 패배…') : `🏆 ${w.toUpperCase()} 승리!`;
  const sub = w === 'draw' ? '영구 순환 (18-3-2)' : cpuOn ? (w === 'p1' ? '당신(P1)이 이겼습니다' : 'CPU(P2)가 이겼습니다') : Net.NET.role ? (w === Net.NET.mySeat ? '당신이 이겼습니다' : '상대가 이겼습니다') : `승자: ${w}`;
  const close = () => { gameOverSeen = state; render(); };
  return h('div', { className: 'modal-backdrop go-backdrop', onClick: (e) => { if (e.target === e.currentTarget) close(); } }, [
    h('div', { className: `modal-panel go-panel go-${mine}`, role: 'dialog', 'aria-label': '게임 결과' }, [
      h('div', { className: 'go-title' }, title),
      h('div', { className: 'go-sub' }, sub),
      why ? h('div', { className: 'go-why' }, `사유: ${why}`) : null,
      h('div', { className: 'go-btns' }, [
        (Net.NET.role === 'guest') ? null : (lastStartPick && lastStartPick.p1 && lastStartPick.p2) ? h('button', { className: 'primary', onClick: () => { restartHand(); } }, '🔁 같은 덱으로 재대전') : null,
        (Net.NET.role === 'guest') ? null : h('button', { className: lastStartPick ? '' : 'primary', onClick: () => { state = null; sel = { hand: null, stack: null, stack2: null, armFusion: false, player: 'p1' }; render(); } }, '새 게임 (덱 선택으로)'),
        h('button', { title: '이 대전의 모든 스텝을 파일로 저장 — 시작 화면의 "리플레이 불러오기"로 처음부터 다시 볼 수 있습니다', onClick: () => { PR.saveReplayFile(); } }, '🎞 리플레이 저장'),
        h('button', { onClick: close }, '필드 확인 (닫기)'),
      ]),
    ]),
  ]);
}

// 옆 도크: 발동 대기 중인 효과는 왼쪽, 어택 진행은 오른쪽 사이드에 붙여 필드를 가리지 않는다 (데스크톱은 필드가 도크만큼 옆으로 비켜 서고,
// 모바일은 아래 시트로 나오며 ◀/▶ 로 접어 필드를 한눈에 볼 수 있다). 접은 상태는 panelsOpen.dockL / dockR.
function dockPanel(side, title, bodyNodes, pillText) {
  const key = side === 'left' ? 'dockL' : 'dockR';
  if (panelsOpen[key] === false) return h('button', { className: `dock-pill dock-pill-${side}`, title: '눌러서 다시 펼치기', onClick: () => { panelsOpen[key] = true; render(); } }, pillText || title);
  return h('div', { className: `dock dock-${side}`, role: 'complementary', 'aria-label': title }, [
    h('div', { className: 'dock-head' }, [h('b', {}, title), h('button', { className: 'dock-x', title: '접어서 필드 보기', onClick: () => { panelsOpen[key] = false; render(); } }, side === 'left' ? '◀ 접기' : '접기 ▶')]),
    h('div', { className: 'dock-body' }, bodyNodes),
  ]);
}

function renderModal() {
  if (state.winner) return renderGameOverModal(); // 승패가 갈리면 결과 팝업 (닫으면 최종 필드를 읽기 전용으로 볼 수 있음; 상단 바에도 결과가 남는다)
  if (state.uiChoice && state.uiChoice.hold) return null; // waiting for the activation VFX to finish (ctxChoose) — nothing may pile on top of it
  if (state.uiChoice && uiChoiceByCpu(state.uiChoice)) { // a prompt that belongs to the CPU: read-only note (the CPU driver answers it)
    const pr = state.uiChoice.payload && state.uiChoice.payload.prompt;
    return h('div', { className: 'cpu-choice-note' }, ['🤖 CPU가 선택 중…', pr ? h('div', { className: 'meta' }, String(pr).slice(0, 160)) : null]);
  }
  if (state.uiChoice && uiChoiceByOpponentOnline(state.uiChoice)) { // 상대 자리의 결정: 읽기 전용으로만 보여준다 (버튼 없음)
    const pr = state.uiChoice.payload && state.uiChoice.payload.prompt;
    return h('div', { className: 'cpu-choice-note' }, ['⏳ 상대가 선택 중…', pr ? h('div', { className: 'meta' }, String(pr).slice(0, 160)) : null]);
  }
  const choiceUi = renderUiChoice();
  if (choiceUi) {
    const uc = state.uiChoice, pr = String((uc.payload && uc.payload.prompt) || '').replace(/\s+/g, ' ');
    const KIND = { pickStack: '대상 선택', pickStackAnySide: '대상 선택', pickFromHand: '패에서 선택', pickFromHandIndexes: '패에서 선택', pickFromZoneIndex: '선택', pickFromRevealed: '오픈한 카드 선택', pickSourcesMulti: '진화원 선택', pickLinkCard: '링크 카드 선택', orderCards: '순서 선택', multipleChoice: '선택지', confirmEffect: '발동 확인', pickPendingOrder: '처리 순서' };
    const fr = state._fxRec, src = fr && fr.src && fr.src.kind === 'effect' ? fxSrcLabel(fr) : '';
    const what = KIND[uc.kind] || '선택';
    const cancelable = uc.kind === 'confirmEffect' || (!(uc.payload && uc.payload.required) && /^pick(Stack|StackAnySide|FromHand|FromZoneIndex)$/.test(uc.kind));
    return peekWrap(h('div', { className: 'modal-backdrop' }, [h('div', { className: 'modal-panel' }, [choiceUi])]), { key: peekIdOf(uc), title: src ? `📌 ${src} — ${what}` : what, pill: `선택 대기: ${src ? src + ' — ' : ''}${what}${src ? '' : pr ? ' — ' + pr.slice(0, 30) : ''} (누르면 다시 열기)`, cancelable });
  }
  if (state._scriptedPierce) { // ≪관통≫ bonus check fired by a scripted "can battle" op (scriptedSecurityCheck) — see busy()/renderPendingAttack for the normal-attack equivalent
    const { attacker, ctl } = state._scriptedPierce;
    const rows = [h('div', { className: 'section-title' }, `≪관통≫ 보너스 시큐리티 체크 — ${attacker}`)];
    ctl.results.forEach((r, i) => rows.push(h('div', { className: 'meta' }, r.empty ? `체크 ${i + 1}: 시큐리티 0 — 공격측 승리` : `체크 ${i + 1}/${ctl.total}: ${S.card(r.revealed).nameKo}(DP${r.secDp}) vs 공격측 DP${r.atkDp} → ${r.result}`)));
    if (!ctl.done) rows.push(h('div', { className: 'meta' }, '진행 중…'));
    return peekWrap(h('div', { className: 'modal-backdrop' }, [h('div', { className: 'modal-panel' }, rows)]), { key: 'scriptedPierce', title: '≪관통≫ 체크', pill: '≪관통≫ 보너스 시큐리티 체크 진행 중', cancelable: false });
  }
  const jogressUi = busy() ? null : renderJogressModal();
  if (jogressUi) return peekWrap(h('div', { className: 'modal-backdrop' }, [h('div', { className: 'modal-panel' }, [jogressUi])]), { key: 'jogress', title: '조그레스/DNA 진화', pill: '조그레스 선택 대기 (누르면 다시 열기)', cancelable: true });
  const pendingUi = renderPendingAttack();
  if (pendingUi) { peekNone(); return dockPanel('right', '⚔ 공격 진행', [pendingUi], `⚔ 공격 진행: ${String(sel.pendingAttack.info || sel.pendingAttack.stage || '').replace(/\s+/g, ' ').slice(0, 24)}`); }
  peekNone();
  return null;
}

function renderActions() {
  if (state.winner) return h('div', { className: 'actions' });

  // 11-1-4: a timing never advances until everything resolvable in it is
  // resolved — a triggered effect from the attack declaration (or anything
  // else queued) must be dealt with before the Counter/Block/etc. attack-
  // flow UI is shown, not hidden behind it.
  const pendingEffectsUiEarly = renderPendingEffects();
  if (pendingEffectsUiEarly) { return h('div', { className: 'actions actions-attention actions-dock' }, [dockPanel('left', '⏳ 발동 대기 중인 효과', [pendingEffectsUiEarly], '⏳ 대기 효과')]); }

  const pendingEffectsUi = renderPendingEffects();

  // Everything here is optional/reference info once a turn is underway — the
  // field is the focus, so this whole panel starts collapsed. A mandatory
  // pending effect (something the player MUST resolve) always forces it open.
  if (!panelsOpen.actions && !pendingEffectsUi) {
    return h('div', { className: 'actions actions-collapsed' }, [
      h('div', {
        className: 'panel-tab', onClick: () => { panelsOpen.actions = true; render(); },
      }, `▲ 조작 패널 — ${PHASE_LABEL[state.phase] || state.phase} (${state.activePlayer})`),
    ]);
  }

  const rows = [];
  rows.push(h('div', {
    className: 'section-title clickable',
    onClick: () => { panelsOpen.actions = false; render(); },
  }, `▼ ${PHASE_LABEL[state.phase] || state.phase} — ${state.activePlayer} (클릭=접기)`));

  if (pendingEffectsUi) rows.push(pendingEffectsUi);

  if (state.phase === 'breeding') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', { className: 'meta' }, '디지타마 파일 탭/클릭 = 부화, 육성 에어리어의 카드 탭/클릭 = 배틀 이동 (둘 다 선택사항이지만 이번 턴엔 둘 중 하나만 가능)'),
    ]));
  }

  if (state.phase === 'main') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '핸드:'), h('b', {}, sel.hand ? S.card(sel.hand.cardId).nameKo : '-'),
      h('span', {}, '스택1:'), h('b', {}, describeSelectedStackName(sel.stack)),
      h('span', {}, '스택2:'), h('b', {}, describeSelectedStackName(sel.stack2)),
      h('span', {}, 'DNA/링크 코스트'), numInput('costInput', 0),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', { className: 'meta' }, '[PC] 핸드→필드/내 디지몬 드래그 = 등장·진화 · 스택1+스택2 선택 후 핸드→스택2 드래그 = DNA/조그레스 · 🔗 배지에 드롭 = 링크 · 내 디지몬→상대 진영 드래그 = 공격  [모바일] 핸드 카드 탭 → 초록 테두리 대상(배틀 에어리어/내 디지몬/🔗) 탭 · 내 디지몬 탭 → ⚔공격 → 대상 탭'),
    ]));
  }

  if (Net.NET.role !== 'guest') rows.push(h('div', { // 온라인: 범용 도구(수동 상태 조작)는 호스트에서만
    className: 'section-title clickable',
    onClick: () => { panelsOpen.advancedTools = !panelsOpen.advancedTools; render(); },
  }, `${panelsOpen.advancedTools ? '▼' : '▶'} 범용 도구 (카드 효과 수동 처리용 — 평소엔 접어두세요)`));

  if (panelsOpen.advancedTools && Net.NET.role !== 'guest') {
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '대상'),
      ...['p1', 'p2'].map(p => h('button', { className: sel.player === p ? 'primary' : '', onClick: () => { sel.player = p; render(); } }, p)),
      h('span', {}, '장수'), numInput('genN', 1),
      h('button', { onClick: () => { S.drawCards(state, sel.player, val('genN')); render(); } }, '드로우'),
      h('button', { onClick: () => { S.trashTopOfDeck(state, sel.player, val('genN')); render(); } }, '덱 위 파기'),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('button', { onClick: () => { S.trashTopSecurityByEffect(state, sel.player); render(); } }, '시큐리티 맨 위 효과로 파기'),
      h('button', { onClick: () => { S.trashBottomSecurityByEffect(state, sel.player); render(); } }, '시큐리티 맨 밑 효과로 파기'),
      h('span', {}, '카드ID'), h('input', { id: 'secCardId', placeholder: 'e.g. BT25-034' }),
      h('button', { onClick: () => { const id = document.getElementById('secCardId').value.trim(); if (id) S.addToSecurity(state, sel.player, id, 'top'); render(); } }, '핸드지정없이 시큐리티 맨위 추가(id입력)'),
      h('button', { onClick: () => { const id = document.getElementById('secCardId').value.trim(); if (id) S.addToSecurity(state, sel.player, id, 'bottom'); render(); } }, '맨밑 추가(id입력)'),
    ]));
    rows.push(h('div', { className: 'actions-row' }, [
      h('span', {}, '메모리'), numInput('memN', 1),
      h('button', { onClick: () => { S.grantMemory(state, sel.player, val('memN')); render(); } }, '메모리 획득 적용'),
      h('span', {}, '퇴화 단수'), numInput('retN', 1),
      h('button', { disabled: !sel.stack, onClick: () => { S.retreat(state, sel.stack.player, sel.stack.uid, val('retN')); render(); } }, '선택 스택 퇴화'),
      h('button', { className: 'danger', disabled: !sel.stack, onClick: () => { S.deleteStack(state, sel.stack.player, sel.stack.uid); sel.stack = null; render(); } }, '선택 스택 소멸(트래시)'),
    ]));
  }

  return h('div', { className: `actions${pendingEffectsUi ? ' actions-attention' : ''}` }, rows);
}

function findStack(selRef) {
  if (!selRef) return null;
  const pl = state.players[selRef.player];
  if (pl.raising?.uid === selRef.uid) return pl.raising;
  return pl.battle.find(s => s.uid === selRef.uid) || null;
}

function describeSelectedStackName(selRef) {
  const stack = findStack(selRef);
  return stack ? S.card(stack.cardId).nameKo : '없음';
}

function describeSelectedEffects() {
  if (!sel.stack && !sel.hand) return '';
  const parts = [];
  const showCard = (id) => {
    const c = S.card(id);
    const bits = [`${c.nameKo} (${id}) Lv.${c.level ?? '-'} ${c.colors?.join('/') || ''} 코스트${c.cost ?? "-"} DP${c.dp ?? '-'}`];
    if (c.evoNormal) bits.push(`진화: ${(c.evoNormal.colors||[]).join('/')} Lv.${c.evoNormal.level}→코스트${c.evoNormal.cost}`);
    if (c.effectKo) bits.push(c.effectKo);
    if (c.dual) bits.push(`[옵션 쪽: 사용 코스트 ${S.optionView(id).cost}, 색 ${(S.optionView(id).colors || []).join('/')}] ${c.optionKo || ''}`);
    { const inhLines = (c.inheritedKo || '').split('\n'); const inh = inhLines.filter(l => !/^\s*【시큐리티】/.test(l)).join('\n'), secL = inhLines.filter(l => /^\s*【시큐리티】/.test(l)).join('\n'); if (inh) bits.push('[진화원효과] ' + inh); if (secL) bits.push('[시큐리티효과] ' + secL); } // 시큐리티 효과는 진화원 효과가 아니다
    parts.push(bits.join('\n'));
  };
  if (sel.hand) showCard(sel.hand.cardId);
  const stack = findStack(sel.stack);
  if (stack) {
    showCard(stack.cardId);
    stack.sources.forEach(id => showCard(id));
  }
  return parts.join('\n\n');
}


// Some option effects grant a one-off "can only directly attack a Digimon
// if you also control a named ally" style restriction — shared between the
// direct-drop auto-resolve path and the fallback target-choice menu.
function blockedFromDigimonTarget(p, attackerStack) {
  const restrictions = attackerStack?.dynamicRestrictions || [];
  return restrictions.some(r => {
    if (r.type !== 'noDigimonAttackUnlessOwn') return true;
    return !state.players[p].battle.some(s => S.card(s.cardId).nameKo.includes(r.filter.nameIncludes));
  });
}

// `directTarget`: 'PLAYER' to attack the opponent player directly, an
// opposing stack uid to attack that specific Digimon, or omitted to fall
// back to the target-choice menu (e.g. an illegal/ambiguous drop). Letting
// the drop location itself express the target — instead of always opening
// a menu — is what makes attack (the single most common action) a single
// drag instead of drag-then-pick-from-a-list.
// ≪블로커≫ can only intercept if the defender actually controls an ACTIVE
// Digimon with the keyword (using it rests that Digimon) — asking "does the
// opponent block?" when they have none is both misleading and an
// unnecessary extra click.
// 16-30 ≪충돌≫: while the attacker has it, EVERY one of the opponent's
// Digimon is granted Blocker for this attack and must block if able (11-4/
// 12-1's normal "may block" becomes mandatory) — checked live since it only
// matters for the exact attack in progress, not tracked as a cached keyword.
// ---- step-by-step pacing (attack timings + effect resolution) ----
// Every attack timing (대상 변경 → 카운터 → 블록 → 결과) is now shown as its own step
// even when nothing can be decided in it, instead of the whole chain resolving in
// one render. Auto mode advances after a short visible pause (and waits for any
// pending effect to finish first); manual mode waits for the "다음 단계" button.
// 읽기 속도: 사람이 읽어야 하는 문구(단계 설명, 효과 결과, 알림)는 글자 수에 비례해 오래 보여 준다.
const READ_SPEEDS = { slow: 2.6, normal: 1.7, fast: 1.0 }; // 사람이 인지하기엔 이전 값(1.6/1.0/0.6)이 너무 빨랐다
const READ = { speed: 'normal' };
try { const v = localStorage.getItem('digimon_read_speed'); if (v && v in READ_SPEEDS) READ.speed = v; } catch (e) { /* ignore */ }
function readMs(text, minMs = 1500, maxMs = 14000) {
  const chars = String(text || '').replace(/\s+/g, '').length;
  return Math.round(Math.min(maxMs, Math.max(minMs, 900 + chars * 85)) * READ_SPEEDS[READ.speed]);
}
const STEP = { manual: false, delay: 2000 };
try { STEP.manual = localStorage.getItem('digimon_step_manual') === '1'; } catch (e) { /* ignore */ }

function runPendingNext(pa) {
  const next = pa.pendingNext;
  if (!next) return;
  pa.pendingNext = null; pa.paused = false; pa.token = (pa.token || 0) + 1;
  next();
  render();
}

function stepPause(pa, stage, info, next) {
  pa.stage = stage; pa.info = info; pa.pendingNext = next; pa.paused = true;
  const token = pa.token = (pa.token || 0) + 1;
  if (STEP.manual) return;
  const tick = () => {
    if (sel.pendingAttack !== pa || pa.token !== token || !pa.pendingNext) return;
    // Don't run ahead of an effect that is still resolving (its banner is on screen).
    if (state.pending.some(t => !t.resolved && scriptFor(t).length) || state.uiChoice) { setTimeout(tick, 150); return; }
    runPendingNext(pa);
  };
  // 처리할 효과/선택지가 없는 단계("…없습니다", "다음 체크로 넘어갑니다")는 0.2초만 보여 주고 바로 넘어간다.
  const idleStep = /없습니다|넘어갑니다/.test(String(info || ''));
  setTimeout(tick, idleStep ? 200 : Math.max(STEP.delay, readMs(info, 1300, 8000)));
}

function eligibleBlockers(p, collidingAttacker) {
  // 12-1-4: a Digimon that can't be rested can't block.
  if (collidingAttacker) return state.players[p].battle.filter(s => S.card(s.cardId).category === 'digimon' && !s.suspended && S.canRestByRule(state, p, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, p, s));
  return state.players[p].battle.filter(s => (S.hasKeyword(s, '블로커') || S.hookGrantedKeywords(state, p, s).includes('블로커')) && !s.suspended && S.canRestByRule(state, p, s) && !S.s3Flag(state, s, 'noBlock') && !S.hookNoBlock(state, p, s));
}

// Runs the security check and — same as resolveDigimonBattle already does
// for digimon-vs-digimon combat — immediately destroys the attacker if it
// lost. There's no tracked "survives destruction" keyword in this game (no
// card prints one; each is bespoke text), so this must never be left as an
// unconditional player choice — that was letting an attacker survive with
// no actual effect backing it up.
function runSecurityCheck(pa) {
  pa.secCtl = S.beginSecurityCheck(state, pa.attacker, pa.uid, pa.opp);
  pa.secCtl.deferBattle = true; // reveal -> resolve 【시큐리티】 effect -> battle (13-1-8)
  pa.res = { checks: pa.secCtl.results, gameOver: false };
  pa.secDone = false;
  pa.stage = 'result';
  doSecurityStep(pa);
}

// One security check per visible step: reveal → its 【시큐리티】 effect is queued →
// (pause) → next check. The attacker's loss is applied only after the last check.
function doSecurityStep(pa) {
  const ctl = pa.secCtl;
  if (ctl.awaiting) S.battleSecurityCheck(ctl, ctl.awaiting.id); // 13-1-8-3: battle only after the 【시큐리티】 effect (13-1-8-2) has resolved
  else S.stepSecurityCheck(ctl);
  pa.res.gameOver = ctl.gameOver;
  if (ctl.awaiting) {
    stepPause(pa, 'result', `시큐리티 체크 ${ctl.i + 1}/${ctl.total}: ${S.card(ctl.awaiting.id).nameKo} 공개 — 【시큐리티】 효과 처리 후 배틀합니다`, () => doSecurityStep(pa));
    return;
  }
  if (ctl.done) {
    // BT8-095 (Q4705): a replacement (≪아머 퍼지≫ …) that keeps the loser in the battle area lets the remaining ≪S 어택≫ checks continue
    const lossR = ctl.gameOver ? 'none' : S.settleSecurityLoss(ctl);
    const contMsg = () => `시큐리티 체크 ${ctl.i}/${ctl.total} 완료 — 공격 디지몬이 소멸하지 않아 다음 체크로 넘어갑니다`;
    if (lossR === 'survived') { stepPause(pa, 'result', contMsg(), () => doSecurityStep(pa)); return; }
    if (lossR === 'deferred') { // interactive replacement prompt parked: S.resumeReplacement reports the outcome here
      ctl.onLossResolved = (r2) => { if (r2 === 'survived') stepPause(pa, 'result', contMsg(), () => doSecurityStep(pa)); else { pa.secDone = true; finishAttackRules(pa); } render(); };
      return;
    }
    pa.secDone = true;
    finishAttackRules(pa);
  } else {
    stepPause(pa, 'result', `시큐리티 체크 ${ctl.i}/${ctl.total} 완료 — 다음 체크로 넘어갑니다`, () => doSecurityStep(pa));
  }
}

// A scripted "can battle" ability (S.resolveDigimonBattle called directly by a card
// script — src/cards/shard8.js OPS.s8_battle etc.) that wins with ≪관통≫ must ALSO
// trigger the mandatory bonus security check (16-7-3/16-7-4), even though it never
// goes through the normal attack pa/state.attackCtx machinery (ctx.securityCheck,
// wired in runPendingScript). This is intentionally independent of sel.pendingAttack:
// a real attack `pa` may already be mid-flow in an unrelated stage when the script
// runs (e.g. an 【어택 시】 trigger firing this battle while the real attack sits at
// 'redirectTiming') — clobbering sel.pendingAttack here would corrupt it. Instead
// state._scriptedPierce drives its own tiny render block (see renderModal), and the
// pending-effect queue (state.pending) still drains itself the normal way, driven by
// the render()/autoRunMandatoryPending() heartbeat that already runs on every frame.
// Drains state.pending directly (bypassing autoRunMandatoryPending's single-flight `pendingRunner`
// guard, which stays held by whatever outer trigger is calling us reentrantly via ctx.securityCheck)
// so a checked security card's own 【시큐리티】 trigger actually resolves instead of stalling forever
// waiting for a render() heartbeat that will not re-enter while we're still inside it (pendingRunner
// is truthy the whole time runPendingScript() — and the script it's running — is on the call stack).
// Simplified vs. autoRunMandatoryPending: always takes the first eligible trigger rather than
// prompting the player to pick an order among several simultaneous ones — acceptable here since a
// checked security card practically never queues more than one trigger at once.
async function drainNestedPending() {
  let guard = 0;
  while (guard++ < 30) {
    const waiting = state.pending.filter(t => !t.resolved && !t._running && !t.manualOnly && scriptFor(t).length);
    if (!waiting.length) return;
    const secNow = waiting.filter(t => t.evt && t.evt.kind === 'security');
    const tier = secNow.length ? secNow : waiting;
    const mine = tier.filter(t => t.player === state.activePlayer);
    await runPendingScript((mine.length ? mine : tier)[0], { delay: false });
    render();
  }
}
async function scriptedSecurityCheck(attackerP, attackerUid, defenderP) {
  const ctl = S.beginSecurityCheck(state, attackerP, attackerUid, defenderP);
  ctl.deferBattle = true; // reveal -> resolve 【시큐리티】 effect -> battle (13-1-8), same pacing as the normal attack flow
  state._scriptedPierce = { attacker: attackerP, uid: attackerUid, opp: defenderP, ctl };
  render();
  let guard = 0;
  for (;;) {
    while (!ctl.done && !state.winner && guard++ < 30) {
      if (ctl.awaiting) { await drainNestedPending(); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
      render();
      await drainNestedPending();
    }
    if (state.winner) break;
    let lossR = S.settleSecurityLoss(ctl);
    if (lossR === 'deferred') { // interactive replacement prompt parked (pumpReplacementPrompt): wait for S.resumeReplacement to report the outcome (open-e 1)
      lossR = await new Promise((res) => { ctl.onLossResolved = res; });
      render();
    }
    if (lossR !== 'survived') break; // BT8-095 (Q4705)
  }
  state._scriptedPierce = null;
  render();
}

// 11-5/14: resolve against whatever the FINAL target is after Block Timing
// (block can redirect a player-attack, or even a direct digimon-attack, to
// a different Digimon — 12-1-5 only bars blocking with the digimon that's
// already the target).
function resolveFinalTarget(pa) {
  // 11-2-7-4 / 11-5-1-4 / 11-2-6: the attacker or a Digimon target left the battle area (e.g. deleted by a
  // 【어택 시】/【카운터】 effect) -> the attack is established nowhere; it just ends.
  if (!findStack({ player: pa.attacker, uid: pa.uid }) || (pa.targetKind === 'digimon' && !findStack({ player: pa.opp, uid: pa.targetUid }))) {
    S.log(state, '어택 중인 디지몬 또는 어택 대상이 없어 어택이 성립하지 않고 종료 (11-2-6 / 11-5-1-4)');
    endAttack(); return;
  }
  if (pa.targetKind === 'player') {
    runSecurityCheck(pa);
  } else {
    const aSt = findStack({ player: pa.attacker, uid: pa.uid }), dSt = findStack({ player: pa.opp, uid: pa.targetUid });
    pa.battlePreview = aSt && dSt ? { aCard: aSt.cardId, aDp: S.effectiveDP(state, pa.attacker, aSt), dCard: dSt.cardId, dDp: S.effectiveDP(state, pa.opp, dSt) } : null;
    stepPause(pa, 'digimonResult', '배틀! 양쪽 DP를 비교해 결과를 확인합니다', () => {
      const res = S.resolveDigimonBattle(state, pa.attacker, pa.uid, pa.targetUid);
      if (!res) { S.log(state, '배틀 직전 어택 중인 디지몬/대상이 사라져 어택이 성립하지 않고 종료 (11-2-6)'); endAttack(); return; }
      // 16-7-3: at most one ≪관통≫ bonus check per attack — a scripted mid-attack battle may already have used it (S.consumePierceCheck).
      if (res.piercing && !S.consumePierceCheck(state, pa.attacker, pa.uid)) res.piercing = false;
      pa.stage = 'digimonResult'; pa.battleRes = res; finishAttackRules(pa);
    });
  }
}

// 11-4/12-1: Block Timing — applies regardless of whether the attack
// targeted the player or a specific Digimon; 12-1-5 only excludes the
// Digimon that's already the target from blocking (it can't block itself).
function enterBlockCheck(pa) {
  const attackerStack = findStack({ player: pa.attacker, uid: pa.uid });
  if (!attackerStack) { S.log(state, '어택 중인 디지몬이 배틀 에어리어에 없어 블록할 수 없고 어택이 종료 (12-1-6 / 11-2-7-4)'); endAttack(); return; }
  const colliding = !!attackerStack && (S.hasKeyword(attackerStack, '충돌') || S.hasContinuousKeyword(state, pa.attacker, attackerStack, '충돌') || S.hookGrantedKeywords(state, pa.attacker, attackerStack).includes('충돌'));
  const blockers = eligibleBlockers(pa.opp, colliding).filter(s => s.uid !== pa.targetUid && !S.cannotBeBlockedBy(state, pa.attacker, pa.uid, s));
  if (blockers.length === 0) {
    pa.blockers = [];
    stepPause(pa, 'blockCheck', '블록 타이밍 — 블록할 수 있는 디지몬이 없습니다', () => resolveFinalTarget(pa));
  } else {
    pa.stage = 'blockCheck';
    pa.blockers = blockers;
    pa.mandatoryBlock = colliding;
  }
}

// 11-3: Counter Timing — the defender's window to activate 【카운터】
// effects before Block Timing. Genuinely automating arbitrary counter
// effects (e.g. a full free evolution) is out of scope for the compiler,
// so activating one hands it to the normal pending-effect/manual-tools
// path instead of silently skipping the timing altogether.
function enterCounterTiming(pa) {
  const counters = S.findCounterOptions(state, pa.opp);
  if (counters.length === 0) {
    pa.counters = [];
    stepPause(pa, 'counterTiming', '카운터 타이밍 — 사용할 수 있는 카운터가 없습니다', () => enterBlockCheck(pa));
  } else {
    pa.stage = 'counterTiming';
    pa.counters = counters;
  }
}

// A defender-side "may redirect the attack's target to THIS Digimon"
// reaction (e.g. BT20-033/BT20-036/EX7-046/EX8-050's "[턴에 1회] 상대의
// 디지몬이 어택했을 때, 어택의 대상을 이 디지몬으로 변경할 수 있다.") —
// resolved before Counter Timing since it decides WHICH digimon Counter/
// Block even apply against.
// "어택의 대상이 변경되었을 때" watchers (hooks) — fired whenever a redirect/block changes the attack target.
function noteRedirect(pa) {
  const aSt = findStack({ player: pa.attacker, uid: pa.uid });
  S.emitGameEvent(state, 'redirect', { owner: pa.attacker, stack: aSt, cause: null, targetUid: pa.targetUid });
}

function enterRedirectTiming(pa) {
  if (pa.fireDeclare) { const f = pa.fireDeclare; pa.fireDeclare = null; f(); } // 11-2-2: 【어택 시】 triggers only after the target is fixed
  if (pa.s1ForcedTarget) { pa.targetKind = 'digimon'; pa.targetUid = pa.s1ForcedTarget; pa.s1ForcedTarget = null; } // shard1 (BT4-075)
  if (!pa.s1Noted) { // shard1: 'attackTarget' event (BT2-084 등) + BT4-101
    pa.s1Noted = true;
    const aS1 = findStack({ player: pa.attacker, uid: pa.uid });
    if (aS1) S.s1AttackTargeted(state, pa.attacker, aS1, pa.targetKind, pa.targetUid);
    if (pa.targetKind === 'digimon' && !findStack({ player: pa.opp, uid: pa.targetUid })) { S.log(state, '어택 대상이 사라져 어택 종료'); endAttack(); return; }
  }
  if (pa.targetKind === 'digimon' && !pa.declaredNoted) {
    // "이 디지몬이 (…한) 상대의 디지몬에게 어택했을 때" — the moment a Digimon target is declared.
    pa.declaredNoted = true;
    const aSt0 = findStack({ player: pa.attacker, uid: pa.uid }), dSt0 = findStack({ player: pa.opp, uid: pa.targetUid });
    if (aSt0 && dSt0) S.emitGameEvent(state, 'attackOnDigimon', { owner: pa.attacker, stack: aSt0, cause: null, target: dSt0 });
    if (dSt0 && !findStack({ player: pa.opp, uid: pa.targetUid })) { S.log(state, '어택 대상이 사라져 어택 종료'); endAttack(); return; }
  }
  settleRedirectTiming(pa);
}

// 11-1-4: the attack declaration timing ends only when everything it triggered (【어택 시】, 「레스트했을 때」, ≪연계≫, ≪돌진≫ … — turn player first, 4-3-2) has resolved.
// The opponent's "change the target" chances are computed AFTER that, from the board the effects left behind.
function settleRedirectTiming(pa) {
  const busy = () => state.pending.some(t => !t.resolved && scriptFor(t).length) || !!state.uiChoice;
  if (busy()) {
    pa.stage = 'redirectTiming'; pa.declWait = true; pa.redirectOptions = []; pa.chargeTarget = null; pa.chargeTargets = [];
    const token = pa.token = (pa.token || 0) + 1;
    const tick = () => {
      if (sel.pendingAttack !== pa || pa.token !== token) return;
      if (busy()) { setTimeout(tick, 150); return; }
      settleRedirectTiming(pa); render();
    };
    setTimeout(tick, 150);
    return;
  }
  pa.declWait = false;
  if (!findStack({ player: pa.attacker, uid: pa.uid }) || (pa.targetKind === 'digimon' && !findStack({ player: pa.opp, uid: pa.targetUid }))) { // effects removed the attacker / the target: 11-2-6, 11-2-7-4 — the attack is established nowhere; it goes through the remaining timings and ends
    pa.redirectOptions = [];
    stepPause(pa, 'redirectTiming', '어택 선언 — 어택 중인 디지몬 또는 대상이 사라졌습니다', () => enterCounterTiming(pa));
    return;
  }
  const options = S.findRedirectOptions(state, pa.opp, pa.attacker, pa.uid)
    .concat(S.hookRedirectOptions(state, pa.opp, pa.attacker, findStack({ player: pa.attacker, uid: pa.uid })))
    .concat(pa.targetKind === 'digimon' ? S.hookAttackerRedirectOptions(state, pa.attacker, findStack({ player: pa.attacker, uid: pa.uid }), pa.targetUid) : []);
  // 11-2-7-3: the target can't be redirected to the target it already has.
  for (let i = options.length - 1; i >= 0; i--) { const o = options[i]; if (o.endsAttack) continue; if (o.toPlayer ? pa.targetKind === 'player' : (pa.targetKind === 'digimon' && (o.targetUid || o.stackUid) === pa.targetUid)) options.splice(i, 1); }
  if (options.length === 0) {
    pa.redirectOptions = [];
    stepPause(pa, 'redirectTiming', '어택 선언 — 어택 대상을 바꿀 수 있는 효과가 없습니다', () => enterCounterTiming(pa));
  } else {
    pa.stage = 'redirectTiming';
    pa.redirectOptions = options;
  }
}

// 【어택 종료 시】 (82 printed segments) — was never queued anywhere. Fires for
// the attacker's stack (own + inherited text) once the attack panel is closed.
// 어택이 룰적으로 끝나는 시점(결과 확정: 시큐리티 체크/배틀이 끝났거나 어택이 성립하지 않아 종료)에 바로 처리한다.
// 결과 패널(sel.pendingAttack)을 닫는 것과는 무관하다 — 패널은 결과를 보여 주는 표시일 뿐이고, 어택 종료 시 효과·어택 중 상태 정리는 여기서 일어난다.
function finishAttackRules(pa) {
  if (!pa || pa.rulesEnded) return;
  pa.rulesEnded = true;
  if (state.attackCtx === pa) state.attackCtx = null;
  const st = findStack({ player: pa.attacker, uid: pa.uid });
  if (st) S.s8AttackEnded(state, pa.attacker, pa.uid); // s8
  if (st) { S.queueTriggersForStack(state, pa.attacker, st, 'attackEnd'); S.emitGameEvent(state, 'attackEnd', { owner: pa.attacker, stack: st, cause: null }); }
}
// 진행 중인(룰상 아직 안 끝난) 어택이 있는가 — 결과만 남은 패널은 게임 진행을 막지 않는다
const attackActive = () => !!sel.pendingAttack && !sel.pendingAttack.rulesEnded;
function endAttack() {
  const pa = sel.pendingAttack;
  if (pa) finishAttackRules(pa);
  sel.pendingAttack = null;
}

// Attack-step actions shared by the buttons in renderPendingAttack and the CPU driver (cpuApiObj.pa) — one code path for both.
function paChooseTarget(pa, tgt) {
  if (tgt === 'PLAYER') { pa.targetKind = 'player'; } else { pa.targetKind = 'digimon'; pa.targetUid = tgt; }
  enterRedirectTiming(pa); render();
}
function paUseCounter(pa, opt) {
  const r = S.activateCounter(state, pa.opp, opt, pa); // rule 9 / 11-3-2: use cost + color condition (options), once per attack
  if (!r.ok) { S.log(state, `${pa.opp} ${S.card(opt.cardId).nameKo} 카운터 불가: ${r.reason}`); render(); return; }
  state.pending.push({ uid: 'ct' + Math.random().toString(36).slice(2), player: pa.opp, cardId: opt.cardId, stackUid: opt.stackUid, tags: opt.tags, text: opt.body, resolved: false });
  enterBlockCheck(pa); render();
}
function paBlock(pa, uid) {
  const s = state.players[pa.opp].battle.find(x => x.uid === uid);
  if (!s) { resolveFinalTarget(pa); render(); return; }
  S.restStack(state, pa.opp, s.uid, 'block');
  pa.targetKind = 'digimon'; pa.targetUid = s.uid;
  noteRedirect(pa);
  { const aBl = findStack({ player: pa.attacker, uid: pa.uid }); if (aBl) S.emitGameEvent(state, 'blocked', { owner: pa.attacker, stack: aBl, blocker: s, cause: null }); } // "이 디지몬이 블록당했을 때" (ST1-09)
  resolveFinalTarget(pa);
  render();
}

function attackFlow(p, uid, directTarget, force = false, atkOpts = {}) {
  if (!force && netIntercept('attack', [p, uid, directTarget])) return; // force=true attacks are effect-granted (script-driven on the host only, never a guest click) — never intercepted
  if (!force && blockIfBusy()) return;
  if (force) { // effect-granted attack ("이 디지몬으로 상대의 디지몬에게 어택할 수 있다"): with no legal target it cannot be declared at all (else the target picker had nothing to pick = softlock)
    const pre = findStack({ player: p, uid });
    if (pre) {
      if (atkOpts && atkOpts.anyActive) pre.anyActiveOnce = true;
      let tg = [], hit = false;
      try { tg = S.legalDigimonTargets(state, p, uid); hit = !(atkOpts && atkOpts.digimonOnly) && S.canAttackPlayer(state, p, uid); } catch (e) { tg = [1]; }
      delete pre.anyActiveOnce;
      if (!hit && !(tg.length && !blockedFromDigimonTarget(p, pre))) { S.log(state, `${p} 어택 불가: 어택 대상이 없어 이 효과의 어택을 하지 않음`); delete pre._pierceHeld; return; }
    }
  }
  const dec = S.declareAttack(state, p, uid, atkOpts);
  if (!dec.ok) { render(); return; }
  // 11-2-2: the attack target is chosen together with the declaration, i.e. BEFORE 【어택 시】 effects are triggered/resolved.
  // Drag-drop already knows the target; the click path defers the triggers until a target is picked (see enterRedirectTiming).
  const fireDeclare = () => {
    const st = findStack({ player: p, uid });
    if (!st) return;
    S.queueTriggersForStack(state, p, st, 'attack');
    S.emitGameEvent(state, 'attack', { owner: p, stack: st, cause: null });
  };
  const dp = S.effectiveDP(state, p, dec.stack);
  const opp = S.opponentOf(p);
  if (atkOpts && atkOpts.anyActive) dec.stack.anyActiveOnce = true; // BT4-090: 「이 효과로는 액티브 상태의 상대 디지몬에게도 어택할 수 있다」 = this attack only
  const digimonTargets = S.legalDigimonTargets(state, p, uid);
  if (dec.stack.anyActiveOnce) delete dec.stack.anyActiveOnce;
  const canHitPlayer = !(atkOpts && atkOpts.digimonOnly) && S.canAttackPlayer(state, p, uid); // b9: digimonOnly = "상대의 디지몬에게 어택할 수 있다" (RB1-025)
  const pa = { attacker: p, uid, dp, opp, digimonTargets, canHitPlayer, attackerCardId: dec.stack.cardId, targetKind: null, targetUid: null, stage: 'targetChoice' };
  pa.pierceUsed = !!dec.stack._pierceHeld; delete dec.stack._pierceHeld; // adopt a ≪관통≫ hold left by a scripted battle that ran before this attack existed (S.consumePierceCheck)
  pa.fireDeclare = fireDeclare;
  pa.turn0 = state.turnNumber; sel.pendingAttack = pa;
  state.attackCtx = pa; // read by card scripts ("어택 중인 대상…"); pa.terminate() ends this attack ("그 어택을 종료한다")
  pa.terminate = () => { if (sel.pendingAttack === pa) { endAttack(); render(); } };

  if (directTarget === 'PLAYER' && canHitPlayer) {
    pa.targetKind = 'player';
    enterRedirectTiming(pa);
  } else if (directTarget && digimonTargets.includes(directTarget) && !blockedFromDigimonTarget(p, dec.stack)) {
    pa.targetKind = 'digimon'; pa.targetUid = directTarget;
    enterRedirectTiming(pa);
  }
  render();
}

const RESULT_LABEL_KO = { attackerWins: '공격측 승리', defenderWins: '방어측 승리', tie: '동점 (양쪽 소멸)', jammedSurvive: '≪재밍≫으로 생존', noBattle: '시큐리티 디지몬 없음 (배틀 없음)' };

function renderVsBattle(leftCardId, leftDp, rightCardId, rightDp, result, leftOwner, rightOwner) {
  const leftWins = result === 'attackerWins' || result === 'jammedSurvive';
  const rightWins = result === 'defenderWins';
  // jammedSurvive is deliberately excluded from rightLoses — Jamming means
  // the defender survives the hit, so it shouldn't play a "destroyed" beat.
  const leftLoses = result === 'defenderWins' || result === 'tie';
  const rightLoses = result === 'attackerWins' || result === 'tie';
  const sideClass = (wins, loses) => `vs-side${wins ? ' vs-winner' : ''}${loses ? ' vs-loser' : ''}`;
  return h('div', { className: 'vs-battle' }, [
    h('div', { className: sideClass(leftWins, leftLoses) }, [cardChip(leftCardId, { owner: leftOwner }), h('div', { className: 'vs-dp' }, `DP ${leftDp}`)]),
    h('div', { className: 'vs-mid' }, [h('div', { className: 'vs-vs' }, 'VS'), h('div', { className: 'vs-result' }, RESULT_LABEL_KO[result] || result || '')]),
    h('div', { className: sideClass(rightWins, rightLoses) }, [cardChip(rightCardId, { owner: rightOwner }), h('div', { className: 'vs-dp' }, `DP ${rightDp}`)]),
  ]);
}

// Short breadcrumb of the fixed attack sequence (11-1-3), current step
// highlighted — lets the player see at a glance where they are instead of
// parsing a paragraph each stage.
const ATTACK_STEP_ORDER = ['targetChoice', 'redirectTiming', 'counterTiming', 'blockCheck', 'digimonResult', 'result'];
const ATTACK_STEP_LABEL = { targetChoice: '대상', redirectTiming: '대상 변경', counterTiming: '카운터', blockCheck: '블록', digimonResult: '결과', result: '결과' };
// 어택 진행 순서 표시: 번호 붙은 5단계 + 지금 단계의 쉬운 설명 + 누가 결정하는지 (사람이 보기 쉽게)
const ATTACK_GUIDE = [
  { keys: ['targetChoice'], icon: '⚔', label: '대상 선택', who: 'atk', text: '공격하는 쪽이 상대 플레이어(시큐리티) 또는 상대 디지몬 중에서 공격 대상을 고릅니다.' },
  { keys: ['redirectTiming'], icon: '🔀', label: '대상 변경', who: 'atk', text: '어택 대상을 바꾸는 효과(《돌진》 등)를 쓸 수 있는 타이밍입니다. 쓸 게 없으면 자동으로 넘어갑니다.' },
  { keys: ['counterTiming'], icon: '🃏', label: '카운터', who: 'def', text: '방어하는 쪽이 【카운터】 효과를 쓸 수 있는 타이밍입니다. 쓰지 않으면 넘어갑니다.' },
  { keys: ['blockCheck'], icon: '🛡', label: '블록', who: 'def', text: '방어하는 쪽이 《블로커》 디지몬으로 이 어택을 대신 받을 수 있는 타이밍입니다.' },
  { keys: ['digimonResult', 'result'], icon: '💥', label: '결과', who: null, text: '디지몬끼리는 DP를 비교해 배틀하고, 플레이어 어택이면 시큐리티를 체크합니다.' },
];
function renderAttackSteps(pa) {
  const stage = typeof pa === 'string' ? pa : pa.stage;
  const cur = ATTACK_GUIDE.findIndex(g => g.keys.includes(stage));
  const nm = (p) => (p || '').toUpperCase();
  const steps = h('div', { className: 'atk-stepper', role: 'list' }, ATTACK_GUIDE.map((g, i) => h('div', { className: `atk-step${i < cur ? ' done' : i === cur ? ' now' : ''}`, role: 'listitem', 'aria-current': i === cur ? 'step' : null }, [
    h('span', { className: 'atk-dot' }, i < cur ? '✓' : String(i + 1)),
    h('span', { className: 'atk-lbl' }, g.label),
  ])));
  const g = ATTACK_GUIDE[Math.max(0, cur)];
  const actor = typeof pa === 'string' || !g.who ? '' : (g.who === 'atk' ? `지금 결정: ${nm(pa.attacker)} (공격측)` : `지금 결정: ${nm(pa.opp)} (수비측)`);
  const next = ATTACK_GUIDE[cur + 1];
  return h('div', { className: 'atk-guide' }, [
    steps,
    h('div', { className: 'atk-now' }, [h('b', {}, `${g.icon} ${cur + 1}/${ATTACK_GUIDE.length} ${g.label}`), actor ? h('span', { className: 'atk-actor' }, actor) : null]),
    h('div', { className: 'atk-desc' }, g.text),
    next ? h('div', { className: 'atk-next' }, `다음 → ${next.icon} ${next.label}`) : null,
  ].filter(Boolean));
}

function renderPendingAttack() {
  const pa = sel.pendingAttack;
  if (!pa) return null;
  const attackerStackNow = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
  const rows = [
    h('div', { className: 'section-title' }, `${attackerStackNow ? S.card(attackerStackNow.cardId).nameKo : '(소멸됨)'} DP${pa.dp} 공격 중`),
    renderAttackSteps(pa),
  ];

  // Step pacing controls + the current step's explanation (see stepPause).
  rows.push(h('label', { className: 'meta', style: 'display:flex;gap:6px;align-items:center;cursor:pointer;' }, [
    h('input', { type: 'checkbox', checked: STEP.manual, onChange: (e) => { STEP.manual = e.target.checked; try { localStorage.setItem('digimon_step_manual', STEP.manual ? '1' : '0'); } catch (err) { /* ignore */ } render(); } }),
    '단계 수동 진행 (각 단계마다 "다음"을 눌러 진행)',
  ]));
  if (pa.paused && pa.pendingNext) {
    rows.push(h('div', { className: 'effect-box step-info' }, [
      h('div', {}, pa.info || ''),
      h('button', { className: 'primary', onClick: () => runPendingNext(pa) }, STEP.manual ? '다음 단계 ▶' : '바로 진행 ▶'),
      STEP.manual ? null : h('span', { className: 'meta', style: 'margin-left:8px;' }, '잠시 후 자동 진행…'),
    ]));
  }

  // ≪연계≫ / ≪돌진≫ are triggered effects (16-23-2 / 16-24-2): they wait in the normal pending queue with the 【어택 시】 effects (src/cards/shard96.js), not in this panel.
  // 11-1-4: the attack does not move on while triggered effects are still waiting / resolving.
  const fxBusy = state.pending.some(t => !t.resolved && scriptFor(t).length) || !!state.uiChoice;
  const gate = (fxBusy || pa.declWait) && ['redirectTiming', 'counterTiming', 'blockCheck'].includes(pa.stage);
  if (gate) rows.push(h('div', { className: 'effect-box step-info' }, '발동 대기 중인 효과를 처리하고 있습니다… (모든 효과의 처리가 끝나야 다음 타이밍으로 진행합니다, 룰 11-1-4)'));

  if (gate) {
    // waiting for the queued effects (message above)
  } else if (pa.stage === 'targetChoice') {
    const attackerStack = state.players[pa.attacker].battle.find(s => s.uid === pa.uid);
    const blockedByDynamic = blockedFromDigimonTarget(pa.attacker, attackerStack);
    if (pa.canHitPlayer) {
      rows.push(h('div', { className: 'actions-row' }, [
        h('button', {
          className: 'primary',
          onClick: () => { if (netIntercept('pa.chooseTarget', ['PLAYER'])) return; pa.targetKind = 'player'; enterRedirectTiming(pa); render(); },
        }, `${pa.opp} 본체 공격`),
      ]));
    } else {
      rows.push(h('div', { className: 'meta' }, '이 디지몬은 플레이어에게 어택할 수 없음 (효과 제약)'));
    }
    if (blockedByDynamic) {
      rows.push(h('div', { className: 'meta' }, '지금은 디지몬 직접 공격 불가 (효과 제약)'));
    } else if (pa.digimonTargets.length) {
      rows.push(h('div', { className: 'zone-label' }, '또는 디지몬 직접 공격:'));
      rows.push(h('div', { className: 'stack-list' }, pa.digimonTargets.map(uid => {
        const st = state.players[pa.opp].battle.find(s => s.uid === uid);
        return cardChip(st.cardId, { owner: pa.opp, onClick: () => {
          if (netIntercept('pa.chooseTarget', [uid])) return;
          pa.targetKind = 'digimon'; pa.targetUid = uid; enterRedirectTiming(pa); render();
        } });
      })));
    } else {
      rows.push(h('div', { className: 'meta' }, '어택 대상이 될 레스트 상태의 상대 디지몬이 없음 (플레이어에게만 어택 가능)'));
    }
    if (!pa.canHitPlayer && (blockedByDynamic || !pa.digimonTargets.length)) { // nothing to pick: never leave the prompt without an exit
      rows.push(h('div', { className: 'actions-row' }, [h('button', { onClick: () => { if (netIntercept('pa.close', [])) return; pa.terminate(); } }, '어택 종료 (대상 없음)')]));
    }
  } else if (pa.stage === 'redirectTiming' && !pa.paused) {
    if (pa.redirectOptions.length) rows.push(h('div', { className: 'zone-label' }, `${pa.opp}의 대상 변경 기회`));
    pa.redirectOptions.forEach((opt, optIdx) => {
      const tUid = opt.targetUid || opt.stackUid;
      const st = state.players[pa.opp].battle.find(s => s.uid === tUid);
      if (!st && !opt.toPlayer) return;
      const srcSt = state.players[pa.opp].battle.find(s => s.uid === opt.stackUid);
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, opt.label || (opt.toPlayer ? '플레이어(으)로 어택 대상 변경' : `${S.card(st.cardId).nameKo}(으)로 어택 대상 변경` + (tUid !== opt.stackUid && srcSt ? ` (${S.card(opt.cardId).nameKo})` : ''))),
        h('button', {
          onClick: async () => {
            // Sent by index (not the option object itself): `opt.pay` is a closure and would not survive JSON
            // transit — the host resolves it against its OWN (unstripped) `pa.redirectOptions[optIdx]`.
            if (netIntercept('pa.useRedirect', [optIdx])) return;
            // card-specific redirects may carry a cost (opt.pay) and/or redirect to the player (opt.toPlayer)
            if (opt.pay) { const paid = await opt.pay(ctxChoose); if (!paid) { render(); return; } }
            if (opt.endsAttack) { endAttack(); render(); return; } // shard2: "그 어택을 종료한다"
            if (opt.toPlayer) { pa.targetKind = 'player'; pa.targetUid = null; } else { pa.targetKind = 'digimon'; pa.targetUid = tUid; }
            if (opt.limit != null) S.markRedirectUsed(state, pa.opp, opt.stackUid, opt.cardId);
            noteRedirect(pa);
            enterCounterTiming(pa); render();
          },
        }, '변경'),
      ]));
    });
    rows.push(h('button', { className: 'primary', onClick: () => { if (netIntercept('pa.passRedirect', [])) return; enterCounterTiming(pa); render(); } }, pa.redirectOptions.length ? '넘기기' : '진행 (카운터 단계로)'));
  } else if (pa.stage === 'counterTiming' && !pa.paused) {
    rows.push(h('div', { className: 'zone-label' }, `${pa.opp}의 카운터 기회`));
    pa.counters.forEach(opt => {
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, `${S.card(opt.cardId).nameKo}: ${opt.body}`),
        h('button', {
          disabled: !!pa.counterUsed,
          onClick: () => { if (netIntercept('pa.useCounter', [opt])) return; paUseCounter(pa, opt); },
        }, '발동'),
      ]));
    });
    rows.push(h('button', { className: 'primary', onClick: () => { if (netIntercept('pa.passCounter', [])) return; enterBlockCheck(pa); render(); } }, '넘기기'));
  } else if (pa.stage === 'digimonResult' && pa.paused) {
    if (pa.battlePreview) rows.push(renderVsBattle(pa.battlePreview.aCard, pa.battlePreview.aDp, pa.battlePreview.dCard, pa.battlePreview.dDp, null, pa.attacker, pa.opp));
  } else if (pa.stage === 'digimonResult') {
    const res = pa.battleRes;
    rows.push(renderVsBattle(res.attackerCardId, res.aDp, res.defenderCardId, res.dDp, res.result, pa.attacker, pa.opp));
    if (res.result === 'defenderWins' || res.result === 'tie') {
      rows.push(h('div', { className: 'meta' }, '공격측 소멸 (생존 효과가 있다면 범용 도구로 처리)'));
    }
    if (res.result === 'attackerWins' && res.destroyedOnlyOpponent) {
      const survivorsWithKw = state.players[pa.attacker].battle.filter(s => S.hasKeyword(s, '전투후액티브'));
      if (survivorsWithKw.length) {
        rows.push(h('div', { className: 'actions-row' }, [
          h('span', {}, '≪전투후액티브≫ 액티브로 되돌리기?'),
          ...survivorsWithKw.map(s => cardChip(s.cardId, { owner: pa.attacker, onClick: () => { if (netIntercept('pa.unsuspendAfterBattle', [s.uid])) return; S.unsuspendStack(state, pa.attacker, s.uid); render(); } })),
        ]));
      }
    }
    if (res.piercing) {
      // 16-7-3: the ≪관통≫ check is mandatory — no "안 함" option.
      // 16-7-4: the pierce check is a pending process handled AFTER effects triggered by this battle (e.g. 【소멸 시】) resolve.
      const pierceWaiting = state.pending.some(t => !t.resolved) || !!state.uiChoice;
      rows.push(h('div', { className: 'actions-row' }, [
        h('span', {}, pierceWaiting ? '≪관통≫ — 대기 중인 효과를 먼저 처리하세요 (16-7-4)' : '≪관통≫ — 시큐리티 체크 (강제)'),
        h('button', {
          className: 'primary',
          disabled: pierceWaiting,
          // Piercing's bonus check is still part of THIS attack's single
          // "성립의 확인" — Counter/Block Timing already happened once for
          // this attack and don't repeat here.
          onClick: () => { if (netIntercept('pa.pierce', [])) return; pa.targetKind = 'player'; runSecurityCheck(pa); render(); },
        }, '체크'),
      ]));
    } else {
      rows.push(h('button', { onClick: () => { if (netIntercept('pa.close', [])) return; endAttack(); render(); } }, '닫기'));
    }
  } else if (pa.stage === 'blockCheck' && !pa.paused) {
    {
      const tgtStack = pa.targetKind === 'digimon' ? state.players[pa.opp].battle.find(s => s.uid === pa.targetUid) : null;
      const tgtName = pa.targetKind === 'digimon' ? (tgtStack ? S.card(tgtStack.cardId).nameKo : '(디지몬)') : `${pa.opp} 플레이어 (시큐리티)`;
      const atkName = attackerStackNow ? S.card(attackerStackNow.cardId).nameKo : '(소멸됨)';
      rows.push(h('div', { className: 'effect-box step-info' }, `블록 타이밍 — 블록하는 쪽: ${pa.opp} / 공격: ${pa.attacker}의 ${atkName} (DP ${pa.dp}) → 대상: ${tgtName}`));
    }
    rows.push(h('div', { className: 'zone-label' },
      pa.mandatoryBlock ? '≪충돌≫ — 상대는 반드시 블록해야 함, 막을 디지몬 선택:' : '≪블로커≫로 막을 디지몬 선택 (없으면 넘기기):'));
    rows.push(h('div', { className: 'stack-list' }, pa.blockers.map(s => cardChip(s.cardId, {
      owner: pa.opp,
      onClick: () => { if (netIntercept('pa.block', [s.uid])) return; paBlock(pa, s.uid); },
    }))));
    { // why the others can't block (a human blocker wonders about every Digimon that is NOT offered)
      const no = state.players[pa.opp].battle.filter(x => S.card(x.cardId).category === 'digimon' && !pa.blockers.some(b => b.uid === x.uid));
      if (no.length && !isCpuSide(pa.opp)) rows.push(h('div', { className: 'meta block-why' }, '막을 수 없음: ' + no.map(x => `${S.card(x.cardId).nameKo}(${x.suspended ? '휴식 상태' : S.hasKeyword(x, '블로커') ? '지금은 블록 불가' : '≪블로커≫ 없음'})`).join(', ')));
    }
    if (!pa.mandatoryBlock) {
      rows.push(h('div', { className: 'actions-row' }, [
        h('button', {
          className: 'primary',
          onClick: () => { if (netIntercept('pa.passBlock', [])) return; resolveFinalTarget(pa); render(); },
        }, '넘기기'),
      ]));
    }
  } else if (pa.stage === 'result') {
    const res = pa.res;
    if (res.gameOver) {
      rows.push(h('div', { className: 'effect-box' }, `${pa.opp} 시큐리티 0에서 피격 — 게임 종료!`));
    } else {
      res.checks.forEach((c, i) => {
        rows.push(h('div', { className: 'zone-label' }, `시큐리티 체크 ${i + 1}/${pa.secCtl ? pa.secCtl.total : res.checks.length}`));
        rows.push(renderVsBattle(pa.attackerCardId, c.atkDp != null ? c.atkDp : pa.dp, c.revealed, c.secDp, c.result, pa.attacker, pa.opp));
      });
      const last = res.checks[res.checks.length - 1];
      if (!pa.secDone) {
        // still revealing — the step-info row above carries the "next" control
      } else if (last && (last.result === 'defenderWins' || last.result === 'tie')) {
        // Already destroyed by runSecurityCheck — this is purely
        // informational. No "survive anyway" button: there's no tracked
        // keyword for it, every real instance is bespoke card text handled
        // via the normal trigger/pending-effect system instead.
        rows.push(h('div', { className: 'meta' }, '공격측 소멸 (생존 효과가 있다면 범용 도구로 처리)'));
        rows.push(h('button', {
          className: 'primary',
          onClick: () => { if (netIntercept('pa.close', [])) return; endAttack(); render(); },
        }, '닫기'));
      } else {
        rows.push(h('button', { onClick: () => { if (netIntercept('pa.close', [])) return; endAttack(); render(); }, }, '닫기'));
      }
    }
  }
  const panelEl = h('div', { className: 'player-panel' }, rows);
  if (cpuOn && cpuDrv && cpuDrv.paDecider(pa) === CPU_P) cpuLockPanel(panelEl); // this step is the CPU's decision: the human's buttons are inert
  return panelEl;
}

function renderLog() {
  if (!panelsOpen.log) {
    return h('div', { className: 'log-panel log-collapsed', onClick: () => { panelsOpen.log = true; render(); } }, '◀ 로그');
  }
  return h('div', { className: 'log-panel' }, [
    h('div', { className: 'log-panel-header' }, [
      h('span', { className: 'fx-tabs' }, [
        h('button', { className: 'fx-tab' + (fxUI.tab === 'log' ? ' on' : ''), onClick: () => { fxUI.tab = 'log'; render(); } }, '로그'),
        h('button', { className: 'fx-tab' + (fxUI.tab === 'fx' ? ' on' : ''), onClick: () => { fxUI.tab = 'fx'; render(); } }, '효과 기록'),
      ]),
      h('button', { className: 'log-close-btn', onClick: () => { panelsOpen.log = false; render(); } }, '접기 ▶'),
    ]),
    ...(fxUI.tab === 'fx' ? renderFxHistory() : state.log.slice(0, 100).map(e => h('div', {}, [`[턴${e.turn}] `,
      e.src && e.src.kind === 'effect' ? [h('span', { className: `fx-logsrc fx-${e.src.owner}` }, [`${pNm(e.src.owner)} `, fxCardLink(e.src.cardId, `「${S.card(e.src.cardId).nameKo}」`), e.src.tag ? `【${e.src.tag}】` : '']), ': '] : null,
      e.msg].flat().filter(x => x != null)))),
  ]);
}

// ================= effect visibility (presentation only — the engine never reads any of this) =================
// state.fxHistory holds one record per resolved effect (see effects.js runScript / state.js fxNewRec): source card, tag, printed
// text, the log lines it produced and the stacks it made vanish. Here: resolution card + pager, board markers, ghost tiles, history tab.
const FX_DELAYS = { auto: -1, '2': 2000, '5': 5000, '10': 10000, manual: 0 };
const fxUI = { seen: 0, stateRef: null, queue: [], idx: 0, open: false, timer: null, tab: 'log', info: null, expanded: new Set(), ghosts: [], markRec: null, markUntil: 0, markTimer: null, hits: { p1: new Set(), p2: new Set() }, cfg: 'auto' };
try { const v = localStorage.getItem('digimon_fx_delay'); if (v && v in FX_DELAYS) fxUI.cfg = v; } catch (e) { /* ignore */ }
const pNm = (p) => (cpuOn && p === CPU_P ? 'CPU(P2)' : String(p || '').toUpperCase()); // vs-CPU: name the CPU so a card it plays / an effect it fires is never mistaken for one of the human's own
// Why did this effect fire on its own? (a player who never played the card sees it appear / asks a question) — short rule-based reason, '' when the owner simply used it
function fxWhyNote(rec, byHuman) {
  if (!rec || !rec.src || rec.src.kind !== 'effect') return '';
  const tag = String(rec.src.tag || ''), so = rec.src.owner, out = [];
  if (/시큐리티/.test(tag)) out.push('🛡 시큐리티 체크로 공개돼 룰에 따라 자동 발동 (카드를 낸 것이 아님)');
  else if (/(턴|페이즈)\s*개시\s*시/.test(tag + (rec.text || ''))) out.push('⏰ 턴 시작 시 자동 발동');
  else if (/턴\s*종료\s*시/.test(tag)) out.push('⏰ 턴 종료 시 자동 발동');
  else if (/(소멸\s*시|파기\s*시)/.test(tag)) out.push('💀 소멸 시 자동 발동');
  if (cpuOn && so === CPU_P && byHuman) out.push('🤖 CPU 카드의 효과가 당신에게 선택을 요구합니다 ("상대는 …" 효과)');
  return out.join(' · ');
}
const fxOwnerOf = (m) => { const x = /^(p1|p2)\s/.exec(m); return x ? x[1] : null; };
const fxTrivial = (r) => !r.entries.length && !r.vanished.length && r.mem0 === r.mem1;
function fxForeign(rec) { // did the effect touch the OTHER player's cards / lines?
  if (rec.src.kind !== 'effect') return false;
  return rec.vanished.some(v => v.owner !== rec.src.owner) || rec.entries.some(e => { const o = fxOwnerOf(e.msg); return o && o !== rec.src.owner; });
}
function fxDelayFor(rec) {
  if (fxUI.cfg === 'manual') return 0;
  if (fxUI.cfg === 'auto') { // reading time from the printed text + concrete results
    const txt = `${rec.text || ''} ${(rec.entries || []).map(e => e.msg).join(' ')}`;
    const d0 = readMs(txt, 2500, 16000);
    return fxForeign(rec) || rec.src.kind !== 'effect' ? d0 : Math.min(d0, Math.round(3500 * READ_SPEEDS[READ.speed])); // the acting player's own harmless effects fade sooner
  }
  const d = FX_DELAYS[fxUI.cfg];
  return fxForeign(rec) || rec.src.kind !== 'effect' ? d : Math.min(d, 2000); // the acting player's own harmless effects fade sooner
}
function fxSrcLabel(rec) {
  if (rec.src.kind !== 'effect') return rec.src.label || '룰';
  return `${pNm(rec.src.owner)}의 「${S.card(rec.src.cardId).nameKo}」${rec.src.tag ? '【' + rec.src.tag + '】' : ''}`;
}
function fxHitNames(rec) { // names of on-board cards the effect's log lines are about, per owner (+ vanished ones)
  const out = { p1: new Set(), p2: new Set() };
  for (const v of rec.vanished) out[v.owner].add(v.name);
  for (const e of rec.entries) {
    const o = fxOwnerOf(e.msg); if (!o || /스택 소멸/.test(e.msg)) continue;
    for (const s of state.players[o].battle) { const nm = S.card(s.cardId).nameKo; if (e.msg.includes(nm)) out[o].add(nm); }
  }
  return out;
}
function fxResults(rec) {
  const items = [];
  for (const e of rec.entries) {
    if (/스택 소멸/.test(e.msg)) continue;
    const o = fxOwnerOf(e.msg);
    items.push({ owner: o, text: o ? `${pNm(o)} ${e.msg.replace(/^(p1|p2)\s+/, '')}` : e.msg });
  }
  for (const v of rec.vanished) items.push({ owner: v.owner, text: `💀 ${pNm(v.owner)}의 「${v.name}」 소멸`, vanish: true });
  if (rec.mem0 !== rec.mem1) items.push({ owner: null, text: `메모리 ${rec.mem0} → ${rec.mem1}` });
  return items;
}
function fxCardLink(cardId, label) {
  return h('span', { className: 'fx-cardlink', title: '카드 정보 보기', onClick: (e) => { e.stopPropagation(); fxUI.info = cardId; render(); } }, label);
}
const fxHeld = () => !!state && (!!state.uiChoice || fxBusyMs() > 0);
function fxSync() {
  if (!state) return;
  const hist = state.fxHistory || [];
  // 게스트는 상태 객체가 매번 바뀌므로 "새 게임일 때만"(기록 id가 되감김) 초기화한다 — 아니면 새 효과가 전부 '이미 본 것'으로 처리돼 안 보인다
  const guestSame = Net.NET.role === 'guest' && fxUI.stateRef && (hist[0]?.id || 0) >= fxUI.seen;
  if (fxUI.stateRef !== state && guestSame) fxUI.stateRef = state;
  if (fxUI.stateRef !== state) { fxUI.stateRef = state; fxUI.seen = hist[0]?.id || 0; fxUI.fieldBase = fxUI.seen; fxUI.queue = []; fxUI.ghosts = []; fxUI.open = false; fxUI.markRec = null; }
  for (const r of hist.filter(r => r.id > fxUI.seen).reverse()) fxEmit('effect', { rec: r, state }); // VFX bus (fx.js dedupes per rec via progress counters)
  if (state._fxRec && state._fxRec.src.kind === 'effect') fxEmit('effect', { rec: state._fxRec, state }); // still resolving (e.g. parked on a choice): banner + burst now, results as they appear
  // Presentation order: activation VFX -> choice modal -> results. While a choice modal is open (or held) or the fx timeline is busy,
  // the resolution card, board markers and ghost tiles wait; they show up right after (modal close re-renders; a timer covers the VFX case).
  const unbooked = [...hist.filter(r => r.id > fxUI.seen), state._fxRec].some(fxUnbooked);
  if (unbooked || fxHeld()) {
    fxUI.hits = { p1: new Set(), p2: new Set() };
    clearTimeout(fxUI.holdTimer);
    if (!state.uiChoice) fxUI.holdTimer = setTimeout(() => { if (state) render(); }, Math.max(unbooked ? 150 : 0, fxBusyMs() + 60));
    return;
  }
  if (fxFieldOn()) { // 필드 표기: results are drawn ON the field (src/fxfield.js) — no collected panel / pager / ghost tiles / 🎯 markers
    fxFieldSync(state, hist, fxUI.fieldBase || 0, fxDelayFor);
    if (hist[0]) fxUI.seen = Math.max(fxUI.seen, hist[0].id);
    fxUI.queue = []; fxUI.open = false; fxUI.ghosts = []; fxUI.markRec = null; fxUI.hits = { p1: new Set(), p2: new Set() };
    return;
  }
  for (const rec of hist.slice(0, 6)) { // ghost tiles for freshly vanished stacks (a rec can gain vanishes after being seen)
    const from = rec._vs || 0;
    for (const v of rec.vanished.slice(from)) fxUI.ghosts.push({ ...v, by: fxSrcLabel(rec), gid: rec.id + ':' + fxUI.ghosts.length + ':' + Math.random().toString(36).slice(2, 6) });
    rec._vs = rec.vanished.length;
  }
  if (fxUI.ghosts.length > 8) fxUI.ghosts.splice(0, fxUI.ghosts.length - 8);
  const fresh = hist.filter(r => r.id > fxUI.seen && !fxTrivial(r)).reverse();
  if (hist[0]) fxUI.seen = Math.max(fxUI.seen, hist[0].id);
  if (fresh.length) {
    const wasOpen = fxUI.open && fxUI.queue.length;
    for (const r of fresh) if (!fxUI.queue.includes(r)) fxUI.queue.push(r);
    if (fxUI.queue.length > 30) fxUI.queue.splice(0, fxUI.queue.length - 30);
    if (!wasOpen) fxUI.idx = fxUI.queue.length - fresh.length;
    fxUI.open = true;
    fxUI.markRec = fresh[fresh.length - 1]; fxUI.markUntil = Date.now() + 6000;
    clearTimeout(fxUI.markTimer); fxUI.markTimer = setTimeout(() => { if (state) render(); }, 6100);
    clearTimeout(fxUI.timer);
    if (fxUI.cfg !== 'manual') { const ms = Math.max(...fresh.map(fxDelayFor)); fxUI.timer = setTimeout(() => { fxUI.open = false; if (state) render(); }, ms); }
  }
  fxUI.hits = { p1: new Set(), p2: new Set() };
  if (fxUI.markRec && Date.now() < fxUI.markUntil) { const n = fxHitNames(fxUI.markRec); fxUI.hits = n; }
}
function fxHitFor(p, stack) {
  if (!fxUI.markRec || Date.now() >= fxUI.markUntil || !fxUI.hits[p].has(S.card(stack.cardId).nameKo)) return null;
  return fxUI.markRec.src.owner !== p ? 'fx-hit-foe' : 'fx-hit-own';
}
function fxGhostNodes(p) {
  return fxUI.ghosts.filter(g => g.owner === p).map(g => {
    const c = S.card(g.cardId);
    return h('div', { className: `fx-ghost fx-${p}`, title: '눌러서 닫기', onClick: () => { fxUI.ghosts = fxUI.ghosts.filter(x => x !== g); render(); } }, [
      c.imgUrl ? artImg(S.artUrl(state, g.owner, g.cardId) || c.imgUrl, c.imgUrl, { alt: c.nameKo }) : null,
      h('div', { className: 'nm' }, c.nameKo),
      h('div', { className: 'fx-ghost-by' }, `소멸: ${g.by}`),
    ]);
  });
}
function fxRecView(rec, full) {
  const c = rec.src.cardId ? S.card(rec.src.cardId) : { nameKo: '' };
  const foreign = fxForeign(rec), so = rec.src.owner;
  const kids = [];
  if (foreign) {
    const n = fxHitNames(rec), tgt = pNm(so === 'p1' ? 'p2' : 'p1'), names = [...n[so === 'p1' ? 'p2' : 'p1']];
    kids.push(h('div', { className: 'fx-alert' }, `⚠ ${pNm(so)}의 「${c.nameKo}」 효과로 ${tgt} 피해` + (names.length ? ': ' + names.map(x => `「${x}」`).join(' ') : '')));
  }
  kids.push(h('div', { className: `fx-src-row fx-${so || 'rule'}` }, [
    rec.src.kind === 'effect' && c.imgUrl ? artImg(S.artUrl(state, so, rec.src.cardId) || c.imgUrl, c.imgUrl, { className: 'fx-src-img', alt: c.nameKo, onClick: () => { fxUI.info = rec.src.cardId; render(); } }) : null,
    h('div', {}, [
      h('div', { className: 'fx-src-name' }, rec.src.kind === 'effect'
        ? [h('span', { className: `fx-owner fx-${so}` }, pNm(so)), ' ', fxCardLink(rec.src.cardId, `「${c.nameKo}」`), rec.src.tag ? h('span', { className: 'fx-tag' }, `【${rec.src.tag}】`) : null, rec.src.inherited && rec.src.tag !== '시큐리티' ? h('span', { className: 'fx-tag' }, ' 진화원 효과') : null]
        : `⚙ ${rec.src.label}`),
      h('div', { className: 'meta' }, `턴 ${rec.turn}`),
      fxWhyNote(rec, false) ? h('div', { className: 'meta fx-why' }, fxWhyNote(rec, false)) : null,
    ]),
  ]));
  const res = fxResults(rec), shown = full ? res.slice(0, 14) : res;
  kids.push(res.length ? h('ul', { className: 'fx-results' }, [...shown.map(r => h('li', { className: r.owner ? `fx-${r.owner}` : '' }, r.text)), res.length > shown.length ? h('li', {}, `… 외 ${res.length - shown.length}건`) : null])
    : h('div', { className: 'meta' }, '(눈에 띄는 변화 없음)'));
  if (rec.text && (full || fxUI.expanded.has(rec.id))) kids.push(h('div', { className: 'fx-text' }, rec.text));
  return h('div', { className: 'fx-rec' + (foreign ? ' fx-rec-foe' : '') }, kids);
}
function fxVfxSelect() { // 이펙트 (activation VFX intensity, fx.js)
  return h('label', { className: 'meta fx-cfg' }, ['이펙트 ', h('select', { onchange: (e) => fxSetMode(e.target.value) },
    FX_MODE_LABELS.map(([v, l]) => { const o = h('option', { value: v }, l); if (v === fxGetMode()) o.selected = true; return o; }))]);
}
function readSpeedSelect() {
  return h('label', { className: 'meta fx-cfg' }, ['읽기 속도 ', h('select', { onchange: (e) => { READ.speed = e.target.value; try { localStorage.setItem('digimon_read_speed', READ.speed); } catch (err) { /* ignore */ } } },
    [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']].map(([v, l]) => { const o = h('option', { value: v }, l); if (v === READ.speed) o.selected = true; return o; }))]);
}
function fxFieldSelect() { // 필드 표기: annotate effects on the field (default on)
  return h('label', { className: 'meta fx-cfg' }, ['필드 표기 ', h('select', { onchange: (e) => { fxFieldSetOn(e.target.value === '1'); if (state) render(); } },
    FIELD_LABELS.map(([v, l]) => { const o = h('option', { value: v }, l); if ((v === '1') === fxFieldOn()) o.selected = true; return o; }))]);
}
function fxDelaySelect() {
  return h('label', { className: 'meta fx-cfg' }, ['효과 표시 ', h('select', { onchange: (e) => { fxUI.cfg = e.target.value; try { localStorage.setItem('digimon_fx_delay', fxUI.cfg); } catch (err) { /* ignore */ } } },
    [['auto', '읽는 시간 자동'], ['2', '짧게 2초'], ['5', '보통 5초'], ['10', '길게 10초'], ['manual', '수동 확인']].map(([v, l]) => { const o = h('option', { value: v }, l); if (v === fxUI.cfg) o.selected = true; return o; }))]);
}
function renderFxLayer() {
  const root = h('div', { className: 'fx-root' });
  if (fxUI.info) {
    const c = S.card(fxUI.info);
    root.appendChild(h('div', { className: 'fx-info', onClick: () => { fxUI.info = null; render(); } }, [
      c.imgUrl ? artImg(S.artUrl(state, state?.activePlayer, fxUI.info) || c.imgUrl, c.imgUrl, { alt: c.nameKo }) : null,
      h('div', {}, [h('b', {}, c.nameKo), h('div', { className: 'fx-text' }, c.effectKo || ''), h('div', { className: 'meta' }, '(눌러서 닫기)')]),
    ]));
  }
  if (!fxUI.queue.length || fxHeld()) return root; // resolution card never covers an open/pending choice modal or the activation VFX
  if (!fxUI.open) { root.appendChild(h('div', { className: 'fx-chip', onClick: () => { fxUI.open = true; render(); } }, `⚡ 효과 ${fxUI.queue.length}건 ▲`)); return root; }
  fxUI.idx = Math.min(Math.max(0, fxUI.idx), fxUI.queue.length - 1);
  const rec = fxUI.queue[fxUI.idx], n = fxUI.queue.length;
  root.appendChild(h('div', { className: 'fx-panel' + (fxForeign(rec) ? ' fx-panel-foe' : '') }, [
    h('div', { className: 'fx-head' }, [
      h('b', {}, '⚡ 효과 처리'),
      n > 1 ? h('span', { className: 'fx-pager' }, [
        h('button', { disabled: fxUI.idx <= 0, onClick: () => { fxUI.idx--; render(); } }, '◀ 이전'),
        ` ${fxUI.idx + 1}/${n} `,
        h('button', { disabled: fxUI.idx >= n - 1, onClick: () => { fxUI.idx++; render(); } }, '다음 ▶'),
      ]) : null,
      h('button', { className: 'primary', onClick: () => { fxUI.queue = []; fxUI.open = false; clearTimeout(fxUI.timer); render(); } }, '확인 ✕'),
    ]),
    fxRecView(rec, true),
    h('div', { className: 'fx-foot' }, [fxDelaySelect(), readSpeedSelect(), fxVfxSelect(), fxUI.cfg === 'manual' ? h('span', { className: 'meta' }, '확인을 누를 때까지 유지') : h('span', { className: 'meta' }, '잠시 후 자동으로 접힙니다')]),
  ]));
  return root;
}
function renderFxHistory() {
  const hist = (state.fxHistory || []).filter(r => !fxTrivial(r));
  return [
    fxFieldSelect(), fxDelaySelect(), readSpeedSelect(), fxVfxSelect(),
    ...(hist.length ? hist.map(r => h('div', { className: 'fx-hist-item', onClick: () => { fxUI.expanded.has(r.id) ? fxUI.expanded.delete(r.id) : fxUI.expanded.add(r.id); render(); } }, [
      h('div', { className: 'fx-hist-title' }, `${fxUI.expanded.has(r.id) ? '▼' : '▶'} ${fxSrcLabel(r)}`),
      fxRecView(r, false),
    ])) : [h('div', { className: 'meta' }, '아직 처리된 효과가 없습니다.')]),
  ];
}

// ================= breeding phase bar (육성 페이즈): big, always-visible choices incl. "do nothing" =================
const BREED = { auto: false };
try { BREED.auto = localStorage.getItem('digimon_breed_auto') === '1'; } catch (e) { /* ignore */ }
function breedingStatus() {
  const p = state.activePlayer, pl = state.players[p];
  const taken = !!state.breedingActionTaken;
  const canHatch = !taken && !pl.raising && pl.digitamaDeck.length > 0;
  const canMove = !taken && !!pl.raising && S.canMoveFromRaising(pl.raising);
  let reason = '';
  if (taken) reason = '이번 육성 페이즈에는 이미 부화/이동 중 하나를 했습니다 (룰 6-4).';
  else if (!canHatch && !canMove) reason = pl.raising ? '육성 에어리어의 카드가 아직 배틀 에어리어로 이동할 수 없습니다 (Lv.3 이상만 이동 가능).' : '부화할 디지타마가 없습니다.';
  else if (canHatch) reason = '육성 에어리어가 비어 있어 디지타마를 부화할 수 있습니다. 부화/이동은 선택사항입니다.';
  else reason = '육성 에어리어의 카드를 배틀 에어리어로 이동할 수 있습니다. 부화/이동은 선택사항입니다.';
  return { p, canHatch, canMove, reason };
}
function breedingSkip() { if (!state || state.phase !== 'breeding' || busy() || cpuHumanLocked()) return; if (netIntercept('skipBreeding', [])) return; E.nextPhase(state); render(); }
function renderBreedingBar() {
  if (!state || state.winner || state.phase !== 'breeding' || busy() || cpuTurnView()) return null;
  const { p, canHatch, canMove, reason } = breedingStatus();
  const nothingElse = !canHatch && !canMove;
  const minimized = mbBreedKey(`${state.turnNumber}${p}`);
  return h('div', { className: 'breed-bar' + (minimized ? ' min' : ''), role: 'group', 'aria-label': '육성 페이즈' }, [
    h('div', { className: 'breed-title' }, `🥚 ${p.toUpperCase()} 육성 페이즈`),
    h('div', { className: 'breed-reason' }, reason),
    h('div', { className: 'breed-btns' }, [
      canHatch ? h('button', { className: 'breed-btn', onClick: () => { if (netIntercept('hatch', [p])) return; if (blockIfBusy()) return; S.hatchDigitama(state, p); render(); } }, '🥚 부화') : null,
      canMove ? h('button', { className: 'breed-btn', onClick: () => { if (netIntercept('move', [p])) return; if (blockIfBusy()) return; S.moveRaisingToBattle(state, p); render(); } }, ['⬆ ', h('span', { className: 'lbl-mob-hide' }, '배틀 에어리어로 '), '이동']) : null,
      h('button', { className: 'breed-btn breed-skip' + (nothingElse ? ' primary' : ''), title: '단축키: Space / Enter', onClick: breedingSkip }, ['⏭ ', MB.compact ? '넘김' : '아무것도 안 함 → 메인 페이즈로']),
    ]),
    h('button', { className: 'breed-info', title: '설명 보기', 'aria-label': '설명', onClick: (e) => e.currentTarget.closest('.breed-bar').classList.toggle('show-reason') }, 'ⓘ'),
    h('button', { className: 'breed-expand', title: '펼치기', 'aria-label': '펼치기', onClick: mbBreedExpand }, '▴'),
    h('label', { className: 'breed-auto meta' }, [
      h('input', { type: 'checkbox', checked: BREED.auto, onchange: (e) => { BREED.auto = !!e.target.checked; try { localStorage.setItem('digimon_breed_auto', BREED.auto ? '1' : '0'); } catch (err) { /* ignore */ } render(); } }),
      ' 육성 페이즈 자동 넘김 (부화/이동을 마치면 바로 메인 페이즈로)', h('span', { className: 'breed-key' }, ' · Space/Enter = 아무것도 안 함'),
    ]),
  ]);
}
document.addEventListener('keydown', (e) => { // Esc = drop the current hand/stack selection (when no dialog is open)
  if (e.key !== 'Escape' || !state || document.querySelector('.modal-backdrop, .modal-panel') || !(sel.hand || sel.stack || sel.stack2)) return;
  sel.hand = null; sel.stack = null; sel.stack2 = null; render();
});
document.addEventListener('keydown', (e) => {
  if (!state || state.phase !== 'breeding' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key !== ' ' && e.key !== 'Enter') return;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'BUTTON') return;
  if (!document.querySelector('.breed-bar') || document.querySelector('.modal-backdrop')) return;
  e.preventDefault(); breedingSkip();
});

window.__dbg = () => ({ PR, dragData, sel, state, S, E, Effects, render, attackFlow, fxUI, runner: () => ({ pendingRunner: !!pendingRunner, runningPendingUid, attempted: [...autoRunAttempted] }) });
init();
