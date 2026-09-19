// Shard 1 — bespoke per-card scripts and continuous-ability hooks.
//
//  SCRIPTS  { 'CARD-ID::firstTag': [ops] }   triggered / main / security effects (run through runScript).
//  OPS      custom ops (s1_*).
//  HOOKS    { 'CARD-ID': [descriptor] }      continuous ("자신/상대/서로의 턴") abilities & "~했을 때" watchers, consumed by
//           state.js (see the HOOKS registry there). Handlers named s1* are shard-1 additions dispatched by the s1Hook*
//           helpers at the end of state.js.
//
// state.js -> cards/index.js -> this file -> state.js is a cycle; it is safe because nothing here touches `S` at load time.
import * as S from '../state.js';

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');

// ------------------------------------------------------------------ small helpers
const C = (id) => S.card(id);
const isDigimon = (st) => !!st && C(st.cardId).category === 'digimon';
const isTamer = (st) => !!st && C(st.cardId).category === 'tamer';
const hasTrait = (id, t) => (C(id).types || []).includes(t);
const traitAny = (id, list) => list.some(t => hasTrait(id, t));
const hasColor = (id, col) => (C(id).colors || []).includes(col);
const stackColors = (st) => S.stackColors(st);
const digimons = (p, state) => state.players[p].battle.filter(isDigimon);
const tamersOf = (p, state) => state.players[p].battle.filter(isTamer);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const lvOf = (id) => C(id).level ?? 0;
const nameHas = (id, s) => C(id).nameKo.includes(s);
const xAnti = (id) => hasTrait(id, 'X항체');
const idxsWhere = (arr, f) => arr.map((id, i) => i).filter(i => f(arr[i]));
const anyOf = (a) => (a.length ? a : null);

// per-stack flags with turn expiry: stack.s1[flag] = last turn number (inclusive) the flag is active
export function stackFlag(state, st, flag) { return !!(st && st.s1 && st.s1[flag] != null && state.turnNumber <= st.s1[flag]); }
function setFlag(st, flag, untilTurn) { if (!st) return; (st.s1 ||= {})[flag] = untilTurn; }
function lockFlag(st, flags, until) { for (const f of flags) setFlag(st, f, until); }

// Move a whole stack out of the battle area (sources/links to trash) and return its top card id.
function detachStack(state, p, st) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(st);
  if (i === -1) return null;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map(l => l.cardId);
  pl.trash.push(...st.sources, ...linkIds);
  S.applyOverflowBatch(state, p, [...st.sources, st.cardId]);
  return st.cardId;
}

// ------------------------------------------------------------------ interaction helpers
async function pickStack(ctx, player, uids, prompt) {
  if (!uids.length) return null;
  return ctx.choose('pickStack', { player, uids, prompt });
}
async function pickZoneIdx(ctx, who, zone, eligibleIdxs, prompt) {
  if (!eligibleIdxs.length) return null;
  return ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt });
}
async function confirm(ctx, who, prompt) { return !!(await ctx.choose('confirmEffect', { player: who, prompt })); }
const srcStack = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const plOf = (ctx, who) => ctx.state.players[who];

// ------------------------------------------------------------------ evolution-cost machinery (one-shot mods added by scripts)
// mods live on state.players[p].s1EvoMods: { delta, turn, colors?, stackColors?, traitAny?, fromLevel?, toLevel?, requireRest?, returnAtEnd?, consumed }
function modMatches(m, stack, targetId) {
  const t = C(targetId);
  if (m.colors && !(t.colors || []).some(c => m.colors.includes(c))) return false;
  if (m.stackColors && !stackColors(stack).some(c => m.stackColors.includes(c))) return false;
  if (m.traitAny && !(t.types || []).some(x => m.traitAny.includes(x))) return false;
  if (m.toLevel != null && t.level !== m.toLevel) return false;
  if (m.fromLevel != null && C(stack.cardId).level !== m.fromLevel) return false;
  return true;
}
const liveMods = (state, p) => (state.players[p].s1EvoMods || []).filter(m => !m.consumed && m.turn >= state.turnNumber);
function bounceAtEnd(state, p, uid) {
  S.scheduleEndOfTurn(state, () => {
    const st = findStack(state, p, uid);
    if (!st) return;
    detachStack(state, p, st);
    state.players[p].deck.push(st.cardId);
    S.log(state, `${p} ${C(st.cardId).nameKo} 턴 종료 시 덱 아래로 되돌림 (진화원 파기)`);
  }, { player: p, label: '이 턴 종료 시 덱 아래로 되돌림' });
}
// Automatic (non-optional) extra discount: hook descriptors (s1evoDiscount) + unconditional script mods.
export function evoAutoDelta(state, p, stack, targetId, from = 'hand') {
  state._s1EvoFrom = from;
  let total = 0;
  try { total += S.s1HookSum(state, 's1evoDiscount', { p, stack, targetId, from }); } finally { state._s1EvoFrom = null; }
  for (const m of liveMods(state, p)) {
    if (m.requireRest || !modMatches(m, stack, targetId)) continue;
    m.consumed = true; total += m.delta;
    if (m.returnAtEnd) bounceAtEnd(state, p, stack.uid);
  }
  return total;
}
// Player-confirmed discounts: [{label, apply()->delta}]
export function evoOptionList(state, p, stack, targetId, from = 'hand') {
  state._s1EvoFrom = from;
  let out = [];
  try { out = S.s1HookCollect(state, 's1evoOption', { p, stack, targetId, from }); } finally { state._s1EvoFrom = null; }
  for (const m of liveMods(state, p)) {
    if (!m.requireRest || !modMatches(m, stack, targetId)) continue;
    const others = () => state.players[p].battle.filter(s => s !== stack && !s.suspended && isDigimon(s));
    if (!others().length) continue;
    out.push({ label: `자신의 디지몬 1마리를 레스트시켜 진화 코스트 ${m.delta}?`, apply() {
      const o = others().sort((a, b) => S.effectiveDP(state, p, a) - S.effectiveDP(state, p, b))[0];
      if (!o) return 0;
      S.restStack(state, p, o.uid);
      if (!o.suspended) return 0;
      m.consumed = true;
      return m.delta;
    } });
  }
  return out;
}
export function addEvoMod(state, p, mod) { (state.players[p].s1EvoMods ||= []).push(mod); }

// cost to evolve into targetId when `stack` is treated as (level, colors); null if impossible. ignoreLevel: only colors matter.
export function evoCostAs(targetId, level, colors, ignoreLevel = false) {
  const t = C(targetId);
  const cands = [];
  if (t.evoNormal) cands.push({ level: t.evoNormal.level, colors: t.evoNormal.colors || [], cost: t.evoNormal.cost });
  for (const m of (t.effectKo || '').matchAll(/〔진화〕\s*([^:：\n]+?)\s*[:：]\s*코스트\s*(\d+)/g)) {
    const lv = m[1].match(/Lv\.(\d+)/);
    cands.push({ level: lv ? Number(lv[1]) : null, colors: null, cost: Number(m[2]) });
  }
  let best = null;
  for (const c of cands) {
    if (!ignoreLevel && typeof c.level === 'number' && c.level !== level) continue;
    if (c.colors && c.colors.length && c.colors.length < 7 && !c.colors.some(x => colors.includes(x))) continue;
    if (best == null || c.cost < best) best = c.cost;
  }
  return best;
}

// ST7-03 / ST8-04: "진화조건을 무시하고 진화 코스트 N을 지불하여" — { cost } or null (blocked by BT8-059 style locks)
export function evolveAlt(state, p, stack, targetId) {
  if (S.s1HookAny(state, 's1evoIgnoreLocked', {})) return null;
  return S.s1HookFirst(state, 's1evolveAlt', { p, stack, targetId });
}

// ------------------------------------------------------------------ registries
export const HOOKS = {};
export const SCRIPTS = {};
export const OPS = {};
// D(cardId, tag, has, handlers[, src])  — registers a descriptor. `has` must be a literal substring of the segment body.
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
// Once-per-turn cap tracked on the holder (for hooks that act directly instead of queueing a pending effect)
function once(holder, id, d, n = 1) { return S.hookUseOnce(holder, id, d, n); }
// Run an async function as a script instruction:  fn(async (ctx, api) => {...})
OPS.s1_fn = async (instr, ctx, api) => { await instr.fn(ctx, api); };
const fn = (f) => ({ op: 's1_fn', fn: f });

