// Shard 5 — bespoke per-card scripts (BT19/BT20/BT21/EX8/EX9/P-/LM-/ST20-21).
// SCRIPTS  triggered/main effects (one generic op s5_fn runs a JS function per card)
// HOOKS    continuous / replacement / event-driven abilities consumed by state.js (see hooks section in state.js)
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const findStack = (state, p, uid) => stacksOf(state, p).find(s => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const hasType = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const typeIncl = (c, ...ts) => ts.some(t => (c.types || []).some(x => x.includes(t)));
const nameIncl = (c, ...ns) => ns.some(n => c.nameKo.includes(n));
const mention = (c, n) => c.nameKo.includes(n) || `${c.effectKo || ''}\n${c.inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`);
const mem = (state, p) => (p === 'p1' ? state.memory : -state.memory);
const colorsOf = (st) => S.stackColors(st);
const distinctColors = (stacks) => new Set(stacks.flatMap(colorsOf));
const tamerColors = (state, p) => distinctColors(tams(state, p)).size;
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);
const fn = (f) => ({ op: 's5_fn', fn: f });
OPS.s5_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };

async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt, optional = false) {
  if (!stacks.length) return null;
  if (stacks.length === 1 && !optional) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
// pick one card from an arbitrary id list (temp zone trick so the stock picker UI works)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s5tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's5tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s5tmp; }
}
async function pickZone(ctx, who, zone, pred, prompt) {
  const pl = ctx.state.players[who];
  const idxs = pl[zone].map((id, i) => i).filter(i => pred(C(pl[zone][i]), pl[zone][i]));
  if (!idxs.length) return null;
  return ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
}
function syncAsk(state, prompt) {
  if (state._s5auto !== undefined) return state._s5auto;
  return S.replAsk(prompt, true); // asked by the resumable replacement gate in state.deleteStack; outside it a plain confirm
}
function del(state, p, st, self) { return S.deleteStack(state, p, st.uid, 'trash', p === self ? 'ownEffect' : 'effect'); }

// sources: face-down block at the bottom
function putSourceBottom(state, st, id, faceDown) {
  if (faceDown) { st.sources.unshift(id); st.s5fd = S.fdCount(st) + 1; st.s5fdFlag = true; }
  else st.sources.splice(S.fdCount(st), 0, id);
  S.recomputeStackGrants(st);
}
function removeFrom(arr, id) { const i = arr.lastIndexOf(id); if (i >= 0) arr.splice(i, 1); return i >= 0; }

// move a whole stack under another stack's sources (bottom)
function putStackUnder(state, p, moving, target) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(moving);
  if (i >= 0) pl.battle.splice(i, 1);
  else if (pl.raising === moving) pl.raising = null;
  pl.trash.push(...(moving.linkCards || []).map(l => l.cardId));
  target.sources.splice(S.fdCount(target), 0, ...moving.sources, moving.cardId);
  S.recomputeStackGrants(target);
}
function stackToSecurity(state, p, st, position) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(st);
  if (i >= 0) pl.battle.splice(i, 1);
  pl.trash.push(...st.sources.filter(id => !C(id).isToken), ...(st.linkCards || []).map(l => l.cardId));
  if (!C(st.cardId).isToken) S.addToSecurity(state, p, st.cardId, position);
}

// tokens
function makeToken(def) {
  const id = `TOKEN-S5-${def.name}`;
  if (!S.CARDS[id]) Object.defineProperty(S.CARDS, id, { enumerable: false, configurable: true, writable: true, value: { id, cardId: id, nameKo: def.name, category: 'digimon', level: null, cost: 0, dp: def.dp, colors: def.colors, types: [], effectKo: '', inheritedKo: '', evoNormal: null, imgUrl: '', isToken: true } });
  return id;
}
function playToken(ctx, who, def) {
  const pl = ctx.state.players[who];
  const id = makeToken(def);
  pl.s5tokens = [id];
  let st;
  try { st = S.playFreeFromZone(ctx.state, who, 's5tokens', 0, {}); } finally { delete pl.s5tokens; }
  if (st) for (const [k, v] of Object.entries(def.keywords || {})) S.grantKeyword(ctx.state, who, st.uid, k, v, 'permanent');
  return st;
}

// evolution helper: evolve `stack` into a card taken from zones
function evoCands(ctx, o) {
  const { state, E } = ctx;
  const who = o.who || ctx.self, pl = state.players[who], st = o.stack;
  const restr = S.evolveTargetRestriction(state, who, st);
  if (restr && restr.cannotEvolve) return [];
  const raw = [];
  for (const z of o.zones) {
    if (z === 'hand' || z === 'trash') pl[z].forEach((id, i) => raw.push({ zone: z, idx: i, id }));
    else if (z === 'tamerUnder') for (const t of tams(state, who)) t.sources.forEach((id, i) => raw.push({ zone: z, idx: i, id, tamerUid: t.uid }));
    else if (z === 'securityUp') {
      const left = { ...(pl.secUp || {}) };
      pl.security.forEach((id, i) => { if (left[id] > 0) { left[id]--; raw.push({ zone: z, idx: i, id }); } });
    }
  }
  return raw.filter(c => C(c.id).category === 'digimon' && (!o.pred || o.pred(C(c.id), c.id))
    && (o.ignoreCond ? E.evoRestrictionCheck(c.id, restr).ok : E.canEvolveAny(st.cardId, c.id, S.evoExtraArg(state, null, st), restr).ok));
}
async function evolveInto(ctx, o) {
  const { state, E } = ctx;
  const who = o.who || ctx.self, pl = state.players[who], st = o.stack;
  if (!st) return null;
  const cands = evoCands(ctx, o);
  if (!cands.length) { S.log(state, `${who} 진화시킬 수 있는 카드가 없음`); return null; }
  const zones = [...new Set(cands.map(c => c.zone))];
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '진화할 카드의 위치 선택', options: zones.map(z => ({ hand: '패', trash: '트래시', tamerUnder: '테이머 아래', securityUp: '앞면 시큐리티' }[z])) }); if (k == null) return null; zone = zones[k]; }
  const zc = cands.filter(c => c.zone === zone);
  let pick;
  if (zone === 'hand' || zone === 'trash') {
    const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: zc.map(c => c.idx), prompt: o.prompt || '진화할 카드 선택' });
    if (idx == null) return null;
    pick = zc.find(c => c.idx === idx);
  } else {
    const src = zone === 'securityUp' ? pl.security : null;
    const ids = zone === 'securityUp' ? pl.security : zc.map(c => c.id);
    const idxs = zone === 'securityUp' ? zc.map(c => c.idx) : zc.map((c, i) => i);
    const k = await pickFromList(ctx, who, ids, idxs, o.prompt || '진화할 카드 선택');
    if (k == null) return null;
    pick = zone === 'securityUp' ? zc.find(c => c.idx === k) : zc[k];
    void src;
  }
  if (!pick) return null;
  const restr = S.evolveTargetRestriction(state, who, st);
  const chk = E.canEvolveAny(st.cardId, pick.id, S.evoExtraArg(state, null, st), restr);
  const printed = chk.ok ? chk.cost : (C(pick.id).evoNormal?.cost ?? 0);
  const m = o.cost || { mode: 'printed' };
  let cost = m.mode === 'free' ? 0 : m.mode === 'fixed' ? m.n : m.mode === 'discount' ? Math.max(0, printed - m.n) : printed;
  if (m.mode === 'printed' || m.mode === 'discount') cost = Math.max(0, cost + S.hookEvoCostDiscount(state, who, st, pick.id));
  let source = 'hand';
  if (pick.zone === 'trash') { pl.trash.splice(pick.idx, 1); source = 'trash'; }
  else if (pick.zone === 'tamerUnder') { const t = findStack(state, who, pick.tamerUid); const j = t.sources.lastIndexOf(pick.id); if (j >= 0) t.sources.splice(j, 1); source = 'tamer'; }
  else if (pick.zone === 'securityUp') { pl.security.splice(pick.idx, 1); S.secFaceUpTake(pl, pick.id); source = 'security'; }
  return S.digivolve(state, who, st.uid, pick.id, cost, source) || null;
}
// choose (among `stacks`) a stack that has candidates, then evolve it
async function evolveAny(ctx, o) {
  const withC = o.stacks.filter(s => evoCands(ctx, { ...o, stack: s }).length);
  if (!withC.length) { S.log(ctx.state, `${ctx.self} 진화시킬 수 있는 조합이 없음`); return null; }
  const st = await pickStack(ctx, o.who || ctx.self, withC, '진화시킬 디지몬 선택');
  if (!st) return null;
  return evolveInto(ctx, { ...o, stack: st });
}

async function playDiscounted(ctx, pred, discount, prompt) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category !== 'option' && pred(C(pl.hand[i]), pl.hand[i]));
  if (!idxs.length) return null;
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: idxs, prompt: prompt || '등장시킬 카드 선택' });
  if (idx == null) return null;
  const cost = Math.max(0, (C(pl.hand[idx]).cost || 0) - discount);
  if (cost > 0) S.spendMemory(state, cost);
  return S.playDigimonFresh(state, who, idx);
}

// a card can only be jogress-evolved into when it actually has a 〔조그레스〕 line (S.canJogress is permissive for cards without one)
const hasJogLine = (id) => /〔조그레스〕/.test(C(id).effectKo || '');
// jogress: A fixed (optional) + partner, with a hand card
async function jogress(ctx, o) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const okCards = (a, b) => pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && hasJogLine(pl.hand[i]) && o.cardPred(C(pl.hand[i])) && S.canJogress(a, b, pl.hand[i]).ok);
  const pool = digs(state, who);
  const pairs = [];
  for (const a of (o.a ? [o.a] : pool)) for (const b of pool) if (a !== b && (o.a || pool.indexOf(a) < pool.indexOf(b)) && okCards(a, b).length) pairs.push([a, b]);
  if (!pairs.length) { S.log(state, `${who} 조그레스 진화 가능한 조합이 없음`); return null; }
  let pair = pairs[0];
  if (pairs.length > 1) {
    const first = await pickStack(ctx, who, [...new Set(pairs.map(p => p[0]))], '조그레스 진화할 디지몬 선택');
    if (!first) return null;
    const seconds = pairs.filter(p => p[0] === first).map(p => p[1]);
    const second = await pickStack(ctx, who, seconds, '조그레스 진화할 상대 디지몬 선택');
    if (!second) return null;
    pair = [first, second];
  }
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: okCards(pair[0], pair[1]), prompt: '조그레스 진화할 패의 카드 선택' });
  if (idx == null) return null;
  const id = pl.hand[idx];
  const j = S.parseJogress(id);
  return S.fuseJogress(state, who, pair[0], pair[1], id);
}
// replacement-timing jogress (sync): `target` is about to leave and is used as one material
function interruptJogress(state, hp, target, cardPred, label) {
  const pl = state.players[hp];
  const cardIdx = (b) => pl.hand.findIndex(id => C(id).category === 'digimon' && hasJogLine(id) && cardPred(C(id)) && S.canJogress(target, b, id).ok);
  const partner = digs(state, hp).find(b => b !== target && cardIdx(b) >= 0);
  if (!partner) return false;
  if (!syncAsk(state, `${label}: ${C(target.cardId).nameKo}이(가) 벗어나려 합니다. 조그레스 진화할까요?`)) return false;
  const id = pl.hand[cardIdx(partner)];
  const j = S.parseJogress(id);
  return !!S.fuseJogress(state, hp, target, partner, id);
}
// delay option in the battle area: usable from the turn after it was placed
const delayReady = (state, holder) => holder && holder.placedTurn < state.turnNumber;
function discardOption(state, p, holder) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(holder);
  if (i < 0) return false;
  pl.battle.splice(i, 1);
  pl.trash.push(...holder.sources, holder.cardId);
  S.log(state, `${p} ${C(holder.cardId).nameKo} 딜레이 발동 (파기)`);
  return true;
}
// run one 【진화 시】 effect of a card as if it were the source's own
async function borrowEvoEffect(ctx, R, cardId) {
  const Fx = await import('../effects.js');
  const segs = S.parseEffectSegments(C(cardId).effectKo || '').segments.filter(sg => sg.tags.some(t => t.includes('진화 시')));
  if (!segs.length) return false;
  let seg = segs[0];
  if (segs.length > 1) {
    const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(sg => sg.body.replace(/\n/g, ' ').slice(0, 60)) });
    if (k == null) return false;
    seg = segs[k];
  }
  const script = Fx.lookupCardSpecific(cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
  if (!script || !script.length) { S.log(ctx.state, `${C(cardId).nameKo} 【진화 시】 효과를 자동 처리할 수 없음: ${seg.body}`); return false; }
  await R.runScript(script, { ...ctx, sourceCardId: cardId });
  return true;
}
function linkSlotFor(stack, cardId) {
  const slots = S.availableLinkSlots(stack);
  return slots.find(sl => { const pr = S.cardDescPredicate(sl.conditionText); return !pr || pr(C(cardId)); }) || null;
}
async function linkFree(ctx, o) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const stacks = o.stack ? [o.stack] : digs(state, who);
  const opts = [];
  for (const st of stacks) {
    const add = (zone, id, idx) => { if (C(id).category === 'digimon' && o.pred(C(id)) && S.linkCheck(state, who, st, id).ok) opts.push({ st, zone, id, idx }); };
    if (o.zones.includes('hand')) pl.hand.forEach((id, i) => add('hand', id, i));
    if (o.zones.includes('trash')) pl.trash.forEach((id, i) => add('trash', id, i));
    if (o.zones.includes('sources')) { const so = o.ownSourcesOf || st; so.sources.slice(S.fdCount(so)).forEach((id, i) => add('sources', id, i + S.fdCount(so))); }
  }
  if (!opts.length) return false;
  const st = await pickStack(ctx, who, [...new Set(opts.map(x => x.st))], '링크할 디지몬 선택');
  if (!st) return false;
  const mine = opts.filter(x => x.st === st);
  const ids = mine.map(x => x.id);
  const k = await pickFromList(ctx, who, ids, ids.map((_, i) => i), '링크할 카드 선택');
  if (k == null) return false;
  const pick = mine[k];
  const slot = { grantedBy: pick.id };
  if (pick.zone === 'hand') pl.hand.splice(pl.hand.indexOf(pick.id), 1);
  else if (pick.zone === 'trash') removeFrom(pl.trash, pick.id);
  else { const so = o.ownSourcesOf || st; const j = so.sources.lastIndexOf(pick.id); if (j >= 0) so.sources.splice(j, 1); S.recomputeStackGrants(so); }
  S.linkCardTo(state, who, st.uid, pick.id, slot.grantedBy, 0, 'free', await S.linkDiscardIdx(state, who, st.uid, ctx.choose));
  return true;
}

