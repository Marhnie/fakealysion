// Shard 8 — bespoke scripts, custom ops (prefix s8_) and continuous/event HOOKS for the BT25/BT26/ST23/ST24/EX12 "Glowing Dawn / Saviors /
// Shambhala / App-link" families.  See the section banners below.
//
//  SCRIPTS  { 'CARD-ID::firstTag': [ops] }  (key = cardId + '::' + tags[0]; '…@needle' picks a segment by body text)
//  OPS      s8_* custom ops (async (instr, ctx, {runScript, runOne}))
//  HOOKS    { 'CARD-ID': [descriptor] }     state.js hook registry (events / evoOption / playDiscount / preventLeave / evoAlt …)
//
// Conventions used throughout:
//  * "테이머 아래의 (뒷면) 카드" = tamerStack.sources (same convention as 《세이브》 / survive-cost parsing: index 0 = bottom).
//  * "상대의 턴 종료까지" expiry number = oppEnd(): T+1 when resolving on my own turn, T when already on the opponent's turn.
//  * effect-caused zone changes go through S.* so state._fxSrc / game events / immunity (effectBlocked) apply.
import * as S from '../state.js';
import { compileToScript, lookupCardSpecific, FX_HELPERS } from '../effects.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ================================================================== small helpers
const C = (id) => S.card(id);
const catOf = (id) => C(id).category;
const trait = (id, ...ts) => (C(id).types || []).some(t => ts.includes(t));
const mentions = (id, term) => { const c = C(id); return c.nameKo.includes(term) || `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes(term) || (c.types || []).some(t => t.includes(term)); };
const nameHas = (id, ...ns) => ns.some(n => C(id).nameKo.includes(n));
const colorsAny = (id, ...cols) => (C(id).colors || []).some(c => cols.includes(c));
const isDigi = (id) => catOf(id) === 'digimon';
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const stackOf = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const ownerOf = (state, st) => ['p1', 'p2'].find(p => state.players[p].battle.includes(st) || state.players[p].raising === st) || null;
const oppEndFor = (state, p) => (state.activePlayer === p ? state.turnNumber + 1 : state.turnNumber);
const oppEnd = (ctx) => oppEndFor(ctx.state, ctx.self);
const thisEnd = (ctx) => ctx.state.turnNumber;
const battleOf = (ctx, who) => ctx.state.players[who === 'opp' ? ctx.opp : ctx.self].battle;
const kindsDT = ['digimon', 'tamer'];
const inKinds = (st, kinds) => kinds.includes(catOf(st.cardId));
const sleep0 = () => {};
const log = (ctx, msg) => S.log(ctx.state, msg);
const S8 = (ctx) => (ctx._s8 ||= {});
// my (self) side memory / opponent side memory as non-negative numbers
const memOf = (state, p) => Math.max(0, p === 'p1' ? state.memory : -state.memory);
const evtOf = (ctx) => (ctx._s8 && ctx._s8.evt) || stackOf(ctx)?.hookEvt || null;

async function confirm(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }
async function pickOne(ctx, player, uids, prompt) { if (!uids.length) return null; return ctx.choose('pickStack', { player, uids, prompt }); }
async function pickMany(ctx, player, uids, n, prompt) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const rest = uids.filter(u => !out.includes(u));
    if (!rest.length) break;
    const u = await pickOne(ctx, player, rest, `${prompt} (${k + 1}/${n})`);
    if (!u) break;
    out.push(u);
  }
  return out;
}
async function pickZone(ctx, zone, eligibleIdxs, prompt, who = ctx.self) {
  if (!eligibleIdxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt });
  return i == null ? null : i;
}
// pick one card out of an arbitrary id list (evolution sources etc.) — returns the index or null
async function pickFromList(ctx, ids, eligibleIdxs, prompt) {
  if (!eligibleIdxs.length) return null;
  if (eligibleIdxs.length === 1 && !prompt.includes('?')) { /* still ask: the choice is optional */ }
  const r = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: eligibleIdxs.map(i => ({ id: ids[i], i })), min: 0, max: 1, prompt });
  return (r && r.length) ? r[0] : null;
}
function withFx(state, hp, category, fn) {
  const prev = state._fxSrc;
  if (!prev) state._fxSrc = { player: hp, category };
  try { return fn(); } finally { state._fxSrc = prev; }
}
function dpUntil(state, st, until) { if (until != null) st.dpExpiry = until; }
function detachStack(state, p, st, dest) { // move a whole stack out of the battle area; sources/links go to trash; returns top card id
  const pl = state.players[p];
  const i = pl.battle.indexOf(st);
  if (i === -1) return null;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map(l => l.cardId);
  pl.trash.push(...st.sources, ...linkIds);
  S.applyOverflowBatch(state, p, [...st.sources, st.cardId]);
  if (dest === 'deckBottom') pl.deck.push(st.cardId);
  else if (dest === 'securityBottom') pl.security.push(st.cardId);
  else if (dest === 'securityTop') pl.security.unshift(st.cardId);
  else if (dest === 'hand') pl.hand.push(st.cardId);
  return st.cardId;
}
const NEEDS_RECOMPUTE = (st) => S.recomputeStackGrants(st);

// ---------------------------------------------------------------- Tamer "아래의 카드" (= tamer.sources)
const ownTamers = (state, p) => state.players[p].battle.filter(s => catOf(s.cardId) === 'tamer');
const tamersWithUnder = (state, p, n) => ownTamers(state, p).filter(t => S.fdCount(t) >= n); // 「뒷면 카드」: the face-down block sources[0..fd-1]
// non-interactive payment (used by hook cost-discounts / survive replacements); prefers `hint`
function payTamerUnderAuto(state, p, n, hint) {
  const list = tamersWithUnder(state, p, n);
  const t = (hint && list.includes(hint)) ? hint : list[0];
  if (!t) return false;
  return withFx(state, p, 'tamer', () => S.trashEvoSources(state, p, t.uid, n, 'bottom').length === n);
}
async function payTamerUnder(ctx, n, pred) {
  const list = tamersWithUnder(ctx.state, ctx.self, n).filter(t => !pred || pred(t));
  if (!list.length) return false;
  const uid = list.length === 1 ? list[0].uid : await pickOne(ctx, ctx.self, list.map(t => t.uid), `아래의 카드를 ${n}장 파기할 테이머 선택`);
  if (!uid) return false;
  return S.trashEvoSources(ctx.state, ctx.self, uid, n, 'bottom').length === n;
}
async function putDeckTopUnder(ctx, tamer, n = 1) {
  const pl = ctx.state.players[ctx.self];
  let k = 0;
  for (; k < n && pl.deck.length; k++) { tamer.sources.unshift(pl.deck.shift()); tamer.s5fd = S.fdCount(tamer) + 1; } // face-down = bottom block (shard5 model)
  if (k) log(ctx, `${ctx.self} 덱 위 ${k}장을 뒷면으로 ${C(tamer.cardId).nameKo} 아래에 놓음`);
  return k;
}
// stack.s8fd: ids of the cards placed FACE-DOWN under a Digimon (multiset, reconciled against the real sources)
function faceDownCount(st) { return S.fdCount(st); } // shard5's model: st.s5fd face-down cards form the bottom block of sources

// ================================================================== generic ops
// "이 디지몬으로 상대의 디지몬 1마리와 배틀할 수 있다." (optional: cancel the pick to decline)
OPS.s8_battle = async (i, ctx) => {
  const { state } = ctx;
  const me = stackOf(ctx);
  if (!me || !state.players[ctx.self].battle.includes(me) || !isDigi(me.cardId)) return;
  const uids = battleOf(ctx, 'opp').filter(s => isDigi(s.cardId)).map(s => s.uid);
  if (!uids.length) { log(ctx, `${ctx.self} 배틀할 상대의 디지몬이 없음`); return; }
  const uid = await pickOne(ctx, ctx.opp, uids, '배틀할 상대의 디지몬 선택');
  if (!uid) return;
  S.resolveDigimonBattle(state, ctx.self, me.uid, uid);
};

// rest N stacks (opponent's, or either side) and remember them in ctx._s8[key]
async function restPicks(ctx, who, kinds, n, prompt) {
  const { state } = ctx;
  const picked = [];
  for (let k = 0; k < n; k++) {
    let target = null;
    if (who === 'either') {
      const entries = [];
      for (const pp of [ctx.self, ctx.opp]) for (const s of state.players[pp].battle) if (inKinds(s, kinds) && !picked.some(x => x.uid === s.uid)) entries.push({ player: pp, uid: s.uid });
      if (!entries.length) break;
      target = await ctx.choose('pickStackAnySide', { entries, prompt: `${prompt} (${k + 1}/${n})` });
    } else {
      const uids = battleOf(ctx, 'opp').filter(s => inKinds(s, kinds) && !picked.some(x => x.uid === s.uid)).map(s => s.uid);
      const uid = await pickOne(ctx, ctx.opp, uids, `${prompt} (${k + 1}/${n})`);
      target = uid ? { player: ctx.opp, uid } : null;
    }
    if (!target) break;
    S.restStack(state, target.player, target.uid);
    picked.push(target);
  }
  return picked;
}
function lockUnsuspend(ctx, player, uid, evolveToo) {
  const st = findStack(ctx.state, player, uid);
  if (!st) return;
  if (S.effectBlocked(ctx.state, player, st, 'other')) { log(ctx, `${player} ${C(st.cardId).nameKo}는 상대의 효과를 받지 않아 액티브 봉인 실패`); return; }
  st.cannotUnsuspendUntil = oppEnd(ctx);
  if (evolveToo) st.cannotEvolveUntil = oppEnd(ctx);
  log(ctx, `${player} ${C(st.cardId).nameKo} 상대의 턴 종료까지 액티브되지 않음${evolveToo ? '/진화할 수 없음' : ''}`);
}
// { who:'opponent'|'either', kinds, n, key, lock:true|'evolve' }
OPS.s8_restPick = async (i, ctx) => {
  const picked = await restPicks(ctx, i.who || 'opponent', i.kinds || kindsDT, i.n || 1, i.prompt || '레스트시킬 디지몬/테이머 선택');
  S8(ctx)[i.key || 'rested'] = picked;
  if (i.lock) for (const t of picked) lockUnsuspend(ctx, t.player, t.uid, i.lock === 'evolve');
};
// { sel:'pick'|'rested'|'allOpp'|'allRestedOpp', kinds, n(number|fn), key, evolve, evolveOnly }
OPS.s8_lock = async (i, ctx) => {
  const kinds = i.kinds || kindsDT;
  const sel = i.sel || 'pick';
  let targets = [];
  if (sel === 'rested') targets = (S8(ctx)[i.key || 'rested'] || []).filter(t => findStack(ctx.state, t.player, t.uid));
  else if (sel === 'allOpp') targets = battleOf(ctx, 'opp').filter(s => inKinds(s, kinds)).map(s => ({ player: ctx.opp, uid: s.uid }));
  else if (sel === 'allRestedOpp') targets = battleOf(ctx, 'opp').filter(s => inKinds(s, kinds) && s.suspended).map(s => ({ player: ctx.opp, uid: s.uid }));
  else {
    const n = typeof i.n === 'function' ? i.n(ctx) : (i.n || 1);
    const uids = await pickMany(ctx, ctx.opp, battleOf(ctx, 'opp').filter(s => inKinds(s, kinds)).map(s => s.uid), n, i.prompt || '상대의 턴 종료까지 액티브되지 않게 할 디지몬/테이머 선택');
    targets = uids.map(uid => ({ player: ctx.opp, uid }));
  }
  for (const t of targets) {
    if (i.evolveOnly) {
      const st = findStack(ctx.state, t.player, t.uid);
      if (st && !S.effectBlocked(ctx.state, t.player, st, 'other')) { st.cannotEvolveUntil = oppEnd(ctx); log(ctx, `${t.player} ${C(st.cardId).nameKo} 상대의 턴 종료까지 진화할 수 없음`); }
    } else lockUnsuspend(ctx, t.player, t.uid, !!i.evolve);
  }
};
// "상대의 디지몬/테이머 N마리는 상대의 턴 종료까지 어택할 수 없다."
OPS.s8_noAttack = async (i, ctx) => {
  const uids = await pickMany(ctx, ctx.opp, battleOf(ctx, 'opp').filter(s => inKinds(s, i.kinds || kindsDT)).map(s => s.uid), i.n || 1, '어택할 수 없게 할 상대의 디지몬/테이머 선택');
  for (const uid of uids) S.restrictAttack(ctx.state, ctx.opp, uid, oppEnd(ctx));
};
// pick an opposing Digimon: 【진화 시】 not activated + cannot rest until the opponent's turn end
OPS.s8_noEvoTrigNoRest = async (i, ctx) => {
  const uid = await pickOne(ctx, ctx.opp, battleOf(ctx, 'opp').filter(s => isDigi(s.cardId)).map(s => s.uid), '【진화 시】 효과가 발휘되지 않고 레스트할 수 없게 할 상대의 디지몬 선택');
  const st = uid && findStack(ctx.state, ctx.opp, uid);
  if (!st || S.effectBlocked(ctx.state, ctx.opp, st, 'other')) return;
  st.noEvoTrigUntil = oppEnd(ctx);
  if (i.noRest !== false) S.preventRest(ctx.state, ctx.opp, uid, oppEnd(ctx));
  if (i.dp) { S.modifyDP(ctx.state, ctx.opp, uid, i.dp, 'turn'); const s2 = findStack(ctx.state, ctx.opp, uid); if (s2) dpUntil(ctx.state, s2, oppEnd(ctx)); }
};
// { target:'this'|'pickOwn'|'pickOpp'|'allOpp'|'ownAllMatching', pred(ctx,st), amount|fn(ctx,st), until:'oppEnd'|'thisTurn', prompt, atkRevert }
OPS.s8_dp = async (i, ctx) => {
  const { state } = ctx;
  const until = i.until === 'thisTurn' ? thisEnd(ctx) : oppEnd(ctx);
  const targets = [];
  const ok = (s) => isDigi(s.cardId) && (!i.pred || i.pred(ctx, s));
  if (i.target === 'this') { const st = stackOf(ctx); if (st) targets.push({ player: ctx.self, uid: st.uid }); }
  else if (i.target === 'allOpp') { for (const s of battleOf(ctx, 'opp')) if (ok(s)) targets.push({ player: ctx.opp, uid: s.uid }); }
  else if (i.target === 'ownAllMatching') { for (const s of battleOf(ctx, 'self')) if (ok(s)) targets.push({ player: ctx.self, uid: s.uid }); }
  else {
    const who = i.target === 'pickOpp' ? 'opp' : 'self';
    const uid = await pickOne(ctx, who === 'opp' ? ctx.opp : ctx.self, battleOf(ctx, who).filter(ok).map(s => s.uid), i.prompt || 'DP를 변경할 디지몬 선택');
    if (uid) targets.push({ player: who === 'opp' ? ctx.opp : ctx.self, uid });
  }
  S8(ctx).dpTargets = [];
  for (const t of targets) {
    const st = findStack(state, t.player, t.uid);
    if (!st) continue;
    const a = typeof i.amount === 'function' ? i.amount(ctx, st) : i.amount;
    if (!a) { S8(ctx).dpTargets.push(t); continue; } // +0 (e.g. opp memory 0): the picked Digimon is still "그 디지몬" for the follow-up attack
    S.modifyDP(state, t.player, t.uid, a, 'turn');
    const st2 = findStack(state, t.player, t.uid);
    if (st2) {
      if (i.until !== 'thisTurn' || i.atkRevert) dpUntil(state, st2, i.atkRevert ? state.turnNumber : until);
      if (i.atkRevert) st2.s8AtkRevert = (st2.s8AtkRevert || 0) + a;
      S8(ctx).dpTargets.push(t);
    }
  }
};
// { target:'this'|'pickOwn'|'ownAllMatching', pred, kinds:['all'], fromCategory }  → S.grantShield ("~의 효과를 받지 않는다")
OPS.s8_shield = async (i, ctx) => {
  const { state } = ctx;
  const until = oppEnd(ctx);
  const targets = [];
  const ok = (s) => isDigi(s.cardId) && (!i.pred || i.pred(ctx, s));
  if (i.target === 'this') { const st = stackOf(ctx); if (st) targets.push(st.uid); }
  else if (i.target === 'ownAllMatching') { for (const s of battleOf(ctx, 'self')) if (ok(s)) targets.push(s.uid); }
  else { const uid = await pickOne(ctx, ctx.self, battleOf(ctx, 'self').filter(ok).map(s => s.uid), i.prompt || '효과를 받지 않게 할 디지몬 선택'); if (uid) targets.push(uid); }
  for (const uid of targets) S.grantShield(state, ctx.self, uid, { kinds: i.kinds || ['all'], fromCategory: i.fromCategory || null, until });
};
// grant keyword(s) with an explicit expiry: { target:'this'|'evtStack'|'pick', who:'self'|'opp', pred, keywords:[[kw,value]], until:'oppEnd'|'turnEnd'|'turnEndWindow', prompt }
OPS.s8_kw = async (i, ctx) => {
  const { state } = ctx;
  const player = i.who === 'opp' ? ctx.opp : ctx.self;
  let uid = null;
  if (i.target === 'this') uid = stackOf(ctx)?.uid;
  else if (i.target === 'evtStack') uid = evtOf(ctx)?.stackUid;
  else uid = await pickOne(ctx, player, battleOf(ctx, i.who === 'opp' ? 'opp' : 'self').filter(s => isDigi(s.cardId) && (!i.pred || i.pred(ctx, s))).map(s => s.uid), i.prompt || '키워드를 얻을 디지몬 선택');
  const st = uid && findStack(state, player, uid);
  if (!st) return;
  const exp = i.until === 'oppEnd' ? oppEnd(ctx) : state.turnNumber; // 'turnEnd' / 'turnEndWindow': ends with this turn — turn-end triggers are queued BEFORE expiry now (6-6), so no +1 window is needed
  for (const [kw, val] of i.keywords) {
    S.grantKeyword(state, player, uid, kw, val, 'permanent');
    st.keywordExpiry = st.keywordExpiry || {};
    st.keywordExpiry[kw] = exp;
  }
};

// ---------------------------------------------------------------- costs ("A하는 것으로, B")
const COST = {
  restThis: {
    can: (ctx) => { const st = stackOf(ctx); return !!st && !st.suspended; },
    pay: async (ctx) => { const st = stackOf(ctx); S.restStack(ctx.state, ctx.self, st.uid); return !!st.suspended; },
  },
  tamerUnder: {
    can: (ctx, c) => tamersWithUnder(ctx.state, ctx.self, c.n || 1).filter(t => !c.pred || c.pred(t)).length > 0,
    pay: (ctx, c) => payTamerUnder(ctx, c.n || 1, c.pred),
  },
  trashHand: {
    can: (ctx, c) => ctx.state.players[ctx.self].hand.filter(id => !c.pred || c.pred(id)).length >= (c.n || 1),
    pay: async (ctx, c) => {
      const pl = ctx.state.players[ctx.self];
      const elig = pl.hand.map((id, k) => k).filter(k => !c.pred || c.pred(pl.hand[k]));
      const n = c.n || 1;
      const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: elig, n, prompt: c.prompt || `파기할 패 ${n}장 선택` });
      if (!chosen || chosen.length < n) return false;
      chosen.slice().sort((a, b) => b - a).forEach(k => S.trashFromHand(ctx.state, ctx.self, k));
      return true;
    },
  },
  trashSecTop: {
    can: (ctx, c) => ctx.state.players[ctx.self].security.length >= (c.n || 1),
    pay: async (ctx, c) => { for (let k = 0; k < (c.n || 1); k++) S.trashTopSecurityByEffect(ctx.state, ctx.self); return true; },
  },
  thisToDeckBottom: {
    can: (ctx) => { const st = stackOf(ctx); return !!st && ctx.state.players[ctx.self].battle.includes(st); },
    pay: async (ctx) => !!detachStack(ctx.state, ctx.self, stackOf(ctx), 'deckBottom'),
  },
  thisUnderSecurity: {
    can: (ctx) => { const st = stackOf(ctx); return !!st && ctx.state.players[ctx.self].battle.includes(st); },
    pay: async (ctx) => !!detachStack(ctx.state, ctx.self, stackOf(ctx), 'securityBottom'),
  },
  ownDigimonSources: { // BT26-006: N sources of one own Digimon matching c.pred(stack)
    can: (ctx, c) => battleOf(ctx, 'self').some(s => isDigi(s.cardId) && (!c.pred || c.pred(s)) && s.sources.length >= c.n),
    pay: async (ctx, c) => {
      const uids = battleOf(ctx, 'self').filter(s => isDigi(s.cardId) && (!c.pred || c.pred(s)) && s.sources.length >= c.n).map(s => s.uid);
      const uid = uids.length === 1 ? uids[0] : await pickOne(ctx, ctx.self, uids, '진화원을 파기할 디지몬 선택');
      if (!uid) return false;
      return S.trashEvoSources(ctx.state, ctx.self, uid, c.n, 'bottom').length === c.n;
    },
  },
  sourceOption: { // trash 1 option card from the sources of any own Digimon (or c.thisOnly)
    can: (ctx, c) => battleOf(ctx, 'self').some(s => isDigi(s.cardId) && (!c.thisOnly || s.uid === ctx.sourceStackUid) && s.sources.some(id => catOf(id) === 'option' && (!c.pred || c.pred(id)))),
    pay: async (ctx, c) => {
      const cands = battleOf(ctx, 'self').filter(s => isDigi(s.cardId) && (!c.thisOnly || s.uid === ctx.sourceStackUid) && s.sources.some(id => catOf(id) === 'option' && (!c.pred || c.pred(id))));
      const uid = cands.length === 1 ? cands[0].uid : await pickOne(ctx, ctx.self, cands.map(s => s.uid), '진화원의 옵션 카드를 파기할 디지몬 선택');
      const st = uid && findStack(ctx.state, ctx.self, uid);
      if (!st) return false;
      const elig = st.sources.map((id, k) => k).filter(k => catOf(st.sources[k]) === 'option' && (!c.pred || c.pred(st.sources[k])));
      const k = elig.length === 1 ? elig[0] : await pickFromList(ctx, st.sources, elig, '파기할 진화원의 옵션 카드 선택');
      if (k == null) return false;
      return S.trashEvoSources(ctx.state, ctx.self, uid, 1, 'bottom', [k]).length === 1;
    },
  },
  handOrSourceOption: { // BT25-092: trash 1 option from hand or from an own Digimon's sources
    can: (ctx, c) => ctx.state.players[ctx.self].hand.some(id => catOf(id) === 'option') || COST.sourceOption.can(ctx, c),
    pay: async (ctx, c) => {
      const pl = ctx.state.players[ctx.self];
      const haveHand = pl.hand.some(id => catOf(id) === 'option'), haveSrc = COST.sourceOption.can(ctx, c);
      let where = haveHand ? 'hand' : 'src';
      if (haveHand && haveSrc) { const r = await ctx.choose('multipleChoice', { prompt: '파기할 옵션 카드를 어디에서 고를까요?', options: ['패에서', '디지몬의 진화원에서'] }); where = r === 1 ? 'src' : 'hand'; }
      if (where === 'hand') {
        const elig = pl.hand.map((id, k) => k).filter(k => catOf(pl.hand[k]) === 'option');
        const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: elig, n: 1, prompt: '파기할 패의 옵션 카드 1장 선택' });
        if (!chosen || chosen.length < 1) return false;
        S.trashFromHand(ctx.state, ctx.self, chosen[0]);
        return true;
      }
      return COST.sourceOption.pay(ctx, c);
    },
  },
  restAnyDigimon: { // "디지몬 1마리를 레스트시키는 것으로" (either side)
    can: (ctx) => [...battleOf(ctx, 'self'), ...battleOf(ctx, 'opp')].some(s => isDigi(s.cardId) && !s.suspended),
    pay: async (ctx) => {
      const { state } = ctx;
      const entries = [];
      for (const pp of [ctx.self, ctx.opp]) for (const s of state.players[pp].battle) if (isDigi(s.cardId) && !s.suspended) entries.push({ player: pp, uid: s.uid });
      const r = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 디지몬 선택 (자신/상대 무관)' });
      if (!r) return false;
      S.restStack(state, r.player, r.uid);
      return !!findStack(state, r.player, r.uid)?.suspended;
    },
  },
  deckTopUnderThis: { // BT26-043: deck top → this Digimon's sources bottom, FACE-DOWN
    can: (ctx) => !!stackOf(ctx) && ctx.state.players[ctx.self].deck.length > 0,
    pay: async (ctx) => {
      const st = stackOf(ctx), pl = ctx.state.players[ctx.self];
      const id = pl.deck.shift();
      st.sources.unshift(id); st.s5fd = (st.s5fd || 0) + 1;
      S.recomputeStackGrants(st);
      log(ctx, `${ctx.self} 덱 위 1장을 뒷면으로 ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
      S.emitGameEvent(ctx.state, 'faceDownSource', { owner: ctx.self, stack: st, cause: 'effect' });
      return true;
    },
  },
  secTopToTamer: { // BT26-025: own security top → face-down under an own tamer matching c.pred
    can: (ctx, c) => ctx.state.players[ctx.self].security.length > 0 && ownTamers(ctx.state, ctx.self).some(t => !c.pred || c.pred(t)),
    pay: async (ctx, c) => {
      const list = ownTamers(ctx.state, ctx.self).filter(t => !c.pred || c.pred(t));
      const uid = list.length === 1 ? list[0].uid : await pickOne(ctx, ctx.self, list.map(t => t.uid), '뒷면으로 시큐리티를 놓을 테이머 선택');
      const t = uid && findStack(ctx.state, ctx.self, uid);
      if (!t) return false;
      const id = ctx.state.players[ctx.self].security.shift();
      t.sources.unshift(id); t.s5fd = S.fdCount(t) + 1;
      log(ctx, `${ctx.self} 시큐리티 맨 위 1장을 뒷면으로 ${C(t.cardId).nameKo} 아래에 놓음`);
      S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' });
      return true;
    },
  },
  anyOf: { // choose one payable alternative
    can: (ctx, c) => c.options.some(o => COST[o.t].can(ctx, o)),
    pay: async (ctx, c) => {
      const opts = c.options.filter(o => COST[o.t].can(ctx, o));
      let o = opts[0];
      if (opts.length > 1) { const r = await ctx.choose('multipleChoice', { prompt: '지불할 비용 선택', options: opts.map(x => x.label) }); o = opts[r == null ? 0 : r]; }
      return COST[o.t].pay(ctx, o);
    },
  },
};
// { costs:[{t,…}], then:[…], optional, prompt } — all costs must be payable, else the effect is skipped
OPS.s8_costThen = async (i, ctx, run) => {
  const costs = i.costs || [];
  if (!costs.every(c => COST[c.t].can(ctx, c))) { log(ctx, `${ctx.self} 비용을 지불할 수 없어 효과를 건너뜀`); return; }
  if (i.optional && !(await confirm(ctx, i.prompt || '비용을 지불하고 효과를 발동할까요?'))) return;
  for (const c of costs) { if (!(await COST[c.t].pay(ctx, c))) { log(ctx, `${ctx.self} 비용 지불에 실패하여 효과를 중단`); return; } }
  await run.runScript(i.then || [], ctx);
};
// { test:(ctx)=>bool, then:[...], else:[...] } — arbitrary JS condition
OPS.s8_if = async (i, ctx, run) => { await run.runScript(i.test(ctx) ? (i.then || []) : (i.else || []), ctx); };