// ------------------------------------------------------------------ script helpers (target selection honours effect immunity)
const immune = (ctx, p, st, kind = 'other') => S.effectBlocked(ctx.state, p, st, kind);
function targets(ctx, p, pred, kind = 'other') {
  return ctx.state.players[p].battle.filter(s => (!pred || pred(s)) && !immune(ctx, p, s, kind));
}
async function pickWhere(ctx, p, pred, prompt, kind = 'other') {
  const list = targets(ctx, p, pred, kind);
  if (!list.length) return null;
  const uid = await ctx.choose('pickStack', { player: p, uids: list.map(s => s.uid), prompt });
  return list.find(s => s.uid === uid) || null;
}
const causeOf = (ctx, p) => (p === ctx.self ? 'ownEffect' : 'effect');
function destroy(ctx, p, st) {
  if (!st) return;
  S.deleteStack(ctx.state, p, st.uid, 'trash', causeOf(ctx, p));
}
// hand / deck bounce (sources + links trashed). Honors survive-abilities & effect-immunity.
function bounce(ctx, p, st, dest = 'hand') {
  const { state } = ctx;
  if (!st || !state.players[p].battle.includes(st)) return false;
  if (immune(ctx, p, st, 'bounce') || S.leaveGate(state, p, st, causeOf(ctx, p), 'bounce', () => bounce(ctx, p, st, dest))) return false;
  const id = detachStack(state, p, st);
  if (dest === 'deckBottom') state.players[p].deck.push(id);
  else if (dest === 'deckTop') state.players[p].deck.unshift(id);
  else state.players[p].hand.push(id);
  S.log(state, `${p} ${C(id).nameKo} ${dest === 'hand' ? '패로' : '덱으로'} 되돌림 (진화원 파기)`);
  return true;
}
function toSecurity(ctx, p, st, position) {
  const { state } = ctx;
  if (!st || !state.players[p].battle.includes(st)) return false;
  if (immune(ctx, p, st, 'other')) return false;
  const id = detachStack(state, p, st);
  S.addToSecurity(state, p, id, position);
  return true;
}
function placeUnderBottom(ctx, p, st, id) {
  st.sources.unshift(id);
  S.recomputeStackGrants(st);
  S.log(ctx.state, `${p} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 가장 아래에 놓음`);
}
// take one card out of hand/trash (choose which) matching pred; returns id or null
async function takeFrom(ctx, who, zones, pred, prompt) {
  const pl = ctx.state.players[who];
  let zone = null, elig = [];
  const opts = [];
  for (const z of zones) { const e = idxsWhere(pl[z], pred); if (e.length) opts.push({ z, e }); }
  if (!opts.length) return null;
  if (opts.length === 1) { zone = opts[0].z; elig = opts[0].e; }
  else {
    const k = await ctx.choose('multipleChoice', { prompt: `${prompt} — 어디에서 가져올까요?`, options: opts.map(o => (o.z === 'hand' ? '패' : '트래시')) });
    if (k == null || !opts[k]) return null;
    zone = opts[k].z; elig = opts[k].e;
  }
  const i = await pickZoneIdx(ctx, who, zone, elig, prompt);
  if (i == null) return null;
  return pl[zone].splice(i, 1)[0];
}
const canTake = (ctx, who, zones, pred) => zones.some(z => idxsWhere(ctx.state.players[who][z], pred).length > 0);
// choose n cards from a zone (cost helpers "…하는 것으로"); all-or-nothing, cards are REMOVED from the zone
async function pickNFrom(ctx, who, zone, n, pred, prompt) {
  const pl = ctx.state.players[who];
  const taken = [];
  for (let k = 0; k < n; k++) {
    const i = await pickZoneIdx(ctx, who, zone, idxsWhere(pl[zone], pred), `${prompt} (${k + 1}/${n})`);
    if (i == null) { pl[zone].push(...taken); return null; }
    taken.push(pl[zone].splice(i, 1)[0]);
  }
  return taken;
}
// look at top n, take one card per predicate into hand, rest to the deck bottom in chosen order
async function revealPickEach(ctx, who, n, preds, prompt) {
  const { state } = ctx; const pl = state.players[who];
  const rev = pl.deck.splice(0, n);
  S.log(state, `${who} 덱 위 ${rev.length}장 오픈: ${rev.map(id => C(id).nameKo).join(', ')}`);
  const taken = [];
  for (const pred of preds) {
    const elig = rev.map((id, i) => ({ id, i })).filter(x => !taken.includes(x.i) && pred(x.id));
    if (!elig.length) continue;
    const sel = await ctx.choose('pickFromRevealed', { player: who, revealed: rev, eligible: elig, min: 0, max: 1, prompt });
    const i = sel && sel[0];
    if (i != null && elig.some(x => x.i === i)) { taken.push(i); pl.hand.push(rev[i]); }
  }
  const rest = rev.filter((id, i) => !taken.includes(i));
  while (rest.length > 1) {
    const sel = await ctx.choose('pickFromRevealed', { player: who, revealed: rest, eligible: rest.map((id, i) => ({ id, i })), min: 1, max: 1, prompt: '덱 아래로 되돌릴 카드를 순서대로 선택 (먼저 고른 카드가 위)' });
    const i = sel && sel[0] != null ? sel[0] : 0;
    pl.deck.push(rest.splice(i, 1)[0]);
  }
  pl.deck.push(...rest);
}
// "…를 코스트를 지불하지 않고 사용한다" for an Option card from hand
async function useOptionFree(ctx, who, pred, prompt) {
  const { state } = ctx; const pl = state.players[who];
  if (S.s1HookAny(state, 's1cannotUseOption', { p: who })) { S.log(state, `${who} 옵션 카드를 사용할 수 없음`); return false; }
  const elig = idxsWhere(pl.hand, id => C(id).category === 'option' && pred(id) && S.optionColorOk(state, who, id));
  const i = await pickZoneIdx(ctx, who, 'hand', elig, prompt);
  if (i == null) return false;
  const [id] = pl.hand.splice(i, 1);
  pl.trash.push(id);
  S.log(state, `${who} ${C(id).nameKo} 코스트 없이 사용`);
  S.queueTriggersFor(state, who, id, 'use');
  return true;
}
// evolve one of who's digimon via an effect; returns the stack or null (callers need to know whether it happened)
async function evolveInteractive(ctx, o) {
  const { state, E } = ctx; const who = o.who || ctx.self; const pl = state.players[who];
  const arr = o.from === 'trash' ? pl.trash : pl.hand;
  const ignore = o.ignoreCond && !S.s1HookAny(state, 's1evoIgnoreLocked', {});
  const chk = (stack, id) => E.canEvolveAny(stack.cardId, id, stack.extraColors || [], S.evolveTargetRestriction(state, who, stack));
  const okCard = (stack, id) => C(id).category === 'digimon' && (!o.cardPred || o.cardPred(id)) && (ignore ? E.evoRestrictionCheck(id, S.evolveTargetRestriction(state, who, stack)).ok : chk(stack, id).ok);
  let stacks = o.subject ? [o.subject] : pl.battle.filter(s => isDigimon(s) && (!o.stackPred || o.stackPred(s)));
  stacks = stacks.filter(s => s && arr.some(id => okCard(s, id)));
  if (!stacks.length) return null;
  let stack = stacks[0];
  if (stacks.length > 1) { const uid = await pickStack(ctx, who, stacks.map(s => s.uid), '진화시킬 디지몬 선택'); stack = stacks.find(s => s.uid === uid); if (!stack) return null; }
  const i = await pickZoneIdx(ctx, who, o.from === 'trash' ? 'trash' : 'hand', idxsWhere(arr, id => okCard(stack, id)), `${o.from === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택`);
  if (i == null) return null;
  const id = arr[i];
  const c0 = chk(stack, id);
  const printed = c0.ok ? c0.cost : (C(id).evoNormal?.cost ?? 0);
  let cost = o.costMode === 'free' ? 0 : o.costMode === 'fixed' ? o.cost : printed;
  if (o.costMode !== 'free') cost = Math.max(0, cost + evoAutoDelta(state, who, stack, id, o.from === 'trash' ? 'trash' : 'hand') + S.hookEvoCostDiscount(state, who, stack, id) + (o.extraDelta || 0));
  if (o.from === 'trash') arr.splice(i, 1);
  return S.digivolve(state, who, stack.uid, id, cost, o.from === 'trash' ? 'trash' : 'hand');
}
async function restOppCard(ctx) {
  const st = await pickWhere(ctx, ctx.opp, s => ['digimon', 'tamer'].includes(C(s.cardId).category), '레스트시킬 상대의 디지몬 또는 테이머 선택', 'rest');
  if (st) S.restStack(ctx.state, ctx.opp, st.uid);
  return st;
}
const digiburst = (n) => ({ op: 'trashEvoSources', thisStack: true, count: n, digiburst: true });
// modifyDP that lasts through the opponent's next turn (expires after turn N+1)
function dpUntilNextOppTurn(ctx, p, uid, amount) {
  const { state } = ctx;
  S.modifyDP(state, p, uid, amount, 'turn');
  const st = findStack(state, p, uid);
  if (st && st.dpExpiry !== 'permanent') st.dpExpiry = state.turnNumber + 1;
}

// ================================================================== SCRIPTS
// "이 테이머/디지몬을 레스트시키는 것으로" — optional rest cost of the source stack
async function payRestThis(ctx, prompt) {
  const st = srcStack(ctx);
  if (!st || st.suspended) return false;
  if (!(await confirm(ctx, ctx.self, prompt))) return false;
  S.restStack(ctx.state, ctx.self, st.uid);
  return !!st.suspended;
}
const evtOf = (ctx) => srcStack(ctx)?.hookEvt || null;
function recover(ctx, who = ctx.self) {
  if (S.s1SecIncreaseBlocked(ctx.state, who)) { S.log(ctx.state, `${who} 시큐리티를 늘릴 수 없음 (효과 제한)`); return; }
  S.recoverTopOfDeckToSecurity(ctx.state, who);
}
const untilNextOppTurn = (state) => state.turnNumber + 1;

// ---- ST2-14 (시큐리티): 진화원 없는 상대 디지몬 1마리 — 다음 자신의 턴 종료 시까지 어택/블록 불가
SCRIPTS['ST2-14::시큐리티'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && s.sources.length === 0, '어택과 블록을 할 수 없게 할 진화원이 없는 상대 디지몬 선택');
  if (!st) return;
  lockFlag(st, ['noAttack', 'noBlock'], untilNextOppTurn(ctx.state));
  S.log(ctx.state, `${ctx.opp} ${C(st.cardId).nameKo} 다음 턴 종료 시까지 어택·블록 불가`);
})];

// ---- ST5-04 / ST5-06 (진화원): 상대의 턴 종료 시 상대 디지몬이 한 번도 어택하지 않았다면 1드로우
const drawIfNoOppAttack = [fn(async (ctx) => {
  if (ctx.state.s1Atk && ctx.state.s1Atk[ctx.opp] === ctx.state.turnNumber) return;
  S.drawCards(ctx.state, ctx.self, 1);
})];
SCRIPTS['ST5-04::상대의 턴 종료 시'] = drawIfNoOppAttack;
SCRIPTS['ST5-06::상대의 턴 종료 시'] = drawIfNoOppAttack;

// ---- ST10-14 (시큐리티): 상대 디지몬 1마리를 상대 시큐리티 위/아래에 뒤집어서 놓을 수 있다
SCRIPTS['ST10-14::시큐리티'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, isDigimon, '상대의 시큐리티에 뒤집어서 놓을 상대 디지몬 선택 (취소 = 사용 안 함)');
  if (!st) return;
  const k = await ctx.choose('multipleChoice', { prompt: '상대의 시큐리티의 어디에 놓을까요?', options: ['위', '아래'] });
  if (k == null) return;
  toSecurity(ctx, ctx.opp, st, k === 0 ? 'top' : 'bottom');
})];

// ---- P-063 / BT2-084: 테이머를 레스트시켜 어택한 디지몬 DP 증가
const restForDP = (amount, prompt) => [fn(async (ctx) => {
  const evt = evtOf(ctx);
  if (!evt || !findStack(ctx.state, ctx.self, evt.stackUid)) return;
  if (!(await payRestThis(ctx, prompt))) return;
  S.modifyDP(ctx.state, ctx.self, evt.stackUid, amount, 'turn');
})];
SCRIPTS['P-063::자신의 턴'] = restForDP(3000, '이 테이머를 레스트시켜 어택한 디지몬을 DP+3000 하시겠습니까?');
SCRIPTS['BT2-084::자신의 턴'] = restForDP(2000, '이 테이머를 레스트시켜 어택한 디지몬을 DP+2000 하시겠습니까?');

// ---- P-048 (진화 시)
SCRIPTS['P-048::진화 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me);
  const pred = (id) => C(id).category !== 'digitama';
  if (idxsWhere(pl.trash, pred).length < 3) return;
  const taken = await pickNFrom(ctx, me, 'trash', 3, pred, '덱 아래로 되돌릴 카드 (고른 순서대로 덱 아래에)');
  if (!taken) return;
  pl.deck.push(...taken);
  S.log(ctx.state, `${me} 트래시 ${taken.length}장을 덱 아래로 되돌림`);
  const st = srcStack(ctx);
  if (st) S.unsuspendStack(ctx.state, me, st.uid);
  const tUid = await pickStack(ctx, me, tamersOf(me, ctx.state).map(s => s.uid), '액티브로 할 테이머 선택');
  if (tUid) S.unsuspendStack(ctx.state, me, tUid);
})];

// ---- P-027 (메인): 디지버스트 2 — 패의 퍼플 사용 코스트 7 이하 옵션 1장을 코스트 없이 사용
SCRIPTS['P-027::메인'] = [{ op: 'costGroup', cost: [digiburst(2)], then: [fn(async (ctx) => {
  await useOptionFree(ctx, ctx.self, id => hasColor(id, 'purple') && (C(id).cost || 0) <= 7, '코스트 없이 사용할 퍼플 옵션 카드 선택');
})] }];

// ---- P-023 (메인)
SCRIPTS['P-023::메인'] = [fn(async (ctx) => {
  const me = ctx.self;
  if (!ctx.state.players[me].battle.some(s => C(s.cardId).nameKo === '리키')) return;
  const st = await pickWhere(ctx, me, s => isDigimon(s) && C(s.cardId).nameKo === '파닥몬', '시큐리티 아래에 뒷면으로 놓을 「파닥몬」 선택');
  if (st) toSecurity(ctx, me, st, 'bottom');
})];

// ---- P-043
SCRIPTS['P-043::등장 시'] = [fn(async (ctx) => {
  const me = ctx.self;
  const taken = await pickNFrom(ctx, me, 'trash', 1, id => C(id).nameKo === '슬레이프몬', '덱 아래로 되돌릴 「슬레이프몬」 선택');
  if (!taken) return;
  plOf(ctx, me).deck.push(...taken);
  recover(ctx);
})];
SCRIPTS['P-043::소멸 시'] = [{ op: 'modifyDP', target: 'opponent', amount: -1000 }];

// ---- BT1-113 (시큐리티): 다음 상대의 액티브 페이즈에 상대 디지몬 전부 액티브가 되지 않는다
SCRIPTS['BT1-113::시큐리티'] = [fn(async (ctx) => {
  for (const s of digimons(ctx.opp, ctx.state)) S.setSkipNextUnsuspend(ctx.state, ctx.opp, s.uid);
})];

// ---- BT2-020 (어택 시): 상대의 트래시 10장마다 시큐리티 1장 파기
SCRIPTS['BT2-020::어택 시'] = [fn(async (ctx) => {
  const n = Math.floor(plOf(ctx, ctx.opp).trash.length / 10);
  for (let i = 0; i < n; i++) S.trashTopSecurityByEffect(ctx.state, ctx.opp);
})];

