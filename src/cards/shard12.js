// Shard 12 — bespoke per-card scripts for effect segments whose sentences the generic compiler silently dropped
// (batch 3 of the dropped-sentence audit: ST17 / EX6 / BT17 / EX7 / ST19 / BT18 / LM-027..032 / P-156/158 / BT19 / EX8 / BT20-011/018).
// Generic compiler fixes made for this batch live in effects.js (capPer "N마다 이 효과의 상한 ±M", lockOpp, useOptionFree, placeThisUnderSource, DP 합계).
// state.js is imported lazily-safe (only used inside functions) because state.js imports cards/index.js.
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
const trait = (id, ...ts) => ts.some(t => (C(id).types || []).includes(t));
const traitIncl = (id, ...ts) => ts.some(t => (C(id).types || []).some(x => x.includes(t)));
const nameIs = (id, ...ns) => ns.some(n => S.cardNameIs(id, n));
const nameHas = (id, ...ns) => ns.some(n => S.cardNameHas(id, n));
const colorOf = (id, ...cs) => cs.some(c => (C(id).colors || []).includes(c));
const lvOf = (id) => C(id).level || 0;
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);
const fn = (f) => ({ op: 's12_fn', fn: f });
OPS.s12_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const alias = (to, from) => { SCRIPTS[to] = SCRIPTS[from]; };

async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
async function pickHandIdx(ctx, who, pred, prompt) {
  const pl = ctx.state.players[who];
  const idxs = pl.hand.map((id, i) => i).filter(i => pred(pl.hand[i], C(pl.hand[i])));
  if (!idxs.length) return null;
  return ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: idxs, prompt });
}
async function pickZoneIdx(ctx, who, zone, pred, prompt) {
  const pl = ctx.state.players[who];
  const idxs = pl[zone].map((id, i) => i).filter(i => pred(pl[zone][i], C(pl[zone][i])));
  if (!idxs.length) return null;
  return ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
}
// pick one card from an arbitrary id list (temp zone trick so the stock picker UI works)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s12tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's12tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s12tmp; }
}
function del(state, p, st, self) { return S.deleteStack(state, p, st.uid, 'trash', p === self ? 'ownEffect' : 'effect'); }
// compile + run one printed sentence (or several) of this very card with the generic compiler (keeps the wording next to the code)
async function run(ctx, R, text) {
  const Fx = await import('../effects.js');
  await R.runScript(Fx.compileToScript(text), ctx);
}

// ---- copied from shard5: evolution / jogress helpers ----
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
  return S.fuseStacks(state, who, pair[0].uid, pair[1].uid, id, j ? j.cost : 0, 'hand');
}

// "N장까지": the UI's hand multi-pick needs an exact count, so ask for the number first
async function pickUpTo(ctx, who, max, prompt) {
  if (max <= 0) return 0;
  const k = await ctx.choose('multipleChoice', { player: who, prompt, options: Array.from({ length: max + 1 }, (_, i) => `${i}장`) });
  return typeof k === 'number' && k >= 0 && k <= max ? k : 0;
}
async function discardUpTo(ctx, who, max, prompt) {
  const pl = ctx.state.players[who];
  const n = await pickUpTo(ctx, who, Math.min(max, pl.hand.length), prompt);
  if (!n) return 0;
  const chosen = await ctx.choose('pickFromHandIndexes', { player: who, eligibleIdxs: pl.hand.map((_, i) => i), n, prompt: `파기할 패 ${n}장 선택` });
  const idxs = [...(chosen || [])].sort((a, b) => b - a);
  for (const i of idxs) S.trashFromHand(ctx.state, who, i);
  return idxs.length;
}
async function destroyEither(ctx, pred, prompt, kinds = ['digimon']) {
  const { state } = ctx, entries = [];
  for (const p of ['p1', 'p2']) for (const s of state.players[p].battle) if (kinds.includes(C(s.cardId).category) && pred(s, p)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return null;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt });
  if (!pick) return null;
  const st = findStack(state, pick.player, pick.uid);
  if (!st) return null;
  del(state, pick.player, st, ctx.self);
  return st;
}
const dpOf = (state, p, st) => S.effectiveDP(state, p, st);