// ---------------------------------------------------------------- evolve / play / use / link ops
// { subject:'this'|'pickOwn'|'evtStack', pred(ctx,stack), zones:['hand'|'trash'], card(id,ctx,stack), delta, free, ignoreCond }
OPS.s8_evolve = async (i, ctx) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const zones = i.zones || ['hand'];
  const evoOk = (st, id) => (i.ignoreCond ? ctx.E.evoRestrictionCheck(id, S.evolveTargetRestriction(state, ctx.self, st)).ok : ctx.E.canEvolveAny(st.cardId, id, S.evoExtraArg(state, null, st), S.evolveTargetRestriction(state, ctx.self, st)).ok);
  const cardsFor = (st, z) => pl[z].map((id, k) => k).filter(k => isDigi(pl[z][k]) && (!i.card || i.card(pl[z][k], ctx, st)) && evoOk(st, pl[z][k]));
  let stacks;
  if (i.subject === 'this') stacks = [stackOf(ctx)].filter(Boolean);
  else if (i.subject === 'evtStack') stacks = [findStack(state, ctx.self, evtOf(ctx)?.stackUid)].filter(Boolean);
  else stacks = pl.battle.filter(s => isDigi(s.cardId) && (!i.pred || i.pred(ctx, s)));
  stacks = stacks.filter(s => isDigi(s.cardId) && zones.some(z => cardsFor(s, z).length));
  if (!stacks.length) { log(ctx, `${ctx.self} 진화시킬 수 있는 조합이 없음`); return false; }
  const uid = stacks.length === 1 && i.subject !== 'pickOwn' ? stacks[0].uid : await pickOne(ctx, ctx.self, stacks.map(s => s.uid), '진화시킬 디지몬 선택');
  const st = stacks.find(s => s.uid === uid);
  if (!st) return false;
  for (const z of zones) {
    const elig = cardsFor(st, z);
    const k = await pickZone(ctx, z, elig, `${z === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택`);
    if (k == null) continue;
    const id = pl[z][k];
    const chk = ctx.E.canEvolveAny(st.cardId, id, S.evoExtraArg(ctx.state, null, st), null);
    const printed = chk.ok ? chk.cost : (C(id).evoNormal?.cost ?? 0);
    const cost = i.free ? 0 : Math.max(0, printed + (i.delta || 0));
    if (z !== 'hand') pl[z].splice(k, 1);
    S.digivolve(state, ctx.self, st.uid, id, cost, z === 'hand' ? 'hand' : 'trash');
    const ns = findStack(state, ctx.self, st.uid);
    if (ns) ns.byEffect = { kind: 'digivolve', effect: true, turn: state.turnNumber };
    S8(ctx).evolved = true;
    return true;
  }
  return false;
};