// ---- BT2-090 (등장 시): 트래시의 퍼플 디지몬/옵션 1장을 패로
SCRIPTS['BT2-090::등장 시'] = [fn(async (ctx) => {
  const id = await takeFrom(ctx, ctx.self, ['trash'], c => hasColor(c, 'purple') && ['digimon', 'option'].includes(C(c).category), '패로 되돌릴 퍼플 디지몬/옵션 카드 선택');
  if (id) { plOf(ctx, ctx.self).hand.push(id); S.log(ctx.state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`); }
})];

// ---- BT2-104 (시큐리티): 블로커를 가진 자신의 디지몬 전부 액티브 + DP+5000
SCRIPTS['BT2-104::시큐리티'] = [fn(async (ctx) => {
  for (const s of digimons(ctx.self, ctx.state)) {
    if (!S.hasKeyword(s, '블로커')) continue;
    S.unsuspendStack(ctx.state, ctx.self, s.uid);
    S.modifyDP(ctx.state, ctx.self, s.uid, 5000, 'turn');
  }
})];

// ---- BT2-040 (소멸 시): 이 카드를 자신의 시큐리티 위에 뒷면으로
SCRIPTS['BT2-040::소멸 시'] = [fn(async (ctx) => {
  const pl = plOf(ctx, ctx.self);
  const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (i === -1) return;
  pl.trash.splice(i, 1);
  S.addToSecurity(ctx.state, ctx.self, ctx.sourceCardId, 'top');
})];

// ---- BT3-014 (진화 시): Lv.4 이하 상대 디지몬 1마리의 본래 DP를 1000으로
SCRIPTS['BT3-014::진화 시'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && lvOf(s.cardId) <= 4, '본래 DP를 1000으로 바꿀 Lv.4 이하 상대 디지몬 선택', 'dpDown');
  if (!st) return;
  const base = C(st.cardId).dp || 0;
  if (base !== 1000) S.modifyDP(ctx.state, ctx.opp, st.uid, 1000 - base, 'turn');
})];

// ---- BT3-027 (진화원 / 어택 시): 명칭에 「황제드라몬」 — 액티브로
SCRIPTS['BT3-027::어택 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (st && nameHas(st.cardId, '황제드라몬')) S.unsuspendStack(ctx.state, ctx.self, st.uid);
})];

// ---- BT3-031 (진화 시): 재밍을 가진 자신의 디지몬 전부 액티브
SCRIPTS['BT3-031::진화 시'] = [fn(async (ctx) => {
  for (const s of digimons(ctx.self, ctx.state)) if (S.hasKeyword(s, '재밍')) S.unsuspendStack(ctx.state, ctx.self, s.uid);
})];

// ---- BT3-041 (어택 시): 시큐리티 3장 이하 — 트래시의 옐로 디지몬 1장을 시큐리티 위에
SCRIPTS['BT3-041::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self;
  if (plOf(ctx, me).security.length > 3) return;
  const id = await takeFrom(ctx, me, ['trash'], c => C(c).category === 'digimon' && hasColor(c, 'yellow'), '시큐리티 위에 놓을 옐로 디지몬 카드 선택');
  if (id) S.addToSecurity(ctx.state, me, id, 'top');
})];

// ---- BT3-099 / BT3-103 / BT5-109 (옵션 메인)
SCRIPTS['BT3-099::메인'] = [fn(async (ctx) => { ctx.state.s1NoBattleDelete = ctx.state.turnNumber; S.log(ctx.state, '이 턴 동안 디지몬은 배틀로 소멸하지 않음'); })];
SCRIPTS['BT3-103::메인'] = [fn(async (ctx) => { addEvoMod(ctx.state, ctx.self, { delta: -5, turn: ctx.state.turnNumber, stackColors: ['green'], requireRest: true }); S.log(ctx.state, `${ctx.self} 다음 그린 디지몬 진화 시 디지몬 1마리를 레스트시켜 코스트 -5`); })];
SCRIPTS['BT5-109::메인'] = [fn(async (ctx) => { addEvoMod(ctx.state, ctx.self, { delta: -6, turn: ctx.state.turnNumber, fromLevel: 6, toLevel: 7, returnAtEnd: true }); S.log(ctx.state, `${ctx.self} 다음 Lv.6→Lv.7 진화 코스트 -6 (턴 종료 시 덱 아래로)`); })];

// ---- BT3-112 (어택 시): 진화원의 Lv.6 디지몬 카드 1장을 패로 → 이 턴 블록당하지 않음
SCRIPTS['BT3-112::어택 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st) return;
  const idxs = st.sources.map((id, i) => i).filter(i => C(st.sources[i]).category === 'digimon' && lvOf(st.sources[i]) === 6);
  if (!idxs.length) return;
  if (!(await confirm(ctx, ctx.self, '진화원의 Lv.6 디지몬 카드 1장을 패로 되돌려 이 턴 블록당하지 않게 하시겠습니까?'))) return;
  let pick = idxs[0];
  if (idxs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '패로 되돌릴 진화원 선택', options: idxs.map(i => C(st.sources[i]).nameKo) }); if (k == null) return; pick = idxs[k]; }
  const [id] = st.sources.splice(pick, 1);
  plOf(ctx, ctx.self).hand.push(id);
  S.recomputeStackGrants(st);
  setFlag(st, 'unblockable', ctx.state.turnNumber);
  S.log(ctx.state, `${ctx.self} ${C(id).nameKo} 진화원에서 패로 — 이 턴 블록당하지 않음`);
})];

// ---- BT4-054 (메인 · 디지버스트 2): 레스트 상태의 상대 디지몬 1마리는 다음 액티브 페이즈에 액티브가 되지 않는다
SCRIPTS['BT4-054::메인'] = [{ op: 'costGroup', cost: [digiburst(2)], then: [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && s.suspended, '다음 액티브 페이즈에 액티브가 되지 않을 레스트 상태의 상대 디지몬 선택');
  if (st) S.setSkipNextUnsuspend(ctx.state, ctx.opp, st.uid);
})] }];

// ---- BT4-075 (어택 시): 상대가 액티브 상태의 자기 디지몬 1마리를 골라 어택 대상으로 삼을 수 있다
SCRIPTS['BT4-075::어택 시'] = [fn(async (ctx) => {
  const list = ctx.state.players[ctx.opp].battle.filter(s => isDigimon(s) && !s.suspended);
  if (!list.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: list.map(s => s.uid), prompt: '어택의 대상으로 삼을 액티브 상태의 디지몬 선택 (취소 = 선택하지 않음)' });
  if (!uid) return;
  const pa = ctx.attack ? ctx.attack() : null;
  if (pa) { pa.s1ForcedTarget = uid; if (pa.targetKind) { pa.targetKind = 'digimon'; pa.targetUid = uid; } }
  S.log(ctx.state, `${ctx.opp} 어택의 대상을 ${C(findStack(ctx.state, ctx.opp, uid).cardId).nameKo}(으)로 함`);
})];

// ---- BT4-095 (등장 시): 트래시의 디지타마 카드 1장을 디지타마 덱 아래로
SCRIPTS['BT4-095::등장 시'] = [fn(async (ctx) => {
  const id = await takeFrom(ctx, ctx.self, ['trash'], c => C(c).category === 'digitama', '디지타마 덱 아래로 되돌릴 디지타마 카드 선택');
  if (id) { plOf(ctx, ctx.self).digitamaDeck.push(id); S.log(ctx.state, `${ctx.self} ${C(id).nameKo} 디지타마 덱 아래로`); }
})];

// ---- BT4-101 (메인): 이 턴 자신의 디지몬 전부는 "진화원 없는 상대 디지몬에게 어택했을 때 소멸" 효과를 얻는다
SCRIPTS['BT4-101::메인'] = [fn(async (ctx) => {
  for (const s of digimons(ctx.self, ctx.state)) setFlag(s, 'killNoSrc', ctx.state.turnNumber);
  S.log(ctx.state, `${ctx.self} 이 턴 디지몬 전부가 어택 시 진화원 없는 상대 디지몬을 소멸시키는 효과를 얻음`);
})];

// ---- BT4-102 (메인): 자신의 디지몬 1마리를 패로 되돌리는 것으로 Lv.4 이하 상대 디지몬 2마리까지 패로
SCRIPTS['BT4-102::메인'] = [fn(async (ctx) => {
  const own = await pickWhere(ctx, ctx.self, isDigimon, '패로 되돌릴 자신의 디지몬 선택', 'bounce');
  if (!own || !bounce(ctx, ctx.self, own)) return;
  for (let i = 0; i < 2; i++) {
    const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && lvOf(s.cardId) <= 4, `패로 되돌릴 Lv.4 이하 상대 디지몬 선택 (${i + 1}/2, 취소 = 종료)`, 'bounce');
    if (!st) break;
    bounce(ctx, ctx.opp, st);
  }
})];

// ---- BT4-105 (메인): 자신의 디지몬 1마리를 자신의 시큐리티 위에 뒤집어서 (진화원 파기)
SCRIPTS['BT4-105::메인'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.self, isDigimon, '시큐리티 위에 놓을 자신의 디지몬 선택');
  if (st) toSecurity(ctx, ctx.self, st, 'top');
})];

// ---- BT4-114 (어택 시): 가루몬/하이브리드체 자신의 디지몬 2마리까지 액티브
SCRIPTS['BT4-114::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self;
  const ok = (s) => isDigimon(s) && s.suspended && (nameHas(s.cardId, '가루몬') || hasTrait(s.cardId, '하이브리드체'));
  for (let i = 0; i < 2; i++) {
    const uid = await pickStack(ctx, me, ctx.state.players[me].battle.filter(ok).map(s => s.uid), `액티브로 할 디지몬 선택 (${i + 1}/2, 취소 = 종료)`);
    if (!uid) break;
    S.unsuspendStack(ctx.state, me, uid);
  }
})];

// ---- BT5-011 (진화 시): 자신의 다른 디지몬 1마리 DP+3000
SCRIPTS['BT5-011::진화 시'] = [fn(async (ctx) => {
  const me = ctx.self, self = srcStack(ctx);
  const uid = await pickStack(ctx, me, ctx.state.players[me].battle.filter(s => s !== self && isDigimon(s)).map(s => s.uid), 'DP+3000 할 자신의 다른 디지몬 선택');
  if (uid) S.modifyDP(ctx.state, me, uid, 3000, 'turn');
})];

// ---- BT5-018 (어택 시): 패의 레드 디지몬 카드 1장을 파기 → 그 DP만큼 이 디지몬 DP 증가
SCRIPTS['BT5-018::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), st = srcStack(ctx);
  const i = await pickZoneIdx(ctx, me, 'hand', idxsWhere(pl.hand, id => C(id).category === 'digimon' && hasColor(id, 'red')), '파기할 레드 디지몬 카드 선택 (취소 = 사용 안 함)');
  if (i == null || !st) return;
  const dp = C(pl.hand[i]).dp || 0;
  S.trashFromHand(ctx.state, me, i);
  S.modifyDP(ctx.state, me, st.uid, dp, 'turn');
})];

// ---- BT5-047 (소멸 시): 트래시의 「팔몬」 1장을 그린 자신의 디지몬 1마리의 진화원 가장 아래에
SCRIPTS['BT5-047::소멸 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me);
  if (!idxsWhere(pl.trash, id => C(id).nameKo === '팔몬').length) return;
  const st = await pickWhere(ctx, me, s => isDigimon(s) && stackColors(s).includes('green'), '「팔몬」을 진화원 가장 아래에 놓을 그린 디지몬 선택');
  if (!st) return;
  const id = await takeFrom(ctx, me, ['trash'], c => C(c).nameKo === '팔몬', '진화원으로 놓을 「팔몬」 선택');
  if (id) placeUnderBottom(ctx, me, st, id);
})];

// ---- BT5-060 (등장 시): 덱 가장 위의 카드를 확인한다
SCRIPTS['BT5-060::등장 시'] = [fn(async (ctx) => {
  const top = plOf(ctx, ctx.self).deck[0];
  S.log(ctx.state, `${ctx.self} 덱 가장 위의 카드 확인: ${top ? C(top).nameKo : '(없음)'}`);
  await ctx.choose('multipleChoice', { prompt: `덱 가장 위의 카드: ${top ? `${C(top).nameKo} (${top})` : '(덱이 비어 있음)'}`, options: ['확인'] });
})];

// ---- BT5-072 (소멸 시): 트래시의 【소멸 시】 효과를 가진 Lv.3 디지몬(「가짜 아구몬 박사」 이외) 1장을 패로
SCRIPTS['BT5-072::소멸 시'] = [fn(async (ctx) => {
  const has = (id) => S.parseEffectSegments(C(id).effectKo || '').segments.some(sg => sg.tags.some(t => t.includes('소멸 시')));
  const id = await takeFrom(ctx, ctx.self, ['trash'], c => C(c).category === 'digimon' && lvOf(c) === 3 && C(c).nameKo !== '가짜 아구몬 박사' && has(c), '패로 되돌릴 Lv.3 【소멸 시】 디지몬 카드 선택 (취소 = 안 함)');
  if (id) { plOf(ctx, ctx.self).hand.push(id); S.log(ctx.state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`); }
})];