// ================================================================== ST17 / EX6
sc('ST17-09::진화 시', async (ctx, R) => {
  await destroyEither(ctx, (s) => lvOf(s.cardId) <= 4, 'Lv.4 이하의 디지몬 1마리 소멸 (안 해도 됨)');
  await run(ctx, R, '자신의 패/트래시에서 Lv.4 이하의 그린/퍼플인 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.');
});
sc('ST17-13::진화 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '진화원을 파기할 상대의 디지몬 선택');
  if (t) { const n = S.stackColors(t).length; if (n > 0) S.trashEvoSources(state, o, t.uid, n, 'top'); }
  await run(ctx, R, '진화원을 갖지 않은 상대의 디지몬 1마리를 패로 되돌린다.');
});
sc('EX6-058::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), all = digs(state, o);
  if (!all.length) return;
  const min = Math.min(...all.map(s => dpOf(state, o, s)));
  const t = await pickStack(ctx, o, all.filter(s => dpOf(state, o, s) === min), '소멸시킬 가장 DP가 낮은 상대의 디지몬 선택');
  if (!t) return;
  const lv = lvOf(t.cardId);
  del(state, o, t, ctx.self);
  if (!findStack(state, o, t.uid) && lv > 0) S.trashTopOfDeck(state, ctx.self, lv);
});
alias('EX6-058::진화 시', 'EX6-058::등장 시');
sc('EX6-060::등장 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  const k = await discardUpTo(ctx, ctx.self, 3, '패를 몇 장 파기할까요? (3장까지)');
  for (let i = 0; i < k; i++) {
    const t = await pickStack(ctx, o, digs(state, o).filter(s => lvOf(s.cardId) <= 5), '레스트시킬 Lv.5 이하의 상대의 디지몬 선택');
    if (!t) break;
    S.restStack(state, o, t.uid);
  }
  await run(ctx, R, '가장 등장 코스트가 낮은 레스트 상태인 상대의 디지몬 전부를 소멸시킨다.');
});
alias('EX6-060::진화 시', 'EX6-060::등장 시');
sc('EX6-073::어택 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), pl = state.players[ctx.self], st = me(ctx);
  if (!st) return;
  const fd = S.fdCount(st);
  const byName = new Map();
  st.sources.forEach((id, i) => { if (i >= fd && trait(id, '7대마왕') && !byName.has(C(id).nameKo)) byName.set(C(id).nameKo, i); });
  if (byName.size < 7) { S.log(state, '진화원에 명칭이 서로 다른 「7대마왕」 카드가 7장 없어 비용을 지불할 수 없음'); return; }
  if (!(await ask(ctx, '진화원의 「7대마왕」 7장(명칭이 서로 다름)을 덱 아래로 되돌리고 효과를 발휘할까요?'))) return;
  const idxs = [...byName.values()].sort((a, b) => b - a), ids = [];
  for (const i of idxs) ids.unshift(...st.sources.splice(i, 1));
  pl.deck.push(...ids);
  S.recomputeStackGrants(st);
  let k = 0;
  for (let i = 0; i < 7; i++) {
    const t = await pickStack(ctx, o, [...digs(state, o), ...tams(state, o)], '소멸시킬 상대의 디지몬/테이머 선택');
    if (!t) break;
    del(state, o, t, ctx.self);
    if (!findStack(state, o, t.uid)) k++;
  }
  for (let i = 0; i < Math.max(0, 7 - k); i++) S.trashTopSecurityByEffect(state, o);
});