// ================================================================== BT19
sc('BT19-057::어택 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await evolveInto(ctx, { stack: st, zones: ['tamerUnder'], pred: c => c.nameKo === '랩터스패로우몬', cost: { mode: 'free' }, prompt: '테이머 아래의 「랩터스패로우몬」으로 진화' });
});
sc('BT19-062::어택 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const opts = pl.battle.filter(s => C(s.cardId).category === 'option');
  const st = await pickStack(ctx, ctx.self, opts, '파기할 옵션 카드 선택');
  if (!st) return;
  pl.battle.splice(pl.battle.indexOf(st), 1);
  pl.trash.push(...st.sources, st.cardId);
  S.log(state, `${ctx.self} 배틀 에어리어의 ${C(st.cardId).nameKo} 파기`);
});
sc('BT19-062::자신의 턴 종료 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!digs(ctx.state, opp(ctx.self)).some(s => !s.suspended)) return;
  ctx.startAttack(ctx.self, st.uid, 'PLAYER');
});
sc('BT19-065::등장 시', async (ctx) => {
  const { state } = ctx;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of digs(state, p)) if ((C(s.cardId).level || 0) <= 5) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: 'Lv.5 이하의 디지몬 1마리 소멸' });
  if (!pick) return;
  const st = findStack(state, pick.player, pick.uid);
  if (st) del(state, pick.player, st, ctx.self);
});
SCRIPTS['BT19-065::진화 시'] = SCRIPTS['BT19-065::등장 시'];
sc('BT19-073::진화 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const target = await pickStack(ctx, o, digs(state, o), '퇴화시킬 상대 디지몬 선택');
  if (target) S.retreat(state, o, target.uid, digs(state, ctx.self).length);
  const t2 = await pickStack(ctx, o, digs(state, o), '진화할 수 없게 할 상대 디지몬 선택');
  if (t2) { t2.cannotEvolveUntil = oppTurnEnd(state, ctx.self); S.log(state, `${o} ${C(t2.cardId).nameKo} 상대의 턴 종료까지 진화 불가`); }
});
sc('BT19-075::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), pl = state.players[o];
  const excess = pl.hand.length - 5;
  if (excess <= 0) return;
  const chosen = await ctx.choose('pickFromHandIndexes', { player: o, eligibleIdxs: pl.hand.map((_, i) => i), n: excess, prompt: `패가 5장이 되도록 ${excess}장 파기` });
  (chosen || []).slice().sort((a, b) => b - a).forEach(i => S.trashFromHand(state, o, i));
  const n = Math.floor((chosen || []).length / 2);
  for (let i = 0; i < n; i++) {
    const t = await pickStack(ctx, o, tams(state, o), '소멸시킬 상대 테이머 선택');
    if (!t) break;
    del(state, o, t, ctx.self);
  }
});
SCRIPTS['BT19-075::진화 시'] = SCRIPTS['BT19-075::등장 시'];
hk('BT19-077', { tag: '서로의 턴', has: '어택과 블록', noAttack: () => true, noBlock: (state, hp, h, target) => target === h });
sc('BT19-077::소멸 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!removeFrom(pl.trash, ctx.sourceCardId)) return;
  S.addToSecurity(state, ctx.self, ctx.sourceCardId, 'top');
});
sc('BT19-078::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const mothers = state.players[ctx.self].battle.filter(s => C(s.cardId).nameKo === '마더 디·리퍼');
  const m = await pickStack(ctx, ctx.self, mothers, '「마더 디·리퍼」 선택');
  if (!m || !m.sources.length) return;
  const t = await pickStack(ctx, o, digs(state, o), `DP -${m.sources.length * 1000} 받을 상대 디지몬 선택`);
  if (t) S.modifyDP(state, o, t.uid, -1000 * m.sources.length, 'turn');
});
sc('BT19-078::메인', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  const targets = state.players[ctx.self].battle.filter(s => s !== st && C(s.cardId).nameKo === '마더 디·리퍼' && !s.sources.some(id => C(id).nameKo === 'ADR-01=쥬리'));
  const t = await pickStack(ctx, ctx.self, targets, '진화원 아래에 놓을 「마더 디·리퍼」 선택');
  if (!t) return;
  putStackUnder(state, ctx.self, st, t);
  S.log(state, `${ctx.self} ${C(st.cardId).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
});
sc('BT19-084::자신의 메인 페이즈 개시 시', async (ctx) => {
  if (S.secFaceUpCount(ctx.state.players[ctx.self]) > 0) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
});
sc('BT19-084::메인', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self];
  if (!st || st.suspended) return;
  const stacks = digs(state, ctx.self).filter(s => evoCands(ctx, { stack: s, zones: ['securityUp'] }).length);
  if (!stacks.length) { S.log(state, '앞면의 시큐리티로 진화할 수 있는 디지몬이 없음'); return; }
  S.restStack(state, ctx.self, st.uid);
  if (!st.suspended) return;
  const evolved = await evolveAny(ctx, { stacks, zones: ['securityUp'] });
  if (!evolved) return;
  const idx = await pickZone(ctx, ctx.self, 'hand', c => c.category === 'digimon' && hasType(c, '로얄 베이스'), '시큐리티 아래에 앞면으로 놓을 「로얄 베이스」 디지몬 선택');
  if (idx == null) return;
  const [id] = pl.hand.splice(idx, 1);
  S.secAddFaceUp(state, ctx.self, id, 'bottom');
});
sc('BT19-088::메인', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (!st || st.suspended || state.players[ctx.self].trash.length < 20) return;
  const imps = digs(state, ctx.self).filter(s => C(s.cardId).nameKo === '임프몬');
  const o = { zones: ['hand', 'trash'], pred: c => c.nameKo === '베르제브몬', ignoreCond: true, cost: { mode: 'fixed', n: 4 } };
  const ok = imps.filter(s => evoCands(ctx, { ...o, stack: s }).length);
  if (!ok.length) return;
  if (!(await ask(ctx, '이 테이머를 레스트시켜 「임프몬」을 「베르제브몬」으로 진화시킬까요?'))) return;
  S.restStack(state, ctx.self, st.uid);
  if (!st.suspended) return;
  await evolveAny(ctx, { ...o, stacks: ok });
});
sc('BT19-089::메인', async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), '보호할 디지몬 선택');
  if (!t) return;
  S.grantShield(state, ctx.self, t.uid, { until: oppTurnEnd(state, ctx.self), kinds: ['all'], fromCategory: 'option' });
  S.grantKeyword(state, ctx.self, t.uid, 'DP감소무효', true, 'opponentTurn');
});
sc('BT19-091::메인', async (ctx) => {
  const { state } = ctx, who = ctx.self;
  const defs = [{ name: '메가로그라우몬', colors: ['red'], dp: 6000 }, { name: '도사몬', colors: ['yellow'], dp: 6000 }, { name: '래피드몬', colors: ['green'], dp: 6000 }];
  for (const d of defs) {
    if (digs(state, who).some(s => C(s.cardId).nameKo === d.name)) { S.log(state, `${who} 같은 명칭의 디지몬이 있어 ${d.name} 토큰은 등장시킬 수 없음`); continue; }
    playToken(ctx, who, d);
  }
  const lv5 = digs(state, who).filter(s => C(s.cardId).level === 5);
  const t = await pickStack(ctx, who, lv5, '《연계》를 얻고 어택할 Lv.5 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, who, t.uid, '연계', 2, 'turn');
  ctx.startAttack(who, t.uid);
});
sc('BT19-094::메인', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const n = digs(state, o).length - state.players[ctx.self].security.length;
  let killed = 0;
  for (let i = 0; i < n; i++) {
    const t = await pickStack(ctx, o, digs(state, o), '소멸시킬 상대 디지몬 선택');
    if (!t) break;
    del(state, o, t, ctx.self);
    if (!findStack(state, o, t.uid)) killed++;
  }
  if (killed) S.recoverTopOfDeckToSecurity(state, ctx.self);
});
sc('BT19-100::메인', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (S.secFaceUpCount(pl) > 0 || !pl.security.length) return;
  S.trashTopSecurityByEffect(state, ctx.self);
  if (!removeFrom(pl.trash, ctx.sourceCardId)) return;
  S.secAddFaceUp(state, ctx.self, ctx.sourceCardId, 'top');
});
hk('BT19-101', { tag: '서로의 턴', has: '레스트할 수 없고',
  effectImmune: (state, hp, h, target) => target === h && h.sources.length === 0,
  noRest: (state, hp, h, target) => target === h && h.sources.length === 0 });

// ================================================================== EX8
sc('EX8-002::어택 시', async (ctx) => { if (mem(ctx.state, ctx.self) === 0) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId); });
hk('EX8-016', { tag: '상대의 턴', atkTargetBlocked: (state, hp, h, ap, atk, target) => h.suspended && !target.suspended });
async function trashToSources(ctx, st, pred, max, faceDown, prompt) {
  const pl = ctx.state.players[ctx.self];
  let n = 0;
  while (n < max) {
    const idx = await pickZone(ctx, ctx.self, 'trash', pred, prompt);
    if (idx == null) break;
    const [id] = pl.trash.splice(idx, 1);
    putSourceBottom(ctx.state, st, id, faceDown);
    n++;
  }
  return n;
}
sc('EX8-025::등장 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await trashToSources(ctx, st, c => c.category === 'digimon' && hasType(c, 'DS'), 1, false, '진화원 아래에 놓을 「DS」 디지몬 선택 (취소=놓지 않음)');
});
SCRIPTS['EX8-025::진화 시'] = SCRIPTS['EX8-025::등장 시'];
function jogressWatcher(id, trait, withAttack) {
  const ev = (state, hp, h, info) => info.owner === hp && isDig(info.stack) && hasType(C(info.stack.cardId), trait);
  hk(id, { tag: '자신의 턴', limit: 1, events: { play: ev, digivolve: ev } });
  sc(`${id}::자신의 턴`, async (ctx) => {
    const fused = await jogress(ctx, { cardPred: c => hasType(c, trait) });
    if (fused && withAttack && await ask(ctx, `${C(fused.cardId).nameKo}(으)로 어택할까요?`)) ctx.startAttack(ctx.self, fused.uid);
  });
}
jogressWatcher('EX8-027', 'DS', true);
jogressWatcher('EX8-060', 'NSo', true);
jogressWatcher('EX9-044', 'WG', false);
hk('EX8-029', { tag: '서로의 턴',
  effectImmune: (state, hp, h, target, tp, x) => mem(state, hp) >= 1 && isDig(target) && hasType(C(target.cardId), 'DS') && x.src.category === 'digimon',
  suppressTrigger: (state, hp, h, tp, target, tag) => tp !== hp && tag === '등장 시' && mem(state, hp) <= 1 });
hk('EX8-035', { tag: '서로의 턴', suppressTrigger: (state, hp, h, tp, target, tag) => tp !== hp && tag === '진화 시' && mem(state, hp) >= 1 });
sc('EX8-037::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!st.sources.some(id => nameIncl(C(id), '샤크라몬', 'X항체') || typeIncl(C(id), 'X항체'))) return;
  playToken(ctx, ctx.self, { name: '우카노미타마', colors: ['yellow'], dp: 9000, keywords: { 속공: true } });
});
sc('EX8-041::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, tams(state, o), '레스트시킬 상대 테이머 선택');
  if (t) S.restStack(state, o, t.uid);
  const t2 = await pickStack(ctx, o, tams(state, o), '액티브가 되지 않을 상대 테이머 선택');
  if (t2) S.setSkipNextUnsuspend(state, o, t2.uid);
});
SCRIPTS['EX8-041::진화 시'] = SCRIPTS['EX8-041::등장 시'];
sc('EX8-052::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self];
  if (!st || !st.sources.some(id => nameIncl(C(id), '사이버드라몬', 'X항체') || typeIncl(C(id), 'X항체'))) return;
  const zones = ['hand', 'trash'].filter(z => pl[z].some(id => C(id).category === 'option' && hasType(C(id), '디바이스')));
  if (!zones.length) return;
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '위치 선택', options: zones.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zones[k]; }
  const idx = await pickZone(ctx, ctx.self, zone, c => c.category === 'option' && hasType(c, '디바이스'), '배틀 에어리어에 놓을 「디바이스」 옵션 선택');
  if (idx == null) return;
  const [id] = pl[zone].splice(idx, 1);
  pl.trash.push(id);
  S.placeThisInBattle(state, ctx.self, id);
});
sc('EX8-054::어택 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  const ids = st.sources.slice(S.fdCount(st)).filter(id => C(id).category === 'digimon' && C(id).nameKo.includes('저스티몬'));
  if (!ids.length) return;
  const k = await pickFromList(ctx, ctx.self, ids, ids.map((_, i) => i), '【진화 시】 효과를 발휘할 진화원 카드 선택');
  if (k == null) return;
  await borrowEvoEffect(ctx, R, ids[k]);
});
sc('EX8-054::자신의 턴 종료 시', async (ctx) => {
  const st = me(ctx); if (!st || !digs(ctx.state, opp(ctx.self)).some(s => !s.suspended)) return;
  if (await ask(ctx, '이 디지몬으로 플레이어에게 어택할까요?')) ctx.startAttack(ctx.self, st.uid, 'PLAYER');
});
sc('EX8-055::자신의 턴 종료 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await trashToSources(ctx, st, c => hasType(c, '광물형', '광석형'), 3, false, '진화원 아래에 놓을 카드 선택 (최대 3장, 취소=종료)');
});
sc('EX8-063::진화 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), opl = state.players[o];
  let discarded = false;
  if (opl.hand.length && await ask(ctx, '패 1장을 파기할까요? (파기하지 않으면 상대가 트래시에서 등장시킴)', o)) {
    const ch = await ctx.choose('pickFromHandIndexes', { player: o, eligibleIdxs: opl.hand.map((_, i) => i), n: 1, prompt: '파기할 패 1장 선택' });
    if (ch && ch.length) { S.trashFromHand(state, o, ch[0]); discarded = true; }
  }
  if (discarded) return;
  const idx = await pickZone(ctx, ctx.self, 'trash', c => c.category === 'digimon' && hasType(c, '타천사형') && (c.cost || 0) <= 7, '등장시킬 「타천사형」 디지몬 선택');
  if (idx != null) S.playFreeFromZone(state, ctx.self, 'trash', idx, {});
});
SCRIPTS['EX8-063::어택 시'] = SCRIPTS['EX8-063::진화 시'];
hk('EX8-068', { tag: '서로의 턴', battleImmune: (state, hp, h, target) => mem(state, hp) >= 1 && isDig(target) && hasType(C(target.cardId), 'DS') });
hk('EX8-073', { tag: '서로의 턴', effectImmune: (state, hp, h, target, tp, x) => target === h && mem(state, hp) <= 0 && x.src.category === 'digimon' });

// force "【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다." (shares shard3's s3.forceAtkMain via state.queueForcedAttacks)
function giveForcedAttack(state, st, srcCardId, until) { (st.s3 ||= {}).forceAtkMain = { until, src: srcCardId }; S.log(state, `${C(st.cardId).nameKo}: 상대의 턴 종료까지 메인 페이즈 개시 시 어택해야 함`); }
// the '*::__볼텍스' pending (queueTurnEndKeywords): may attack an opposing digimon at end of turn
sc('*::__볼텍스', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  const targets = S.legalDigimonTargets(state, ctx.self, st.uid);
  // s7 (EX11-062): 액티브 상태의 상대 디지몬이 없는 동안 《볼텍스》로 플레이어에게도 어택할 수 있다.
  if (!st.suspended && S.hookVortexPlayer && S.hookVortexPlayer(state, ctx.self) && S.canAttackPlayer(state, ctx.self, st.uid) && (await ask(ctx, '《볼텍스》 — 플레이어에게 어택할까요?'))) { ctx.startAttack(ctx.self, st.uid, 'PLAYER', { ignoreEntry: true }); return; }
  if (!targets.length || st.suspended) return;
  if (!(await ask(ctx, '《볼텍스》 — 상대의 디지몬에게 어택할까요?'))) return;
  const t = await pickStack(ctx, opp(ctx.self), state.players[opp(ctx.self)].battle.filter(s => targets.includes(s.uid)), '어택할 상대 디지몬 선택');
  if (t) ctx.startAttack(ctx.self, st.uid, t.uid, { ignoreEntry: true });
});
const scTrait = (c, ...t) => hasType(c, ...t);

// ================================================================== BT20
sc('BT20-003::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  if (st.sources.some(id => C(id).category === 'tamer')) return;
  const ts = tams(state, ctx.self).filter(t => mention(C(t.cardId), '펄스몬') || hasType(C(t.cardId), 'SoC', '시커즈'));
  const t = await pickStack(ctx, ctx.self, ts, '진화원 아래에 놓을 테이머 선택 (취소=놓지 않음)', true);
  if (t) putStackUnder(state, ctx.self, t, st);
});
sc('BT20-012::어택 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await evolveInto(ctx, { stack: st, zones: ['hand'], pred: c => c.nameKo === '히샤류우몬' || hasType(c, '크로니클'), cost: { mode: 'printed' } });
});
sc('BT20-013::메인', async (ctx) => {
  await playDiscounted(ctx, c => nameIncl(c, '시스터몬', '간쿠몬'), 2, '등장시킬 「시스터몬」/「간쿠몬」 선택');
});
sc('BT20-014::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  const o = { stack: st, zones: ['hand'], pred: c => c.nameKo.includes('제스몬'), cost: { mode: 'free' } };
  const others = digs(state, ctx.self).filter(s => s !== st && !s.suspended);
  if (!others.length || !evoCands(ctx, o).length) return;
  if (!(await ask(ctx, '다른 디지몬 1마리를 레스트시켜 이 디지몬을 「제스몬」으로 진화시킬까요?'))) return;
  const r = await pickStack(ctx, ctx.self, others, '레스트시킬 디지몬 선택');
  if (!r) return;
  S.restStack(state, ctx.self, r.uid);
  if (!r.suspended) return;
  await evolveInto(ctx, o);
});
const dragonPred = (c) => c.nameKo === '파일드라몬' || c.nameKo === '다이노몬';
hk('BT20-016', { tag: '서로의 턴', preventLeave: (state, hp, h, target, tp, cause, mode) => mode === 'delete' && dragonPred(C(target.cardId)) && interruptJogress(state, hp, target, c => c.nameKo === '황제드라몬: 드래곤 모드', '황제드라몬 조그레스') });
sc('BT20-017::등장 시', async (ctx) => {
  if (!(await ask(ctx, '「아트&르네&포르」 토큰을 등장시킬까요?'))) return;
  playToken(ctx, ctx.self, { name: '아트&르네&포르', colors: ['white'], dp: 6000, keywords: { 재기동: true, 블로커: true, 디코이: ['red', 'black'] } });
});
SCRIPTS['BT20-017::진화 시'] = SCRIPTS['BT20-017::등장 시'];
const alias = (name, lv) => ({ tag: '서로의 턴', jogressAlias: (target) => (C(target).nameKo === '엑자몬' ? [{ nameKo: name, level: lv }] : []) });
hk('BT20-025', alias('슬레이어드라몬', 6));
hk('BT20-042', alias('브레이크드라몬', 6));
sc('BT20-032::등장 시', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (pl.security.length >= 3 && await ask(ctx, '시큐리티를 위에서부터 1장 패에 추가할까요?')) await R.runOne({ op: 'securityTopToHand', who: 'self', n: 1 }, ctx);
  if (pl.security.length <= 2) S.recoverTopOfDeckToSecurity(state, ctx.self);
});
SCRIPTS['BT20-032::진화 시'] = SCRIPTS['BT20-032::등장 시'];
sc('BT20-033::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '【진화 시】 효과를 봉인하고 DP -3000할 상대 디지몬 선택');
  if (!t) return;
  t.noEvoTrigUntil = oppTurnEnd(state, ctx.self);
  S.modifyDP(state, o, t.uid, -3000, 'turn');
});
SCRIPTS['BT20-033::진화 시'] = SCRIPTS['BT20-033::등장 시'];
const tamerAdded = (info) => (info.added || []).some(id => C(id).category === 'tamer');
hk('BT20-034', { tag: '서로의 턴', events: { sourcesAdded: (state, hp, h, info) => info.stack === h && tamerAdded(info) } });
sc('BT20-034::서로의 턴@발휘하지 않는다', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '【진화 시】 효과를 봉인할 상대 디지몬 선택');
  if (t) t.noEvoTrigUntil = oppTurnEnd(state, ctx.self);
});
function chaosJogress(id) {
  sc(`${id}::자신의 턴 종료 시`, async (ctx) => {
    const st = me(ctx); if (!st) return;
    const fused = await jogress(ctx, { a: st, cardPred: c => c.nameKo.includes('카오스몬') });
    if (fused && await ask(ctx, '조그레스 진화한 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, fused.uid);
  });
}
chaosJogress('BT20-036'); chaosJogress('BT20-043');
function battleWinKill(id, src) {
  const ev = (state, hp, h, info) => info.owner === hp && isDig(info.stack) && (mention(C(info.stack.cardId), '드라코몬') || mention(C(info.stack.cardId), '엑자몬'));
  hk(id, { tag: '서로의 턴', src, limit: 1, events: { battleWin: ev } });
}
battleWinKill('BT20-044', 'effectKo'); battleWinKill('BT20-044', 'inheritedKo');
sc('BT20-044::서로의 턴', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const ts = [...digs(state, o), ...tams(state, o)].filter(s => s.suspended);
  const t = await pickStack(ctx, o, ts, '소멸시킬 레스트 상태의 상대 디지몬/테이머 선택');
  if (t) del(state, o, t, ctx.self);
});
// 《블래스트 조그레스》 (counter): 1 own digimon + 1 hand card -> this card
async function blastJogress(ctx, a, b) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const names = (st) => [C(st.cardId).nameKo, ...S.hookJogressAliases(st.cardId, ctx.sourceCardId).map(x => x.nameKo)];
  const srcIdx = pl.hand.indexOf(ctx.sourceCardId);
  const handIdx = (nm) => pl.hand.map((id, i) => i).filter(i => i !== srcIdx && C(pl.hand[i]).category === 'digimon' && C(pl.hand[i]).nameKo === nm);
  const opts = [];
  for (const st of digs(state, who)) for (const [x, y] of [[a, b], [b, a]]) if (names(st).includes(x) && handIdx(y).length) opts.push({ st, y });
  if (!opts.length || !pl.hand.includes(ctx.sourceCardId)) { S.log(state, '블래스트 조그레스 조건 불충족'); return; }
  const st = await pickStack(ctx, who, [...new Set(opts.map(o => o.st))], '블래스트 조그레스할 디지몬 선택');
  if (!st) return;
  const y = opts.find(o => o.st === st).y;
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: handIdx(y), prompt: `패의 「${y}」 선택` });
  if (idx == null) return;
  const [hid] = pl.hand.splice(idx, 1);
  const tmp = S._s4.makeStack(hid, state.turnNumber);
  pl.battle.push(tmp);
  const fused = S.fuseStacks(state, who, st.uid, tmp.uid, ctx.sourceCardId, 0, 'hand');
  if (!fused) { pl.battle.splice(pl.battle.indexOf(tmp), 1); pl.hand.push(hid); }
}
sc('BT20-045::카운터', (ctx) => blastJogress(ctx, '브레이크드라몬', '슬레이어드라몬'));
sc('BT20-060::카운터', (ctx) => blastJogress(ctx, '알파몬', '오류우몬'));
sc('BT20-076::카운터', (ctx) => blastJogress(ctx, '다이노몬', '파일드라몬'));
sc('BT20-081::카운터', (ctx) => blastJogress(ctx, '펜리루가몬', '카즈치몬'));
sc('BT20-050::진화 시', async (ctx) => { S.secFlipTopFaceUp(ctx.state, opp(ctx.self)); });
SCRIPTS['BT20-052::진화 시'] = SCRIPTS['BT20-050::진화 시'];
for (const id of ['BT20-052', 'BT20-055']) {
  hk(id, { tag: '자신의 턴', events: { faceUpChecked: (state, hp, h, info) => info.owner === hp } });
  sc(`${id}::자신의 턴`, async (ctx) => {
    const { state } = ctx, st = me(ctx); if (!st) return;
    if (st.sources.length <= S.fdCount(st)) return;
    if (!(await ask(ctx, '이 디지몬의 진화원 맨 위 1장을 시큐리티 아래에 앞면으로 놓을까요?'))) return;
    const id2 = st.sources.pop();
    S.recomputeStackGrants(st);
    S.secAddFaceUp(state, ctx.self, id2, 'bottom');
  });
}
sc('BT20-057::등장 시', async (ctx) => {
  await evolveAny(ctx, { stacks: digs(ctx.state, ctx.self), zones: ['hand', 'trash'], pred: c => (c.nameKo.includes('헉몬') || hasType(c, '로얄 나이츠')) && (c.level || 0) <= 6, cost: { mode: 'free' } });
});
SCRIPTS['BT20-057::진화 시'] = SCRIPTS['BT20-057::등장 시'];
sc('BT20-074::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const idx = await pickZone(ctx, ctx.self, 'trash', c => c.category === 'digimon' && (c.nameKo.includes('황제드라몬') || hasType(c, '프리')), '패로 되돌릴 카드 선택 (취소=안 함)');
  if (idx == null) return;
  const [id] = pl.trash.splice(idx, 1); pl.hand.push(id);
  S.log(state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`);
});
SCRIPTS['BT20-074::진화 시'] = SCRIPTS['BT20-074::등장 시'];
hk('BT20-074', { tag: '서로의 턴', preventLeave: (state, hp, h, target, tp, cause, mode) => mode === 'bounce' && dragonPred(C(target.cardId)) && interruptJogress(state, hp, target, c => c.nameKo === '황제드라몬: 드래곤 모드', '황제드라몬 조그레스') });
sc('BT20-078::소멸 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const ts = [...digs(state, o), ...tams(state, o)].filter(s => (C(s.cardId).cost || 0) <= 4);
  const t = await pickStack(ctx, o, ts, '소멸시킬 등장 코스트 4 이하의 상대 디지몬/테이머 선택');
  if (t) del(state, o, t, ctx.self);
});
hk('BT20-080', { tag: '서로의 턴', events: { sourcesAdded: (state, hp, h, info) => info.stack === h && tamerAdded(info) } });
sc('BT20-080::서로의 턴@효과 1개를 발휘', async (ctx, R) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  await borrowEvoEffect(ctx, R, st.cardId);
  const ready = digs(state, ctx.self).filter(s => !s.suspended);
  const t = await pickStack(ctx, ctx.self, ready, '플레이어에게 어택할 디지몬 선택 (취소=안 함)', true);
  if (t) ctx.startAttack(ctx.self, t.uid, 'PLAYER');
});
sc('BT20-081::어택 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx); if (!st || !state.players[ctx.self].security.length) return;
  if (!(await ask(ctx, '시큐리티를 위에서부터 1장 파기하고 【진화 시】 효과를 발휘할까요?'))) return;
  S.trashTopSecurityByEffect(state, ctx.self);
  await borrowEvoEffect(ctx, R, st.cardId);
});
sc('BT20-082::서로의 턴 종료 시', async (ctx) => {
  const { state } = ctx;
  const all = ['p1', 'p2'].flatMap(p => digs(state, p).map(s => ({ p, s })));
  if (!all.length) return;
  const min = Math.min(...all.map(x => C(x.s.cardId).level || 0));
  for (const { p, s } of all) if ((C(s.cardId).level || 0) === min) del(state, p, s, ctx.self);
});
sc('BT20-083::소멸 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const r = pl.raising;
  if (!r || r.cardId === undefined || C(r.cardId).nameKo !== '위그드라실_7D6' || !pl.trash.includes(ctx.sourceCardId)) return;
  if (!(await ask(ctx, '이 카드를 육성 에어리어의 「위그드라실_7D6」 진화원 아래에 놓을까요?'))) return;
  removeFrom(pl.trash, ctx.sourceCardId);
  putSourceBottom(state, r, ctx.sourceCardId, false);
});
sc('BT20-084::서로의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st || st.sources.length <= S.fdCount(st)) return;
  const id = st.sources.pop();
  S.recomputeStackGrants(st);
  S.addToSecurity(state, ctx.self, id, 'top');
});
sc('BT20-086::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const cp = (c) => c.category === 'digimon' && hasType(c, '사이보그형', '머신형') && (c.colors || []).includes('black') && (c.cost || 0) <= 4;
  const targets = digs(state, ctx.self).filter(s => hasType(C(s.cardId), '사이보그형', '머신형'));
  const zones = ['hand', 'trash'].filter(z => pl[z].some(id => cp(C(id))));
  if (!targets.length || !zones.length) return;
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '위치 선택', options: zones.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zones[k]; }
  const idx = await pickZone(ctx, ctx.self, zone, cp, '진화원 아래에 놓을 카드 선택');
  if (idx == null) return;
  const t = await pickStack(ctx, ctx.self, targets, '카드를 놓을 디지몬 선택');
  if (!t) return;
  const [id] = pl[zone].splice(idx, 1);
  putSourceBottom(state, t, id, false);
  S.secFlipTopFaceUp(state, opp(ctx.self));
});
{
  const ev = (state, hp, h, info) => info.owner === hp && isDig(info.stack);
  hk('BT20-089', { tag: '서로의 턴', events: { play: ev, digivolve: ev } });
  sc('BT20-089::서로의 턴', async (ctx) => {
    const { state } = ctx, st = me(ctx); if (!st) return;
    const ts = digs(state, ctx.self).filter(s => (mention(C(s.cardId), '펄스몬') || hasType(C(s.cardId), 'SoC', '시커즈')) && !s.sources.some(id => C(id).category === 'tamer'));
    if (!ts.length || !(await ask(ctx, '《마인드 링크》 — 이 테이머를 디지몬의 진화원 아래에 놓을까요?'))) return;
    const t = await pickStack(ctx, ctx.self, ts, '마인드 링크할 디지몬 선택');
    if (t) putStackUnder(state, ctx.self, st, t);
  });
}
sc('BT20-090::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (!st || st.suspended || state.players[ctx.self].hand.length > 4) return;
  const ts = digs(state, ctx.self).filter(s => !s.suspended && hasType(C(s.cardId), '마룡형', '사룡형'));
  if (!ts.length || !(await ask(ctx, '이 테이머를 레스트시켜 플레이어에게 어택할까요?'))) return;
  S.restStack(state, ctx.self, st.uid);
  if (!st.suspended) return;
  const t = await pickStack(ctx, ctx.self, ts, '어택할 디지몬 선택');
  if (t) ctx.startAttack(ctx.self, t.uid, 'PLAYER');
});
hk('BT20-093', { tag: '서로의 턴', preventLeave: (state, hp, h, target, tp, cause) => {
  if (cause === 'battle' || !delayReady(state, h) || !(mention(C(target.cardId), '드라코몬') || mention(C(target.cardId), '엑자몬'))) return false;
  const pl = state.players[hp];
  const has = digs(state, hp).some(b => b !== target && pl.hand.some(id => C(id).nameKo === '엑자몬' && hasJogLine(id) && S.canJogress(target, b, id).ok));
  if (!has) return false;
  const hid = h.uid;
  if (!syncAsk(state, '딜레이: 이 카드를 파기하고 「엑자몬」으로 조그레스 진화할까요?')) return false;
  const saved = state._s5auto; state._s5auto = true;
  try { const ok = interruptJogress(state, hp, target, c => c.nameKo === '엑자몬', '엑자몬 조그레스'); if (ok) discardOption(state, hp, findStack(state, hp, hid) || h); return ok; } finally { state._s5auto = saved; }
} });
hk('BT20-100', { tag: '서로의 턴', preventLeave: (state, hp, h, target) => {
  if (!delayReady(state, h) || !C(target.cardId).nameKo.includes('오메가몬')) return false;
  if (!syncAsk(state, `딜레이: 이 카드를 파기하고 ${C(target.cardId).nameKo}이(가) 벗어나지 않게 할까요?`)) return false;
  return discardOption(state, hp, h);
} });
sc('BT20-099::메인', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  await playDiscounted(ctx, c => hasType(c, '엑셀', '액셀'), 4, '등장시킬 「액셀」 디지몬 선택');
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), '이 카드를 진화원 아래에 놓을 디지몬 선택');
  if (!t || !removeFrom(pl.trash, ctx.sourceCardId)) return;
  putSourceBottom(state, t, ctx.sourceCardId, false);
});