// ---- BT5-108 (메인 / 시큐리티): Lv.4와 Lv.5인 액티브 상태의 상대 디지몬 각각 1마리씩 소멸
const bt5108 = [fn(async (ctx) => {
  const a = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && !s.suspended && lvOf(s.cardId) === 4, '소멸시킬 Lv.4 액티브 상대 디지몬 선택', 'delete');
  const b = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && !s.suspended && lvOf(s.cardId) === 5, '소멸시킬 Lv.5 액티브 상대 디지몬 선택', 'delete');
  destroy(ctx, ctx.opp, a); destroy(ctx, ctx.opp, b);
})];
SCRIPTS['BT5-108::메인'] = bt5108;
SCRIPTS['BT5-108::시큐리티'] = bt5108;

// ---- BT5-110 (메인): 「오메가몬」 자신의 디지몬 1마리를 패로 되돌리는 것으로 디지몬과 테이머 전부 소멸
SCRIPTS['BT5-110::메인'] = [fn(async (ctx) => {
  const own = await pickWhere(ctx, ctx.self, s => isDigimon(s) && nameHas(s.cardId, '오메가몬'), '패로 되돌릴 「오메가몬」 디지몬 선택', 'bounce');
  if (!own || !bounce(ctx, ctx.self, own)) return;
  const all = [];
  for (const p of ['p1', 'p2']) for (const s of ctx.state.players[p].battle) if (['digimon', 'tamer'].includes(C(s.cardId).category)) all.push([p, s]);
  for (const [p, s] of all) destroy(ctx, p, s);
})];

// ---- BT5-111 (상대의 턴): 상대 디지몬 어택 시 진화원 2장 파기 → 그 어택 종료
SCRIPTS['BT5-111::상대의 턴'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st || st.sources.length < 2) return;
  if (!(await confirm(ctx, ctx.self, '이 디지몬의 진화원 2장을 파기하여 그 어택을 종료시키겠습니까?'))) return;
  S.trashEvoSources(ctx.state, ctx.self, st.uid, 2, 'bottom');
  if (ctx.endAttack) ctx.endAttack(); else S.log(ctx.state, '어택 종료');
})];

// ---- BT5-112 (진화 시): 상대의 테이머 1명을 소멸
SCRIPTS['BT5-112::진화 시'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, isTamer, '소멸시킬 상대의 테이머 선택', 'delete');
  destroy(ctx, ctx.opp, st);
})];

// ---- BT6-028 (메인 · 디지버스트 2): 이 턴 자신의 디지몬 전부는 상대 디지몬에게 블록당하지 않는다
SCRIPTS['BT6-028::메인'] = [{ op: 'costGroup', cost: [digiburst(2)], then: [fn(async (ctx) => {
  for (const s of digimons(ctx.self, ctx.state)) setFlag(s, 'unblockable', ctx.state.turnNumber);
})] }];

// ---- BT6-093 (메인): 「헉몬」/로얄 나이츠 자신의 디지몬 1마리는 이 턴 액티브 상태인 상대 디지몬에게도 어택할 수 있다
SCRIPTS['BT6-093::메인'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.self, s => isDigimon(s) && (nameHas(s.cardId, '헉몬') || hasTrait(s.cardId, '로얄 나이츠')), '액티브 상태의 상대 디지몬에게도 어택할 수 있게 할 디지몬 선택');
  if (st) S.grantKeyword(ctx.state, ctx.self, st.uid, '액티브공격', true, 'turn');
})];

// ---- BT6-105 (메인): 등장 코스트 7 이하의 디지몬 전부 소멸
SCRIPTS['BT6-105::메인'] = [fn(async (ctx) => {
  const all = [];
  for (const p of ['p1', 'p2']) for (const s of ctx.state.players[p].battle) if (isDigimon(s) && (C(s.cardId).cost ?? 0) <= 7) all.push([p, s]);
  for (const [p, s] of all) destroy(ctx, p, s);
})];

// ---- EX1-033 (진화원 / 어택 시): 다음에 곤충형/고대곤충형 카드로 진화할 때 코스트 -1
SCRIPTS['EX1-033::어택 시'] = [fn(async (ctx) => { addEvoMod(ctx.state, ctx.self, { delta: -1, turn: ctx.state.turnNumber, traitAny: ['곤충형', '고대곤충형'] }); S.log(ctx.state, `${ctx.self} 이 턴 다음 곤충형 진화 코스트 -1`); })];

// ---- EX1-037 (진화원 / 자신의 턴): 배틀에서 상대 디지몬만 소멸시켰을 때 레스트 상태 상대 디지몬 1마리는 다음 액티브 페이즈에 액티브가 되지 않는다
SCRIPTS['EX1-037::자신의 턴'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && s.suspended, '다음 액티브 페이즈에 액티브가 되지 않을 레스트 상태의 상대 디지몬 선택');
  if (st) S.setSkipNextUnsuspend(ctx.state, ctx.opp, st.uid);
})];

// ---- BT7-040 (메인 · 디지버스트 4장까지): 파기한 카드 1장마다 상대 디지몬 1마리 DP -3000
SCRIPTS['BT7-040::메인'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const max = Math.min(4, st.sources.length);
  if (!max) return;
  const k = await ctx.choose('multipleChoice', { prompt: '《디지버스트》로 파기할 진화원 장수', options: ['사용 안 함', ...Array.from({ length: max }, (_, i) => `${i + 1}장`)] });
  const n = k || 0;
  if (!n) return;
  const removed = S.trashEvoSources(ctx.state, me, st.uid, n, 'bottom', await S.digiburstChooseSources(ctx.state, me, st, n, ctx.choose));
  for (const id of removed) S.queueDigiburstTrashed(ctx.state, me, id, st.uid);
  // 「라센몬」의 효과로 진화원에서 파기된 BT8-081 (진화원 효과)
  for (const id of removed) {
    if (id !== 'BT8-081') continue;
    const seg = S.parseEffectSegments(C(id).inheritedKo || '').segments.find(sg => sg.tags[0] === '자신의 턴');
    if (seg) S.s1PushPending(ctx.state, { player: me, cardId: id, stackUid: st.uid, tags: seg.tags, text: seg.body, inherited: true });
  }
  if (!removed.length) return;
  const t = await pickWhere(ctx, ctx.opp, isDigimon, `DP를 -${3000 * removed.length} 할 상대 디지몬 선택`, 'dpDown');
  if (t) S.modifyDP(ctx.state, ctx.opp, t.uid, -3000 * removed.length, 'turn');
})];
// BT8-081 (진화원): 「라센몬」의 효과로 진화원에서 파기되었을 때 — 자신의 디지몬 1마리를 액티브, 이 턴 DP+3000
SCRIPTS['BT8-081::자신의 턴'] = [fn(async (ctx) => {
  const uid = await pickStack(ctx, ctx.self, digimons(ctx.self, ctx.state).map(s => s.uid), '액티브로 하고 DP+3000 할 자신의 디지몬 선택');
  if (!uid) return;
  S.unsuspendStack(ctx.state, ctx.self, uid);
  S.modifyDP(ctx.state, ctx.self, uid, 3000, 'turn');
})];

// ---- BT7-043 (등장 시): 패의 그린 디지몬 1장을 오픈할 수 있다 → 이 카드를 덱 위로
SCRIPTS['BT7-043::등장 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), st = srcStack(ctx);
  const i = await pickZoneIdx(ctx, me, 'hand', idxsWhere(pl.hand, id => C(id).category === 'digimon' && hasColor(id, 'green')), '오픈할 패의 그린 디지몬 카드 선택 (취소 = 사용 안 함)');
  if (i == null || !st) return;
  S.log(ctx.state, `${me} 패의 ${C(pl.hand[i]).nameKo} 오픈`);
  bounce(ctx, me, st, 'deckTop');
})];

// ---- BT7-051 (어택 시): 진화원에 하이브리드체/곤충형 카드가 있을 때 진화 코스트 3으로 곤충형/10투사 진화
SCRIPTS['BT7-051::어택 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st || !st.sources.some(id => traitAny(id, ['하이브리드체', '곤충형']))) return;
  await evolveInteractive(ctx, { subject: st, from: 'hand', cardPred: id => traitAny(id, ['곤충형', '10투사']), costMode: 'fixed', cost: 3 });
})];

// ---- BT7-055 (상대의 턴): 상대 디지몬이 액티브가 될 때 패 1장 파기하지 않으면 액티브가 되지 않는다 (엔진: 언서스펜드 페이즈에서 대기 효과로 발생)
SCRIPTS['BT7-055::상대의 턴'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx), pl = plOf(ctx, me);
  if (!st || !st.suspended || !pl.hand.length) return;
  if (!(await confirm(ctx, me, `${C(st.cardId).nameKo}: 패를 1장 파기하고 액티브로 하시겠습니까? (하지 않으면 액티브가 되지 않음)`))) return;
  const i = await pickZoneIdx(ctx, me, 'hand', pl.hand.map((_, k) => k), '파기할 패 선택');
  if (i == null) return;
  S.trashFromHand(ctx.state, me, i);
  S.unsuspendStack(ctx.state, me, st.uid);
})];

// ---- BT7-058 (어택 시): 「데들리액스몬」 1마리의 진화원을 모두 파기하고 이 디지몬의 진화원 아래에 놓는 것으로 「다크나이트몬」으로 무료 진화
SCRIPTS['BT7-058::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx), pl = plOf(ctx, me);
  if (!st || !pl.hand.some(id => C(id).nameKo === '다크나이트몬' && ctx.E.canEvolveAny(st.cardId, id, st.extraColors || [], S.evolveTargetRestriction(ctx.state, me, st)).ok)) return;
  const ax = await pickWhere(ctx, me, s => isDigimon(s) && s !== st && C(s.cardId).nameKo === '데들리액스몬', '진화원으로 놓을 「데들리액스몬」 선택 (취소 = 사용 안 함)');
  if (!ax) return;
  const id = detachStack(ctx.state, me, ax);
  placeUnderBottom(ctx, me, st, id);
  await evolveInteractive(ctx, { subject: st, from: 'hand', cardPred: c => C(c).nameKo === '다크나이트몬', costMode: 'free' });
})];

// ---- BT7-063 (등장 시): 패/트래시의 「스컬나이트몬」과 「데들리액스몬」 1장씩을 이 디지몬의 진화원에
SCRIPTS['BT7-063::등장 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const need = ['스컬나이트몬', '데들리액스몬'];
  if (!need.some(n => canTake(ctx, me, ['hand', 'trash'], id => C(id).nameKo === n))) return;
  if (!(await confirm(ctx, me, '패/트래시의 「스컬나이트몬」과 「데들리액스몬」을 진화원에 놓으시겠습니까?'))) return;
  for (const n of need) {
    const id = await takeFrom(ctx, me, ['hand', 'trash'], c => C(c).nameKo === n, `진화원으로 놓을 「${n}」 선택`);
    if (id) { st.sources.push(id); S.log(ctx.state, `${me} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원으로 놓음`); }
  }
  S.recomputeStackGrants(st);
})];

