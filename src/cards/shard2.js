// Shard 2 — bespoke card scripts + continuous-ability hooks (ST13-13 … BT14-028).
//
//   SCRIPTS : { 'CARD-ID::firstTag': [ops...] }   triggered / activated effects
//   OPS     : custom `s2_*` interpreter ops those scripts use
//   hooks   : plain exported functions called from state.js / main.js at the exact engine moment a
//             continuous ability matters (destroy guards, cost discounts, DigiXros extras, DP bonuses,
//             redirect options, granted effects, …). Continuous abilities are registered in CONT below
//             (keyed by cardId + text source + tag) so the coverage audit can tell they are implemented.
//
// NOTE: this module must NOT import effects.js (index.js is evaluated while effects.js loads).
import * as S from '../state.js';

// ───────────────────────── small helpers ─────────────────────────
const C = (id) => S.card(id);
const oppOf = (p) => (p === 'p1' ? 'p2' : 'p1');
const stackByUid = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const digimonStacks = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon' || s.s2AsDigimon);
const tamerStacks = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const hasTrait = (c, t) => (c.types || []).includes(t);
const hasTraitIncl = (c, t) => (c.types || []).some(x => x.includes(t));
const colorsOf = (st) => S.stackColors(st);
const hasColor = (st, col) => colorsOf(st).includes(col);
const hasSave = (c) => `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes('《세이브');
const isX = (c) => hasTrait(c, 'X항체') || (c.nameKo || '').includes('X항체');
const isXros = (id) => !!S.parseDigiXros(id);
const effMemory = (state, p) => (p === 'p1' ? state.memory : -state.memory);
const tagActive = (state, hp, tag) => (tag === '자신의 턴' ? state.activePlayer === hp : tag === '상대의 턴' ? state.activePlayer !== hp : true);
// "상대의 턴 종료까지" as a last-turn-number-that-still-counts (turnNumber increments once per player-turn).
const untilOppTurnEnd = (state, self) => (state.activePlayer === self ? state.turnNumber + 1 : state.turnNumber);
const causeFor = (ctx, targetP) => (targetP === ctx.self ? 'ownEffect' : 'effect');

// 〈룰〉 명칭 aliases ("「X」로도 취급한다" / "「X」를 포함하는 것으로도 취급한다").
function aliasInfo(c) { return S.cardNameInfo(c.id); } // central parser (state.js cardNameInfo)
const nameIs = (c, n) => aliasInfo(c).exact.includes(n);
const nameHas = (c, n) => { const a = aliasInfo(c); return (c.nameKo || '').includes(n) || a.exact.some(x => x.includes(n)) || a.incl.some(x => x.includes(n)); };

// asks the acting player something optional; headless (no window) always says yes
function askUser(msg) { return S.replAsk(msg, true); } // replacement prompts are asked by state.js's resumable gate (deleteStack); no blocking dialog here
async function confirmCtx(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
// pick from a list of ids using the generic reveal-picker; returns indexes
async function pickCards(ctx, player, ids, { eligible, min = 0, max = 1, prompt }) {
  const elig = (eligible || ids.map((_, i) => i)).map(i => ({ id: ids[i], i }));
  if (!elig.length) return [];
  const res = await ctx.choose('pickFromRevealed', { player, revealed: ids, eligible: elig, min, max, prompt });
  return (res || []).filter(i => elig.some(e => e.i === i)).slice(0, max);
}
async function chooseNumber(ctx, prompt, max) {
  if (max <= 0) return 0;
  const r = await ctx.choose('multipleChoice', { prompt, options: Array.from({ length: max + 1 }, (_, i) => `${i}장`) });
  return r == null ? 0 : r;
}
async function pickStackOf(ctx, player, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
const scratch = (ctx) => (ctx.s2 = ctx.s2 || {});

// a Digimon may declare an attack right now (mirror of S.declareAttack's checks)
function canDeclare(state, p, st) {
  if (!st || st.suspended || C(st.cardId).category !== 'digimon') return false;
  if (state.turnNumber < st.attackEligibleTurn && !S.hasKeyword(st, '속공')) return false;
  if (st.cannotAttackUntil === 'permanent' || (typeof st.cannotAttackUntil === 'number' && state.turnNumber <= st.cannotAttackUntil)) return false;
  return true;
}

// removes a stack from the battle area (sources → trash, link cards → trash) and places its top card `dest`.
// dest: 'hand' | 'deckBottom' | 'deckTop' | 'securityTop' | 'securityBottom' | 'trash'
function leaveArea(state, stack, p, dest, cause) {
  const pl = state.players[p];
  const idx = pl.battle.indexOf(stack);
  if (idx === -1) return false;
  pl.battle.splice(idx, 1);
  const linkIds = (stack.linkCards || []).map(l => l.cardId);
  const top = stack.cardId;
  const isTok = S.isTokenId(top);
  if (!isTok) {
    if (dest === 'hand') pl.hand.push(top);
    else if (dest === 'deckBottom') pl.deck.push(top);
    else if (dest === 'deckTop') pl.deck.unshift(top);
    else if (dest === 'securityTop') pl.security.unshift(top);
    else if (dest === 'securityBottom') pl.security.push(top);
    else pl.trash.push(top);
  }
  pl.trash.push(...stack.sources.filter(id => !C(id).isToken), ...linkIds);
  S.log(state, `${p} ${C(top).nameKo} 배틀 에어리어를 벗어남 (${dest}), 진화원 ${stack.sources.length}장 파기`);
  S.applyOverflowBatch(state, p, [...stack.sources, top]);
  S.hookLeaveTriggers(state, p, stack, cause);
  return true;
}

// moves stack `mv` (top card + its sources) under `target`'s sources (bottom) or under a tamer
function moveStackUnder(state, p, mv, target) {
  const pl = state.players[p];
  const idx = pl.battle.indexOf(mv);
  if (idx === -1 || !target || target === mv) return false;
  pl.battle.splice(idx, 1);
  const linkIds = (mv.linkCards || []).map(l => l.cardId);
  pl.trash.push(...linkIds);
  const cards = [...mv.sources, mv.cardId].filter(id => !C(id).isToken);
  target.sources.unshift(...cards);
  S.recomputeStackGrants(target);
  S.log(state, `${p} ${C(mv.cardId).nameKo}을(를) ${C(target.cardId).nameKo}의 아래에 놓음`);
  return true;
}

// ───────────────────────── data fixes ─────────────────────────
export function fixData(CARDS) {
  // BT11-016: a stray line break made "…이 디지몬의 / 【소멸 시】 효과 1개를…" look like a second 【소멸 시】 trigger.
  const c16 = CARDS['BT11-016'];
  if (c16 && c16.effectKo) c16.effectKo = c16.effectKo.replace('이 디지몬의\n【소멸 시】 효과 1개를', '이 디지몬의 【소멸 시】 효과 1개를');
  // pseudo "cards" used as effect sources / tokens
  const mk = (o) => { CARDS[o.id] = { cardId: o.id, level: null, cost: 0, evoNormal: null, inheritedKo: '', imgUrl: '', ...o }; };
  mk({ id: 'S2-GRANT', nameKo: '부여된 효과', category: 'effect', colors: [], types: [], effectKo: '' });
  mk({ id: 'S2-TOKEN-AMON', nameKo: '홍염의 아몬', category: 'digimon', colors: ['red'], types: [], dp: 6000, effectKo: '《속공》', isToken: true });
  mk({ id: 'S2-TOKEN-UMON', nameKo: '창뢰의 우몬', category: 'digimon', colors: ['yellow'], types: [], dp: 6000, effectKo: '《블로커》', isToken: true });
}

// ───────────────────────── engine-facing helpers (state.js calls these) ─────────────────────────
const FULL_INHERIT = { 'BT12-072': ['파워드라몬', '카오스드라몬'] };
// "이 디지몬은 이 디지몬의 진화원에 있는 「A」와 「B」의 효과 전부를 얻는다."
export function fullInherit(stack, srcId) {
  const names = FULL_INHERIT[stack.cardId];
  return !!names && names.includes(C(srcId).nameKo);
}
// BT13-007: while it sits in the breeding area on its owner's turn, no own Digimon may evolve
export function evolveBan(state, p, stack) {
  if (stack.s2NoEvolve) return true;
  const r = state.players[p].raising;
  return !!(r && r.cardId === 'BT13-007' && state.activePlayer === p);
}
// BT14-018: evolving away destroys its tokens (+ 《리커버리 +1》)
export function beforeDigivolve(state, p, stack) {
  if (stack && stack.cardId === 'BT14-018' && tokenCleanup(state, p)) S.recoverTopOfDeckToSecurity(state, p);
}
// BT10-084: "효과로 자신의 다른 디지몬의 진화원을 파기할 때, 대신 이 디지몬의 진화원을 파기할 수 있다." → returns the stack to trash from instead
export function sourceTrashRedirect(state, p, stack) {
  if (!state._fxSrc || state.activePlayer === p) return null;
  for (const h of state.players[p].battle) {
    if (h === stack || h.cardId !== 'BT10-084' || h.sources.length < 1) continue;
    if (askUser(`${C(h.cardId).nameKo}: ${C(stack.cardId).nameKo} 대신 이 디지몬의 진화원을 파기할까요?`)) return h;
  }
  return null;
}
export function xrosSub(state, p, stack) {
  return !!(state.players[p].xrosSubs || []).find(x => x.uid === stack.uid && state.turnNumber <= x.until);
}
// granted effects ("…의 효과를 얻는다"): stack.s2Granted = [{ trigger, label, until }]; queued at the matching engine event
export function grantEffect(state, stack, { trigger, label, until }) {
  (stack.s2Granted = stack.s2Granted || []).push({ trigger, label, until, fxSrc: state._fxSrc ? { player: state._fxSrc.player, category: state._fxSrc.category, alsoDigimon: state._fxSrc.alsoDigimon } : null }); // r2 (Q5329): remember the granter; an immune holder does not trigger
  S.log(state, `${C(stack.cardId).nameKo}에게 효과 부여: ${label}`);
}
let pendSeq = 1;
export function queueGranted(state, p, stack, eventKind) {
  if (!stack) return;
  for (const g of (state.s3LateGrants || [])) { // QA-S3 Q3256: "전부에게" grants also cover Digimon that entered after the grant
    if (g.owner !== p || g.trigger !== eventKind || state.turnNumber > g.until || g.given.includes(stack.uid) || C(stack.cardId).category !== 'digimon') continue;
    state.pending.push({ uid: 's2g' + (pendSeq++), player: p, cardId: 'S2-GRANT', stackUid: stack.uid, tags: ['부여:' + g.label], text: g.label, resolved: false, watcher: true });
  }
  if (!stack.s2Granted) return;
  for (const g of stack.s2Granted) {
    if (g.trigger !== eventKind || state.turnNumber > g.until) continue;
    if (g.fxSrc && (() => { const prev = state._fxSrc; state._fxSrc = g.fxSrc; try { return S.effectBlocked(state, p, stack, 'other'); } finally { state._fxSrc = prev; } })()) continue; // r2 (Q5329)
    state.pending.push({ uid: 's2g' + (pendSeq++), player: p, cardId: g.cardId || 'S2-GRANT', stackUid: stack.uid, tags: ['부여:' + g.label], text: g.label, resolved: false, watcher: true });
  }
}
// BT12-112 / EX3-073: opponent 【시큐리티】 effects suppressed for this attacker's checks
export function securitySuppressed(state, attackerP, defenderP, cardId) {
  const off = state.s2SecOff;
  if (off && state.turnNumber <= off.until && off.player === attackerP) return true;
  if (state.activePlayer === attackerP && C(cardId).category === 'option') {
    return state.players[attackerP].battle.some(s => s.cardId === 'BT12-112');
  }
  return false;
}

// ───────────────────────── shared op machinery ─────────────────────────
export const CONTAINER_OPS = new Set(['s2_costSource', 's2_if', 's2_oppMayDiscard']);
export const OPS = {};

// cards from several of the player's zones as one picker list
async function pickFromZones(ctx, player, zones, pred, { max = 1, min = 0, prompt }) {
  const pl = ctx.state.players[player];
  const entries = [];
  for (const z of zones) pl[z].forEach((id, idx) => { if (pred(C(id), id, z)) entries.push({ zone: z, idx, id }); });
  if (!entries.length) return [];
  const ids = entries.map(e => e.id);
  const picked = await pickCards(ctx, player, ids, { min, max, prompt: `${prompt || '카드 선택'} (${zones.map(z => ({ hand: '패', trash: '트래시' }[z] || z)).join('/')})` });
  return picked.map(i => entries[i]);
}
function takeEntries(state, player, entries) {
  const pl = state.players[player];
  const byZone = {};
  for (const e of entries) (byZone[e.zone] = byZone[e.zone] || []).push(e.idx);
  const ids = [];
  for (const [z, idxs] of Object.entries(byZone)) for (const i of idxs.sort((a, b) => b - a)) ids.unshift(...pl[z].splice(i, 1));
  return ids;
}
const thisStackOf = (ctx) => stackByUid(ctx.state, ctx.self, ctx.sourceStackUid);

// bounces `stack` (owner p) honoring guards; returns whether it left
function bounceStack(ctx, p, stack, dest) {
  const cause = causeFor(ctx, p);
  if (S.effectBlocked(ctx.state, p, stack, 'bounce') || S.leaveGate(ctx.state, p, stack, cause, 'bounce', () => bounceStack(ctx, p, stack, dest))) return false;
  return leaveArea(ctx.state, stack, p, dest, cause);
}
function destroyStack(ctx, p, stack) {
  S.deleteStack(ctx.state, p, stack.uid, 'trash', causeFor(ctx, p));
}

// runs the 【tag】 effect(s) of another card as part of this effect's resolution
async function runCardSegments(ctx, helpers, cardId, tagSub, { asCardId, asStackUid, choose = true, src = 'effectKo' } = {}) {
  const c = C(cardId);
  const segs = S.parseEffectSegments(c[src] || '').segments.filter(s => s.tags.some(t => t.includes(tagSub)) && !/^[≪《]\s*딜레이/.test(s.body.trim()));
  if (!segs.length) return false;
  let seg = segs[0];
  if (choose && segs.length > 1) {
    const i = await ctx.choose('multipleChoice', { prompt: '발휘할 효과 선택', options: segs.map(s => s.body.slice(0, 60)) });
    seg = segs[i ?? 0] || segs[0];
  }
  let script = helpers.lookupCardSpecific ? helpers.lookupCardSpecific(cardId, seg.tags) : null;
  if (!script && helpers.compileToScript) script = helpers.compileToScript(seg.body);
  const ctx2 = { ...ctx, s2: {}, sourceCardId: asCardId || cardId, sourceStackUid: asStackUid !== undefined ? asStackUid : ctx.sourceStackUid };
  if (script && script.length) await helpers.runScript(script, ctx2);
  else ctx.state.pending.push({ uid: 's2m' + (pendSeq++), player: ctx.self, cardId, stackUid: null, tags: seg.tags, text: seg.body, resolved: false, manualOnly: true, note: '자동 처리되지 않은 효과 — 직접 처리하세요' });
  return true;
}

// ───────────────────────── option cards (BT10-039/041, EX4-030) ─────────────────────────
OPS.s2_useOption = async (instr, ctx, helpers) => {
  const { state } = ctx; const pl = state.players[ctx.self];
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'option' && instr.pred(C(pl.hand[i])));
  if (!idxs.length) { S.log(state, `${ctx.self} 사용할 수 있는 옵션 카드가 패에 없음`); return; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: instr.prompt || '코스트를 지불하지 않고 사용할 옵션 카드 선택' });
  if (idx == null) return;
  const [id] = pl.hand.splice(idx, 1);
  pl.trash.push(id); // provisional (like useOptionCard); the effect may relocate it
  S.log(state, `${ctx.self} ${C(id).nameKo} 사용 (효과: 코스트 없이)`);
  S.emitGameEvent(state, 'optionUsed', { owner: ctx.self, stack: null, cardId: id, cause: 'effect' });
  await runCardSegments(ctx, helpers, id, '메인', { asCardId: id, asStackUid: null, choose: false });
  if (instr.toSecurity) {
    const ti = pl.trash.lastIndexOf(id);
    if (ti !== -1) { pl.trash.splice(ti, 1); pl.security.unshift(id); S.log(state, `${ctx.self} ${C(id).nameKo}을(를) 시큐리티 위에 뒷면으로 놓음`); }
  }
};

// ───────────────────────── evolution effects ─────────────────────────
function evoInfo(ctx, stack, cardId, instr) {
  const { state } = ctx; const tgt = C(cardId);
  if (tgt.category !== 'digimon') return null;
  const who = instr.who || ctx.self;
  const restr = S.evolveTargetRestriction(state, who, stack);
  if (restr && restr.cannotEvolve) return null;
  const chk = ctx.E.canEvolveAny(stack.cardId, cardId, S.evoExtraArg(ctx.state, null, stack), restr);
  const printed = chk.ok ? chk.cost : (tgt.evoNormal?.cost ?? 0);
  if (!chk.ok) {
    if (/진화 제한/.test(chk.reason || '')) return null; // "…으로만 진화할 수 있다" still applies
    if (!instr.ignoreCond) {
      if (!instr.ignoreLevel) return null;
      const cols = tgt.evoNormal?.colors || [];
      if (cols.length && cols.length < 7 && !cols.some(c => colorsOf(stack).includes(c))) return null;
    }
  }
  const cm = instr.cost || { mode: 'normal' };
  const cost = cm.mode === 'free' ? 0 : cm.mode === 'fixed' ? cm.n : cm.mode === 'discount' ? Math.max(0, printed - cm.n) : printed;
  return { cost };
}
// generic "evolve X into card Y (from hand/trash/under a tamer)".
OPS.s2_evolve = async (instr, ctx) => {
  const { state } = ctx; const who = instr.who || ctx.self; const pl = state.players[who];
  if (instr.need && !instr.need(ctx)) return;
  if (!ctx.E || !ctx.E.canEvolveAny) return;
  const zone = instr.zone || 'hand';
  const src = () => {
    if (zone === 'tamerUnder') return tamerStacks(state, who).flatMap(t => t.sources.map((id, i) => ({ id, tamerUid: t.uid, i })));
    return pl[zone].map((id, i) => ({ id, i }));
  };
  const fixed = instr.fixedFn ? instr.fixedFn(ctx) : instr.fixedCardId;
  const cardsFor = (st) => src().filter(e => (!fixed || e.id === fixed) && (!instr.cardPred || instr.cardPred(C(e.id), st, e)) && evoInfo(ctx, st, e.id, instr));
  let stacks;
  if (instr.subject?.self) stacks = [thisStackOf(ctx) || (pl.raising?.uid === ctx.sourceStackUid ? pl.raising : null)].filter(Boolean);
  else stacks = (instr.subject?.tamer ? tamerStacks(state, who) : digimonStacks(state, who)).filter(s => (!instr.subject?.other || s.uid !== ctx.sourceStackUid) && (!instr.subject?.pred || instr.subject.pred(s, ctx)));
  stacks = stacks.filter(s => cardsFor(s).length);
  if (!stacks.length) { S.log(state, `${who} 진화시킬 수 있는 조합이 없음`); return; }
  let st = stacks[0];
  if (!(instr.subject?.self) && stacks.length > 1) st = await pickStackOf(ctx, who, stacks, instr.pickPrompt || '진화시킬 디지몬 선택');
  if (!st) return;
  const cand = cardsFor(st);
  let entry = cand[0];
  if (cand.length > 1) {
    const idxs = await pickCards(ctx, who, cand.map(e => e.id), { max: 1, prompt: instr.cardPrompt || '진화할 카드 선택 (선택 안 함 = 진화하지 않음)' });
    if (!idxs.length) return;
    entry = cand[idxs[0]];
  } else if (!instr.mandatory && !(await confirmCtx(ctx, `${C(st.cardId).nameKo} → ${C(entry.id).nameKo} 진화시킬까요?`))) return;
  const info = evoInfo(ctx, st, entry.id, instr);
  if (!info) return;
  let source = 'hand';
  if (zone === 'trash') { pl.trash.splice(entry.i, 1); source = 'trash'; }
  else if (zone === 'tamerUnder') { const t = stackByUid(state, who, entry.tamerUid); t.sources.splice(entry.i, 1); source = 'free'; }
  S.digivolve(state, who, st.uid, entry.id, info.cost, source);
  if (instr.after) instr.after(ctx, st);
};

// ───────────────────────── placing cards under stacks ─────────────────────────
// places up to `max` cards (from hand/trash) under a target's sources (bottom).
OPS.s2_placeUnder = async (instr, ctx) => {
  const { state } = ctx; const who = ctx.self;
  let target = null;
  if (instr.target === 'pickDigimon') target = await pickStackOf(ctx, who, digimonStacks(state, who), instr.targetPrompt || '카드를 아래에 놓을 디지몬 선택');
  else if (instr.target === 'pickTamer') target = await pickStackOf(ctx, who, tamerStacks(state, who), '카드를 아래에 놓을 테이머 선택');
  else if (instr.target?.raisingName) { const r = state.players[who].raising; target = r && C(r.cardId).nameKo === instr.target.raisingName ? r : null; }
  else if (instr.target?.eitherDigimonOrTamer) target = await pickStackOf(ctx, who, [...digimonStacks(state, who), ...tamerStacks(state, who)], '카드를 아래에 놓을 디지몬/테이머 선택');
  else target = thisStackOf(ctx) || (state.players[who].raising?.uid === ctx.sourceStackUid ? state.players[who].raising : null);
  scratch(ctx).placed = 0;
  if (!target) { S.log(state, `${who} 카드를 놓을 대상이 없음`); return; }
  let entries = await pickFromZones(ctx, who, instr.zones, (c, id, z) => instr.pred(c, id, z, target), { max: instr.max || 1, min: instr.min || 0, prompt: instr.prompt });
  if (instr.distinctId) entries = entries.filter((e, i) => entries.findIndex(x => x.id === e.id) === i);
  if (!entries.length) return;
  const ids = takeEntries(state, who, entries);
  if (instr.top) target.sources.push(...ids); else target.sources.unshift(...ids);
  S.recomputeStackGrants(target);
  scratch(ctx).placed = ids.length;
  scratch(ctx).placedIds = ids;
  S.log(state, `${who} ${ids.map(id => C(id).nameKo).join(', ')}을(를) ${C(target.cardId).nameKo}의 아래에 놓음`);
  if (C(target.cardId).category === 'tamer') S.emitGameEvent(state, 'underTamer', { owner: who, stack: target, cards: ids, cause: 'effect' });
};
// cost: return/trash source cards of this digimon (or `stackUid`), then run `then`
OPS.s2_costSource = async (instr, ctx, helpers) => {
  const { state } = ctx; const who = ctx.self;
  const st = thisStackOf(ctx);
  if (!st) return;
  const idxs = st.sources.map((id, i) => i).filter(i => instr.pred(C(st.sources[i]), st.sources[i], st));
  const n = instr.n || 1;
  if (idxs.length < n) { S.log(state, `${who} 비용으로 지불할 진화원이 부족해 효과를 건너뜀`); return; }
  let chosen = idxs.slice(-n);
  if (idxs.length > n) {
    const picked = await pickCards(ctx, who, st.sources, { eligible: idxs, min: n, max: n, prompt: instr.prompt || '비용으로 지불할 진화원 선택' });
    if (picked.length < n) return;
    chosen = picked;
  } else if (instr.optional && !(await confirmCtx(ctx, instr.confirm || '진화원을 지불하고 효과를 발휘할까요?'))) return;
  let ids = chosen.slice().sort((a, b) => b - a).flatMap(i => st.sources.splice(i, 1));
  const dest = instr.dest || 'trash';
  if (dest === 'deckBottom') ids = await S.orderPlacement(ctx.choose, who, ids, '덱 아래로 되돌릴 진화원의 순서를 정하세요 (위쪽부터, 룰 3-1-3-4)');
  const pl = state.players[who];
  if (dest === 'deckBottom') pl.deck.push(...ids); else if (dest === 'trash') pl.trash.push(...ids);
  S.recomputeStackGrants(st);
  S.log(state, `${who} ${C(st.cardId).nameKo}의 진화원 ${ids.map(id => C(id).nameKo).join(', ')} → ${dest === 'deckBottom' ? '덱 아래' : '트래시'}`);
  scratch(ctx).costIds = ids;
  await helpers.runScript(instr.then || [], ctx);
};
OPS.s2_if = async (instr, ctx, helpers) => {
  await helpers.runScript(instr.test(ctx) ? (instr.then || []) : (instr.else || []), ctx);
};

// discard up to N chosen hand cards; remembers them in ctx.s2.discarded
OPS.s2_discardUpTo = async (instr, ctx) => {
  const { state } = ctx; const who = instr.who || ctx.self; const pl = state.players[who];
  const elig = pl.hand.map((id, i) => i).filter(i => !instr.pred || instr.pred(C(pl.hand[i])));
  const n = await chooseNumber(ctx, instr.prompt || `파기할 패 매수 (최대 ${instr.max}장)`, Math.min(instr.max, elig.length));
  const ids = [];
  if (n > 0) {
    const picked = await ctx.choose('pickFromHandIndexes', { player: who, eligibleIdxs: elig, n, prompt: `파기할 패 ${n}장 선택` });
    for (const i of (picked || []).slice().sort((a, b) => b - a)) { const id = S.trashFromHand(state, who, i); if (id) ids.unshift(id); }
  }
  scratch(ctx).discarded = ids;
};
// trash up to N cards from the top of own deck (BT10-081)
OPS.s2_trashDeckUpTo = async (instr, ctx) => {
  const n = await chooseNumber(ctx, `덱 위에서 파기할 매수 (최대 ${instr.max}장)`, Math.min(instr.max, ctx.state.players[ctx.self].deck.length));
  if (n > 0) S.trashTopOfDeck(ctx.state, ctx.self, n);
};

// ───────────────────────── destroy helpers ─────────────────────────
OPS.s2_destroySumDP = async (instr, ctx) => {
  const { state } = ctx; const opp = ctx.opp;
  let left = instr.limit(ctx) + S.dpDestroyCapBoost(state, ctx.self, ctx.sourceStackUid);
  const chosen = [];
  for (;;) {
    const opts = digimonStacks(state, opp).filter(st => !chosen.includes(st) && S.effectiveDP(state, opp, st) <= left);
    if (!opts.length) break;
    const st = await pickStackOf(ctx, opp, opts, `소멸시킬 디지몬 선택 (남은 DP 합계 ${left})`);
    if (!st) break;
    chosen.push(st); left -= S.effectiveDP(state, opp, st);
  }
  for (const st of chosen) destroyStack(ctx, opp, st);
};
// BT11-107: destroy opponent Digimon AND Tamers whose play-cost total stays ≤ a chosen own Digimon's play cost
OPS.s2_destroySumCost = async (instr, ctx) => {
  const { state } = ctx; const opp = ctx.opp;
  const mine = digimonStacks(state, ctx.self).filter(s => instr.pred(C(s.cardId)));
  const own = await pickStackOf(ctx, ctx.self, mine, '기준이 될 자신의 디지몬 선택 (등장 코스트)');
  if (!own) return;
  let left = C(own.cardId).cost || 0;
  const chosen = [];
  for (;;) {
    const opts = state.players[opp].battle.filter(st => ['digimon', 'tamer'].includes(C(st.cardId).category) && !chosen.includes(st) && (C(st.cardId).cost || 0) <= left);
    if (!opts.length) break;
    const st = await pickStackOf(ctx, opp, opts, `소멸시킬 디지몬/테이머 선택 (남은 등장 코스트 합계 ${left})`);
    if (!st) break;
    chosen.push(st); left -= (C(st.cardId).cost || 0);
  }
  for (const st of chosen) destroyStack(ctx, opp, st);
};
// BT12-108: destroy chosen own Machine/Cyborg + an opponent Digimon with DP ≤ its DP
OPS.s2_destroyPair = async (instr, ctx) => {
  const { state } = ctx;
  const mine = digimonStacks(state, ctx.self).filter(s => instr.pred(C(s.cardId)));
  const own = await pickStackOf(ctx, ctx.self, mine, '선택할 자신의 디지몬 (머신형/사이보그형)');
  if (!own) return;
  const dp = S.effectiveDP(state, ctx.self, own);
  const target = await pickStackOf(ctx, ctx.opp, digimonStacks(state, ctx.opp).filter(s => S.effectiveDP(state, ctx.opp, s) <= dp), `DP ${dp} 이하의 상대 디지몬 선택`);
  if (target) destroyStack(ctx, ctx.opp, target);
  destroyStack(ctx, ctx.self, own);
};
// EX4-069: keep the highest-play-cost Digimon of each side (one each), destroy every other Digimon
OPS.s2_destroyOthers = async (instr, ctx) => {
  const { state } = ctx;
  const keep = [];
  for (const p of [ctx.self, ctx.opp]) {
    const ds = digimonStacks(state, p);
    if (!ds.length) continue;
    const max = Math.max(...ds.map(s => C(s.cardId).cost || 0));
    const top = ds.filter(s => (C(s.cardId).cost || 0) === max);
    const k = top.length === 1 ? top[0] : await pickStackOf(ctx, ctx.self, top, `${p}: 가장 등장 코스트가 높은 디지몬 1마리 선택 (남길 디지몬)`);
    if (k) keep.push(k);
  }
  for (const p of [ctx.self, ctx.opp]) for (const st of digimonStacks(state, p).filter(s => !keep.includes(s))) destroyStack(ctx, p, st);
};
// BT14-027 : send every Lv.N Digimon (both sides) to its owner's hand
OPS.s2_bounceLevelAll = async (instr, ctx) => {
  const { state } = ctx;
  for (const p of [ctx.self, ctx.opp]) for (const st of digimonStacks(state, p).filter(s => C(s.cardId).level === instr.level)) bounceStack(ctx, p, st, 'hand');
};
// BT10-086: every highest-Lv opponent Digimon → deck bottom in the chosen order
OPS.s2_bounceHighestLv = async (instr, ctx) => {
  const { state } = ctx; const opp = ctx.opp;
  const ds = digimonStacks(state, opp);
  if (!ds.length) return;
  const max = Math.max(...ds.map(s => C(s.cardId).level || 0));
  let group = ds.filter(s => (C(s.cardId).level || 0) === max);
  while (group.length) {
    const st = group.length === 1 ? group[0] : await pickStackOf(ctx, ctx.self, group, '덱 아래로 되돌릴 순서대로 선택 (먼저 고른 카드가 더 위)');
    if (!st) { group.forEach(g => bounceStack(ctx, opp, g, 'deckBottom')); break; }
    bounceStack(ctx, opp, st, 'deckBottom');
    group = group.filter(g => g !== st);
  }
};
// BT12-112: an opponent Digimon's sources AND the Digimon go to the deck bottom
OPS.s2_bounceWithSources = async (instr, ctx) => {
  const { state } = ctx; const opp = ctx.opp;
  const st = await pickStackOf(ctx, opp, digimonStacks(state, opp), '덱 아래로 되돌릴 상대 디지몬 선택');
  if (!st) return;
  const cause = causeFor(ctx, opp);
  const doLeave = async () => {
    if (!state.players[opp].battle.includes(st)) return;
    if (S.effectBlocked(state, opp, st, 'bounce') || S.leaveGate(state, opp, st, cause, 'bounce', doLeave)) return;
    const pl = state.players[opp];
    pl.deck.push(...await S.orderPlacement(ctx.choose, ctx.self, st.sources.filter(id => !C(id).isToken), '덱 아래로 되돌릴 진화원의 순서를 정하세요 (위쪽부터, 룰 3-1-3-4)'));
    st.sources = [];
    S.recomputeStackGrants(st);
    leaveArea(state, st, opp, 'deckBottom', cause);
  };
  await doLeave();
};
// DP-per-count debuffs (EX4-031, BT12-043): amount * count(ctx) on one Digimon (+ optionally all security Digimon)
OPS.s2_dpPerCount = async (instr, ctx) => {
  const { state } = ctx;
  const n = instr.count(ctx);
  if (n <= 0) return;
  const amount = instr.amount * n;
  const tp = instr.target === 'self' ? ctx.self : ctx.opp;
  const st = await pickStackOf(ctx, tp, digimonStacks(state, tp), `DP ${amount >= 0 ? '+' : ''}${amount} 받을 디지몬 선택`);
  if (st) S.modifyDP(state, tp, st.uid, amount, 'turn');
  if (instr.security) S.addSecurityDPMod(state, ctx.opp, amount, state.turnNumber);
};

// ───────────────────────── rest / active ─────────────────────────
OPS.s2_restPick = async (instr, ctx) => {
  const { state } = ctx; const tp = instr.target === 'self' ? ctx.self : ctx.opp;
  for (let i = 0; i < (instr.n || 1); i++) {
    const opts = state.players[tp].battle.filter(s => C(s.cardId).category === instr.category && !s.suspended);
    const st = await pickStackOf(ctx, tp, opts, instr.prompt || '레스트시킬 대상 선택');
    if (!st) break;
    S.restStack(state, tp, st.uid);
  }
};
OPS.s2_restAllSkip = async (instr, ctx) => {
  const { state } = ctx;
  for (const st of [...state.players[ctx.opp].battle]) {
    if (!['digimon', 'tamer'].includes(C(st.cardId).category) && !instr.allCards) continue;
    if (instr.rest !== false) S.restStack(state, ctx.opp, st.uid);
    if (instr.skip) S.setSkipNextUnsuspend(state, ctx.opp, st.uid);
  }
};
// "상대의 턴 종료까지 상대의 디지몬과 테이머 전부는 액티브가 되지 않는다."
OPS.s2_noActiveOpp = async (instr, ctx) => {
  const { state } = ctx;
  for (const st of state.players[ctx.opp].battle) if (['digimon', 'tamer'].includes(C(st.cardId).category)) st.s2NoActiveUntil = untilOppTurnEnd(state, ctx.self);
  S.log(state, `${ctx.opp} 디지몬/테이머 전부 상대의 턴 종료까지 액티브가 되지 않음`);
};
OPS.s2_unsuspendChoice = async (instr, ctx) => {
  const { state } = ctx;
  const opts = [thisStackOf(ctx), ...tamerStacks(state, ctx.self).filter(t => hasColor(t, instr.tamerColor))].filter(Boolean);
  const st = opts.length === 1 ? opts[0] : await pickStackOf(ctx, ctx.self, opts, '액티브로 할 대상 선택 (이 디지몬 / 블루 테이머)');
  if (st) S.unsuspendStack(state, ctx.self, st.uid);
};
OPS.s2_unsuspendAllOwn = async (instr, ctx) => {
  const { state } = ctx;
  for (const st of digimonStacks(state, ctx.self)) S.unsuspendStack(state, ctx.self, st.uid);
};

// ───────────────────────── attack helpers ─────────────────────────
OPS.s2_progress = async (instr, ctx) => { // 《진격》
  const { state } = ctx; const st = thisStackOf(ctx);
  if (!st) return;
  if (effMemory(state, ctx.self) > -1) { S.log(state, `${ctx.self} 《진격》: 메모리가 상대 쪽 1 이상이 아니라 어택할 수 없음`); return; }
  if (!canDeclare(state, ctx.self, st)) { S.log(state, `${ctx.self} 《진격》: 지금 어택할 수 없음`); return; }
  if (!(await confirmCtx(ctx, `《진격》 — ${C(st.cardId).nameKo}(으)로 어택할까요?`))) return;
  if (ctx.startAttack) ctx.startAttack(ctx.self, st.uid);
};
OPS.s2_attackNoRest = async (instr, ctx) => {
  const { state } = ctx; const st = thisStackOf(ctx);
  if (!st || !canDeclare(state, ctx.self, { ...st, suspended: false })) return; // an already-rested Digimon may attack: nothing is rested (11-2-1 wording)
  if (!(await confirmCtx(ctx, `${C(st.cardId).nameKo}(으)로 레스트시키지 않고 어택할까요?`))) return;
  if (ctx.startAttack) ctx.startAttack(ctx.self, st.uid, undefined, { noRest: true });
};
// the opponent must attack with a Digimon of theirs (EX3-024: opponent chooses; BT13-077: the effect owner chooses)
OPS.s2_forceOppAttack = async (instr, ctx) => {
  const { state } = ctx; const opp = ctx.opp;
  const opts = digimonStacks(state, opp).filter(s => canDeclare(state, opp, s));
  if (!opts.length) { S.log(state, `${opp} 어택할 수 있는 디지몬이 없음`); return; }
  let st;
  if (instr.selfChooses) {
    if (!(await confirmCtx(ctx, '상대의 디지몬 1마리를 선택해 어택시킬까요?'))) return;
    st = await pickStackOf(ctx, ctx.self, opts, '어택시킬 상대 디지몬 선택');
  } else st = await pickStackOf(ctx, opp, opts, `${opp}: 본인의 디지몬 1마리를 어택시킵니다`);
  if (!st) return;
  if (ctx.startAttack) ctx.startAttack(opp, st.uid);
};
OPS.s2_attackThis = async (instr, ctx) => { // granted "이 디지몬으로 어택한다."
  const st = thisStackOf(ctx);
  if (st && canDeclare(ctx.state, ctx.self, st) && ctx.startAttack) ctx.startAttack(ctx.self, st.uid);
  else S.log(ctx.state, `${ctx.self} 부여된 효과: 어택할 수 없어 건너뜀`);
};
OPS.s2_attackPlayer = async (instr, ctx) => { // BT11-107: attack the player with a Greymon-named own Digimon
  const { state } = ctx;
  const opts = digimonStacks(state, ctx.self).filter(s => canDeclare(state, ctx.self, s) && instr.pred(C(s.cardId)));
  const st = await pickStackOf(ctx, ctx.self, opts, '플레이어에게 어택할 디지몬 선택 (없음=취소)');
  if (st && ctx.startAttack) ctx.startAttack(ctx.self, st.uid, 'PLAYER');
};
OPS.s2_restrictAttackDP = async (instr, ctx) => { // EX4-024
  const { state } = ctx; const chosen = [];
  for (let i = 0; i < instr.n; i++) {
    const opts = digimonStacks(state, ctx.opp).filter(s => !chosen.includes(s) && S.effectiveDP(state, ctx.opp, s) <= instr.dpMax);
    const st = await pickStackOf(ctx, ctx.opp, opts, `어택할 수 없게 할 DP ${instr.dpMax} 이하 디지몬 선택`);
    if (!st) break;
    chosen.push(st);
    S.restrictAttack(state, ctx.opp, st.uid, untilOppTurnEnd(state, ctx.self));
  }
};

// ───────────────────────── granted / temporary status ─────────────────────────
OPS.s2_grantEffect = async (instr, ctx) => { // "상대의 디지몬 1마리에게 「【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.」의 효과를 준다"
  const st = await pickStackOf(ctx, ctx.opp, digimonStacks(ctx.state, ctx.opp), '효과를 줄 상대 디지몬 선택');
  if (!st) return;
  (st.s3 ||= {}).forceAtkMain = { until: untilOppTurnEnd(ctx.state, ctx.self), src: ctx.sourceCardId }; // consumed by state.queueForcedAttacks
  S.log(ctx.state, `${C(st.cardId).nameKo}에게 「메인 페이즈 개시 시 어택」 효과 부여`);
};
OPS.s2_grantThisEffect = async (instr, ctx) => {
  const st = thisStackOf(ctx);
  if (st) grantEffect(ctx.state, st, { trigger: instr.trigger, label: instr.label, until: untilOppTurnEnd(ctx.state, ctx.self) });
};
OPS.s2_fxImmune = async (instr, ctx) => {
  const st = thisStackOf(ctx);
  if (!st) return;
  S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until: untilOppTurnEnd(ctx.state, ctx.self), ...(instr.scope === 'all' ? {} : { fromCategory: 'digimon' }) });
};
OPS.s2_protectThis = async (instr, ctx) => { // ST13-14
  const st = thisStackOf(ctx);
  if (st) S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['delete', 'bounce'], until: untilOppTurnEnd(ctx.state, ctx.self) });
};
OPS.s2_tokenLeave = async (instr, ctx) => { if (tokenCleanup(ctx.state, ctx.self)) S.recoverTopOfDeckToSecurity(ctx.state, ctx.self); };
OPS.s2_restrictThisAttack = async (instr, ctx) => {
  S.restrictAttack(ctx.state, ctx.self, ctx.sourceStackUid, untilOppTurnEnd(ctx.state, ctx.self));
};
OPS.s2_asDigimon = async (instr, ctx) => { // BT12-092 / BT13-008: treated as a DP-3000 Digimon until end of turn, can't evolve
  const { state } = ctx;
  const cands = tamerStacks(state, ctx.self).filter(s => !instr.name || C(s.cardId).nameKo === instr.name);
  const st = instr.thisStack ? thisStackOf(ctx) : await pickStackOf(ctx, ctx.self, cands, '디지몬으로 취급할 테이머 선택');
  if (!st) return;
  st.s2AsDigimon = true; st.s2NoEvolve = true;
  (st.baseOv ||= []).push({ ts: S.stamp(), until: state.turnNumber, dp: instr.dp || 3000 }); S.refreshBaseInfo(state, st); // 원래 DP를 N으로 취급 (a Tamer has no DP: modifyDP would be refused by 2-5-3)
  S.scheduleEndOfTurn(state, () => { st.s2AsDigimon = false; st.s2NoEvolve = false; }, { expire: true }); // duration end, not a trigger
  S.log(state, `${C(st.cardId).nameKo}: 턴 종료까지 디지몬·DP ${instr.dp || 3000}으로도 취급, 진화할 수 없음`);
};
OPS.s2_stackEvoMod = async (instr, ctx) => { // BT14-013
  const st = thisStackOf(ctx);
  if (st) (st.s2EvoMods = st.s2EvoMods || []).push({ ...instr.mod, until: ctx.state.turnNumber });
};
// BT14-013: per-stack, until-end-of-turn evolution discount (peeked from state.js hookEvoCostDiscount; it was stored on the stack but nothing ever read it)
export function stackEvoDiscount(state, p, stack, targetId) {
  let n = 0;
  const t = C(targetId);
  for (const m of (stack && stack.s2EvoMods) || []) {
    if (m.until < state.turnNumber) continue;
    if ((m.nameIncludes && nameHas(t, m.nameIncludes)) || (m.traitAny && m.traitAny.some(x => hasTrait(t, x)))) n += m.delta;
  }
  return n;
}
OPS.s2_xrosSub = async (instr, ctx) => {
  const pl = ctx.state.players[ctx.self];
  (pl.xrosSubs = pl.xrosSubs || []).push({ uid: ctx.sourceStackUid, until: ctx.state.turnNumber });
};
OPS.s2_secOff = async (instr, ctx) => { // EX3-073: this turn the opponent's 【시큐리티】 effects don't activate
  ctx.state.s2SecOff = { player: ctx.self, until: ctx.state.turnNumber };
  S.log(ctx.state, `${ctx.self} 턴 종료까지 상대 카드의 【시큐리티】 효과는 발휘하지 않음`);
};
OPS.s2_overrideBase = async (instr, ctx) => { // BT11-043: 원래 명칭/색/DP 변경
  const { state } = ctx;
  const st = await pickStackOf(ctx, ctx.opp, digimonStacks(state, ctx.opp), '원래 명칭·색·DP를 변경할 상대 디지몬 선택');
  if (!st) return;
  if (S.effectBlocked(state, ctx.opp, st, 'other')) return;
  S.setBaseInfo(state, ctx.opp, st, { name: instr.name, colors: [instr.color], dp: instr.dp, until: untilOppTurnEnd(state, ctx.self) }); // 15-8-2-5: timestamped, later override wins
  S._s4.ruleCheckDP(state, ctx.opp, st);
  S.log(state, `${ctx.opp} ${C(st.cardId).nameKo}: 상대의 턴 종료까지 원래 명칭 「${instr.name}」·${instr.color}·DP ${instr.dp}`);
};
OPS.s2_battleImmune = async (instr, ctx) => { // BT14-028: 상대의 턴 종료까지 배틀에서 소멸하지 않는다
  const st = thisStackOf(ctx);
  if (!st) return;
  S.grantBattleImmunity(ctx.state, ctx.self, st.uid);
  st.battleImmuneUntilTurn = untilOppTurnEnd(ctx.state, ctx.self);
};
OPS.s2_preventRestNoUnder = async (instr, ctx) => { // P-089
  const { state } = ctx;
  const opts = state.players[ctx.opp].battle.filter(s => ['digimon', 'tamer'].includes(C(s.cardId).category) && s.sources.length === 0);
  const st = await pickStackOf(ctx, ctx.opp, opts, '레스트할 수 없게 할 (아래에 카드가 없는) 디지몬/테이머 선택');
  if (st) S.preventRest(state, ctx.opp, st.uid, untilOppTurnEnd(state, ctx.self));
};

// ───────────────────────── zones / cards ─────────────────────────
OPS.s2_returnFromTrash = async (instr, ctx) => {
  const { state } = ctx; const pl = state.players[ctx.self];
  for (let k = 0; k < (instr.n || 1); k++) {
    const idxs = pl.trash.map((id, i) => i).filter(i => instr.pred(C(pl.trash[i]), pl.trash[i]));
    if (!idxs.length) return;
    const i = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: instr.prompt || '트래시에서 패로 되돌릴 카드 선택' });
    if (i == null) return;
    const [id] = pl.trash.splice(i, 1);
    pl.hand.push(id);
    S.log(state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`);
  }
};
OPS.s2_trashToSecurity = async (instr, ctx) => { // BT12-042
  const pl = ctx.state.players[ctx.self];
  const i = pl.trash.findIndex(id => C(id).nameKo === instr.name);
  if (i === -1) return;
  const [id] = pl.trash.splice(i, 1);
  pl.security.unshift(id);
  S.log(ctx.state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 시큐리티 위에 놓음`);
};
OPS.s2_tamerUnderToHand = async (instr, ctx) => { // BT12-075
  const { state } = ctx;
  const entries = tamerStacks(state, ctx.self).flatMap(t => t.sources.map((id, i) => ({ t, id, i }))).filter(e => instr.pred(C(e.id)));
  if (!entries.length) return;
  const picked = await pickCards(ctx, ctx.self, entries.map(e => e.id), { max: 1, prompt: '패로 되돌릴 테이머 아래의 카드 선택 (선택 안 함 = 발동 안 함)' });
  if (!picked.length) return;
  const e = entries[picked[0]];
  e.t.sources.splice(e.i, 1);
  state.players[ctx.self].hand.push(e.id);
  S.log(state, `${ctx.self} ${C(e.t.cardId).nameKo} 아래의 ${C(e.id).nameKo}을(를) 패로`);
};
OPS.s2_placeTrial = async (instr, ctx) => { // 「4대용의 시련」
  const { state } = ctx; const pl = state.players[ctx.self];
  if (pl.battle.some(s => C(s.cardId).nameKo === '4대용의 시련')) return;
  const idx = pl.hand.findIndex(id => C(id).nameKo === '4대용의 시련');
  if (idx === -1) return;
  if (!(await confirmCtx(ctx, '패의 「4대용의 시련」 1장을 배틀 에어리어에 놓을까요?'))) return;
  const [id] = pl.hand.splice(idx, 1);
  pl.trash.push(id); // pass2-b7: placeThisInBattle takes the card out of the TRASH (hand -> trash slot -> battle, like the other hand placers)
  const st = S.placeThisInBattle(state, ctx.self, id);
  if (!st) { const ti = pl.trash.lastIndexOf(id); if (ti !== -1) { pl.trash.splice(ti, 1); pl.hand.push(id); } return; }
  S.emitGameEvent(state, 'trialPlaced', { owner: ctx.self, stack: st, cause: 'effect' });
};
OPS.s2_moveUnder = async (instr, ctx) => { // BT11-088 / BT12-083
  const { state } = ctx; const opp = ctx.opp;
  const maxLv = instr.maxLv ? instr.maxLv(ctx) : 99;
  const digs = digimonStacks(state, opp);
  const movable = digs.filter(s => (C(s.cardId).level || 0) <= maxLv);
  const mv = await pickStackOf(ctx, ctx.self, movable, instr.prompt || '아래에 놓을 상대 디지몬 선택');
  if (!mv) return;
  const targets = [...digs.filter(s => s !== mv), ...(instr.allowTamer ? tamerStacks(state, opp) : [])];
  if (!targets.length) { S.log(state, `${opp} 아래에 놓을 대상이 없음`); return; }
  const cause = causeFor(ctx, opp);
  if (S.effectBlocked(state, opp, mv, 'bounce')) return;
  const tg = await pickStackOf(ctx, ctx.self, targets, '아래에 놓을 대상(디지몬/테이머) 선택');
  if (!tg) return;
  const doMove = () => { if (!state.players[opp].battle.includes(mv)) return; if (S.leaveGate(state, opp, mv, cause, 'bounce', doMove)) return; moveStackUnder(state, opp, mv, tg); };
  doMove();
};
OPS.s2_lookHandTrash = async (instr, ctx) => { // BT11-088 / BT13-092: look at the whole opponent hand, trash one
  const { state } = ctx; const opl = state.players[ctx.opp];
  S.log(state, `${ctx.self} 상대의 패를 전부 확인: ${opl.hand.map(id => C(id).nameKo).join(', ') || '(없음)'}`);
  if (!opl.hand.length) return;
  const picked = await pickCards(ctx, ctx.self, opl.hand, { min: 1, max: 1, prompt: '상대의 패 확인 — 파기할 카드 1장 선택' });
  S.trashFromHand(state, ctx.opp, picked.length ? picked[0] : 0);
};
OPS.s2_peekSecurity = async (instr, ctx) => { // RB1-027
  const { state } = ctx; const opl = state.players[ctx.opp];
  if (!opl.security.length) return;
  const id = opl.security[0];
  S.log(state, `${ctx.self} 상대 시큐리티 맨 위 오픈: ${C(id).nameKo}`);
  if (C(id).category === 'digimon') S.grantMemory(state, ctx.self, 1, ctx.sourceCardId); else S.drawCards(state, ctx.self, 1);
  const r = await ctx.choose('multipleChoice', { prompt: `오픈한 ${C(id).nameKo}을(를) 시큐리티의 어디로 되돌릴까요?`, options: ['시큐리티 위', '시큐리티 아래'] });
  if (r === 1) { opl.security.shift(); opl.security.push(id); }
};
OPS.s2_secRevealTrash = async (instr, ctx) => { // BT10-086
  const { state } = ctx; const opl = state.players[ctx.opp];
  if (!opl.security.length) return;
  const all = opl.security.slice();
  S.log(state, `${ctx.self} 상대의 시큐리티 전부 오픈: ${all.map(id => C(id).nameKo).join(', ')}`);
  const picked = await pickCards(ctx, ctx.self, all, { min: 1, max: 1, prompt: '오픈한 시큐리티 중 파기할 1장 선택' });
  const [gone] = all.splice(picked.length ? picked[0] : 0, 1);
  opl.trash.push(gone);
  for (let k = all.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [all[k], all[j]] = [all[j], all[k]]; }
  opl.security = all;
  S.log(state, `${ctx.opp} 시큐리티에서 ${C(gone).nameKo} 파기, 나머지는 뒷면으로 되돌려 셔플`);
};
OPS.s2_playFree = async (instr, ctx) => { // free-play with hooks (returns the new stack to `then`)
  const { state } = ctx; const who = ctx.self;
  if (instr.need && !instr.need(ctx)) return;
  const zones = instr.zones || ['hand'];
  const entries = await pickFromZones(ctx, who, zones, (c, id) => c.category === 'digimon' && instr.pred(c, id), { max: 1, prompt: instr.prompt || '코스트를 지불하지 않고 등장시킬 카드 선택' });
  if (!entries.length) return;
  const [e] = entries;
  const st = S.playFreeFromZone(state, who, e.zone, e.idx, { rested: !!instr.rested, noTriggers: !!instr.noTriggers });
  if (st && instr.then) await instr.then(ctx, st);
};
OPS.s2_playFreeCtx = (instr, ctx) => OPS.s2_playFree({ ...instr, pred: instr.predCtx(ctx) }, ctx); // s2_playFree whose filter depends on the board (BT11-016 DP cap per red tamer)
OPS.s2_playFromSources = async (instr, ctx) => { // EX3-023: from a chosen own Digimon's sources
  const { state } = ctx; const who = ctx.self; const pl = state.players[who];
  const holders = digimonStacks(state, who).filter(s => instr.holderPred(s) && s.sources.some(id => instr.pred(C(id), id)));
  const h = await pickStackOf(ctx, who, holders, instr.prompt || '진화원에서 등장시킬 카드가 있는 디지몬 선택');
  if (!h) return;
  const idxs = h.sources.map((id, i) => i).filter(i => instr.pred(C(h.sources[i]), h.sources[i]));
  const picked = await pickCards(ctx, who, h.sources, { eligible: idxs, max: 1, prompt: '등장시킬 진화원 선택' });
  if (!picked.length) return;
  const [id] = h.sources.splice(picked[0], 1);
  S.recomputeStackGrants(h);
  pl.trash.push(id);
  const st = S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { fromSources: true });
  if (st) S.emitGameEvent(state, 'playFromSources', { owner: who, stack: st, cause: 'effect', level: C(st.cardId).level });
};
OPS.s2_tokens = async (instr, ctx) => {
  const { state } = ctx; const pl = state.players[ctx.self];
  for (const id of instr.ids) {
    pl.trash.push(id);
    S.playFreeFromZone(state, ctx.self, 'trash', pl.trash.length - 1, {});
  }
};
function tokenCleanup(state, p) {
  const pl = state.players[p];
  const toks = pl.battle.filter(s => ['홍염의 아몬', '창뢰의 우몬'].includes(C(s.cardId).nameKo));
  if (!toks.length) return false;
  for (const t of toks) S.deleteStack(state, p, t.uid, 'trash', 'ownEffect');
  return true;
}
OPS.s2_oppMayDiscard = async (instr, ctx, helpers) => { // BT13-102
  const { state } = ctx; const op = ctx.opp; const opl = state.players[op];
  const eligible = opl.hand.map((id, i) => i).filter(i => instr.pred(C(opl.hand[i])));
  let paid = false;
  if (eligible.length && await ctx.choose('confirmEffect', { player: op, prompt: `${op}: 패의 테이머/옵션 카드 1장을 파기할까요? (파기하지 않으면 상대가 1 드로우 + 메모리 +1)` })) {
    const chosen = await ctx.choose('pickFromHandIndexes', { player: op, eligibleIdxs: eligible, n: 1, prompt: '파기할 테이머/옵션 카드 1장 선택' });
    if ((chosen || []).length) { S.trashFromHand(state, op, chosen[0]); paid = true; }
  }
  if (!paid) await helpers.runScript(instr.else || [], ctx);
};
// BT12-089: this tamer + named trash cards go under a Digimon, then it evolves (Lv ignored)
OPS.s2_tamerFuse = async (instr, ctx) => {
  const { state } = ctx; const who = ctx.self; const pl = state.players[who];
  const tamer = thisStackOf(ctx);
  if (!tamer) return;
  const targets = digimonStacks(state, who).filter(s => C(s.cardId).nameKo === instr.digimonName);
  const handIdx = pl.hand.findIndex(id => C(id).nameKo === instr.evolveInto);
  const trashOk = instr.trashNames.every(n => pl.trash.some(id => C(id).nameKo === n));
  if (!targets.length || handIdx === -1 || !trashOk) { S.log(state, `${who} 조건을 만족하지 못해 효과를 건너뜀`); return; }
  const dg = await pickStackOf(ctx, who, targets, `「${instr.digimonName}」 선택`);
  if (!dg) return;
  const cid = pl.hand[handIdx];
  if (!evoInfo(ctx, dg, cid, { ignoreLevel: true })) { S.log(state, `${who} ${C(dg.cardId).nameKo}은(는) ${C(cid).nameKo}(으)로 진화할 수 없음`); return; }
  const ids = instr.trashNames.map(n => pl.trash.splice(pl.trash.findIndex(id => C(id).nameKo === n), 1)[0]);
  const ti = pl.battle.indexOf(tamer);
  if (ti !== -1) pl.battle.splice(ti, 1);
  dg.sources.unshift(...ids, ...tamer.sources, tamer.cardId);
  S.recomputeStackGrants(dg);
  S.log(state, `${who} ${C(tamer.cardId).nameKo}와 트래시 카드를 ${C(dg.cardId).nameKo}의 아래에 놓음`);
  const info = evoInfo(ctx, dg, cid, { ignoreLevel: true });
  S.digivolve(state, who, dg.uid, cid, info ? info.cost : (C(cid).evoNormal?.cost ?? 0), 'hand');
  S.modifyDP(state, who, dg.uid, 2000, 'turn');
};
// BT12-015 / BT13-028 / BT13-055: [패]【메인】 evolve-from-hand-card effects (this card is the hand card that evolves)
OPS.s2_handEvolveThis = async (instr, ctx) => {
  const { state } = ctx; const who = ctx.self; const pl = state.players[who];
  const handIdx = pl.hand.indexOf(ctx.sourceCardId);
  if (handIdx === -1) { S.log(state, `${who} 이 카드가 패에 없음`); return; }
  if (instr.need && !instr.need(ctx)) { S.log(state, `${who} 조건을 만족하지 못해 효과를 건너뜀`); return; }
  const subjects = instr.subjects(ctx);
  if (!subjects.length) { S.log(state, `${who} 대상이 없어 효과를 건너뜀`); return; }
  const dg = await pickStackOf(ctx, who, subjects, instr.pickPrompt || '진화시킬 대상 선택');
  if (!dg) return;
  const costIds = await instr.cost(ctx, dg);
  if (!costIds) return;
  const cid = ctx.sourceCardId;
  const idx = pl.hand.indexOf(cid);
  if (idx === -1) return;
  const printed = C(cid).evoNormal?.cost ?? 0;
  const cost = instr.fixedCost != null ? instr.fixedCost : printed;
  S.digivolve(state, who, dg.uid, cid, cost, 'hand');
};

// ───────────────────────── SCRIPTS ─────────────────────────
export const SCRIPTS = {};
const isKw = (kw) => (c) => `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes(`《${kw}`);
const trait = (t) => (c) => hasTrait(c, t);
const traitOr = (...ts) => (c) => ts.some(t => hasTrait(c, t));
const ownCount = (state, p, pred) => digimonStacks(state, p).filter(s => pred(C(s.cardId), s)).length;

// batch 1: options / evolves / simple
SCRIPTS['BT10-039::진화 시'] = [{ op: 's2_useOption', pred: (c) => nameHas(c, '플러그인') }];
SCRIPTS['BT10-041::진화 시'] = [{ op: 's2_useOption', toSecurity: true, pred: (c) => nameHas(c, '플러그인') || ((c.cost || 0) <= 5 && (c.colors || []).includes('yellow')) }];
SCRIPTS['EX4-030::진화 시'] = [{ op: 's2_useOption', pred: (c) => (c.cost || 0) <= 5 }];
const hasTamer = (col) => (ctx) => tamerStacks(ctx.state, ctx.self).some(t => !col || hasColor(t, col));
SCRIPTS['BT10-067::어택 시'] = [{ op: 's2_evolve', need: hasTamer(), subject: { self: true }, zone: 'hand', ignoreCond: true, cost: { mode: 'fixed', n: 2 }, cardPred: (c) => nameHas(c, '저스티몬') && c.nameKo !== '저스티몬: 크리티컬 암' }];
// BT11-073 【진화 시】: 진화원의 「저스티몬: 액셀 암」 이외의 Lv.6 디지몬 카드 1장을 패로 되돌리는 것으로, 턴 종료까지 《관통》과 《S 어택 +1》.
OPS.s2_axelArmEvo = async (instr, ctx) => {
  const st = thisStackOf(ctx); if (!st) return;
  const pred = (id) => C(id).category === 'digimon' && C(id).level === 6 && C(id).nameKo !== '저스티몬: 액셀 암';
  if (!st.sources.some(pred)) return;
  if (!(await confirmCtx(ctx, '이 디지몬의 진화원에서 Lv.6 디지몬 카드 1장을 패로 되돌려 《관통》과 《S 어택 +1》을 얻겠습니까?'))) return;
  const [i] = await S.chooseSourceIdxs(ctx.state, ctx.self, st, 1, ctx.choose, pred, '패로 되돌릴 진화원(Lv.6) 선택');
  if (i == null) return;
  const [id] = st.sources.splice(i, 1);
  if (S.fdCount && S.fdCount(st) && i < S.fdCount(st)) st.s5fd = Math.max(0, S.fdCount(st) - 1);
  ctx.state.players[ctx.self].hand.push(id);
  S.recomputeStackGrants && S.recomputeStackGrants(st);
  S.log(ctx.state, `${ctx.self} ${C(st.cardId).nameKo} 진화원 ${C(id).nameKo}을(를) 패로 되돌림`);
  S.grantKeyword(ctx.state, ctx.self, st.uid, '관통', undefined, 'turn');
  S.grantKeyword(ctx.state, ctx.self, st.uid, '시큐리티어택', 1, 'turn');
};
SCRIPTS['BT11-073::진화 시'] = [{ op: 's2_axelArmEvo' }];
SCRIPTS['BT11-073::어택 시'] = [{ op: 's2_evolve', need: hasTamer(), subject: { self: true }, zone: 'hand', ignoreCond: true, cost: { mode: 'fixed', n: 2 }, cardPred: (c) => nameHas(c, '저스티몬') && c.nameKo !== '저스티몬: 액셀 암' }];
SCRIPTS['EX4-056::어택 시'] = [{ op: 's2_evolve', need: hasTamer('purple'), subject: { self: true }, zone: 'hand', cardPred: (c) => nameIs(c, '레이브몬') }];
SCRIPTS['BT13-085::어택 시'] = [{ op: 's2_evolve', need: hasTamer(), subject: { self: true }, zone: 'trash', cardPred: (c) => nameIs(c, '레이브몬') }];
const freeEvolveNamed = (targets, into) => ({ op: 's2_evolve', subject: { pred: (s) => targets.some(n => nameIs(C(s.cardId), n)) }, zone: 'hand', ignoreCond: true, cost: { mode: 'free' }, cardPred: (c) => nameIs(c, into) });
SCRIPTS['EX4-066::메인'] = [{ op: 'choice', prompt: '발휘할 효과 선택', options: [
  { label: '크레스가루몬이 있다면 아구몬/그레이몬 → 블리츠그레이몬', then: [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).some(s => nameIs(C(s.cardId), '크레스가루몬')), then: [freeEvolveNamed(['아구몬', '그레이몬'], '블리츠그레이몬')] }] },
  { label: '블리츠그레이몬이 있다면 파피몬/가루몬 → 크레스가루몬', then: [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).some(s => nameIs(C(s.cardId), '블리츠그레이몬')), then: [freeEvolveNamed(['파피몬', '가루몬'], '크레스가루몬')] }] }] }];