// ================================================================== BT17 / EX7
sc('BT17-063::진화 시', async (ctx, R) => {
  await run(ctx, R, '《1 드로우》하고, 자신의 패 1장을 파기한다.');
  const st = me(ctx);
  if (!st || !st.sources.some(id => nameIs(id, '히포그리포몬'))) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { exactAny: ['무르무크스몬'], category: 'digimon' }, cost: { mode: 'fixed', n: 2 }, ignoreCond: true, ignoreLevel: false }, ctx);
});
sc('BT17-067::어택 종료 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const mine = await pickStack(ctx, ctx.self, digs(state, ctx.self), '선택할 자신의 디지몬 (안 해도 됨)');
  if (!mine) return;
  const lv = lvOf(mine.cardId);
  const t = await pickStack(ctx, o, digs(state, o).filter(s => lvOf(s.cardId) <= lv), `소멸시킬 Lv.${lv} 이하의 상대의 디지몬 선택`);
  del(state, ctx.self, mine, ctx.self);
  if (t) del(state, o, t, ctx.self);
});
sc('BT17-074::진화 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  if (state.activePlayer !== ctx.self) return;
  const idx = await pickHandIdx(ctx, ctx.self, (id, c) => (c.category === 'digimon' && c.level <= 5 && nameIs(id, '에오스몬')) || (c.category === 'tamer' && colorOf(id, 'white') && (c.cost || 0) <= 4), '등장 코스트 2로 등장시킬 카드 선택');
  if (idx == null) return;
  S.spendMemory(state, 2);
  const st = S.playDigimonFresh(state, ctx.self, idx);
  if (!st) return;
  const i2 = await pickHandIdx(ctx, o, (id, c) => c.category === 'tamer', '코스트를 지불하지 않고 등장시킬 테이머 카드 선택 (안 해도 됨)');
  if (i2 != null) S.playFreeFromZone(state, o, 'hand', i2, {});
});
sc('BT17-077::등장 시', async (ctx, R) => {
  const { state } = ctx;
  await run(ctx, R, '상대의 디지몬 전부의 진화원을 전부 파기한다.');
  let white7 = false;
  for (const p of [ctx.self, opp(ctx.self)]) {
    const pl = state.players[p];
    if (pl.trash.some(id => colorOf(id, 'white') && lvOf(id) === 7)) white7 = true;
    pl.deck.push(...pl.trash); pl.trash = [];
    S.log(state, `${p} 트래시의 카드 전부를 덱 아래로 되돌림`);
  }
  if (white7) S.grantMemory(state, ctx.self, 3, ctx.sourceCardId);
});
alias('BT17-077::진화 시', 'BT17-077::등장 시');
sc('BT17-094::메인', async (ctx, R) => {
  const { state } = ctx;
  await run(ctx, R, '자신의 트래시에서 특징으로 「하이브리드체」/「10투사」를 가진 디지몬 카드 1장을 패로 되돌릴 수 있다.');
  const idx = await pickHandIdx(ctx, ctx.self, (id, c) => (c.category === 'digimon' && trait(id, '10투사')) || (c.category === 'tamer' && !!(c.inheritedKo || '').trim()), '등장 코스트 -4로 등장시킬 카드 선택');
  if (idx == null) return;
  const cost = Math.max(0, (C(state.players[ctx.self].hand[idx]).cost || 0) - 4);
  if (cost > 0) S.spendMemory(state, cost);
  S.playDigimonFresh(state, ctx.self, idx);
});
sc('BT17-101::진화 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  await run(ctx, R, '턴 종료까지 상대의 디지몬 1마리를 DP -16000.');
  if (st && st.viaFusion && await ask(ctx, '메모리를 상대 쪽의 3으로 할까요?')) { state.memory = ctx.self === 'p1' ? -3 : 3; S.log(state, `${ctx.self} 메모리를 상대 쪽의 3으로 설정`); }
  if (st && st.sources.some(id => C(id).category === 'tamer')) await run(ctx, R, '《리커버리 +1《덱》》하고, 메모리 +1.');
});
sc('EX7-034::진화 시', async (ctx) => {
  const { state } = ctx;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of digs(state, p)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 디지몬 1마리 선택 (안 해도 됨)' });
  if (!pick) return;
  const t = findStack(state, pick.player, pick.uid);
  if (!t) return;
  const was = t.suspended;
  S.restStack(state, pick.player, t.uid);
  const st = me(ctx);
  if (pick.player === ctx.self && !was && t.suspended && st) S.grantShield(state, ctx.self, st.uid, { kinds: ['all'], fromCategory: 'digimon', until: oppTurnEnd(state, ctx.self) });
});
sc('EX7-044::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self], o = opp(ctx.self), st = me(ctx);
  const revealed = S.revealTop(state, ctx.self, 4);
  if (!revealed.length) return;
  const eligible = revealed.map((id, i) => ({ id, i })).filter(x => C(x.id).category === 'option' && trait(x.id, '3총사'));
  const chosen = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed, eligible, min: 0, max: 1, prompt: '공개된 카드 중 「3총사」 옵션 카드 1장을 진화원 아래에 놓기' });
  const idx = (chosen || [])[0];
  const top = pl.deck.splice(0, revealed.length);
  let placed = null;
  if (idx != null && st && eligible.some(x => x.i === idx)) { placed = top.splice(idx, 1)[0]; st.sources.splice(S.fdCount(st), 0, placed); S.recomputeStackGrants(st); S.log(state, `${ctx.self} ${C(placed).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`); }
  if (top.length) {
    const k = await ctx.choose('multipleChoice', { prompt: '나머지를 덱 위 또는 아래로 되돌립니다', options: ['덱 위', '덱 아래'] });
    const ord = await S.orderPlacement(ctx.choose, ctx.self, top, '되돌릴 카드의 순서를 정하세요');
    if (k === 1) pl.deck.push(...ord); else pl.deck.unshift(...ord);
  }
  if (!placed) return;
  const t = await pickStack(ctx, o, [...digs(state, o), ...tams(state, o)].filter(s => (C(s.cardId).cost || 0) <= 3), '소멸시킬 등장 코스트 3 이하의 상대의 디지몬/테이머 선택');
  if (t) del(state, o, t, ctx.self);
});
alias('EX7-044::진화 시', 'EX7-044::등장 시');
// ST19-11/15: 디지몬이 3마리 이상 있다면 이 DP 마이너스 효과의 수치를 추가로 낮춘다 (자신의 디지몬 수)
const dpMinus = (base, ext) => async (ctx, R) => {
  const amount = base - (digs(ctx.state, ctx.self).length >= 3 ? ext : 0);
  await R.runOne({ op: 'modifyDP', target: 'opponent', amount, duration: 'turn' }, ctx);
};
sc('ST19-11::등장 시', dpMinus(-3000, 3000));
alias('ST19-11::진화 시', 'ST19-11::등장 시');
sc('ST19-15::메인', dpMinus(-6000, 6000));

