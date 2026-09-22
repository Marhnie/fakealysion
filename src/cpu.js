// vs-CPU opponent (P2).  Two layers:
//   1. DECISIONS (pure, work in the browser AND in node): mulligan, breeding, the next main-phase action, attack target,
//      block / counter / redirect answers, and answers to every ctx.choose() kind.  They only READ the game state and use the
//      same legality helpers the UI uses (E.evolutionMethods / canEvolveAny / S.legalDigimonTargets / S.canAttackPlayer /
//      S.canPayCost …); the action itself is always performed by the real game code (main.js api or the headless driver in
//      scripts/test-cpu.mjs).
//   2. UI DRIVER (createUiDriver): a heartbeat that watches the live game and, whenever the CPU has to act (its own turn, a
//      prompt that belongs to it, a block/counter window on the human's attack), performs ONE step with human-readable pacing.
//      It never deadlocks: every step is validated by observing state change (no change -> that action is banned for the
//      turn), exceptions are caught, and a watchdog falls back to pass / first option after a long stall.
//
// Levels: easy   = mostly random legal plays with basic sense
//         normal = greedy value + memory management + sensible attacks/blocks
//         hard   = normal + lethal detection, threat evaluation (keeps blockers back), bait ordering, mulligan/recovery timing.
// (No state cloning: card effects run through module-level registries, so a faithful 1-2 ply simulation is not feasible; the
// hard level uses an abstract attack model instead — see lethalPlan / attackCandidates.)
import * as S from './state.js';
import * as E from './engine.js';
import * as Fx from './effects.js';

export const LEVEL_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움', expert: '전문가' };
export const SPEED_LABEL = { fast: '빠르게', normal: '보통', slow: '느리게' };
const R = { rng: Math.random };
// tunable knobs (scripts/test-cpu.mjs --tune=key:value,… used them to calibrate the levels)
// The keys below hardGain2 … are the "explicit params" of the self-play optimisation (scripts/cpu-arena.mjs / cpu-evolve.mjs): every default reproduces the
// behaviour the levels had before the params existed.  A per-player override travels as cfg.params (see makeParams / tp()); the 'expert' level = tuned params.
export const TUNE = { hardReserve: 3.5, hardThrA: -2, normThrA: 1.0, hardThreshold: 1.2, hardLimit: 5, hardGw: 1.0, secDpMid: 6800, pSecDig: 0.6, hardGain2: 3.2, hardChump: 3, hardLethal: 1,
  gainBase: 2.2, pBlockHi: 0.75, pBlockLo: 0.35, tBlockHi: 0.6, tBlockLo: 0.3, cThr: 1.5, baitBonus: 0, dangerLim: 3, tieBlockSec: 3, chumpVal: 5, mullCost: 3, mullHiCost: 5,
  // search / evaluation params (read by src/cpusearch.js through cfg.params): group multipliers on the fitted eval weights + tactical terms
  evSec: 1, evBoard: 1, evHand: 1, evMem: 1, evDev: 1, evTempo: 1, lethalW: 40, threatW: 1, priorW: 2, deckLowW: 25,
  // option / tamer play (docs/cpu-option-tamer-play.md; only level hard / expert): optTam = master switch (0 = the pre-fix behaviour), the rest are score offsets / weights
  optTam: 1, tamBonus: 0, engBonus: 0, tamDisc: 1, optBonus: 0, optCostW: 0.6, tamGiftMax: 10, optGiftMax: 10 };
// name -> [min, max] search ranges of the optimiser (only the keys listed here are evolved)
export const PARAM_RANGES = {
  hardReserve: [0, 8], hardThrA: [-5, 2], hardThreshold: [0.3, 3], hardLimit: [2, 8], hardGw: [0.3, 2.5], secDpMid: [4500, 9000], pSecDig: [0.2, 1], hardGain2: [1.5, 6], hardChump: [0, 5],
  gainBase: [1, 4], pBlockHi: [0.4, 1], pBlockLo: [0, 0.7], cThr: [0.5, 3.5], baitBonus: [0, 3], dangerLim: [1, 5], tieBlockSec: [1, 5], chumpVal: [2, 9], mullCost: [2, 5], mullHiCost: [3, 8],
  evSec: [0.3, 2.5], evBoard: [0.2, 3], evHand: [0.2, 3], evMem: [0, 3], evDev: [0, 3], evTempo: [0, 2.5], lethalW: [10, 80], threatW: [0.3, 2.5], priorW: [0, 4],
};
// -> a complete params object (defaults + partial overrides).  Never mutates TUNE.
export function makeParams(partial) { return { ...TUNE, ...(partial || {}) }; }
const tp = (cfg) => (cfg && cfg.params) || TUNE;
// 'expert' = level hard's logic + tuned params (data/cpu-params.json, loaded by loadParams()) + a deeper search inside the time budget
export const EXPERT = { params: null, meta: null, search: { depth: 4, budgetMs: 1250, hardCapMs: 1400, rootBeam: 8, beam: 5, samples: 2 }, headlessNodes: 60 }; // 1.3 s soft / 1.5 s hard wall-clock per decision (hard: 0.9 s / 2.5 s)
export const isHardLike = (level) => level === 'hard' || level === 'expert';
// level name -> decision config { level: internal logic level, params }.  'expert' is hard logic + tuned params.
export function levelCfg(level) { return level === 'expert' ? { level: 'hard', params: EXPERT.params } : { level, params: null }; }
// data/cpu-params.json ({version, level:'hard', params:{…}, search?:{…}, trainedGames, winrateVsBaseline}); a missing / broken file leaves the built-in defaults (safe fallback)
export async function loadParams(fetchFn) {
  try {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) return false;
    const r = await f('./data/cpu-params.json');
    if (r && r.ok === false) return false;
    const j = await r.json();
    if (!j || typeof j.params !== 'object') return false;
    const clean = {};
    for (const k of Object.keys(j.params)) if (k in TUNE && Number.isFinite(Number(j.params[k]))) clean[k] = Number(j.params[k]);
    EXPERT.params = makeParams(clean);
    EXPERT.meta = { version: j.version, trainedGames: j.trainedGames, winrateVsBaseline: j.winrateVsBaseline };
    if (j.search && typeof j.search === 'object') for (const k of Object.keys(j.search)) if (Number.isFinite(Number(j.search[k]))) EXPERT.search[k] = Number(j.search[k]);
    if (Number.isFinite(Number(j.headlessNodes))) EXPERT.headlessNodes = Number(j.headlessNodes);
    return true;
  } catch (e) { return false; }
}
export function setRng(fn) { R.rng = fn || Math.random; }
export function getRng() { return R.rng; }
// lookahead search plug-in (src/cpusearch.js registers itself here; cpu.js never imports it -> no import cycle).
// search(state, p, cfg, opts) -> Promise<action | null>; null = "no opinion" (the heuristic planMain decides)
export const HOOKS = { search: null };
// heuristics shared with the search (src/cpusearch.js)
export const HX = { stackValue: (...a) => stackValue(...a), handCardValue: (...a) => handCardValue(...a), lethalPlan: (...a) => lethalPlan(...a), canDeclareAttack: (...a) => canDeclareAttack(...a), isBlockerNow: (...a) => isBlockerNow(...a), hasKw: (...a) => hasKw(...a), dpOf: (...a) => dpOf(...a), isDigi: (...a) => isDigi(...a) };
const rnd = () => R.rng();
const pickRand = (a) => a[Math.floor(rnd() * a.length)];
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const safe = (fn, d) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };
const card = (id) => S.card(id);
const isDigi = (st) => card(st.cardId).category === 'digimon';
const memOf = (state, p) => (p === 'p1' ? state.memory : -state.memory);

// ---------- state helpers ----------
const ownStacks = (pl) => [pl.raising, ...pl.battle].filter(Boolean);
// Per-decision memo: while one decision function (planMain / enumerateActions / attackCandidates / decideBlock …) runs, the game state is constant, so the
// (expensive, hook-scanning) DP / keyword / value lookups are cached by stack uid.  Entered only through memoized() below; cleared on entry and exit.
const MEMO = { d: 0, m: new Map() };
const memoized = (fn) => function (...a) { if (MEMO.d++ === 0) MEMO.m.clear(); try { return fn.apply(this, a); } finally { if (--MEMO.d === 0) MEMO.m.clear(); } };
const memo = (k, f) => { let v = MEMO.m.get(k); if (v === undefined) { v = f(); MEMO.m.set(k, v); } return v; };
const dpOf = (state, p, st) => (MEMO.d ? memo('d' + p + st.uid, () => dpOf0(state, p, st)) : dpOf0(state, p, st));
const dpOf0 = (state, p, st) => safe(() => S.effectiveDP(state, p, st), card(st.cardId).dp || 0);
const hasKw = (state, p, st, k) => (MEMO.d ? memo('k' + p + st.uid + k, () => hasKw0(state, p, st, k)) : hasKw0(state, p, st, k));
const hasKw0 = (state, p, st, k) => safe(() => !!(S.hasKeyword(st, k) || S.hasContinuousKeyword(state, p, st, k) || S.hookGrantedKeywords(state, p, st).includes(k)), false);
const checksOf = (state, p, st) => (MEMO.d ? memo('c' + p + st.uid, () => safe(() => 1 + S.hookSecurityAttackBonus(state, p, st), 1)) : safe(() => 1 + S.hookSecurityAttackBonus(state, p, st), 1));
function isBlockerNow(state, p, st, colliding = false) { return MEMO.d ? memo('b' + p + st.uid + (colliding ? 1 : 0), () => isBlockerNow0(state, p, st, colliding)) : isBlockerNow0(state, p, st, colliding); }
function isBlockerNow0(state, p, st, colliding = false) {
  if (!isDigi(st) || st.suspended) return false;
  if (!colliding && !hasKw(state, p, st, '블로커')) return false;
  return safe(() => S.canRestByRule(state, p, st) && !S.s3Flag(state, st, 'noBlock') && !S.hookNoBlock(state, p, st), false);
}
function stackValue(state, p, st) { return MEMO.d ? memo('s' + p + st.uid, () => stackValue0(state, p, st)) : stackValue0(state, p, st); }
function stackValue0(state, p, st) {
  const c = card(st.cardId);
  if (c.category === 'tamer') return 3.5;
  if (c.category !== 'digimon' && c.category !== 'digitama') return 1;
  let v = 1 + (c.level || 0) * 0.9 + dpOf(state, p, st) / 2500 + (st.sources ? st.sources.length : 0) * 0.25;
  if (hasKw(state, p, st, '블로커')) v += 1.5;
  if (hasKw(state, p, st, '관통')) v += 1.2;
  if (hasKw(state, p, st, '재밍')) v += 1.2;
  if (hasKw(state, p, st, '속공')) v += 0.5;
  if (hasKw(state, p, st, '재기동')) v += 0.8;
  v += 1.5 * safe(() => S.securityAttackBonus(st), 0);
  return v;
}
// value of a card sitting in the hand (higher = keep); used to pick discards
function handCardValue(id) {
  const c = card(id);
  if (c.category === 'digimon') return 1 + (c.level || 0) * 1.1 + (c.dp || 0) / 3000 - (c.cost || 0) * 0.05;
  if (c.category === 'tamer') return 4.5;
  if (c.category === 'option') return 3;
  return 1;
}
function findAny(state, p, uid) {
  const pl = state.players[p];
  return pl.raising && pl.raising.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null;
}
const hasBattle = (state, p, uid) => !!state.players[p].battle.find((s) => s.uid === uid);