SCRIPTS['EX4-072::메인'] = [{ op: 's2_evolve', subject: { pred: (s) => C(s.cardId).level === 6 }, zone: 'hand', ignoreCond: true, cost: { mode: 'free' },
  cardPred: (c, st) => c.level === 6 && c.nameKo !== C(st.cardId).nameKo && c.nameKo.includes(C(st.cardId).nameKo) }];
const evoTrash = (filterFn, extra = {}) => ({ op: 's2_evolve', subject: { other: true }, zone: 'trash', cardPred: filterFn, ...extra });
SCRIPTS['EX3-008::진화 시'] = [{ op: 'choice', prompt: '발휘할 효과 선택', options: [
  { label: '다른 디지몬을 트래시의 「프리」 퍼플 Lv.4로 진화', then: [evoTrash((c) => hasTrait(c, '프리') && (c.colors || []).includes('purple') && c.level === 4)] },
  { label: '조그레스 진화', then: [{ op: 'jogressEffect', who: 'self' }] }] }];
SCRIPTS['EX3-058::진화 시'] = [{ op: 'choice', prompt: '발휘할 효과 선택', options: [
  { label: '다른 디지몬을 트래시의 「프리」 레드 Lv.4로 진화', then: [evoTrash((c) => hasTrait(c, '프리') && (c.colors || []).includes('red') && c.level === 4)] },
  { label: '조그레스 진화', then: [{ op: 'jogressEffect', who: 'self' }] }] }];
