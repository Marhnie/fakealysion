// Shard 4 — bespoke scripts (SCRIPTS), custom ops (OPS) and continuous / replacement / event hooks (HOOKS).
//
// SCRIPTS keys: 'CARD-ID::firstTag' (or 'CARD-ID::firstTag@needle' when a card has several segments with the same first
// tag — the needle must occur in that segment's text).  OPS are prefixed s4_.  HOOKS are consumed by state.js
// (see the "per-card bespoke hooks" block there); a hook descriptor identifies its printed segment via tag + has.
import * as S from '../state.js';
import * as E from '../engine.js';
import * as Fx from '../effects.js';

// ───────────────────────── small helpers ─────────────────────────
const C = (id) => S.card(id);
const oppOf = (p) => (p === 'p1' ? 'p2' : 'p1');
const areaOf = (st, p) => [st.players[p].raising, ...st.players[p].battle].filter(Boolean);
const stackByUid = (st, p, uid) => (uid ? areaOf(st, p).find(s => s.uid === uid) || null : null);
const findStackAny = (st, uid) => { for (const p of ['p1', 'p2']) { const s = stackByUid(st, p, uid); if (s) return { p, s }; } return null; };
const ownerOf = (st, stack) => ['p1', 'p2'].find(p => areaOf(st, p).includes(stack)) || null;
const digimonOf = (st, p) => st.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const tamersOf = (st, p) => st.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const digiOrTamer = (st, p) => st.players[p].battle.filter(s => ['digimon', 'tamer'].includes(C(s.cardId).category));
const thisStack = (ctx) => stackByUid(ctx.state, ctx.self, ctx.sourceStackUid);
const V = (ctx) => (ctx.s4 ||= {});
const typesOf = (cid) => C(cid).types || [];
const hasTrait = (cid, t) => typesOf(cid).some(x => x.toLowerCase() === String(t).toLowerCase());
const hasTraitAny = (cid, ts) => ts.some(t => hasTrait(cid, t));
const hasTraitLike = (cid, t) => typesOf(cid).some(x => x.includes(t));
// Names a card counts as: its own plus 〈룰〉명칭: 「A」/「B」로도 취급한다.
const treatedAs = (cid) => S.cardNames(cid).slice(1); // central parser (state.js cardNameInfo)
const namesOfCard = (cid) => [C(cid).nameKo, ...treatedAs(cid)];
const isNamed = (cid, n) => namesOfCard(cid).includes(n);
const isNamedAny = (cid, ns) => ns.some(n => isNamed(cid, n));
const nameHas = (cid, n) => namesOfCard(cid).some(x => x.includes(n));
const hasColor = (cid, cols) => (C(cid).colors || []).some(c => cols.includes(c));
const lvOf = (cid) => C(cid).level ?? 0;
const stackColors = (s) => S.stackColors(s);
const stackHasColor = (s, cols) => stackColors(s).some(c => cols.includes(c));
const stackTraits = (st, s) => S.effectiveInfo(st, s, ownerOf(st, s)).traits; // central accessor
const stackHasTrait = (st, s, t) => stackTraits(st, s).some(x => x.toLowerCase() === String(t).toLowerCase());
const stackNames = (st, s) => S.effectiveInfo(st, s, ownerOf(st, s)).names; // central accessor (원래 명칭 변경 + 〈룰〉 + hooks)
const stackIsNamed = (st, s, n) => stackNames(st, s).includes(n);
const stackNameHas = (st, s, n) => stackNames(st, s).some(x => x.includes(n));
const srcHasName = (s, n) => s.sources.some(id => isNamed(id, n));
const isDigimonCard = (id) => C(id).category === 'digimon';
const isTamerCard = (id) => C(id).category === 'tamer';
const isOptionCard = (id) => C(id).category === 'option';
const hasSourceEffect = (id) => !!(C(id).inheritedKo || '').trim();

async function pickStackOf(ctx, who, stacks, prompt, fxKind, required) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt, ...(fxKind ? { fxKind } : {}), ...(required !== undefined ? { required } : {}) });
  return stacks.find(s => s.uid === uid) || null;
}
// pick one card of pl[zone] matching pred (null = none eligible or player declined)
async function pickIdx(ctx, who, zone, pred, prompt) {
  const pl = ctx.state.players[who];
  const eligibleIdxs = pl[zone].map((id, i) => i).filter(i => pred(pl[zone][i], i));
  if (!eligibleIdxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt });
  return i == null ? null : i;
}
const confirm = async (ctx, who, prompt) => !!(await ctx.choose('confirmEffect', { player: who, prompt }));
const log = (ctx, msg) => ctx.S.log(ctx.state, msg);
const untilEndOfTurn = (st) => st.turnNumber;
const untilOppTurnEnd = (st) => S.durationEnd(st, 'opponentTurn'); // 「상대의 턴 종료까지」 (caster-relative)

// Moves a stack out of the battle area into hand / deck bottom (sources go to trash), honouring bounce protections.
function bounceStack(ctx, p, stack, dest = 'hand') {
  const st = ctx.state;
  const pl = st.players[p];
  if (!pl.battle.includes(stack)) return false;
  const cause = p === ctx.self ? 'ownEffect' : 'effect';
  if (S.effectBlocked(st, p, stack, 'bounce') || S.leaveGate(st, p, stack, cause, 'bounce', () => bounceStack(ctx, p, stack, dest))) return false;
  pl.battle.splice(pl.battle.indexOf(stack), 1);
  const linkIds = (stack.linkCards || []).map(l => l.cardId);
  if (!S.isTokenId(stack.cardId)) { if (dest === 'deckBottom') pl.deck.push(stack.cardId); else pl.hand.push(stack.cardId); }
  pl.trash.push(...stack.sources, ...linkIds);
  S.log(st, `${p} ${C(stack.cardId).nameKo} ${dest === 'deckBottom' ? '덱 아래로' : '패로'} (진화원 ${stack.sources.length}장 파기)`);
  S.applyOverflowBatch(st, p, [...stack.sources, stack.cardId]);
  return true;
}
// Removes a whole stack (top card + its sources + links) from the battle area; returns it (no trigger, no trash).
function detachStack(st, p, stack) {
  const pl = st.players[p];
  const i = pl.battle.indexOf(stack);
  if (i >= 0) pl.battle.splice(i, 1); else if (pl.raising === stack) pl.raising = null;
  return stack;
}
// Puts a detached stack (its cards) at the bottom of `target`'s evolution cards.
function stackUnder(target, moved) {
  target.sources = [...moved.sources, moved.cardId, ...target.sources];
  S.recomputeStackGrants(target);
}
function trashNamesText(ids) { return ids.map(id => C(id).nameKo).join(', '); }

// A digivolution check that also honours the stack's own restrictions.
function canEvolveInto(st, p, stack, cardId, ignoreCond) {
  const chk = E.canEvolveAny(stack.cardId, cardId, S.evoExtraArg(st, p, stack), S.evolveTargetRestriction(st, p, stack));
  if (chk.ok) return { ok: true, cost: chk.cost };
  const r = S.evolveTargetRestriction(st, p, stack);
  if (ignoreCond && E.evoRestrictionCheck(cardId, r).ok) return { ok: true, cost: C(cardId).evoNormal?.cost ?? 0 };
  return { ok: false };
}

// Registers (once) a token pseudo-card and returns its id.
function ensureToken(id, def) {
  if (!S.CARDS[id]) S.CARDS[id] = { cardId: id, level: null, cost: 0, evoNormal: null, inheritedKo: '', imgUrl: '', effectKo: '', isToken: true, ...def, id };
  return id;
}
const TOKEN_DIABOLOMON = () => ensureToken('S4-TOKEN-DIABOLOMON', { nameKo: '디아블로몬', category: 'digimon', level: 6, cost: 14, colors: ['white'], dp: 3000, form: 'MEGA', attribute: '불명', types: ['종족불명'] });
const TOKEN_DAERONG = () => ensureToken('S4-TOKEN-DAERONG', { nameKo: '대롱 여우', category: 'digimon', colors: ['yellow'], dp: 6000, types: [], effectKo: '《블로커》' });
function playTokenStack(ctx, p, tokenId) {
  const st = ctx.state;
  const stack = S._s4.makeStack(tokenId, st.turnNumber);
  S.recomputeStackGrants(stack);
  st.players[p].battle.push(stack);
  S.log(st, `${p} ${C(tokenId).nameKo}(토큰) 코스트 없이 등장`);
  S.queueTriggersForStack(st, p, stack, 'play');
  S.emitGameEvent(st, 'play', { owner: p, stack, cause: 'effect' });
  return stack;
}

// Core of "digivolve a stack using a card that is NOT in hand" wrappers / plain evolve with cost.
function doDigivolve(ctx, p, stack, cardId, cost, source) {
  return S.digivolve(ctx.state, p, stack.uid, cardId, cost, source);
}

// Fuses one battle stack with a loose card (hand/trash) into `newCardId` (jogress with a non-stack material).
function fuseWithCard(ctx, p, stackA, matCardId, newCardId, cost) {
  const st = ctx.state, pl = st.players[p];
  S._s4.discardLinkCardsOnNewCard(st, p, stackA);
  pl.battle.splice(pl.battle.indexOf(stackA), 1);
  const fused = S._s4.makeStack(newCardId, st.turnNumber);
  const jg = S.parseJogress(newCardId);
  const aIsLeft = jg ? (jg.left(C(stackA.cardId)) && jg.right(C(matCardId))) || !(jg.left(C(matCardId)) && jg.right(C(stackA.cardId))) : true;
  fused.sources = aIsLeft ? [matCardId, ...stackA.sources, stackA.cardId] : [...stackA.sources, stackA.cardId, matCardId];
  // 8-2-2-2: the card written on the LEFT ends up on top (last in sources[]); the loose card has no sources of its own.
  if (aIsLeft) fused.sources = [matCardId, ...stackA.sources, stackA.cardId];
  else fused.sources = [...stackA.sources, stackA.cardId, matCardId];
  fused.suspended = false;
  fused.attackEligibleTurn = st.turnNumber;
  fused.viaFusion = true;
  pl.battle.push(fused);
  if (cost > 0) S.spendMemory(st, cost);
  S.log(st, `${p} 조그레스 진화: ${C(stackA.cardId).nameKo}+${C(matCardId).nameKo} → ${C(newCardId).nameKo} (코스트${cost})`);
  S.drawCards(st, p, 1);
  S.recomputeStackGrants(fused);
  S._s4.ruleCheckDP(st, p, fused);
  S.queueTriggersForStack(st, p, fused, 'digivolve');
  S.emitGameEvent(st, 'digivolve', { owner: p, stack: fused, cause: 'effect' });
  return fused;
}

// Uses an option card from hand (paying `cost` memory) — the same sequence as S.useOptionCard, minus its own cost logic.
function useOptionFromHand(ctx, p, handIdx, cost) {
  const st = ctx.state, pl = st.players[p];
  const [id] = pl.hand.splice(handIdx, 1);
  if (!id) return null;
  if (cost > 0) S.spendMemory(st, cost);
  pl.trash.push(id);
  S.log(st, `${p} ${C(id).nameKo} 사용 (효과, 코스트${cost})`);
  S.queueTriggersFor(st, p, id, 'use');
  S.emitGameEvent(st, 'optionUsed', { owner: p, stack: null, cause: 'effect', cardId: id, useCost: C(id).cost || 0 });
  return id;
}

// Runs `placedCardId`'s printed 【등장 시】/【진화 시】 effect as if it were this stack's own effect.
async function runBorrowedEffect(ctx, cardId, tagWord, runScript) {
  const segs = S.parseEffectSegments(C(cardId).effectKo).segments.filter(sg => sg.tags.some(t => t.includes(tagWord)));
  if (!segs.length) { log(ctx, `${C(cardId).nameKo}에는 【${tagWord}】 효과가 없음`); return; }
  let seg = segs[0];
  if (segs.length > 1) {
    const i = await ctx.choose('multipleChoice', { options: segs.map(sg => sg.body.slice(0, 40)), prompt: `${C(cardId).nameKo}의 【${tagWord}】 효과 1개 선택` });
    seg = segs[i ?? 0] || segs[0];
  }
  const script = Fx.lookupCardSpecific(cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
  if (!script.length) { log(ctx, `(수동) ${C(cardId).nameKo} 【${tagWord}】: ${seg.body}`); return; }
  await runScript(script, { ...ctx, sourceCardId: cardId });
}

// ───────────────────────── generic ops ─────────────────────────
export const OPS = {};

// Generic "(조건 무시하고) <카드>로 진화시킬 수 있다".
// instr: { subject:{this:true}|{pred(stack,ctx)}, zone:'hand'|'trash', pred(cardId,ctx,stack), ignoreCond, cost:{mode,n}, optional, prompt }
OPS.s4_evolve = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx).evolved = false; V(ctx).evolvedStack = null;
  const zone = instr.zone || 'hand';
  const subj = instr.subject || { this: true };
  let stacks = subj.this ? [thisStack(ctx)].filter(Boolean) : pl.battle.filter(s => (!subj.pred || subj.pred(s, ctx)));
  if (!subj.this) stacks = stacks.filter(s => ['digimon', 'tamer'].includes(C(s.cardId).category));
  const cardsFor = (s) => pl[zone].map((id, i) => i).filter(i => isDigimonCard(pl[zone][i]) && (!instr.pred || instr.pred(pl[zone][i], ctx, s)) && canEvolveInto(st, p, s, pl[zone][i], instr.ignoreCond).ok);
  stacks = stacks.filter(s => cardsFor(s).length);
  if (!stacks.length) { log(ctx, `${p} 진화시킬 수 있는 조합이 없음`); return; }
  const stack = stacks.length === 1 && (subj.this || !instr.optional) ? stacks[0] : await pickStackOf(ctx, p, stacks, instr.prompt || '진화시킬 디지몬/테이머 선택');
  if (!stack) return;
  if (instr.optional && subj.this && !(await confirm(ctx, p, instr.prompt || `${C(stack.cardId).nameKo}: 진화시킬까요?`))) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: p, zone, eligibleIdxs: cardsFor(stack), prompt: `${zone === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택` });
  if (idx == null) return;
  const cardId = pl[zone][idx];
  const chk = canEvolveInto(st, p, stack, cardId, instr.ignoreCond);
  const printed = chk.cost ?? (C(cardId).evoNormal?.cost ?? 0);
  const cm = instr.cost || { mode: 'normal' };
  const cost = cm.mode === 'free' ? 0 : cm.mode === 'fixed' ? cm.n : cm.mode === 'discount' ? Math.max(0, printed - cm.n) : printed;
  if (zone !== 'hand') pl[zone].splice(idx, 1);
  doDigivolve(ctx, p, stack, cardId, cost, zone === 'hand' ? 'hand' : 'trash');
  V(ctx).evolved = true; V(ctx).evolvedStack = stack;
};