// use an Option card (from hand/trash/this Digimon's sources) — cost = printed + delta (or free)
function useOptionFrom(ctx, zone, k, delta, free, srcStack) {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const id = zone === 'sources' ? srcStack.sources[k] : pl[zone][k];
  if (!S.optionColorOk(state, ctx.self, id)) { log(ctx, `${ctx.self} ${C(id).nameKo} 사용 불가: 색 조건 미충족`); return false; }
  const cost = free ? 0 : Math.max(0, (C(id).cost || 0) + (delta || 0));
  if (zone === 'sources') { srcStack.sources.splice(k, 1); S.recomputeStackGrants(srcStack); } else pl[zone].splice(k, 1);
  if (cost > 0) S.spendMemory(state, cost);
  pl.trash.push(id);
  log(ctx, `${ctx.self} ${C(id).nameKo} 사용 (효과, 코스트 ${cost})`);
  S.queueTriggersFor(state, ctx.self, id, 'use');
  S.emitGameEvent(state, 'optionUsed', { owner: ctx.self, stack: null, cause: 'effect', cardId: id, useCost: cost });
  return true;
}
// { zones:['hand','trash','sources'], pred(id,ctx), delta, free, kinds:['option'|'digimon'|'tamer'] }
OPS.s8_playOrUse = async (i, ctx) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const kinds = i.kinds || ['digimon', 'tamer', 'option'];
  const dl = typeof i.delta === 'function' ? i.delta(ctx) : (i.delta || 0);
  const me = stackOf(ctx);
  for (const z of (i.zones || ['hand'])) {
    const list = z === 'sources' ? (me ? me.sources : []) : pl[z];
    const elig = list.map((id, k) => k).filter(k => kinds.includes(catOf(list[k])) && (z !== 'sources' || catOf(list[k]) === 'option') && (!i.pred || i.pred(list[k], ctx)));
    const k = z === 'sources' ? await pickFromList(ctx, list, elig, '사용할 진화원의 카드 선택') : await pickZone(ctx, z, elig, `${z === 'trash' ? '트래시' : '패'}에서 ${i.free ? '코스트 없이 ' : ''}등장/사용할 카드 선택`);
    if (k == null) continue;
    const id = list[k];
    if (catOf(id) === 'option') { S8(ctx).played = useOptionFrom(ctx, z, k, dl, i.free, me); return; }
    if (z === 'sources') continue;
    const cost = i.free ? 0 : Math.max(0, (C(id).cost || 0) + dl);
    if (cost > 0) S.spendMemory(state, cost);
    const xo = catOf(id) === 'digimon' ? await FX_HELPERS.xrosOptsFor(ctx, ctx.self, z, k) : {}; // 7-2-2-13
    const st = z === 'hand' ? S.playDigimonFresh(state, ctx.self, k, xo) : S.playFreeFromZone(state, ctx.self, z, k, xo);
    if (st) { st.byEffect = { kind: 'play', effect: true, turn: state.turnNumber }; S8(ctx).played = true; }
    return;
  }
};
// link a card onto a Digimon: { from:['hand','trash','sources'], sourcesOf:'this'|'any', pred(id), target:'this'|'pickOwn', costDelta, free, max, distinct }
OPS.s8_link = async (i, ctx) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const me = stackOf(ctx);
  let host = null;
  if (i.target === 'this') host = me;
  else { const uid = await pickOne(ctx, ctx.self, pl.battle.filter(s => isDigi(s.cardId)).map(s => s.uid), '링크할 디지몬 선택'); host = uid && findStack(state, ctx.self, uid); }
  if (!host || !pl.battle.includes(host)) return;
  const names = [];
  for (let n = 0; n < (i.max || 1); n++) {
    const opts = [];
    for (const z of (i.from || ['hand'])) {
      if (z === 'sources') {
        const holders = i.sourcesOf === 'any' ? pl.battle.filter(s => isDigi(s.cardId)) : [me].filter(Boolean);
        for (const h of holders) h.sources.forEach((id, k) => { if ((!i.pred || i.pred(id)) && !(i.distinct && names.includes(C(id).nameKo)) && (i.ignoreLinkCond || S.linkCheck(state, ctx.self, host, id, i).ok)) opts.push({ z, k, id, from: h }); });
      } else pl[z].forEach((id, k) => { if ((!i.pred || i.pred(id)) && !(i.distinct && names.includes(C(id).nameKo)) && (i.ignoreLinkCond || S.linkCheck(state, ctx.self, host, id, i).ok)) opts.push({ z, k, id }); }); // 10-1-1 link condition
    }
    if (!opts.length) break;
    const ids = opts.map(o => o.id);
    const r = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, x) => ({ id, i: x })), min: 0, max: 1, prompt: `링크할 카드 선택${i.max > 1 ? ` (${n + 1}/${i.max})` : ''}` });
    if (!r || !r.length) break;
    const o = opts[r[0]];
    const lkc = S.linkCheck(state, ctx.self, host, o.id, i);
    const base = lkc.ok ? lkc.cost : 0; // (ignoreLinkCond: BT26-086 단테몬 is not an 「어플몬」 itself — its printed effect links them regardless)
    const cost = i.free ? 0 : Math.max(0, base + (i.costDelta || 0));
    if (o.z === 'sources') { o.from.sources.splice(o.k, 1); S.recomputeStackGrants(o.from); } else pl[o.z].splice(o.k, 1);
    S.linkCardTo(state, ctx.self, host.uid, o.id, o.id, cost, 'x', await S.linkDiscardIdx(state, ctx.self, host.uid, ctx.choose));
    if (i.ignoreLinkCond) { const lk = host.linkCards[host.linkCards.length - 1]; if (lk) lk.ignoreCond = true; } // exempt from the 17-1-3-2-6 rule-check
    names.push(C(o.id).nameKo);
  }
};
// place cards from hand/trash under (bottom) or over (top) a Digimon's evolution sources
// { zones, pred, n, target:'this'|'pickOwn', pos:'top'|'bottom'|'choose', key }
OPS.s8_placeUnder = async (i, ctx) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  let host = null;
  if (i.target === 'this') host = stackOf(ctx);
  else if (i.target === 'lastHost') host = findStack(state, ctx.self, S8(ctx).host);
  else { const uid = await pickOne(ctx, ctx.self, pl.battle.filter(s => isDigi(s.cardId)).map(s => s.uid), '카드를 놓을 디지몬 선택'); host = uid && findStack(state, ctx.self, uid); }
  if (!host) return;
  let placed = 0;
  for (let n = 0; n < (i.n || 1); n++) {
    let picked = null;
    for (const z of (i.zones || ['hand'])) {
      const elig = pl[z].map((id, k) => k).filter(k => !i.pred || i.pred(pl[z][k], ctx));
      const k = await pickZone(ctx, z, elig, `${z === 'trash' ? '트래시' : '패'}에서 진화원으로 놓을 카드 선택 (${n + 1}/${i.n || 1})`);
      if (k != null) { picked = { z, k }; break; }
    }
    if (!picked) break;
    let pos = i.pos || 'bottom';
    if (pos === 'choose') { const r = await ctx.choose('multipleChoice', { prompt: '진화원의 위/아래 어느 쪽에 놓을까요?', options: ['진화원 위', '진화원 아래'] }); pos = r === 0 ? 'top' : 'bottom'; }
    const [id] = pl[picked.z].splice(picked.k, 1);
    if (pos === 'top') host.sources.push(id); else host.sources.unshift(id);
    placed++;
  }
  if (placed) { S.recomputeStackGrants(host); log(ctx, `${ctx.self} ${C(host.cardId).nameKo}의 진화원에 카드 ${placed}장을 놓음`); }
  S8(ctx)[i.key || 'placed'] = placed;
};

// ================================================================== SCRIPTS — batch 1 (BT25 Digimon)
const own = (ctx) => ctx.state.activePlayer === ctx.self;
const ownTurn = (then) => [{ op: 's8_if', test: own, then }];
const TS3 = (id) => trait(id, 'TS') || mentions(id, '3총사');
const oppCountersOwnStack = (ctx) => stackOf(ctx);

SCRIPTS['BT25-057::진화 시'] = [{ op: 's8_battle' }];
SCRIPTS['BT25-058::등장 시'] = [{ op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 1, lock: true }];
SCRIPTS['BT25-059::등장 시'] = [
  { op: 's8_restPick', who: 'either', kinds: ['digimon'], n: 2, prompt: '레스트할 디지몬 선택 (2마리까지)' },
  { op: 's8_shield', target: 'ownAllMatching', pred: (ctx, s) => s.suspended && trait(s.cardId, '식물형', 'TS'), fromCategory: 'digimon' },
];
SCRIPTS['BT25-061::링크 시'] = [{ op: 's8_lock', kinds: ['digimon'], n: 1 }];
SCRIPTS['BT25-069::등장 시'] = [{ op: 's8_link', from: ['trash'], pred: (id) => trait(id, 'TS'), target: 'pickOwn', free: true, allowOption: true }];
SCRIPTS['BT25-070::메인'] = [{ op: 's8_link', from: ['trash', 'sources'], pred: (id) => isDigi(id) && trait(id, '소셜', '툴', '게임'), target: 'this', costDelta: -1 }];
SCRIPTS['BT25-070::자신의 턴'] = [{ op: 's8_destroyPick', who: 'opponent', kinds: ['digimon'], pred: (id) => (C(id).cost || 0) <= 4 }];
SCRIPTS['BT25-070::링크 시'] = [{ op: 's8_lock', kinds: kindsDT, n: 1 }];
SCRIPTS['BT25-071::등장 시'] = [{ op: 's8_noAttack', kinds: kindsDT, n: 1 }];
SCRIPTS['BT25-072::등장 시'] = ownTurn([{ op: 's8_link', from: ['trash', 'sources'], pred: (id) => isDigi(id) && trait(id, '소셜', '툴', '게임'), target: 'this', costDelta: -2 }]);
SCRIPTS['BT25-072::서로의 턴'] = [{ op: 's8_lock', kinds: kindsDT, n: 1, evolveOnly: true, prompt: '상대의 턴 종료까지 진화할 수 없게 할 디지몬/테이머 선택' }];
SCRIPTS['BT25-072::링크 시'] = [{ op: 's8_lock', kinds: kindsDT, n: 2 }];
SCRIPTS['BT25-075::자신의 턴'] = [{ op: 's8_attackEvt' }];
SCRIPTS['BT25-080::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], optional: true, then: [
  { op: 'returnFromTrash', filter: { traitAny: ['타이탄족'] }, prompt: '트래시에서 패에 추가할 특징 「타이탄족」 카드 선택' },
  { op: 's8_if', test: (ctx) => !!stackOf(ctx)?.playedByEffect, then: [{ op: 's8_destroyPick', who: 'opponent', kinds: ['digimon'], pred: (id) => (C(id).level || 0) <= 5 }] },
] }];
SCRIPTS['BT25-081::등장 시'] = [{ op: 's8_restEither', kinds: ['tamer'], pred: (id) => !colorsAny(id, 'purple'), mandatory: true }];
SCRIPTS['BT25-083::진화 시'] = [{ op: 's8_costThen', costs: [{ t: 'sourceOption' }], optional: true, then: [
  { op: 's8_playOrUse', zones: ['trash'], kinds: ['option'], pred: (id) => trait(id, '3총사'), delta: -3 },
] }];
SCRIPTS['BT25-084::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], then: [
  { op: 's8_destroyPick', who: 'opponent', kinds: ['digimon'], mode: 'allHighestDP' },
  { op: 's8_if', test: (ctx) => { const s = stackOf(ctx); return !!s && (!!s.playedByEffect || (s.byEffect?.kind === 'digivolve' && s.byEffect.effect)); }, then: [{ op: 'removeSecurity', who: 'opponent', position: 'top' }] },
] }];
SCRIPTS['BT25-085::진화 시'] = [{ op: 's8_playOrUse', zones: ['hand', 'sources'], kinds: ['option'], pred: (id) => trait(id, '3총사', 'TS'), free: true }];
SCRIPTS['BT25-085::메인'] = [
  { op: 's8_destroyPick', who: 'opponent', kinds: ['digimon'], mode: 'highestLevel' },
  { op: 's8_placeUnder', zones: ['hand', 'trash'], pred: (id) => trait(id, '3총사'), n: 1, target: 'pickOwn', pos: 'bottom' },
];