SCRIPTS['BT12-109::메인'] = [{ op: 's2_evolve', subject: {}, zone: 'tamerUnder', cardPred: (c) => hasSave(c) }];
SCRIPTS['BT12-109::시큐리티'] = [{ op: 'addSelfToHand' }];
const evoChain = (cardPred) => [{ op: 's2_evolve', subject: { self: true }, zone: 'hand', cost: { mode: 'discount', n: 2 }, cardPred }];
const chainCard = (c) => (c.colors || []).includes('green') && (c.colors || []).length === 2;
SCRIPTS['EX4-032::자신의 턴'] = evoChain(chainCard);
SCRIPTS['EX4-034::자신의 턴'] = evoChain(chainCard);
// EX4-033's effect (DP+4000) and inherited (연계 evolve) share one key → dispatch on the trigger text
SCRIPTS['EX4-033::자신의 턴@연계'] = evoChain(chainCard);


// batch 2: helper ops
OPS.s2_runPlaced = async (instr, ctx, helpers) => { // BT10-112: activate a 【진화 시】 of the card just placed, as this digimon's effect
  const id = scratch(ctx).placedIds?.[0];
  if (!id) return;
  await runCardSegments(ctx, helpers, id, '진화 시', { asCardId: ctx.sourceCardId, asStackUid: ctx.sourceStackUid });
};
OPS.s2_runTamerEffect = async (instr, ctx, helpers) => { // BT11-029: another of my cards' 【등장 시】
  const st = await pickStackOf(ctx, ctx.self, tamerStacks(ctx.state, ctx.self).filter(t => nameIs(C(t.cardId), instr.name)), `「${instr.name}」 선택`);
  if (st) await runCardSegments(ctx, helpers, st.cardId, instr.tag, { asCardId: st.cardId, asStackUid: st.uid });
};
OPS.s2_stackToSecurity = async (instr, ctx) => { // BT11-039
  const { state } = ctx;
  const opts = digimonStacks(state, ctx.self).filter(s => s.uid !== ctx.sourceStackUid && instr.pred(s));
  const st = await pickStackOf(ctx, ctx.self, opts, instr.prompt || '시큐리티 위에 놓을 디지몬 선택 (없음 = 안 함)');
  if (st) leaveArea(state, st, ctx.self, 'securityTop', 'ownEffect');
};
OPS.s2_memPerRested = async (instr, ctx) => { // BT11-057
  const n = state_restedCount(ctx.state, ctx.opp);
  if (n > 0) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
};
const state_restedCount = (state, p) => digimonStacks(state, p).filter(s => s.suspended).length;
OPS.s2_restPerDiscard = async (instr, ctx) => {
  const n = (scratch(ctx).discarded || []).length;
  for (let i = 0; i < n; i++) {
    const opts = digimonStacks(ctx.state, ctx.opp).filter(s => !s.suspended);
    const st = await pickStackOf(ctx, ctx.opp, opts, '레스트시킬 상대 디지몬 선택');
    if (!st) break;
    S.restStack(ctx.state, ctx.opp, st.uid);
  }
};
OPS.s2_pluck = async (instr, ctx) => { // RB1-016 / P-089: trash a chosen card from under an opponent Digimon/Tamer, once per discarded card
  const { state } = ctx; const n = (scratch(ctx).discarded || []).length;
  for (let i = 0; i < n; i++) {
    const opts = state.players[ctx.opp].battle.filter(s => ['digimon', 'tamer'].includes(C(s.cardId).category) && s.sources.length && !S.effectBlocked(state, ctx.opp, s, 'srcTrash'));
    const st = await pickStackOf(ctx, ctx.opp, opts, '아래의 카드를 파기할 상대 디지몬/테이머 선택');
    if (!st) break;
    const picked = await pickCards(ctx, ctx.self, st.sources, { min: instr.optional ? 0 : 1, max: 1, prompt: '파기할 진화원(아래의 카드) 선택' });
    if (!picked.length) continue;
    const [id] = st.sources.splice(picked[0], 1);
    state.players[ctx.opp].trash.push(id);
    S.recomputeStackGrants(st);
    S.log(state, `${ctx.opp} ${C(st.cardId).nameKo} 아래의 ${C(id).nameKo} 파기`);
  }
};
OPS.s2_bounceNoSource = async (instr, ctx) => { // RB1-016: optional, no-source opponent Digimon → deck bottom
  const opts = digimonStacks(ctx.state, ctx.opp).filter(s => s.sources.length === 0);
  const st = await pickStackOf(ctx, ctx.opp, opts, '덱 아래로 되돌릴 (진화원 없는) 상대 디지몬 선택 (없음 = 안 함)');
  if (st) bounceStack(ctx, ctx.opp, st, 'deckBottom');
};
OPS.s2_shotDown = async (instr, ctx) => { // RB1-019: an opponent Digimon goes under its owner's security
  const st = await pickStackOf(ctx, ctx.opp, digimonStacks(ctx.state, ctx.opp), '시큐리티 아래에 놓을 상대 디지몬 선택');
  if (st) bounceStack(ctx, ctx.opp, st, 'securityBottom');
};
OPS.s2_lv3ToSecurity = async (instr, ctx) => { // RB1-019 【진화 시】 not in shard but helper shared
  for (const p of [ctx.self, ctx.opp]) for (const st of digimonStacks(ctx.state, p).filter(s => C(s.cardId).level === 3)) bounceStack(ctx, p, st, 'securityTop');
};