// Place cards from a zone under a stack: { target:{this:true}|{tamer:true}|{pick:pred}, zones:['trash'], pred(cardId,ctx), max, distinct, key, optionalEach }
OPS.s4_placeUnder = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx)[instr.key || 'placed'] = 0;
  let target = null;
  if (instr.target?.this || !instr.target) target = thisStack(ctx);
  else if (instr.target.pick) target = await pickStackOf(ctx, p, pl.battle.filter(s => instr.target.pick(s, ctx)), instr.prompt || '카드를 아래에 놓을 대상 선택');
  else if (instr.target.first) target = pl.battle.filter(s => instr.target.first(s, ctx))[0] || null;
  if (!target) { log(ctx, '카드를 놓을 대상이 없음'); return; }
  const max = typeof instr.max === 'function' ? instr.max(ctx, target) : instr.max ?? 1;
  const usedNames = new Set();
  let n = 0;
  for (let k = 0; k < max; k++) {
    let zone = null, idx = null;
    for (const z of instr.zones || ['trash']) {
      const i = await pickIdx(ctx, p, z, (id) => (!instr.pred || instr.pred(id, ctx, target)) && !(instr.distinct && usedNames.has(C(id).nameKo)), `${z === 'trash' ? '트래시' : '패'}에서 ${C(target.cardId).nameKo}의 진화원 아래에 놓을 카드 선택 (${n}/${max})`);
      if (i != null) { zone = z; idx = i; break; }
    }
    if (idx == null) break;
    const [id] = pl[zone].splice(idx, 1);
    target.sources.unshift(id);
    usedNames.add(C(id).nameKo);
    n++;
    log(ctx, `${p} ${C(id).nameKo}을(를) ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
  }
  if (n) S.recomputeStackGrants(target);
  V(ctx)[instr.key || 'placed'] = n;
  V(ctx).placedTarget = target;
};

// Destroy opponent stacks: { n, kinds:['digimon'|'tamer'|'option'], pred(stack,ctx), key, side:'opp'|'any', optional }
OPS.s4_destroy = async (instr, ctx) => {
  const st = ctx.state;
  let count = 0;
  const done = [];
  for (let k = 0; k < (instr.n || 1); k++) {
    let target = null, tp = null;
    if (instr.side === 'any') {
      const entries = [];
      for (const pp of ['p1', 'p2']) for (const s of st.players[pp].battle) if ((instr.kinds || ['digimon']).includes(C(s.cardId).category) && (!instr.pred || instr.pred(s, ctx, pp)) && !done.includes(s.uid)) entries.push({ player: pp, uid: s.uid });
      if (!entries.length) break;
      const pk = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '소멸시킬 디지몬 선택', fxKind: 'delete' });
      if (!pk) break;
      tp = pk.player; target = stackByUid(st, tp, pk.uid);
    } else {
      tp = ctx.opp;
      const cands = st.players[tp].battle.filter(s => (instr.kinds || ['digimon']).includes(C(s.cardId).category) && (!instr.pred || instr.pred(s, ctx, tp)) && !done.includes(s.uid));
      target = await pickStackOf(ctx, tp, cands, instr.prompt || '소멸시킬 상대의 디지몬/테이머 선택', 'delete');
    }
    if (!target) break;
    done.push(target.uid);
    const before = st.players[tp].battle.includes(target);
    S.deleteStack(st, tp, target.uid, 'trash', tp === ctx.self ? 'ownEffect' : 'effect');
    if (before && !st.players[tp].battle.includes(target)) count++;
  }
  V(ctx)[instr.key || 'destroyed'] = count;
};

// "Lv./DP/등장 코스트 합계 N까지 상대의 디지몬을 소멸시킨다": { stat:'dp'|'cost'|'level', limit: number | (ctx)=>number }
OPS.s4_destroySum = async (instr, ctx) => {
  const st = ctx.state;
  let left = typeof instr.limit === 'function' ? instr.limit(ctx) : instr.limit;
  const statOf = (s) => instr.stat === 'dp' ? S.effectiveDP(st, ctx.opp, s) : instr.stat === 'level' ? (C(s.cardId).level ?? Infinity) : (C(s.cardId).cost || 0); // Q2807: Lv.-(레벨 없음) 카드는 "Lv. 합계 N까지" 소멸의 대상이 될 수 없다 — lvOf()의 ??0 폴백을 여기서만 우회(다른 <=/>= 사용처는 그대로 둠)
  const chosen = [];
  for (;;) {
    const cands = st.players[ctx.opp].battle.filter(s => C(s.cardId).category === 'digimon' && !chosen.includes(s.uid) && statOf(s) <= left);
    if (!cands.length) break;
    // official Q&A (LM-021/Q4018 family): only the FIRST pick is mandatory (1-3-6) — after that the player may stop short of the cap,
    // unlike a fixed-count "N마리를 소멸시킨다" destroy. Without this, ctx.choose's whole-text optional heuristic (effects.js wrapChoose)
    // sees no "수 있다"/"까지" in this sentence and marks every iteration required, hiding the "stop early" option past the first pick.
    const t = await pickStackOf(ctx, ctx.opp, cands, `소멸시킬 상대의 디지몬 선택 (남은 ${instr.stat === 'dp' ? 'DP' : instr.stat === 'level' ? 'Lv.' : '등장 코스트'} 합계 ${left})`, 'delete', chosen.length === 0);
    if (!t) break;
    chosen.push(t.uid); left -= statOf(t);
  }
  let n = 0;
  for (const uid of chosen) { const t = stackByUid(st, ctx.opp, uid); if (t) { S.deleteStack(st, ctx.opp, uid, 'trash', 'effect'); if (!st.players[ctx.opp].battle.includes(t)) n++; } }
  V(ctx).destroyed = n;
};

// Card from trash → hand: { pred(cardId,ctx), n, optional }
OPS.s4_trashToHand = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx).returned = 0;
  for (let k = 0; k < (instr.n || 1); k++) {
    const i = await pickIdx(ctx, p, 'trash', (id) => !instr.pred || instr.pred(id, ctx), instr.prompt || '트래시에서 패로 되돌릴 카드 선택');
    if (i == null) break;
    const [id] = pl.trash.splice(i, 1);
    pl.hand.push(id);
    V(ctx).returned++;
    log(ctx, `${p} 트래시의 ${C(id).nameKo}을(를) 패로`);
    S.emitGameEvent(st, 'trashToHand', { owner: p, stack: null, cardId: id, cause: 'effect' }); // b6: "트래시에서 …카드가 패로 되돌아갔을 때" watchers (BT16-011 / BT15-082)
  }
};

// Play a card for free / with a memory discount: { zone:'hand'|'trash'|'security'|'any', pred(cardId,ctx), costDelta (negative = pay less; omit = free), optional, rested }
OPS.s4_play = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx).played = null;
  const zones = instr.zones || [instr.zone || 'hand'];
  for (const z of zones) {
    const i = await pickIdx(ctx, p, z, (id) => ['digimon', 'tamer'].includes(C(id).category) && (!instr.pred || instr.pred(id, ctx)), instr.prompt || `${z === 'trash' ? '트래시' : z === 'hand' ? '패' : '시큐리티'}에서 등장시킬 카드 선택`);
    if (i == null) continue;
    const id = pl[z][i];
    const cost = instr.costDelta == null ? 0 : Math.max(0, (C(id).cost || 0) + instr.costDelta);
    if (cost > 0) S.spendMemory(st, cost);
    const stack = S.playFreeFromZone(st, p, z, i, { rested: !!instr.rested });
    if (z === 'security') S.secFaceUpTake(pl, id);
    if (stack) { V(ctx).played = stack; if (instr.rested) stack.suspended = true; }
    return;
  }
};

// Use an option card from hand: { pred(cardId,ctx), costDelta (omit = free), maxUseCost }
OPS.s4_useOption = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx).usedOption = null;
  const i = await pickIdx(ctx, p, 'hand', (id) => isOptionCard(id) && S.optionColorOk(st, p, id) && (instr.maxUseCost == null || (C(id).cost || 0) <= instr.maxUseCost) && (!instr.pred || instr.pred(id, ctx)), instr.prompt || '사용할 옵션 카드 선택');
  if (i == null) return;
  const id = pl.hand[i];
  const cost = instr.costDelta == null ? 0 : Math.max(0, (C(id).cost || 0) + instr.costDelta);
  V(ctx).usedOption = useOptionFromHand(ctx, p, i, cost);
};

// "…를 놓는 것으로 …" ops for shields granted by effects.  { thisStack | pick:pred, kinds, fromCategory, dur:'turn'|'opp' , dp }
OPS.s4_shield = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  let target = instr.thisStack ? thisStack(ctx) : await pickStackOf(ctx, p, digimonOf(st, p).filter(s => !instr.pick || instr.pick(s, ctx)), instr.prompt || '효果로부터 보호할 디지몬 선택');
  if (!target) return;
  S.grantShield(st, p, target.uid, { kinds: instr.kinds, fromCategory: instr.fromCategory || null, until: instr.dur === 'opp' ? untilOppTurnEnd(st) : untilEndOfTurn(st) });
  if (instr.dp) S.modifyDP(st, p, target.uid, instr.dp, instr.dur === 'opp' ? 'opponentTurn' : 'turn');
};

// End-of-turn destruction of this digimon (e.g. after a temporary evolution).
OPS.s4_endOfTurnDestroyThis = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, uid = ctx.sourceStackUid;
  S.scheduleEndOfTurn(st, () => { const s = stackByUid(st, p, uid); if (s && C(s.cardId).category === 'digimon') S.deleteStack(st, p, uid, 'trash', 'ownEffect'); }, { player: p, label: '이 턴 종료 시 소멸' }); // Q2729/2760: 턴 종료 전에 ≪퇴화≫ 등으로 테이머까지 벗겨져 디지몬이 아니게 됐다면 대상이 없어 소멸하지 않는다
  log(ctx, `${p} 이 턴 종료 시 이 디지몬을 소멸시킴 (예약)`);
};

// Opponent-side: pay-or-suffer prompts.
OPS.s4_oppDiscard = async (instr, ctx) => {
  const st = ctx.state, op = ctx.opp, pl = st.players[op];
  const n = instr.n || 1;
  for (let k = 0; k < n && pl.hand.length; k++) {
    const idx = await ctx.choose('pickFromHandIndexes', { player: op, eligibleIdxs: pl.hand.map((id, i) => i), n: 1, prompt: `${op}: 파기할 패 1장 선택` });
    if (!idx || !idx.length) break;
    S.trashFromHand(st, op, idx[0]);
  }
};

// Rest one digimon (either side): result recorded in ctx.s4.restedOwn (true if one of OUR digimon actually got rested).
OPS.s4_restOne = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  V(ctx).restedOwn = false; V(ctx).restedOpp = false;
  const entries = [];
  for (const pp of [p, ctx.opp]) for (const s of digimonOf(st, pp)) if (!instr.pred || instr.pred(s, ctx, pp)) entries.push({ player: pp, uid: s.uid });
  if (!entries.length) return;
  const pk = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '레스트시킬 디지몬 선택', fxKind: 'rest' });
  if (!pk) return;
  const t = stackByUid(st, pk.player, pk.uid);
  if (!t || t.suspended) { log(ctx, '이미 레스트 상태라 레스트하지 않음'); return; }
  S.restStack(st, pk.player, pk.uid);
  if (t.suspended) { if (pk.player === p) V(ctx).restedOwn = true; else V(ctx).restedOpp = true; }
};

// Unsuspend one digimon (either side): { side:'own'|'any' }
OPS.s4_unsuspendOne = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  const entries = [];
  for (const pp of instr.side === 'own' ? [p] : [p, ctx.opp]) for (const s of digimonOf(st, pp)) if (s.suspended) entries.push({ player: pp, uid: s.uid });
  if (!entries.length) return;
  const pk = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '액티브로 할 디지몬 선택' });
  if (pk) S.unsuspendStack(st, pk.player, pk.uid);
};

// Return a rested opposing digimon to the deck bottom: { optional }
OPS.s4_bounceRestedOpp = async (instr, ctx) => {
  const st = ctx.state;
  const cands = st.players[ctx.opp].battle.filter(s => C(s.cardId).category === 'digimon' && s.suspended);
  const t = await pickStackOf(ctx, ctx.opp, cands, instr.prompt || '덱 아래로 되돌릴 레스트 상태의 상대 디지몬 선택', 'bounce');
  if (t) bounceStack(ctx, ctx.opp, t, 'deckBottom');
};

// Bounce to hand: { side:'opp'|'any', pred(stack,ctx,p), n, dest }
OPS.s4_bounce = async (instr, ctx) => {
  const st = ctx.state;
  for (let k = 0; k < (instr.n || 1); k++) {
    let t = null, tp = null;
    if (instr.side === 'any') {
      const entries = [];
      for (const pp of ['p1', 'p2']) for (const s of digimonOf(st, pp)) if (!instr.pred || instr.pred(s, ctx, pp)) entries.push({ player: pp, uid: s.uid });
      if (!entries.length) return;
      const pk = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '패로 되돌릴 디지몬 선택', fxKind: 'bounce' });
      if (!pk) return;
      tp = pk.player; t = stackByUid(st, tp, pk.uid);
    } else {
      tp = ctx.opp;
      t = await pickStackOf(ctx, tp, digimonOf(st, tp).filter(s => !instr.pred || instr.pred(s, ctx, tp)), instr.prompt || '패로 되돌릴 상대의 디지몬 선택', 'bounce');
    }
    if (!t) return;
    bounceStack(ctx, tp, t, instr.dest || 'hand');
  }
};

// DP change on a chosen opposing digimon (temporary): { amount|amountFn(ctx), pred, duration }
OPS.s4_modifyDPOpp = async (instr, ctx) => {
  const st = ctx.state;
  const amount = typeof instr.amount === 'function' ? instr.amount(ctx) : instr.amount;
  const t = await pickStackOf(ctx, ctx.opp, digimonOf(st, ctx.opp).filter(s => !instr.pred || instr.pred(s, ctx)), instr.prompt || `DP ${amount} 받을 상대의 디지몬 선택`, amount < 0 ? 'dpDown' : 'other');
  if (t) S.modifyDP(st, ctx.opp, t.uid, amount, instr.duration || 'turn');
};

// Trash the top security card(s) of a player as a cost / effect: { who:'self'|'opp', n }
OPS.s4_trashSecurity = async (instr, ctx) => {
  const who = instr.who === 'opp' ? ctx.opp : ctx.self;
  V(ctx).secTrashed = 0;
  for (let i = 0; i < (instr.n || 1); i++) { if (S.trashTopSecurityByEffect(ctx.state, who)) V(ctx).secTrashed++; }
};

// ───────────────────────── scripts & hooks (appended in small batches below) ─────────────────────────
export const SCRIPTS = {};
export const HOOKS = {};
const H = (id, d) => { (HOOKS[id] ||= []).push(d); };

// ---- batch 1: evolve-with-condition / simple triggers ----
const cond = (test, then, els = []) => ({ op: 'condition', if: { test }, then, else: els });
const delInfo = (ctx) => (ctx.state.deletedInfo || {})[ctx.sourceStackUid] || null;
const ownHasColor = (ctx, cols) => digiOrTamer(ctx.state, ctx.self).some(s => stackHasColor(s, cols));
const evolveThenDie = (cardName, cols, srcName) => [
  cond((ctx) => (thisStack(ctx) && srcHasName(thisStack(ctx), srcName)) || ownHasColor(ctx, cols), [
    { op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => isNamed(id, cardName), ignoreCond: true, cost: { mode: 'fixed', n: 3 }, optional: true },
    cond((ctx) => V(ctx).evolved, [{ op: 's4_endOfTurnDestroyThis' }]),
  ]),
];
SCRIPTS['BT17-011::진화 시'] = evolveThenDie('에이션트그레이몬', ['blue', 'green'], '브리트라몬');
SCRIPTS['BT17-022::진화 시'] = evolveThenDie('에이션트가루몬', ['black', 'purple'], '가름몬');
SCRIPTS['BT17-062::어택 시'] = [
  cond((ctx) => thisStack(ctx) && srcHasName(thisStack(ctx), '키사카타 코우스케') && digimonOf(ctx.state, ctx.opp).some(s => lvOf(s.cardId) >= 6), [
    { op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => isNamed(id, '도루고라몬'), ignoreCond: true, cost: { mode: 'fixed', n: 4 }, optional: true }]),
];
SCRIPTS['BT17-018::등장 시'] = [{ op: 's4_destroySum', stat: 'dp', limit: 15000 }];
SCRIPTS['LM-021::등장 시'] = [{ op: 's4_destroySum', stat: 'dp', limit: (ctx) => { const s = thisStack(ctx); return s ? S.effectiveDP(ctx.state, ctx.self, s) : 0; } }];
SCRIPTS['EX7-012::진화 시'] = [cond((ctx) => !digimonOf(ctx.state, ctx.opp).some(s => S.effectiveDP(ctx.state, ctx.opp, s) <= 6000), [{ op: 'gainMemory', who: 'self', n: 1 }])];
SCRIPTS['EX7-002::어택 시'] = [cond((ctx) => !digimonOf(ctx.state, ctx.opp).some(s => s.sources.length > 0), [{ op: 'draw', who: 'self', n: 1 }])];
SCRIPTS['EX7-009::등장 시'] = [{ op: 's4_trashToHand', pred: (id) => isNamed(id, '쿠리하라 히나') || hasTraitAny(id, ['기룡형', '천룡형']) }];
SCRIPTS['EX7-019::등장 시'] = [cond((ctx) => !digimonOf(ctx.state, ctx.opp).some(s => s.sources.length > 0), [{ op: 's4_unsuspendOne', side: 'own', prompt: '액티브로 할 자신의 디지몬 선택' }])];
SCRIPTS['EX7-049::진화 시'] = [{ op: 's4_evolveLockOpp', levelMax: 4 }];
SCRIPTS['EX7-014::진화 시'] = [{ op: 's4_playRestrictOpp', dpMax: 6000 }];
SCRIPTS['BT17-005::소멸 시'] = [cond((ctx) => { const d = delInfo(ctx); return d && hasTrait(d.cardId, '종족불명'); }, [{ op: 'gainMemory', who: 'self', n: 1 }])];
SCRIPTS['P-145::소멸 시'] = [cond((ctx) => { const d = delInfo(ctx); return d && d.sources.some(id => (isNamed(id, '묘티스몬') || hasTrait(id, 'X항체'))); }, [
  { op: 's4_play', zone: 'trash', pred: (id) => nameHas(id, '묘티스몬') && lvOf(id) === 6 && isDigimonCard(id) }])];
SCRIPTS['P-142::소멸 시'] = [{ op: 's4_oppDiscard', n: 1 }];
SCRIPTS['BT17-048::소멸 시'] = [cond((ctx) => ctx.state.players[ctx.self].trash.filter(id => isNamed(id, '아르고몬')).length >= 4, [
  { op: 's4_play', zone: 'hand', pred: (id) => isNamed(id, '아르고몬') && lvOf(id) === 6 }])];
SCRIPTS['BT17-068::소멸 시'] = [cond((ctx) => { const d = delInfo(ctx); return d && (d.cause === 'effect' || d.cause === 'ownEffect'); }, [
  { op: 's4_play', zones: ['hand', 'trash'], pred: (id) => lvOf(id) === 6 && (isNamed(id, '가르프몬') || hasTrait(id, '어둠의 4천왕')) }])];
SCRIPTS['BT18-011::진화 시'] = [{ op: 's4_trashToHand', pred: (id) => hasTraitAny(id, ['하이브리드체', '10투사']) || (isTamerCard(id) && hasSourceEffect(id)) }];
SCRIPTS['BT19-006::소멸 시'] = [cond((ctx) => { const d = delInfo(ctx); return d && d.cause !== 'battle'; }, [
  { op: 's4_trashToHand', pred: (id) => isDigimonCard(id) && hasColor(id, ['purple']) && lvOf(id) === 3 }])];
OPS.s4_evolveLockOpp = async (instr, ctx) => { S.addEvolveLock(ctx.state, ctx.opp, instr.levelMax, untilEndOfTurn(ctx.state) + 1); };
OPS.s4_playRestrictOpp = async (instr, ctx) => { S.addPlayRestriction(ctx.state, ctx.opp, instr.dpMax, untilEndOfTurn(ctx.state) + 1); };

// ---- batch 2: placing cards under stacks, uses of options, rest/active families ----
OPS.s4_digitamaUnder = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], me = thisStack(ctx);
  const id = pl.digitamaDeck.shift();
  if (id && me) { me.sources.unshift(id); S.recomputeStackGrants(me); log(ctx, `${p} 디지타마 덱 위 ${C(id).nameKo}을(를) 진화원 아래에 놓음`); }
};
OPS.s4_destroyAllOwn = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  let n = 0;
  for (const s of [...digimonOf(st, p)]) { S.deleteStack(st, p, s.uid, 'trash', 'ownEffect'); if (!st.players[p].battle.includes(s)) n++; }
  V(ctx).destroyed = n;
};
OPS.s4_moveToRaising = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], me = thisStack(ctx);
  if (!me || pl.raising || !pl.battle.includes(me)) return;
  if (!(await confirm(ctx, p, `${C(me.cardId).nameKo}을(를) 육성 에어리어로 이동시킬까요?`))) return;
  S.cancelWaitingEffectsOf(st, me.uid); // 4-17-5
  pl.battle.splice(pl.battle.indexOf(me), 1);
  pl.raising = me;
  log(ctx, `${p} ${C(me.cardId).nameKo} 육성 에어리어로 이동`);
};
// place THIS (option) card under one of our digimon: { pred(stack) }
OPS.s4_placeThisUnder = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const t = await pickStackOf(ctx, p, digimonOf(st, p).filter(s => !instr.pred || instr.pred(s, ctx)), instr.prompt || '진화원 아래에 놓을 디지몬 선택');
  if (!t) return;
  const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (i < 0) return;
  pl.trash.splice(i, 1);
  t.sources.unshift(ctx.sourceCardId);
  S.recomputeStackGrants(t);
  log(ctx, `${p} ${C(ctx.sourceCardId).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
};
OPS.s4_drawTo = async (instr, ctx) => { const pl = ctx.state.players[ctx.self]; const n = instr.n - pl.hand.length; if (n > 0) S.drawCards(ctx.state, ctx.self, n); };
// discard one option from the evolution cards of a chosen digimon. key 'optTrashed'
OPS.s4_trashSourceOption = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  V(ctx).optTrashed = false;
  const stacks = [];
  const scope = instr.thisOnly ? [thisStack(ctx)].filter(Boolean).map(s => ({ pp: p, s })) : ['p1', 'p2'].flatMap(pp => digimonOf(st, pp).map(s => ({ pp, s })));
  for (const e of scope) if (e.s.sources.some(isOptionCard)) stacks.push(e);
  if (!stacks.length) return;
  let pick = stacks[0];
  if (stacks.length > 1) {
    const pk = await ctx.choose('pickStackAnySide', { entries: stacks.map(e => ({ player: e.pp, uid: e.s.uid })), prompt: '진화원의 옵션 카드를 파기할 디지몬 선택', fxKind: 'other' });
    if (!pk) return;
    pick = stacks.find(e => e.s.uid === pk.uid);
  }
  if (!pick) return;
  if (instr.optional && !(await confirm(ctx, p, `${C(pick.s.cardId).nameKo}의 진화원 옵션 카드 1장을 파기할까요?`))) return;
  const opts = pick.s.sources.map((id, i) => i).filter(i => isOptionCard(pick.s.sources[i]));
  let ix = opts[0];
  if (opts.length > 1) { const c = await ctx.choose('multipleChoice', { options: opts.map(i => C(pick.s.sources[i]).nameKo), prompt: '파기할 옵션 카드 선택' }); ix = opts[c ?? 0]; }
  const [id] = pick.s.sources.splice(ix, 1);
  st.players[pick.pp].trash.push(id);
  S.recomputeStackGrants(pick.s);
  log(ctx, `${pick.pp} ${C(pick.s.cardId).nameKo}의 진화원 ${C(id).nameKo} 파기`);
  V(ctx).optTrashed = true;
  // 「이 카드가 진화원에서 효과로 파기되었을 때, 메모리 +1」 (EX7-071)
  if ((C(id).effectKo || '').includes('진화원에서 효과로 파기되었을 때, 메모리 +1')) S.grantMemory(st, pick.pp, 1, id);
};
SCRIPTS['EX6-073::진화 시'] = [
  { op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => hasTrait(id, '7대마왕'), distinct: true, max: 7, key: 'placed' },
  cond((ctx) => V(ctx).placed >= 4, [{ op: 's4_destroy', kinds: ['digimon', 'tamer'], n: 1 }]),
];
SCRIPTS['EX6-006::자신의 메인 페이즈 개시 시'] = [
  { op: 's4_digitamaUnder' }, { op: 's4_destroyAllOwn' },
  cond((ctx) => V(ctx).destroyed > 0, [{ op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => hasTrait(id, '7대마왕'), max: 1 }]),
];
SCRIPTS['P-143::자신의 턴 종료 시'] = [{ op: 's4_moveToRaising' }];
SCRIPTS['P-146::메인'] = [{ op: 's4_placeThisUnder', pred: (s) => !C(s.cardId).colors.includes('white') }];
SCRIPTS['BT17-051::등장 시'] = [
  { op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => isNamed(id, '아르고몬') && lvOf(id) <= 5, max: 4 },
  { op: 's4_destroySum', stat: 'level', limit: (ctx) => 4 + Math.floor((thisStack(ctx)?.sources.filter(id => isNamed(id, '아르고몬')).length || 0) / 2) },
];
SCRIPTS['ST19-13::등장 시'] = [
  { op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => lvOf(id) <= 5 && (nameHas(id, '워매몬') || hasTrait(id, '퍼펫형')), max: 1, key: 'placed' },
  cond((ctx) => V(ctx).placed > 0, [{ op: 'recoverTop', who: 'self' }]),
];
SCRIPTS['BT18-065::진화 시'] = [{ op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => isNamed(id, '벰몬'), max: 2 }];
SCRIPTS['BT18-088::자신의 메인 페이즈 개시 시'] = [{ op: 's4_placeUnder', target: { this: true }, zones: ['trash'], pred: (id) => hasTrait(id, '하이브리드체'), distinct: true, max: (ctx) => 1 + 2 * (tamersOf(ctx.state, ctx.self).length - 1) }];
SCRIPTS['BT19-024::등장 시'] = [{ op: 's4_placeUnder', target: { pick: (s) => C(s.cardId).category === 'digimon' }, zones: ['hand'], pred: (id) => isDigimonCard(id) && hasTraitLike(id, '수생'), max: 1 }];
SCRIPTS['BT17-035::진화 시'] = [{ op: 's4_useOption', costDelta: -2, pred: (id) => nameHas(id, '플러그인') || hasColor(id, ['yellow']) }];
SCRIPTS['BT17-035::어택 시'] = [cond((ctx) => { const s = thisStack(ctx); return s && stackNameHas(ctx.state, s, '샤크라몬'); }, [{ op: 's4_useOption', costDelta: -2, pred: (id) => nameHas(id, '플러그인') || hasColor(id, ['yellow']) }])];
SCRIPTS['EX7-013::등장 시'] = [{ op: 's4_useOption', pred: (id) => hasTrait(id, '3총사') }, { op: 's4_drawTo', n: 6 }];
SCRIPTS['EX7-073::진화 시@가 기술되어 있는 옵션'] = [{ op: 's4_useOption', pred: (id) => nameHas(id, '3총사') || hasTrait(id, '3총사') }];
SCRIPTS['EX7-059::어택 시'] = [
  { op: 's4_trashSourceOption', thisOnly: true, optional: true },
  cond((ctx) => V(ctx).optTrashed, [{ op: 's4_useOption', pred: (id) => hasTrait(id, '3총사') }]),
];
SCRIPTS['EX7-010::진화 시'] = [{ op: 's4_trashSourceOption', optional: true }];
SCRIPTS['ST18-10::등장 시'] = [
  { op: 's4_restOne' },
  cond((ctx) => V(ctx).restedOwn, [{ op: 's4_play', zone: 'hand', pred: (id) => isDigimonCard(id) && (C(id).dp || 0) <= 3000 && ['조', '새', '병아리'].some(t => hasTraitLike(id, t)) }]),
];
SCRIPTS['ST18-12::진화 시'] = [{ op: 's4_restOne' }, { op: 's4_unsuspendOne', side: 'any' }];
SCRIPTS['ST18-15::메인'] = [
  { op: 's4_restOne' },
  cond((ctx) => V(ctx).restedOwn, [{ op: 's4_bounceRestedOpp' }]),
  { op: 's4_unsuspendOne', side: 'any' },
];
SCRIPTS['EX7-036::진화 시'] = [{ op: 's4_restOne' }, cond((ctx) => V(ctx).restedOwn, [{ op: 's4_bounceRestedOpp' }])];
SCRIPTS['BT19-054::진화 시'] = [{ op: 's4_bounceRestedOpp' }];

// ---- batch 3: jogress, tamer evolutions, mind link ----
// { mode:'two'|'stackHand'|'stackTrash', stackPred(stack,ctx), stackName?, matPred(cardId,ctx), cardPred(cardId,ctx) }
OPS.s4_jogress = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const mode = instr.mode || 'two';
  const digis = digimonOf(st, p).filter(s => !instr.stackPred || instr.stackPred(s, ctx));
  const targets = pl.hand.map((id, i) => i).filter(i => isDigimonCard(pl.hand[i]) && S.parseJogress(pl.hand[i]) && (!instr.cardPred || instr.cardPred(pl.hand[i], ctx)));
  const ok = (cardA, cardB, ti) => S.parseJogress(pl.hand[ti]).test(cardA, cardB);
  const zone = mode === 'stackTrash' ? 'trash' : 'hand';
  const matsFor = (a) => mode === 'two' ? digimonOf(st, p).filter(b => b !== a).map(b => ({ b })) : pl[zone].map((id, i) => i).filter(i => isDigimonCard(pl[zone][i]) && (!instr.matPred || instr.matPred(pl[zone][i], ctx))).map(i => ({ i }));
  const validT = (a, m) => targets.filter(ti => (mode === 'two' ? ok(C(a.cardId), C(m.b.cardId), ti) : (zone !== 'hand' || m.i !== ti) && ok(C(a.cardId), C(pl[zone][m.i]), ti)));
  const usableA = digis.filter(a => matsFor(a).some(m => validT(a, m).length));
  if (!usableA.length) { log(ctx, `${p} 조그레스 진화할 수 있는 조합이 없음`); return; }
  const a = await pickStackOf(ctx, p, usableA, '조그레스 진화시킬 자신의 디지몬 선택');
  if (!a) return;
  const mats = matsFor(a).filter(m => validT(a, m).length);
  let m;
  if (mode === 'two') { const b = await pickStackOf(ctx, p, mats.map(x => x.b), '조그레스의 또 다른 디지몬 선택'); if (!b) return; m = { b }; }
  else { const i = await ctx.choose('pickFromZoneIndex', { player: p, zone, eligibleIdxs: mats.map(x => x.i), prompt: '조그레스의 소재로 사용할 카드 선택' }); if (i == null) return; m = { i }; }
  const ts = validT(a, m);
  const ti = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'hand', eligibleIdxs: ts, prompt: '조그레스 진화할 패의 카드 선택' });
  if (ti == null) return;
  const tid = pl.hand[ti];
  const cost = S.parseJogress(tid).cost;
  if (mode === 'two') { S.fuseJogress(st, p, a, m.b, tid); }
  else {
    const matId = pl[zone][m.i];
    const removeIdx = [[zone, m.i], ['hand', ti]].sort((x, y) => (x[0] === y[0] ? y[1] - x[1] : 0));
    for (const [z, i] of removeIdx) pl[z].splice(i, 1);
    fuseWithCard(ctx, p, a, matId, tid, cost);
  }
  V(ctx).jogressed = true;
};
// Blast Jogress from hand (BT17-078): a battle digimon named nameA + a hand card named nameB fuse into THIS card for free.
OPS.s4_blastJogress = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const hi = pl.hand.indexOf(ctx.sourceCardId);
  if (hi < 0) return;
  const as = digimonOf(st, p).filter(s => isNamed(s.cardId, instr.nameA));
  const mi = pl.hand.map((id, i) => i).filter(i => i !== hi && isNamed(pl.hand[i], instr.nameB));
  if (!as.length || !mi.length) { log(ctx, '《블래스트 조그레스》: 지정된 카드 조합이 없음'); return; }
  const a = as.length === 1 ? as[0] : await pickStackOf(ctx, p, as, '조그레스할 자신의 디지몬 선택');
  if (!a) return;
  const matId = pl.hand[mi[0]];
  for (const i of [hi, mi[0]].sort((x, y) => y - x)) pl.hand.splice(i, 1);
  fuseWithCard(ctx, p, a, matId, ctx.sourceCardId, 0);
};
// Material = stack (own, named) + card in trash (named) → hand card (named) : BT18-015 / BT18-073
OPS.s4_jogressTrashNamed = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const as = digimonOf(st, p).filter(s => isNamed(s.cardId, instr.stackName));
  const ti = pl.hand.map((id, i) => i).filter(i => isNamed(pl.hand[i], instr.resultName) && S.parseJogress(pl.hand[i]));
  const mi = pl.trash.map((id, i) => i).filter(i => isNamed(pl.trash[i], instr.trashName));
  if (!as.length || !ti.length || !mi.length) return;
  const a = as.length === 1 ? as[0] : await pickStackOf(ctx, p, as, '조그레스할 자신의 디지몬 선택');
  if (!a) return;
  if (!(await confirm(ctx, p, `${C(a.cardId).nameKo}과(와) 트래시의 ${instr.trashName}(으)로 ${instr.resultName}(으)로 조그레스 진화할까요?`))) return;
  const tid = pl.hand[ti[0]], matId = pl.trash[mi[0]];
  pl.hand.splice(ti[0], 1); pl.trash.splice(mi[0], 1);
  fuseWithCard(ctx, p, a, matId, tid, S.parseJogress(tid).cost);
};
// Tamer evolves into THIS hand card: pays memory, places `place` (list of card preds, 1 each) from trash under the tamer first.
OPS.s4_tamerEvolveThisCard = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  if (!pl.hand.includes(ctx.sourceCardId)) return;
  const tamers = tamersOf(st, p).filter(s => instr.tamerPred(s, ctx));
  const okTrash = instr.place.every((pr, k) => pl.trash.some(id => pr(id)));
  if (!tamers.length || !okTrash) { log(ctx, '조건을 만족하는 테이머 또는 트래시의 카드가 없음'); return; }
  const t = tamers.length === 1 ? tamers[0] : await pickStackOf(ctx, p, tamers, '진화시킬 테이머 선택');
  if (!t) return;
  for (const pr of instr.place) { const i = pl.trash.findIndex(id => pr(id)); const [id] = pl.trash.splice(i, 1); t.sources.unshift(id); }
  S.recomputeStackGrants(t);
  log(ctx, `${p} ${C(t.cardId).nameKo} 아래에 카드 ${instr.place.length}장을 놓음`);
  S.digivolve(st, p, t.uid, ctx.sourceCardId, instr.cost, 'hand');
};
const tamerEvoScript = (tamerPred, place) => [{ op: 's4_tamerEvolveThisCard', tamerPred, place: place.map(n => (id) => isNamed(id, n)), cost: 3 }];
SCRIPTS['BT17-014::메인'] = tamerEvoScript((s) => isNamed(s.cardId, '우정훈'), ['아그니몬', '브리트라몬']);
SCRIPTS['BT17-026::메인'] = tamerEvoScript((s) => isNamed(s.cardId, '선우현'), ['볼프몬', '가름몬']);
SCRIPTS['BT18-026::메인'] = tamerEvoScript((s) => stackHasColor(s, ['blue', 'red']), ['챠크몬', '블리자몬']);
SCRIPTS['BT18-053::메인'] = tamerEvoScript((s) => stackHasColor(s, ['green', 'red']), ['페어리몬', '슈츠몬']);
SCRIPTS['BT18-070::메인'] = tamerEvoScript((s) => stackHasColor(s, ['black', 'yellow']), ['블리츠몬', '보르그몬']);
SCRIPTS['BT18-081::메인'] = tamerEvoScript((s) => stackHasColor(s, ['purple', 'yellow']), ['레베몬', '카이저레오몬']);
const tamerFiveEvo = (resultName) => [
  { op: 's4_placeUnder', target: { pick: (s) => C(s.cardId).category === 'tamer' }, zones: ['hand', 'trash'], pred: (id) => hasTrait(id, '하이브리드체') && isDigimonCard(id) || (hasTrait(id, '하이브리드체')), distinct: true, max: 5, prompt: '카드를 아래에 놓을 테이머 선택' },
  { op: 's4_evolve', subject: { pred: (s) => C(s.cardId).category === 'tamer' && s.sources.length >= 5 }, zone: 'hand', pred: (id) => isNamed(id, resultName), ignoreCond: true, cost: { mode: 'free' } },
  cond((ctx) => !V(ctx).evolved, [{ op: 's4_evolve', subject: { pred: (s) => C(s.cardId).category === 'tamer' && s.sources.length >= 5 }, zone: 'trash', pred: (id) => isNamed(id, resultName), ignoreCond: true, cost: { mode: 'free' } }]),
];
SCRIPTS['BT18-095::메인'] = tamerFiveEvo('카이젤그레이몬');
SCRIPTS['BT18-097::메인'] = tamerFiveEvo('매그너가루몬');
SCRIPTS['EX6-072::메인'] = [{ op: 's4_jogress', mode: 'stackHand', stackPred: (s) => lvOf(s.cardId) === 6, cardPred: (id) => lvOf(id) === 7 }];
SCRIPTS['EX6-074::자신의 턴 종료 시'] = [{ op: 's4_jogress', mode: 'two' }];
SCRIPTS['EX7-047::자신의 턴 종료 시'] = [{ op: 's4_jogress', mode: 'two', cardPred: (id) => hasTrait(id, 'NSp') }];
SCRIPTS['BT17-078::카운터'] = [{ op: 's4_blastJogress', nameA: '워그레이몬', nameB: '메탈가루몬' }];
SCRIPTS['BT18-015::소멸 시'] = [{ op: 's4_jogressTrashNamed', stackName: '파워드라몬', trashName: '키메라몬', resultName: '밀레니엄몬' }];
SCRIPTS['BT18-073::소멸 시'] = [{ op: 's4_jogressTrashNamed', stackName: '키메라몬', trashName: '파워드라몬', resultName: '밀레니엄몬' }];
// Mind Link: this tamer goes under a digimon that has no tamer card among its evolution cards.
OPS.s4_mindLink = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, me = thisStack(ctx);
  if (!me || C(me.cardId).category !== 'tamer') return;
  const t = await pickStackOf(ctx, p, digimonOf(st, p).filter(s => !s.sources.some(isTamerCard) && (!instr.pred || instr.pred(s, ctx))), instr.prompt || '《마인드 링크》 대상 디지몬 선택');
  if (!t) return;
  detachStack(st, p, me);
  stackUnder(t, me);
  log(ctx, `${p} ${C(me.cardId).nameKo} 《마인드 링크》 → ${C(t.cardId).nameKo}의 진화원 아래`);
};
SCRIPTS['BT17-086::메인'] = [{ op: 's4_mindLink', pred: (s) => nameHas(s.cardId, '펄스몬') }];
SCRIPTS['BT17-091::메인'] = [{ op: 's4_mindLink', pred: (s) => hasTraitAny(s.cardId, ['마수형', 'SoC']) }];
OPS.s4_evolveFromUnderTamer = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, me = thisStack(ctx);
  if (!me) return;
  const holders = tamersOf(st, p).filter(t => t.sources.some(id => isNamed(id, instr.name)));
  if (!holders.length) return;
  if (!(await confirm(ctx, p, `${C(me.cardId).nameKo}을(를) 테이머 아래의 ${instr.name}(으)로 진화시킬까요?`))) return;
  const h = holders.length === 1 ? holders[0] : await pickStackOf(ctx, p, holders, '카드를 가져올 테이머 선택');
  if (!h) return;
  const i = h.sources.findIndex(id => isNamed(id, instr.name));
  const [id] = h.sources.splice(i, 1);
  S.recomputeStackGrants(h);
  S.digivolve(st, p, me.uid, id, 0, 'trash');
};
SCRIPTS['BT19-008::등장 시'] = [{ op: 's4_evolveFromUnderTamer', name: '오메가샤우트몬' }];
SCRIPTS['BT19-033::등장 시'] = [{ op: 's4_evolveFromUnderTamer', name: '예거도루루몬' }];
SCRIPTS['BT19-047::등장 시'] = [{ op: 's4_evolveFromUnderTamer', name: '아트라바리스타몬' }];