// ---------------------------------------------------------------- misc generic ops (destroy / attack / rest either)
// { who:'opponent'|'self'|'either', kinds, pred(cardId,stack), mode:'pick'|'allHighestDP'|'highestLevel'|'lowestDP'|'highestCost' }
OPS.s8_destroyPick = async (i, ctx) => {
  const { state } = ctx;
  const kinds = i.kinds || ['digimon'];
  const players = i.who === 'self' ? [ctx.self] : i.who === 'either' ? [ctx.self, ctx.opp] : [ctx.opp];
  const cands = [];
  for (const pp of players) for (const s of state.players[pp].battle) if (inKinds(s, kinds) && (!i.pred || i.pred(s.cardId, s))) cands.push({ player: pp, st: s });
  if (!cands.length) return;
  const stat = (c) => i.mode === 'highestLevel' ? (C(c.st.cardId).level || 0) : i.mode === 'highestCost' ? (C(c.st.cardId).cost || 0) : S.effectiveDP(state, c.player, c.st);
  let pool = cands;
  if (i.mode === 'allHighestDP' || i.mode === 'highestLevel' || i.mode === 'highestCost') { const m = Math.max(...cands.map(stat)); pool = cands.filter(c => stat(c) === m); }
  if (i.mode === 'lowestDP') { const m = Math.min(...cands.map(stat)); pool = cands.filter(c => stat(c) === m); }
  const del = (c) => S.deleteStack(state, c.player, c.st.uid, 'trash', c.player === ctx.self ? 'ownEffect' : 'effect');
  if (i.mode === 'allHighestDP') { for (const c of pool) del(c); return; }
  let target = pool[0];
  if (pool.length > 1 || i.mode === 'pick' || !i.mode) {
    if (players.length === 1) { const uid = await pickOne(ctx, players[0], pool.map(c => c.st.uid), i.prompt || '소멸시킬 디지몬 선택'); target = pool.find(c => c.st.uid === uid); }
    else { const r = await ctx.choose('pickStackAnySide', { entries: pool.map(c => ({ player: c.player, uid: c.st.uid })), prompt: i.prompt || '소멸시킬 디지몬 선택' }); target = r && pool.find(c => c.st.uid === r.uid); }
  }
  if (target) del(target);
};
// rest one stack of either side (kinds/pred) — mandatory unless the pick is cancelled
OPS.s8_restEither = async (i, ctx) => {
  const entries = [];
  for (const pp of [ctx.self, ctx.opp]) for (const s of ctx.state.players[pp].battle) if (inKinds(s, i.kinds || kindsDT) && (!i.pred || i.pred(s.cardId, s))) entries.push({ player: pp, uid: s.uid });
  if (!entries.length) return;
  const r = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 대상 선택' });
  if (r) S.restStack(ctx.state, r.player, r.uid);
};
// attack with `this` (or the stack referenced by the triggering hook event); { evt:true|false, noRest, confirm }
OPS.s8_attackNow = async (i, ctx) => {
  const { state } = ctx;
  const uid = i.fusedUid ? S8(ctx).fused : i.fromDp ? S8(ctx).dpTargets?.[0]?.uid : i.evt ? evtOf(ctx)?.stackUid : ctx.sourceStackUid;
  const st = uid && findStack(state, ctx.self, uid);
  if (!st || (st.suspended && !i.noRest) || !isDigi(st.cardId) || !state.players[ctx.self].battle.includes(st)) { log(ctx, `${ctx.self} 어택할 수 있는 디지몬이 없음`); return; }
  if (i.confirm !== false && !(await confirm(ctx, `${C(st.cardId).nameKo}(으)로 어택할까요?`))) { if (i.revertOnSkip) S.revertAtkEndBuffs?.(state, ctx.self, uid); return; }
  if (ctx.startAttack) ctx.startAttack(ctx.self, uid, undefined, i.noRest ? { noRest: true } : undefined);
};
OPS.s8_attackEvt = async (i, ctx) => OPS.s8_attackNow({ evt: true }, ctx);

// ---------------------------------------------------------------- more ops (sources / attack control / fusion / tamers)
// BT25-103: for each source card of this Digimon, trash one evolution source of an opposing Digimon (chosen)
OPS.s8_trashOppSources = async (i, ctx) => {
  const { state } = ctx;
  const me = stackOf(ctx);
  const n = i.n != null ? i.n : (me ? me.sources.length : 0);
  for (let k = 0; k < n; k++) {
    const entries = [];
    for (const s of battleOf(ctx, 'opp')) if (isDigi(s.cardId)) s.sources.forEach((id, x) => entries.push({ uid: s.uid, x, id }));
    if (!entries.length) break;
    const ids = entries.map(e => e.id);
    const r = await ctx.choose('pickFromRevealed', { player: ctx.opp, revealed: ids, eligible: ids.map((id, y) => ({ id, i: y })), min: 0, max: 1, prompt: `파기할 상대 디지몬의 진화원 선택 (${k + 1}/${n})` });
    if (!r || !r.length) break;
    const e = entries[r[0]];
    S.trashEvoSources(state, ctx.opp, e.uid, 1, 'bottom', [e.x]);
  }
};
// end the attack currently in progress (needs ctx.atk from the UI); optional
OPS.s8_endAttack = async (i, ctx) => {
  const pa = ctx.attack && ctx.attack();
  if (!pa) { log(ctx, '(진행 중인 어택이 없어 어택 종료를 건너뜀)'); return; }
  if (i.confirm !== false && !(await confirm(ctx, '이 어택을 종료할까요?'))) return;
  ctx.endAttack();
};
// change the target of the attack in progress to one of `who`'s Digimon: { pred(cardId,stack) }
OPS.s8_redirect = async (i, ctx) => {
  const pa = ctx.attack && ctx.attack();
  if (!pa) { log(ctx, '(진행 중인 어택이 없어 대상 변경을 건너뜀)'); return; }
  const defenderP = pa.opp;
  const uids = ctx.state.players[defenderP].battle.filter(s => isDigi(s.cardId) && s.uid !== pa.targetUid && (!i.pred || i.pred(s.cardId, s))).map(s => s.uid);
  const uid = await pickOne(ctx, defenderP, uids, '어택의 대상으로 변경할 디지몬 선택');
  if (!uid) return;
  pa.targetKind = 'digimon'; pa.targetUid = uid;
  log(ctx, `${defenderP} 어택의 대상이 ${C(findStack(ctx.state, defenderP, uid).cardId).nameKo}(으)로 변경됨`);
  S.emitGameEvent(ctx.state, 'redirect', { owner: pa.attacker, stack: findStack(ctx.state, pa.attacker, pa.uid), cause: 'effect', targetUid: uid });
};
// "이 카드의 옵션측에 있는 【메인】 효과를 1개 발동한다." (BT25-104)
OPS.s8_runInheritedMain = async (i, ctx, run) => {
  const c = C(ctx.sourceCardId);
  const seg = S.parseEffectSegments(c.inheritedKo || '').segments.find(sg => sg.tags.includes('메인'));
  if (!seg) return;
  const body = seg.body.replace(/〔아츠 진화〕[\s\S]*$/, '').trim();
  const script = lookupCardSpecific(ctx.sourceCardId, ['메인'], body) || compileToScript(body);
  if (!script || !script.length) { log(ctx, '옵션측 【메인】 효과를 자동 실행할 수 없음'); return; }
  await run.runScript(script, ctx);
};
// BT25-091: "트래시에서 옵션 카드 1장을 패에 추가할 수 있다. 이 효과로 추가하지 않았다면, 《1 드로우》."
OPS.s8_returnOrDraw = async (i, ctx) => {
  const pl = ctx.state.players[ctx.self];
  const elig = pl.trash.map((id, k) => k).filter(k => i.pred(pl.trash[k]));
  const k = await pickZone(ctx, 'trash', elig, i.prompt || '트래시에서 패에 추가할 카드 선택');
  if (k == null) { S.drawCards(ctx.state, ctx.self, 1); return; }
  const [id] = pl.trash.splice(k, 1);
  pl.hand.push(id);
  log(ctx, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패에 추가`);
};
// trash → hand with a JS predicate (optional)
OPS.s8_trashToHand = async (i, ctx) => {
  const pl = ctx.state.players[ctx.self];
  const elig = pl.trash.map((id, k) => k).filter(k => i.pred(pl.trash[k]));
  const k = await pickZone(ctx, 'trash', elig, i.prompt || '트래시에서 패에 추가할 카드 선택');
  if (k == null) return;
  const [id] = pl.trash.splice(k, 1);
  pl.hand.push(id);
  log(ctx, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패에 추가`);
};
// own deck top → FACE-DOWN under an own tamer: { n, pred(stack), key } (optional: cancel the pick to decline)
OPS.s8_deckTopUnderTamer = async (i, ctx) => {
  const { state } = ctx;
  const list = ownTamers(state, ctx.self).filter(t => !i.pred || i.pred(t));
  if (!list.length || !state.players[ctx.self].deck.length) return;
  let t;
  if (i.thisTamer) t = stackOf(ctx);
  else { const uid = list.length === 1 && !i.optional ? list[0].uid : await pickOne(ctx, ctx.self, list.map(x => x.uid), '뒷면으로 덱 위를 놓을 테이머 선택'); t = uid && findStack(state, ctx.self, uid); }
  if (!t) return;
  await putDeckTopUnder(ctx, t, i.n || 1);
};
// 어플 합체: own Digimon linked with ≥2 kinds of the fusion line's names → link cards go on top of it and it evolves into the hand card
OPS.s8_appFuse = async (i, ctx) => { // 8-4: rule-level flow lives in S.appFusionCheck / S.appFusion (state.js)
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const combos = [];
  for (const host of pl.battle) {
    if (!isDi(host.cardId) || !(host.linkCards || []).length) continue;
    pl.hand.forEach((id, k) => { if (isDi(id) && S.appFusionCheck(state, ctx.self, host, id).ok) combos.push({ host, k, id }); });
  }
  if (!combos.length) { log(ctx, `${ctx.self} 어플 합체할 수 있는 조합이 없음`); return; }
  const hostUid = await pickOne(ctx, ctx.self, [...new Set(combos.map(c => c.host.uid))], '어플 합체할 디지몬 선택');
  const host = hostUid && findStack(state, ctx.self, hostUid);
  if (!host) return;
  const opts = combos.filter(c => c.host === host);
  const k = await pickZone(ctx, 'hand', opts.map(c => c.k), '어플 합체할 패의 디지몬 카드 선택');
  const c = opts.find(o => o.k === k);
  if (!c) return;
  const cost = Math.max(0, S.appFusionCheck(state, ctx.self, host, c.id).cost + S.continuousEvoCostDiscount(state, ctx.self, host, c.id) + S.hookEvoCostDiscount(state, ctx.self, host, c.id)); // 8-4-2-3
  S.appFusion(state, ctx.self, host.uid, c.id, cost, 'hand');
};

// "A를 자신의 디지몬 1마리의 진화원 아래에 놓는 것으로, 그 디지몬을 패/트래시의 X로 진화 조건을 무시하고 코스트를 지불하지 않고 진화시킬 수 있다."
// { host(ctx,stack), reqs:[{n, pred(id), from:['trash','link','battle','battleTamer']}], to:{zones, pred(id)}, then:[…] }
OPS.s8_placeThenEvolve = async (i, ctx, run) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const hosts = pl.battle.filter(s => isDigi(s.cardId) && (!i.host || i.host(ctx, s)));
  const evoCards = (z) => pl[z].map((id, k) => k).filter(k => isDigi(pl[z][k]) && (!i.to.pred || i.to.pred(pl[z][k])));
  if (!hosts.length || !(i.to.zones || ['hand']).some(z => evoCards(z).length)) { log(ctx, `${ctx.self} 진화시킬 수 있는 조합이 없음`); return; }
  const hUid = hosts.length === 1 ? hosts[0].uid : await pickOne(ctx, ctx.self, hosts.map(s => s.uid), '진화시킬 디지몬 선택');
  const host = hUid && findStack(state, ctx.self, hUid);
  if (!host) return;
  const taken = []; // {kind:'trash'|'link'|'battle', id, from?}
  const usedTrash = new Set(), usedLink = new Set(), usedStacks = new Set();
  for (const r of i.reqs) {
    for (let n = 0; n < (r.n || 1); n++) {
      const opts = [];
      for (const z of r.from || ['trash']) {
        if (z === 'trash') pl.trash.forEach((id, k) => { if (!usedTrash.has(k) && (!r.pred || r.pred(id))) opts.push({ z, k, id }); });
        else if (z === 'link') for (const s of pl.battle) (s.linkCards || []).forEach((l, k) => { if (!usedLink.has(l) && (!r.pred || r.pred(l.cardId))) opts.push({ z, l, s, id: l.cardId }); });
        else for (const s of pl.battle) if (s !== host && !usedStacks.has(s.uid) && catOf(s.cardId) === (z === 'battleTamer' ? 'tamer' : 'digimon') && (!r.pred || r.pred(s.cardId))) opts.push({ z, s, id: s.cardId });
      }
      if (!opts.length) { log(ctx, `${ctx.self} 진화원 아래에 놓을 카드가 부족하여 효과를 건너뜀`); return; }
      const ids = opts.map(o => o.id);
      const pick = opts.length === 1 ? 0 : (await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, x) => ({ id, i: x })), min: 0, max: 1, prompt: '진화원 아래에 놓을 카드 선택' }) || [])[0];
      if (pick == null) return;
      const o = opts[pick];
      if (o.z === 'trash') usedTrash.add(o.k); else if (o.z === 'link') usedLink.add(o.l); else usedStacks.add(o.s.uid);
      taken.push(o);
    }
  }
  if (!(await confirm(ctx, `${C(host.cardId).nameKo}의 진화원 아래에 ${taken.length}장을 놓고 진화할까요?`))) return;
  const trashIdx = taken.filter(o => o.z === 'trash').map(o => o.k).sort((a, b) => b - a);
  const trashIds = [];
  for (const k of trashIdx) trashIds.push(...pl.trash.splice(k, 1));
  const under = [...trashIds];
  for (const o of taken) {
    if (o.z === 'link') { o.s.linkCards.splice(o.s.linkCards.indexOf(o.l), 1); S.recomputeStackGrants(o.s); under.push(o.id); }
    else if (o.z !== 'trash') { const i2 = pl.battle.indexOf(o.s); if (i2 >= 0) { pl.battle.splice(i2, 1); under.push(...o.s.sources, ...(o.s.linkCards || []).map(l => l.cardId), o.s.cardId); } }
  }
  host.sources.unshift(...under);
  S.recomputeStackGrants(host);
  log(ctx, `${ctx.self} ${C(host.cardId).nameKo}의 진화원 아래에 ${under.length}장을 놓음`);
  for (const z of (i.to.zones || ['hand'])) {
    const k = await pickZone(ctx, z, evoCards(z), `${z === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택`);
    if (k == null) continue;
    const id = pl[z][k];
    if (z !== 'hand') pl[z].splice(k, 1);
    S.digivolve(state, ctx.self, host.uid, id, 0, z === 'hand' ? 'hand' : 'trash');
    S8(ctx).host = host.uid;
    break;
  }
  if (i.then) await run.runScript(i.then, ctx);
};