// batch 2: scripts
SCRIPTS['BT10-081::어택 시'] = [{ op: 's2_trashDeckUpTo', max: 3 }];
SCRIPTS['BT10-086::진화 시@가장 Lv'] = [{ op: 's2_bounceHighestLv' }];
SCRIPTS['BT10-086::진화 시@X항체'] = [{ op: 's2_costSource', dest: 'deckBottom', pred: (c) => isX(c) || c.level === 6, prompt: '덱 아래로 되돌릴 「X항체」 또는 Lv.6 진화원 선택', then: [{ op: 's2_secRevealTrash' }] }];
SCRIPTS['BT10-111::등장 시'] = [{ op: 's2_returnFromTrash', pred: (c, id) => isXros(id), prompt: '패로 되돌릴 디지크로스 조건을 가진 카드 선택 (선택 안 함 = 안 함)' }, { op: 's2_xrosSub' }];
SCRIPTS['BT10-112::진화 시'] = [
  { op: 's2_placeUnder', zones: ['hand', 'trash'], pred: (c) => hasTrait(c, '로얄 나이츠') && (c.cost || 0) <= 13, prompt: '이 디지몬의 진화원 아래에 놓을 「로얄 나이츠」 카드' },
  { op: 's2_runPlaced' }, { op: 's2_progress' }];