// ---------- mulligan ----------
export function shouldMulligan(state, p, level, params) {
  if (level === 'expert') { level = 'hard'; params = params || EXPERT.params; }
  const P = params || TUNE;
  const hand = state.players[p].hand.map(card);
  const lv3 = hand.filter((c) => c.category === 'digimon' && c.level === 3);
  const cheapLv3 = lv3.filter((c) => (c.cost || 0) <= P.mullCost);
  if (level === 'easy') return rnd() < 0.15 ? true : !(lv3.length >= 1);
  if (cheapLv3.length >= 1 || lv3.length >= 2) return false;
  if (level === 'hard') {
    // one expensive Lv3 is fine if the hand also has a Lv4 to evolve into or a tamer/draw support
    const lv4 = hand.filter((c) => c.category === 'digimon' && c.level === 4).length;
    const tamers = hand.filter((c) => c.category === 'tamer').length;
    if (lv3.length >= 1 && (lv4 >= 1 || tamers >= 1) && lv3.some((c) => (c.cost || 0) <= P.mullHiCost)) return false;
  }
  return true;
}

// ---------- breeding phase ----------
export function planBreeding(state, p, cfg) {
  const pl = state.players[p];
  if (state.breedingActionTaken) return { type: 'skipBreeding' };
  const canMove = !!pl.raising && S.canMoveFromRaising(pl.raising) && !safe(() => S.isPlayRestricted(state, p, pl.raising.cardId), false);
  const canHatch = !pl.raising && pl.digitamaDeck.length > 0;
  if (cfg.level === 'easy' && rnd() < 0.3) return { type: 'skipBreeding' };
  if (canMove) {
    // keep a Lv3+ in the (safe) raising area only when it still wants to evolve and the board is healthy
    const bat = pl.battle.filter(isDigi).length;
    if (cfg.level === 'hard' && bat >= 4 && (card(pl.raising.cardId).level || 0) <= 3 && pl.digitamaDeck.length === 0) return { type: 'skipBreeding' };
    return { type: 'move', key: 'move' };
  }
  if (canHatch) return { type: 'hatch', key: 'hatch' };
  return { type: 'skipBreeding' };
}

// ---------- main-phase enumeration ----------
function estPlayCost(state, p, id) {
  const c = card(id);
  let d = 0;
  if (c.category === 'digimon') d = safe(() => S.tamerPlayCostDiscount(state, p, id) + S.traitPlayCostDiscount(state, p, id) + S.s1PlayDiscount(state, p, id) + S.handSelfPlayDiscount(state, p, id), 0);
  if (d < 0 && safe(() => S.isPlayCostLocked(state), false)) d = 0;
  return Math.max(0, (c.cost || 0) + d);
}
const KW_RE = { 블로커: /[《≪]블로커[》≫]/, 관통: /[《≪]관통[》≫]/, 재밍: /[《≪]재밍[》≫]/, 속공: /[《≪]속공[》≫]/, 시큐리티어택: /[《≪]시큐리티\s*어택|S\s*어택/ };
function textKwBonus(id) {
  const t = (card(id).effectKo || '') + (card(id).inheritedKo || '');
  let b = 0;
  for (const k of Object.keys(KW_RE)) if (KW_RE[k].test(t)) b += k === '블로커' ? 1 : 0.8;
  return b;
}
function optionMainText(id) {
  const segs = safe(() => S.parseEffectSegments(S.optionView(id).effectKo || '').segments, []); // (dual cards: the option half)
  return segs.filter((s) => s.tags.includes('메인')).map((s) => s.body).join(' ');
}
// -> { score, why } | null (null = pointless right now)
// opponent Digimon an option text can actually hit: "등장 코스트 N 이하의 상대 …" / "Lv.N 이하·이상의 상대 …" / "DP N 이하의 상대 …" / 액티브·레스트 상태의 상대 …
// (conditional upgrades — "대신", "마리당", "있을 때" — stay lenient: the list is returned unfiltered)
function optionTargets(state, o, t, list) {
  if (/(대신|마리당|명당|있을\s*때|있다면|있는\s*동안)/.test(t)) return list;
  let out = list, m;
  if ((m = /등장\s*코스트\s*(\d+)\s*이하(?:인|의)?\s*상대/.exec(t))) out = out.filter((s) => (card(s.cardId).cost || 0) <= +m[1]);
  if ((m = /Lv\.?\s*(\d)\s*(이하|이상)(?:인|의)?\s*상대/.exec(t))) out = out.filter((s) => (m[2] === '이하' ? (card(s.cardId).level || 0) <= +m[1] : (card(s.cardId).level || 0) >= +m[1]));
  if ((m = /DP\s*(\d+)\s*이하(?:인|의)?\s*상대/.exec(t))) out = out.filter((s) => dpOf(state, o, s) <= +m[1]);
  if (/액티브\s*상태(?:인|의)\s*상대/.test(t)) out = out.filter((s) => !s.suspended);
  if (/레스트\s*상태(?:인|의)\s*상대/.test(t)) out = out.filter((s) => s.suspended);
  return out;
}
// an own Digimon that can evolve into a Digimon card of my hand (cost ignored: the option pays / discounts it)
function evoPairPossible(state, p, lvFrom, lvTo) {
  const pl = state.players[p];
  const hand = [...new Set(pl.hand.filter((id) => card(id).category === 'digimon' && (lvTo == null || card(id).level === lvTo)))];
  if (!hand.length) return false;
  for (const st of pl.battle.filter(isDigi)) {
    if (lvFrom != null && card(st.cardId).level !== lvFrom) continue;
    const restr = safe(() => S.evolveTargetRestriction(state, p, st), null), extra = safe(() => S.evoExtraArg(state, p, st), []);
    for (const id of hand) if (safe(() => E.canEvolveAny(st.cardId, id, extra, restr).ok, false)) return true;
  }
  return false;
}
function optionValue(state, p, id, fix) {
  const t = optionMainText(id);
  if (!t) return null;
  const me = state.players[p], oppPl = state.players[opp(p)];
  let oppDig = oppPl.battle.filter(isDigi);
  const myDig = me.battle.filter(isDigi);
  const canAtk = myDig.filter((s) => !s.suspended && (state.turnNumber >= s.attackEligibleTurn || hasKw(state, p, s, '속공'))).length;
  // fix (normal / hard / expert): texts say "상대 디지몬" as often as "상대의 디지몬" — the old /상대의/ tests classified most removal / bounce options as 'misc' (score 2 - cost·0.6 < 0: never cast)
  const mentionsOppTarget = (fix ? /상대(?:의)?\s*(디지몬|테이머|액티브|레스트)/ : /상대의\s*(디지몬|테이머|액티브|레스트)/).test(t);
  const oppRef = fix ? mentionsOppTarget : /상대의/.test(t);
  if (fix && oppRef) oppDig = optionTargets(state, opp(p), t, oppDig); // a removal / bounce / rest with no legal target is a wasted card + wasted memory
  let sc = 2, why = 'misc';
  if (fix && /(진화시킬\s*수\s*있다|진화시킨다)/.test(t) && /진화\s*코스트/.test(t) && !oppRef) { if (!evoPairPossible(state, p, null, null)) return null; sc = 4.5; why = 'free'; }
  else if (fix && /진화\s*코스트를?\s*-\s*\d+\s*(?:한다|하고)/.test(t) && /Lv\.?\s*(\d)\s*에서\s*Lv\.?\s*(\d)/.test(t)) { const m = /Lv\.?\s*(\d)\s*에서\s*Lv\.?\s*(\d)/.exec(t); if (!evoPairPossible(state, p, +m[1], +m[2])) return null; sc = 3.5; why = 'free'; }
  else if (/소멸/.test(t) && oppRef && !(fix && /소멸하지\s*않|소멸되지\s*않/.test(t) && !/소멸시/.test(t))) { if (!oppDig.length) return null; sc = 6 + Math.max(...oppDig.map((s) => stackValue(state, opp(p), s))) * 0.3; why = 'removal'; }
  else if (/(아래로\s*되돌|패로\s*되돌|핸드로\s*되돌)/.test(t) && oppRef) { if (!oppDig.length) return null; sc = 4.5; why = 'bounce'; }
  else if (fix >= 2 && oppRef && /(어택과\s*블록을\s*할\s*수\s*없|어택을?\s*할\s*수\s*없)/.test(t)) { // defensive: "상대 디지몬은 다음 상대 턴 종료까지 어택할 수 없다" — only worth its cost when I am the one being pressured
    if (!oppDig.length) return null;
    const threat = oppDig.length + Math.max(0, 4 - me.security.length);
    if (me.security.length > 4 && oppDig.length < 3) return null;
    sc = 1.2 + threat * 0.6; why = 'restrict';
  }
  else if (/시큐리티/.test(t) && /(위에\s*놓|추가|회복|덱\s*위)/.test(t) && !/상대의\s*시큐리티/.test(t)) { sc = 3 + Math.max(0, 4 - me.security.length) * 1.4; why = 'recover'; }
  else if (/(뽑는다|드로우|패에\s*추가)/.test(t)) { sc = 4; why = 'draw'; }
  else if (/메모리.*(얻|\+|플러스)/.test(t)) { sc = 3.5; why = 'memory'; }
  else if (/(등장시킨다|진화시킨다|코스트를?\s*지불하지)/.test(t)) { sc = 4.5; why = 'free'; }
  else if (/DP.*[+＋]\s*\d|[+＋]\s*\d+\s*DP|DP를\s*[+＋]/.test(t) && !mentionsOppTarget) { if (!canAtk) return null; sc = 3; why = 'pump'; }
  else if (/레스트/.test(t) && mentionsOppTarget) { if (!oppDig.length) return null; sc = 3.5; why = 'rest'; }
  else if (/(-\s*\d+000|DP를\s*-)/.test(t) && mentionsOppTarget) { if (!oppDig.length) return null; sc = 3.5; why = 'shrink'; }
  else if (mentionsOppTarget && !oppDig.length && !oppPl.battle.length) return null;
  if (/자신의\s*(디지몬|테이머)\s*\d*\s*마리/.test(t) && !/상대/.test(t) && !myDig.length && !me.battle.length) return null;
  return { score: sc, why };
}
const TAMER_INFO = new Map();
function tamerInfo(id) {
  let v = TAMER_INFO.get(id);
  if (!v) { const t = String(card(id).effectKo || ''); v = { engine: /【자신의\s*(?:턴|메인\s*페이즈)\s*개시\s*시】[^【]*메모리/.test(t), disc: /(?:진화|등장)\s*코스트[^.。]{0,24}-\s*\d/.test(t) }; TAMER_INFO.set(id, v); }
  return v;
}
// a tamer that makes later evolutions / plays of the same turn cheaper is worth playing BEFORE them (tamDisc); memory-engine tamers get engBonus (measured: eager engine play LOSES, default 0)
function tamerBonus(id, P) { const i = tamerInfo(id); return P.tamBonus + (i.engine ? P.engBonus : 0) + (i.disc ? P.tamDisc : 0); }
function canUseOptionNow(state, p, id) {
  return safe(() => S.optionColorOk(state, p, id) && !S.timedLocked(state, p, 'option') && !S.s1HookAny(state, 's1cannotUseOption', { p }), false);
}