// ---- batch 4: evolve families (어택 시 진화), tamer combos ----
const anyDT = (s) => ['digimon', 'tamer'].includes(C(s.cardId).category);
const hybridEvo = (zone, cols, discount, extra) => [{ op: 's4_evolve', subject: { pred: anyDT }, zone, pred: (id) => hasTrait(id, '하이브리드체') && (!cols || hasColor(id, cols)) && (!extra || extra(id)), cost: discount ? { mode: 'discount', n: discount } : { mode: 'normal' }, optional: true, prompt: '진화시킬 자신의 디지몬/테이머 선택' }];
SCRIPTS['BT18-022::어택 시'] = hybridEvo('hand', ['blue', 'red'], 1);
SCRIPTS['BT18-048::어택 시'] = hybridEvo('hand', ['green', 'red'], 1);
SCRIPTS['BT18-063::어택 시'] = hybridEvo('hand', ['black', 'yellow'], 1);
SCRIPTS['BT18-076::어택 시'] = hybridEvo('trash', ['purple', 'yellow'], 0);
SCRIPTS['BT18-078::어택 시'] = hybridEvo('trash', null, 1, (id) => lvOf(id) === 4);
SCRIPTS['P-160::어택 시'] = [cond((ctx) => { const s = thisStack(ctx); return s && s.sources.some(id => nameHas(id, '티라노몬') || isNamed(id, 'X항체') || hasTrait(id, 'X항체')); }, [ // 「X항체」 = the trait (same card prints "특징 「X항체」를 갖지 않은")
  { op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => nameHas(id, '티라노몬') || hasTrait(id, '공룡형'), cost: { mode: 'discount', n: 1 }, optional: true }])];