// ================================================================== SCRIPTS — batch 2 (BT25 Tamers / Options)
const restTamerCost = [{ t: 'restThis' }];
SCRIPTS['BT25-086::자신의 턴 종료 시'] = [{ op: 's8_costThen', costs: restTamerCost, then: [
  { op: 's8_dp', target: 'pickOwn', pred: (ctx, s) => trait(s.cardId, 'TS'), amount: (ctx) => 1000 * memOf(ctx.state, ctx.opp), until: 'thisTurn', atkRevert: true, prompt: 'DP를 올릴 특징 「TS」 디지몬 선택' },
  { op: 's8_attackNow', fromDp: true, revertOnSkip: true },
] }];
SCRIPTS['BT25-087::서로의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, optional: true, then: [{ op: 's8_deckTopUnderTamer', thisTamer: true, n: 2 }] }];
SCRIPTS['BT25-088::서로의 턴'] = SCRIPTS['BT25-087::서로의 턴'];
SCRIPTS['BT25-089::메인'] = [{ op: 's8_costThen', costs: restTamerCost, optional: true, then: [
  { op: 's8_link', from: ['hand', 'sources'], sourcesOf: 'any', pred: (id) => isDigi(id) && trait(id, '어플몬'), target: 'pickOwn', costDelta: -2 },
] }];
SCRIPTS['BT25-089::자신의 턴 종료 시'] = [{ op: 's8_appFuse' }];
SCRIPTS['BT25-091::등장 시'] = [{ op: 's8_returnOrDraw', pred: (id) => catOf(id) === 'option' && trait(id, 'TS'), prompt: '트래시에서 패에 추가할 특징 「TS」 옵션 카드 선택' }];
SCRIPTS['BT25-091::자신의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, then: [{ op: 's8_noAttack', kinds: ['digimon'], n: 1 }] }];
SCRIPTS['BT25-092::메인'] = [{ op: 's8_costThen', costs: [{ t: 'restThis' }, { t: 'handOrSourceOption' }], optional: true, then: [
  { op: 's8_evolve', subject: 'pickOwn', zones: ['hand', 'trash'], card: (id) => mentions(id, '3총사') || trait(id, 'TS'), delta: -1 },
] }];
const secToHandPlay = (cols) => [
  { op: 'securityBottomToHand', n: 1 },
  { op: 'placeThisAtSecurityBottom' },
  { op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon'], pred: (id) => trait(id, 'TS') && colorsAny(id, ...cols), delta: -3 },
];
SCRIPTS['BT25-094::메인'] = secToHandPlay(['red', 'blue']);
SCRIPTS['BT25-095::메인'] = secToHandPlay(['red', 'green']);
SCRIPTS['BT25-097::메인'] = secToHandPlay(['yellow', 'purple']);
SCRIPTS['BT25-099::메인'] = secToHandPlay(['green', 'black']);
SCRIPTS['BT25-096::메인'] = [{ op: 's8_placeThenEvolve', host: (ctx, s) => C(s.cardId).nameKo === '가오몬',
  reqs: [{ pred: (id) => C(id).nameKo === '가오가몬' }, { pred: (id) => C(id).nameKo === '마하가오가몬' }], to: { zones: ['hand'], pred: (id) => C(id).nameKo === '미라쥬가오가몬' } }];
SCRIPTS['BT25-098::메인@등장 코스트 -3으로 등장시킬 수'] = [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer'], pred: (id) => trait(id, '어플몬'), delta: -3 }];
SCRIPTS['BT25-103::어택 시'] = [{ op: 's8_trashOppSources' }, { op: 's8_endAttack' }];
SCRIPTS['BT25-104::진화 시'] = [{ op: 's8_runInheritedMain' }];

// ---------------------------------------------------------------- security-stack ops
// put an opposing Digimon on top of its owner's security stack (its evolution cards are trashed): { mode:'pick'|'lowestDP', kinds }
OPS.s8_stackToSecTop = async (i, ctx) => {
  const { state } = ctx;
  let pool = battleOf(ctx, 'opp').filter(s => inKinds(s, i.kinds || ['digimon']));
  if (i.mode === 'lowestDP' && pool.length) { const m = Math.min(...pool.map(s => S.effectiveDP(state, ctx.opp, s))); pool = pool.filter(s => S.effectiveDP(state, ctx.opp, s) === m); }
  const uid = await pickOne(ctx, ctx.opp, pool.map(s => s.uid), i.prompt || '시큐리티 위에 놓을 상대의 디지몬 선택');
  const st = uid && findStack(state, ctx.opp, uid);
  if (!st) return false;
  if (S.effectBlocked(state, ctx.opp, st, 'bounce')) { log(ctx, `${ctx.opp} ${C(st.cardId).nameKo}는 상대의 효과를 받지 않음`); return false; }
  detachStack(state, ctx.opp, st, 'securityTop');
  log(ctx, `${ctx.opp} ${C(st.cardId).nameKo}을(를) 시큐리티 맨 위에 놓음`);
  return true;
};
// ST23-05: "시큐리티가 가장 많은 플레이어의 시큐리티 위에서부터 1장을 파기하는 것으로, 《리커버리 +1》"
OPS.s8_secMostRecover = async (i, ctx) => {
  const { state } = ctx;
  const cnt = { [ctx.self]: state.players[ctx.self].security.length, [ctx.opp]: state.players[ctx.opp].security.length };
  const m = Math.max(cnt[ctx.self], cnt[ctx.opp]);
  if (m <= 0) return;
  const who = [ctx.self, ctx.opp].filter(p => cnt[p] === m);
  let target = who[0];
  if (who.length > 1) { const r = await ctx.choose('multipleChoice', { prompt: '시큐리티가 가장 많은 플레이어 중 파기할 쪽 선택', options: who.map(p => (p === ctx.self ? '자신' : '상대') + '의 시큐리티') }); target = who[r == null ? 0 : r]; }
  S.trashTopSecurityByEffect(state, target);
  S.recoverTopOfDeckToSecurity(state, ctx.self);
};
// hand-size levelling (BT26-079): each player trashes down to `n` cards
OPS.s8_discardDownTo = async (i, ctx) => {
  const { state } = ctx;
  for (const p of [ctx.self, ctx.opp]) {
    const pl = state.players[p];
    const extra = pl.hand.length - i.n;
    if (extra <= 0) continue;
    const chosen = await ctx.choose('pickFromHandIndexes', { player: p, eligibleIdxs: pl.hand.map((id, k) => k), n: extra, prompt: `패가 ${i.n}장이 되도록 ${extra}장 파기` });
    (chosen || []).slice().sort((a, b) => b - a).forEach(k => S.trashFromHand(state, p, k));
  }
};

// ================================================================== SCRIPTS — batch 3 (ST23 / ST24)
const glow = (id) => trait(id, '글로잉 던');
const saber = (id) => trait(id, '세이버즈');
const fdCost = [{ t: 'tamerUnder', n: 1 }];
const thisHas = (f) => (ctx) => { const s = stackOf(ctx); return !!s && f(s.cardId); };
SCRIPTS['ST23-01::어택 시'] = [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: (id) => glow(id), delta: -2 }] }];
SCRIPTS['ST23-04::어택 종료 시'] = [{ op: 's8_if', test: thisHas(glow), then: [{ op: 's8_costThen', costs: fdCost, then: [{ op: 'unsuspend', target: 'thisStack' }] }] }];
SCRIPTS['ST23-08::어택 종료 시'] = SCRIPTS['ST23-04::어택 종료 시'];
SCRIPTS['ST23-05::진화 시'] = [
  { op: 's8_stackToSecTop', mode: 'lowestDP' },
  { op: 's8_secMostRecover' },
];
SCRIPTS['ST23-08::등장 시'] = [
  { op: 's8_dp', target: 'this', amount: 3000, until: 'oppEnd' },
  { op: 's8_if', test: own, then: [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_playOrUse', zones: ['hand'], pred: (id) => glow(id), delta: -3 }] }] },
];
SCRIPTS['ST23-12::등장 시'] = [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_trashToHand', pred: (id) => isDigi(id) && glow(id), prompt: '트래시에서 패에 추가할 특징 「글로잉 던」 디지몬 카드 선택' }] }];
SCRIPTS['ST23-13::자신의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, then: [{ op: 's8_dp', target: 'pickOwn', pred: (ctx, s) => glow(s.cardId), amount: 3000, until: 'oppEnd', prompt: 'DP +3000을 받을 특징 「글로잉 던」 디지몬 선택' }] }];
SCRIPTS['ST24-01::어택 시'] = [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: (id) => saber(id), delta: -2 }] }];
SCRIPTS['ST24-03::등장 시'] = [
  { op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { level: 3, category: 'digimon' } },
  { op: 's8_deckTopUnderTamer', pred: (t) => saber(t.cardId), n: 1, optional: true },
];
SCRIPTS['ST24-09::등장 시'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 1 },
  { op: 's8_deckTopUnderTamer', pred: (t) => saber(t.cardId), n: 1, optional: true },
];
SCRIPTS['ST24-11::진화 시'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 2 },
  { op: 's8_costThen', costs: fdCost, then: [{ op: 's8_lock', sel: 'allOpp', kinds: ['digimon'] }] },
];
SCRIPTS['ST24-12::등장 시'] = [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_trashToHand', pred: (id) => isDigi(id) && saber(id), prompt: '트래시에서 패에 추가할 특징 「세이버즈」 디지몬 카드 선택' }] }];

// "이 디지몬의 어택의 대상은 변경되지 않는다" (until this turn's end) on an own Digimon
OPS.s8_noRedirect = async (i, ctx) => {
  const uid = await pickOne(ctx, ctx.self, battleOf(ctx, 'self').filter(s => isDigi(s.cardId) && (!i.pred || i.pred(ctx, s))).map(s => s.uid), '어택 대상이 변경되지 않게 할 디지몬 선택');
  const st = uid && findStack(ctx.state, ctx.self, uid);
  if (st) { st.noRedirectUntil = thisEnd(ctx); log(ctx, `${ctx.self} ${C(st.cardId).nameKo} 턴 종료까지 어택 대상이 변경되지 않음`); }
};

// ================================================================== SCRIPTS — batch 4 (BT26 Tamers / support)
const ev = (ctx) => evtOf(ctx) || {};
SCRIPTS['BT26-089::서로의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, then: [
  { op: 's8_deckTopUnderTamer', thisTamer: true, n: 1 },
  { op: 's8_if', test: (ctx) => ev(ctx).cause === 'effect', then: [{ op: 's8_kw', target: 'pick', who: 'opp', keywords: [['시큐리티어택', -1]], until: 'oppEnd', prompt: 'S 어택 -1을 줄 상대의 디지몬 선택' }] },
] }];
SCRIPTS['BT26-094::자신의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, then: [
  { op: 's8_kw', target: 'pick', pred: (ctx, s) => saber(s.cardId), keywords: [['에그제큐트', true]], until: 'turnEndWindow', prompt: '《에그제큐트》를 얻을 특징 「세이버즈」 디지몬 선택' },
] }];
SCRIPTS['BT26-090::자신의 턴 종료 시'] = [{ op: 's8_costThen', costs: restTamerCost, optional: true, then: [
  { op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], pred: (id) => trait(id, 'TS'), delta: (ctx) => -memOf(ctx.state, ctx.opp) },
] }];
SCRIPTS['BT26-029::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashSecTop', n: 1 }], then: [{ op: 's8_shield', target: 'pickOwn', kinds: ['dpDown', 'other', 'bounce'], prompt: '상대의 효과를 받지 않게 할 디지몬 선택' }] }];
SCRIPTS['BT26-085::등장 시'] = [{ op: 's8_shield', target: 'this', kinds: ['dpDown', 'other'] }];
SCRIPTS['BT26-031::진화 시'] = [{ op: 's8_costThen', costs: fdCost, then: [{ op: 'recoverTop' }] }];
SCRIPTS['BT26-025::이동 시'] = [{ op: 's8_costThen', costs: [{ t: 'secTopToTamer', pred: (t) => glow(t.cardId) }], then: [{ op: 'recoverTop' }] }];
SCRIPTS['BT26-025::어택 시'] = [
  { op: 's8_costThen', costs: [], optional: true, prompt: '시큐리티를 위에서부터 1장 패에 추가할까요?', then: [{ op: 'securityTopToHand', n: 1 }] },
  { op: 's8_if', test: (ctx) => ctx.state.players[ctx.self].security.length === 0, then: [{ op: 'recoverTop' }] },
];
SCRIPTS['BT26-026::어택 시'] = [{ op: 's8_costThen', costs: [{ t: 'anyOf', options: [{ t: 'tamerUnder', n: 1, label: '테이머 아래의 뒷면 카드 1장 파기' }, { t: 'trashSecTop', n: 1, label: '자신의 시큐리티 위에서 1장 파기' }] }], optional: true, then: [
  { op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], pred: (id) => glow(id), delta: -2 },
] }];
const insectTitan = (id) => trait(id, '곤충형', '타이탄족');
SCRIPTS['BT26-047::등장 시'] = [{ op: 's8_battle' }];
SCRIPTS['BT26-047::자신의 메인 페이즈 개시 시'] = [{ op: 's8_costThen', costs: [{ t: 'restAnyDigimon' }], then: [
  { op: 's8_shield', target: 'ownAllMatching', pred: (ctx, s) => s.suspended && insectTitan(s.cardId), fromCategory: 'option' },
  { op: 's8_dp', target: 'ownAllMatching', pred: (ctx, s) => s.suspended && insectTitan(s.cardId), amount: 3000, until: 'oppEnd' },
] }];
SCRIPTS['BT26-066::자신의 메인 페이즈 개시 시'] = [{ op: 's8_if', test: (ctx) => ctx.state.players[ctx.self].hand.length <= 5, then: [
  { op: 's8_evolve', subject: 'pickOwn', pred: (ctx, s) => trait(s.cardId, '타이탄족'), zones: ['trash'], card: (id) => trait(id, '타이탄족'), delta: -2 },
] }];
SCRIPTS['BT26-021::등장 시'] = [{ op: 's8_noRedirect', pred: (ctx, s) => trait(s.cardId, 'TS') }];
SCRIPTS['BT26-021::메인'] = [{ op: 's8_playOrUse', zones: ['trash'], kinds: ['tamer'], pred: (id) => trait(id, 'TS'), delta: -2 }];
SCRIPTS['BT26-069::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], then: [{ op: 's8_destroyPick', who: 'either', kinds: ['digimon'], pred: (id) => (C(id).level || 0) <= 4 }] }];
SCRIPTS['BT26-074::등장 시'] = [{ op: 's8_if', test: own, then: [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], optional: true, then: [
  { op: 's8_playOrUse', zones: ['trash'], kinds: ['option'], pred: (id) => trait(id, '타이탄족'), delta: -2 },
] }] }];
SCRIPTS['BT26-059::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], optional: true, then: [{ op: 's8_if', test: own, then: [
  { op: 's8_playOrUse', zones: ['trash'], kinds: ['digimon'], pred: (id) => trait(id, '타이탄족') && C(id).nameKo !== '플루토몬', delta: -7 },
] }] }];
SCRIPTS['BT26-070::메인'] = [{ op: 's8_costThen', costs: [{ t: 'tamerUnder', n: 2 }], optional: true, then: [{ op: 's8_playOrUse', zones: ['trash'], kinds: ['option'], pred: (id) => glow(id), delta: -2 }] }];
SCRIPTS['BT26-012::메인'] = [{ op: 's8_playOrUse', zones: ['hand'], pred: (id) => trait(id, 'TB'), delta: -2 }];
SCRIPTS['BT26-104::자신의 턴 종료 시'] = [{ op: 's8_if', test: (ctx) => battleOf(ctx, 'self').some(s => isDigi(s.cardId) && trait(s.cardId, '천제팔무중')), then: [
  { op: 's8_costThen', costs: restTamerCost, optional: true, then: [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], pred: (id) => trait(id, '샴발라'), free: true }] },
] }];
SCRIPTS['BT26-006::어택 시'] = [{ op: 's8_costThen', costs: [{ t: 'ownDigimonSources', n: 2, pred: (s) => trait(s.cardId, '바그라군') }], optional: true, then: [
  { op: 's8_playOrUse', zones: ['hand'], pred: (id) => trait(id, '바그라군'), delta: -2 },
] }];