function jogressOptions(state, p, cardId) {
  const jg = safe(() => (card(cardId).category === 'digimon' ? S.parseJogress(cardId) : null), null);
  if (!jg) return [];
  const bat = state.players[p].battle.filter(isDigi);
  const out = [];
  for (let i = 0; i < bat.length; i++) for (let j = i + 1; j < bat.length; j++) {
    const a = bat[i], b = bat[j];
    if (!safe(() => S.canJogress(a, b, cardId).ok, false)) continue;
    const rr = [a, b].map((s) => E.evoRestrictionCheck(cardId, S.evolveTargetRestriction(state, p, s))).find((r) => !r.ok);
    if (rr) continue;
    const ca = card(a.cardId), cb = card(b.cardId);
    const aTop = (jg.left(ca) && jg.right(cb)) || !(jg.left(cb) && jg.right(ca));
    const [top, bottom] = aTop ? [a, b] : [b, a];
    const delta = safe(() => S.previewEvoCostDelta(state, p, bottom, cardId), 0);
    out.push({ top, bottom, cost: Math.max(0, jg.cost + delta) });
  }
  return out;
}

function canDeclareAttack(state, p, st) {
  if (!isDigi(st) || st.suspended) return false;
  if (state.turnNumber < st.attackEligibleTurn && !hasKw(state, p, st, '속공')) return false;
  if (st.cannotAttackUntil === 'permanent' || (typeof st.cannotAttackUntil === 'number' && state.turnNumber <= st.cannotAttackUntil)) return false;
  if (!safe(() => S.canRestByRule(state, p, st), true)) return false;
  if (safe(() => S.hookNoAttack(state, p, st) || S.s1CannotAttack(state, p, st), false)) return false;
  if (safe(() => S.cannotAttackNoOppDigimon(state, p, st), false)) return false; // Guardromon: no attacks while the opponent has no Digimon (the CPU used to retry the rejected declaration 40x per turn)
  return true;
}

// -> [{ type:'evolve'|'play'|'option'|'jogress'|'train'|'main', cost, score, key, ... }]
function enumerateActions_(state, p, cfg) {
  const OT = !!(cfg && cfg.level === 'hard' && tp(cfg).optTam), TP = tp(cfg);
  const FIX = !cfg || cfg.level === 'easy' ? 0 : cfg.level !== 'hard' ? 1 : OT ? 2 : 0; // option-text fixes: 1 = normal (bug fixes), 2 = hard / expert (+ defensive options), 0 = pre-fix behaviour (params.optTam = 0)
  const pl = state.players[p];
  const acts = [];
  const seenHand = new Set();
  const board = ownStacks(pl);
  const atkReady = pl.battle.filter((s) => canDeclareAttack(state, p, s));
  // evolve
  const handDigi = [...new Set(pl.hand.filter((id) => card(id).category === 'digimon'))];
  for (const st of board) {
    const cat = card(st.cardId).category;
    if (!['digimon', 'digitama', 'tamer'].includes(cat)) continue;
    const restr = safe(() => S.evolveTargetRestriction(state, p, st), null);
    const extra = safe(() => S.evoExtraArg(state, p, st), []);
    for (const id of handDigi) {
      const ms = safe(() => E.evolutionMethods(st.cardId, id, extra, restr, { state, p, stack: st }), []);
      const plain = ms.filter((m) => !m.sideEffect);
      let base = null;
      if (plain.length) base = Math.min(...plain.map((m) => m.baseCost));
      else if (!ms.length && cat !== 'tamer') { const chk = safe(() => E.canEvolveAny(st.cardId, id, extra, restr), { ok: false }); if (chk.ok) base = chk.cost; }
      if (base == null) continue;
      const cost = Math.max(0, base + safe(() => S.previewEvoCostDelta(state, p, st, id), 0));
      if (!S.canPayCost(state, cost)) continue;
      const nc = card(id), oc = card(st.cardId);
      const dpGain = (nc.dp || 0) - dpOf(state, p, st);
      const lvGain = (nc.level || 0) - (oc.level || 0);
      if (cat !== 'tamer' && dpGain <= 0 && lvGain <= 0 && cost > 0) continue;
      let score = 4 + dpGain / 1200 + lvGain * 1.0 + textKwBonus(id) + 1.5 - cost * 0.7;
      if (pl.raising && st.uid === pl.raising.uid) score -= 0.5;
      else if (canDeclareAttack(state, p, st)) score += 1;
      if (cat === 'tamer') score -= 1;
      acts.push({ type: 'evolve', uid: st.uid, cardId: id, cost, score, key: 'ev:' + st.uid + ':' + id });
    }
  }
  // play digimon / tamer / use option / jogress
  for (let i = 0; i < pl.hand.length; i++) {
    const id = pl.hand[i];
    if (seenHand.has(id)) continue;
    seenHand.add(id);
    const c = card(id);
    if (c.category === 'digimon' || c.category === 'tamer') {
      if (c.category === 'digimon' && (S.isDual(id) || safe(() => S.isPlayRestricted(state, p, id), false))) { /* cannot play (dual cards have no 등장 코스트: option use / evolve only) */ }
      else {
        const cost = estPlayCost(state, p, id);
        if (S.canPayCost(state, cost)) {
          let score;
          if (c.category === 'tamer') score = 3.6 - cost * 0.55 + (/메모리/.test(c.effectKo || '') ? 1.2 : 0) + (OT ? tamerBonus(id, TP) : 0);
          else score = 2.4 + (c.dp || 0) / 1500 + textKwBonus(id) - cost * 0.6 + (pl.battle.filter(isDigi).length < 2 ? 2 : 0) + (pl.battle.filter(isDigi).length >= 5 ? -1.5 : 0);
          acts.push({ type: 'play', cardId: id, cost, score, key: 'pl:' + id });
        }
      }
      if (c.category === 'digimon') {
        for (const jo of jogressOptions(state, p, id)) {
          if (!S.canPayCost(state, jo.cost)) continue;
          const score = 5 + (c.dp || 0) / 1200 + (c.level || 0) - jo.cost * 0.5;
          acts.push({ type: 'jogress', cardId: id, a: jo.top.uid, b: jo.bottom.uid, cost: jo.cost, score, key: 'jg:' + id + ':' + jo.top.uid + jo.bottom.uid });
        }
      }
    }
    if (c.category === 'option' || S.isDual(id)) { // (a dual card in hand: Digimon half evolves via the evolve actions above/below, Option half is used here)
      if (!canUseOptionNow(state, p, id)) continue;
      const cost = safe(() => Math.max(0, S.optionBaseCost(state, p, id)), S.optionView(id).cost || 0);
      if (!S.canPayCost(state, cost)) continue;
      const v = optionValue(state, p, id, FIX);
      if (!v) continue;
      acts.push({ type: 'option', cardId: id, cost, score: v.score - cost * (OT ? TP.optCostW : 0.6) + (OT ? TP.optBonus : 0), why: v.why, key: 'op:' + id });
    }
  }
  // 트레이닝 / 【메인】 abilities
  board.forEach((st) => {
    const zone = pl.raising && st.uid === pl.raising.uid ? 'raising' : 'battle';
    if (hasKw(state, p, st, '트레이닝') && !st.suspended && pl.deck.length > 3 && !canDeclareAttack(state, p, st) && safe(() => S.canRestByRule(state, p, st), true)) acts.push({ type: 'train', uid: st.uid, cost: 0, score: 2.2, key: 'tr:' + st.uid });
    const abs = safe(() => S.activatableMainAbilities(state, p, st, zone), []);
    abs.forEach((ab, idx) => {
      const ok = safe(() => Fx.mainAbilityPayable(state, S, p, st.uid, ab.cardId, ab.tags, ab.text), false);
      if (ok && ab.cardId === 'BT1-089' && !(pl.raising ? (S.card(pl.raising.cardId).category === 'digimon' && (S.card(pl.raising.cardId).level || 0) >= 3) : pl.digitamaDeck.length > 0)) return; // hatch / move impossible -> resting the tamer would do nothing
      if (ok) acts.push({ type: 'main', uid: st.uid, idx, cost: 0, score: 2.6, key: 'mn:' + st.uid + ':' + idx + ':' + ab.cardId });
    });
    // 16-17 ≪딜레이≫: a placed Option (not on the turn it was placed) may be discarded for its bullet effect — the CPU used to leave these cards on the field forever
    if (zone === 'battle' && S.card(st.cardId).category === 'option' && state.turnNumber > (st.placedTurn ?? 0)) {
      const body = safe(() => S.parseDelayEffect(S.card(st.cardId).effectKo), null);
      if (body && safe(() => Fx.mainAbilityPayable(state, S, p, st.uid, st.cardId, ['메인'], body), false)) acts.push({ type: 'delay', uid: st.uid, cost: 0, score: /메모리/.test(body) ? 3.1 : 2.3, key: 'dl:' + st.uid });
    }
  });
  void atkReady;
  return acts;
}