SCRIPTS['BT17-090::상대의 턴 종료 시'] = [cond((ctx) => { const s = thisStack(ctx); return s && s.suspended; }, [
  { op: 's4_evolve', subject: { pred: (s) => C(s.cardId).category === 'digimon' && s.sources.some(isTamerCard) }, zone: 'trash', pred: (id) => nameHas(id, '데크스'), cost: { mode: 'free' }, optional: true }])];
// This tamer + two trash cards go under one of our named digimon, which then evolves from hand.
OPS.s4_tamerCombine = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], me = thisStack(ctx);
  V(ctx).evolved = false;
  if (!me || C(me.cardId).category !== 'tamer') return;
  const digis = digimonOf(st, p).filter(s => isNamed(s.cardId, instr.digiName));
  const hi = pl.hand.findIndex(id => isNamed(id, instr.resultName) && isDigimonCard(id));
  const okTrash = instr.place.every(n => pl.trash.some(id => isNamed(id, n)));
  if (!digis.length || hi < 0 || !okTrash) { log(ctx, '조건을 만족하는 조합이 없음'); return; }
  const cand = digis.filter(s => canEvolveInto(st, p, s, pl.hand[hi], true).ok);
  if (!cand.length) return;
  if (!(await confirm(ctx, p, `${C(me.cardId).nameKo}과(와) 트래시의 ${instr.place.join('/')}을(를) ${instr.digiName} 아래에 놓고 ${instr.resultName}(으)로 진화시킬까요?`))) return;
  const t = cand.length === 1 ? cand[0] : await pickStackOf(ctx, p, cand, '진화시킬 디지몬 선택');
  if (!t) return;
  for (const n of instr.place) { const i = pl.trash.findIndex(id => isNamed(id, n)); const [id] = pl.trash.splice(i, 1); t.sources.unshift(id); }
  detachStack(st, p, me);
  stackUnder(t, me);
  const cost = instr.cost?.mode === 'fixed' ? instr.cost.n : 0;
  S.digivolve(st, p, t.uid, pl.hand[hi], cost, 'hand');
  V(ctx).evolved = true;
};
SCRIPTS['BT17-080::자신의 턴 종료 시'] = [{ op: 's4_tamerCombine', digiName: '길몬', place: ['그라우몬', '메가로그라우몬'], resultName: '듀크몬', cost: { mode: 'free' } }];
SCRIPTS['BT17-085::메인'] = [
  { op: 's4_tamerCombine', digiName: '레나몬', place: ['구미호몬', '도사몬'], resultName: '샤크라몬', cost: { mode: 'fixed', n: 4 } },
  cond((ctx) => V(ctx).evolved, [{ op: 's4_trashToHand', pred: isOptionCard, prompt: '트래시의 옵션 카드 1장을 패로 되돌림 (선택 안 함 가능)' }]),
];