// ================================================================== BT18 / P- / BT19 / EX8 / BT20
// move a whole stack under another stack's sources (bottom) — copied from shard5
function putStackUnder(state, p, moving, target) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(moving);
  if (i >= 0) pl.battle.splice(i, 1);
  else if (pl.raising === moving) pl.raising = null;
  pl.trash.push(...(moving.linkCards || []).map(l => l.cardId));
  target.sources.splice(S.fdCount(target), 0, ...moving.sources, moving.cardId);
  S.recomputeStackGrants(target);
}
// play a card for free from hand and/or trash (asks for the zone when both have candidates)
async function playFreeHandTrash(ctx, who, pred, prompt, zones = ['hand', 'trash']) {
  const pl = ctx.state.players[who];
  const ok = (z) => pl[z].map((id, i) => i).filter(i => C(pl[z][i]).category !== 'option' && pred(pl[z][i], C(pl[z][i])));
  const zs = zones.filter(z => ok(z).length);
  if (!zs.length) return null;
  let z = zs[0];
  if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '카드를 등장시킬 위치', options: zs.map(x => (x === 'hand' ? '패' : '트래시')) }); if (k == null) return null; z = zs[k] || zs[0]; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: z, eligibleIdxs: ok(z), prompt });
  if (idx == null) return null;
  return S.playFreeFromZone(ctx.state, who, z, idx, {});
}
// play one of `stack`'s face-up evolution cards for free (moved through the owner's trash)
function playFromStackSource(ctx, who, stack, srcIdx) {
  const pl = ctx.state.players[who];
  const [id] = stack.sources.splice(srcIdx, 1);
  S.recomputeStackGrants(stack);
  pl.trash.push(id);
  return S.playFreeFromZone(ctx.state, who, 'trash', pl.trash.length - 1, { fromSources: true });
}
const faceUpSources = (st) => st.sources.map((id, i) => ({ id, i })).filter(x => x.i >= S.fdCount(st));