// ---- BT7-064 (진화 시): 패의 X항체 블랙 카드 1장을 진화원 가장 아래에 → 다음 상대의 턴 종료 시까지 효과로 소멸하지 않고 DP가 마이너스되지 않는다
SCRIPTS['BT7-064::진화 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const taken = await pickNFrom(ctx, me, 'hand', 1, id => xAnti(id) && hasColor(id, 'black'), '진화원 가장 아래에 놓을 X항체 블랙 카드 선택 (취소 = 사용 안 함)');
  if (!taken) return;
  placeUnderBottom(ctx, me, st, taken[0]);
  lockFlag(st, ['noEffectDelete', 'noNegDP'], untilNextOppTurn(ctx.state));
  S.log(ctx.state, `${me} ${C(st.cardId).nameKo} 다음 상대의 턴 종료 시까지 효과로 소멸하지 않고 DP가 마이너스되지 않음`);
})];

// ---- BT7-065 (어택 시): 패의 X항체 카드 1장을 진화원 가장 아래에 → 등장 코스트가 진화원 매수 이하인 상대 디지몬 2마리까지 소멸
SCRIPTS['BT7-065::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const taken = await pickNFrom(ctx, me, 'hand', 1, xAnti, '진화원 가장 아래에 놓을 X항체 카드 선택 (취소 = 사용 안 함)');
  if (!taken) return;
  placeUnderBottom(ctx, me, st, taken[0]);
  const chosen = [];
  for (let i = 0; i < 2; i++) {
    const t = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && !chosen.includes(s) && (C(s.cardId).cost ?? 0) <= st.sources.length, `소멸시킬 상대 디지몬 선택 (${i + 1}/2, 취소 = 종료)`, 'delete');
    if (!t) break;
    chosen.push(t);
  }
  for (const t of chosen) destroy(ctx, ctx.opp, t);
})];