// ---- batch 5: shields, security manipulation, misc ----
SCRIPTS['BT17-020::어택 시'] = [{ op: 's4_play', zone: 'hand', pred: (id) => isTamerCard(id) && hasSourceEffect(id), costDelta: -2 }];
OPS.s4_toSecurityTop = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const i = await pickIdx(ctx, p, 'hand', (id) => !instr.pred || instr.pred(id), instr.prompt || '시큐리티 위에 놓을 카드 선택 (선택 안 함 가능)');
  if (i == null) return;
  const [id] = pl.hand.splice(i, 1);
  S.addToSecurity(st, p, id, 'top');
};
SCRIPTS['LM-023::등장 시'] = [{ op: 's4_toSecurityTop', pred: (id) => (isTamerCard(id) && hasColor(id, ['yellow'])) || (isOptionCard(id) && (C(id).colors || []).length === 1 && (C(id).cost || 0) <= 5) }];
// 자신의 패 1장 파기 → 상대가 시큐리티 1장 파기할 수 있다, 파기하지 않으면 리커버리 +1
OPS.s4_luceDiscard = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  if (!pl.hand.length) return;
  const idx = await ctx.choose('pickFromHandIndexes', { player: p, eligibleIdxs: pl.hand.map((id, i) => i), n: 1, prompt: '파기할 패 1장 선택' });
  if (!idx || !idx.length) return;
  S.trashFromHand(st, p, idx[0]);
  let trashed = false;
  if (st.players[ctx.opp].security.length && await confirm(ctx, ctx.opp, `${ctx.opp}: 자신의 시큐리티를 위에서부터 1장 파기할까요? (파기하지 않으면 상대가 리커버리 +1)`)) { trashed = !!S.trashTopSecurityByEffect(st, ctx.opp); }
  V(ctx).oppTrashed = trashed;
  if (!trashed) S.recoverTopOfDeckToSecurity(st, p);
};
SCRIPTS['BT18-034::자신의 메인 페이즈 개시 시'] = [{ op: 's4_luceDiscard' }];
// 자신의 Lv.6 디지몬 1마리를 시큐리티 위에 놓는 것으로, 이 디지몬을 트래시의 「루체몬: 폴다운 모드」로 진화
OPS.s4_luceFallDown = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], me = thisStack(ctx);
  if (!me) return;
  const cands = digimonOf(st, p).filter(s => s !== me && lvOf(s.cardId) === 6);
  const ti = pl.trash.findIndex(id => isNamed(id, '루체몬: 폴다운 모드'));
  if (!cands.length || ti < 0 || !canEvolveInto(st, p, me, pl.trash[ti], true).ok) return;
  if (!(await confirm(ctx, p, 'Lv.6 디지몬 1마리를 시큐리티 위에 놓고 루체몬: 폴다운 모드로 진화시킬까요?'))) return;
  const t = cands.length === 1 ? cands[0] : await pickStackOf(ctx, p, cands, '시큐리티 위에 놓을 Lv.6 디지몬 선택');
  if (!t) return;
  detachStack(st, p, t);
  pl.trash.push(...t.sources);
  S.addToSecurity(st, p, t.cardId, 'top');
  const j = pl.trash.findIndex(id => isNamed(id, '루체몬: 폴다운 모드'));
  const [cid] = pl.trash.splice(j, 1);
  S.digivolve(st, p, me.uid, cid, 0, 'trash');
};
SCRIPTS['BT18-034::자신의 턴 종료 시'] = [{ op: 's4_luceFallDown' }];
// 자신의 시큐리티를 위에서부터 1장 파기하는 것으로, 상대의 턴 종료까지 디지몬 1마리의 원래 DP를 6000으로
OPS.s4_setBaseDP6000 = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  if (!st.players[p].security.length) return;
  const entries = [];
  for (const pp of [p, ctx.opp]) for (const s of digimonOf(st, pp)) entries.push({ player: pp, uid: s.uid });
  if (!entries.length) return;
  const pk = await ctx.choose('pickStackAnySide', { entries, prompt: '원래 DP를 6000으로 변경할 디지몬 선택', fxKind: 'other' });
  if (!pk) return;
  const t = stackByUid(st, pk.player, pk.uid);
  if (!t) return;
  S.trashTopSecurityByEffect(st, p);
  S.setBaseInfo(st, pk.player, t, { dp: instr.value, until: untilOppTurnEnd(st) }); // 15-8-2-5 timestamped
  log(ctx, `${pk.player} ${C(t.cardId).nameKo}의 원래 DP가 ${instr.value}(으)로 변경됨`);
  S._s4.ruleCheckDP(st, pk.player, t);
};
SCRIPTS['BT18-039::등장 시'] = [{ op: 's4_setBaseDP6000', value: 6000 }];
SCRIPTS['BT18-052::등장 시'] = [{ op: 's4_retreatByFaceUp' }];
OPS.s4_retreatByFaceUp = async (instr, ctx) => {
  const st = ctx.state, n = S.secFaceUpCount(st.players[ctx.self]);
  if (!n) { log(ctx, '앞면의 시큐리티가 없어 퇴화하지 않음'); return; }
  const t = await pickStackOf(ctx, ctx.opp, digimonOf(st, ctx.opp), `《퇴화 ${n}》 할 상대의 디지몬 선택`, 'retreat');
  if (t) S.retreat(st, ctx.opp, t.uid, n); // "앞면 시큐리티 1장마다 《퇴화 1》" 반복 — 매번 1장뿐이라 선언 단계가 없다
};
// cost: trash a hand card that mentions the name → shield one own digimon
OPS.s4_trashHandNamed = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  V(ctx).paid = false;
  const i = await pickIdx(ctx, p, 'hand', (id) => nameHas(id, instr.name), `파기할 「${instr.name}」이(가) 기술되어 있는 패 1장 선택`);
  if (i == null) return;
  S.trashFromHand(st, p, i);
  V(ctx).paid = true;
};
SCRIPTS['BT18-062::등장 시'] = [{ op: 's4_trashHandNamed', name: '나이트몬' }, cond((ctx) => V(ctx).paid, [{ op: 's4_shield', kinds: ['delete'], dur: 'opp' }])];
SCRIPTS['BT18-063::진화 시'] = [{ op: 's4_shield', thisStack: true, kinds: ['delete'], dur: 'opp' }];
SCRIPTS['BT18-064::등장 시'] = [{ op: 's4_shield', thisStack: true, kinds: ['bounce'], dur: 'opp' }];
SCRIPTS['BT19-051::등장 시'] = [{ op: 's4_shield', kinds: ['bounce'], dur: 'opp', dp: 3000 }];
SCRIPTS['P-162::등장 시'] = [{ op: 's4_shield', pick: (s, ctx) => stackHasTrait(ctx.state, s, 'DS'), kinds: ['dpDown', 'retreat'], dur: 'opp' }];
SCRIPTS['BT17-038::자신의 턴'] = [{ op: 's4_shield', thisStack: true, kinds: ['bounce'], dur: 'opp' }];
SCRIPTS['BT19-040::자신의 턴'] = [{ op: 's4_playToken', token: 'daerong' }];
OPS.s4_playToken = async (instr, ctx) => { playTokenStack(ctx, ctx.self, instr.token === 'daerong' ? TOKEN_DAERONG() : TOKEN_DIABOLOMON()); };
SCRIPTS['BT17-053::소멸 시'] = [cond((ctx) => { const d = delInfo(ctx); return d && hasTrait(d.cardId, '종족불명'); }, [{ op: 's4_playTokenOptional', token: 'diabolomon' }])];
OPS.s4_playTokenOptional = async (instr, ctx) => { if (await confirm(ctx, ctx.self, '「디아블로몬」 토큰을 코스트 없이 등장시킬까요?')) playTokenStack(ctx, ctx.self, TOKEN_DIABOLOMON()); };
SCRIPTS['BT19-043::자신의 턴 종료 시'] = [{ op: 's4_oppMayTrashSec' }, cond((ctx) => !V(ctx).oppTrashed, [{ op: 'recoverTop', who: 'self' }, { op: 's4_destroy', kinds: ['digimon', 'tamer'], n: 1 }])];
// ---- batch 6: hooks — continuous abilities, immunity, auras, event watchers ----
const effMemory = (st, p) => (p === 'p1' ? st.memory : -st.memory);
H('P-144', { tag: '자신의 턴', has: '어택할 수 없다', noAttack: (st, hp, h) => !h.sources.some(id => (isNamed(id, '울퉁몬') || isNamed(id, 'X항체'))) }); // slice-4 QA 4259: a source with the X-antibody TRAIT does not count — only cards named/treated as 「울퉁몬」/「X항체」
H('BT17-016', { tag: '자신의 턴', has: '상대의 효과를 받지 않는다', effectImmune: (st, hp, h, target) => target === h && effMemory(st, hp) <= 0 });
const restedImmune = { tag: '서로의 턴', has: '상대의 디지몬의 효과를 받지 않는다', effectImmune: (st, hp, h, target, tp, fx) => target === h && h.suspended && fx.src && (fx.src.isDigimon || fx.src.category === 'digimon') };
H('P-140', restedImmune);
H('LM-024', restedImmune);
H('EX7-041', { tag: '상대의 턴', has: '상대의 효과로 소멸하지 않는다', effectImmune: (st, hp, h, target, tp, fx) => target === h && fx.kind === 'delete' });
H('BT17-076', { tag: '자신의 턴', has: '전부를 DP', dp: (st, hp, h, target, tp) => (tp === hp && C(target.cardId).category === 'digimon' && isNamed(target.cardId, '에오스몬')) ? 1000 * tamersOf(st, hp).length : 0 });
H('P-147', { tag: '자신의 턴', has: 'DP +3000', dp: (st, hp, h, target) => (target === h && tamersOf(st, hp).length > 0) ? 3000 : 0 });
H('EX7-022', { tag: '자신의 턴', has: '어택의 대상은 변경되지 않는다', redirectImmune: (st, hp, h, aStack, ap) => ap === hp && C(aStack.cardId).category === 'digimon' && stackHasTrait(st, aStack, 'NSp') });
H('BT17-069', { tag: '자신의 턴', src: 'inheritedKo', has: '턴 종료 조건', turnEndAt: (st, hp, h) => nameHas(h.cardId, '펜리루가몬') ? 3 : 1 });
H('BT17-092', { tag: '서로의 턴', has: '효과는 발휘하지 않는다', suppressTrigger: (st, hp, h, tp, target, tag) => tp !== hp && tag === '등장 시' && C(target.cardId).category === 'tamer' && digimonOf(st, hp).some(s => isNamed(s.cardId, '에오스몬')) });
H('EX7-010', { tag: '자신의 턴', has: '「3총사」를 얻는다', types: () => ['3총사'] });
H('BT17-102', { tag: '서로의 턴', has: '명칭 전부를 얻는다', names: (st, hp, h) => h.sources.filter(id => lvOf(id) <= 3).flatMap(namesOfCard) });
// P-146 (inherited): battle loss → put 「충전 플러그인 Q」 from the evolution cards under security instead
H('P-146', { tag: '서로의 턴', src: 'inheritedKo', has: '충전 플러그인 Q', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (target !== h || cause !== 'battle' || mode !== 'delete') return false;
  const i = h.sources.findIndex(id => isNamed(id, '충전 플러그인 Q'));
  if (i < 0) return false;
  const [id] = h.sources.splice(i, 1);
  S.recomputeStackGrants(h);
  S.addToSecurity(st, hp, id, 'bottom');
  S.log(st, `${hp} ${C(h.cardId).nameKo}: 충전 플러그인 Q를 시큐리티 아래에 놓아 소멸하지 않음`);
  return true;
} });
// ---- event watchers (script runs through the normal pending pipeline) ----
H('BT17-028', { tag: '자신의 턴', has: '패가 효과로 늘어났을 때', limit: 1, events: { handIncrease: () => true } });
SCRIPTS['BT17-028::자신의 턴'] = [{ op: 'securityTopToHand', who: 'opponent', n: 1 }];
H('P-137', { tag: '자신의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: (st, hp, h, info) => info.stack === h } });
SCRIPTS['P-137::자신의 턴'] = [{ op: 'securityTopToHand', who: 'opponent', n: 1 }];
H('BT17-036', { tag: '서로의 턴', has: '시큐리티가 효과로 파기되었을 때', limit: 1, events: { securityDiscard: (st, hp, h, info) => info.owner === hp && h.sources.some(id => isNamed(id, '레온 알렉산더')) } });
SCRIPTS['BT17-036::서로의 턴@시큐리티가 효과로 파기되었을 때'] = [{ op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => nameHas(id, '펄스몬'), cost: { mode: 'free' }, optional: true }];
const optUsed2 = { tag: '자신의 턴', has: '옵션 카드를 사용했을 때', limit: 1, events: { optionUsed: (st, hp, h, info) => info.owner === hp && ((info.baseCost ?? (info.cardId && C(info.cardId) ? (C(info.cardId).cost || 0) : info.useCost)) >= 2) } }; // 「사용 코스트」 = the printed use cost (not the reduced/paid amount; effect-driven uses may not carry useCost)
H('BT17-038', { ...optUsed2 });
H('BT19-040', { ...optUsed2 });
H('BT17-006', { tag: '자신의 턴', src: 'inheritedKo', has: '테이머 카드가 놓였을 때', limit: 1, events: { sourcesAdded: (st, hp, h, info) => info.stack === h && info.added.some(isTamerCard) } });
SCRIPTS['BT17-006::자신의 턴'] = [{ op: 's4_evolve', subject: { this: true }, zone: 'trash', pred: (id) => hasTrait(id, 'SoC'), cost: { mode: 'normal' }, optional: true }];
H('BT17-056', { tag: '서로의 턴', has: '진화원이 자신의 디지몬의 효과로', events: { sourcesAdded: (st, hp, h, info) => info.stack === h && info.srcPlayer === hp && info.srcCategory === 'digimon' } });
SCRIPTS['BT17-056::서로의 턴@진화원이 자신의 디지몬의 효과로'] = [{ op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => isNamed(id, '그랜드로코몬'), cost: { mode: 'free' }, optional: true }];
H('ST18-12', { tag: '서로의 턴', has: '액티브가 되었을 때', limit: 1, events: { active: () => true } });
SCRIPTS['ST18-12::서로의 턴'] = [{ op: 's4_shield', thisStack: true, kinds: ['all'], fromCategory: 'digimon', dur: 'turn', dp: 3000 }];
H('BT17-064', { tag: '자신의 턴', has: '진화원을 갖지 않은 상대의 디지몬에게 어택했을 때', selfContained: true, events: { attackOnDigimon: (st, hp, h, info) => {
  if (info.stack === h && info.target && info.target.sources.length === 0) {
    S.log(st, `${hp} ${C(h.cardId).nameKo}: 진화원 없는 ${C(info.target.cardId).nameKo}을(를) 소멸시킴`);
    S.deleteStack(st, oppOf(hp), info.target.uid, 'trash', 'effect');
  }
  return false;
} } });
// ---- batch 7: replacement hooks (leave / delete), redirects, cost discounts ----
const leaveMode = (mode) => mode === 'delete' || mode === 'bounce';
function bounceTamerToHand(st, p, tamer) {
  const pl = st.players[p];
  detachStack(st, p, tamer);
  pl.hand.push(tamer.cardId);
  pl.trash.push(...tamer.sources);
  S.log(st, `${p} ${C(tamer.cardId).nameKo} 패로 되돌림`);
}
const d39 = { tag: '서로의 턴', has: '옐로인 자신의 테이머 1명을 패로', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (target !== h || cause !== 'effect' || !leaveMode(mode)) return false;
  const t = tamersOf(st, hp).find(s => stackHasColor(s, ['yellow']));
  if (!t || !S.hookUseOnce(h, 'BT17-039', d39)) return false;
  bounceTamerToHand(st, hp, t);
  S.log(st, `${hp} ${C(h.cardId).nameKo}: 옐로 테이머를 패로 되돌려 벗어나지 않음`);
  return true;
} };
H('BT17-039', d39);
const d61 = { tag: '서로의 턴', has: '리리스몬」/「X항체」가 있다면', preventLeaveOptions: (st, hp, h, target, tp, cause, mode) => {
  // "다른 디지몬 1마리를 소멸시키는 것으로" — ANY other digimon (either side); each candidate is its own option for the player.
  if (target !== h || cause === 'battle' || !leaveMode(mode)) return [];
  if (!h.sources.some(id => (isNamed(id, '리리스몬') || hasTrait(id, 'X항체')))) return [];
  if (S.turnUsesRemaining(h, S.onceLimitKey('EX7-061', [d61.tag, d61.has || '']), 1) <= 0) return [];
  const out = [];
  for (const pp of [oppOf(hp), hp]) for (const s of st.players[pp].battle) {
    if (s === h || C(s.cardId).category !== 'digimon') continue;
    if (pp !== hp && S.effectBlocked(st, pp, s, 'delete')) continue;
    out.push({ apply: () => {
      if (!S.hookUseOnce(h, 'EX7-061', d61)) return false;
      S.log(st, `${hp} ${C(h.cardId).nameKo}: ${C(s.cardId).nameKo}을(를) 소멸시켜 벗어나지 않음`);
      S.deleteStack(st, pp, s.uid, 'trash', pp === hp ? 'ownEffect' : 'effect');
      return true;
    } });
  }
  return out;
} };
H('EX7-061', d61);
// Delay-option replacements (option stack placed in the battle area)
H('BT17-097', { tag: '서로의 턴', has: '황제드라몬', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (C(h.cardId).category !== 'option' || st.turnNumber <= h.placedTurn || mode !== 'delete' || cause === 'ownEffect') return false;
  if (C(target.cardId).category !== 'digimon' || !stackHasTrait(st, target, '프리')) return false;
  const pl = st.players[hp];
  const id = pl.hand.find(x => isDigimonCard(x) && nameHas(x, '황제드라몬') && canEvolveInto(st, hp, target, x, false).ok);
  if (!id) return false;
  S.discardForDelay(st, hp, h.uid);
  S.digivolve(st, hp, target.uid, id, 0, 'hand');
  return true;
} });
H('BT17-095', { tag: '서로의 턴', has: '오메가몬」을 포함하는 디지몬 카드로 조그레스', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (C(h.cardId).category !== 'option' || st.turnNumber <= h.placedTurn || !leaveMode(mode) || cause === 'battle') return false;
  if (C(target.cardId).category !== 'digimon' || lvOf(target.cardId) !== 6 || !(nameHas(target.cardId, '그레이몬') || nameHas(target.cardId, '가루몬'))) return false;
  const pl = st.players[hp];
  for (let ti = 0; ti < pl.hand.length; ti++) {
    const t = pl.hand[ti];
    if (!isDigimonCard(t) || !nameHas(t, '오메가몬') || !S.parseJogress(t)) continue;
    for (let mi = 0; mi < pl.hand.length; mi++) {
      if (mi === ti || !isDigimonCard(pl.hand[mi]) || !S.parseJogress(t).test(C(target.cardId), C(pl.hand[mi]))) continue;
      const matId = pl.hand[mi];
      S.discardForDelay(st, hp, h.uid);
      for (const i of [ti, mi].sort((a, b) => b - a)) pl.hand.splice(i, 1);
      fuseWithCard({ state: st }, hp, target, matId, t, S.parseJogress(t).cost);
      return true;
    }
  }
  return false;
} });
// [트래시] replacement evolutions: 「X」 would be deleted → evolve it into this trash card instead
const trashSave = (name, has) => ({ zone: 'trash', tag: '서로의 턴', has, preventLeave: (st, hp, h, target, tp, cause, mode, id) => {
  if (mode !== 'delete' || C(target.cardId).category !== 'digimon' || !isNamed(target.cardId, name)) return false;
  const pl = st.players[hp];
  const i = pl.trash.indexOf(id);
  if (i < 0) return false;
  pl.trash.splice(i, 1);
  S.log(st, `${hp} 트래시의 ${C(id).nameKo}(으)로 ${C(target.cardId).nameKo}을(를) 진화시켜 소멸하지 않음`);
  S.digivolve(st, hp, target.uid, id, 0, 'trash');
  return true;
} });
H('BT17-065', trashSave('도루가몬', '소멸하지 않는다'));
H('BT17-067', trashSave('도루그레몬', '소멸하지 않는다'));
H('BT17-073', trashSave('도루고라몬', '소멸하지 않는다'));
H('P-154', { tag: '서로의 턴', has: '진화원 아래에 놓는 것으로', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (target === h || cause !== 'effect' || !leaveMode(mode) || C(target.cardId).category !== 'digimon' || !nameHas(target.cardId, '나이트몬')) return false;
  if (!st.players[hp].battle.includes(h)) return false;
  detachStack(st, hp, h);
  stackUnder(target, h);
  S.log(st, `${hp} ${C(h.cardId).nameKo}: ${C(target.cardId).nameKo}의 진화원 아래에 놓여 ${C(target.cardId).nameKo}은(는) 벗어나지 않음`);
  return true;
} });
H('BT19-048', { tag: '서로의 턴', has: '시큐리티 아래에 앞면으로 놓는 것으로', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (target === h || (cause !== 'effect' && cause !== 'ownEffect') || !leaveMode(mode) || C(target.cardId).category !== 'digimon' || !stackHasTrait(st, target, '로얄 베이스')) return false;
  if (!st.players[hp].battle.includes(h)) return false;
  detachStack(st, hp, h);
  st.players[hp].trash.push(...h.sources);
  S.secAddFaceUp(st, hp, h.cardId, 'bottom');
  S.log(st, `${hp} ${C(h.cardId).nameKo}을(를) 시큐리티 아래에 앞면으로 놓아 ${C(target.cardId).nameKo}은(는) 벗어나지 않음`);
  return true;
} });
H('BT19-053', { tag: '서로의 턴', has: '시큐리티 아래에 앞면으로 놓을 수 있다', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (cause === 'battle' || !leaveMode(mode) || C(target.cardId).category !== 'digimon' || !stackHasTrait(st, target, '로얄 베이스')) return false; // 「배틀 이외로 벗어날 때」 = delete AND bounce
  if (!st.players[hp].battle.includes(target)) return false;
  detachStack(st, hp, target);
  st.players[hp].trash.push(...target.sources);
  S.secAddFaceUp(st, hp, target.cardId, 'bottom');
  S.log(st, `${hp} ${C(target.cardId).nameKo}을(를) 시큐리티 아래에 앞면으로 놓음`);
  return true;
} });
H('BT18-086', { tag: '서로의 턴', has: '배틀 에어리어로 이동시키는 것으로', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  const pl = st.players[hp];
  if (pl.raising !== h || !leaveMode(mode) || !isNamed(target.cardId, '루체몬: 사탄 모드')) return false;
  pl.raising = null;
  pl.battle.push(h);
  S.log(st, `${hp} ${C(h.cardId).nameKo}을(를) 배틀 에어리어로 이동시켜 ${C(target.cardId).nameKo}은(는) 벗어나지 않음`);
  S.queueTriggersForStack(st, hp, h, 'move');
  return true;
} });
H('BT18-086', { tag: '서로의 턴', has: 'DP 0의 자신의 디지몬 전부는 소멸하지 않는다', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (mode !== 'delete' || C(target.cardId).category !== 'digimon') return false;
  if (!digimonOf(st, hp).some(s => nameHas(s.cardId, '루체몬') && !stackHasColor(s, ['white']))) return false;
  return S.effectiveDP(st, tp, target) === 0;
} });
// "벗어날 때 …진화원의 크로스 하트 디지몬 카드 3장까지를 테이머 아래에 놓을 수 있다" — a trigger on leaving (does not prevent it)
const crossHeartLeave = { tag: '서로의 턴', has: '크로스 하트」를 가진 디지몬 카드 3장까지를', preventLeave: (st, hp, h, target, tp, cause, mode) => {
  if (target !== h || !leaveMode(mode)) return false;
  const t = tamersOf(st, hp)[0];
  if (!t) return false;
  let n = 0;
  for (let i = h.sources.length - 1; i >= 0 && n < 3; i--) if (isDigimonCard(h.sources[i]) && hasTrait(h.sources[i], '크로스 하트')) { const [id] = h.sources.splice(i, 1); t.sources.unshift(id); n++; }
  if (n) { S.recomputeStackGrants(h); S.recomputeStackGrants(t); S.log(st, `${hp} ${C(h.cardId).nameKo}의 진화원 ${n}장을 ${C(t.cardId).nameKo} 아래에 놓음`); }
  return false;
} };
H('BT19-010', crossHeartLeave);
H('BT19-013', crossHeartLeave);
// ---- redirects ----
const eosRedirect = (id) => ({ tag: '상대의 턴', src: 'inheritedKo', has: '어택의 대상을 자신의 「에오스몬」', redirectOptions: (st, hp, h, ap, aStack) => {
  if (S.turnUsesRemaining(h, S.onceLimitKey(id, ['어택대상변경']), 1) <= 0) return [];
  return digimonOf(st, hp).filter(s => isNamed(s.cardId, '에오스몬')).map(s => ({ targetUid: s.uid, limit: 1, label: `${C(s.cardId).nameKo}(으)로 어택 대상 변경 (${C(id).nameKo})` }));
} });
H('BT17-074', eosRedirect('BT17-074'));
H('BT17-075', eosRedirect('BT17-075'));
H('ST18-14', { tag: '자신의 턴', has: '어택의 대상을 다른 상대의 디지몬 또는 플레이어로 변경한다', attackerRedirect: (st, hp, h, aStack, curT) => {
  if (C(h.cardId).category !== 'tamer' || h.suspended || !aStack) return [];
  const out = [];
  for (const uid of S.legalDigimonTargets(st, hp, aStack.uid)) if (uid !== curT) out.push({ targetUid: uid, label: `이 테이머를 레스트시켜 ${C(stackByUid(st, oppOf(hp), uid).cardId).nameKo}(으)로 어택 대상 변경`, pay: async () => { S.restStack(st, hp, h.uid); return h.suspended; } });
  if (S.canAttackPlayer(st, hp, aStack.uid)) out.push({ toPlayer: true, label: '이 테이머를 레스트시켜 플레이어로 어택 대상 변경', pay: async () => { S.restStack(st, hp, h.uid); return h.suspended; } });
  return out;
} });
// ---- play-cost discount (EX6-006 inherited): confirmed by the UI like the other playDiscount hooks
const d006 = { tag: '자신의 턴', src: 'inheritedKo', has: '지불하는 등장 코스트 -3', playDiscount: (st, hp, h, cardId) => {
  const pl = st.players[hp];
  if (pl.raising !== h || !isDigimonCard(cardId) || !hasTrait(cardId, '7대마왕')) return null;
  if (S.turnUsesRemaining(h, S.onceLimitKey('EX6-006', ['자신의 턴']), 1) <= 0) return null;
  const distinct = new Set(h.sources.map(id => C(id).nameKo)).size;
  const amt = distinct >= 5 ? -4 : -3;
  return { label: `${C('EX6-006').nameKo}: ${C(cardId).nameKo} 등장 코스트 ${amt} 할까요?`, apply: () => { S.markTurnEffectUsed(h, S.onceLimitKey('EX6-006', ['자신의 턴'])); return amt; } };
} };
H('EX6-006', d006);
// ---- batch 8: attacks, tokens, levels, hand/trash-zone abilities ----
OPS.s4_parasite = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const hi = pl.hand.indexOf(ctx.sourceCardId);
  const cands = digimonOf(st, p).filter(s => lvOf(s.cardId) >= 5);
  if (hi < 0 || !cands.length) { log(ctx, '패러사이몬: 조건을 만족하는 디지몬이 없음'); return; }
  const target = await pickStackOf(ctx, p, cands, '패러사이몬을 진화원 아래에 놓을 Lv.5 이상의 디지몬 선택 (4 코스트 지불)');
  if (!target) return;
  S.spendMemory(st, 4);
  pl.hand.splice(hi, 1);
  target.sources.unshift(ctx.sourceCardId);
  S.recomputeStackGrants(target);
  log(ctx, `${p} 패러사이몬을 ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
  // Q2804: 레스트시키는 것과 그 디지몬으로 어택하는 것은 하나로 묶인 처리다 — 레스트만 시키고 어택을 안 하는 건 안 된다.
  // 실제로 어택할 수 있는 상황일 때만 상대를 레스트시키고, 그렇지 않으면(대상 없음/거절) 둘 다 하지 않는다.
  if (target.suspended) return; // 이 디지몬이 이미 레스트라 애초에 어택할 수 없음
  const o = await pickStackOf(ctx, ctx.opp, digimonOf(st, ctx.opp), '레스트시킬 상대의 디지몬 선택', 'rest');
  if (!o) return;
  // 어택 대상은 기본적으로 레스트 상태여야 하므로(legalDigimonTargets), 실제로 레스트시키기 전에는 방금 고른 o조차
  // 아직 액티브라 후보에 안 잡힌다 — 레스트를 임시로 가정해(부수효과 없는 단순 필드 토글) 진짜로 어택이 가능한지 미리 본다.
  const wasSuspended = o.suspended; o.suspended = true;
  const legal = S.legalDigimonTargets(st, p, target.uid);
  o.suspended = wasSuspended;
  if (!legal.length) return;
  if (!(await confirm(ctx, p, `${C(o.cardId).nameKo}을(를) 레스트시키고 ${C(target.cardId).nameKo}(으)로 상대의 디지몬에게 어택할까요? (아니오 = 레스트도 하지 않음)`))) return;
  S.restStack(st, ctx.opp, o.uid); // 이미 수락했으므로 이제부터는 확정 — 대상 고르기도 필수(취소해도 레스트는 되돌리지 않음)
  const legal2 = S.legalDigimonTargets(st, p, target.uid);
  const tgt = await pickStackOf(ctx, ctx.opp, legal2.map(u => stackByUid(st, ctx.opp, u)).filter(Boolean), '어택할 상대의 디지몬 선택', 'attack', true);
  if (!tgt) return;
  if (ctx.startAttack) ctx.startAttack(p, target.uid, tgt.uid);
};
SCRIPTS['BT17-050::메인'] = [{ op: 's4_parasite' }];
OPS.s4_putThisUnderOther = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, me = thisStack(ctx);
  if (!me || !st.players[p].battle.includes(me)) return;
  const t = await pickStackOf(ctx, p, digimonOf(st, p).filter(s => s !== me), '이 디지몬을 진화원 아래에 놓을 다른 디지몬 선택 (선택 안 함 가능)');
  if (!t) return;
  detachStack(st, p, me);
  stackUnder(t, me);
  log(ctx, `${p} ${C(me.cardId).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
};
SCRIPTS['BT17-050::어택 종료 시'] = [{ op: 's4_putThisUnderOther' }];
OPS.s4_sacrificePlay = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], me = thisStack(ctx);
  const ti = pl.trash.findIndex(id => isNamed(id, instr.name));
  const others = digimonOf(st, p).filter(s => s !== me);
  if (ti < 0 || !others.length) return;
  if (!(await confirm(ctx, p, `다른 자신의 디지몬 1마리를 소멸시키고 트래시의 ${instr.name}을(를) 등장시킬까요?`))) return;
  const t = await pickStackOf(ctx, p, others, '소멸시킬 자신의 다른 디지몬 선택');
  if (!t) return;
  S.deleteStack(st, p, t.uid, 'trash', 'ownEffect');
  const j = pl.trash.findIndex(id => isNamed(id, instr.name));
  if (j >= 0) S.playFreeFromZone(st, p, 'trash', j, {});
};
SCRIPTS['BT17-071::진화 시'] = [cond((ctx) => { const s = thisStack(ctx); return s && srcHasName(s, '다르크몬') && srcHasName(s, '히포그리포몬'); }, [{ op: 's4_sacrificePlay', name: '오니스몬' }])];
OPS.s4_attackPlayerWith = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self;
  const cands = (instr.thisOnly ? [thisStack(ctx)].filter(Boolean) : digimonOf(st, p)).filter(s => C(s.cardId).category === 'digimon' && !s.suspended && (!instr.pred || instr.pred(s, ctx)) && S.canAttackPlayer(st, p, s.uid));
  if (!cands.length) { log(ctx, '플레이어에게 어택할 수 있는 디지몬이 없음'); return; }
  const a = cands.length === 1 && instr.thisOnly ? cands[0] : await pickStackOf(ctx, p, cands, '플레이어에게 어택할 디지몬 선택 (선택 안 함 가능)');
  if (a && ctx.startAttack) ctx.startAttack(p, a.uid, 'PLAYER');
};
SCRIPTS['BT17-081::자신의 턴 종료 시'] = [{ op: 's4_attackPlayerWith', pred: (s) => nameHas(s.cardId, '오메가몬') }];
SCRIPTS['BT18-088::자신의 턴 종료 시'] = [{ op: 's4_attackPlayerWith', thisOnly: true, pred: (s, ctx) => stackHasTrait(ctx.state, s, '하이브리드체') || stackHasTrait(ctx.state, s, '10투사') }];
SCRIPTS['BT18-069::상대의 턴 종료 시'] = [{ op: 's4_forceOppAttack' }];
OPS.s4_forceOppAttack = async (instr, ctx) => {
  const st = ctx.state;
  const cands = digimonOf(st, ctx.opp).filter(s => !s.suspended);
  const t = await pickStackOf(ctx, ctx.opp, cands, '어택시킬 상대의 디지몬 선택 (선택 안 함 가능)');
  if (t && ctx.startAttack) ctx.startAttack(ctx.opp, t.uid, undefined);
};
SCRIPTS['BT17-100::자신의 턴 개시 시'] = [cond((ctx) => ctx.state.players[ctx.self].battle.filter(s => s.cardId === 'BT17-100').length >= 4, [{ op: 's4_win' }])];
OPS.s4_win = async (instr, ctx) => { ctx.state.winner = ctx.self; log(ctx, `${ctx.self} 게임에서 승리!`); };
OPS.s4_placeSourceInBattle = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, me = thisStack(ctx);
  if (!me) return;
  const i = me.sources.findIndex(id => isNamed(id, instr.name));
  if (i < 0) return;
  const [id] = me.sources.splice(i, 1);
  S.recomputeStackGrants(me);
  const stack = S._s4.makeStack(id, st.turnNumber);
  stack.playedFromSources = true;
  S.recomputeStackGrants(stack);
  st.players[p].battle.push(stack);
  log(ctx, `${p} ${C(id).nameKo}을(를) 진화원에서 배틀 에어리어에 놓음`);
};
SCRIPTS['BT17-100::상대의 턴 종료 시'] = [{ op: 's4_placeSourceInBattle', name: '종말의 시계' }];
SCRIPTS['BT17-102::진화 시'] = [cond((ctx) => { const s = thisStack(ctx); return s && stackIsNamed(ctx.state, s, '코로몬'); }, [
  { op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'turn' },
  { op: 's4_destroy', kinds: ['digimon'], n: 1, pred: (s, ctx) => { const me = thisStack(ctx); return me && S.effectiveDP(ctx.state, ctx.opp, s) <= S.effectiveDP(ctx.state, ctx.self, me) + S.dpDestroyCapBoost(ctx.state, ctx.self, ctx.sourceStackUid); } }])];