// ================================================================== P- / LM / ST
{
  const ev = (state, hp, h, info, kindFn) => true;
  void ev;
  const suiEv = (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && isDig(info.stack) && typeIncl(C(info.stack.cardId), '수생') && isTam(h) && !h.suspended;
  hk('P-168', { tag: '자신의 턴', events: { sourcesAdded: suiEv } });
  sc('P-168::자신의 턴', async (ctx) => {
    const { state } = ctx, t = me(ctx), evt = t && t.hookEvt;
    const st = evt && findStack(state, ctx.self, evt.stackUid);
    if (!t || !st || t.suspended) return;
    const o = { stack: st, zones: ['hand'], pred: c => typeIncl(c, '수생'), cost: { mode: 'discount', n: 1 } };
    if (!evoCands(ctx, o).length || !(await ask(ctx, '이 테이머를 레스트시켜 그 디지몬을 진화시킬까요?'))) return;
    S.restStack(state, ctx.self, t.uid);
    if (t.suspended) await evolveInto(ctx, o);
  });
  const minEv = (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && isDig(info.stack) && hasType(C(info.stack.cardId), '광물형', '광석형') && isTam(h) && !h.suspended;
  hk('P-169', { tag: '서로의 턴', events: { sourcesTrashed: minEv } });
  sc('P-169::서로의 턴', async (ctx) => {
    const { state } = ctx, t = me(ctx), evt = t && t.hookEvt;
    const st = evt && findStack(state, ctx.self, evt.stackUid);
    if (!t || !st || t.suspended) return;
    const pl = state.players[ctx.self];
    if (!pl.trash.some(id => hasType(C(id), '광물형', '광석형')) || !(await ask(ctx, '이 테이머를 레스트시켜 트래시의 카드를 그 디지몬의 진화원 아래에 놓을까요?'))) return;
    S.restStack(state, ctx.self, t.uid);
    if (!t.suspended) return;
    const idx = await pickZone(ctx, ctx.self, 'trash', c => hasType(c, '광물형', '광석형'), '진화원 아래에 놓을 카드 선택');
    if (idx != null) { const [id] = pl.trash.splice(idx, 1); putSourceBottom(state, st, id, false); }
  });
}
hk('BT21-006', { tag: '서로의 턴', src: 'inheritedKo', dp: (state, hp, h, target) => (target === h && h.sources.slice(S.fdCount(h)).filter(id => C(id).nameKo === '벰몬').length >= 4 ? 3000 : 0) });
hk('P-182', { tag: '서로의 턴', dp: (state, hp, h, target) => (target === h ? 1000 * distinctColors([...digs(state, hp), ...tams(state, hp)]).size : 0) });
hk('P-185', { tag: '서로의 턴', dp: (state, hp, h, target) => (target === h ? 1000 * new Set(h.sources.slice(S.fdCount(h)).flatMap(id => C(id).colors || [])).size : 0) });
hk('P-183', { tag: '서로의 턴', limit: 1, events: { redirect: () => true } });
sc('P-183::서로의 턴', async (ctx) => { S.trashTopSecurityByEffect(ctx.state, opp(ctx.self)); });
// 【진화 시】 상대의 턴 종료까지 상대의 디지몬 1마리에게 「【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.」를 준다. 그 후 이 디지몬으로 어택할 수 있다.
// (the generic grant only queues a manual reminder for the forced-attack text, so use the s3.forceAtkMain mechanism)
sc('P-183::진화 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), st = me(ctx);
  const t = await pickStack(ctx, o, digs(state, o), '효과를 줄 상대 디지몬 선택');
  if (t) giveForcedAttack(state, t, ctx.sourceCardId, oppTurnEnd(state, ctx.self));
  if (st && !st.suspended && await ask(ctx, '이 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, st.uid);
});
sc('P-184::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  S.modifyDP(state, ctx.self, st.uid, 3000, 'opponentTurn');
  if (st.sources.some(id => /^키사카타 코(우)?스케$/.test(C(id).nameKo))) for (const s of digs(state, ctx.self)) if (hasType(C(s.cardId), 'SoC')) S.unsuspendStack(state, ctx.self, s.uid);
});
sc('P-186::등장 시', async (ctx) => {
  const { state } = ctx;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of digs(state, p)) if (S.effectiveDP(state, p, s) >= 13000) entries.push({ player: p, uid: s.uid });
  let done = false;
  if (entries.length) {
    const pick = await ctx.choose('pickStackAnySide', { entries, prompt: 'DP 13000 이상의 디지몬 1마리 소멸' });
    if (pick) { const st = findStack(state, pick.player, pick.uid); if (st) { del(state, pick.player, st, ctx.self); done = !findStack(state, pick.player, pick.uid); } }
  }
  if (!done) S.recoverTopOfDeckToSecurity(state, ctx.self);
});
SCRIPTS['P-186::진화 시'] = SCRIPTS['P-186::등장 시'];
// 이 디지몬이 등장할 때, DP 13000 이상의 디지몬이 있다면, 서로의 트래시 합계 5장마다 지불하는 코스트 -2 (hand play only, like the other selfPlayDiscount cards)
hk('P-186', { tag: '__handPlay', selfPlayDiscount: (state) => {
  if (!['p1', 'p2'].some(q => digs(state, q).some(s => S.effectiveDP(state, q, s) >= 13000))) return 0;
  return -2 * Math.floor((state.players.p1.trash.length + state.players.p2.trash.length) / 5);
} });
sc('LM-040::어택 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), o = opp(ctx.self); if (!st) return;
  if (digs(state, o).some(s => s.sources.length >= st.sources.length)) return;
  S.unsuspendStack(state, ctx.self, st.uid);
  S.addSecurityDPMod(state, o, -6000, state.turnNumber);
});
// 【등장 시】【진화 시】 상대의 디지몬/테이머 1마리(명)를 레스트시킨다. 그 후, 상대의 턴 종료까지 상대의 디지몬/테이머 1마리(명)의 【진화 시】 효과는 발휘하지 않고, 액티브가 되지 않는다.
sc('LM-042::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const pool = () => [...digs(state, o), ...tams(state, o)];
  const r = await pickStack(ctx, o, pool().filter(s => !s.suspended), '레스트시킬 상대의 디지몬/테이머 선택');
  if (r) S.restStack(state, o, r.uid);
  const t = await pickStack(ctx, o, pool(), '【진화 시】 효과를 봉인하고 액티브가 되지 않게 할 상대의 디지몬/테이머 선택');
  if (!t) return;
  const until = oppTurnEnd(state, ctx.self);
  t.noEvoTrigUntil = until; t.s2NoActiveUntil = until;
  S.log(state, `${o} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 【진화 시】 효과 발휘 불가, 액티브가 되지 않음`);
});
SCRIPTS['LM-042::진화 시'] = SCRIPTS['LM-042::등장 시'];
sc('LM-042::소멸 시', async (ctx) => { S.placeThisAtSecurityBottom(ctx.state, ctx.self, ctx.sourceCardId); });
async function adventureEvolve(ctx) {
  const st = me(ctx); if (!st) return;
  const cols = distinctColors(tams(ctx.state, ctx.self).filter(t => hasType(C(t.cardId), '어드벤처')));
  if (cols.size < 3) return;
  const o = { stack: st, zones: ['hand'], pred: c => hasType(c, '어드벤처'), cost: { mode: 'free' } };
  if (!evoCands(ctx, o).length || !(await ask(ctx, '이 디지몬을 「어드벤처」 디지몬으로 진화시킬까요?'))) return;
  await evolveInto(ctx, o);
}
sc('ST20-03::등장 시', adventureEvolve); sc('ST20-03::진화 시', adventureEvolve);
sc('ST21-08::등장 시', adventureEvolve); sc('ST21-08::진화 시', adventureEvolve);
const evoAlt = (name, cond) => ({ tag: '자신의 턴', evoAlt: (state, hp, h, stack) => (stack === h && cond(state, hp) ? { test: (tgt) => tgt.nameKo === name, cost: 4 } : null) });
const heroes3 = (state, hp) => new Set(tams(state, hp).filter(t => hasType(C(t.cardId), '히어로')).map(t => C(t.cardId).nameKo)).size >= 3;
hk('BT21-010', evoAlt('시리우스몬', (s, hp) => heroes3(s, hp) || s.players[hp].security.length <= 2));
hk('BT21-040', evoAlt('샤인그레이몬', (s, hp) => digs(s, opp(hp)).some(d => (C(d.cardId).level || 0) >= 6) || heroes3(s, hp)));
hk('ST20-10', evoAlt('워그레이몬', (s, hp) => digs(s, opp(hp)).some(d => S.effectiveDP(s, opp(hp), d) >= 10000) || tamerColors(s, hp) >= 3));
hk('ST21-10', evoAlt('메탈가루몬', (s, hp) => digs(s, opp(hp)).some(d => S.effectiveDP(s, opp(hp), d) >= 10000) || tamerColors(s, hp) >= 3));
sc('ST20-11::등장 시', async (ctx) => {
  const { state } = ctx;
  const n = Math.floor(tamerColors(state, ctx.self) / 2);
  const chosen = [];
  for (let i = 0; i < n; i++) {
    const t = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => !chosen.includes(s)), '상대 디지몬의 효과를 받지 않을 디지몬 선택');
    if (!t) break;
    chosen.push(t);
    S.grantShield(state, ctx.self, t.uid, { until: oppTurnEnd(state, ctx.self), kinds: ['all'], fromCategory: 'digimon' });
  }
});
SCRIPTS['ST20-11::진화 시'] = SCRIPTS['ST20-11::등장 시'];
// 【진화 시】【어택 시】 가장 DP가 낮은 상대의 디지몬 1마리를 소멸시킨다 (first tag 진화 시 is shared with the 등장 시/진화 시 segment -> @needle key)
sc('ST20-11::진화 시@가장 DP가 낮은', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), ds = digs(state, o);
  if (!ds.length) return;
  const min = Math.min(...ds.map(s => S.effectiveDP(state, o, s)));
  const t = await pickStack(ctx, o, ds.filter(s => S.effectiveDP(state, o, s) === min), '소멸시킬 가장 DP가 낮은 상대 디지몬 선택');
  if (t) del(state, o, t, ctx.self);
});
sc('ST21-06::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const cap = 6000 + 2000 * Math.floor(tamerColors(state, ctx.self) / 2);
  const t = await pickStack(ctx, o, digs(state, o).filter(s => S.effectiveDP(state, o, s) <= cap), `시큐리티 위에 놓을 DP ${cap} 이하의 상대 디지몬 선택`);
  if (t) stackToSecurity(state, o, t, 'top');
});
SCRIPTS['ST21-06::진화 시'] = SCRIPTS['ST21-06::등장 시'];

