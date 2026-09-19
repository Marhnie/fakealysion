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