sc('BT18-096::메인', async (ctx) => {
  const { state } = ctx;
  await evolveAny(ctx, { stacks: [...digs(state, ctx.self), ...tams(state, ctx.self)], zones: ['hand', 'trash'], pred: (c) => c.nameKo === '스사노오몬', cost: { mode: 'free' }, ignoreCond: true, prompt: '진화할 「스사노오몬」 선택' });
  const host = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => S.cardNameIs(s.cardId, '스사노오몬')), '테이머를 진화원 아래에 놓을 「스사노오몬」 선택');
  if (!host) return;
  const used = new Set();
  for (let i = 0; i < 4; i++) {
    const cands = tams(state, ctx.self).filter(t => t !== host && S.stackColors(t).every(c => !used.has(c)));
    const t = await pickStack(ctx, ctx.self, cands, '진화원 아래에 놓을 색이 서로 다른 테이머 선택 (안 해도 됨)');
    if (!t) break;
    S.stackColors(t).forEach(c => used.add(c));
    putStackUnder(state, ctx.self, t, host);
    S.grantMemory(state, ctx.self, 1, ctx.sourceCardId);
  }
});
sc('P-158::메인', async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  if (!st || !(await ask(ctx, '이 테이머를 덱 아래로 되돌리고 효과를 발휘할까요?'))) return;
  await R.runOne({ op: 'returnToHandStripSources', target: 'self', thisStack: true, dest: 'deckBottom', filter: {} }, ctx);
  if (state.players[ctx.self].battle.includes(st)) return;
  const bonus = Math.max(0, ...digs(state, ctx.self).filter(s => S.cardNameIs(s.cardId, '마더 디·리퍼')).map(s => s.sources.length));
  await playFreeHandTrash(ctx, ctx.self, (id, c) => c.category === 'digimon' && trait(id, '디·리퍼') && (c.cost || 0) <= 3 + bonus, `등장 코스트 ${3 + bonus} 이하의 「디·리퍼」 디지몬 선택`, ['hand']);
});
sc('P-156::메인', async (ctx) => {
  const { state } = ctx, entries = [];
  for (const p of ['p1', 'p2']) for (const s of tams(state, p)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '테이머 1명 선택' });
  const t = pick && findStack(state, pick.player, pick.uid);
  if (!t) return;
  const cols = S.stackColors(t);
  await playFreeHandTrash(ctx, ctx.self, (id, c) => c.category === 'digimon' && (c.cost || 0) <= 3 && colorOf(id, ...cols), '선택한 테이머와 같은 색의 등장 코스트 3 이하의 디지몬 선택');
});
sc('BT19-025::어택 시', async (ctx, R) => {
  await run(ctx, R, '상대의 디지몬 1마리를 《퇴화 1》.');
  const st = me(ctx);
  if (st) await evolveInto(ctx, { stack: st, zones: ['tamerUnder'], pred: (c, id) => trait(id, '블루 플레어'), cost: { mode: 'free' }, prompt: '테이머 아래의 「블루 플레어」 디지몬 카드로 진화 (안 해도 됨)' });
});
sc('BT19-037::등장 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  if (state.activePlayer === ctx.self) { await R.runOne({ op: 'useOptionFree', who: 'self', filter: { category: 'option', costMax: 5, colorCount: 1 }, optional: true }, ctx); return; }
  const t = await pickStack(ctx, o, digs(state, o), '《S 어택 -1》을 줄 상대의 디지몬 선택');
  if (!t || S.effectBlocked(state, o, t, 'other')) return;
  S.grantKeyword(state, o, t.uid, '시큐리티어택', -1, 'turn');
  t.noEvoTrigUntil = state.turnNumber;
});
alias('BT19-037::진화 시', 'BT19-037::등장 시');
sc('BT19-063::등장 시', async (ctx, R) => {
  await run(ctx, R, '상대의 디지몬 1마리를 《퇴화 1》.');
  const st = me(ctx);
  if (st && (st.xrosCount || 0) >= 2) await destroyEither(ctx, (s) => (C(s.cardId).cost || 0) <= 3, '소멸시킬 등장 코스트 3 이하의 디지몬/테이머 선택 (안 해도 됨)', ['digimon', 'tamer']);
});
alias('BT19-063::진화 시', 'BT19-063::등장 시');
sc('BT19-098::메인', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const i = await pickZoneIdx(ctx, ctx.self, 'trash', (id, c) => c.category === 'option' && trait(id, '디바이스') && c.cost === 3, '배틀 에어리어에 놓을 「디바이스」 옵션 카드 선택');
  if (i != null) S.placeThisInBattle(state, ctx.self, pl.trash[i]);
  await R.runOne({ op: 'placeThisInBattle' }, ctx);
});
sc('BT19-098::시큐리티', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const i = await pickHandIdx(ctx, ctx.self, (id, c) => c.category === 'option' && trait(id, '디바이스'), '배틀 에어리어에 놓을 「디바이스」 옵션 카드 선택 (안 해도 됨)');
  if (i != null) { const [id] = pl.hand.splice(i, 1); pl.trash.push(id); S.placeThisInBattle(state, ctx.self, id); }
  await R.runOne({ op: 'addSelfToHand' }, ctx);
});
sc('BT19-102::등장 시', async (ctx) => {
  const { state } = ctx, entries = [];
  for (const p of ['p1', 'p2']) for (const s of digs(state, p)) if (s.uid !== ctx.sourceStackUid && faceUpSources(s).some(x => C(x.id).category === 'digimon' && lvOf(x.id) <= 4)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '진화원에서 Lv.4 이하의 디지몬을 등장시키고 소멸시킬 다른 디지몬 선택' });
  const t = pick && findStack(state, pick.player, pick.uid);
  if (!t || !(await ask(ctx, `${C(t.cardId).nameKo}의 진화원에서 Lv.4 이하의 디지몬 카드를 등장시키고 그 디지몬을 소멸시킬까요?`))) return;
  const cands = faceUpSources(t).filter(x => C(x.id).category === 'digimon' && lvOf(x.id) <= 4);
  const k = await pickFromList(ctx, ctx.self, cands.map(x => x.id), cands.map((_, i) => i), '등장시킬 진화원의 카드 선택');
  if (k == null) return;
  if (!playFromStackSource(ctx, ctx.self, t, cands[k].i)) return;
  del(state, pick.player, t, ctx.self);
});
alias('BT19-102::진화 시', 'BT19-102::등장 시');
sc('EX8-029::진화 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  let left = 14;
  const chosen = [];
  for (;;) {
    const opts = digs(state, o).filter(s => !chosen.includes(s) && (C(s.cardId).cost || 0) <= left);
    const t = await pickStack(ctx, o, opts, `덱 아래로 되돌릴 디지몬 선택 (남은 등장 코스트 합계 ${left})`);
    if (!t) break;
    chosen.push(t); left -= C(t.cardId).cost || 0;
  }
  for (const t of chosen) { ctx._lastPick = { player: o, uid: t.uid }; await R.runOne({ op: 'returnToHandStripSources', last: true, dest: 'deckBottom' }, ctx); }
  const st = me(ctx);
  if (!st || !st.viaFusion) return;
  let budget = 12;
  for (;;) {
    const cands = faceUpSources(st).filter(x => trait(x.id, 'DS') && (C(x.id).cost || 0) <= budget && C(x.id).category !== 'option');
    const k = await pickFromList(ctx, ctx.self, cands.map(x => x.id), cands.map((_, i) => i), `코스트 없이 등장시킬 「DS」 카드 선택 (남은 합계 ${budget}, 안 해도 됨)`);
    if (k == null) break;
    budget -= C(cands[k].id).cost || 0;
    playFromStackSource(ctx, ctx.self, st, cands[k].i);
  }
});
sc('EX8-044::등장 시', async (ctx) => {
  const { state } = ctx;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const entries = [];
    for (const p of ['p1', 'p2']) for (const s of digs(state, p)) if (!s.suspended) entries.push({ player: p, uid: s.uid });
    if (!entries.length) break;
    const pick = await ctx.choose('pickStackAnySide', { entries, prompt: `레스트시킬 디지몬 선택 (${i + 1}/3, 안 해도 됨)` });
    const t = pick && findStack(state, pick.player, pick.uid);
    if (!t) break;
    S.restStack(state, pick.player, t.uid);
    if (t.suspended && pick.player !== ctx.self) n++;
  }
  if (n > 0) S.grantMemory(state, ctx.self, n, ctx.sourceCardId);
});
alias('EX8-044::진화 시', 'EX8-044::등장 시');
sc('BT20-018::등장 시', async (ctx, R) => {
  const { state } = ctx, r = state.players[ctx.self].raising;
  await run(ctx, R, '상대의 디지몬 1마리를 《퇴화 2》.');
  if (!state.attackCtx || state.attackCtx.attacker !== ctx.self || !r || !isDig(r)) return;
  await evolveInto(ctx, { stack: r, zones: ['hand', 'trash'], pred: (c, id) => trait(id, '크로니클') && c.level <= 6, cost: { mode: 'free' }, prompt: '육성 에어리어의 디지몬을 진화시킬 「크로니클」 카드 선택 (안 해도 됨)' });
});
alias('BT20-018::진화 시', 'BT20-018::등장 시');
sc('BT19-080::자신의 턴', async (ctx) => {
  const { state } = ctx, uid = ctx.trigger?.evtStackUid, t = uid && findStack(state, ctx.self, uid);
  if (!t) return;
  S.grantKeyword(state, ctx.self, t.uid, '돌진', undefined, 'turn');
  if (!t.suspended && S.canAttackPlayer(state, ctx.self, t.uid) && ctx.startAttack) ctx.startAttack(ctx.self, t.uid, 'PLAYER');
});