SCRIPTS['BT11-017::진화 시'] = [{ op: 's2_progress' }];
SCRIPTS['BT11-029::어택 시'] = [{ op: 's2_runTamerEffect', name: '시노미야 리나', tag: '등장 시' }];
SCRIPTS['BT11-036::소멸 시'] = [{ op: 's2_if', test: (ctx) => { const id = ctx.state.deletedInfo?.[ctx.sourceStackUid]?.cardId; return !!id && (nameHas(C(id), '스카몬') || nameHas(C(id), '에테몬')); },
  then: [{ op: 's2_playFree', zones: ['trash'], rested: true, pred: (c) => nameIs(c, '츄몬'), prompt: '트래시의 「츄몬」을 레스트 상태로 등장' }] }];
SCRIPTS['BT11-039::진화 시'] = [{ op: 's2_stackToSecurity', pred: (s) => hasColor(s, 'yellow') }];
SCRIPTS['BT11-043::등장 시'] = [{ op: 's2_if', test: (ctx) => ctx.state.players[ctx.opp].trash.length >= 16 || ctx.state.players[ctx.self].trash.filter(id => nameHas(C(id), '스카몬')).length >= 3,
  then: [{ op: 's2_overrideBase', name: '스카몬', color: 'white', dp: 3000 }] }];
SCRIPTS['BT11-057::진화 시'] = [{ op: 's2_discardUpTo', max: 3 }, { op: 's2_restPerDiscard' }, { op: 's2_memPerRested' }];
SCRIPTS['BT11-088::등장 시'] = [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.opp).length <= 1, then: [{ op: 's2_lookHandTrash' }], else: [{ op: 's2_moveUnder' }] }];
SCRIPTS['BT11-105::메인'] = [{ op: 's2_placeUnder', zones: ['trash'], target: 'pickDigimon', min: 1, pred: (c) => nameIs(c, '벰몬') || nameIs(c, '디스트로몬'), prompt: '진화원 아래에 놓을 「벰몬」/「디스트로몬」 (필수 — 비용)' },
  { op: 's2_if', test: (ctx) => (scratch(ctx).placed || 0) > 0, then: [{ op: 's2_evolve', subject: {}, zone: 'trash', cardPred: (c) => nameIs(c, '디스트로몬') || nameIs(c, '라그나몬') }] }];
SCRIPTS['BT11-107::메인'] = [{ op: 's2_destroySumCost', pred: (c) => nameHas(c, '그레이몬') }, { op: 's2_attackPlayer', pred: (c) => nameHas(c, '그레이몬') }];
const bagraMain = [
  { op: 's2_placeUnder', zones: ['trash'], max: 3, target: { eitherDigimonOrTamer: true }, pred: (c) => c.category === 'digimon' && hasTrait(c, '바그라군'), prompt: '아래에 놓을 「바그라군」 디지몬 카드 (최대 3장)' },
  { op: 's2_if', test: (ctx) => [...digimonStacks(ctx.state, ctx.self), ...tamerStacks(ctx.state, ctx.self)].some(s => hasTrait(C(s.cardId), '바그라군')), then: [{ op: 's2_moveUnder' }] }];
SCRIPTS['BT11-109::메인'] = bagraMain;
SCRIPTS['BT11-109::시큐리티'] = bagraMain;

// batch 3: BT12 / EX4 / ST14
OPS.s2_spendMem = async (instr, ctx) => {
  if (!(await confirmCtx(ctx, `메모리 ${instr.n}를 지불하고 효과를 발휘할까요?`))) { scratch(ctx).paid = false; return; }
  S.spendMemory(ctx.state, instr.n); scratch(ctx).paid = true;
};
SCRIPTS['BT12-014::진화 시'] = [{ op: 's2_destroySumDP', limit: (ctx) => 4000 + Math.floor((thisStackOf(ctx)?.sources.length || 0) / 2) * 3000 }];
SCRIPTS['BT12-015::메인'] = [{ op: 's2_handEvolveThis',
  subjects: (ctx) => tamerStacks(ctx.state, ctx.self).filter(t => C(t.cardId).nameKo === '우정훈'),
  need: (ctx) => ['아그니몬', '브리트라몬'].every(n => ctx.state.players[ctx.self].trash.some(id => C(id).nameKo === n)),
  cost: async (ctx, tamer) => { const pl = ctx.state.players[ctx.self]; for (const n of ['아그니몬', '브리트라몬']) tamer.sources.push(pl.trash.splice(pl.trash.findIndex(id => C(id).nameKo === n), 1)[0]); return true; } }];
SCRIPTS['BT12-029::진화 시'] = [{ op: 's2_unsuspendChoice', tamerColor: 'blue' }];
SCRIPTS['BT12-042::서로의 턴'] = [{ op: 's2_trashToSecurity', name: '최건우' }];
SCRIPTS['BT12-043::진화 시'] = [{ op: 's2_dpPerCount', target: 'opponent', amount: -3000, security: true, count: (ctx) => tamerStacks(ctx.state, ctx.self).filter(t => hasColor(t, 'yellow') || hasColor(t, 'red')).length }];
const grantAtk = [{ op: 's2_grantEffect', trigger: 'mainPhaseStart', label: '어택' }];
SCRIPTS['BT12-065::진화 시'] = grantAtk;
SCRIPTS['BT12-107::메인'] = grantAtk;
SCRIPTS['BT12-065::s3ForceAttack'] = [{ op: 'attackNow', who: 'self', thisStack: true }];
SCRIPTS['BT12-107::s3ForceAttack'] = [{ op: 'attackNow', who: 'self', thisStack: true }];
SCRIPTS['BT14-018::서로의 턴'] = [{ op: 's2_tokenLeave' }];
SCRIPTS['BT12-072::서로의 턴@소멸할 때'] = [{ op: 'removeSecurity', who: 'opponent', position: 'top' }];
SCRIPTS['BT12-072::자신의 메인 페이즈 개시 시'] = [{ op: 's2_placeUnder', zones: ['trash'], min: 1, /* 강제: 놓는다 */ pred: (c) => c.category === 'digimon' && traitOr('머신형', '사이보그형')(c), prompt: '이 디지몬의 진화원 아래에 놓을 카드' }];
SCRIPTS['BT12-075::등장 시'] = [{ op: 's2_tamerUnderToHand', pred: (c) => c.category === 'digimon' && hasSave(c) }];
SCRIPTS['BT12-083::진화 시'] = [{ op: 's2_moveUnder', allowTamer: true, maxLv: (ctx) => 3 + new Set(tamerStacks(ctx.state, ctx.self).map(t => [...(C(t.cardId).colors || [])].sort().join('/'))).size }];
SCRIPTS['BT12-083::자신의 턴 종료 시'] = [{ op: 's2_if', test: (ctx) => (thisStackOf(ctx)?.sources.length || 0) >= 4, then: [{ op: 's2_attackNoRest' }] }];
SCRIPTS['BT12-112::등장 시'] = [{ op: 's2_bounceWithSources' }];
SCRIPTS['BT12-089::메인'] = [{ op: 's2_tamerFuse', digimonName: '길몬', evolveInto: '듀크몬', trashNames: ['그라우몬', '메가로그라우몬'] }];
SCRIPTS['BT12-092::자신의 메인 페이즈 개시 시'] = [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).some(s => nameHas(C(s.cardId), '아구몬') || nameHas(C(s.cardId), '그레이몬')),
  then: [{ op: 's2_spendMem', n: 1 }, { op: 's2_if', test: (ctx) => scratch(ctx).paid, then: [{ op: 's2_asDigimon', thisStack: true }] }] }];
SCRIPTS['BT13-008::메인'] = [{ op: 's2_asDigimon', name: '최건우' }];
SCRIPTS['BT12-097::자신의 메인 페이즈 개시 시'] = [{ op: 's2_if', test: (ctx) => (thisStackOf(ctx)?.sources.length || 0) <= 2,
  then: [{ op: 's2_placeUnder', zones: ['trash'], pred: (c) => c.category === 'digimon' && hasSave(c), prompt: '이 테이머 아래에 놓을 《세이브》 디지몬 카드' }] }];
const restBoth = [{ op: 's2_restAllSkip', rest: true }];
SCRIPTS['BT12-106::메인'] = [{ op: 's2_restAllSkip', rest: true, skip: true, allCards: true }];
SCRIPTS['BT12-106::시큐리티'] = restBoth;
SCRIPTS['BT12-108::메인'] = [{ op: 's2_destroyPair', pred: (c) => traitOr('머신형', '사이보그형')(c) }];
SCRIPTS['ST14-07::진화 시'] = [{ op: 's2_grantThisEffect', trigger: 'delete', label: '베르제브몬' }];
SCRIPTS['S2-GRANT::부여:베르제브몬'] = [{ op: 's2_if', test: (ctx) => ctx.state.players[ctx.self].trash.length >= 10,
  then: [{ op: 's2_playFree', zones: ['trash'], pred: (c) => nameIs(c, '베르제브몬'), prompt: '트래시의 「베르제브몬」 등장' }] }];
const bloodReturn = [{ op: 's2_returnFromTrash', pred: (c) => nameIs(c, '길몬') || nameHas(c, '그라우몬') || nameHas(c, '듀크몬') }];
SCRIPTS['EX4-008::소멸 시'] = bloodReturn;
SCRIPTS['EX4-008::진화 시'] = [{ op: 'trashDeckTop', who: 'self', n: 2 }, { op: 'trashDeckTop', who: 'opponent', n: 2 }, ...bloodReturn];
SCRIPTS['EX4-015::등장 시'] = [{ op: 'draw', who: 'self', n: 1 }, { op: 'draw', who: 'opponent', n: 1 }];
SCRIPTS['EX4-024::등장 시'] = [{ op: 's2_restrictAttackDP', n: 2, dpMax: 4000 }];
SCRIPTS['EX4-031::진화 시'] = [{ op: 's2_dpPerCount', target: 'opponent', amount: -3000, count: (ctx) => digimonStacks(ctx.state, ctx.self).filter(s => s.suspended).length }];
SCRIPTS['EX4-062::자신의 메인 페이즈 개시 시'] = [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).length >= 2, then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];
SCRIPTS['EX4-063::자신의 메인 페이즈 개시 시'] = [{ op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).length <= 1,
  then: [{ op: 's2_playFree', zones: ['hand'], pred: (c) => nameIs(c, '테리어몬') || nameIs(c, '로프몬'), prompt: '코스트 없이 등장시킬 「테리어몬」/「로프몬」',
    then: async (ctx, st) => { st.s2NoEvolve = true; const until = untilOppTurnEnd(ctx.state, ctx.self); (ctx.state.endOfTurnEffects = ctx.state.endOfTurnEffects || []).push({ turnNumber: until, player: ctx.self, label: '자신의 턴 종료 시 소멸', fn: () => { const s2 = ctx.state.players[ctx.self].battle.find(x => x.uid === st.uid); if (s2) S.deleteStack(ctx.state, ctx.self, st.uid, 'trash', 'ownEffect'); } }); } }] }];