// ================================================================== BT21
sc('BT21-013::진화 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self], st = me(ctx); if (!st) return;
  const pred = (c) => c.category === 'digimon' && hasType(c, '하이브리드체', '히어로');
  const zones = ['hand', 'trash'].filter(z => pl[z].some(id => pred(C(id))));
  if (!zones.length) return;
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '위치 선택', options: zones.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zones[k]; }
  const idx = await pickZone(ctx, ctx.self, zone, pred, '진화원 아래에 놓을 카드 선택 (취소=안 함)');
  if (idx == null) return;
  const dests = [st, ...tams(state, ctx.self).filter(t => (C(t.cardId).colors || []).includes('red') && C(t.cardId).inheritedKo)];
  const d = await pickStack(ctx, ctx.self, dests, '카드를 놓을 디지몬/테이머 선택');
  if (!d) return;
  const [id] = pl[zone].splice(idx, 1);
  putSourceBottom(state, d, id, false);
});
sc('BT21-013::어택 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await evolveInto(ctx, { stack: st, zones: ['hand'], pred: c => hasType(c, '하이브리드체', '히어로') && (c.colors || []).includes('red'), cost: { mode: 'discount', n: 1 } });
});
hk('BT21-014', { tag: '자신의 턴', events: { securityDecrease: (state, hp, h, info) => info.owner === opp(hp) && isDig(h) } });
sc('BT21-014::자신의 턴', async (ctx) => {
  const st = me(ctx); if (!st) return;
  const o = { stack: st, zones: ['hand'], pred: c => hasType(c, '하이브리드체') && c.level === 5, cost: { mode: 'discount', n: 1 } };
  if (!evoCands(ctx, o).length || !(await ask(ctx, '이 디지몬을 진화시킬까요?'))) return;
  await evolveInto(ctx, o);
});
hk('BT21-018', { tag: '자신의 턴', limit: 1, events: { linked: (state, hp, h, info) => info.stack === h } });
sc('BT21-018::자신의 턴', async (ctx) => {
  const st = me(ctx); if (!st || st.suspended) return;
  if (await ask(ctx, '이 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, st.uid);
});
hk('BT21-073', { tag: '자신의 턴', limit: 1, events: { linked: (state, hp, h, info) => info.stack === h } });
sc('BT21-073::자신의 턴', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '효과를 줄 상대 디지몬 선택');
  if (t) giveForcedAttack(state, t, ctx.sourceCardId, oppTurnEnd(state, ctx.self));
});
sc('BT21-021::어택 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const played = await playDiscounted(ctx, c => hasType(c, '크로스 하트', '블루 플레어', '히어로'), 5, '등장시킬 카드 선택');
  if (played && st && findStack(state, ctx.self, st.uid)) del(state, ctx.self, st, ctx.self);
});
sc('BT21-023::등장 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!(await ask(ctx, 'Lv.4 이하의 디지몬 카드를 링크할까요?'))) return;
  await linkFree(ctx, { stack: st, zones: ['hand', 'sources'], pred: c => (c.level || 0) <= 4 });
});
SCRIPTS['BT21-023::진화 시'] = SCRIPTS['BT21-023::등장 시'];
// 【자신의 턴】[턴 1회] 이 디지몬이 링크했을 때, 이 디지몬의 DP 이하의 상대 디지몬 1마리를 소멸 (the generic tag scan never matched: the trigger word is in the body, not a tag)
hk('BT21-023', { tag: '자신의 턴', limit: 1, events: { linked: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT21-073::등장 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!(await ask(ctx, 'Lv.4 이하의 디지몬 카드를 링크할까요?'))) return;
  await linkFree(ctx, { stack: st, zones: ['trash', 'sources'], pred: c => (c.level || 0) <= 4 });
});
SCRIPTS['BT21-073::진화 시'] = SCRIPTS['BT21-073::등장 시'];
hk('BT21-027', { tag: '서로의 턴', preventLeave: (state, hp, h, target) => {
  if (target !== h) return false;
  const pool = h.sources.slice(S.fdCount(h)).filter(id => C(id).category === 'digimon' && hasType(C(id), '크로스 하트', '블루 플레어'));
  const t = tams(state, hp)[0];
  if (!pool.length || !t || !syncAsk(state, '이 디지몬의 진화원의 디지몬 카드를 테이머 아래에 놓을까요?')) return false;
  for (const id of pool.slice(0, 4)) { const j = h.sources.lastIndexOf(id); if (j >= 0) h.sources.splice(j, 1); t.sources.splice(S.fdCount(t), 0, id); }
  S.recomputeStackGrants(h);
  return false;
} });
sc('BT21-030::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '진화원을 파기할 상대 디지몬 선택');
  if (t) S.trashEvoSources(state, o, t.uid, 10, 'top');
});
SCRIPTS['BT21-030::진화 시'] = SCRIPTS['BT21-030::등장 시'];
sc('BT21-030::어택 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), opl = state.players[o];
  const t = await pickStack(ctx, o, digs(state, o).filter(s => s.sources.length === 0), '덱 아래로 되돌릴 상대 디지몬 선택 (취소=안 함)', true);
  if (!t || S.effectBlocked(state, o, t, 'bounce')) return;
  const doLeave = () => {
    if (!opl.battle.includes(t) || S.leaveGate(state, o, t, 'effect', 'bounce', doLeave)) return;
    opl.battle.splice(opl.battle.indexOf(t), 1);
    opl.trash.push(...(t.linkCards || []).map(l => l.cardId));
    if (!C(t.cardId).isToken) opl.deck.push(t.cardId);
    S.log(state, `${o} ${C(t.cardId).nameKo} 덱 아래로`);
  };
  doLeave();
});
hk('BT21-050', { tag: '상대의 턴', redirectOptions: (state, hp, h, ap, aStack) => {
  if (!h.suspended || S.turnUsesRemaining(h, S.onceLimitKey('BT21-050', ['어택대상변경']), 1) <= 0) return [];
  return digs(state, hp).filter(s => hasType(C(s.cardId), 'WG')).map(s => ({ targetUid: s.uid, limit: 1 }));
} });
sc('BT21-052::진화 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  for (const s of [...digs(state, o), ...tams(state, o)]) S.restStack(state, o, s.uid);
  const ts = [...digs(state, o), ...tams(state, o)].filter(s => s.suspended);
  const t = await pickStack(ctx, o, ts, '소멸시킬 레스트 상태의 상대 디지몬/테이머 선택');
  if (t) del(state, o, t, ctx.self);
});
sc('BT21-056::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const m = (c) => mention(c, '벰몬');
  if (!pl.hand.some(id => m(C(id))) || !pl.trash.some(id => m(C(id)) && C(id).category !== 'digitama')) return;
  if (!(await ask(ctx, '패의 「벰몬」 카드 1장을 파기하고 트래시의 「벰몬」 카드 1장을 패로 되돌릴까요?'))) return;
  const hi = await pickZone(ctx, ctx.self, 'hand', m, '파기할 「벰몬」 카드 선택');
  if (hi == null) return;
  S.trashFromHand(state, ctx.self, hi);
  const ti = await pickZone(ctx, ctx.self, 'trash', (c) => m(c) && c.category !== 'digitama', '패로 되돌릴 카드 선택');
  if (ti != null) { const [id] = pl.trash.splice(ti, 1); pl.hand.push(id); }
});
// [상속] 【자신의 턴】[턴에 1회] 이 디지몬이 「벰몬」이 기술되어 있는 디지몬 카드로 진화할 때, 지불하는 진화 코스트 -1
{ const d = { tag: '자신의 턴', src: 'inheritedKo', evoDiscount: (state, hp, h, stack, targetId) => {
  if (stack !== h || C(targetId).category !== 'digimon' || !mention(C(targetId), '벰몬')) return 0;
  return S.hookUseOnce(h, 'BT21-056', d) ? -1 : 0;
} }; hk('BT21-056', d); }
sc('BT21-057::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  if (!tams(state, ctx.self).some(t => C(t.cardId).nameKo === '신태일' || hasType(C(t.cardId), '어드벤처'))) return;
  const t = await pickStack(ctx, o, digs(state, o), '효과를 줄 상대 디지몬 선택');
  if (t) giveForcedAttack(state, t, ctx.sourceCardId, oppTurnEnd(state, ctx.self));
});
SCRIPTS['BT21-057::진화 시'] = SCRIPTS['BT21-057::등장 시'];
sc('BT21-060::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), o = opp(ctx.self); if (!st) return;
  S.grantShield(state, ctx.self, st.uid, { until: oppTurnEnd(state, ctx.self), kinds: ['srcTrash'] });
  const n = Math.floor(st.sources.filter(id => C(id).nameKo === '벰몬').length / 2);
  if (!n) return;
  const t = await pickStack(ctx, o, digs(state, o), '퇴화시킬 상대 디지몬 선택');
  if (t) S.retreat(state, o, t.uid, n);
});
hk('BT21-060', { tag: '상대의 턴', src: 'inheritedKo', limit: 1, events: { attack: (state, hp, h, info) => info.owner !== hp && h.sources.slice(S.fdCount(h)).filter(id => C(id).nameKo === '벰몬').length >= 2 } });
sc('BT21-060::상대의 턴', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  if (!(await ask(ctx, '진화원의 「벰몬」 2장을 덱 아래로 되돌려 그 어택을 종료할까요?'))) return;
  let n = 0;
  for (let i = st.sources.length - 1; i >= S.fdCount(st) && n < 2; i--) if (C(st.sources[i]).nameKo === '벰몬') { state.players[ctx.self].deck.push(...st.sources.splice(i, 1)); n++; }
  S.recomputeStackGrants(st);
  if (state.attackCtx && state.attackCtx.terminate) state.attackCtx.terminate();
});
// 【서로의 턴】 이 디지몬이 배틀 에어리어를 벗어날 때, 진화원에서 「벰몬」 1장을 코스트 없이 등장 (the sources are already in the trash when this resolves)
hk('BT21-060', { tag: '서로의 턴', has: '벗어날 때', onLeave: () => true });
sc('BT21-060::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self], evt = ctx.trigger && ctx.trigger.evt;
  if (!evt || !evt.sources) return;
  const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).nameKo === '벰몬' && C(pl.trash[i]).category === 'digimon' && evt.sources.includes(pl.trash[i]));
  if (!idxs.length || !(await ask(ctx, '진화원의 「벰몬」 1장을 코스트를 지불하지 않고 등장시킬까요?'))) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: '등장시킬 「벰몬」 선택' });
  if (idx != null) S.playFreeFromZone(state, ctx.self, 'trash', idx, {});
});
sc('BT21-061::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const n = Math.floor(tamerColors(state, ctx.self) / 2);
  if (!n) return;
  const t = await pickStack(ctx, o, digs(state, o), '퇴화시킬 상대 디지몬 선택');
  if (t) S.retreat(state, o, t.uid, n);
});
SCRIPTS['BT21-061::진화 시'] = SCRIPTS['BT21-061::등장 시'];
async function useOptionFree(ctx, zone, idx) {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const [id] = pl[zone].splice(idx, 1);
  pl.trash.push(id);
  S.log(state, `${who} ${C(id).nameKo} 코스트 없이 사용`);
  S.queueTriggersFor(state, who, id, 'use');
  S.emitGameEvent(state, 'optionUsed', { owner: who, stack: null, cause: null, cardId: id, useCost: 0 });
}
sc('BT21-062::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self]; if (!st) return;
  const m = (c) => mention(c, '벰몬');
  if (pl.trash.filter(id => m(C(id))).length < 4) return;
  const opt = (z) => pl[z].findIndex(id => C(id).nameKo === '라그나로크 캐논');
  if (opt('hand') < 0 && opt('trash') < 0) { /* the option might be among the 벰몬 cards; allow anyway */ }
  if (!(await ask(ctx, '트래시의 「벰몬」 4장을 진화원 아래에 놓고 「라그나로크 캐논」을 사용할까요?'))) return;
  for (let i = 0; i < 4; i++) { const idx = await pickZone(ctx, ctx.self, 'trash', m, `진화원 아래에 놓을 「벰몬」 카드 (${i + 1}/4)`); if (idx == null) return; const [id] = pl.trash.splice(idx, 1); putSourceBottom(state, st, id, false); }
  for (const z of ['hand', 'trash']) {
    const i = opt(z);
    if (i >= 0) { const k = await pickZone(ctx, ctx.self, z, c => c.nameKo === '라그나로크 캐논', '사용할 「라그나로크 캐논」 선택'); if (k != null) { await useOptionFree(ctx, z, k); return; } }
  }
});
// 【서로의 턴】 이 디지몬의 진화원 1장마다 이 디지몬을 DP +1000 (no generic parse for this phrasing)
hk('BT21-072', { tag: '서로의 턴', dp: (state, hp, h, target) => (target === h ? 1000 * h.sources.length : 0) });
sc('BT21-072::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (await ask(ctx, '이 디지몬으로 레스트시키지 않고 어택할까요?')) ctx.startAttack(ctx.self, st.uid, undefined, { noRest: true });
});
sc('BT21-074::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const pred = (c) => hasType(c, '어플몬', '3총사');
  const zones = ['hand', 'trash'].filter(z => pl[z].some(id => pred(C(id))));
  if (!zones.length || !digs(state, ctx.self).length) return;
  if (!(await ask(ctx, '카드를 디지몬의 진화원 아래에 놓고 보호할까요?'))) return;
  let zone = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '위치 선택', options: zones.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zones[k]; }
  const idx = await pickZone(ctx, ctx.self, zone, pred, '진화원 아래에 놓을 카드 선택');
  if (idx == null) return;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), '카드를 놓을 디지몬 선택');
  if (!t) return;
  const [id] = pl[zone].splice(idx, 1);
  putSourceBottom(state, t, id, false);
  S.grantShield(state, ctx.self, t.uid, { until: oppTurnEnd(state, ctx.self), kinds: ['bounce', 'retreat'] });
});
SCRIPTS['BT21-074::진화 시'] = SCRIPTS['BT21-074::등장 시'];
// 【진화 시】【어택 시】[턴 1회] 자신의 디지몬의 진화원에서 특징 「어플몬」/「3총사」를 가진 카드 1장을 파기하는 것으로, 상대의 디지몬 1마리를 《퇴화 1》
// (the segment shares first tag 진화 시 with the 등장 시/진화 시 one, so it needs its own @needle key)
sc('BT21-074::진화 시@진화원에서 특징', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const pred = (id) => hasType(C(id), '어플몬', '3총사');
  const hosts = digs(state, ctx.self).filter(s => s.sources.slice(S.fdCount(s)).some(pred));
  if (!hosts.length || !digs(state, o).length) return;
  if (!(await ask(ctx, '자신의 디지몬의 진화원의 「어플몬」/「3총사」 카드 1장을 파기하고 상대 디지몬 1마리를 퇴화시킬까요?'))) return;
  const h = await pickStack(ctx, ctx.self, hosts, '진화원 카드를 파기할 디지몬 선택');
  if (!h) return;
  const fd = S.fdCount(h);
  const idxs = []; h.sources.forEach((id, i) => { if (i >= fd && pred(id)) idxs.push(i); });
  let at = idxs[idxs.length - 1];
  if (idxs.length > 1) { const k = await pickFromList(ctx, ctx.self, h.sources.slice(), idxs, '파기할 진화원 카드 선택'); if (k == null) return; at = k; }
  const [id] = h.sources.splice(at, 1);
  state.players[ctx.self].trash.push(id);
  S.recomputeStackGrants(h);
  S.log(state, `${ctx.self} ${C(h.cardId).nameKo}의 진화원 ${C(id).nameKo} 파기`);
  const t = await pickStack(ctx, o, digs(state, o), '퇴화시킬 상대 디지몬 선택');
  if (t) S.retreat(state, o, t.uid, 1);
});
sc('BT21-077::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self], o = opp(ctx.self);
  if (!pl.hand.some(id => mention(C(id), '감마몬')) || !digs(state, o).length) return;
  if (!(await ask(ctx, '패의 「감마몬」 카드 1장을 파기하고 상대 디지몬에게 효과를 줄까요?'))) return;
  const hi = await pickZone(ctx, ctx.self, 'hand', c => mention(c, '감마몬'), '파기할 카드 선택');
  if (hi == null) return;
  S.trashFromHand(state, ctx.self, hi);
  const t = await pickStack(ctx, o, digs(state, o), '효과를 줄 상대 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, o, t.uid, '충돌', true, 'opponentTurn');
  giveForcedAttack(state, t, ctx.sourceCardId, oppTurnEnd(state, ctx.self));
});
SCRIPTS['BT21-077::진화 시'] = SCRIPTS['BT21-077::등장 시'];
// 【소멸 시】 「카노바이스몬」 1장 또는 「감마몬」이 기술되어 있는 Lv.4 이하의 디지몬 카드 1장 (the Lv.4 cap applies only to the 감마몬 branch; the inherited version has no 카노바이스몬 branch and stays generic)
sc('BT21-077::소멸 시@카노바이스몬', async (ctx) => {
  const idx = await pickZone(ctx, ctx.self, 'trash', c => c.category === 'digimon' && (c.nameKo === '카노바이스몬' || (mention(c, '감마몬') && (c.level || 0) <= 4)), '코스트를 지불하지 않고 등장시킬 카드 선택 (취소=안 함)');
  if (idx != null) S.playFreeFromZone(ctx.state, ctx.self, 'trash', idx, {});
});
sc('BT21-079::어택 종료 시', async (ctx) => {
  const { state } = ctx;
  for (const p of ['p1', 'p2']) for (const s of [...digs(state, p)]) del(state, p, s, ctx.self);
});
// [상속] 【자신의 턴】[턴에 1회] 상대의 시큐리티가 줄어들었을 때, 자신의 패에서 레드인 테이머 카드 1장을 코스트를 지불하지 않고 등장시킨다
hk('BT21-082', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { securityDecrease: (state, hp, h, info) => info.owner === opp(hp) } });
sc('BT21-082::자신의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const idx = await pickZone(ctx, ctx.self, 'hand', c => c.category === 'tamer' && (c.colors || []).includes('red'), '코스트를 지불하지 않고 등장시킬 레드 테이머 선택');
  if (idx != null) S.playFreeFromZone(state, ctx.self, 'hand', idx, {});
});
sc('BT21-082::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx;
  const names = new Set(tams(state, ctx.self).filter(t => (C(t.cardId).colors || []).includes('red')).map(t => C(t.cardId).nameKo)).size;
  const o = { zones: ['hand'], pred: c => hasType(c, '하이브리드체', '히어로'), cost: { mode: 'discount', n: names }, stacks: [...digs(state, ctx.self), ...tams(state, ctx.self)] };
  if (!o.stacks.some(s => evoCands(ctx, { ...o, stack: s }).length) || !(await ask(ctx, '디지몬/테이머를 진화시킬까요?'))) return;
  await evolveAny(ctx, o);
});
// 【자신의 메인 페이즈 개시 시】 패의 디지몬 카드 1장을 이 테이머 아래에 놓는 것으로, 《1 드로우》, 메모리 +1 (the generic compile skipped the "place under" cost)
async function tamerUnderDraw(ctx, pred, prompt) {
  const { state } = ctx, t = me(ctx); if (!t) return;
  const idx = await pickZone(ctx, ctx.self, 'hand', c => c.category === 'digimon' && pred(c), prompt);
  if (idx == null) return;
  const [id] = state.players[ctx.self].hand.splice(idx, 1);
  putSourceBottom(state, t, id, false);
  S.drawCards(state, ctx.self, 1);
  S.grantMemory(state, ctx.self, 1, ctx.sourceCardId);
}
sc('BT21-083::자신의 메인 페이즈 개시 시', (ctx) => tamerUnderDraw(ctx, c => hasType(c, '크로스 하트', '블루 플레어', '히어로'), '이 테이머 아래에 놓을 디지몬 카드 선택 (취소=안 함)'));
sc('BT21-088::자신의 메인 페이즈 개시 시', (ctx) => tamerUnderDraw(ctx, c => `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes('《세이브') || hasType(c, '히어로'), '이 테이머 아래에 놓을 디지몬 카드 선택 (취소=안 함)'));
{
  const ev = (state, hp, h, info) => info.owner === hp && isDig(info.stack) && hasType(C(info.stack.cardId), '크로스 하트', '히어로') && isTam(h) && !h.suspended;
  hk('BT21-083', { tag: '자신의 턴', events: { play: ev, digivolve: ev } });
  sc('BT21-083::자신의 턴', async (ctx) => {
    const { state } = ctx, t = me(ctx), evt = t && t.hookEvt;
    const st = evt && findStack(state, ctx.self, evt.stackUid);
    if (!t || !st || t.suspended || st.suspended) return;
    if (!(await ask(ctx, '이 테이머를 레스트시켜 그 디지몬으로 어택할까요?'))) return;
    S.restStack(state, ctx.self, t.uid);
    if (t.suspended) ctx.startAttack(ctx.self, st.uid);
  });
}
// 【서로의 턴】[턴 1회] 이 테이머가 레스트했을 때, 턴 종료까지 자신의 디지몬 1마리는 《관통》을 얻고 DP +3000. 그 후, 턴 종료까지 상대의 디지몬 1마리를 DP -3000
hk('BT21-086', { tag: '서로의 턴', limit: 1, events: { rest: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT21-086::서로의 턴', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const mine = await pickStack(ctx, ctx.self, digs(state, ctx.self), '《관통》과 DP +3000을 받을 자신의 디지몬 선택');
  if (mine) { S.grantKeyword(state, ctx.self, mine.uid, '관통', true, 'turn'); S.modifyDP(state, ctx.self, mine.uid, 3000, 'turn'); }
  const t = await pickStack(ctx, o, digs(state, o), 'DP -3000을 받을 상대 디지몬 선택');
  if (t) S.modifyDP(state, o, t.uid, -3000, 'turn');
});
sc('BT21-086::등장 시', async (ctx) => {
  const { state } = ctx;
  const ts = tams(state, ctx.self).filter(t => C(t.cardId).nameKo === '최건우' && !t.suspended);
  const t = await pickStack(ctx, ctx.self, ts, '레스트시킬 「최건우」 선택 (취소=안 함)', true);
  if (t) S.restStack(state, ctx.self, t.uid);
});
hk('BT21-088', { tag: '자신의 턴', evoOption: (state, hp, h, stack, targetId) => {
  if (!isTam(h) || h.suspended || !isDig(stack) || !tams(state, hp).some(t => t.sources.length)) return null; // "자신의 테이머 아래의 카드 1장" = any own tamer's under-card
  const c = C(targetId);
  if (!(`${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes('《세이브') || hasType(c, '히어로'))) return null;
  return { label: '이 테이머를 레스트시키고 테이머 아래의 카드 1장을 그 디지몬의 진화원 아래에 놓아 진화 코스트 -1?', async apply(choose) {
    S.restStack(state, hp, h.uid);
    if (!h.suspended) return 0;
    const pool = tams(state, hp).filter(t => t.sources.length);
    let from = pool[0];
    if (pool.length > 1 && typeof choose === 'function') { const u = await choose('pickStack', { player: hp, uids: pool.map(t => t.uid), prompt: '진화원 아래에 놓을 카드가 있는 테이머 선택' }); from = pool.find(t => t.uid === u) || pool.find(t => t === h) || pool[0]; }
    if (!from) return 0;
    const id = from.sources.pop();
    S.recomputeStackGrants(from);
    putSourceBottom(state, stack, id, false);
    return -1;
  } };
} });
// delay options (in the battle area, usable from the turn after placement)
async function delayOnly(ctx, f) {
  const { state } = ctx, h = me(ctx);
  if (!h || C(h.cardId).category !== 'option' || !delayReady(state, h)) return;
  if (!(await ask(ctx, '《딜레이》 — 이 카드를 파기하고 효果를 발휘할까요?'.replace('효果', '효과')))) return;
  if (!discardOption(state, ctx.self, h)) return;
  await f();
}
hk('BT21-090', { tag: '서로의 턴', events: { sourcesAdded: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && delayReady(state, h) } });
sc('BT21-090::서로의 턴', (ctx) => delayOnly(ctx, () => evolveAny(ctx, { stacks: digs(ctx.state, ctx.self), zones: ['hand'], pred: c => mention(c, '감마몬'), cost: { mode: 'free' } })));
hk('BT21-093', { tag: '서로의 턴', events: { securityDecrease: (state, hp, h, info) => info.owner === opp(hp) && delayReady(state, h) } });
sc('BT21-093::서로의 턴', (ctx) => delayOnly(ctx, async () => {
  const stacks = digs(ctx.state, ctx.self).filter(s => hasType(C(s.cardId), '파충류형', '용인형'));
  await evolveAny(ctx, { stacks, zones: ['hand'], pred: c => hasType(c, '파충류형', '용인형'), cost: { mode: 'free' } });
}));
hk('BT21-094', { tag: '서로의 턴', events: { topTrashed: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && hasType(C(info.cardId || info.stack.cardId), '아머체') && delayReady(state, h) } });
sc('BT21-094::서로의 턴', (ctx) => delayOnly(ctx, () => evolveAny(ctx, { stacks: digs(ctx.state, ctx.self), zones: ['hand'], pred: c => hasType(c, '아머체'), cost: { mode: 'free' } })));
sc('BT21-097::자신의 턴 종료 시', (ctx) => delayOnly(ctx, () => linkFree(ctx, { zones: ['hand'], pred: () => true })));
sc('BT21-092::메인', async (ctx) => {
  const { state } = ctx;
  const src = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => hasType(C(s.cardId), '크로스 하트')), '진화원의 디지몬 카드를 옮길 「크로스 하트」 디지몬 선택');
  const tamer = src && await pickStack(ctx, ctx.self, tams(state, ctx.self), '카드를 놓을 테이머 선택');
  if (!src || !tamer) return;
  let n = 0;
  for (let i = src.sources.length - 1; i >= S.fdCount(src); i--) if (C(src.sources[i]).category === 'digimon') { const [id] = src.sources.splice(i, 1); tamer.sources.splice(S.fdCount(tamer), 0, id); n++; }
  S.recomputeStackGrants(src);
  if (n) await playDiscounted(ctx, c => hasType(c, '크로스 하트'), n, '등장시킬 「크로스 하트」 디지몬 선택');
});
hk('BT21-095', { tag: '자신의 턴', grantKw: (state, hp, h, target) => (isDig(target) && hasType(C(target.cardId), 'WG') ? ['볼텍스'] : []) });
sc('BT21-101::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  await linkFree(ctx, { zones: ['hand', 'sources'], pred: c => hasType(c, '어플몬'), ownSourcesOf: st });
});
SCRIPTS['BT21-101::어택 시'] = SCRIPTS['BT21-101::진화 시'];
// 【자신의 턴】[턴 1회] 자신의 디지몬이 링크했을 때, 이 디지몬을 액티브로 하는 것으로, 상대의 시큐리티를 위에서부터 1장 파기
hk('BT21-101', { tag: '자신의 턴', limit: 1, events: { linked: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && isDig(h) } });
sc('BT21-101::자신의 턴', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st || !st.suspended) return;
  if (!(await ask(ctx, '이 디지몬을 액티브로 하여 상대의 시큐리티를 위에서부터 1장 파기할까요?'))) return;
  S.unsuspendStack(state, ctx.self, st.uid);
  if (st.suspended) return;
  S.trashTopSecurityByEffect(state, opp(ctx.self));
});