// ---------- attack evaluation ----------
function lethalPlan(state, p) {
  const op = opp(p), opl = state.players[op];
  const atk = state.players[p].battle.filter((s) => canDeclareAttack(state, p, s) && safe(() => S.canAttackPlayer(state, p, s.uid), true));
  const sec = opl.security.length;
  const blockers = opl.battle.filter((s) => isBlockerNow(state, op, s)).length;
  const list = atk.map((s) => ({ uid: s.uid, checks: checksOf(state, p, s), dp: dpOf(state, p, s) })).sort((a, b) => b.checks - a.checks || b.dp - a.dp);
  const through = list.slice(blockers); // the defender blocks the strongest ones first
  if (through.length === 0) return { lethal: false, sec, blockers, uids: [] };
  if (sec === 0) return { lethal: true, sec, blockers, uids: through.map((x) => x.uid) };
  if (through.length < 2) return { lethal: false, sec, blockers, uids: [] };
  const sorted = through.slice().sort((a, b) => b.checks - a.checks);
  const last = sorted[sorted.length - 1];
  const drain = sorted.slice(0, -1).reduce((n, x) => n + x.checks, 0);
  const lethal = drain >= sec && last.checks >= 1;
  return { lethal, sec, blockers, uids: lethal ? through.map((x) => x.uid) : [] };
}

const pLoseVsSecurity = (aDP, jam, P = TUNE) => (jam ? 0 : P.pSecDig * Math.max(0, Math.min(1, (P.secDpMid - aDP) / 4300)));

function battleOutcome(aDP, bDP, valA, valB) { // value delta for the attacker when it fights a blocker/target
  if (aDP > bDP) return valB;
  if (aDP === bDP) return valB - valA;
  return -valA;
}

function attackCandidates_(state, p, cfg) {
  const level = cfg.level, P = tp(cfg);
  const pl = state.players[p], op = opp(p), opl = state.players[op];
  const lp = level !== 'easy' ? lethalPlan(state, p) : { lethal: false, uids: [] };
  const oppBlockers = opl.battle.filter((s) => isBlockerNow(state, op, s));
  const bestBlockerDP = oppBlockers.length ? Math.max(...oppBlockers.map((s) => dpOf(state, op, s))) : -1;
  const bestBlocker = oppBlockers.find((s) => dpOf(state, op, s) === bestBlockerDP);
  const mySec = pl.security.length;
  const oppThreat = opl.battle.filter((s) => isDigi(s) && (state.turnNumber + 1 >= s.attackEligibleTurn || true)).length;
  const out = [];
  for (const st of pl.battle) {
    if (!canDeclareAttack(state, p, st)) continue;
    const aDP = dpOf(state, p, st);
    const valA = stackValue(state, p, st);
    const jam = hasKw(state, p, st, '재밍');
    const checks = checksOf(state, p, st);
    const canPlayer = safe(() => S.canAttackPlayer(state, p, st.uid), true);
    const targets = safe(() => S.legalDigimonTargets(state, p, st.uid), []);
    const isBl = hasKw(state, p, st, '블로커');
    // defensive reserve: a blocker keeps its job when I'm low on security and the opponent has attackers
    let reserve = 0;
    if (level === 'hard' && isBl && mySec <= 3 && oppThreat >= 1 && !lp.lethal) reserve = P.hardReserve;
    else if (level === 'normal' && isBl && mySec <= 2 && oppThreat >= 2 && !lp.lethal) reserve = 2.5;
    if (level === 'easy') {
      if (rnd() < 0.35) continue;
      const opts = [];
      if (canPlayer && (oppBlockers.length === 0 || rnd() < 0.5)) opts.push({ target: 'PLAYER', score: 1 + rnd() });
      for (const u of targets) { const t = findAny(state, op, u); if (t && aDP > dpOf(state, op, t)) opts.push({ target: u, score: 1.2 + rnd() }); }
      if (opts.length && (aDP >= 4000 || oppBlockers.length === 0)) { opts.sort((a, b) => b.score - a.score); out.push({ type: 'attack', uid: st.uid, target: opts[0].target, score: opts[0].score, key: 'atk:' + st.uid }); }
      continue;
    }
    const cands = [];
    if (canPlayer) {
      if (opl.security.length === 0) cands.push({ target: 'PLAYER', score: 900 });
      else if (lp.lethal && lp.uids.includes(st.uid)) cands.push({ target: 'PLAYER', score: 400 + aDP / 1000 });
      else {
        const gain = Math.min(checks, opl.security.length) * (level === 'hard' && opl.security.length <= 2 ? P.hardGain2 : P.gainBase);
        const pBlock = oppBlockers.length ? (bestBlockerDP >= aDP ? P.pBlockHi : P.pBlockLo) : 0;
        const noBlock = gain - pLoseVsSecurity(aDP, jam, P) * valA * 1.3;
        const blk = oppBlockers.length ? battleOutcome(aDP, bestBlockerDP, valA, stackValue(state, op, bestBlocker)) + (hasKw(state, p, st, '관통') && aDP > bestBlockerDP ? gain : 0) : 0;
        cands.push({ target: 'PLAYER', score: (1 - pBlock) * noBlock + pBlock * blk - reserve + (P.baitBonus && oppBlockers.length ? P.baitBonus * (1 - Math.min(1, aDP / 12000)) : 0) });
      }
    }
    for (const u of targets) {
      const t = findAny(state, op, u);
      if (!t) continue;
      const tDP = dpOf(state, op, t);
      const valT = stackValue(state, op, t);
      const pBlock = oppBlockers.length ? (bestBlockerDP >= aDP ? P.tBlockHi : P.tBlockLo) : 0;
      const direct = battleOutcome(aDP, tDP, valA, valT);
      const blk = oppBlockers.length ? battleOutcome(aDP, bestBlockerDP, valA, stackValue(state, op, bestBlocker)) : 0;
      if (aDP > tDP || (aDP === tDP && valT > valA + 0.5)) cands.push({ target: u, score: (1 - pBlock) * direct + pBlock * blk - reserve + 0.4 });
    }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length) out.push({ type: 'attack', uid: st.uid, target: cands[0].target, score: cands[0].score, dp: aDP, lethal: lp.lethal && lp.uids.includes(st.uid), key: 'atk:' + st.uid });
  }
  return out;
}

// ---------- the next main-phase action ----------
// -> { type:'pass' } | an action from enumerateActions / attackCandidates.  cfg = { level, banned:Set, giftLimit? }
function planMain_(state, p, cfg) {
  const level = cfg.level, P = tp(cfg);
  const banned = cfg.banned || new Set();
  const mem = memOf(state, p);
  const noise = level === 'hard' ? 0.15 : level === 'normal' ? 0.45 : 6;
  const acts = enumerateActions(state, p, cfg).filter((a) => !banned.has(a.key));
  const atk = attackCandidates(state, p, cfg).filter((a) => !banned.has(a.key));
  const zero = acts.filter((a) => a.cost <= mem);
  const over = acts.filter((a) => a.cost > mem);
  const nz = (a) => a.score + rnd() * noise;
  const best = (arr) => arr.slice().sort((a, b) => nz(b) - nz(a))[0];

  if (level === 'easy') {
    if (rnd() < 0.08) return { type: 'pass' };
    const pool = [...zero.filter((a) => a.score > -2), ...atk];
    if (pool.length) return pool[Math.floor(rnd() * pool.length)];
    const ov = over.filter((a) => a.cost - mem <= 4);
    if (ov.length && rnd() < 0.5) return pickRand(ov);
    return { type: 'pass' };
  }
  const threshold = level === 'hard' ? P.hardThreshold : 0.9;
  const lp = lethalPlan(state, p);
  // lethal first: all lethal attackers go (weakest first as bait when the defender still has blockers)
  if (level === 'hard' && lp.lethal) {
    const l = atk.filter((a) => a.lethal).sort((a, b) => (lp.blockers ? a.dp - b.dp : b.dp - a.dp));
    if (l.length) return l[0];
  }
  // A: free actions (no memory given away)
  let A = zero.filter((a) => a.score > threshold);
  // hard/normal keep memory-neutral options playable; options that only pump wait until they can matter
  if (A.length) {
    const a = best(A);
    // a pump option is better AFTER the evolutions but it needs attackers ready: handled by optionValue
    return a;
  }
  // B: attacks
  const thrA = level === 'hard' ? P.hardThrA : P.normThrA;
  const goodAtk = atk.filter((a) => a.score > thrA);
  if (goodAtk.length) {
    goodAtk.sort((a, b) => b.score - a.score);
    return goodAtk[0];
  }
  // C: actions that push memory to the opponent (a pass hands over 3 anyway, so up to 3 is free)
  const gw = level === 'hard' ? P.hardGw : 0.85;
  const dangerous = level === 'hard' && state.players[p].security.length <= 2 && state.players[opp(p)].battle.filter(isDigi).length >= 2;
  const limit = dangerous ? P.dangerLim : (cfg.giftLimit != null ? cfg.giftLimit : (level === 'hard' ? P.hardLimit : 4));
  const gcap = (a, gift) => { if (!(level === 'hard' && P.optTam)) return true; return a.type === 'option' ? gift <= P.optGiftMax : a.type === 'play' && card(a.cardId).category === 'tamer' ? gift <= P.tamGiftMax : true; }; // tamers / options that hand memory over (gift) — capped separately
  const C = over.map((a) => ({ a, gift: Math.min(10, a.cost - mem) })).filter((x) => x.gift <= limit && gcap(x.a, x.gift) && S.canPayCost(state, x.a.cost))
    .map((x) => ({ ...x.a, eff: x.a.score - Math.max(0, x.gift - 3) * gw })).filter((x) => x.eff > (level === 'hard' ? P.cThr : 1.2));
  if (C.length) return C.sort((a, b) => b.eff + rnd() * noise - (a.eff + rnd() * noise))[0];
  return { type: 'pass' };
}