// BT26-060: for up to 3 opposing Digimon, return N overlaid cards (from the top of each stack) to the top of the opponent's deck
OPS.s8_sourcesToDeckTop = async (i, ctx) => {
  const { state } = ctx;
  const uids = await pickMany(ctx, ctx.opp, battleOf(ctx, 'opp').filter(s => isDigi(s.cardId) && s.sources.length).map(s => s.uid), i.stacks || 3, '겹쳐진 카드를 덱 위로 되돌릴 상대의 디지몬 선택');
  const pl = state.players[ctx.opp];
  for (const uid of uids) {
    const st = findStack(state, ctx.opp, uid);
    if (!st || S.effectBlocked(state, ctx.opp, st, 'bounce')) continue;
    const n = Math.min(i.n || 5, st.sources.length);
    const taken = await S.orderPlacement(ctx.choose, ctx.self, st.sources.splice(st.sources.length - n, n), `덱 위로 되돌릴 ${C(st.cardId).nameKo}의 겹쳐진 카드 ${n}장의 순서를 정하세요 (위쪽부터, 룰 3-1-3-4)`); // top-most overlaid cards
    pl.deck.unshift(...taken);
    S.applyOverflowBatch(state, ctx.opp, taken);
    S.recomputeStackGrants(st);
    log(ctx, `${ctx.opp} ${C(st.cardId).nameKo}의 겹쳐진 카드 ${n}장이 덱 위로 되돌아감`);
  }
};
// 《딜레이》 triggered from a battle-area Option: discard it (not the turn it was placed) and run `then`
OPS.s8_delaySelf = async (i, ctx, run) => {
  const st = stackOf(ctx);
  if (!st || catOf(st.cardId) !== 'option' || ctx.state.turnNumber <= st.placedTurn) { log(ctx, '《딜레이》: 이 카드를 지금은 발동할 수 없음'); return; }
  if (!(await confirm(ctx, `《딜레이》 ${C(st.cardId).nameKo}을(를) 파기하고 효과를 발동할까요?`))) return;
  S8(ctx).evt = st.hookEvt;
  S.discardForDelay(ctx.state, ctx.self, st.uid);
  await run.runScript(i.then || [], ctx);
};

// ================================================================== SCRIPTS — batch 5 (BT26 Digimon / options)
const lvOf = (id) => C(id).level || 0;
SCRIPTS['BT26-097::메인'] = [{ op: 's8_placeThenEvolve', host: (ctx, s) => C(s.cardId).nameKo === '아이기오몬',
  reqs: [{ from: ['battleTamer'], pred: (id) => nameHas(id, '유우키 단', '유우키 카난') }], to: { zones: ['hand', 'trash'], pred: (id) => C(id).nameKo === '유피테르몬' },
  then: [{ op: 's8_placeUnder', zones: ['trash'], pred: (id) => nameHas(id, '아이기오투스몬'), n: 1, target: 'lastHost', pos: 'top' }] }];
SCRIPTS['BT26-098::메인'] = [{ op: 's8_placeThenEvolve', host: (ctx, s) => C(s.cardId).nameKo === '라라몬',
  reqs: [{ pred: (id) => C(id).nameKo === '해바라기몬' }, { pred: (id) => C(id).nameKo === '라일라몬' }], to: { zones: ['hand'], pred: (id) => C(id).nameKo === '로제몬' } }];
SCRIPTS['BT26-102::메인'] = [{ op: 's8_placeThenEvolve', host: (ctx, s) => trait(s.cardId, '세븐 코드'),
  reqs: [{ n: 6, from: ['trash', 'link', 'battle'], pred: (id) => isDigi(id) && trait(id, '세븐 코드') }], to: { zones: ['hand'], pred: (id) => C(id).nameKo === '단테몬' } }];
SCRIPTS['BT26-086::등장 시'] = [
  { op: 's8_link', from: ['sources'], sourcesOf: 'this', pred: (id) => trait(id, '어플몬'), target: 'this', free: true, max: 7, distinct: true, ignoreLinkCond: true },
  { op: 's8_attackNow', noRest: true },
];
SCRIPTS['BT26-007::어택 시'] = [{ op: 's8_link', from: ['hand', 'sources'], sourcesOf: 'this', pred: (id) => isDigi(id) && trait(id, '세븐 코드'), target: 'this', costDelta: -2 }];
const linkSrc = (f) => [{ op: 's8_link', from: ['sources'], sourcesOf: 'this', pred: f, target: 'this', free: true }];
SCRIPTS['BT26-028::등장 시'] = linkSrc((id) => isDigi(id) && lvOf(id) === 3 && trait(id, '라이프', '시스템', '세븐 코드'));
SCRIPTS['BT26-037::등장 시'] = linkSrc((id) => isDigi(id) && lvOf(id) === 3 && trait(id, '내비', '시스템', '세븐 코드'));
SCRIPTS['BT26-028::링크 시'] = [{ op: 's8_noEvoTrigNoRest', noRest: false, dp: -3000 }];
SCRIPTS['BT26-037::링크 시'] = [{ op: 's8_battle' }];
SCRIPTS['BT26-084::링크 시'] = [{ op: 's8_link', from: ['trash'], pred: (id) => isDigi(id) && lvOf(id) <= 4 && trait(id, '시스템', '세븐 코드') && !colorsAny(id, 'white'), target: 'this', free: true }];
SCRIPTS['BT26-030::등장 시'] = [{ op: 's8_costThen', costs: [{ t: 'trashHand', n: 1 }], then: [
  { op: 's8_kw', target: 'pick', pred: (ctx, s) => trait(s.cardId, '일리아스'), keywords: [['에그제큐트', true], ['천승', true]], until: 'turnEndWindow', prompt: '《에그제큐트》와 《천승》을 얻을 특징 「일리아스」 디지몬 선택' },
] }];
SCRIPTS['BT26-043::등장 시'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 1 },
  { op: 's8_costThen', costs: [{ t: 'deckTopUnderThis' }], then: [{ op: 's8_lock', kinds: kindsDT, n: (ctx) => faceDownCount(stackOf(ctx) || { sources: [] }) }] },
];
SCRIPTS['BT26-046::등장 시'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 1 },
  { op: 's8_lock', kinds: kindsDT, n: 1 },
  { op: 'grantBattleImmunity', target: 'self' },
];
SCRIPTS['BT26-049::진화 시'] = [{ op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 2 }];
SCRIPTS['BT26-050::진화 시'] = [
  { op: 's8_restPick', who: 'either', kinds: kindsDT, n: 2, prompt: '레스트할 디지몬/테이머 선택' },
  { op: 's8_lock', kinds: kindsDT, n: 2 },
];
SCRIPTS['BT26-050::메인'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 2 },
  { op: 's8_lock', sel: 'allRestedOpp', kinds: kindsDT, evolve: true },
];
SCRIPTS['BT26-032::메인'] = [
  { op: 's8_restPick', who: 'opponent', kinds: kindsDT, n: 2 },
  { op: 's8_lock', kinds: kindsDT, n: 3 },
];
SCRIPTS['BT26-057::진화 시'] = [{ op: 's8_costThen', costs: fdCost, then: [{ op: 's8_shield', target: 'this', fromCategory: 'digimon' }, { op: 's8_dp', target: 'this', amount: 3000, until: 'oppEnd' }] }];
SCRIPTS['BT26-058::진화 시'] = [{ op: 's8_shield', target: 'pickOwn', pred: (ctx, s) => trait(s.cardId, 'CS'), fromCategory: 'digimon', prompt: '상대의 디지몬의 효과를 받지 않게 할 특징 「CS」 디지몬 선택' }];
SCRIPTS['BT26-060::등장 시'] = [{ op: 's8_sourcesToDeckTop', stacks: 3, n: 5 }];
SCRIPTS['BT26-077::소멸 시'] = [{ op: 's8_destroyPick', who: 'opponent', kinds: kindsDT, mode: 'highestCost' }];
SCRIPTS['BT26-080::진화 시'] = [{ op: 's8_costThen', costs: [{ t: 'restAnyDigimon' }], then: [{ op: 's8_attackNow', noRest: true }] }];
const haveOwn = (f) => (ctx) => battleOf(ctx, 'self').some(s => isDigi(s.cardId) && f(s.cardId));
SCRIPTS['BT26-022::자신의 턴 종료 시'] = [{ op: 's8_if', test: haveOwn((id) => colorsAny(id, 'red', 'purple')), then: [
  { op: 's8_costThen', costs: [{ t: 'thisUnderSecurity' }], optional: true, then: [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon'], pred: (id) => trait(id, '일리아스') && colorsAny(id, 'blue', 'red'), delta: -4 }] },
] }];
SCRIPTS['BT26-067::자신의 턴 종료 시'] = [{ op: 's8_if', test: haveOwn((id) => colorsAny(id, 'blue', 'yellow')), then: [
  { op: 's8_costThen', costs: [{ t: 'thisToDeckBottom' }], optional: true, then: [{ op: 's8_playOrUse', zones: ['trash'], kinds: ['digimon'], pred: (id) => trait(id, '일리아스') && colorsAny(id, 'red', 'blue'), delta: -4 }] },
] }];
SCRIPTS['BT26-096::메인'] = [{ op: 's8_costThen', costs: [{ t: 'thisToDeckBottom' }], optional: true, then: [
  { op: 's8_playOrUse', zones: ['hand', 'trash'], kinds: ['digimon', 'tamer'], pred: (id) => (isDigi(id) && mentions(id, '크로노몬')) || (catOf(id) === 'tamer' && trait(id, 'TS')), delta: -2 },
] }];
const evoT1 = (id) => trait(id, '식물형', '요정형', '세이버즈');
SCRIPTS['BT26-076::자신의 턴'] = [{ op: 's8_evolve', subject: 'this', zones: ['trash'], card: (id) => C(id).nameKo === '레이브몬' || saber(id), delta: -1 }];
SCRIPTS['BT26-044::자신의 턴'] = [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: evoT1, delta: -1 }];
SCRIPTS['BT26-091::자신의 턴'] = [{ op: 's8_costThen', costs: restTamerCost, optional: true, then: [{ op: 's8_evolve', subject: 'pickOwn', zones: ['hand'], card: evoT1, delta: -1 }] }];
SCRIPTS['BT26-038::자신의 턴'] = [{ op: 's8_evolve', subject: 'pickOwn', pred: (ctx, s) => trait(s.cardId, '곤충형', '타이탄족'), zones: ['hand'], card: (id) => trait(id, '곤충형', '타이탄족'), delta: -1 }];
SCRIPTS['BT26-035::자신의 턴'] = [{ op: 's8_evolve', subject: 'pickOwn', pred: (ctx, s) => trait(s.cardId, '곤충형', 'NSp'), zones: ['hand'], card: (id) => trait(id, '곤충형', 'NSp'), delta: -1 }];
SCRIPTS['BT26-001::자신의 턴'] = [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: (id) => mentions(id, '크로노몬'), delta: -1 }];
SCRIPTS['BT26-079::서로의 턴'] = [{ op: 's8_discardDownTo', n: 4 }];
SCRIPTS['BT26-099::서로의 턴'] = [{ op: 's8_delaySelf', then: [{ op: 's8_evolve', subject: 'evtStack', zones: ['hand'], card: (id) => trait(id, 'DM') && lvOf(id) <= 6, free: true, ignoreCond: true }] }];
SCRIPTS['BT26-053::서로의 턴'] = [{ op: 's8_costThen', costs: fdCost, optional: true, then: [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], pred: (id) => glow(id) && (C(id).cost || 0) <= 4, free: true }] }];