// ================================================================== EX9 (face-down sources)
const fdN = (st) => S.fdCount(st);
async function ver1Evolve(ctx, ver, zones, disc) {
  const st = me(ctx); if (!st) return;
  const o = { stack: st, zones, pred: c => hasType(c, ver), cost: disc ? { mode: 'discount', n: 1 } : { mode: 'printed' } };
  await evolveInto(ctx, o);
}
sc('EX9-001::어택 시', async (ctx) => { const st = me(ctx); if (!st || !fdN(st)) return; await ver1Evolve(ctx, 'Ver.1', ['hand'], true); });
hk('EX9-002', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { sourcesAdded: (state, hp, h, info) => {
  if (info.stack !== h || !h.s5fdFlag) return false;
  h.s5fdFlag = false; return true;
} } });
sc('EX9-002::자신의 턴', async (ctx) => { const st = me(ctx); if (!st) return; if (evoCands(ctx, { stack: st, zones: ['hand'], pred: c => hasType(c, 'Ver.2') }).length && await ask(ctx, '이 디지몬을 「Ver.2」 디지몬으로 진화시킬까요?')) await ver1Evolve(ctx, 'Ver.2', ['hand'], true); });
hk('EX9-003', { tag: '자신의 턴', src: 'inheritedKo', evoDiscount: (state, hp, h, stack, targetId) => {
  if (stack !== h || !fdN(h) || !hasType(C(targetId), 'Ver.3')) return 0;
  const key = S.onceLimitKey('EX9-003', ['자신의 턴']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return 0;
  S.markTurnEffectUsed(h, key);
  return -1;
} });
sc('EX9-005::메인', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self]; if (!st) return;
  const cnt = pl.trash.filter(id => C(id).nameKo === '네가몬').length + digs(state, ctx.self).reduce((a, s) => a + s.sources.filter(id => C(id).nameKo === '네가몬').length, 0);
  const played = await playDiscounted(ctx, c => c.category === 'digimon' && mention(c, '네가몬'), Math.max(0, 2 - cnt), '등장시킬 「네가몬」 디지몬 선택');
  if (played && findStack(state, ctx.self, st.uid)) putStackUnder(state, ctx.self, st, played);
});
hk('EX9-005', { tag: '서로의 턴', has: '진화할 수 없으며', noEvolve: () => true, preventLeave: (state, hp, h, target, tp, cause, mode) => target === h && mode === 'delete' && (cause === 'effect' || cause === 'ownEffect') });
// [상속] 【상대의 턴】[턴 1회] 상대의 디지몬이 어택했을 때, 어택의 대상을 「네가몬」이 기술되어 있는 자신의 디지몬 1마리로 변경할 수 있다 (generic redirect parser doesn't read the 「이름」이 기술되어 있는 condition)
hk('EX9-005', { tag: '상대의 턴', src: 'inheritedKo', redirectOptions: (state, hp, h, ap, aStack) => {
  if (S.turnUsesRemaining(h, S.onceLimitKey('EX9-005', ['어택대상변경']), 1) <= 0) return [];
  return digs(state, hp).filter(s => mention(C(s.cardId), '네가몬')).map(s => ({ targetUid: s.uid, limit: 1 }));
} });
sc('EX9-006::어택 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st || !fdN(st)) return;
  const o = { stack: st, zones: ['trash'], pred: c => hasType(c, 'Ver.5'), cost: { mode: 'discount', n: 1 } };
  if (!evoCands(ctx, o).length || !(await ask(ctx, '뒷면의 진화원 1장을 파기하고 「Ver.5」 디지몬으로 진화할까요?'))) return;
  S.trashEvoSources(state, ctx.self, st.uid, 1, 'bottom');
  await evolveInto(ctx, o);
});
sc('EX9-011::등장 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self]; if (!st) return;
  const idx = await pickZone(ctx, ctx.self, 'trash', c => c.category === 'digimon', '뒷면으로 진화원 아래에 놓을 디지몬 카드 선택 (취소=안 함)');
  if (idx == null) return;
  const [id] = pl.trash.splice(idx, 1);
  putSourceBottom(state, st, id, true);
  await R.runOne({ op: 'destroySum', stat: 'dp', limit: 5000 + 2000 * fdN(st) }, ctx);
});
SCRIPTS['EX9-011::진화 시'] = SCRIPTS['EX9-011::등장 시'];
hk('EX9-020', { tag: '서로의 턴', preventLeave: (state, hp, h, target, tp, cause) => cause !== 'battle' && isDig(target) && C(target.cardId).level === 6 && interruptJogress(state, hp, target, c => c.nameKo === '오메가몬 Alter-S', '오메가몬 Alter-S 조그레스') });
sc('EX9-025::어택 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self], o = opp(ctx.self); if (!st || !pl.deck.length) return;
  if (!(await ask(ctx, '덱 위 1장을 뒷면으로 진화원 아래에 놓고 상대 디지몬의 DP를 내릴까요?'))) return;
  putSourceBottom(state, st, pl.deck.shift(), true);
  const t = await pickStack(ctx, o, digs(state, o), `DP -${2000 * fdN(st)} 받을 상대 디지몬 선택`);
  if (t) S.modifyDP(state, o, t.uid, -2000 * fdN(st), 'turn');
});
function verTurnEnd(id, ver) {
  sc(`${id}::자신의 턴 종료 시`, async (ctx) => {
    const { state } = ctx, st = me(ctx), pl = state.players[ctx.self]; if (!st) return;
    const pred = c => c.category === 'digimon' && hasType(c, ver);
    if (pl.trash.filter(id2 => pred(C(id2))).length < 3) return;
    if (!(await ask(ctx, `트래시의 「${ver}」 디지몬 3장을 뒷면으로 진화원 아래에 놓고 진화할까요?`))) return;
    for (let i = 0; i < 3; i++) { const idx = await pickZone(ctx, ctx.self, 'trash', pred, `뒷면으로 놓을 카드 (${i + 1}/3)`); if (idx == null) return; const [c] = pl.trash.splice(idx, 1); putSourceBottom(state, st, c, true); }
    await evolveInto(ctx, { stack: st, zones: ['hand', 'trash'], pred: c => hasType(c, ver), cost: { mode: 'printed' } });
  });
}
verTurnEnd('EX9-028', 'Ver.4'); verTurnEnd('EX9-049', 'Ver.3'); verTurnEnd('EX9-050', 'Ver.1'); verTurnEnd('EX9-052', 'Ver.5');
sc('EX9-031::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st || !fdN(st)) return;
  if (!(await ask(ctx, '뒷면의 진화원을 아래에서부터 1장 파기하고 《리커버리 +1》할까요?'))) return;
  S.trashEvoSources(state, ctx.self, st.uid, 1, 'bottom');
  S.recoverTopOfDeckToSecurity(state, ctx.self);
});
SCRIPTS['EX9-031::어택 시'] = SCRIPTS['EX9-031::진화 시'];
// 특징 「Ver.3」를 가진 자신의 디지몬이 이 카드로 진화할 때, 그 디지몬의 뒷면의 진화원 1장마다 지불하는 코스트 -1
hk('EX9-031', { tag: '__handEvo', selfEvoDiscount: (state, p, stack) => (stack && isDig(stack) && hasType(C(stack.cardId), 'Ver.3') ? -S.fdCount(stack) : 0) });
// [상속] 【서로의 턴】[턴에 1회] 자신의 시큐리티가 줄어들었을 때, 턴 종료까지 상대의 디지몬 1마리를 DP -4000
hk('EX9-031', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { securityDecrease: (state, hp, h, info) => info.owner === hp } });
sc('EX9-031::서로의 턴', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), 'DP -4000을 받을 상대 디지몬 선택');
  if (t) S.modifyDP(state, o, t.uid, -4000, 'turn');
});
sc('EX9-055::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const n = pl.trash.filter(id => C(id).nameKo.includes('네가몬')).length + digs(state, ctx.self).reduce((a, s) => a + s.sources.filter(id => C(id).nameKo.includes('네가몬')).length, 0);
  if (n < 4 || pl.raising) return;
  const zones = ['hand', 'trash'].filter(z => pl[z].some(id => C(id).nameKo === '아바도몬 코어'));
  if (!zones.length || !(await ask(ctx, '「아바도몬 코어」를 육성 에어리어에 등장시킬까요?'))) return;
  const zone = zones[0];
  const idx = pl[zone].findIndex(id => C(id).nameKo === '아바도몬 코어');
  const st = S.playFreeFromZone(state, ctx.self, zone, idx, {});
  if (st) { pl.battle.splice(pl.battle.indexOf(st), 1); pl.raising = st; }
});
SCRIPTS['EX9-055::진화 시'] = SCRIPTS['EX9-055::등장 시'];
// 【서로의 턴 종료 시】[턴에 1회] 트래시의 「네가몬」이 기술되어 있는 Lv.6 이하 디지몬 카드 1장을 이 디지몬의 진화원 위에 놓는 것으로, 그 카드와 같은 Lv.의 상대 디지몬 1마리를 소멸시킨다
sc('EX9-055::서로의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self], o = opp(ctx.self); if (!st) return;
  const idx = await pickZone(ctx, ctx.self, 'trash', c => c.category === 'digimon' && mention(c, '네가몬') && (c.level || 0) <= 6, '진화원 위에 놓을 「네가몬」 디지몬 카드 선택 (취소=안 함)');
  if (idx == null) return;
  const [id] = pl.trash.splice(idx, 1);
  st.sources.push(id);
  S.recomputeStackGrants(st);
  S.log(state, `${ctx.self} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 위에 놓음`);
  const t = await pickStack(ctx, o, digs(state, o).filter(s => C(s.cardId).level === C(id).level), `소멸시킬 Lv.${C(id).level}의 상대 디지몬 선택`);
  if (t) del(state, o, t, ctx.self);
});
sc('EX9-069::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const ts = digs(state, ctx.self).filter(s => hasType(C(s.cardId), 'DM'));
  if (!ts.length || !pl.hand.length) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: pl.hand.map((_, i) => i), prompt: '뒷면으로 놓을 패 1장 선택 (취소=안 함)' });
  if (idx == null) return;
  const t = await pickStack(ctx, ctx.self, ts, '카드를 놓을 「DM」 디지몬 선택');
  if (!t) return;
  const [id] = pl.hand.splice(idx, 1);
  putSourceBottom(state, t, id, true);
});
SCRIPTS['EX9-070::메인@딜레이'] = [fn(async (ctx) => {
  const { state } = ctx, h = me(ctx), pl = state.players[ctx.self];
  if (!h || C(h.cardId).category !== 'option' || !delayReady(state, h)) return;
  const ts = digs(state, ctx.self).filter(s => hasType(C(s.cardId), 'DM'));
  const o = { zones: ['hand'], pred: c => hasType(c, 'DM'), cost: { mode: 'discount', n: 2 } };
  const ok = ts.filter(s => evoCands(ctx, { ...o, stack: s }).length);
  if (!ok.length || pl.hand.length < 2 || !(await ask(ctx, '《딜레이》 — 이 카드를 파기하고 패 1장을 뒷면으로 놓아 진화할까요?'))) return;
  if (!discardOption(state, ctx.self, h)) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: pl.hand.map((_, i) => i), prompt: '뒷면으로 놓을 패 1장 선택' });
  const t = await pickStack(ctx, ctx.self, ts, '카드를 놓을 「DM」 디지몬 선택');
  if (idx == null || !t) return;
  const [id] = pl.hand.splice(idx, 1);
  putSourceBottom(state, t, id, true);
  if (evoCands(ctx, { ...o, stack: t }).length) await evolveInto(ctx, { ...o, stack: t });
})];
SCRIPTS['EX9-071::메인@딜레이'] = [fn(async (ctx) => {
  const { state } = ctx, h = me(ctx);
  if (!h || C(h.cardId).category !== 'option' || !delayReady(state, h)) return;
  const ts = digs(state, ctx.self).filter(s => hasType(C(s.cardId), 'DM') && fdN(s) >= 2);
  if (!ts.length || !(await ask(ctx, '《딜레이》 — 이 카드를 파기하고 뒷면의 진화원을 2장 파기해 액티브로 할까요?'))) return;
  if (!discardOption(state, ctx.self, h)) return;
  const t = await pickStack(ctx, ctx.self, ts, '액티브로 할 「DM」 디지몬 선택');
  if (!t) return;
  S.trashEvoSources(state, ctx.self, t.uid, 2, 'bottom');
  S.unsuspendStack(state, ctx.self, t.uid);
})];
hk('EX9-072', { tag: '서로의 턴', zone: 'security', dp: (state, hp, h, target, tp) => (tp === hp && isDig(target) && hasType(C(target.cardId), 'DM') ? 1000 * fdN(target) : 0) });

// ================================================================== 디지크로스 with tamer-under / trash materials
const xrosExtra = (traits, under, trash) => ({ tag: '서로의 턴', xrosExtra: (state, hp, h, cardId) => (isTam(h) && hasType(C(cardId), ...traits) ? { under, trash } : null) });
hk('BT19-079', xrosExtra(['크로스 하트'], 99, 0));
hk('BT19-081', xrosExtra(['블루 플레어'], 99, 0));
hk('BT19-087', xrosExtra(['합성형', '트와일라잇'], 1, 1));