function chooseAttackTarget_(state, pa, cfg) {
  const p = pa.attacker;
  const st = findAny(state, p, pa.uid);
  if (!st) return pa.canHitPlayer ? 'PLAYER' : (pa.digimonTargets[0] || null);
  const cands = attackCandidates(state, p, { ...cfg, level: cfg.level === 'easy' ? 'normal' : cfg.level }).filter((a) => a.uid === pa.uid);
  if (cands.length && (cands[0].target === 'PLAYER' ? pa.canHitPlayer : pa.digimonTargets.includes(cands[0].target))) return cands[0].target;
  if (pa.canHitPlayer) return 'PLAYER';
  return pa.digimonTargets[0] || null;
}

// ---------- defence ----------
// c = { attackerP, attackerUid, targetKind:'player'|'digimon', targetUid, blockers:[stack], mandatory }
function decideBlock_(state, c, cfg) {
  const level = cfg.level, P = tp(cfg);
  const p = opp(c.attackerP);
  const pl = state.players[p];
  const aSt = findAny(state, c.attackerP, c.attackerUid);
  if (!aSt || !c.blockers || !c.blockers.length) return null;
  const aDP = dpOf(state, c.attackerP, aSt);
  const valA = stackValue(state, c.attackerP, aSt);
  const checks = checksOf(state, c.attackerP, aSt);
  const secN = pl.security.length;
  const pierce = hasKw(state, c.attackerP, aSt, '관통');
  const info = c.blockers.map((b) => ({ b, dp: dpOf(state, p, b), val: stackValue(state, p, b) })).sort((x, y) => y.dp - x.dp);
  const winners = info.filter((x) => x.dp > aDP);
  const ties = info.filter((x) => x.dp === aDP);
  const cheapest = info.slice().sort((x, y) => x.val - y.val)[0];
  let target = null;
  if (c.targetKind === 'digimon') target = findAny(state, p, c.targetUid);
  const tVal = target ? stackValue(state, p, target) : 0;
  if (level === 'easy') {
    const lethal = c.targetKind === 'player' && checks > secN;
    if (c.mandatory) return info[0].b.uid;
    if (lethal ? rnd() < 0.7 : rnd() < 0.3) return pickRand(info).b.uid;
    return null;
  }
  if (c.mandatory) return (winners[0] || ties[0] || info[0]).b.uid;
  if (c.targetKind === 'player') {
    const lethal = checks > secN;
    if (lethal) return (winners[0] || ties[0] || cheapest).b.uid; // must stop it
    if (winners.length) return winners.sort((x, y) => x.val - y.val)[0].b.uid; // free kill (cheapest winner)
    if (ties.length && (valA >= ties[0].val || secN <= (level === 'hard' ? P.tieBlockSec : 3))) return ties[0].b.uid;
    const chumpAt = level === 'hard' ? P.hardChump : 2;
    if (!pierce && secN <= chumpAt && cheapest.val < (level === 'hard' ? P.chumpVal : 4) && (level === 'hard' ? checks >= 1 : true)) return cheapest.b.uid;
    return null;
  }
  // attack on one of my Digimon
  if (winners.length) return winners.sort((x, y) => x.val - y.val)[0].b.uid;
  if (ties.length && valA > ties[0].val) return ties[0].b.uid;
  if (target && aDP > dpOf(state, p, target) && tVal > 5 && cheapest.val < tVal * 0.5 && level === 'hard') return cheapest.b.uid;
  return null;
}

// options = S.findCounterOptions(...); returns the option to fire or null
function decideCounter_(state, c, options, cfg) {
  if (!options || !options.length) return null;
  const level = cfg.level;
  const p = opp(c.attackerP);
  const pl = state.players[p];
  const aSt = findAny(state, c.attackerP, c.attackerUid);
  if (!aSt) return null;
  const aDP = dpOf(state, c.attackerP, aSt);
  const secN = pl.security.length;
  const checks = checksOf(state, c.attackerP, aSt);
  const lethal = c.targetKind === 'player' && checks > secN;
  const tSt = c.targetKind === 'digimon' ? findAny(state, p, c.targetUid) : null;
  const tDP = tSt ? dpOf(state, p, tSt) : 0;
  const danger = lethal ? 3 : c.targetKind === 'player' ? (secN <= 2 ? 2 : secN <= 3 && level === 'hard' ? 1 : 0) : (tSt && aDP > tDP ? 1 : 0) + (tSt && stackValue(state, p, tSt) > 5 ? 0.5 : 0);
  const usable = options.filter((o) => {
    if (o.zone === 'hand' && card(o.cardId).category === 'option') return canUseOptionNow(state, p, o.cardId) && S.canPayCost({ ...state, activePlayer: state.activePlayer }, safe(() => Math.max(0, S.optionBaseCost(state, p, o.cardId)), card(o.cardId).cost || 0));
    return true;
  });
  if (!usable.length) return null;
  // 《블래스트 진화》 (the only 【카운터】 in this card pool): a FREE evolution during the opponent's attack (+DP, its 【진화 시】 often deletes / rests the attacker).  hard / expert: take it whenever the attack matters
  // — the old danger thresholds (danger >= 2 with a 1.5 score) let 72 % of the windows with a blast card in hand pass (docs/cpu-option-tamer-play.md)
  if (level === 'hard' && tp(cfg).optTam) {
    const blasts = usable.filter((o) => /블래스트\s*진화/.test(o.body || '') || /블래스트\s*진화/.test(card(o.cardId).effectKo || ''));
    if (blasts.length) {
      const effVal = (o) => { const t = String(card(o.cardId).effectKo || ''); return (/소멸/.test(t) ? 3 : 0) + (/(레스트|되돌|덱\s*아래)/.test(t) ? 1.5 : 0) + (card(o.cardId).level || 0) * 0.2; };
      const worth = lethal || (c.targetKind === 'player' ? (secN <= 5 || checks >= 2 || aDP >= 6000) : !!tSt && (aDP >= tDP || stackValue(state, p, tSt) > 5));
      if (worth) return blasts.slice().sort((a, b) => effVal(b) - effVal(a))[0];
    }
  }
  const classify = (o) => {
    const t = o.body || '';
    if (/(어택을?\s*종료|어택.*무효)/.test(t)) return 4;
    if (/소멸/.test(t) && (level === 'normal' || level === 'hard' ? /상대(?:의)?\s*(?:디지몬|테이머)/ : /상대의/).test(t)) return 3.5; // ("상대 디지몬" without 의 was missed)
    if (/DP.*[+＋]\s*\d|[+＋]\s*\d+\s*DP/.test(t) && !/상대/.test(t)) return tSt || c.targetKind === 'digimon' ? 3 : 1;
    if (/시큐리티.*(놓|추가|회복)/.test(t)) return 2.5;
    if (/(레스트|되돌)/.test(t)) return 2.5;
    return 1.5;
  };
  const scored = usable.map((o) => ({ o, v: classify(o) })).sort((a, b) => b.v - a.v);
  const top = scored[0];
  if (level === 'easy') return danger >= 2 && rnd() < 0.5 ? top.o : (rnd() < 0.1 ? top.o : null);
  if (danger >= 3) return top.o;
  if (danger >= 2 && top.v >= 1.5) return top.o;
  if (danger >= 1 && top.v >= (level === 'hard' ? 2.5 : 3) && aDP >= 5000) return top.o;
  if (level === 'hard' && top.v >= 3.5 && aDP >= 7000) return top.o;
  return null;
}

// 어택 대상 변경 / 돌진 …: the CPU just passes (returns null)
export function decideRedirect() { return null; }

// ---------- prompt answers (ctx.choose kinds) ----------
// Who decides a prompt?  Hints: { pendingOwner (owner of the effect that is resolving), override (a CPU-driven action in progress) }.
export function deciderFor(state, kind, payload, hints = {}) {
  const pay = payload || {};
  if (kind === 'pickStack' || kind === 'pickStackAnySide') {
    const own = hints.pendingOwner || hints.override || pay.player || 'p1';
    if (pay.player && pay.player !== own && /자신의/.test(String(pay.prompt || '')) && !/상대/.test(String(pay.prompt || ''))) return pay.player; // "소멸시킬 자신의 디지몬 선택": the OWNER of the stacks decides
    return own;
  }
  return pay.player || hints.pendingOwner || hints.override || 'p1';
}