SCRIPTS['EX7-037::진화 시@DP -7000'] = [{ op: 's4_modifyDPOpp', amount: (ctx) => -7000 * digimonOf(ctx.state, ctx.self).length }];
OPS.s4_perLevel = async (instr, ctx) => {
  const st = ctx.state;
  for (const lv of instr.levels) {
    const cands = digimonOf(st, ctx.opp).filter(s => lvOf(s.cardId) === lv);
    const t = await pickStackOf(ctx, ctx.opp, cands, `Lv.${lv}의 상대의 디지몬 1마리 선택`, instr.action === 'bounce' ? 'bounce' : 'delete');
    if (!t) continue;
    if (instr.action === 'bounce') bounceStack(ctx, ctx.opp, t, 'hand'); else S.deleteStack(st, ctx.opp, t.uid, 'trash', 'effect');
  }
};
SCRIPTS['EX7-071::메인'] = [{ op: 's4_perLevel', action: 'destroy', levels: [3, 4, 5] }, { op: 's4_placeThisUnder', pred: (s, ctx) => stackHasTrait(ctx.state, s, '3총사') }];
SCRIPTS['EX7-071::시큐리티'] = [{ op: 's4_perLevel', action: 'destroy', levels: [3, 4, 5] }];
SCRIPTS['P-153::진화 시'] = [{ op: 's4_perLevel', action: 'bounce', levels: [3, 4, 5] }];
OPS.s4_topSourceToSecurity = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, me = thisStack(ctx);
  if (!me || !me.sources.length) return;
  const id = me.sources.pop();
  S.recomputeStackGrants(me);
  S.addToSecurity(st, p, id, 'top');
  S.unsuspendStack(st, p, me.uid);
};
SCRIPTS['P-153::어택 종료 시'] = [{ op: 's4_topSourceToSecurity' }];
const bounceLv3 = [{ op: 's4_bounce', side: 'any', pred: (s) => lvOf(s.cardId) === 3, prompt: '패로 되돌릴 Lv.3 디지몬 선택 (선택 안 함 가능)' }];
SCRIPTS['BT18-023::어택 시'] = bounceLv3;
SCRIPTS['BT18-024::어택 시'] = bounceLv3;
OPS.s4_hatchThisFromHand = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const hi = pl.hand.indexOf(ctx.sourceCardId);
  if (hi < 0 || pl.raising) return;
  const i = await pickIdx(ctx, p, 'trash', (id) => isDigimonCard(id) && hasTrait(id, '3대천사'), '덱 아래로 되돌릴 트래시의 「3대천사」 디지몬 카드 선택');
  if (i == null) return;
  const [bid] = pl.trash.splice(i, 1);
  pl.deck.push(bid);
  pl.hand.splice(pl.hand.indexOf(ctx.sourceCardId), 1);
  const stack = S._s4.makeStack(ctx.sourceCardId, st.turnNumber);
  S.recomputeStackGrants(stack);
  pl.raising = stack;
  log(ctx, `${p} ${C(ctx.sourceCardId).nameKo}을(를) 육성 에어리어에 등장시킴`);
};
SCRIPTS['BT18-033::메인'] = [{ op: 's4_hatchThisFromHand' }];
OPS.s4_playThisFromTrash = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const ti = pl.trash.indexOf(ctx.sourceCardId);
  if (ti < 0 || pl.hand.length > instr.handMax) return;
  const cost = Math.max(0, (C(ctx.sourceCardId).cost || 0) + instr.costDelta);
  if (cost > 0) S.spendMemory(st, cost);
  S.playFreeFromZone(st, p, 'trash', ti, {});
};
SCRIPTS['EX7-060::메인'] = [{ op: 's4_playThisFromTrash', handMax: 4, costDelta: -4 }];
OPS.s4_placeAndBorrow = async (instr, ctx, { runScript }) => {
  await OPS.s4_placeUnder({ target: { this: true }, zones: instr.zones, pred: instr.pred, max: 1, key: 'placed' }, ctx);
  const me = thisStack(ctx);
  if (!V(ctx).placed || !me) return;
  const id = me.sources[0];
  await runBorrowedEffect(ctx, id, instr.tagWord, runScript);
};
SCRIPTS['BT18-066::등장 시'] = [{ op: 's4_placeAndBorrow', zones: ['hand', 'trash'], tagWord: '등장 시', pred: (id) => hasTrait(id, '하이브리드체') && lvOf(id) <= 4 && !isNamed(id, '세피로트몬') }];
SCRIPTS['P-147::어택 시'] = [{ op: 's4_placeAndBorrow', zones: ['hand'], tagWord: '진화 시', pred: (id) => isDigimonCard(id) && lvOf(id) === 4 && nameHas(id, '펄스몬') }];
SCRIPTS['BT18-080::등장 시'] = [
  { op: 's4_destroy', side: 'any', kinds: ['digimon'], n: 1, pred: (s) => stackHasColor(s, ['red', 'green', 'purple', 'white']) && lvOf(s.cardId) <= 4, prompt: '소멸시킬 디지몬 선택' },
  { op: 's4_destroy', side: 'any', kinds: ['tamer'], n: 1, pred: (s) => stackHasColor(s, ['blue', 'yellow', 'black', 'white']) && (C(s.cardId).cost || 0) <= 3, prompt: '소멸시킬 테이머 선택' },
];
SCRIPTS['BT18-100::메인@진화시키는 것으로, 배틀 에어리어의 상대의 옵션'] = [
  { op: 's4_evolve', subject: { pred: (s) => C(s.cardId).category === 'digimon' && nameHas(s.cardId, '루체몬') }, zone: 'trash', pred: (id) => nameHas(id, '루체몬'), cost: { mode: 'discount', n: 3 } },
  cond((ctx) => V(ctx).evolved, [{ op: 's4_destroy', kinds: ['option'], n: 1, prompt: '파기할 상대의 옵션 카드 선택' }]),
];
SCRIPTS['BT19-053::어택 시'] = [{ op: 's4_play', zone: 'security', costDelta: -8, pred: (id, ctx) => isDigimonCard(id) && hasTrait(id, '로얄 베이스') && (ctx.state.players[ctx.self].secUp?.[id] || 0) > 0, prompt: '앞면의 시큐리티에서 등장시킬 카드 선택' }];
OPS.s4_changeColor = async (instr, ctx) => {
  const st = ctx.state;
  const entries = [];
  for (const s of digiOrTamer(st, ctx.opp)) entries.push({ player: ctx.opp, uid: s.uid });
  const t = await pickStackOf(ctx, ctx.opp, digiOrTamer(st, ctx.opp), '원래 색을 변경할 상대의 디지몬/테이머 선택', 'other');
  if (!t) return;
  const names = ['레드', '블루', '옐로', '그린', '블랙', '퍼플'], cols = ['red', 'blue', 'yellow', 'green', 'black', 'purple'];
  const c = await ctx.choose('multipleChoice', { options: names, prompt: '변경할 색 선택 (화이트 이외)' });
  if (c == null) return;
  if (S.effectBlocked(st, ctx.opp, t, 'other')) return;
  S.setBaseInfo(st, ctx.opp, t, { colors: [cols[c]], until: st.turnNumber + 1 }); // 원래 색만 교체(얻은 색은 유지), 만료는 clearExpiredModifiers
  log(ctx, `${ctx.opp} ${C(t.cardId).nameKo}의 원래 색이 ${names[c]}(으)로 변경됨 (상대의 턴 종료까지)`);
};
SCRIPTS['BT18-078::등장 시'] = [{ op: 's4_changeColor' }];
OPS.s4_oppMayTrashSec = async (instr, ctx) => {
  const st = ctx.state; V(ctx).oppTrashed = false;
  if (st.players[ctx.opp].security.length && await confirm(ctx, ctx.opp, `${ctx.opp}: 자신의 시큐리티를 위에서부터 1장 파기할까요?`)) V(ctx).oppTrashed = !!S.trashTopSecurityByEffect(st, ctx.opp);
};