// ================================================================== 《딜레이》 options, leave triggers, attack-redirect
const H = (id, d) => { (HOOKS[id] ||= []).push(d); };
// 16-17 《딜레이》: usable from the turn after this option was placed; discards it, then the bullet effect runs
async function delayGate(ctx) {
  const st = me(ctx);
  if (!st || C(st.cardId).category !== 'option' || ctx.state.turnNumber <= st.placedTurn) return false;
  if (!(await ask(ctx, '《딜레이》 — 이 카드를 파기하고 효과를 발휘할까요?'))) return false;
  S.discardForDelay(ctx.state, ctx.self, st.uid);
  return true;
}
const evtOf = (ctx) => ctx.trigger?.evt || null;
// the leaving stack's evolution cards are already in the owner's trash (evt.sources): candidates that are still there
const leftSources = (ctx, pred) => { const evt = evtOf(ctx); const pl = ctx.state.players[ctx.self]; return evt ? evt.sources.filter(id => pl.trash.includes(id) && pred(id)) : []; };
async function playLeftSource(ctx, ids, prompt) {
  const pl = ctx.state.players[ctx.self];
  const k = await pickFromList(ctx, ctx.self, ids, ids.map((_, i) => i), prompt);
  if (k == null) return null;
  const i = pl.trash.lastIndexOf(ids[k]);
  return i >= 0 ? S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true }) : null;
}

// LM-027..032 (자신의 턴 개시 시): 상대의 디지몬이 있다면 《딜레이》
const LM_COLOR = { 'LM-027': 'red', 'LM-028': 'blue', 'LM-029': 'yellow', 'LM-030': 'green', 'LM-031': 'black', 'LM-032': 'purple' };
for (const [id, col] of Object.entries(LM_COLOR)) {
  sc(`${id}::자신의 턴 개시 시`, async (ctx) => {
    const { state } = ctx, pl = state.players[ctx.self];
    if (!digs(state, opp(ctx.self)).length) return;
    if (!(await delayGate(ctx))) return;
    const i = await pickZoneIdx(ctx, ctx.self, 'trash', (cid, c) => c.category === 'digimon' && colorOf(cid, col), '덱 위로 되돌릴 디지몬 카드 선택');
    if (i != null) { const [cid] = pl.trash.splice(i, 1); pl.deck.unshift(cid); S.log(state, `${ctx.self} 트래시의 ${C(cid).nameKo}을(를) 덱 위로 되돌림`); }
    if (!digs(state, ctx.self).length) await playFreeHandTrash(ctx, ctx.self, (cid, c) => c.category === 'digimon' && colorOf(cid, col) && (c.dp || 0) <= 2000, '코스트 없이 등장시킬 DP 2000 이하의 디지몬 선택 (안 해도 됨)', ['trash']);
  });
}