const BAD_VERB = /(소멸|퇴화|되돌릴|덱\s*아래|핸드로|패로|레스트시킬|레스트할|파기|DP\s*[-−]|어택\s*불가|공격\s*불가|액티브가\s*되지|진화원을\s*파기|트래시)/;
const GOOD_VERB = /(부여|받을|액티브로|DP\s*[+＋]|소멸하지\s*않|보호|얻을|\+\d)/;
const SELF_HARM = /(소멸|파기|트래시|덱\s*아래|퇴화)/;

// 15-7-1: the player decides whether to pay an optional processing condition. Payload: { costKinds[], costText, effectText, cardId } (Effects.askOptionalCost / optionalGate).
function optionalCostAnswer(state, who, pay, level) {
  if (level === 'easy') return rnd() < 0.6;
  const pl = state.players[who], kinds = pay.costKinds || [], eff = String(pay.effectText || '');
  const mem = who === 'p1' ? state.memory : -state.memory;
  const nHand = pl.hand.length, nSec = pl.security.length;
  const secN = kinds.filter(k => k === 'removeSecurity').length;
  for (const k of kinds) {
    if (k === 'removeSecurity' && nSec - secN < 2) return false; // never trade the last security cards away
    if (k === 'destroyOwn' && !/(소멸|시큐리티|드로우)/.test(eff)) return false; // sacrificing an own Digimon: only for a clearly removing / card-advantage effect
    if (k === 'destroyOwn' && /(소멸하지\s*않|벗어나지\s*않)/.test(eff)) return false;
    if (k === 'returnOwn' && !/(소멸|시큐리티|드로우|등장)/.test(eff)) return false;
    if (k === 'trashHand' && nHand < 3) return false;
    if (k === 'memory' && mem < 2) return false;
  }
  return true;
}
// ≪연계≫ (16-24-3): player attack -> rest the weakest other active digimon (the DP is added and 《S 어택 +1》 is gained); digimon attack -> only when a rested digimon's DP turns a loss into a win.
function cpuChainPick(state, who, uids, level) {
  const pa = state.attackCtx; if (!pa || pa.attacker !== who) return null;
  const pl = state.players[who], atk = pl.battle.find(x => x.uid === pa.uid); if (!atk) return null;
  const dpOf = (u) => S.effectiveDP(state, who, pl.battle.find(x => x.uid === u));
  const sorted = uids.slice().sort((x, y) => dpOf(x) - dpOf(y));
  if (pa.targetKind === 'player') return sorted[0];
  const t = state.players[pa.opp].battle.find(x => x.uid === pa.targetUid); if (!t) return null;
  const need = S.effectiveDP(state, pa.opp, t) - S.effectiveDP(state, who, atk);
  if (need < 0) return null;
  return sorted.find(u => dpOf(u) > need) || null;
}
// ≪돌진≫ (16-23): the CPU redirects only when its attacker beats the highest-DP active digimon outright (a redirect away from the player is otherwise a wasted attack)
function cpuChargePick(state, who, uids, level) {
  const pa = state.attackCtx; if (!pa || pa.attacker !== who) return null;
  const atk = state.players[who].battle.find(x => x.uid === pa.uid); if (!atk) return null;
  const opp = state.players[pa.opp].battle;
  const best = uids.map(u => opp.find(x => x.uid === u)).filter(Boolean).sort((a, b) => S.effectiveDP(state, pa.opp, a) - S.effectiveDP(state, pa.opp, b))[0];
  return best && S.effectiveDP(state, who, atk) > S.effectiveDP(state, pa.opp, best) + 1000 && level !== 'easy' ? best.uid : null;
}
export function answerChoice(state, kind, payload, who, cfg) {
  const level = (cfg && cfg.level) || 'normal';
  const pay = payload || {};
  const prompt = String(pay.prompt || '');
  const pl = state.players[who];
  try {
    switch (kind) {
      case 'confirmEffect': {
        if (/투항/.test(prompt)) return false;
        if (pay.optionalCost) return optionalCostAnswer(state, who, pay, level); // 15-7-1 "~하는 것으로": never auto-yes when the cost hurts
        if (/대신\s*다음\s*효과를\s*사용할\s*수\s*있습니다/.test(prompt) && /(다른\s*[^,/]*디지몬[^,/]*소멸시키|자신의\s*디지몬[^,/]*소멸시키|시큐리티[^,/]*(?:파기|트래시))/.test(prompt.split('사용할 수 있습니다')[1] || '')) return false; // replacement whose optional cost sacrifices another own Digimon / security: not worth it blindly
        if (level === 'easy') return rnd() < 0.6;
        if (/자신의\s*시큐리티/.test(prompt) && /(트래시|파기)/.test(prompt) && !/상대/.test(prompt)) return false;
        return true;
      }
      case 'multipleChoice': {
        const opts = pay.options || [];
        if (!opts.length) return null;
        if (/진화\s*방법/.test(prompt)) { // "1. label — 기본 코스트 X, 효과 반영 후 Y" … "취소"
          let bi = -1, bc = 1e9;
          opts.forEach((o, i) => { if (/취소/.test(o)) return; const m = /효과 반영 후\s*(\d+)/.exec(o); const cst = (m ? Number(m[1]) : 5) + (/버스트|어플/.test(o) ? 20 : 0); if (cst < bc) { bc = cst; bi = i; } });
          return bi >= 0 ? bi : 0;
        }
        if (/일반\s*진화와\s*조그레스/.test(prompt)) return 0;
        const ok = opts.map((o, i) => i).filter((i) => !/(취소|사용하지\s*않|안\s*함|하지\s*않는다)/.test(opts[i]));
        if (!ok.length) return 0;
        return level === 'easy' ? pickRand(ok) : ok[0];
      }
      case 'pickStack': {
        const uids = pay.uids || [];
        if (!uids.length) return null;
        if (pay.chainKw) return cpuChainPick(state, who, uids, level); // ≪연계≫ (16-24): a triggered effect now — the CPU decides here whether to pay the rest
        if (pay.chargeKw) return cpuChargePick(state, who, uids, level); // ≪돌진≫ (16-23)
        const ownerP = pay.player;
        const stacks = uids.map((u) => findAny(state, ownerP, u)).filter(Boolean);
        if (!stacks.length) return uids[0];
        const isOwn = ownerP === who;
        const bad = BAD_VERB.test(prompt), good = GOOD_VERB.test(prompt);
        const val = (s) => stackValue(state, ownerP, s);
        let pick;
        if (level === 'easy') pick = pickRand(stacks);
        else if (isOwn && bad && !good) {
          if (!pay.required && SELF_HARM.test(prompt)) return null;
          pick = stacks.slice().sort((a, b) => val(a) - val(b))[0];
        } else if (!isOwn && good && !bad) pick = stacks.slice().sort((a, b) => val(a) - val(b))[0];
        else pick = stacks.slice().sort((a, b) => val(b) - val(a))[0];
        return pick.uid;
      }
      case 'pickStackAnySide': {
        const entries = pay.entries || [];
        if (!entries.length) return null;
        const bad = BAD_VERB.test(prompt) && !GOOD_VERB.test(prompt);
        const scored = entries.map((e) => ({ e, s: findAny(state, e.player, e.uid) })).filter((x) => x.s).map((x) => ({ e: x.e, v: stackValue(state, x.e.player, x.s) * (x.e.player === who ? (bad ? -1 : 1) : (bad ? 1 : -1)) }));
        if (!scored.length) return entries[0];
        if (level === 'easy') return pickRand(entries);
        return scored.sort((a, b) => b.v - a.v)[0].e;
      }
      case 'pickFromHand': {
        if (!pl.hand.length) return null;
        const sorted = pl.hand.slice().sort((a, b) => handCardValue(a) - handCardValue(b));
        return level === 'easy' ? pickRand(pl.hand) : sorted[0];
      }
      case 'pickFromHandIndexes': {
        const el = (pay.eligibleIdxs || []).slice();
        const n = Math.min(pay.n || 1, el.length);
        if (level === 'easy') return el.sort(() => rnd() - 0.5).slice(0, n);
        el.sort((a, b) => handCardValue(pl.hand[a]) - handCardValue(pl.hand[b]));
        return el.slice(0, n);
      }
      case 'pickFromZoneIndex': {
        const el = pay.eligibleIdxs || [];
        if (!el.length) return null;
        const z = pay.zone || 'hand';
        const arr = state.players[pay.player || who][z] || [];
        const val = (i) => handCardValue(arr[i]);
        const discardish = /(파기|버릴|덱\s*아래|트래시에\s*놓|되돌)/.test(prompt) && z === 'hand';
        if (level === 'easy') return pickRand(el);
        const s = el.slice().sort((a, b) => val(a) - val(b));
        return discardish ? s[0] : s[s.length - 1];
      }
      case 'pickFromRevealed': {
        const el = pay.eligible || [];
        const max = pay.max != null ? pay.max : 1, min = pay.min || 0;
        if (!el.length) return [];
        const rev = pay.revealed || [];
        const sorted = el.slice().sort((a, b) => handCardValue(rev[b.i]) - handCardValue(rev[a.i]));
        let n = Math.min(max, sorted.length);
        if (level === 'easy') n = Math.max(min, Math.min(n, 1));
        n = Math.max(n, Math.min(min, sorted.length));
        return sorted.slice(0, n).map((x) => x.i);
      }
      case 'pickSourcesMulti': {
        const ids = pay.ids || [];
        const n = Math.min(pay.n || 1, ids.length);
        const idx = ids.map((id, i) => i).sort((a, b) => handCardValue(ids[a]) - handCardValue(ids[b]));
        return idx.slice(0, n).sort((a, b) => a - b);
      }
      case 'pickLinkCard': {
        const ids = pay.ids || [];
        let bi = 0;
        ids.forEach((id, i) => { if (handCardValue(id) < handCardValue(ids[bi])) bi = i; });
        return bi;
      }
      case 'orderCards': return (pay.ids || []).map((x, i) => i);
      case 'pickPendingOrder': return (pay.items && pay.items[0] && pay.items[0].uid) || null;
      default: return null;
    }
  } catch (e) {
    return fallbackAnswer(kind, pay);
  }
}
// last-resort answer (exceptions / watchdog): the first legal option
export function fallbackAnswer(kind, pay) {
  pay = pay || {};
  switch (kind) {
    case 'confirmEffect': return false;
    case 'multipleChoice': return (pay.options || []).length ? 0 : null;
    case 'pickStack': return (pay.uids || [])[0] ?? null;
    case 'pickStackAnySide': return (pay.entries || [])[0] ?? null;
    case 'pickFromHand': return null;
    case 'pickFromHandIndexes': return (pay.eligibleIdxs || []).slice(0, pay.n || 1);
    case 'pickFromZoneIndex': return (pay.eligibleIdxs || [])[0] ?? null;
    case 'pickFromRevealed': return (pay.eligible || []).slice(0, Math.max(pay.min || 0, 0)).map((x) => x.i);
    case 'pickSourcesMulti': return (pay.ids || []).slice(0, pay.n || 1).map((x, i) => i);
    case 'pickLinkCard': return 0;
    case 'orderCards': return (pay.ids || []).map((x, i) => i);
    case 'pickPendingOrder': return (pay.items && pay.items[0] && pay.items[0].uid) || null;
    default: return null;
  }
}