const gaia = [{ op: 's2_destroyOthers' }];
SCRIPTS['EX4-069::메인'] = gaia;
SCRIPTS['EX4-069::시큐리티'] = gaia;

// batch 4: helper ops
OPS.s2_retreatPlaced = async (instr, ctx) => { // EX3-013: 《퇴화 N》 on one opponent Digimon, N = cards placed
  const n = scratch(ctx).placed || 0;
  if (n <= 0) return;
  const st = await pickStackOf(ctx, ctx.opp, digimonStacks(ctx.state, ctx.opp), `《퇴화 ${n}》 할 상대 디지몬 선택`);
  if (st) S.retreat(ctx.state, ctx.opp, st.uid, n); // "X마다 《퇴화 1》" 반복(공식 룰링 Q2437/Q2982) — 매번 1장뿐이라 선언 단계가 없다
};
OPS.s2_costRest = async (instr, ctx, helpers) => { // rest an own Digimon (cost) then run `then`
  const opts = digimonStacks(ctx.state, ctx.self).filter(s => !s.suspended && instr.pred(C(s.cardId)));
  const st = await pickStackOf(ctx, ctx.self, opts, instr.prompt || '레스트시킬 자신의 디지몬 선택 (없음 = 발동 안 함)');
  if (!st) return;
  S.restStack(ctx.state, ctx.self, st.uid);
  if (st.suspended) await helpers.runScript(instr.then || [], ctx);
};
OPS.s2_runSelfTag = async (instr, ctx, helpers) => { // BT11-016
  await runCardSegments(ctx, helpers, C(thisStackOf(ctx)?.cardId || ctx.sourceCardId).id || ctx.sourceCardId, instr.tag, { asCardId: ctx.sourceCardId, asStackUid: ctx.sourceStackUid });
};
OPS.s2_trashOppSources = async (instr, ctx) => { // BT13-030: top 2 sources per matching own Digimon/Tamer
  const { state } = ctx;
  const n = instr.count(ctx) * 2;
  if (n <= 0) return;
  const opts = digimonStacks(state, ctx.opp).filter(s => s.sources.length);
  const st = await pickStackOf(ctx, ctx.opp, opts, `진화원을 위에서부터 ${n}장 파기할 상대 디지몬 선택`);
  if (st) S.trashEvoSources(state, ctx.opp, st.uid, n, 'top');
};
OPS.s2_playDiscounted = async (instr, ctx) => { // BT13-056: play from hand with a play-cost reduction
  const { state } = ctx; const who = ctx.self; const pl = state.players[who];
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && instr.pred(C(pl.hand[i])));
  if (!idxs.length) return;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: idxs, prompt: '등장시킬 카드 선택 (등장 코스트 -4)' });
  if (i == null) return;
  const cost = Math.max(0, (C(pl.hand[i]).cost || 0) - instr.discount);
  if (cost > 0) S.spendMemory(state, cost);
  S.playDigimonFresh(state, who, i, {});
};
OPS.s2_trashTopSource = async (instr, ctx) => {
  const st = thisStackOf(ctx);
  if (st && st.sources.length) S.trashEvoSources(ctx.state, ctx.self, st.uid, 1, 'top');
};
OPS.s2_restThisOptional = async (instr, ctx) => {
  const st = thisStackOf(ctx);
  if (st && !st.suspended && await confirmCtx(ctx, `${C(st.cardId).nameKo}을(를) 레스트할까요?`)) S.restStack(ctx.state, ctx.self, st.uid);
};
OPS.s2_destroyLvLE = async (instr, ctx) => { // RB1-031
  const st = thisStackOf(ctx);
  const n = st ? st.sources.length : 0;
  const opts = digimonStacks(ctx.state, ctx.opp).filter(s => (C(s.cardId).level || 0) <= n);
  const t = await pickStackOf(ctx, ctx.opp, opts, `Lv.${n} 이하의 상대 디지몬 선택 (없음 = 안 함)`);
  if (t) destroyStack(ctx, ctx.opp, t);
};

// batch 4: scripts
SCRIPTS['EX3-013::등장 시'] = [{ op: 's2_placeUnder', zones: ['hand', 'trash'], max: 3, distinctId: true, prompt: '진화원 아래에 놓을 카드 (카드 넘버가 서로 다른 사이보그형 레드/블랙 Lv.5)',
  pred: (c) => hasTrait(c, '사이보그형') && c.level === 5 && ((c.colors || []).includes('red') || (c.colors || []).includes('black')) }, { op: 's2_retreatPlaced' }];
SCRIPTS['EX3-023::진화 시'] = [{ op: 's2_playFromSources', holderPred: (s) => hasColor(s, 'blue'), pred: (c) => c.category === 'digimon' && ((hasTraitIncl(c, '수생') && (c.level || 0) <= 4) || ((c.colors || []).includes('blue') && c.level === 3)) },
  { op: 's2_placeUnder', zones: ['hand'], pred: (c) => c.category === 'digimon' && (c.colors || []).includes('blue'), prompt: '이 디지몬의 진화원 아래에 놓을 블루 디지몬 카드' }];