// ---------------------------------------------------------------- tokens / keywords / jogress / misc ops (EX12)
function registerToken(def) {
  if (!S.CARDS[def.id]) S.CARDS[def.id] = { level: null, cost: 0, types: [], inheritedKo: '', evoNormal: null, isToken: true, ...def };
}
// { id, nameKo, colors, dp, kw }: "「X」(디지몬·색·DP·《키워드》) 토큰 1마리를 등장시킬 수 있다." (optional)
OPS.s8_token = async (i, ctx) => {
  const { state } = ctx;
  if (!(await confirm(ctx, `「${i.nameKo}」 토큰을 등장시킬까요?`))) return;
  registerToken({ id: i.id, nameKo: i.nameKo, category: 'digimon', colors: i.colors, dp: i.dp, effectKo: i.kw });
  const pl = state.players[ctx.self];
  pl.hand.push(i.id);
  const st = S.playFreeFromZone(state, ctx.self, 'hand', pl.hand.length - 1);
  if (!st) { const k = pl.hand.lastIndexOf(i.id); if (k >= 0) pl.hand.splice(k, 1); return; }
  log(ctx, `${ctx.self} 「${i.nameKo}」 토큰 등장`);
};
// every own Digimon matching pred gains keywords for the turn / until opp end
OPS.s8_kwAll = async (i, ctx) => {
  const { state } = ctx;
  const exp = i.until === 'oppEnd' ? oppEnd(ctx) : state.turnNumber;
  for (const s of battleOf(ctx, 'self')) {
    if (!isDigi(s.cardId) || (i.pred && !i.pred(ctx, s))) continue;
    for (const [kw, val] of i.keywords) { S.grantKeyword(state, ctx.self, s.uid, kw, val, 'permanent'); s.keywordExpiry[kw] = exp; }
  }
};
// EX12-033: trash up to n hand cards (count remembered in ctx._s8.discarded)
OPS.s8_discardUpTo = async (i, ctx) => {
  const pl = ctx.state.players[ctx.self];
  let cnt = 0;
  for (let k = 0; k < i.n && pl.hand.length; k++) {
    const idx = await pickZone(ctx, 'hand', pl.hand.map((id, x) => x), `파기할 패 선택 (${k + 1}/${i.n}, 취소하면 종료)`);
    if (idx == null) break;
    S.trashFromHand(ctx.state, ctx.self, idx);
    cnt++;
  }
  S8(ctx).discarded = cnt;
};
// EX12-033 (inherited 메인): trash n cards from BELOW opposing Digimon/Tamers (chosen one by one)
OPS.s8_trashOppUnder = async (i, ctx) => {
  const { state } = ctx;
  for (let k = 0; k < i.n; k++) {
    const entries = [];
    for (const s of battleOf(ctx, 'opp')) if (inKinds(s, kindsDT)) s.sources.forEach((id, x) => entries.push({ uid: s.uid, x, id }));
    if (!entries.length) break;
    const ids = entries.map(e => e.id);
    const r = await ctx.choose('pickFromRevealed', { player: ctx.opp, revealed: ids, eligible: ids.map((id, y) => ({ id, i: y })), min: 1, max: 1, prompt: `파기할 상대의 디지몬/테이머 아래의 카드 선택 (${k + 1}/${i.n})` });
    const e = entries[(r && r.length) ? r[0] : 0];
    S.trashEvoSources(state, ctx.opp, e.uid, 1, 'bottom', [e.x]);
  }
};
OPS.s8_bounceEmptyOpp = async (i, ctx) => {
  const uid = await pickOne(ctx, ctx.opp, battleOf(ctx, 'opp').filter(s => inKinds(s, kindsDT) && s.sources.length === 0).map(s => s.uid), '패로 되돌릴 (아래에 카드가 없는) 상대의 디지몬/테이머 선택');
  const st = uid && findStack(ctx.state, ctx.opp, uid);
  if (!st || S.effectBlocked(ctx.state, ctx.opp, st, 'bounce')) return;
  detachStack(ctx.state, ctx.opp, st, 'hand');
};
// jogress evolve with a JS predicate: { thisStack:true → this + another own Digimon; else any two own Digimon, cardPred(id), partnerPred(cardId) }
OPS.s8_jogress = async (i, ctx) => {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const me = stackOf(ctx);
  const digis = pl.battle.filter(s => isDigi(s.cardId));
  const legal = (a, b, k) => {
    const id = pl.hand[k];
    if (!isDigi(id) || !(C(id).effectKo || '').includes('〔조그레스〕') || (i.cardPred && !i.cardPred(id))) return false;
    return S.canJogress(a, b, id).ok;
  };
  const pairsFor = (a) => digis.filter(b => b !== a && (!i.partnerPred || i.partnerPred(b.cardId)) && pl.hand.some((id, k) => legal(a, b, k)));
  let a = i.thisStack ? me : null;
  if (!a) {
    const cands = digis.filter(s => pairsFor(s).length);
    const uid = await pickOne(ctx, ctx.self, cands.map(s => s.uid), '조그레스 진화시킬 첫 번째 디지몬 선택');
    a = uid && findStack(state, ctx.self, uid);
  }
  if (!a) return;
  const partners = pairsFor(a);
  if (!partners.length) { log(ctx, `${ctx.self} 조그레스 진화 가능한 조합이 없음`); return; }
  const bUid = await pickOne(ctx, ctx.self, partners.map(s => s.uid), '조그레스 진화시킬 다른 디지몬 선택');
  const b = bUid && findStack(state, ctx.self, bUid);
  if (!b) return;
  const k = await pickZone(ctx, 'hand', pl.hand.map((id, x) => x).filter(x => legal(a, b, x)), '조그레스 진화할 패의 카드 선택');
  if (k == null) return;
  const id = pl.hand[k];
  const j = S.parseJogress(id);
  const fused = S.fuseStacks(state, ctx.self, a.uid, b.uid, id, j ? j.cost : 0, 'hand');
  if (fused) S8(ctx).fused = fused.uid;
};

// ================================================================== SCRIPTS — batch 6 (EX12)
const vbOrGamma = (id) => mentions(id, '감마몬') || trait(id, 'VB');
SCRIPTS['EX12-077::등장 시'] = [{ op: 's8_if', test: (ctx) => ctx.state.players[ctx.self].hand.concat(ctx.state.players[ctx.self].trash).filter(vbOrGamma).length >= 2, then: [
  { op: 's8_placeUnder', zones: ['hand', 'trash'], pred: vbOrGamma, n: 2, target: 'pickOwn', pos: 'choose', key: 'placed' },
  { op: 's8_if', test: (ctx) => S8(ctx).placed === 2, then: [{ op: 's8_destroyPick', who: 'opponent', kinds: kindsDT }] },
] }];
const srcColors = (st) => new Set(st.sources.flatMap(id => C(id).colors || []));
SCRIPTS['EX12-076::등장 시'] = [{ op: 's8_dp', target: 'allOpp', amount: (ctx, st) => -3000 * srcColors(stackOf(ctx) || { sources: [] }).size, until: 'thisTurn' }];
SCRIPTS['EX12-076::어택 시'] = [
  { op: 's8_stackToSecTop', mode: 'pick' },
  { op: 's8_if', test: (ctx) => { const s = stackOf(ctx); return !!s && srcColors(s).size >= 4; }, then: [{ op: 'removeSecurity', who: 'opponent', position: 'top' }, { op: 'recoverTop' }] },
];
SCRIPTS['EX12-057::등장 시'] = [{ op: 's8_token', id: 'TOKEN-파이슈', nameKo: '파이슈', colors: ['yellow'], dp: 6000, kw: '《블로커》《수호》' }];
SCRIPTS['EX12-034::등장 시'] = [{ op: 's8_token', id: 'TOKEN-코텐켄', nameKo: '코텐켄', colors: ['black'], dp: 9000, kw: '《블로커》' }];
SCRIPTS['EX12-052::진화 시'] = [{ op: 's8_shield', target: 'pickOwn', fromCategory: 'digimon', prompt: '상대의 디지몬의 효과를 받지 않게 할 디지몬 선택' }];
const playMain = (pred) => [{ op: 's8_playOrUse', zones: ['hand'], pred, delta: -2 }];
SCRIPTS['EX12-050::메인'] = playMain((id) => mentions(id, '앙고라몬') || trait(id, 'NSp'));
SCRIPTS['EX12-043::메인'] = playMain((id) => trait(id, 'SW'));
SCRIPTS['EX12-041::메인'] = playMain((id) => trait(id, '돌연변이형', 'ME') || nameHas(id, '마메몬'));
SCRIPTS['EX12-027::메인'] = playMain((id) => mentions(id, '젤리몬') || trait(id, 'DS'));
SCRIPTS['EX12-013::메인'] = playMain(vbOrGamma);
SCRIPTS['EX12-046::자신의 턴'] = [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: (id) => trait(id, 'TB'), delta: -2 }];
SCRIPTS['EX12-045::등장 시'] = [
  { op: 's8_costThen', costs: [], optional: true, prompt: '시큐리티를 위에서부터 1장 패에 추가할까요?', then: [{ op: 'securityTopToHand', n: 1 }] },
  { op: 's8_if', test: (ctx) => ctx.state.players[ctx.self].security.length <= 2, then: [{ op: 'recoverTop' }] },
];
SCRIPTS['EX12-045::자신의 턴'] = [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer'], pred: (id) => mentions(id, '손오공몬') || trait(id, 'SW'), delta: -2 }];
// "Lv.이 같은 카드가 2장 이상 겹쳐져 있다면": some Lv. value shared by 2+ of the overlaid (source) cards (no reference level is printed)
const sameLvStacked = (ctx) => { const s = stackOf(ctx); if (!s) return false; const cnt = {}; for (const id of s.sources) { const lv = lvOf(id); if (!lv) continue; cnt[lv] = (cnt[lv] || 0) + 1; } return Object.values(cnt).some(n => n >= 2); };
SCRIPTS['EX12-044::어택 시'] = [{ op: 's8_if', test: sameLvStacked, then: [{ op: 's8_evolve', subject: 'this', zones: ['hand'], card: (id) => trait(id, '천사형', '성룡형', '삼대천사', 'NSp', 'VB'), delta: -2 }] }];
SCRIPTS['EX12-032::어택 시'] = [{ op: 's8_if', test: sameLvStacked, then: [{ op: 's8_evolve', subject: 'this', zones: ['trash'], card: (id) => nameHas(id, '가루몬') || trait(id, 'NSo', 'VB'), delta: -2 }] }];
SCRIPTS['EX12-036::서로의 턴'] = [{ op: 's8_noEvoTrigNoRest' }];
SCRIPTS['EX12-033::진화 시'] = [
  { op: 's8_discardUpTo', n: 3 },
  { op: 's8_dp', target: 'pickOpp', amount: (ctx) => -4000 * (S8(ctx).discarded || 0), until: 'thisTurn', prompt: 'DP를 내릴 상대의 디지몬 선택' },
];
SCRIPTS['EX12-033::메인'] = [{ op: 's8_trashOppUnder', n: 4 }, { op: 's8_bounceEmptyOpp' }];
SCRIPTS['EX12-025::등장 시'] = [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: 4, category: 'digimon' } }];
SCRIPTS['EX12-019::서로의 턴'] = [{ op: 's8_shield', target: 'this', fromCategory: 'digimon' }, { op: 's8_dp', target: 'this', amount: 4000, until: 'oppEnd' }];
SCRIPTS['EX12-018::진화 시'] = [
  { op: 's8_placeUnder', zones: ['hand', 'trash'], pred: (id) => isDigi(id) && vbOrGamma(id), n: 2, target: 'this', pos: 'choose', key: 'placed' },
  { op: 's8_if', test: (ctx) => (S8(ctx).placed || 0) > 0, then: [{ op: 's8_dp', target: 'pickOpp', amount: (ctx) => -2000 * ((stackOf(ctx) || { sources: [] }).sources.length), until: 'oppEnd', prompt: 'DP를 내릴 상대의 디지몬 선택' }] },
];
SCRIPTS['EX12-017::카운터'] = [
  { op: 's8_jogress', cardPred: (id) => C(id).nameKo === '오메가몬' || trait(id, 'ME', 'VB') },
  { op: 's8_redirect', optional: true },
];
SCRIPTS['EX12-010::등장 시'] = [{ op: 's8_trashToHand', pred: (id) => isDigi(id) && (nameHas(id, '그레이몬') || trait(id, 'ME', 'VB')), prompt: '트래시에서 패에 추가할 디지몬 카드 선택' }];
SCRIPTS['EX12-001::자신의 턴 종료 시'] = [
  { op: 's8_jogress', thisStack: true, partnerPred: () => true, cardPred: (id) => trait(id, 'VB') },
  { op: 's8_attackNow', fusedUid: true },
];

// ================================================================== keyword scripts (wildcard pseudo-tags, see state.js queueTurnEndKeywords / deleteStack)
OPS.s8_execute = async (i, ctx) => {
  const st = stackOf(ctx);
  if (!st || st.suspended || !ctx.state.players[ctx.self].battle.includes(st)) { log(ctx, `${ctx.self} 《에그제큐트》 — 어택할 수 없음`); return; }
  if (!(await confirm(ctx, `《에그제큐트》 ${C(st.cardId).nameKo}(으)로 어택할까요? (어택 종료 시 소멸)`))) return;
  st.s8ExecDelete = true;
  S.grantKeyword(ctx.state, ctx.self, st.uid, '액티브공격', undefined, 'turn');
  if (ctx.startAttack) ctx.startAttack(ctx.self, st.uid);
};
OPS.s8_tensho = async (i, ctx) => {
  const pl = ctx.state.players[ctx.self];
  const k = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (k < 0) return;
  if (!(await confirm(ctx, `《천승》 ${C(ctx.sourceCardId).nameKo}을(를) 시큐리티 위에 놓을까요?`))) return;
  pl.trash.splice(k, 1);
  S.addToSecurity(ctx.state, ctx.self, ctx.sourceCardId, 'top');
};
SCRIPTS['*::__에그제큐트'] = [{ op: 's8_execute' }];
SCRIPTS['*::__천승'] = [{ op: 's8_tensho' }];

// ================================================================== HOOKS (continuous / event / replacement abilities)
const H = (id, d) => { (HOOKS[id] ||= []).push(d); return d; };
const isOwnDigi = (st) => !!st && isDigi(st.cardId);
const idleTamer = (h) => catOf(h.cardId) === 'tamer' && !h.suspended;
const pOfHolder = (state, h) => ownerOf(state, h);
const underCanPay = (state, hp, n = 1) => tamersWithUnder(state, hp, n).length > 0;

// ---- "이/자신의 디지몬이 링크되었을 때"
H('BT25-070', { tag: '자신의 턴', has: '링크되었을 때', limit: 1, events: { linked: (st, hp, h, info) => info.stack === h } });
H('BT25-072', { tag: '서로의 턴', has: '링크되었을 때', limit: 1, events: { linked: (st, hp, h, info) => info.stack === h } });
H('BT25-075', { tag: '자신의 턴', has: '링크되었을 때', events: { linked: (st, hp, h, info) => info.owner === hp && isOwnDigi(info.stack) } });
// ---- Tamer under-card / security / hand / option events
H('BT25-087', { tag: '서로의 턴', has: '늘어났을 때', events: { handIncrease: (st, hp, h, info) => info.owner !== hp && info.cause === 'effect' && idleTamer(h) } });
H('BT25-088', { tag: '서로의 턴', has: '줄어들었을 때', events: { securityDecrease: (st, hp, h, info) => info.owner === hp && idleTamer(h) } });
H('BT26-089', { tag: '서로의 턴', has: '줄어들었을 때', events: { securityDecrease: (st, hp, h, info) => info.owner === hp && idleTamer(h) } });
H('BT25-091', { tag: '자신의 턴', has: '옵션 카드를 사용했을 때', events: { optionUsed: (st, hp, h, info) => info.owner === hp && idleTamer(h) && catOf(info.cardId) === 'option' && trait(info.cardId, 'TS') } });
H('ST23-13', { tag: '자신의 턴', has: '파기되었을 때', events: { sourcesTrashed: (st, hp, h, info) => info.stack === h && info.cause === 'effect' && idleTamer(h) } });
const underTrashedOwnTamer = (hp, info) => info.owner === hp && info.cause === 'effect' && !!info.stack && catOf(info.stack.cardId) === 'tamer';
H('BT26-094', { tag: '자신의 턴', has: '파기', events: {
  discard: (st, hp, h, info) => info.owner !== hp && idleTamer(h),
  sourcesTrashed: (st, hp, h, info) => info.stack === h && info.cause === 'effect' && idleTamer(h),
} });
H('BT26-076', { tag: '자신의 턴', has: '파기', limit: 1, events: {
  discard: (st, hp, h, info) => info.owner !== hp && isOwnDigi(h),
  sourcesTrashed: (st, hp, h, info) => underTrashedOwnTamer(hp, info) && isOwnDigi(h),
} });
H('BT26-044', { tag: '자신의 턴', has: '레스트했거나', limit: 1, events: {
  rest: (st, hp, h, info) => info.owner !== hp && !!info.stack && ['digimon', 'tamer'].includes(catOf(info.stack.cardId)) && isOwnDigi(h),
  sourcesTrashed: (st, hp, h, info) => underTrashedOwnTamer(hp, info) && isOwnDigi(h),
} });
H('BT26-091', { tag: '자신의 턴', has: '레스트했거나', events: {
  rest: (st, hp, h, info) => info.owner !== hp && !!info.stack && ['digimon', 'tamer'].includes(catOf(info.stack.cardId)) && idleTamer(h),
  sourcesTrashed: (st, hp, h, info) => info.stack === h && info.cause === 'effect' && idleTamer(h),
} });
H('EX12-045', { tag: '자신의 턴', has: '줄었을 때', limit: 1, events: { securityDecrease: (st, hp, h, info) => info.owner === hp && isOwnDigi(h) } });
H('EX12-046', { tag: '자신의 턴', has: '줄었을 때', events: { securityDecrease: (st, hp, h, info) => info.owner !== hp && isOwnDigi(h) } });
H('BT26-038', { tag: '자신의 턴', src: 'inheritedKo', has: '배틀에서 승리', limit: 1, events: { battleWin: (st, hp, h, info) => info.stack === h } });
H('BT26-035', { tag: '자신의 턴', src: 'inheritedKo', has: '배틀에서 승리', limit: 1, events: { battleWin: (st, hp, h, info) => info.stack === h } });
H('BT26-001', { tag: '자신의 턴', src: 'inheritedKo', has: '늘어났을 때', limit: 1, events: { deckIncrease: (st, hp, h, info) => info.owner === hp && info.srcPlayer === hp && isOwnDigi(h) } });
H('BT26-079', { tag: '서로의 턴', has: '등장/진화했을 때', limit: 1, events: {
  play: (st, hp, h, info) => info.owner !== hp && !!info.stack && isDigi(info.stack.cardId),
  digivolve: (st, hp, h, info) => info.owner !== hp && !!info.stack && isDigi(info.stack.cardId),
} });
H('EX12-036', { tag: '서로의 턴', has: '등장/진화했을 때', limit: 1, events: {
  play: (st, hp, h, info) => info.owner === hp && !!info.stack && isDigi(info.stack.cardId) && isOwnDigi(h),
  digivolve: (st, hp, h, info) => info.owner === hp && !!info.stack && isDigi(info.stack.cardId) && isOwnDigi(h),
} });
H('BT26-099', { tag: '서로의 턴', has: '뒷면인 카드가 놓였을 때', events: { faceDownSource: (st, hp, h, info) => info.owner === hp && catOf(h.cardId) === 'option' && st.turnNumber > h.placedTurn } });
H('BT26-053', { tag: '서로의 턴', has: '대상이 변경되었을 때', limit: 1, events: { redirect: (st, hp, h, info) => isOwnDigi(h) && underCanPay(st, hp) } });
H('EX12-019', { tag: '서로의 턴', has: '대상이 변경되었을 때', limit: 1, events: { redirect: (st, hp, h, info) => isOwnDigi(h) } });