export const enumerateActions = memoized(enumerateActions_), attackCandidates = memoized(attackCandidates_), planMain = memoized(planMain_), chooseAttackTarget = memoized(chooseAttackTarget_), decideBlock = memoized(decideBlock_), decideCounter = memoized(decideCounter_);

// ---------- UI driver ----------
const SPEED_MULT = { fast: 0.55, normal: 1, slow: 1.8 };
const BASE_PACE = 1200;
export function createUiDriver(api) {
  const D = {
    enabled: false, cpu: 'p2', level: 'normal', paused: false, speed: 'normal',
    busyTick: false, acting: false, lastStep: 0, lastProgress: Date.now(), lastSig: '', banned: new Set(), turnKey: '', actionsThisTurn: 0,
    hb: null, searchOn: true, searchBudget: 900, searchCap: 2500, searching: false, thinkInfo: null, lastSearch: null, showLine: false, watchdogFires: 0, stats: { actions: 0, choices: 0, fallbacks: 0, banned: 0 },
  };
  const cfg = () => ({ ...levelCfg(D.level), banned: D.banned });
  const paceMs = () => Math.round(BASE_PACE * (SPEED_MULT[D.speed] || 1) * (0.85 + rnd() * 0.3));
  const note = (m) => { try { S.log(api.getState(), '🤖 CPU: ' + m); } catch (e) { /* ignore */ } };

  function cpuOwnsChoice(st) {
    const uc = st.uiChoice;
    if (!uc) return false;
    const by = uc.by || deciderFor(st, uc.kind, uc.payload, { pendingOwner: api.pendingOwner(), override: D.acting ? D.cpu : null });
    return by === D.cpu;
  }
  function paDecider(st, pa) {
    switch (pa.stage) {
      case 'targetChoice': return pa.attacker;
      case 'redirectTiming': return pa.paused || pa.declWait ? null : ((pa.redirectOptions && pa.redirectOptions.length) ? pa.opp : pa.attacker);
      case 'counterTiming': return pa.paused ? null : pa.opp;
      case 'blockCheck': return pa.paused ? null : pa.opp;
      case 'digimonResult': return pa.paused ? null : pa.attacker;
      case 'result': return pa.secDone ? pa.attacker : null;
      default: return null;
    }
  }
  D.paDecider = (pa) => paDecider(api.getState(), pa);

  // what is the game waiting for right now?  'cpu' | 'human' | 'fx' | 'none'
  function waitingOn(st) {
    if (!st || st.winner) return 'none';
    if (st.uiChoice) return cpuOwnsChoice(st) ? 'cpu' : 'human';
    if (st.pending.some((t) => !t.resolved)) {
      const stuck = st.pending.filter((t) => !t.resolved && (t.manualOnly || !api.hasScript(t)));
      if (stuck.length && stuck.length === st.pending.filter((t) => !t.resolved).length) return stuck.some((t) => t.player === D.cpu) ? 'cpu' : 'human';
      return 'fx';
    }
    const pa = api.pendingAttack();
    if (pa) { const d = paDecider(st, pa); return d === D.cpu ? 'cpu' : d ? 'human' : 'fx'; }
    if (api.busy()) return 'fx';
    if (st.activePlayer === D.cpu && (st.phase === 'main' || st.phase === 'breeding')) return 'cpu';
    return 'none';
  }
  D.isThinking = () => D.enabled && !D.paused && waitingOn(api.getState()) === 'cpu';
  D.waitingOn = () => waitingOn(api.getState());

  function sigOf(st) {
    const pa = api.pendingAttack();
    return [st.turnNumber, st.phase, st.memory, st.log.length, st.pending.filter((t) => !t.resolved).length, st.uiChoice ? st.uiChoice.kind : '', pa ? pa.stage + (pa.paused ? 'p' : '') : '', st.players.p1.hand.length, st.players.p2.hand.length, st.turnEnding ? 1 : 0].join('|');
  }

  async function answerChoiceStep(st) {
    const uc = st.uiChoice;
    if (!uc || uc.hold) return false;
    let val;
    try { val = answerChoice(st, uc.kind, uc.payload, D.cpu, cfg()); } catch (e) { val = fallbackAnswer(uc.kind, uc.payload); D.stats.fallbacks++; }
    D.stats.choices++;
    api.answer(uc, val);
    return true;
  }

  async function stepAttack(st, pa) {
    const d = paDecider(st, pa);
    if (d !== D.cpu) return false;
    pa._cpuTries = (pa._cpuTries || 0) + 1;
    const force = pa._cpuTries > 3; // repeated failure at one stage: fall back to the simplest legal move
    if (pa.stage === 'targetChoice') {
      const tgt = force ? (pa.canHitPlayer ? 'PLAYER' : pa.digimonTargets[0]) : chooseAttackTarget(st, pa, cfg());
      if (tgt == null) { api.pa.close(pa); return true; }
      api.pa.chooseTarget(pa, tgt);
    } else if (pa.stage === 'redirectTiming') {
      api.pa.passRedirect(pa);
    } else if (pa.stage === 'counterTiming') {
      let opt = null;
      if (!force && !pa._counterTried) opt = decideCounter(st, { attackerP: pa.attacker, attackerUid: pa.uid, targetKind: pa.targetKind, targetUid: pa.targetUid }, pa.counters, cfg());
      pa._counterTried = true;
      if (opt) { note(`${card(opt.cardId).nameKo} 카운터 사용`); api.pa.useCounter(pa, opt); } else api.pa.passCounter(pa);
    } else if (pa.stage === 'blockCheck') {
      let uid = null;
      if (!pa._blockTried || pa.mandatoryBlock) uid = decideBlock(st, { attackerP: pa.attacker, attackerUid: pa.uid, targetKind: pa.targetKind, targetUid: pa.targetUid, blockers: pa.blockers, mandatory: pa.mandatoryBlock }, cfg());
      if (pa.mandatoryBlock && !uid && pa.blockers.length) uid = pa.blockers[0].uid;
      pa._blockTried = true;
      if (uid) { const b = pa.blockers.find((x) => x.uid === uid); note(`${b ? card(b.cardId).nameKo : '블로커'}(으)로 블록`); api.pa.block(pa, uid); } else api.pa.passBlock(pa);
    } else if (pa.stage === 'digimonResult') {
      const res = pa.battleRes;
      if (res && res.piercing && !st.pending.some((t) => !t.resolved) && !st.uiChoice) api.pa.pierce(pa);
      else if (res && res.piercing) return false;
      else api.pa.close(pa);
    } else if (pa.stage === 'result') {
      api.pa.close(pa);
    } else return false;
    return true;
  }

  async function execute(st, act) {
    const p = D.cpu, pl = st.players[p];
    const before = sigOf(st) + '|' + pl.battle.length + '|' + (pl.raising ? pl.raising.cardId : '') + '|' + pl.security.length;
    D.acting = true; api.setActing(true);
    D.actionsThisTurn++;
    D.stats.actions++;
    try {
      switch (act.type) {
        case 'skipBreeding': api.skipBreeding(); break;
        case 'hatch': note('디지타마 부화'); api.hatch(p); break;
        case 'move': note('육성 에어리어 → 배틀 에어리어 이동'); api.move(p); break;
        case 'pass': note('패스'); api.pass(); break;
        case 'play': { const idx = pl.hand.indexOf(act.cardId); if (idx < 0) { D.banned.add(act.key); break; } note(`${card(act.cardId).nameKo} ${card(act.cardId).category === 'option' ? '사용' : '등장'}`); await api.play(p, idx); break; }
        case 'option': { const idx = pl.hand.indexOf(act.cardId); if (idx < 0) { D.banned.add(act.key); break; } note(`옵션 ${card(act.cardId).nameKo} 사용`); await api.play(p, idx); break; }
        case 'evolve': { const idx = pl.hand.indexOf(act.cardId); if (idx < 0) { D.banned.add(act.key); break; } const stk = findAny(st, p, act.uid); note(`${stk ? card(stk.cardId).nameKo : '?'} → ${card(act.cardId).nameKo} 진화`); await api.evolve(p, act.uid, idx); break; }
        case 'jogress': note(`${card(act.cardId).nameKo} 조그레스 진화`); await api.jogress(p, act.a, act.b, act.cardId); break;
        case 'attack': { const stk = findAny(st, p, act.uid); note(`${stk ? card(stk.cardId).nameKo : '?'} 어택`); api.attack(p, act.uid, act.target); break; }
        case 'train': note('【트레이닝】 사용'); api.train(p, act.uid); break;
        case 'delay': note('《딜레이》 발동'); api.useDelay(p, act.uid); break;
        case 'main': { const mk = act.key; const cnt = (D.mainUses ||= {}); cnt[D.turnKey + '|' + mk] = (cnt[D.turnKey + '|' + mk] || 0) + 1; if (cnt[D.turnKey + '|' + mk] >= 2) D.banned.add(mk); /* a 【메인】 whose script does nothing (e.g. ST17-10 with no 테리어몬 / 세인트가르고몬) changes no state but the pending row, so the before/after ban never fired: 22 no-op uses per turn — cap at 2 per turn */ note('【메인】 효과 사용'); api.useMain(p, act.uid, act.idx); break; }
        default: break;
      }
    } catch (e) {
      D.stats.fallbacks++;
      try { console.warn('[CPU] action failed', act.type, e); note('행동 실패(' + act.type + ')'); } catch (e2) { /* ignore */ }
      D.banned.add(act.key || act.type);
    } finally { if (api.getState() === st) { D.acting = false; api.setActing(false); } }
    const st2 = api.getState();
    if (!st2 || st2 !== st) return;
    const pl2 = st2.players[p];
    const after = sigOf(st2) + '|' + pl2.battle.length + '|' + (pl2.raising ? pl2.raising.cardId : '') + '|' + pl2.security.length;
    if (act.type !== 'pass' && act.type !== 'skipBreeding' && act.key && before === after) { D.banned.add(act.key); D.stats.banned++; } // nothing happened: never retry this one this turn
  }

  async function stepMain(st) {
    const p = D.cpu;
    const key = st.turnNumber + ':' + st.activePlayer;
    if (D.turnKey !== key) { D.turnKey = key; D.banned = new Set(); D.mainUses = {}; D.actionsThisTurn = 0; }
    if (st.phase === 'breeding') {
      const act = planBreeding(st, p, cfg());
      if (!act.key && act.type !== 'skipBreeding') return false;
      await execute(st, act);
      return true;
    }
    if (st.phase !== 'main') return false;
    if (D.actionsThisTurn >= 45) { await execute(st, { type: 'pass' }); return true; } // hard cap: a turn never runs forever
    let act = null;
    if (isHardLike(D.level) && D.searchOn && HOOKS.search) { // 어려움: 4-ply lookahead (src/cpusearch.js); null = no opinion -> heuristic below
      D.searching = true; D.thinkInfo = { depth: 0, nodes: 0, ms: 0 }; safe(() => api.thinkUpdate && api.thinkUpdate(), null);
      try {
        act = await HOOKS.search(st, p, cfg(), {
          ...(D.level === 'expert' ? EXPERT.search : { budgetMs: D.searchBudget, hardCapMs: Math.max(D.searchBudget, D.searchCap) }),
          shouldAbort: () => !D.enabled || D.paused || api.getState() !== st,
          onProgress: (i) => { D.thinkInfo = i; safe(() => api.thinkUpdate && api.thinkUpdate(), null); },
        });
      } catch (e) { act = null; D.stats.fallbacks++; console.warn('[CPU] search error', e); } finally { D.searching = false; safe(() => api.thinkUpdate && api.thinkUpdate(), null); }
      if (!D.enabled || D.paused || api.getState() !== st) return false; // paused / game changed while thinking: decide again later
      if (act && act.search) { D.lastSearch = act.search; D.stats.searches = (D.stats.searches || 0) + 1; if (D.showLine) note(!act.search.depth ? `수 읽기 생략 (${act.search.line || '후보 1개'})` : `${act.search.depth}수 읽기 (${act.search.nodes}노드, ${Math.round(act.search.ms)}ms): ${act.search.line}`); }
    }
    if (!act) act = planMain(st, p, cfg());
    await execute(st, act);
    return true;
  }

  async function step() {
    const st = api.getState();
    if (!st || st.winner) return false;
    if (st.uiChoice) return false; // handled by answerChoiceStep (must also run while an action is awaiting its prompt)
    const pend = st.pending.filter((t) => !t.resolved);
    if (pend.length) {
      const stuck = pend.filter((t) => t.manualOnly || !api.hasScript(t));
      if (stuck.length === pend.length) {
        const mine = stuck.find((t) => t.player === D.cpu);
        if (mine) { note('수동 처리 필요한 효과를 건너뜀'); api.closePending(mine.uid); return true; }
      }
      return false;
    }
    if (st.turnEnding) return false;
    const pa = api.pendingAttack();
    if (pa) return stepAttack(st, pa);
    if (api.busy()) return false;
    if (st.activePlayer === D.cpu) return stepMain(st);
    return false;
  }

  async function watchdog(st) {
    // waiting on the CPU for too long without any visible progress: force the simplest legal move
    const now = Date.now();
    const w = waitingOn(st);
    // a triggered effect that never resolves by itself (its auto-run was swallowed/parked) would leave the game waiting on 'fx' forever:
    // after 12 s without any change re-arm the effect runner, after another 12 s close the effect by hand (logged)
    if (w === 'fx' && !st.uiChoice && api.fxBusyMs() <= 0 && st.pending.some((t) => !t.resolved)) {
      const sg = sigOf(st);
      if (D.fxSig !== sg) { D.fxSig = sg; D.fxSince = now; D.fxTries = 0; }
      else if (now - D.fxSince > 12000) {
        D.fxSince = now; D.fxTries++; D.stats.fallbacks++;
        console.warn('[CPU] parked effect', D.fxTries, sg, api.dbgPending ? api.dbgPending() : '', JSON.stringify(st.pending.filter((x) => !x.resolved).map((x) => [x.uid, x.player, x.cardId, x.tags, x.evt])));
        if (D.fxTries <= 1 && api.retryPending) { note('멈춘 효과 처리 재시도'); try { api.retryPending(); } catch (e) { /* ignore */ } }
        else { const t = st.pending.find((x) => !x.resolved); if (t) { note('멈춘 효과를 수동 종료'); try { api.closePending(t.uid); } catch (e) { /* ignore */ } } }
      }
    } else { D.fxSig = ''; D.fxSince = 0; }
    if (w !== 'cpu') { D.lastProgress = now; return; }
    if (typeof document !== 'undefined' && document.hidden) { D.lastProgress = now; return; } // background tab: timers/animations are throttled — not a stall
    if (now - D.lastProgress < 22000) return;
    D.lastProgress = now; D.watchdogFires++; D.stats.fallbacks++;
    console.warn('[CPU] watchdog fired', sigOf(st));
    note('진행 지연 — 안전 동작으로 복구');
    try {
      if (st.uiChoice) { api.answer(st.uiChoice, fallbackAnswer(st.uiChoice.kind, st.uiChoice.payload)); return; }
      const pa = api.pendingAttack();
      if (pa) { if (pa.stage === 'blockCheck' && !pa.mandatoryBlock) api.pa.passBlock(pa); else if (pa.stage === 'counterTiming') api.pa.passCounter(pa); else if (pa.stage === 'redirectTiming') api.pa.passRedirect(pa); else api.pa.close(pa); return; }
      const stuck = st.pending.filter((t) => !t.resolved);
      if (stuck.length) { api.closePending(stuck[0].uid); return; }
      if (st.activePlayer === D.cpu && st.phase === 'main') { api.pass(); return; }
      if (st.activePlayer === D.cpu && st.phase === 'breeding') { api.skipBreeding(); return; }
    } catch (e) { console.warn('[CPU] watchdog action failed', e); }
  }

  async function beat() {
    if (!D.enabled) return;
    const st = api.getState();
    if (!st || st.winner) return;
    if (D.paused) { D.lastProgress = Date.now(); return; }
    if (D.stRef !== st) { // game epoch: a different state object (rematch / new game / undo / load) — per-game driver bookkeeping starts fresh
      D.stRef = st; D.banned = new Set(); D.turnKey = ''; D.actionsThisTurn = 0; D.lastSig = ''; D.fxSig = ''; D.fxSince = 0; D.fxTries = 0; D.lastProgress = Date.now(); D.busyTick = false; D.searching = false; D.acting = false; try { api.setActing(false); } catch (e) { /* ignore */ }
    }
    const sig = sigOf(st);
    if (sig !== D.lastSig) { D.lastSig = sig; D.lastProgress = Date.now(); }
    await watchdog(st);
    // prompts that belong to the CPU are answered even while an action is still awaiting them
    if (st.uiChoice && cpuOwnsChoice(st) && !st.uiChoice.hold) {
      if (Date.now() - D.lastStep < paceMs() * 0.6) return;
      D.lastStep = Date.now();
      await answerChoiceStep(st);
      return;
    }
    if (D.busyTick) return;
    if (Date.now() - D.lastStep < paceMs()) return;
    if (api.fxBusyMs() > 0) return; // wait for the activation VFX / effect card to finish
    const myTick = D.busyTick = {}; // token: a step of a replaced game may stay parked forever on a dead prompt and must not hold (or later clear) the flag of the new game
    try { if (await step()) D.lastStep = Date.now(); } catch (e) { D.stats.fallbacks++; console.warn('[CPU] step error', e); note('오류 — 무시하고 계속'); D.lastStep = Date.now(); }
    finally { if (D.busyTick === myTick) D.busyTick = false; }
  }

  D.start = (level) => { D.enabled = true; D.level = level || D.level; D.banned = new Set(); D.turnKey = ''; D.lastProgress = Date.now(); D.paused = false; if (!D.hb) D.hb = setInterval(() => { beat().catch((e) => console.warn('[CPU] beat', e)); }, 160); };
  D.stop = () => { D.enabled = false; if (D.hb) { clearInterval(D.hb); D.hb = null; } };
  D.setLevel = (l) => { if (LEVEL_LABEL[l]) D.level = l; };
  D.setSpeed = (s) => { if (SPEED_MULT[s]) D.speed = s; };
  D.setPaused = (b) => { D.paused = !!b; };
  D.setSearch = (o) => { o = o || {}; if (o.enabled != null) D.searchOn = !!o.enabled; if (o.budgetMs) D.searchBudget = o.budgetMs; if (o.hardCapMs) D.searchCap = o.hardCapMs; if (o.showLine != null) D.showLine = !!o.showLine; };
  D.beat = beat;
  return D;
}