// EX3-015 크랩몬: 블루 자신 디지몬 1마리 《재밍》(턴 종료까지); 진화원에서 등장했었다면 패의 블루 Lv.5 이하 디지몬을 '그 디지몬'(=재밍 받은 디지몬)의 진화원 맨 아래에.
OPS.s2_crabmonPlay = async (instr, ctx) => {
  const { state } = ctx; const who = ctx.self;
  const cands = digimonStacks(state, who).filter(s => hasColor(s, 'blue'));
  const me = thisStackOf(ctx);
  const target = await pickStackOf(ctx, who, cands, '《재밍》을 얻을 블루 디지몬 선택');
  if (!target) return;
  S.grantKeyword(state, who, target.uid, '재밍', undefined, 'turn');
  if (!(me && me.playedFromSources)) return;
  const entries = await pickFromZones(ctx, who, ['hand'], (c) => c.category === 'digimon' && (c.colors || []).includes('blue') && (c.level || 0) <= 5, { max: 1, min: 0, prompt: '진화원 아래에 놓을 블루 Lv.5 이하 디지몬 카드 (선택 사항)' });
  if (!entries.length) return;
  const ids = takeEntries(state, who, entries);
  target.sources.unshift(...ids);
  S.recomputeStackGrants(target);
  S.log(state, `${who} ${ids.map(id => C(id).nameKo).join(', ')}을(를) ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
};
SCRIPTS['EX3-015::등장 시'] = [{ op: 's2_crabmonPlay' }];
SCRIPTS['EX3-024::상대의 메인 페이즈 개시 시'] = [{ op: 's2_costRest', pred: (c) => nameHas(c, '드라몬') || nameHas(c, '엑자몬'), then: [{ op: 's2_forceOppAttack' }] }];
const trial = [{ op: 's2_placeTrial' }];
for (const k of ['EX3-025::소멸 시', 'EX3-036::소멸 시', 'EX3-064::소멸 시', 'EX3-033::진화 시', 'EX3-034::진화 시']) SCRIPTS[k] = trial;
SCRIPTS['EX3-073::진화 시'] = [{ op: 's2_costSource', dest: 'deckBottom', pred: (c) => c.nameKo === '황제드라몬: 드래곤 모드', then: [{ op: 's2_secOff' }] }];
SCRIPTS['BT11-016::자신의 턴'] = [{ op: 's2_runSelfTag', tag: '소멸 시' }];
// ── s2 execution pass: event watchers (state.js parseEventWatcher) whose printed conditions the generic compiler dropped ──
OPS.s2_fn = async (instr, ctx) => { await instr.fn(ctx); };
const s2fn = (f) => [{ op: 's2_fn', fn: f }];
const holderOf = (ctx) => stackByUid(ctx.state, ctx.self, ctx.sourceStackUid);
// BT13-095 【서로의 턴】 이 테이머가 레스트했을 때: DP -3000, 그 후 아구몬/그레이몬이 있다면 메모리 +1
SCRIPTS['BT13-095::서로의 턴'] = [{ op: 'modifyDP', target: 'opponent', amount: -3000, duration: 'turn' },
  { op: 's2_if', test: (ctx) => digimonStacks(ctx.state, ctx.self).some(d => nameHas(C(d.cardId), '아구몬') || nameHas(C(d.cardId), '그레이몬')), then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];
// BT12-092 【자신의 턴】 이 테이머가 레스트했을 때: 패의 명칭에 「그레이몬」을 포함하는 옐로 카드로 코스트를 지불하지 않고 진화
SCRIPTS['BT12-092::자신의 턴'] = [{ op: 's2_evolve', subject: {}, zone: 'hand', cost: { mode: 'free' }, cardPred: (c) => nameHas(c, '그레이몬') && (c.colors || []).includes('yellow') }];
// BT11-074 【상대의 턴】 디지몬이 액티브가 되었을 때: 진화원에 「블랙워그레이몬」/「X항체」가 있다면 가장 등장 코스트가 낮은 상대 디지몬 1마리를 소멸시킬 수 있다
SCRIPTS['BT11-074::상대의 턴@가장 등장 코스트가 낮은'] = s2fn(async (ctx) => {
  const h = holderOf(ctx);
  if (!h || !h.sources.some(id => ['블랙워그레이몬', 'X항체'].includes(C(id).nameKo))) return;
  const all = digimonStacks(ctx.state, ctx.opp).filter(s => C(s.cardId).cost != null);
  if (!all.length) return;
  const min = Math.min(...all.map(s => C(s.cardId).cost));
  const low = all.filter(s => C(s.cardId).cost === min && !S.effectBlocked(ctx.state, ctx.opp, s, 'delete'));
  if (!low.length || !(await confirmCtx(ctx, '가장 등장 코스트가 낮은 상대의 디지몬 1마리를 소멸시키시겠습니까?'))) return;
  const st = await pickStackOf(ctx, ctx.self, low, '소멸시킬 디지몬 선택 (가장 등장 코스트가 낮은 상대 디지몬)');
  if (st) destroyStack(ctx, ctx.opp, st);
});
// BT12-029 【서로의 턴】 이 디지몬이 액티브가 됐을 때: 블루인 자신의 테이머가 있거나 진화원에 「알포스브이드라몬」이 있다면, 가장 Lv이 낮은 상대 디지몬 1마리를 패로
SCRIPTS['BT12-029::서로의 턴'] = s2fn(async (ctx) => {
  const h = holderOf(ctx);
  if (!h || !(tamerStacks(ctx.state, ctx.self).some(t => hasColor(t, 'blue')) || h.sources.some(id => C(id).nameKo === '알포스브이드라몬'))) return;
  const all = digimonStacks(ctx.state, ctx.opp);
  if (!all.length) return;
  const min = Math.min(...all.map(s => C(s.cardId).level ?? 99));
  const low = all.filter(s => (C(s.cardId).level ?? 99) === min);
  const st = await pickStackOf(ctx, ctx.self, low, '패로 되돌릴 디지몬 선택 (가장 Lv이 낮은 상대 디지몬)');
  if (st) bounceStack(ctx, ctx.opp, st, 'hand');
});
// BT11-032 【자신의 턴】 이 디지몬이 액티브가 되었을 때: Lv.3 이하(+블루 테이머 1명마다 +1)의 상대 디지몬 1마리를 패로
SCRIPTS['BT11-032::자신의 턴@Lv.3 이하의 상대의 디지몬'] = s2fn(async (ctx) => {
  const cap = 3 + tamerStacks(ctx.state, ctx.self).filter(t => hasColor(t, 'blue')).length;
  const opts = digimonStacks(ctx.state, ctx.opp).filter(s => (C(s.cardId).level ?? 99) <= cap);
  const st = await pickStackOf(ctx, ctx.self, opts, `패로 되돌릴 Lv.${cap} 이하의 상대 디지몬 선택`);
  if (st) bounceStack(ctx, ctx.opp, st, 'hand');
});
// BT11-033 【서로의 턴】 상대의 패가 효과로 늘어났을 때: 상대의 패 4장마다 메모리 +1
SCRIPTS['BT11-033::서로의 턴'] = s2fn(async (ctx) => { const n = Math.floor(ctx.state.players[ctx.opp].hand.length / 4); if (n > 0) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId); });
// BT11-069 (inherited, 상대의 턴) 디지몬이 액티브가 되었을 때: 이 디지몬이 명칭에 「그레이몬」/「오메가몬」을 포함한다면 상대의 시큐리티를 위에서부터 1장 파기
SCRIPTS['BT11-069::상대의 턴'] = s2fn(async (ctx) => { const h = holderOf(ctx); if (h && (nameHas(C(h.cardId), '그레이몬') || nameHas(C(h.cardId), '오메가몬'))) S.trashTopSecurityByEffect(ctx.state, ctx.opp); });
// BT11-081 【상대의 턴】 상대의 패가 효과로 늘어났을 때: 이 디지몬의 진화원을 선택하여 1장 파기하는 것으로 《2 드로우》
SCRIPTS['BT11-081::상대의 턴@《2 드로우》'] = s2fn(async (ctx) => {
  const h = holderOf(ctx);
  if (!h || !h.sources.length || !(await confirmCtx(ctx, '이 디지몬의 진화원 1장을 파기하고 2장 드로우하시겠습니까?'))) return;
  const idxs = await S.chooseSourceIdxs(ctx.state, ctx.self, h, 1, ctx.choose, null, '파기할 진화원 1장을 선택하세요');
  S.trashEvoSources(ctx.state, ctx.self, h.uid, 1, 'bottom', idxs);
  S.drawCards(ctx.state, ctx.self, 2);
});
// EX4-022 【서로의 턴】 상대의 패가 효과로 늘어났을 때: 자신의 테이머가 있다면 Lv.3의 상대 디지몬 1마리를 패로
SCRIPTS['EX4-022::서로의 턴'] = s2fn(async (ctx) => {
  if (!tamerStacks(ctx.state, ctx.self).length) return;
  const st = await pickStackOf(ctx, ctx.self, digimonStacks(ctx.state, ctx.opp).filter(s => C(s.cardId).level === 3), '패로 되돌릴 Lv.3의 상대 디지몬 선택');
  if (st) bounceStack(ctx, ctx.opp, st, 'hand');
});
// BT13-030 【자신의 턴】[턴에 1회] 로얄 나이츠 디지몬 또는 블루 테이머가 등장했을 때, 진화원을 갖지 않은 상대의 디지몬 1마리를 패로 (trigger = hk below)
SCRIPTS['BT13-030::자신의 턴'] = s2fn(async (ctx) => {
  const st = await pickStackOf(ctx, ctx.self, digimonStacks(ctx.state, ctx.opp).filter(s => s.sources.length === 0), '패로 되돌릴 진화원이 없는 상대 디지몬 선택');
  if (st) bounceStack(ctx, ctx.opp, st, 'hand');
});
// BT11-017 【자신의 턴】 자신의 디지몬의 어택 대상이 변경되었을 때: 이 디지몬을 액티브로 하고, 레드인 자신의 테이머 1명마다 메모리 +1
SCRIPTS['BT11-017::자신의 턴'] = s2fn(async (ctx) => {
  const h = holderOf(ctx);
  if (h) S.unsuspendStack(ctx.state, ctx.self, h.uid);
  const n = tamerStacks(ctx.state, ctx.self).filter(t => hasColor(t, 'red')).length;
  if (n > 0) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
});
// generic event-watcher trigger (state.js parseEventWatcher) is trusted for these because they carry bespoke scripts above
const EW_TRUSTED_S2 = [['BT13-095', '서로의 턴', '레스트했을 때'], ['BT12-092', '자신의 턴', '레스트 했을 때'], ['BT11-074', '상대의 턴', '액티브가 되었을 때'], ['BT12-029', '서로의 턴', '액티브가 됐을 때'], ['BT11-017', '자신의 턴', '어택의 대상이 변경되었을 때'], ['EX4-030', '자신의 턴', '옵션 카드를 사용했을 때'],
  ['BT11-032', '자신의 턴', '액티브가 되었을 때'], ['BT11-033', '서로의 턴', '늘어났을 때'], ['BT11-069', '상대의 턴', '액티브가 되었을 때'], ['BT11-081', '상대의 턴', '늘어났을 때'], ['EX4-022', '서로의 턴', '늘어났을 때']];
// EX4-030 【자신의 턴】 코스트 2 이상의 옵션을 사용했을 때: 이 디지몬의 진화원에서 「도사몬」 또는 옐로/블루인 Lv.4 이하 디지몬 카드 1장을 코스트 없이 등장
OPS.s2_playFromOwnSources = (instr, ctx) => OPS.s2_playFromSources({ ...instr, holderPred: (s) => s.uid === ctx.sourceStackUid }, ctx);
SCRIPTS['EX4-030::자신의 턴'] = [{ op: 's2_playFromOwnSources', prompt: '이 디지몬의 진화원에서 등장시킬 카드 (선택 안 함 = 안 함)',
  pred: (c) => c.category === 'digimon' && (c.nameKo === '도사몬' || ((c.colors || []).some(x => ['yellow', 'blue'].includes(x)) && (c.level || 0) <= 4)) }];
// BT11-016 【소멸 시】: red, DP <= 3000 (+2000 per own red Tamer), trait contains 조/새/병아리/수/짐승 (minus 수장룡형/수생형/수생포유류형/정보수집 타입)
SCRIPTS['BT11-016::소멸 시'] = [{ op: 's2_playFreeCtx', prompt: '코스트를 지불하지 않고 등장시킬 레드 디지몬 선택', predCtx: (ctx) => {
  const cap = 3000 + 2000 * tamerStacks(ctx.state, ctx.self).filter(t => hasColor(t, 'red')).length;
  return (c) => (c.colors || []).includes('red') && c.dp != null && c.dp <= cap
    && (c.types || []).some(t => ['조', '새', '병아리', '수', '짐승'].some(k => t.includes(k)) && !['수장룡형', '수생형', '수생포유류형', '정보수집 타입'].includes(t));
} }];
SCRIPTS['BT13-017::등장 시'] = [{ op: 's2_destroySumDP', limit: (ctx) => 6000 + 2000 * Math.max(0, digimonStacks(ctx.state, ctx.self).length - 1) }];
SCRIPTS['BT13-021::어택 시'] = [{ op: 'draw', who: 'self', n: 1 }, { op: 'draw', who: 'opponent', n: 1 }];
const evolveViaSource = (into, needTamer, under) => [{ op: 's2_handEvolveThis', fixedCost: 3,
  need: (ctx) => tamerStacks(ctx.state, ctx.self).some(t => C(t.cardId).nameKo === needTamer),
  subjects: (ctx) => digimonStacks(ctx.state, ctx.self).filter(s => C(s.cardId).nameKo === into),
  cost: async (ctx, dg) => { const pl = ctx.state.players[ctx.self]; const i = pl.hand.findIndex(id => C(id).nameKo === under); if (i === -1) return null; dg.sources.unshift(pl.hand.splice(i, 1)[0]); S.recomputeStackGrants(dg); return true; } }];
SCRIPTS['BT13-028::메인'] = evolveViaSource('젤리몬', '이청솔', '테슬라젤리몬');
SCRIPTS['BT13-055::메인'] = evolveViaSource('앙고라몬', '문유리', '진바앙고라몬');
SCRIPTS['BT13-029::어택 시'] = [{ op: 's2_if', test: (ctx) => ctx.state.players[ctx.opp].hand.length >= 8, then: s2fn(async (ctx) => { const st = holderOf(ctx); if (st) st.noRedirectUntil = ctx.state.turnNumber; }) }]; // state.js isAttackTargetImmune / cannotBeBlockedBy read noRedirectUntil (the old '어택대상고정' keyword was never consumed)
SCRIPTS['BT13-030::등장 시'] = [{ op: 's2_trashOppSources', count: (ctx) => digimonStacks(ctx.state, ctx.self).filter(s => hasTrait(C(s.cardId), '로얄 나이츠')).length + tamerStacks(ctx.state, ctx.self).filter(t => hasColor(t, 'blue')).length }];
SCRIPTS['BT13-031::진화 시'] = [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { category: 'tamer' }, dest: 'hand' }];
SCRIPTS['BT13-056::진화 시'] = [{ op: 's2_playDiscounted', discount: 4, pred: (c) => hasTrait(c, '로얄 나이츠') || (c.colors || []).includes('green') }];
SCRIPTS['BT13-058::자신의 턴 종료 시'] = [{ op: 's2_trashTopSource' }, { op: 's2_unsuspendAllOwn' }];
SCRIPTS['BT13-060::진화 시'] = [{ op: 's2_restPick', target: 'opponent', category: 'digimon' }, { op: 's2_restPick', target: 'opponent', category: 'tamer' }, { op: 's2_noActiveOpp' }];
SCRIPTS['BT13-072::자신의 턴 종료 시'] = [{ op: 's2_placeUnder', zones: ['hand'], pred: (c) => c.category === 'digimon' && hasTrait(c, 'X항체'), prompt: '이 디지몬의 진화원 아래에 놓을 「X항체」 디지몬 카드' }];
SCRIPTS['BT13-077::등장 시'] = [{ op: 's2_fxImmune', scope: 'digimon' }];
SCRIPTS['BT13-077::상대의 턴 종료 시'] = [{ op: 's2_forceOppAttack', selfChooses: true }];
SCRIPTS['BT13-088::등장 시'] = [{ op: 's2_placeUnder', zones: ['trash'], top: true, min: 1, pred: (c) => c.nameKo === '벨페몬: 레이지 모드', prompt: '이 디지몬의 진화원 위에 놓을 「벨페몬: 레이지 모드」' },
  { op: 's2_if', test: (ctx) => (scratch(ctx).placed || 0) > 0, then: [{ op: 's2_restrictThisAttack' }, { op: 's2_fxImmune', scope: 'all' }] }];
SCRIPTS['BT13-090::등장 시'] = [{ op: 's2_returnFromTrash', pred: (c) => nameHas(c, '루체몬') || hasTrait(c, '로얄 나이츠') }];
SCRIPTS['BT13-091::상대의 턴 종료 시'] = [{ op: 's2_if', test: (ctx) => C(thisStackOf(ctx)?.cardId || '').nameKo === '벨페몬: 슬립 모드', then: [{ op: 's2_trashTopSource' }] }];
SCRIPTS['BT13-092::진화 시'] = [{ op: 's2_lookHandTrash' }, { op: 's2_if', test: (ctx) => ctx.state.players[ctx.opp].hand.length <= 7, then: [{ op: 'securityTopToHand', who: 'opponent', n: 1 }] }];
SCRIPTS['BT13-093::소멸 시'] = [{ op: 's2_placeUnder', zones: ['hand'], target: { raisingName: '위그드라실_7D6' }, min: 1, pred: (c) => c.category === 'digimon' && hasTrait(c, '로얄 나이츠'), prompt: '「위그드라실_7D6」의 진화원 아래에 놓을 카드' }];
SCRIPTS['BT13-095::등장 시'] = [{ op: 's2_restThisOptional' }];
SCRIPTS['BT13-102::등장 시'] = [{ op: 's2_oppMayDiscard', pred: (c) => c.category === 'tamer' || c.category === 'option', else: [{ op: 'draw', who: 'self', n: 1 }, { op: 'gainMemory', who: 'self', n: 1 }] }];
SCRIPTS['RB1-016::진화 시'] = [{ op: 's2_discardUpTo', max: 2, pred: (c) => (c.colors || []).includes('blue') }, { op: 's2_pluck' }, { op: 's2_bounceNoSource' }];
SCRIPTS['P-089::진화 시'] = [{ op: 's2_discardUpTo', max: 3, pred: (c) => (c.colors || []).includes('blue') }, { op: 's2_pluck', optional: true }, { op: 's2_preventRestNoUnder' }];
// RB1-019 【진화 시】: every Lv.3 Digimon goes on top of its owner's security; then until the opponent's turn end all Lv.4+ opponent Digimon get 《S 어택 -1》 and DP -3000
// (the generic compile only did the second half and skipped the security placement).
SCRIPTS['RB1-019::진화 시'] = [{ op: 's2_lv3ToSecurity' }, ...s2fn(async (ctx) => {
  for (const st of digimonStacks(ctx.state, ctx.opp).filter(s => (C(s.cardId).level || 0) >= 4)) {
    S.grantKeyword(ctx.state, ctx.opp, st.uid, '시큐리티어택', -1, 'opponentTurn');
    S.modifyDP(ctx.state, ctx.opp, st.uid, -3000, 'opponentTurn');
  }
})];
SCRIPTS['RB1-019::어택 시'] = [{ op: 's2_costSource', pred: (c) => nameHas(c, '워매몬'), then: [{ op: 's2_shotDown' }] }];
SCRIPTS['RB1-027::등장 시'] = [{ op: 's2_peekSecurity' }];
SCRIPTS['RB1-031::진화 시'] = [{ op: 's2_placeUnder', zones: ['trash'], pred: (c) => c.category === 'digimon' && nameHas(c, '감마몬'), prompt: '진화원 아래에 놓을 「감마몬」 디지몬 카드' }, { op: 's2_destroyLvLE' }];
SCRIPTS['BT14-013::자신의 메인 페이즈 개시 시'] = [{ op: 's2_stackEvoMod', mod: { delta: -1, nameIncludes: '티라노몬', traitAny: ['공룡형', '각룡형'] } }];
SCRIPTS['BT14-018::등장 시'] = [{ op: 's2_tokens', ids: ['S2-TOKEN-AMON', 'S2-TOKEN-UMON'] }];
SCRIPTS['BT14-027::등장 시'] = [{ op: 's2_bounceLevelAll', level: 3 }];
SCRIPTS['BT14-028::서로의 턴'] = [{ op: 's2_battleImmune' }];
SCRIPTS['BT14-006::자신의 턴'] = [{ op: 's2_evolve', subject: { self: true }, zone: 'trash', fixedFn: (ctx) => ctx.trigger?.evt?.cardId }];
// tags with several triggers share one script
SCRIPTS['BT13-056::메인'] = SCRIPTS['BT13-056::진화 시'];
SCRIPTS['BT13-017::진화 시'] = SCRIPTS['BT13-017::등장 시'];
SCRIPTS['BT13-030::진화 시'] = SCRIPTS['BT13-030::등장 시'];
SCRIPTS['EX3-013::진화 시'] = SCRIPTS['EX3-013::등장 시'];
SCRIPTS['BT13-077::진화 시'] = SCRIPTS['BT13-077::등장 시'];
SCRIPTS['BT13-088::진화 시'] = SCRIPTS['BT13-088::등장 시'];
SCRIPTS['BT13-090::진화 시'] = SCRIPTS['BT13-090::등장 시'];
SCRIPTS['BT14-018::진화 시'] = SCRIPTS['BT14-018::등장 시'];
SCRIPTS['BT14-027::진화 시'] = SCRIPTS['BT14-027::등장 시'];
SCRIPTS['RB1-016::어택 시'] = SCRIPTS['RB1-016::진화 시'];
SCRIPTS['RB1-027::진화 시'] = SCRIPTS['RB1-027::등장 시'];
SCRIPTS['BT11-043::진화 시'] = SCRIPTS['BT11-043::등장 시'];
SCRIPTS['BT11-088::진화 시'] = SCRIPTS['BT11-088::등장 시'];
SCRIPTS['EX4-031::어택 시'] = SCRIPTS['EX4-031::진화 시'];

// ───────────────────────── HOOKS (continuous / replacement / event descriptors; consumed by state.js) ─────────────────────────
export const HOOKS = {};
const hk = (id, tag, has, d, src = 'effectKo') => { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); };
const hki = (id, tag, has, d) => hk(id, tag, has, d, 'inheritedKo');
for (const [id, tag, has] of EW_TRUSTED_S2) hk(id, tag, has, { ewTrusted: true });
const anyTamer = (state) => ['p1', 'p2'].some(p => tamerStacks(state, p).length > 0);
const lv5Sources = (h) => h.sources.map((id, i) => i).filter(i => C(h.sources[i]).level === 5);
const jelly = (c) => (c.nameKo || '').includes('젤리몬');
const hasSAtk = (st) => S.securityAttackBonus(st) !== 0 || S.hasKeyword(st, '시큐리티어택');
const onceOk = (holder, key) => S.turnUsesRemaining(holder, S.onceLimitKey(key, ['s2']), 1) > 0;
const onceMark = (holder, key) => S.markTurnEffectUsed(holder, S.onceLimitKey(key, ['s2']));
const takeFromTrashToDeck = (state, p, pred, n) => { const tr = state.players[p].trash; for (let i = tr.length - 1; i >= 0 && n > 0; i--) if (pred(C(tr[i]))) { state.players[p].deck.push(...tr.splice(i, 1)); n--; } };

// ── replacement / protection
hk('ST13-13', '상대의 턴', '소멸하지', { preventLeave: (s, hp, h, t, tp, cause, mode) => t === h && mode === 'delete' && cause === 'effect' });
hk('BT11-060', '서로의 턴', '되돌아가지', { preventLeave: (s, hp, h, t, tp, cause, mode) => t === h && mode === 'bounce' && cause === 'effect' });
hk('RB1-027', '서로의 턴', '테이머가 있는 동안', {
  preventLeave: (s, hp, h, t, tp, cause, mode) => t === h && mode === 'delete' && cause === 'effect' && anyTamer(s),
  grantKw: (s, hp, h, t) => (t === h && anyTamer(s) ? ['블로커'] : []) });
hk('BT11-082', '서로의 턴', '노유빈', { preventLeave: (s, hp, h, t, tp, cause, mode) => mode === 'delete' && C(t.cardId).nameKo === '노유빈' });
hki('ST13-14', '상대의 턴', '라그나로드몬', { effectImmune: (s, hp, h, t, tp, o) => t === h && C(h.cardId).nameKo === '라그나로드몬' && !!o.src && (o.src.isDigimon || o.src.category === 'digimon') });
hk('EX3-013', '서로의 턴', '소멸할 때', { preventLeave: (s, hp, h, t, tp, cause, mode) => {
  if (t !== h || lv5Sources(h).length < 2) return false;
  if (!askUser(`${C(h.cardId).nameKo}: 진화원의 Lv.5 카드 2장을 파기하고 ${mode === 'delete' ? '소멸' : '되돌아가'}지 않게 할까요?`)) return false;
  const ids = lv5Sources(h).slice(-2).sort((a, b) => b - a).flatMap(i => h.sources.splice(i, 1));
  s.players[tp].trash.push(...ids); S.recomputeStackGrants(h); return true; } });
const xGuard = { preventLeave: (s, hp, h, t, tp, cause, mode) => {
  if (t !== h || cause === 'battle' || !(nameHas(C(h.cardId), '그레이몬') || nameHas(C(h.cardId), '오메가몬'))) return false;
  const i = h.sources.map((id, k) => k).filter(k => isX(C(h.sources[k]))).pop();
  if (i === undefined) return false;
  if (!askUser(`${C(h.cardId).nameKo}: 진화원의 「X항체」 1장을 덱 아래로 되돌리고 ${mode === 'delete' ? '소멸' : '되돌아가'}지 않게 할까요?`)) return false;
  s.players[tp].deck.push(...h.sources.splice(i, 1)); S.recomputeStackGrants(h); return true; } };
hki('BT11-062', '서로의 턴', '소멸하지 않고', xGuard);
hki('BT11-064', '서로의 턴', '소멸하지 않고', xGuard);
hk('RB1-016', '서로의 턴', '젤리몬', { preventLeave: (s, hp, h, t, tp, cause, mode, id) => {
  // shares the once-per-turn key with state.js's generic trySurviveByPrintedAbility (which already parses this same printed text) so the two can't stack
  const k = S.onceLimitKey(id, ['서로의 턴']);
  if (mode !== 'delete' || !hasColor(t, 'blue') || C(t.cardId).category !== 'digimon' || S.turnUsesRemaining(h, k, 1) <= 0) return false;
  if (s.players[tp].trash.filter(x => jelly(C(x))).length < 3) return false;
  if (!askUser(`${C(h.cardId).nameKo}: 트래시의 「젤리몬」 3장을 덱 아래로 되돌리고 ${C(t.cardId).nameKo}이(가) 소멸하지 않게 할까요?`)) return false;
  S.markTurnEffectUsed(h, k); takeFromTrashToDeck(s, tp, jelly, 3); return true; } });
// "소멸할 때" side effect (BT12-072) / leaving the area (BT14-018): queue the segment's script
hk('BT12-072', '서로의 턴', '소멸할 때', { onLeave: (s, hp, h) => onceOk(h, 'BT12-072') && (onceMark(h, 'BT12-072'), true) });
hk('BT12-072', '서로의 턴', '진화원에 있는', {});
hk('BT14-018', '서로의 턴', '벗어날 때', { onLeave: () => true });
hk('BT10-084', '상대의 턴', '진화원을 파기할 때', {});
// ── DP / S-attack / keywords
const royalOrSister = (c) => nameHas(c, '시스터몬') || hasTrait(c, '로얄 나이츠');
hk('BT13-017', '서로의 턴', '시스터몬', { dp: (s, hp, h, t, tp) => (tp === hp && C(t.cardId).category === 'digimon' ? 1000 * digimonStacks(s, hp).filter(x => x !== h && royalOrSister(C(x.cardId))).length : 0) });
// continuous stat lines that were only compiled as one-shot scripts (never applied) before the s2 execution pass
hk('BT11-091', '자신의 턴', 'DP +1000', { dp: (s, hp, h, t, tp) => (tp === hp && C(t.cardId).category === 'digimon' ? 1000 : 0) });
hki('BT13-021', '서로의 턴', '8장 이상', { dp: (s, hp, h, t) => (t === h && s.players[oppOf(hp)].hand.length >= 8 ? 1000 : 0) });
hk('BT12-014', '자신의 턴', 'S 어택', { sAtk: (s, hp, h, t) => (t === h && h.sources.length >= 4 ? 1 : 0) });
hk('BT12-043', '자신의 턴', '최건우', {
  dp: (s, hp, h, t, tp) => (tp === hp && nameIs(C(t.cardId), '최건우') ? 3000 : 0),
  sAtk: (s, hp, h, t) => (nameIs(C(t.cardId), '최건우') ? 1 : 0) });
const royalSrc = (h) => h.sources.filter(id => hasTrait(C(id), '로얄 나이츠')).length;
hk('BT10-112', '서로의 턴', '관통', {
  grantKw: (s, hp, h, t) => (t === h && royalSrc(h) ? ['관통', '블로커'] : []),
  sAtk: (s, hp, h, t) => (t === h ? royalSrc(h) : 0) });
// ── attack / block / target
// EX3-033 【상대의 턴】 continuous 《블로커》 grants (the printed lines were only compiled as one-shot grant scripts before)
hk('EX3-033', '상대의 턴', '4대용의 시련', { grantKw: (s, hp, h, t) => (t === h && (digimonStacks(s, hp).some(d => hasTrait(C(d.cardId), '4대용')) || s.players[hp].battle.some(x => C(x.cardId).nameKo === '4대용의 시련')) ? ['블로커'] : []) });
hki('EX3-033', '상대의 턴', '블로커', { grantKw: (s, hp, h, t) => (C(t.cardId).category === 'digimon' && hasTrait(C(t.cardId), '4대용') ? ['블로커'] : []) });
hk('EX3-060', '서로의 턴', '어택과 블록', { noAttack: (s, hp, h) => h.sources.length === 0, noBlock: (s, hp, h, t) => t === h && h.sources.length === 0 });
hk('BT10-042', '상대의 턴', '어택할 수 없고', {
  atkTargetBlocked: (s, hp, h, ap, a, t) => t === h && hasSAtk(a),
  suppressTrigger: (s, hp, h, tp, t, tag) => tp !== hp && (tag === '진화 시' || tag === '어택 시') && hasSAtk(t) });
hk('EX4-042', '자신의 턴', '블록당하지', { s1blocked: (s, hp, h, i) => i.attackerP === hp && i.attacker && (i.attacker === h || (C(i.attacker.cardId).category === 'digimon' && (nameHas(C(i.attacker.cardId), '나이트몬') || nameHas(C(i.attacker.cardId), '나이츠몬')))) });
hk('RB1-006', '자신의 턴', '액티브 상태인', { attackAnyActive: (s, hp) => tamerStacks(s, hp).some(t => hasColor(t, 'red')) });
hk('BT12-057', '서로의 턴', '액티브가 되지', { noUnsuspendOthers: (s, hp, h, st) => st !== h && ['digimon', 'tamer'].includes(C(st.cardId).category) });
hk('BT13-007', '자신의 턴', '진화할 수 없다', {});
hk('BT14-009', '서로의 턴', '등장시킬 수 없다', { s1cannotPlay: () => true });
hk('BT12-112', '자신의 턴', '옵션 카드의', {});
for (const id of ['EX3-020', 'EX3-041']) hk(id, '자신의 턴', '조그레스', { jogressAlias: (target) => (C(target).nameKo === '엑자몬' ? [{ nameKo: C(id).nameKo, level: 6 }] : []) });
// ── evolve / play cost (confirm + pay)
const underCards = (state, p) => tamerStacks(state, p).filter(t => t.sources.length);
const saveOption = (s, hp, h, ev, tgtId) => {
  const tgt = C(tgtId);
  if (tgt.category !== 'digimon' || !hasSave(tgt) || h.suspended || !underCards(s, hp).length) return null;
  return { label: `${C(h.cardId).nameKo}를 레스트하고 테이머 아래의 카드 1장을 ${C(ev.cardId).nameKo}의 진화원 아래에 놓아 진화 코스트 -1?`, apply: () => {
    S.restStack(s, hp, h.uid);
    const t = h.sources.length ? h : underCards(s, hp)[0]; const id = t.sources.shift();
    ev.sources.unshift(id); S.recomputeStackGrants(ev); return -1; } };
};
for (const id of ['BT12-087', 'BT12-091', 'BT12-093', 'BT12-094', 'BT12-096', 'BT12-097']) hk(id, '자신의 턴', '지불하는 진화 코스트', { evoOption: saveOption });
const restOpt = (cond) => (s, hp, h, ev, tgtId) => (!h.suspended && cond(ev, C(tgtId)) ? { label: `${C(h.cardId).nameKo}를 레스트시켜 진화 코스트 -1?`, apply: () => { S.restStack(s, hp, h.uid); return -1; } } : null);
hk('BT11-091', '자신의 턴', 'Lv.5 이상', { evoOption: restOpt((ev, t) => t.category === 'digimon' && hasColor(ev, 'green') && (t.level || 0) >= 5) });
const beastOk = (c) => (c.types || []).some(t => (t.includes('수') || t.includes('짐승')) && !['수장룡형', '수생형', '수생포유류형', '정보수집 타입'].includes(t));
hk('RB1-034', '자신의 턴', '진화 코스트', { evoOption: restOpt((ev, t) => t.category === 'digimon' && (t.colors || []).includes('green') && beastOk(t)) });
hk('EX4-063', '자신의 턴', '테리어몬', { evoOption: restOpt((ev, t) => t.category === 'digimon' && ev.sources.some(id => nameIs(C(id), '테리어몬') || nameIs(C(id), '로프몬'))) });
hk('BT11-064', '자신의 턴', '색 1색마다', { evoDiscount: (s, hp, h, ev, tgtId) => (h === ev && C(tgtId).category === 'digimon' && nameHas(C(tgtId), '그레이몬') ? -(C(tgtId).colors || []).length : 0) });
hk('EX3-040', '자신의 턴', '레스트시키는 것으로', { playDiscount: (s, hp, h, cid) => (!h.suspended && C(cid).category === 'digimon' && (C(cid).colors || []).includes('green') ? { label: `${C(h.cardId).nameKo}를 레스트시켜 등장 코스트 -1?`, apply: () => { S.restStack(s, hp, h.uid); return -1; } } : null) });
hk('BT13-007', '자신의 턴', '등장 코스트 -4', { playDiscount: (s, hp, h, cid, ) => {
  if (h !== s.players[hp].raising || !hasTrait(C(cid), '로얄 나이츠') || C(cid).category !== 'digimon' || h.sources.length >= 4 || !onceOk(h, 'BT13-007')) return null;
  const n = 4 - h.sources.length;
  return { label: `「위그드라실_7D6」: 등장 코스트 -${n}?`, apply: () => { onceMark(h, 'BT13-007'); return -n; } }; } });
hk('BT10-093', '자신의 턴', '바그라군', { playDiscount: (s, hp, h, cid) => {
  const tgt = C(cid);
  if (tgt.category !== 'digimon' || !hasTrait(tgt, '바그라군') || (tgt.level || 0) < 4 || !onceOk(h, 'BT10-093')) return null;
  const mats = tamerStacks(s, hp).flatMap(t => t.sources.filter(id => C(id).category === 'digimon' && (C(id).colors || []).includes('purple')).map(id => ({ kind: 'tamer', tamerUid: t.uid, cardId: id }))).slice(0, 3);
  if (!mats.length) return null;
  return { label: `테이머 아래의 퍼플 디지몬 ${mats.length}장을 진화원에 놓고 등장 코스트 -${2 * mats.length}?`, apply: () => { onceMark(h, 'BT10-093'); s._s2PlayMat = mats; return -2 * mats.length; } }; } });
for (const id of ['BT10-087', 'BT10-088', 'BT11-095']) hk(id, '자신의 턴', '디지크로스', { xrosExtra: (s, hp, h, cid) => (isXros(cid) ? { under: 99 } : null) });
hk('EX4-062', '서로의 턴', '디지크로스', { xrosExtra: (s, hp, h, cid) => (isXros(cid) && (hasTrait(C(cid), '블루 플레어') || hasTrait(C(cid), '트와일라잇')) ? { under: 1, trash: 1 } : null) });
// ── defender-side redirect / attack-ending options
const attackedPlayer = (state) => state.attackCtx && state.attackCtx.targetKind === 'player';
const redirLimitOk = (holder, id) => S.turnUsesRemaining(holder, S.onceLimitKey(id, ['어택대상변경']), 1) > 0;
hki('BT11-070', '상대의 턴', '벰몬', { redirectOptions: (s, hp, h, ap, a) => {
  const rag = digimonStacks(s, hp).find(d => nameIs(C(d.cardId), '라그나몬') && d.sources.filter(id => nameIs(C(id), '벰몬')).length >= 2);
  if (!rag || !redirLimitOk(h, 'BT11-070')) return [];
  return [{ targetUid: h.uid, limit: 1, label: `${C(rag.cardId).nameKo}의 「벰몬」 2장을 덱 아래로 되돌리고 ${C(h.cardId).nameKo}(으)로 대상 변경`, pay: async () => {
    for (let n = 0; n < 2; n++) { const i = rag.sources.findIndex(id => nameIs(C(id), '벰몬')); s.players[hp].deck.push(...rag.sources.splice(i, 1)); } S.recomputeStackGrants(rag); return true; } }]; } });
hk('BT11-074', '상대의 턴', '가장 DP가 높은', { redirectOptions: (s, hp, h, ap, a) => {
  if (!redirLimitOk(h, 'BT11-074')) return [];
  const max = Math.max(...digimonStacks(s, ap).map(x => S.effectiveDP(s, ap, x)));
  return S.effectiveDP(s, ap, a) >= max ? [{ targetUid: h.uid, limit: 1 }] : []; } });
hk('BT11-092', '상대의 턴', '플레이어에게 어택했을', { redirectOptions: (s, hp, h) => {
  if (!attackedPlayer(s) || h.suspended) return [];
  return digimonStacks(s, hp).filter(d => C(d.cardId).level === 6 && hasTrait(C(d.cardId), '머신형')).map(d => ({ targetUid: d.uid, label: `${C(h.cardId).nameKo} 레스트 → ${C(d.cardId).nameKo}(으)로 대상 변경`, pay: async () => { S.restStack(s, hp, h.uid); return h.suspended; } })); } });
hki('EX4-047', '상대의 턴', '그레이나이츠몬', { redirectOptions: (s, hp, h) => (C(h.cardId).nameKo === '그레이나이츠몬' && redirLimitOk(h, 'EX4-047') ? [{ targetUid: h.uid, limit: 1 }] : []) });
hk('BT13-088', '상대의 턴', '어택을 종료', { redirectOptions: (s, hp, h) => (s.players[hp].hand.length >= 2 && onceOk(h, 'BT13-088') ? [{ endsAttack: true, label: '패 2장을 파기하고 어택 종료', pay: async (choose) => {
  const pl = s.players[hp]; const r = await choose('pickFromHandIndexes', { player: hp, eligibleIdxs: pl.hand.map((x, i) => i), n: 2, prompt: '파기할 패 2장 선택' });
  if (!r || r.length < 2) return false; onceMark(h, 'BT13-088'); for (const i of r.slice().sort((a, b) => b - a)) S.trashFromHand(s, hp, i); return true; } }] : []) });
hk('P-089', '상대의 턴', '어택을 종료', { redirectOptions: (s, hp, h) => (s.players[hp].trash.filter(x => jelly(C(x))).length >= 3 && onceOk(h, 'P-089') ? [{ endsAttack: true, label: '트래시의 「젤리몬」 3장을 덱 아래로 되돌리고 어택 종료', pay: async () => { onceMark(h, 'P-089'); takeFromTrashToDeck(s, hp, jelly, 3); return true; } }] : []) });
// ── event watchers (each needs a SCRIPTS entry of the same key)
hk('BT10-077', '상대의 턴', '패가 늘어났을', { limit: 1, events: { handIncrease: (s, hp, h, i) => i.owner === oppOf(hp) } });
hk('ST13-14', '자신의 턴', '진화원이 늘어났을', { limit: 1, events: { sourcesAdded: (s, hp, h, i) => i.stack === h && i.srcPlayer === hp } });
hk('BT11-016', '자신의 턴', '줄어들었을', { limit: 1, events: { securityDecrease: (s, hp, h, i) => i.owner === oppOf(hp) } });
hki('BT12-042', '서로의 턴', '소멸됐을', { limit: 1, events: { delete: (s, hp, h, i) => i.owner === hp && !!i.stack && C(i.stack.cardId).category === 'tamer' } });
hki('EX3-023', '서로의 턴', '진화원에서', { limit: 1, events: { playFromSources: (s, hp, h, i) => i.owner === hp } });
for (const id of ['EX4-032', 'EX4-033', 'EX4-034']) hki(id, '자신의 턴', '연계', { events: { chainRest: (s, hp, h, i) => i.owner === hp } });
hki('BT14-006', '자신의 턴', '파기되었을', { events: { discard: (s, hp, h, i) => {
  if (i.owner !== hp || !i.cardId) return false; const c = C(i.cardId);
  return c.category === 'digimon' && (hasTrait(c, '마수형') || hasTrait(c, 'SoC')); } } });
hk('BT10-093', '서로의 턴', '놓였을 때', { limit: 1, events: { underTamer: (s, hp, h, i) => i.stack === h && i.owner === hp && (i.cards || []).some(id => (C(id).colors || []).includes('purple')) } });
hk('BT13-030', '자신의 턴', '등장했을 때', { limit: 1, events: { play: (s, hp, h, i) => i.owner === hp && !!i.stack && ((C(i.stack.cardId).category === 'digimon' && hasTrait(C(i.stack.cardId), '로얄 나이츠')) || (C(i.stack.cardId).category === 'tamer' && hasColor(i.stack, 'blue'))) } });
hk('BT14-028', '서로의 턴', '진화원이 효과로', { limit: 1, events: { sourcesTrashed: (s, hp, h, i) => i.owner === oppOf(hp) && i.cause === 'effect' } });

OPS.s2_oppDiscardPayload = async (instr, ctx) => { // BT10-077: the opponent discards as many cards as their hand grew
  const { state } = ctx; const op = ctx.opp; const opl = state.players[op];
  const n = Math.min(ctx.trigger?.evt?.added || 1, opl.hand.length);
  if (n <= 0) return;
  const r = await ctx.choose('pickFromHandIndexes', { player: op, eligibleIdxs: opl.hand.map((x, i) => i), n, prompt: `${op}: 패 ${n}장을 파기` });
  for (const i of (r || []).slice().sort((a, b) => b - a)) S.trashFromHand(state, op, i);
};
OPS.s2_bounceSameLevel = async (instr, ctx) => { // EX3-023
  const lv = ctx.trigger?.evt?.level;
  const opts = digimonStacks(ctx.state, ctx.opp).filter(s => C(s.cardId).level === lv);
  const st = await pickStackOf(ctx, ctx.opp, opts, `Lv.${lv}의 상대 디지몬을 덱 아래로 되돌립니다 (없음 = 안 함)`);
  if (st) bounceStack(ctx, ctx.opp, st, 'deckBottom');
};
SCRIPTS['BT10-077::상대의 턴'] = [{ op: 's2_costSource', pred: () => true, prompt: '파기할 이 디지몬의 진화원 1장 선택', optional: true, confirm: '진화원 1장을 파기하고 상대의 패를 파기시킬까요?', then: [{ op: 's2_oppDiscardPayload' }] }];
SCRIPTS['ST13-14::자신의 턴'] = [{ op: 's2_protectThis' }];
SCRIPTS['EX3-023::서로의 턴'] = [{ op: 's2_bounceSameLevel' }];

SCRIPTS['EX3-058::자신의 턴 종료 시'] = [{ op: 'jogressEffect', who: 'self' }];

// @@PART3@@