// ---- BT7-082 (등장 시 / 소멸 시), BT7-083 (소멸 시)
SCRIPTS['BT7-082::등장 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st || !canTake(ctx, me, ['hand', 'trash'], id => C(id).nameKo === '시스터몬 블랑')) return;
  const id = await takeFrom(ctx, me, ['hand', 'trash'], c => C(c).nameKo === '시스터몬 블랑', '진화원 가장 아래에 놓을 「시스터몬 블랑」 선택 (취소 = 사용 안 함)');
  if (!id) return;
  placeUnderBottom(ctx, me, st, id);
  recover(ctx);
})];
const sisterRecover = (exceptName) => [fn(async (ctx) => {
  const id = await takeFrom(ctx, ctx.self, ['trash'], c => C(c).nameKo !== exceptName && ['제스몬', '헉몬', '시스터몬'].some(n => nameHas(c, n)), '패로 되돌릴 카드 선택 (제스몬/헉몬/시스터몬)');
  if (id) { plOf(ctx, ctx.self).hand.push(id); S.log(ctx.state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`); }
})];
SCRIPTS['BT7-082::소멸 시'] = sisterRecover('시스터몬 블랑(각성)');
SCRIPTS['BT7-083::소멸 시'] = sisterRecover('시스터몬 느와르(각성)');

// ---- BT7-085 / BT7-087 (메인): 하이브리드체 카드 5장을 테이머 아래에 놓는 것으로 테이머를 Lv.5 디지몬으로 취급하여 진화
const tamerEvolve = (zone, color, targetName) => [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), st = srcStack(ctx);
  if (!st || !isTamer(st)) return;
  const pred = (id) => hasTrait(id, '하이브리드체') && C(id).nameKo !== targetName;
  if (pl[zone].filter(pred).length < 5) return;
  const target = pl.hand.find(id => C(id).nameKo === targetName);
  if (!target) return;
  const base = evoCostAs(target, 5, [color]);
  if (base == null) return;
  if (!(await confirm(ctx, me, `${zone === 'trash' ? '트래시' : '패'}의 하이브리드체 카드 5장을 이 테이머 아래에 놓고 「${targetName}」(으)로 진화하시겠습니까?`))) return;
  const taken = await pickNFrom(ctx, me, zone, 5, pred, '테이머 아래에 놓을 하이브리드체 카드 (놓는 순서)');
  if (!taken) return;
  st.sources.push(...taken);
  const cost = Math.max(0, base + evoAutoDelta(ctx.state, me, st, target, 'hand') + S.hookEvoCostDiscount(ctx.state, me, st, target));
  S.digivolve(ctx.state, me, st.uid, target, cost, 'hand');
})];
SCRIPTS['BT7-085::메인'] = tamerEvolve('trash', 'red', '카이젤그레이몬');
SCRIPTS['BT7-087::메인'] = tamerEvolve('hand', 'blue', '매그너가루몬');

// ---- BT7-095 (메인): 자신의 디지몬 1마리 DP+3000, 진화원 없는 액티브 상대 디지몬에게도 어택 가능
SCRIPTS['BT7-095::메인'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.self, isDigimon, 'DP+3000 할 자신의 디지몬 선택');
  if (!st) return;
  S.modifyDP(ctx.state, ctx.self, st.uid, 3000, 'turn');
  S.grantKeyword(ctx.state, ctx.self, st.uid, '무진화원액티브공격', true, 'turn');
})];

// ---- BT7-110 (메인): Lv.4 자신의 디지몬 1마리는 Lv.을 무시하고 진화 코스트를 지불하여 「10투사」 같은 색 카드로 진화
SCRIPTS['BT7-110::메인'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), state = ctx.state;
  const cost = (st, id) => evoCostAs(id, null, stackColors(st), true);
  const ok = (st, id) => C(id).category === 'digimon' && hasTrait(id, '10투사') && (C(id).colors || []).some(c => stackColors(st).includes(c)) && cost(st, id) != null;
  const stacks = pl.battle.filter(s => isDigimon(s) && lvOf(s.cardId) === 4 && pl.hand.some(id => ok(s, id)));
  if (!stacks.length) return;
  const uid = stacks.length === 1 ? stacks[0].uid : await pickStack(ctx, me, stacks.map(s => s.uid), '진화시킬 Lv.4 디지몬 선택');
  const st = stacks.find(s => s.uid === uid);
  if (!st) return;
  const i = await pickZoneIdx(ctx, me, 'hand', idxsWhere(pl.hand, id => ok(st, id)), '진화할 「10투사」 카드 선택');
  if (i == null) return;
  const id = pl.hand[i];
  const c = Math.max(0, cost(st, id) + evoAutoDelta(state, me, st, id, 'hand') + S.hookEvoCostDiscount(state, me, st, id));
  S.digivolve(state, me, st.uid, id, c, 'hand');
})];

// ---- BT7-111 (등장 시 / 진화 시): Lv.6 이하의 상대 디지몬 1마리 또는 상대의 테이머 1명을 소멸
SCRIPTS['BT7-111::등장 시'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => (isDigimon(s) && lvOf(s.cardId) <= 6) || isTamer(s), '소멸시킬 Lv.6 이하 상대 디지몬 또는 상대의 테이머 선택', 'delete');
  destroy(ctx, ctx.opp, st);
})];

// ---- P-052 (진화 시): 자신의 테이머가 있을 때 진화원 없는 상대 디지몬 3마리까지 다음 상대의 턴 종료 시까지 어택 불가
SCRIPTS['P-052::진화 시'] = [fn(async (ctx) => {
  if (!tamersOf(ctx.self, ctx.state).length) return;
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && s.sources.length === 0 && !chosen.includes(s), `어택할 수 없게 할 진화원 없는 상대 디지몬 (${i + 1}/3, 취소 = 종료)`);
    if (!st) break;
    chosen.push(st);
    setFlag(st, 'noAttack', untilNextOppTurn(ctx.state));
  }
})];

// ---- BT8-029 (진화원 / 서로의 턴): 상대 디지몬의 진화원이 파기되었을 때 Lv.3 상대 디지몬 1마리를 패로
SCRIPTS['BT8-029::서로의 턴'] = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && lvOf(s.cardId) === 3, '패로 되돌릴 Lv.3 상대 디지몬 선택', 'bounce');
  if (st) bounce(ctx, ctx.opp, st);
})];

// ---- BT8-044 (자신의 턴): 자신의 다른 디지몬이 진화했을 때 그 디지몬을 액티브로 할 수 있다
SCRIPTS['BT8-044::자신의 턴'] = [fn(async (ctx) => {
  const evt = evtOf(ctx), me = ctx.self;
  const st = evt && findStack(ctx.state, me, evt.stackUid);
  if (!st || !st.suspended) return;
  if (!(await confirm(ctx, me, `${C(st.cardId).nameKo}을(를) 액티브로 하시겠습니까?`))) return;
  S.unsuspendStack(ctx.state, me, st.uid);
})];

// ---- BT8-070 (진화 시): 진화원에 레드 카드 → 상대 디지몬, 블랙 카드 → 상대 테이머, 등장 코스트 합계 6까지 골라 소멸
SCRIPTS['BT8-070::진화 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st) return;
  const red = st.sources.some(id => hasColor(id, 'red')), black = st.sources.some(id => hasColor(id, 'black'));
  let left = 6;
  const chosen = [];
  const cost = (s) => C(s.cardId).cost ?? 0;
  for (;;) {
    const opts = targets(ctx, ctx.opp, s => !chosen.includes(s) && cost(s) <= left && ((red && isDigimon(s)) || (black && isTamer(s))), 'delete');
    if (!opts.length) break;
    const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: opts.map(s => s.uid), prompt: `소멸시킬 상대의 카드 선택 (남은 등장 코스트 합계 ${left}, 취소 = 종료)` });
    const s = opts.find(x => x.uid === uid);
    if (!s) break;
    chosen.push(s); left -= cost(s);
  }
  for (const s of chosen) destroy(ctx, ctx.opp, s);
})];

// ---- BT8-084 (진화 시): 트래시의 Lv.5 이하 디지몬 1장을 진화원 가장 아래에 → 다음 상대의 턴 종료 시까지 상대 디지몬 4마리까지 이 디지몬의 색 1개마다 DP-1000
SCRIPTS['BT8-084::진화 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  if (canTake(ctx, me, ['trash'], id => C(id).category === 'digimon' && lvOf(id) <= 5)) {
    const id = await takeFrom(ctx, me, ['trash'], c => C(c).category === 'digimon' && lvOf(c) <= 5, '진화원 가장 아래에 놓을 Lv.5 이하 디지몬 카드 선택 (취소 = 놓지 않음)');
    if (id) placeUnderBottom(ctx, me, st, id);
  }
  const colors = new Set([...stackColors(st), ...st.sources.flatMap(id => C(id).colors || [])]);
  const amount = -1000 * colors.size;
  if (!amount) return;
  const chosen = [];
  for (let i = 0; i < 4; i++) {
    const t = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && !chosen.includes(s), `DP${amount} 할 상대 디지몬 (${i + 1}/4, 취소 = 종료)`, 'dpDown');
    if (!t) break;
    chosen.push(t);
    dpUntilNextOppTurn(ctx, ctx.opp, t.uid, amount);
  }
})];

// ---- BT8-091 (등장 시): 비어 있는 육성 에어리어에 디지타마 1장을 부화
SCRIPTS['BT8-091::등장 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), state = ctx.state;
  if (pl.raising || !pl.digitamaDeck.length) return;
  if (!(await confirm(ctx, me, '비어 있는 육성 에어리어에 디지타마 카드를 부화시키겠습니까?'))) return;
  const prev = state.breedingActionTaken;
  state.breedingActionTaken = false;
  S.hatchDigitama(state, me);
  state.breedingActionTaken = prev;
})];

// ---- BT8-102 (메인 / 시큐리티), BT9-100 (시큐리티)
SCRIPTS['BT8-102::메인'] = [fn(async (ctx) => {
  const me = ctx.self;
  const own = await pickWhere(ctx, me, s => isDigimon(s) && !s.suspended, '레스트시킬 자신의 액티브 디지몬 선택 (취소 = 사용 안 함)');
  if (!own) return;
  S.restStack(ctx.state, me, own.uid);
  if (!own.suspended) return;
  const st = await restOppCard(ctx);
  if (st && st.suspended) S.setSkipNextUnsuspend(ctx.state, ctx.opp, st.uid);
})];
const restOppSecurity = [fn(async (ctx) => { await restOppCard(ctx); })];
SCRIPTS['BT8-102::시큐리티'] = restOppSecurity;
SCRIPTS['BT9-100::시큐리티'] = restOppSecurity;

// ---- BT8-105 (메인): 등장 코스트 합계 15까지 상대의 디지몬을 골라 소멸
SCRIPTS['BT8-105::메인'] = [{ op: 'destroySum', stat: 'cost', limit: 15 }];

// ---- BT8-110 (메인)
SCRIPTS['BT8-110::메인'] = [fn(async (ctx) => {
  const me = ctx.self;
  const st = await pickWhere(ctx, me, s => isDigimon(s) && hasTrait(s.cardId, '아머체') && s.sources.length > 0, '겹쳐진 카드를 위에서부터 1장 파기할 「아머체」 디지몬 선택');
  if (st) S.trashEvoSources(ctx.state, me, st.uid, 1, 'top');
  const r = await evolveInteractive(ctx, { from: 'hand', cardPred: id => hasTrait(id, '아머체') });
  if (r) S.unsuspendStack(ctx.state, me, r.uid);
})];

// ---- BT8-112 (진화 시 / 어택 시)
SCRIPTS['BT8-112::진화 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const idx = st.sources.findIndex(id => (C(id).colors || []).length === 2);
  if (idx === -1) return;
  const cand = st.sources.map((id, i) => i).filter(i => (C(st.sources[i]).colors || []).length === 2);
  let pick = cand[0];
  if (cand.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '덱 아래로 되돌릴 2색 진화원 선택', options: cand.map(i => C(st.sources[i]).nameKo) }); if (k == null) return; pick = cand[k]; }
  const [id] = st.sources.splice(pick, 1);
  plOf(ctx, me).deck.push(id);
  S.recomputeStackGrants(st);
  S.log(ctx.state, `${me} ${C(id).nameKo} 진화원에서 덱 아래로`);
  const t = await pickWhere(ctx, ctx.opp, isDigimon, '진화원을 모두 파기할 상대 디지몬 선택', 'other');
  if (t) S.trashEvoSources(ctx.state, ctx.opp, t.uid, 'all', 'bottom');
  let rest = digimons(ctx.opp, ctx.state).filter(s => s.sources.length === 0 && !immune(ctx, ctx.opp, s, 'bounce'));
  while (rest.length) {
    let s = rest[0];
    if (rest.length > 1) { const uid = await pickStack(ctx, ctx.opp, rest.map(x => x.uid), '덱 아래로 되돌릴 순서대로 선택 (진화원이 없는 상대 디지몬)'); s = rest.find(x => x.uid === uid) || rest[0]; }
    rest = rest.filter(x => x !== s);
    bounce(ctx, ctx.opp, s, 'deckBottom');
  }
})];

// ---- EX2-028 (어택 종료 시): 이 디지몬을 다른 자신의 디지몬 1마리의 진화원 가장 아래에 놓을 수 있다
SCRIPTS['EX2-028::어택 종료 시'] = [fn(async (ctx) => {
  const me = ctx.self, st = srcStack(ctx);
  if (!st) return;
  const other = await pickWhere(ctx, me, s => s !== st && isDigimon(s), '진화원 아래에 놓을 다른 자신의 디지몬 선택 (취소 = 사용 안 함)');
  if (!other) return;
  const id = detachStack(ctx.state, me, st);
  placeUnderBottom(ctx, me, other, id);
})];

// ---- EX2-037 (상대의 턴): 상대 디지몬이 액티브가 되었을 때 그 디지몬 1마리를 퇴화 1
SCRIPTS['EX2-037::상대의 턴'] = [fn(async (ctx) => {
  const list = ctx.state.s1Unsusp && ctx.state.s1Unsusp.turn === ctx.state.turnNumber ? ctx.state.s1Unsusp.uids : [];
  const cands = ctx.state.players[ctx.opp].battle.filter(s => isDigimon(s) && list.includes(s.uid) && !immune(ctx, ctx.opp, s, 'retreat'));
  const uid = await pickStack(ctx, ctx.opp, cands.map(s => s.uid), '퇴화 1 시킬 (액티브가 된) 상대 디지몬 선택');
  if (uid) S.retreat(ctx.state, ctx.opp, uid, 1);
})];

// ---- EX2-038 (어택 시): 자신의 테이머 1명마다 이 디지몬의 【진화 시】 효과를 발휘한다
SCRIPTS['EX2-038::어택 시'] = [fn(async (ctx, api) => {
  const n = tamersOf(ctx.self, ctx.state).length;
  const evo = [{ op: 'choice', prompt: '이하의 효과에서 1개를 골라 발휘한다', options: [
    { label: '이 턴 동안 이 디지몬을 DP+2000', then: [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 2000 }] },
    { label: '이 디지몬을 액티브로 한다', then: [{ op: 'unsuspend', target: 'thisStack' }] },
    { label: '등장 코스트 5 이하의 상대 디지몬 1마리를 소멸', then: [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 5 } }] },
  ] }];
  for (let i = 0; i < n; i++) await api.runScript(evo, ctx);
})];

// ---- EX2-043 (진화 시): 서로는 각각 패가 5장이 되도록 파기한다
SCRIPTS['EX2-043::진화 시'] = [fn(async (ctx) => {
  for (const who of [ctx.self, ctx.opp]) {
    const pl = plOf(ctx, who);
    const n = pl.hand.length - 5;
    if (n <= 0) continue;
    const chosen = await ctx.choose('pickFromHandIndexes', { player: who, eligibleIdxs: pl.hand.map((_, i) => i), n, prompt: `${who}: 패가 5장이 되도록 ${n}장 파기` });
    const idxs = (chosen && chosen.length === n) ? chosen : pl.hand.map((_, i) => i).slice(-n);
    idxs.slice().sort((a, b) => b - a).forEach(i => S.trashFromHand(ctx.state, who, i));
  }
})];

// ---- EX2-047 (등장 시): 덱 위 3장 오픈 — 「디·리퍼」 특징 카드와 「ADR-02=서쳐」 1장씩 패에
SCRIPTS['EX2-047::등장 시'] = [fn(async (ctx) => {
  await revealPickEach(ctx, ctx.self, 3, [id => hasTrait(id, '디·리퍼'), id => C(id).nameKo === 'ADR-02=서쳐'], '패에 추가할 카드 선택');
})];

// ---- EX2-048 (시큐리티 / 등장 시), EX2-007 (메인): 「ADR-02=서쳐」를 「마더 디·리퍼」의 진화원 가장 아래에
async function searcherUnder(ctx, mother, mandatory) {
  const me = ctx.self, pl = plOf(ctx, me), state = ctx.state;
  const isSearcher = (id) => C(id).nameKo === 'ADR-02=서쳐';
  const board = state.players[me].battle.filter(s => isDigimon(s) && isSearcher(s.cardId) && s !== mother);
  const opts = [];
  for (const b of board) opts.push({ label: `필드의 ${C(b.cardId).nameKo}`, st: b });
  if (pl.hand.some(isSearcher)) opts.push({ label: '패의 ADR-02=서쳐', hand: true });
  if (!opts.length) return;
  let o = opts[0];
  if (opts.length > 1 || !mandatory) {
    const k = await ctx.choose('multipleChoice', { prompt: '「ADR-02=서쳐」를 진화원 가장 아래에 놓기' + (mandatory ? '' : ' (놓지 않으려면 취소)'), options: opts.map(x => x.label) });
    if (k == null || !opts[k]) return;
    o = opts[k];
  }
  let id;
  if (o.hand) { const i = pl.hand.findIndex(isSearcher); [id] = pl.hand.splice(i, 1); } else id = detachStack(state, me, o.st);
  if (id) placeUnderBottom(ctx, me, mother, id);
}
const searcherToMother = [fn(async (ctx) => {
  const mother = await pickWhere(ctx, ctx.self, s => isDigimon(s) && C(s.cardId).nameKo === '마더 디·리퍼', '진화원 아래에 놓을 「마더 디·리퍼」 선택');
  if (mother) await searcherUnder(ctx, mother, false);
})];
SCRIPTS['EX2-048::시큐리티'] = searcherToMother;
SCRIPTS['EX2-048::등장 시'] = searcherToMother;
SCRIPTS['EX2-007::메인'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st || ctx.state.players[ctx.self].battle.some(s => s !== st && C(s.cardId).nameKo === '마더 디·리퍼')) return;
  await searcherUnder(ctx, st, true);
})];

// ---- EX2-060 (자신의 턴): 이 테이머를 레스트시키는 것으로 패의 「플러그인」 옵션 카드 1장을 코스트 없이 사용
SCRIPTS['EX2-060::자신의 턴'] = [fn(async (ctx) => {
  const me = ctx.self;
  if (!plOf(ctx, me).hand.some(id => C(id).category === 'option' && nameHas(id, '플러그인'))) return;
  if (!(await payRestThis(ctx, '이 테이머를 레스트시켜 패의 「플러그인」 옵션 카드를 코스트 없이 사용하시겠습니까?'))) return;
  await useOptionFree(ctx, me, id => nameHas(id, '플러그인'), '코스트 없이 사용할 「플러그인」 옵션 카드 선택');
})];

// ---- BT9-018 (서로의 턴): DP 6000 이하의 상대 디지몬이 레스트했을 때 소멸시킬 수 있다
SCRIPTS['BT9-018::서로의 턴'] = [fn(async (ctx) => {
  const evt = evtOf(ctx);
  const st = evt && findStack(ctx.state, ctx.opp, evt.stackUid);
  if (!st || !st.suspended || S.effectiveDP(ctx.state, ctx.opp, st) > 6000) return;
  if (!(await confirm(ctx, ctx.self, `${C(st.cardId).nameKo}을(를) 소멸시키겠습니까?`))) return;
  destroy(ctx, ctx.opp, st);
})];

// ---- BT9-043 (진화 시): 진화원에 「홀리드라몬」/「X항체」 — 자신의 시큐리티 1장마다 상대의 디지몬과 시큐리티 디지몬 전부 DP-1000
SCRIPTS['BT9-043::진화 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st || !st.sources.some(id => nameHas(id, '홀리드라몬') || nameHas(id, 'X항체') || xAnti(id))) return;
  const n = plOf(ctx, ctx.self).security.length;
  if (!n) return;
  for (const s of digimons(ctx.opp, ctx.state)) S.modifyDP(ctx.state, ctx.opp, s.uid, -1000 * n, 'turn');
  S.addSecurityDPMod(ctx.state, ctx.opp, -1000 * n, ctx.state.turnNumber);
})];

// ---- BT9-056 (어택 시): 진화원에 「레오몬」 포함/「X항체」가 있을 때 상대의 디지몬 또는 테이머 1장을 레스트
SCRIPTS['BT9-056::어택 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st || !st.sources.some(id => nameHas(id, '레오몬') || nameHas(id, 'X항체') || xAnti(id))) return;
  await restOppCard(ctx);
})];

// ---- BT9-065 (진화 시 / 진화원 어택 시): 등장 코스트 3 이하의 상대 디지몬 또는 테이머 1장을 소멸
const kill3 = [fn(async (ctx) => {
  const st = await pickWhere(ctx, ctx.opp, s => ['digimon', 'tamer'].includes(C(s.cardId).category) && (C(s.cardId).cost ?? 0) <= 3, '소멸시킬 등장 코스트 3 이하의 상대 디지몬/테이머 선택', 'delete');
  destroy(ctx, ctx.opp, st);
})];
SCRIPTS['BT9-065::진화 시'] = kill3;
SCRIPTS['BT9-065::어택 시'] = [fn(async (ctx, api) => {
  const st = srcStack(ctx);
  if (!st || !traitAny(st.cardId, ['머신형', '용인형'])) return;
  await api.runScript(kill3, ctx);
})];

// ---- BT9-066 (진화 시): 트래시의 X항체 카드 1장을 이 디지몬의 진화원 아래에
SCRIPTS['BT9-066::진화 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st) return;
  const id = await takeFrom(ctx, ctx.self, ['trash'], xAnti, '진화원 아래에 놓을 X항체 카드 선택');
  if (id) placeUnderBottom(ctx, ctx.self, st, id);
})];

// ---- BT9-071 / BT9-073 (진화원 / 어택 시): 트래시의 언데드형/마수형 디지몬 카드로 진화
const evoFromTrashUndead = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st) return;
  await evolveInteractive(ctx, { subject: st, from: 'trash', cardPred: id => traitAny(id, ['언데드형', '마수형']) });
})];
SCRIPTS['BT9-071::어택 시'] = evoFromTrashUndead;
SCRIPTS['BT9-073::어택 시'] = evoFromTrashUndead;

// ---- BT9-077 (어택 시): 패의 언데드형/마수형 카드 1장을 파기하는 것으로 이 턴 DP+3000
SCRIPTS['BT9-077::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me), st = srcStack(ctx);
  const i = await pickZoneIdx(ctx, me, 'hand', idxsWhere(pl.hand, id => traitAny(id, ['언데드형', '마수형'])), '파기할 언데드형/마수형 카드 선택 (취소 = 사용 안 함)');
  if (i == null || !st) return;
  S.trashFromHand(ctx.state, me, i);
  S.modifyDP(ctx.state, me, st.uid, 3000, 'turn');
})];

// ---- BT9-079 (어택 종료 시): 다른 자신의 디지몬 1마리를 트래시의 언데드형/마수형 디지몬 카드로 코스트 없이 진화
SCRIPTS['BT9-079::어택 종료 시'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  await evolveInteractive(ctx, { from: 'trash', stackPred: s => s !== st, cardPred: id => traitAny(id, ['언데드형', '마수형']), costMode: 'free' });
})];

// ---- BT9-101 (메인 / 시큐리티): 레스트 상태인 상대의 디지몬과 테이머 1장씩을 덱 아래로
const groundFang = [fn(async (ctx) => {
  const d = await pickWhere(ctx, ctx.opp, s => isDigimon(s) && s.suspended, '덱 아래로 되돌릴 레스트 상태의 상대 디지몬 선택', 'bounce');
  const t = await pickWhere(ctx, ctx.opp, s => isTamer(s) && s.suspended, '덱 아래로 되돌릴 레스트 상태의 상대 테이머 선택', 'bounce');
  if (d) bounce(ctx, ctx.opp, d, 'deckBottom');
  if (t) bounce(ctx, ctx.opp, t, 'deckBottom');
})];
SCRIPTS['BT9-101::메인'] = groundFang;
SCRIPTS['BT9-101::시큐리티'] = groundFang;

// ---- BT9-103 (메인 / 시큐리티): 다음 상대의 턴 종료까지 등장 코스트 7 이하 상대 디지몬은 플레이어에게 어택할 수 없고, 상대의 효과로 서로의 시큐리티는 늘릴 수 없다
const kongo = [fn(async (ctx) => {
  const st = ctx.state;
  (st.s1Rules ||= []).push({ kind: 'noPlayerAttack', owner: ctx.opp, maxCost: 7, until: st.turnNumber + 1 });
  st.s1Rules.push({ kind: 'noSecurityIncrease', blocked: ctx.opp, until: st.turnNumber + 1 });
  S.log(st, `${ctx.opp}의 등장 코스트 7 이하 디지몬은 플레이어에게 어택할 수 없음 / 상대의 효과로 시큐리티를 늘릴 수 없음 (다음 상대 턴 종료까지)`);
})];
SCRIPTS['BT9-103::메인'] = kongo;
SCRIPTS['BT9-103::시큐리티'] = kongo;

// ---- BT9-109 (메인): 이 카드를 진화원에 「X항체」가 없는 자신의 디지몬 1마리의 진화원 아래에
SCRIPTS['BT9-109::메인'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me);
  const st = await pickWhere(ctx, me, s => isDigimon(s) && !s.sources.some(id => nameHas(id, 'X항체')), '진화원 아래에 놓을 「X항체」가 없는 자신의 디지몬 선택');
  if (!st) return;
  const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (i === -1) return;
  pl.trash.splice(i, 1);
  placeUnderBottom(ctx, me, st, ctx.sourceCardId);
})];

// ---- BT9-110 (메인): X항체가 없는 디지몬 1마리 소멸 / 서로의 디지몬이 합계 3마리 이상이면 대신 전부 소멸
SCRIPTS['BT9-110::메인'] = [fn(async (ctx) => {
  const state = ctx.state;
  const all = [];
  for (const p of ['p1', 'p2']) for (const s of state.players[p].battle) if (isDigimon(s)) all.push([p, s]);
  const ok = ([p, s]) => !hasTrait(s.cardId, 'X항체');
  if (all.length >= 3) { for (const e of all.filter(ok)) destroy(ctx, e[0], e[1]); return; }
  const entries = all.filter(ok).filter(([p, s]) => p === ctx.self || !immune(ctx, p, s, 'delete')).map(([p, s]) => ({ player: p, uid: s.uid }));
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '소멸시킬 X항체가 없는 디지몬 선택' });
  if (pick) destroy(ctx, pick.player, findStack(state, pick.player, pick.uid));
})];

// ---- P-077 (진화원 / 어택 시): 패의 퍼플 카드 1장을 오픈하여 덱 위로 되돌릴 수 있다
SCRIPTS['P-077::어택 시'] = [fn(async (ctx) => {
  const me = ctx.self, pl = plOf(ctx, me);
  const i = await pickZoneIdx(ctx, me, 'hand', idxsWhere(pl.hand, id => hasColor(id, 'purple')), '오픈하여 덱 위로 되돌릴 퍼플 카드 선택 (취소 = 사용 안 함)');
  if (i == null) return;
  const [id] = pl.hand.splice(i, 1);
  pl.deck.unshift(id);
  S.log(ctx.state, `${me} 패의 ${C(id).nameKo}을(를) 오픈하여 덱 위로 되돌림`);
})];


// ================================================================== HOOKS: event-driven watchers (need a SCRIPTS entry)
const recordAttack = { attack: (state, hp, holder, info) => { if (info.owner !== hp) (state.s1Atk ||= {})[info.owner] = state.turnNumber; return false; } };
DI('ST5-04', '상대의 턴 종료 시', '한 번도', { events: recordAttack });
DI('ST5-06', '상대의 턴 종료 시', '한 번도', { events: recordAttack });

D('P-063', '자신의 턴', '앙고라몬', { events: { attack: (state, hp, holder, info) => info.owner === hp && info.stack !== holder && isDigimon(info.stack) && info.stack.sources.some(id => C(id).nameKo === '앙고라몬') && !holder.suspended } });
D('BT2-084', '자신의 턴', '플레이어에게', { events: { attackTarget: (state, hp, holder, info) => info.owner === hp && info.targetKind === 'player' && isDigimon(info.stack) && stackColors(info.stack).includes('red') && !holder.suspended } });
D('EX2-060', '자신의 턴', '플러그인', { events: { attack: (state, hp, holder, info) => info.owner === hp && isDigimon(info.stack) && ['레나몬', '구미호몬', '도사몬', '샤크라몬'].some(n => nameHas(info.stack.cardId, n)) && !holder.suspended } });
D('BT8-044', '자신의 턴', '진화했을 때', { limit: 1, events: { digivolve: (state, hp, holder, info) => info.owner === hp && info.stack !== holder && isDigimon(info.stack) && info.stack.suspended } });
DI('BT8-029', '서로의 턴', '진화원이 파기', { limit: 1, src: 'inheritedKo', events: { sourcesTrashed: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) } });
D('BT9-018', '서로의 턴', 'DP 6000', { limit: 1, events: { rest: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) && S.effectiveDP(state, info.owner, info.stack) <= 6000 } });
D('EX2-037', '상대의 턴', '액티브 상태가 되었을 때', { limit: 1, events: { unsuspend: (state, hp, holder, info) => {
  if (info.owner === hp || !isDigimon(info.stack)) return false;
  const u = (state.s1Unsusp && state.s1Unsusp.turn === state.turnNumber) ? state.s1Unsusp : (state.s1Unsusp = { turn: state.turnNumber, uids: [] });
  u.uids.push(info.stack.uid);
  return true;
} } });
DI('EX1-037', '자신의 턴', '배틀에서', { events: { battleWin: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
D('BT5-111', '상대의 턴', '어택을 종료', { events: { attack: (state, hp, holder, info) => info.owner !== hp && holder.sources.length >= 2 } });
D('BT8-066', '자신의 턴', '진화원이 늘어났을 때', { events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && info.srcPlayer === hp } });
D('BT8-031', '상대의 턴', '진화원을 아래에서부터', { events: { attack: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) && info.stack.sources.length > 0 } });
D('BT4-060', '서로의 턴', '레스트시킨다', { events: { play: (state, hp, holder, info) => isDigimon(info.stack) && lvOf(info.stack.cardId) <= 4 && !info.stack.suspended } });

SCRIPTS['BT8-066::자신의 턴'] = [fn(async (ctx) => {
  const st = srcStack(ctx);
  if (!st) return;
  await evolveInteractive(ctx, { subject: st, from: 'hand', cardPred: xAnti, extraDelta: -1 });
})];
SCRIPTS['BT8-031::상대의 턴'] = [fn(async (ctx) => {
  const evt = evtOf(ctx);
  const st = evt && findStack(ctx.state, ctx.opp, evt.stackUid);
  if (st && st.sources.length) S.trashEvoSources(ctx.state, ctx.opp, st.uid, 1, 'bottom');
})];
SCRIPTS['BT4-060::서로의 턴'] = [fn(async (ctx) => {
  const evt = evtOf(ctx);
  if (!evt) return;
  const st = findStack(ctx.state, evt.owner, evt.stackUid);
  if (st) S.restStack(ctx.state, evt.owner, st.uid);
})];


// ================================================================== HOOKS: continuous abilities
const oppHas = (state, hp, f) => state.players[opp(hp)].battle.some(f);
// ---- special evolution: "진화조건을 무시하고 진화 코스트 4를 지불하여 패의 「X」로 진화"
const altEvo = (name) => ({ s1evolveAlt: (state, hp, holder, info) => info.p === hp && info.stack === holder && C(info.targetId).nameKo === name && oppHas(state, hp, s => isDigimon(s) && lvOf(s.cardId) >= 6) ? { cost: 4 } : null });
D('ST7-03', '자신의 턴', 'Lv.6 이상', altEvo('듀크몬'));
D('ST8-04', '자신의 턴', 'Lv.6 이상', altEvo('알포스브이드라몬'));

// ---- attack permissions / restrictions
D('BT2-051', '자신의 턴', '그린인 자신의 테이머', { attackAnyActive: (state, hp) => tamersOf(hp, state).some(s => stackColors(s).includes('green')) });
// 16-16 / BT5-017 inherited: "이 디지몬이 《진격》으로 어택할 때, 액티브 상태의 상대 디지몬에게도 어택할 수 있다" — only while THIS attack was declared through 《진격》 (state._raidUid, set by declareAttack({raid:true})).
DI('BT5-017', '자신의 턴', '진격', { attackAnyActive: (state, hp, holder) => state._raidUid === holder.uid });
DI('EX1-061', '자신의 턴', '길동무', { s1attackTarget: (state, hp, holder, info) => nameHas(holder.cardId, '묘티스몬') && info.attackerP === hp && S.hasKeyword(info.attacker, '길동무') && lvOf(info.target.cardId) <= 4 });
D('BT4-030', '상대의 턴', '어택당하지', { s1cannotBeAttacked: (state, hp, holder, info) => info.stack === holder && holder.sources.some(id => (C(id).category === 'digimon' && hasTrait(id, '하이브리드체')) || (C(id).category === 'tamer' && hasColor(id, 'blue'))) });
D('BT5-032', '서로의 턴', '어택과 블록', {
  s1cannotAttack: (state, hp, holder, info) => info.p !== hp && isDigimon(info.stack) && info.stack.sources.length === 0,
  s1blocked: (state, hp, holder, info) => info.blockerP !== hp && isDigimon(info.blocker) && info.blocker.sources.length === 0,
});
D('BT7-024', '상대의 턴', 'Lv.3인', { s1cannotAttack: (state, hp, holder, info) => info.p !== hp && isDigimon(info.stack) && lvOf(info.stack.cardId) === 3 && holder.sources.some(id => hasTrait(id, '하이브리드체')) });
D('BT8-029', '자신의 턴', '어택할 수 없다', { s1cannotAttack: (state, hp, holder, info) => info.stack === holder && oppHas(state, hp, s => isDigimon(s) && s.sources.length > 0) });
D('EX2-035', '자신의 턴', '플레이어에게', { s1cannotAttackPlayer: (state, hp, holder, info) => info.stack === holder && !tamersOf(hp, state).length });
D('EX2-046', '자신의 턴', '플레이어를', { s1cannotAttackPlayer: (state, hp, holder, info) => info.stack === holder });
DI('EX1-019', '자신의 턴', '블록당하지', { s1blocked: (state, hp, holder, info) => info.attacker === holder && nameHas(holder.cardId, '황제드라몬') });
D('EX2-007', '서로의 턴', '어택할 수 없으며', { noAttack: () => true, effectImmune: (state, hp, holder, target) => target === holder });

// ---- DP
D('BT5-008', '자신의 턴', '다른 「가오스몬」', { dp: (state, hp, holder, target, tp) => (tp === hp && target !== holder && C(target.cardId).nameKo === '가오스몬' ? 3000 : 0) });
D('BT7-084', '자신의 턴', '다른 자신의 「에오스몬」', { dp: (state, hp, holder, target, tp) => (tp === hp && target !== holder && C(target.cardId).nameKo === '에오스몬' ? 1000 : 0) });
D('BT7-065', '자신의 턴', '진화원의 특징으로', { dp: (state, hp, holder, target) => (target === holder ? 1000 * holder.sources.filter(xAnti).length : 0) });
DI('BT2-003', '상대의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, holder, info) => (info.p === hp && holder.suspended ? 1000 : 0) });
D('EX2-011', '자신의 턴', '상한', { s1dpCap: (state, hp, holder, info) => (info.p === hp && tamersOf(hp, state).some(s => stackColors(s).includes('red')) ? 2000 : 0) });
D('BT6-053', '상대의 턴', '마이너스되지', { effectImmune: (state, hp, holder, target, tp, o) => target === holder && o.kind === 'dpDown' });

// ---- misc rule changes
D('BT5-085', '서로의 턴', '발휘하지 않는다', { suppressTrigger: (state, hp, holder, tp, target, tag) => tag === '진화 시' && lvOf(target.cardId) === 7 });
D('BT8-059', '서로의 턴', '진화조건을 무시할 수 없다', { s1evoIgnoreLocked: () => true });
D('BT9-033', '서로의 턴', '등장시킬 수 없다', { s1cannotPlay: () => true });
D('BT9-047', '서로의 턴', '등장시킬 수 없다', { s1cannotPlay: () => true });
D('BT8-057', '상대의 턴', '옵션 카드를 사용할 수 없다', { s1cannotUseOption: (state, hp, holder, info) => info.p !== hp && digimons(hp, state).length > 0 && digimons(hp, state).every(s => s.suspended) });
D('BT6-092', '상대의 턴', '에오스몬', { s1unsuspendGate: (state, hp, holder, info) => info.p !== hp && isTamer(info.stack) && state.players[hp].battle.some(s => C(s.cardId).nameKo === '에오스몬') });
D('BT7-055', '상대의 턴', '패를 1장 파기하지', { s1unsuspendGate: (state, hp, holder, info) => {
  if (info.p === hp || !isDigimon(info.stack) || !info.stack.suspended) return false;
  S.s1PushPending(state, { player: info.p, cardId: holder.cardId, stackUid: info.stack.uid, tags: ['상대의 턴'], text: `${C(holder.cardId).nameKo}: 이 디지몬이 액티브가 될 때, 패를 1장 파기하지 않으면 액티브가 되지 않는다` });
  return true;
} });
DI('BT9-109', '서로의 턴', '파기할 수 없다', { s1protectSource: (state, hp, holder, info) => info.stack === holder && nameHas(info.id, 'X항체') });
D('BT3-056', '자신의 턴', '흡수진화', { s1absorbOpp: (state, hp, holder) => S.turnUsesRemaining(holder, S.onceLimitKey('BT3-056', ['자신의 턴']), 1) > 0 });
D('BT9-044', '상대의 턴', '어택의 대상을', { s1redirect: (state, hp, holder, info) => info.p === hp && holder.sources.some(id => traitAny(id, ['아머체']) || nameHas(id, 'X항체') || xAnti(id)) ? [{ cardId: holder.cardId, stackUid: holder.uid, targetUid: holder.uid, limit: null }] : null });


// ---- replacement abilities (preventLeave(state, hp, holder, target, tp, cause, mode)) ----
D('BT3-075', '서로의 턴', '상대의 효과로 소멸하지', { preventLeave: (state, hp, holder, target, tp, cause, mode) => mode === 'delete' && cause === 'effect' && S.hasKeyword(target, '블로커') });
// pay by trashing sources of `holder` matching pred (n cards); auto-picks the most recently stacked
function paySources(state, hp, holder, n, pred) {
  const idx = holder.sources.map((id, i) => i).filter(i => pred(holder.sources[i])).slice(-n);
  if (idx.length < n) return false;
  const removed = idx.sort((a, b) => b - a).map(i => holder.sources.splice(i, 1)[0]);
  state.players[hp].trash.push(...removed);
  S.recomputeStackGrants(holder);
  return true;
}
const canPaySources = (holder, n, pred) => holder.sources.filter(pred).length >= n;
const survive = (causeOk, nameOk, n, pred) => (state, hp, holder, target, tp, cause, mode) => {
  if (target !== holder || !causeOk(cause) || !nameOk(holder)) return false;
  const p = typeof pred === 'function' ? pred : () => true;
  const test = (id) => p(id, holder);
  if (!canPaySources(holder, n, test)) return false;
  return paySources(state, hp, holder, n, test);
};
D('BT5-086', '서로의 턴', '소멸할 때', { preventLeave: survive(c => c === 'effect', () => true, 1, id => C(id).category === 'digimon' && lvOf(id) === 6) });
const graySurvive = (causeOk) => survive(causeOk, h => nameHas(h.cardId, '그레이몬') || nameHas(h.cardId, '오메가몬'), 2, (id, h) => lvOf(id) === lvOf(h.cardId));
DI('BT9-012', '서로의 턴', '소멸할 때', { preventLeave: graySurvive(c => c === 'effect' || c === 'ownEffect') });
DI('P-072', '서로의 턴', '소멸하거나', { preventLeave: graySurvive(c => c === 'effect') });
D('BT9-044', '서로의 턴', '소멸할 때', { preventLeave: (state, hp, holder, target, tp, cause, mode) => {
  if (target !== holder || mode !== 'delete' || !holder.sources.length) return false;
  const id = holder.sources.pop();
  S.addToSecurity(state, hp, id, 'top');
  S.recomputeStackGrants(holder);
  return true;
} });
// 《디코이》: delete this digimon instead of an own other digimon of the given colors that an opponent's effect would delete
// (every eligible sacrificer is its own candidate for the player — see S.hookPreventLeave / descriptor.preventLeaveOptions)
const decoy = (colors, sacrificers) => (state, hp, holder, target, tp, cause, mode) => {
  if (mode !== 'delete' || cause !== 'effect') return [];
  if (!isDigimon(target) || !stackColors(target).some(c => colors.includes(c))) return [];
  return sacrificers(state, hp, holder).filter(s => s !== target && state.players[hp].battle.includes(s)).map(sac => ({ apply() {
    S.log(state, `${hp} 《디코이》 — ${C(sac.cardId).nameKo}을(를) 소멸시켜 ${C(target.cardId).nameKo}은(는) 소멸하지 않음`);
    S.deleteStack(state, hp, sac.uid, 'trash', 'ownEffect');
    return true;
  } }));
};
DI('BT8-060', '서로의 턴', '디코이', { preventLeaveOptions: decoy(['black'], (state, hp, holder) => (xAnti(holder.cardId) ? [holder] : [])) });
DI('P-045', '서로의 턴', '디코이', { preventLeaveOptions: decoy(['black', 'white'], (state, hp, holder) => state.players[hp].battle.filter(s => s !== holder && isDigimon(s) && C(s.cardId).nameKo === C(holder.cardId).nameKo)) });
D('ST12-12', '서로의 턴', '디코이', { preventLeaveOptions: decoy(['red', 'black'], (state, hp, holder) => (state.players[hp].battle.some(s => isDigimon(s) && (nameHas(s.cardId, '헉몬') || hasTrait(s.cardId, '로얄 나이츠'))) ? [holder] : [])) });

// ---- evolution / play cost discounts ----
const restTamerOpt = (label, targetOk) => (state, hp, holder, info) => {
  if (info.p !== hp || state.activePlayer !== hp || !isDigimon(info.stack) || holder.suspended || !targetOk(info.targetId)) return null;
  return { label: `${label} — 이 테이머를 레스트시켜 진화 코스트 -1?`, apply() { S.restStack(state, hp, holder.uid); return holder.suspended ? -1 : 0; } };
};
D('BT2-088', '자신의 턴', '진화할 때', { s1evoOption: restTamerOpt('타이가', id => nameHas(id, '티라노몬')) });
D('BT4-095', '자신의 턴', '디지버스트', { s1evoOption: restTamerOpt('유진', id => (C(id).effectKo || '').includes('《디지버스트')) });
D('BT5-092', '메인', '레스트시키는 것으로', { s1evoOption: restTamerOpt('시라미네 노키아', id => ['그레이몬', '가루몬', '오메가몬'].some(n => nameHas(id, n))) });
D('BT8-091', '자신의 턴', '가르고몬', { s1evoOption: restTamerOpt('워레스', id => nameHas(id, '가르고몬') || nameHas(id, '래피드몬')) });
D('BT9-090', '자신의 턴', '블랙을 포함하는', { s1evoOption: restTamerOpt('히메카와 마키', id => hasColor(id, 'black') && (C(id).colors || []).length === 2 && C(id).category === 'digimon') });
D('BT7-089', '자신의 턴', '진화할 때', { s1evoDiscount: (state, hp, holder, info) => (info.stack === holder && C(info.targetId).category === 'digimon' && hasColor(info.targetId, 'green') ? -1 : 0) });
D('BT9-077', '자신의 턴', '트래시의 디지몬 카드', { s1evoDiscount: (state, hp, holder, info) => (info.stack === holder && info.from === 'trash' ? -1 : 0) });
D('P-074', '자신의 턴', '시큐리티를 3장까지', { s1evoOption: (state, hp, holder, info) => {
  if (info.stack !== holder || info.p !== hp || !traitAny(info.targetId, ['신인형', '마인형']) || !state.players[hp].security.length) return null;
  return { label: '자신의 시큐리티를 3장까지 파기하여 1장마다 진화 코스트 -1?', async apply(choose) { // choose = the UI's ctx.choose (no blocking prompt())
    const max = Math.min(3, state.players[hp].security.length);
    let n = 1;
    if (typeof choose === 'function') { const k = await choose('multipleChoice', { player: hp, prompt: '파기할 시큐리티 장수 (위에서부터, 0~' + max + ')', options: Array.from({ length: max + 1 }, (_, i) => i + '장') }); n = k == null ? 0 : k; }
    n = Math.max(0, Math.min(max, n));
    for (let i = 0; i < n; i++) S.trashTopSecurityByEffect(state, hp);
    return -n;
  } };
} });
D('EX2-007', '자신의 턴', '지불하는 등장 코스트를', { s1playDiscount: (state, hp, holder, info) => {
  if (info.p !== hp || !traitAny(info.targetId, ['디·리퍼']) || !holder.sources.length) return 0;
  if (!once(holder, 'EX2-007', { tag: '자신의 턴', has: '지불하는 등장 코스트를' })) return 0;
  return -holder.sources.length;
} });
D('EX2-057', '자신의 턴', '지불하는 등장 코스트', { s1playDiscount: (state, hp, holder, info) => (info.p === hp && C(info.targetId).nameKo === '마린엔젤몬' ? -1 : 0) });