// ---- alternative evolution / evolve-cost discounts
H('BT25-082', { tag: '서로의 턴', has: '진화 조건을 무시', evoAlt: (state, hp, h, stack) => (h === stack && ownTamers(state, hp).some(t => mentions(t.cardId, '3총사')))
  ? { cost: 4, test: (tgt) => tgt.category === 'digimon' && (tgt.types || []).includes('3총사') } : null });
const evoDiscountSimple = (id, pred, delta, extra = {}) => H(id, { tag: '자신의 턴', has: '진화할 때', ...extra, evoDiscount: (state, hp, h, stack, tgtId) => (h === stack && isDigi(tgtId) && pred(tgtId)) ? delta : 0 });
evoDiscountSimple('ST23-02', glow, -1);
evoDiscountSimple('ST24-08', saber, -1);
// with the printed cost "자신의 테이머 아래의 뒷면 카드를 아래에서부터 1장 파기하는 것으로" (confirmed, paid inside apply)
const evoOptionFd = (id, pred, delta, opts = {}) => { const d = H(id, { tag: '자신의 턴', has: '진화할 때', ...opts }); d.evoOption = (state, hp, h, stack, tgtId) => {
  if (!isDigi(tgtId) || !pred(tgtId) || !(opts.anyDigimon || h === stack) || !underCanPay(state, hp)) return null;
  if (opts.limit && turnUsesLeft(h, id, d) <= 0) return null;
  return { label: `${C(h.cardId).nameKo}: 테이머 아래의 뒷면 카드 1장을 파기하고 진화 코스트 ${delta}?`, apply: () => { if (opts.limit) hookUseOnce(h, id, d, 1); return payTamerUnderAuto(state, hp, 1, opts.anyDigimon ? h : null) ? delta : 0; } };
}; return d; };
const hookUseOnce = (h, id, d, n) => S.hookUseOnce(h, id, d, n);
const turnUsesLeft = (h, id, d) => S.turnUsesRemaining(h, S.onceLimitKey(id, [d.tag, d.has || '']), 1);
evoOptionFd('ST23-03', glow, -2);
evoOptionFd('ST23-11', glow, -2);
evoOptionFd('BT25-087', saber, -1, { anyDigimon: true, limit: 1 });
// play / use cost discounts paid by a Tamer's under-card
const playOptionFd = (id, pred, delta, opts = {}) => { const d = H(id, { tag: '자신의 턴', ...opts }); d.playDiscount = (state, hp, h, cardId) => {
  if (!pred(cardId) || !idleTamer(h) && !opts.digimonHolder || !underCanPay(state, hp)) return null;
  if (turnUsesLeft(h, id, d) <= 0 && opts.limit) return null;
  return { label: `${C(h.cardId).nameKo}: 테이머 아래의 뒷면 카드 1장을 파기하고 ${C(cardId).nameKo}의 코스트 ${delta}?`, apply: () => { if (opts.limit) hookUseOnce(h, id, d, 1); return payTamerUnderAuto(state, hp, 1, null) ? delta : 0; } };
}; return d; };
playOptionFd('BT25-088', (cid) => glow(cid) && catOf(cid) !== 'option', -1, { has: '등장할 때', limit: 1 });
playOptionFd('BT25-090', (cid) => catOf(cid) === 'option' && glow(cid), -1, { has: '사용할 때', limit: 1 });
// BT26-088 (Tamer): 특징 「반쵸」/「TS」 카드 등장 시 이 테이머를 레스트 → 코스트 -1 (자신의 디지몬이 없다면 -2)
H('BT26-088', { tag: '자신의 턴', has: '레스트시키는 것으로', playDiscount: (state, hp, h, cardId) => {
  if (!idleTamer(h) || !isDigi(cardId) || !trait(cardId, '반쵸', 'TS')) return null;
  const none = !state.players[hp].battle.some(s => isDigi(s.cardId));
  const delta = none ? -2 : -1;
  return { label: `${C(h.cardId).nameKo}을(를) 레스트시키고 ${C(cardId).nameKo}의 등장 코스트 ${delta}?`, apply: () => { S.restStack(state, hp, h.uid); return h.suspended ? delta : 0; } };
} });

// ---- "벗어날 때 …하는 것으로, 벗어나지 않는다"
const leaveHook = (id, d) => H(id, { tag: '서로의 턴', ...d });
leaveHook('BT25-101', { src: 'inheritedKo', has: '벗어나지', preventLeave: (state, hp, h, target) => {
  if (h !== target || C(target.cardId).nameKo !== '불카누스몬' || !(h.linkCards || []).length) return false;
  const lc = h.linkCards.shift(); state.players[hp].trash.push(lc.cardId); S.recomputeStackGrants(h);
  S.log(state, `${hp} 불카누스몬 링크 카드 ${C(lc.cardId).nameKo} 파기 — 벗어나지 않음`);
  return true;
} });
const saberLeave = (id, nameTerm) => { const d = leaveHook(id, { src: 'inheritedKo', has: '벗어나지' }); d.preventLeave = (state, hp, h, target) => {
  if (h !== target || !(nameHas(target.cardId, nameTerm) || saber(target.cardId)) || !underCanPay(state, hp) || turnUsesLeft(h, id, d) <= 0) return false;
  hookUseOnce(h, id, d, 1);
  if (!payTamerUnderAuto(state, hp, 1, null)) return false;
  S.log(state, `${hp} ${C(target.cardId).nameKo} 테이머 아래의 카드를 파기하여 벗어나지 않음`);
  return true;
}; };
saberLeave('ST24-06', '샤인그레이몬');
saberLeave('ST24-10', '로제몬');
leaveHook('BT26-033', { has: '벗어나지', preventLeave: (state, hp, h, target, tp) => {
  if (tp !== hp || !['digimon', 'tamer'].includes(catOf(target.cardId)) || !trait(target.cardId, 'TS') || !h.sources.length) return false;
  const id = h.sources.pop(); state.players[hp].security.push(id); S.recomputeStackGrants(h);
  S.log(state, `${hp} ${C(h.cardId).nameKo}의 겹쳐진 카드 ${C(id).nameKo}을(를) 시큐리티 아래에 놓아 ${C(target.cardId).nameKo}이(가) 벗어나지 않음`);
  return true;
} });
leaveHook('BT26-058', { has: '벗어나지', preventLeave: (state, hp, h, target, tp) => {
  if (tp !== hp || !isDigi(target.cardId) || !trait(target.cardId, 'CS') || !h.sources.length) return false;
  const id = h.sources.pop(); h.sources.unshift(id); S.recomputeStackGrants(h);
  S.log(state, `${hp} ${C(h.cardId).nameKo}의 겹쳐진 카드 1장을 진화원 아래에 놓아 ${C(target.cardId).nameKo}이(가) 벗어나지 않음`);
  return true;
} });

// ---- attack-target changes by the defender (paid): BT26-003 / BT26-092
H('BT26-003', { tag: '상대의 턴', src: 'inheritedKo', has: '어택의 대상을', redirectOptions: (state, hp, h, atkP, aStack) => {
  if (!underCanPay(state, hp) || turnUsesLeft(h, 'BT26-003', HOOKS['BT26-003'][0]) <= 0) return [];
  const d = HOOKS['BT26-003'][0];
  return state.players[hp].battle.filter(s => isDigi(s.cardId) && glow(s.cardId)).map(s => ({
    targetUid: s.uid, limit: null, label: `${C(s.cardId).nameKo}(으)로 어택 대상 변경 (테이머 아래의 카드 1장 파기)`,
    pay: async () => { if (!S.hookUseOnce(h, 'BT26-003', d, 1)) return false; return payTamerUnderAuto(state, hp, 1, null); },
  }));
} });
H('BT26-092', { tag: '상대의 턴', has: '어택의 대상을', redirectOptions: (state, hp, h, atkP, aStack) => {
  const tamers = ownTamers(state, hp).filter(t => trait(t.cardId, 'TS'));
  if (!tamers.length) return [];
  return state.players[hp].battle.filter(s => isDigi(s.cardId) && trait(s.cardId, 'TS')).map(s => ({
    targetUid: s.uid, limit: null, label: `${C(s.cardId).nameKo}(으)로 어택 대상 변경 (특징 「TS」 테이머 1명을 덱 아래로)`,
    pay: async (choose) => {
      const list = ownTamers(state, hp).filter(t => trait(t.cardId, 'TS'));
      if (!list.length) return false;
      const uid = list.length === 1 ? list[0].uid : await choose('pickStack', { player: hp, uids: list.map(t => t.uid), prompt: '덱 아래로 되돌릴 특징 「TS」 테이머 선택' });
      const t = uid && findStack(state, hp, uid);
      return !!t && !!detachStack(state, hp, t, 'deckBottom');
    },
  }));
} });
// ---- EX12-072: 특징 「ME」를 가진 자신의 디지몬 전부는 《수호》를 얻는다 (continuous, 서로의 턴)
H('EX12-072', { tag: '서로의 턴', has: '《수호》를 얻는다', grantKw: (state, hp, h, target) => (!!target && isDigi(target.cardId) && trait(target.cardId, 'ME') && ownerOf(state, target) === hp) ? ['수호'] : [] });
// ---- EX12-004: 특징 「TB」를 가진 이 디지몬은 《에그제큐트》를 얻는다
H('EX12-004', { tag: '자신의 턴', src: 'inheritedKo', has: '에그제큐트', grantKw: (state, hp, h, target) => (target === h && trait(h.cardId, 'TB')) ? ['에그제큐트'] : [] });
// ---- EX12-003: ME digimon leaving (not by own effect) → optional jogress instead; declining lets it leave (deferred via a pending effect)
const EX12_003 = H('EX12-003', { tag: '서로의 턴', src: 'inheritedKo', has: '조그레스 진화할 수 있다', preventLeave: (state, hp, h, target, tp, cause) => {
  if (state._s8NoSurvive || tp !== hp || cause === 'ownEffect' || !isDigi(target.cardId) || !trait(target.cardId, 'ME')) return false;
  const pl = state.players[hp];
  const others = pl.battle.filter(s => s !== target && isDigi(s.cardId));
  const can = others.some(b => pl.hand.some(id => isDigi(id) && trait(id, 'ME') && (C(id).effectKo || '').includes('〔조그레스〕') && S.canJogress(target, b, id).ok));
  if (!can) return false;
  S.queueHookSegment(state, hp, h, 'EX12-003', EX12_003, { kind: 'leave', stackUid: target.uid, cause });
  return true;
} });
OPS.s8_jogressOrLeave = async (i, ctx) => {
  const { state } = ctx;
  const ev0 = evtOf(ctx) || {};
  const a = findStack(state, ctx.self, ev0.stackUid);
  if (!a) return;
  S8(ctx).fused = null;
  const pl = state.players[ctx.self];
  const partners = pl.battle.filter(s => s !== a && isDigi(s.cardId));
  const legalFor = (b) => pl.hand.map((id, k) => k).filter(k => isDigi(pl.hand[k]) && trait(pl.hand[k], 'ME') && (C(pl.hand[k]).effectKo || '').includes('〔조그레스〕') && S.canJogress(a, b, pl.hand[k]).ok);
  const bUid = await pickOne(ctx, ctx.self, partners.filter(b => legalFor(b).length).map(b => b.uid), `${C(a.cardId).nameKo}과(와) 조그레스 진화할 다른 디지몬 선택 (취소하면 벗어남)`);
  const b = bUid && findStack(state, ctx.self, bUid);
  let done = false;
  if (b) {
    const k = await pickZone(ctx, 'hand', legalFor(b), '조그레스 진화할 패의 특징 「ME」 디지몬 카드 선택');
    if (k != null) { const id = pl.hand[k]; const j = S.parseJogress(id); done = !!S.fuseStacks(state, ctx.self, a.uid, b.uid, id, j ? j.cost : 0, 'hand'); }
  }
  if (!done && findStack(state, ctx.self, a.uid)) { state._s8NoSurvive = true; try { S.deleteStack(state, ctx.self, a.uid, 'trash', ev0.cause || 'effect'); } finally { state._s8NoSurvive = false; } }
};
SCRIPTS['EX12-003::서로의 턴'] = [{ op: 's8_jogressOrLeave' }];