// BT22-093 【자신의 턴】 자신의 디지몬이 특징 「CS」를 가진 디지몬으로 진화했을 때, 그 디지몬의 진화원에 진화한 디지몬과 Lv.이 같은 카드가 있다면, 이 테이머를 레스트시키는 것으로,
// 그 디지몬을 패의 특징 「CS」를 가진 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
// 15-8-3-8: "진화한 디지몬의 Lv." is the level AT TRIGGER TIME (ctx.trigger.evtSnap), not whatever the stack has become by the time this resolves.
SCRIPTS['BT22-093::자신의 턴'] = [{ op: 's4_bt22_093' }];
OPS.s4_bt22_093 = async (instr, ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const snap = ctx.trigger?.evtSnap, uid = ctx.trigger?.evtStackUid;
  const target = uid && stackByUid(st, p, uid);
  const me = thisStack(ctx);
  if (!snap || !target || !me || me.suspended) return;
  if (!target.sources.some(id => C(id).level != null && C(id).level === snap.level)) { log(ctx, '진화원에 진화한 디지몬과 Lv.이 같은 카드가 없어 발휘하지 않음'); return; }
  const ok = (id, c, s) => isDigimonCard(id) && hasTrait(id, 'CS');
  if (!pl.hand.some(id => ok(id) && canEvolveInto(st, p, target, id, false).ok) || !(await confirm(ctx, p, `${C(me.cardId).nameKo}를 레스트시켜 ${C(target.cardId).nameKo}을(를) 패의 「CS」 디지몬으로 코스트 없이 진화시킬까요?`))) return;
  S.restStack(st, p, me.uid);
  await OPS.s4_evolve({ subject: { pred: (s) => s.uid === uid }, zone: 'hand', pred: (id) => ok(id), cost: { mode: 'free' } }, ctx);
};