// EX6-065: 자신의 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 《딜레이》 — 그 디지몬의 진화원에서 「Legend-Arms」 카드 1장을 등장
H('EX6-065', { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', events: { leaveBattle: (state, hp, h, info) => info.owner === hp && info.cause !== 'ownEffect' && C(h.cardId).category === 'option' } });
sc('EX6-065::서로의 턴', async (ctx) => {
  const ids = leftSources(ctx, (id) => trait(id, 'Legend-Arms') && C(id).category !== 'option');
  if (!ids.length || !(await delayGate(ctx))) return;
  await playLeftSource(ctx, ids, '코스트 없이 등장시킬 「Legend-Arms」 카드 선택 (안 해도 됨)');
});
// EX6-068: 「천사형」/「대천사형」 자신의 디지몬이 소멸했을 때, 《딜레이》 — 시큐리티를 전부 확인, 「3대천사」 디지몬 1장 등장, 시큐리티 셔플
H('EX6-068', { tag: '서로의 턴', has: '소멸했을 때', events: { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'digimon' && trait(info.stack.cardId, '천사형', '대천사형') && C(h.cardId).category === 'option' } });
sc('EX6-068::서로의 턴', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!(await delayGate(ctx))) return;
  await R.runOne({ op: 'lookSecurity', who: 'self' }, ctx);
  const idxs = pl.security.map((id, i) => i).filter(i => C(pl.security[i]).category === 'digimon' && trait(pl.security[i], '3대천사'));
  const k = await pickFromList(ctx, ctx.self, pl.security, idxs, '코스트 없이 등장시킬 「3대천사」 디지몬 선택 (안 해도 됨)');
  if (k != null) {
    const [id] = pl.security.splice(k, 1);
    if (pl.secUp) S.secFaceUpTake(pl, id);
    pl.trash.push(id);
    S.playFreeFromZone(state, ctx.self, 'trash', pl.trash.length - 1, {});
  }
  await R.runOne({ op: 'shuffleSecurity', who: 'self' }, ctx);
});
// EX6-069: 「7대마왕」 자신의 디지몬이 소멸했을 때, 《딜레이》 — 육성 에어리어의 「대죄의 문」의 진화원에서 「7대마왕」 디지몬 1장 등장
H('EX6-069', { tag: '서로의 턴', has: '소멸했을 때', events: { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'digimon' && trait(info.stack.cardId, '7대마왕') && C(h.cardId).category === 'option' } });
sc('EX6-069::서로의 턴', async (ctx) => {
  const { state } = ctx, r = state.players[ctx.self].raising;
  if (!r || !S.cardNameIs(r.cardId, '대죄의 문')) return;
  const cands = faceUpSources(r).filter(x => C(x.id).category === 'digimon' && trait(x.id, '7대마왕'));
  if (!cands.length || !(await delayGate(ctx))) return;
  const k = await pickFromList(ctx, ctx.self, cands.map(x => x.id), cands.map((_, i) => i), '코스트 없이 등장시킬 「7대마왕」 디지몬 선택 (안 해도 됨)');
  if (k != null) playFromStackSource(ctx, ctx.self, r, cands[k].i);
});
// BT18-099: 어택의 대상이 변경되었을 때, 《딜레이》 — 자신의 턴 종료까지 자신의 디지몬 1마리는 《관통》과 《S 어택 +1》
H('BT18-099', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때', events: { redirect: (state, hp, h) => C(h.cardId).category === 'option' } });
sc('BT18-099::서로의 턴', async (ctx) => {
  const { state } = ctx;
  const t = digs(state, ctx.self).length ? null : false;
  if (t === false) return;
  if (!(await delayGate(ctx))) return;
  const d = await pickStack(ctx, ctx.self, digs(state, ctx.self), '《관통》과 《S 어택 +1》을 얻을 자신의 디지몬 선택');
  if (!d) return;
  const dur = state.activePlayer === ctx.self ? 'turn' : 'opponentTurn'; // 자신의 턴 종료까지
  S.grantKeyword(state, ctx.self, d.uid, '관통', undefined, dur);
  S.grantKeyword(state, ctx.self, d.uid, '시큐리티어택', 1, dur);
});
// BT19-099: 「밀레니엄몬」을 포함하는 자신의 디지몬이 배틀 에어리어를 벗어날 때, 《딜레이》 — 그 디지몬보다 등장 코스트가 1 높은 「사신형」 디지몬을 등장
H('BT19-099', { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', events: { leaveBattle: (state, hp, h, info) => info.owner === hp && C(info.cardId).category === 'digimon' && nameHas(info.cardId, '밀레니엄몬') && C(h.cardId).category === 'option' } });
sc('BT19-099::서로의 턴', async (ctx) => {
  const evt = evtOf(ctx); if (!evt) return;
  const want = (C(evt.cardId).cost || 0) + 1, pl = ctx.state.players[ctx.self];
  const pred = (id, c) => c.category === 'digimon' && trait(id, '사신형') && (c.cost || 0) === want;
  if (![...pl.hand, ...pl.trash].some(id => pred(id, C(id))) || !(await delayGate(ctx))) return;
  await playFreeHandTrash(ctx, ctx.self, pred, `등장 코스트 ${want}의 「사신형」 디지몬 선택 (안 해도 됨)`);
});
// BT19-078 (진화원 효과, 상대의 턴): 상대의 디지몬이 어택했을 때, 진화원의 「ADR-01=쥬리」 1장 등장, 그랬다면 어택의 대상을 그 디지몬으로 변경할 수 있다
H('BT19-078', { tag: '상대의 턴', src: 'inheritedKo', has: 'ADR-01=쥬리', events: { attack: (state, hp, h, info) => info.owner !== hp } });
sc('BT19-078::상대의 턴', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (!st) return;
  const cands = faceUpSources(st).filter(x => S.cardNameIs(x.id, 'ADR-01=쥬리'));
  if (!cands.length || !(await ask(ctx, '진화원의 「ADR-01=쥬리」를 코스트 없이 등장시킬까요?'))) return;
  const played = playFromStackSource(ctx, ctx.self, st, cands[0].i);
  const pa = ctx.attack && ctx.attack();
  if (played && pa && pa.targetKind && await ask(ctx, '어택의 대상을 등장한 디지몬으로 변경할까요?')) { pa.targetKind = 'digimon'; pa.targetUid = played.uid; pa.chargeTarget = null; S.log(state, `${ctx.self} 어택의 대상이 ${C(played.cardId).nameKo}(으)로 변경됨`); }
});

// 디지크로스 leave abilities: 이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 Lv.4 이하의 <조건> 디지몬 카드 1장을 (패로 되돌리거나,) 코스트를 지불하지 않고 등장시킬 수 있다
const LEAVE = {
  'BT18-017': { pred: (id) => colorOf(id, 'red'), bounce: true },
  'BT18-029': { pred: (id) => colorOf(id, 'blue'), bounce: true },
  'BT18-055': { pred: (id) => colorOf(id, 'green'), bounce: true },
  'BT18-074': { pred: (id) => colorOf(id, 'black'), bounce: true },
  'BT18-054': { pred: (id) => traitIncl(id, '조', '새', '병아리', '요정') || trait(id, '하이브리드체') },
  'BT18-084': { pred: (id) => trait(id, '마수형', '환수형', '하이브리드체') },
};
for (const [id, o] of Object.entries(LEAVE)) {
  H(id, { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', onLeave: () => true });
  sc(`${id}::서로의 턴@배틀 에어리어를 벗어날 때`, async (ctx) => {
    const ids = leftSources(ctx, (cid) => C(cid).category === 'digimon' && lvOf(cid) <= 4 && o.pred(cid));
    if (!ids.length) return;
    const pl = ctx.state.players[ctx.self];
    let mode = 1;
    if (o.bounce) { mode = await ctx.choose('multipleChoice', { prompt: '진화원의 카드를 어떻게 할까요? (선택 취소 = 하지 않음)', options: ['패로 되돌린다', '코스트를 지불하지 않고 등장시킨다'] }); if (mode == null) return; }
    if (mode === 0) {
      const k = await pickFromList(ctx, ctx.self, ids, ids.map((_, i) => i), '패로 되돌릴 진화원의 카드 선택');
      if (k == null) return;
      const i = pl.trash.lastIndexOf(ids[k]);
      if (i >= 0) { pl.trash.splice(i, 1); pl.hand.push(ids[k]); S.log(ctx.state, `${ctx.self} 트래시의 ${C(ids[k]).nameKo}을(를) 패로`); }
    } else await playLeftSource(ctx, ids, '코스트 없이 등장시킬 진화원의 카드 선택 (안 해도 됨)');
  });
}

// BT18-098: "…하는 것으로, … DP -6000. 그 후, 자신의 시큐리티가 2장 이하라면, 이 카드를 시큐리티 아래에 놓는다." (앞면 지정 없음 = 뒷면)
sc('BT18-098::메인', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  await R.runOne({ op: 'costGroup', cost: [{ op: 'removeSecurity', who: 'self', position: 'top' }], then: [
    { op: 'modifyDP', target: 'opponent', amount: -6000, duration: 'opponentTurn' },
    { op: 's12_fn', fn: async (c) => {
      if (pl.security.length > 2) return;
      const i = pl.trash.lastIndexOf(c.sourceCardId);
      if (i < 0) return;
      pl.trash.splice(i, 1);
      S.addToSecurity(state, c.self, c.sourceCardId, 'bottom');
    } },
  ] }, ctx);
});