// ───────── event watchers that had NO implementation (found by the deep verification pass): continuous-tagged "~했을 때" abilities the generic
// watcher parser rejects ("등장/진화했을 때", "어택의 대상이 변경되었을 때", "벗어날 때" triggers …) were only "covered" as if they were ordinary triggers ─────────
OPS.s4_fn = async (instr, ctx) => { await instr.fn(ctx); };
const fnOp = (f) => ({ op: 's4_fn', fn: f });
const wasDeleted = (st, stack) => !!(st.deletedInfo || {})[stack.uid];
const evtOf = (ctx) => ctx.trigger?.evt || null;
const activeTamer = (h) => C(h.cardId).category === 'tamer' && !h.suspended;
const unsuspendThis = fnOp(async (ctx) => { const h = thisStack(ctx); if (h && h.suspended && await confirm(ctx, ctx.self, `${C(h.cardId).nameKo}을(를) 액티브로 할까요?`)) S.unsuspendStack(ctx.state, ctx.self, h.uid); });
// play a card from the leaving stack's evolution cards (already in the trash) — pred over card id
const playFromLeftSources = (pred, prompt) => fnOp(async (ctx) => {
  const evt = evtOf(ctx); if (!evt) return;
  const pl = ctx.state.players[ctx.self];
  const cand = evt.sources.filter(id => pl.trash.includes(id) && pred(id));
  if (!cand.length) return;
  const id = cand[cand.length - 1];
  if (!(await confirm(ctx, ctx.self, prompt || `${C(id).nameKo}을(를) 코스트 없이 등장시킬까요?`))) return;
  const i = pl.trash.lastIndexOf(id);
  if (i >= 0) S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true });
});
// P-144 울퉁몬 X항체 (상대의 턴) [턴에 1회]: 어택의 대상이 변경되었을 때, 《블로커》를 가진 자신의 디지몬 1마리를 액티브로 할 수 있다
H('P-144', { tag: '상대의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: (st, hp, h, info) => info.owner !== hp } });
SCRIPTS['P-144::상대의 턴@어택의 대상이 변경되었을 때'] = [fnOp(async (ctx) => {
  const c = digimonOf(ctx.state, ctx.self).filter(s => s.suspended && S.hasKeyword(s, '블로커'));
  const t = await pickStackOf(ctx, ctx.self, c, '액티브로 할 《블로커》 디지몬 선택 (안 해도 됨)');
  if (t) S.unsuspendStack(ctx.state, ctx.self, t.uid);
})];
// BT17-050 패러사이몬 (진화원, 서로의 턴): 이 디지몬이 상대의 효과로 소멸할 때, 진화원의 「패러사이몬」 1장을 코스트 없이 등장
H('BT17-050', { tag: '서로의 턴', src: 'inheritedKo', has: '상대의 효과로 소멸할 때', onLeave: (st, hp, stack, cause) => cause === 'effect' && wasDeleted(st, stack) });
SCRIPTS['BT17-050::서로의 턴@소멸할 때'] = [playFromLeftSources((id) => isNamed(id, '패러사이몬'), '진화원의 「패러사이몬」을 코스트 없이 등장시킬까요?')];
// BT17-053 케라몬 (상대의 턴): 상대의 디지몬이 등장/진화했을 때, 그 디지몬이 Lv.5 이상이라면 이 디지몬을 패의 「인펠몬」으로 (진화 조건 무시, 코스트 없이) 진화
const oppLv5 = (st, hp, h, info) => info.owner !== hp && !!info.stack && isDigimonCard(info.stack.cardId) && lvOf(info.stack.cardId) >= 5 && C(h.cardId).category === 'digimon';
H('BT17-053', { tag: '상대의 턴', has: '등장/진화했을 때', events: { play: oppLv5, digivolve: oppLv5 } });
SCRIPTS['BT17-053::상대의 턴@등장/진화했을 때'] = [{ op: 's4_evolve', subject: { this: true }, zone: 'hand', pred: (id) => isNamed(id, '인펠몬'), ignoreCond: true, cost: { mode: 'free' }, optional: true }];
// BT17-081 신태일&매튜 (서로의 턴): 자신의 디지몬이 등장/진화했을 때, 이 테이머를 레스트시키는 것으로, 「그레이몬」 포함 디지몬이 있다면 메모리 +1, 「가루몬」 포함 디지몬이 있다면 메모리 +1
const ownDigiEvt = (st, hp, h, info) => info.owner === hp && !!info.stack && isDigimonCard(info.stack.cardId) && activeTamer(h);
H('BT17-081', { tag: '서로의 턴', has: '등장/진화했을 때', events: { play: ownDigiEvt, digivolve: ownDigiEvt } });
SCRIPTS['BT17-081::서로의 턴@등장/진화했을 때'] = [fnOp(async (ctx) => {
  const t = thisStack(ctx); if (!t || !activeTamer(t)) return;
  S.restStack(ctx.state, ctx.self, t.uid);
  if (!t.suspended) return;
  if (digimonOf(ctx.state, ctx.self).some(s => stackNameHas(ctx.state, s, '그레이몬'))) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
  if (digimonOf(ctx.state, ctx.self).some(s => stackNameHas(ctx.state, s, '가루몬'))) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
})];
// BT17-090 류센지 토모노리 (자신의 턴): 자신의 디지몬의 진화원에 테이머 카드가 효과로 놓였을 때, 이 테이머를 레스트시키는 것으로, 메모리 +1
H('BT17-090', { tag: '자신의 턴', has: '테이머 카드가 효과로 놓였을 때', events: { sourcesAdded: (st, hp, h, info) => info.owner === hp && info.cause === 'effect' && info.added.some(isTamerCard) && activeTamer(h) } });
SCRIPTS['BT17-090::자신의 턴@테이머 카드가 효과로 놓였을 때'] = [fnOp(async (ctx) => {
  const t = thisStack(ctx); if (!t || !activeTamer(t)) return;
  S.restStack(ctx.state, ctx.self, t.uid);
  if (t.suspended) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
})];
// BT17-056 로코몬 (서로의 턴) [턴에 1회]: 어택의 대상이 변경되었을 때, 덱 위 3장 오픈 → 「패러사이몬」 또는 블랙 Lv.5 이하 디지몬 카드 1장을 이 디지몬의 진화원 아래에, 나머지는 파기
H('BT17-056', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: () => true } });
SCRIPTS['BT17-056::서로의 턴@어택의 대상이 변경되었을 때'] = [fnOp(async (ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], h = thisStack(ctx);
  const revealed = pl.deck.splice(0, 3);
  if (!revealed.length) return;
  log(ctx, `${p} 덱 위 ${revealed.length}장 오픈: ${revealed.map(id => C(id).nameKo).join(', ')}`);
  const ok = (id) => isDigimonCard(id) && (isNamed(id, '패러사이몬') || (hasColor(id, ['black']) && lvOf(id) <= 5));
  const eligible = revealed.map((id, i) => ({ id, i })).filter(x => ok(x.id));
  let pick = null;
  if (h && eligible.length) { const r = await ctx.choose('pickFromRevealed', { player: p, revealed, eligible, min: 0, max: 1, prompt: '진화원 아래에 놓을 카드 선택' }); pick = (r && r.length) ? r[0] : null; }
  revealed.forEach((id, i) => { if (i === pick) h.sources.unshift(id); else pl.trash.push(id); });
  if (h) S.recomputeStackGrants(h);
})];
// EX7-014 볼케닉드라몬 / EX7-049 메탈릭드라몬 (서로의 턴) [턴에 1회]: 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 패(EX7-014)/트래시(EX7-049)에서 특징 카드 1장을 코스트 없이 등장
H('EX7-014', { tag: '서로의 턴', has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', limit: 1, onLeave: (st, hp, stack, cause) => cause !== 'ownEffect' });
SCRIPTS['EX7-014::서로의 턴@배틀 에어리어를 벗어날 때'] = [{ op: 's4_play', zone: 'hand', pred: (id) => isDigimonCard(id) && hasTraitAny(id, ['기룡형', '천룡형']) }];
H('EX7-049', { tag: '서로의 턴', has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', limit: 1, onLeave: (st, hp, stack, cause) => cause !== 'ownEffect' });
SCRIPTS['EX7-049::서로의 턴@배틀 에어리어를 벗어날 때'] = [{ op: 's4_play', zone: 'trash', pred: (id) => isDigimonCard(id) && hasTraitAny(id, ['암룡형', '지룡형']) }];
// BT18-022/048/063/076 (진화원, 서로의 턴): 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 진화원의 「진화원 효과를 가진 테이머 카드」 1장을 코스트 없이 등장
for (const id of ['BT18-022', 'BT18-048', 'BT18-063', 'BT18-076']) {
  H(id, { tag: '서로의 턴', src: 'inheritedKo', has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', onLeave: (st, hp, stack, cause) => cause !== 'ownEffect' });
  SCRIPTS[`${id}::서로의 턴@배틀 에어리어를 벗어날 때`] = [playFromLeftSources((cid) => isTamerCard(cid) && hasSourceEffect(cid), '진화원의 진화원 효과를 가진 테이머 카드를 코스트 없이 등장시킬까요?')];
}
// ST18-10 그랑게일몬 (진화원, 자신의 턴) [턴에 1회]: 이 디지몬이 상대의 디지몬에게 어택했을 때, 이 디지몬을 액티브로 할 수 있다
H('ST18-10', { tag: '자신의 턴', src: 'inheritedKo', has: '상대의 디지몬에게 어택했을 때', limit: 1, events: { attackOnDigimon: (st, hp, h, info) => info.owner === hp && info.stack === h } });
SCRIPTS['ST18-10::자신의 턴@상대의 디지몬에게 어택했을 때'] = [unsuspendThis];
// BT18-039 미스티몬 (진화원, 서로의 턴) [턴에 1회]: 자신의 시큐리티가 줄어들었을 때, 이 디지몬을 액티브로 할 수 있다
H('BT18-039', { tag: '서로의 턴', src: 'inheritedKo', has: '시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: (st, hp, h, info) => info.owner === hp } });
SCRIPTS['BT18-039::서로의 턴@시큐리티가 줄어들었을 때'] = [unsuspendThis];
// BT18-070 라이노캅테리몬 (서로의 턴) [턴에 1회]: 어택의 대상이 변경되었을 때, 이 디지몬을 액티브로 할 수 있다
H('BT18-070', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: () => true } });
SCRIPTS['BT18-070::서로의 턴@어택의 대상이 변경되었을 때'] = [unsuspendThis];
// LM-023 샤크라몬: 무녀 모드 (서로의 턴) [턴에 1회]: 옵션 카드를 사용했을 때 또는 시큐리티가 늘어났을 때, 턴 종료까지 상대의 디지몬 1마리를 DP -6000
H('LM-023', { tag: '서로의 턴', has: '옵션 카드를 사용했을 때 또는 시큐리티가 늘어났을 때', limit: 1, events: { optionUsed: (st, hp, h, info) => info.owner === hp, securityIncrease: (st, hp, h, info) => info.owner === hp } });
SCRIPTS['LM-023::서로의 턴@옵션 카드를 사용했을 때'] = [{ op: 's4_modifyDPOpp', amount: -6000 }];
// LM-026 메기드라몬 (서로의 턴): 이 디지몬이 배틀 에어리어를 벗어날 때, 진화원 또는 트래시의 「길몬」 1장을 코스트 없이 등장. 등장했다면 이 디지몬을 등장한 디지몬의 진화원 아래에 놓는다
H('LM-026', { tag: '서로의 턴', has: '「길몬」 1장을 코스트를 지불하지 않고 등장시킨다', onLeave: () => true });
SCRIPTS['LM-026::서로의 턴@「길몬」'] = [fnOp(async (ctx) => {
  const evt = evtOf(ctx); if (!evt) return;
  const st = ctx.state, p = ctx.self, pl = st.players[p];
  const i = pl.trash.map((id, k) => k).filter(k => isDigimonCard(pl.trash[k]) && isNamed(pl.trash[k], '길몬')).pop();
  if (i == null) return;
  const stack = S.playFreeFromZone(st, p, 'trash', i, {});
  if (!stack) return;
  const j = pl.trash.lastIndexOf(evt.cardId);
  if (j >= 0) { pl.trash.splice(j, 1); stack.sources.unshift(evt.cardId); S.recomputeStackGrants(stack); log(ctx, `${p} ${C(evt.cardId).nameKo}을(를) ${C(stack.cardId).nameKo}의 진화원 아래에 놓음`); }
})];

// BT18-100 【메인】 육성 에어리어의 자신의 디지몬을 트래시의 「루체몬」으로 코스트 없이 진화시킬 수 있다. 그 후, 이 카드를 배틀 에어리어에 놓는다.
// (the generic evolveEffect only looks at battle-area stacks, so the raising-area subject found nothing and the evolution never happened)
SCRIPTS['BT18-100::메인@육성 에어리어의 자신의 디지몬을'] = [
  fnOp(async (ctx) => {
    const st = ctx.state, p = ctx.self, pl = st.players[p], r = pl.raising;
    if (!r || C(r.cardId).category !== 'digimon' && C(r.cardId).category !== 'digitama') return;
    const idxs = pl.trash.map((id, i) => i).filter(i => isDigimonCard(pl.trash[i]) && isNamed(pl.trash[i], '루체몬') && canEvolveInto(st, p, r, pl.trash[i], false).ok);
    if (!idxs.length || !(await confirm(ctx, p, `육성 에어리어의 ${C(r.cardId).nameKo}을(를) 트래시의 「루체몬」으로 진화시킬까요?`))) return;
    const i = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: idxs, prompt: '트래시에서 진화할 「루체몬」 선택' });
    if (i == null) return;
    const [id] = pl.trash.splice(i, 1);
    doDigivolve(ctx, p, r, id, 0, 'trash');
  }),
  { op: 'placeThisInBattle' },
];

// BT19-024 (진화원) 【어택 종료 시】[턴에 1회] 이 디지몬의 진화원에서 특징으로 「수생」을 포함하는 Lv.4 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
// (the compiler only printed a "수동으로 처리하세요" note for play-from-evolution-cards effects)
SCRIPTS['BT19-024::어택 종료 시'] = [fnOp(async (ctx) => {
  const st = ctx.state, p = ctx.self, pl = st.players[p], h = thisStack(ctx);
  if (!h) return;
  const idxs = h.sources.map((id, i) => i).filter(i => isDigimonCard(h.sources[i]) && lvOf(h.sources[i]) <= 4 && hasTraitLike(h.sources[i], '수생'));
  if (!idxs.length) return;
  const i = idxs.length === 1 ? idxs[0] : idxs[(await ctx.choose('multipleChoice', { prompt: '등장시킬 「수생」 디지몬 카드 선택', options: idxs.map(k => C(h.sources[k]).nameKo) })) || 0];
  if (!(await confirm(ctx, p, `진화원의 ${C(h.sources[i]).nameKo}을(를) 코스트 없이 등장시킬까요?`))) return;
  const [id] = h.sources.splice(i, 1);
  S.recomputeStackGrants(h);
  pl.trash.push(id);
  S.playFreeFromZone(st, p, 'trash', pl.trash.length - 1, { fromSources: true });
})];

// BT17-100 종말의 시계 【메인】: 「디아블로몬」 토큰 1마리를 코스트 없이 등장시킨다. 그 후, 이 카드를 진화원에 「종말의 시계」가 없는 명칭에 「디아블로몬」을 포함하는 자신의 디지몬의 진화원 아래에 놓는다.
// (the generic compiler kept only the token and dropped the "place this card under" half, so the 4-clock win could never be assembled)
SCRIPTS['BT17-100::메인'] = [
  { op: 'spawnToken', who: 'self', def: { name: '디아블로몬', cost: 14, level: 6, dp: 3000, colors: ['white'], types: ['불명', '종족불명'], form: '궁극체', attribute: null, effectKo: '' }, n: 1, rested: false, optional: false },
  { op: 's4_placeThisUnder', pred: (s, ctx) => stackNameHas(ctx.state, s, '디아블로몬') && !s.sources.some(id => isNamed(id, '종말의 시계')), prompt: '「종말의 시계」를 진화원 아래에 놓을 「디아블로몬」 선택' },
];
