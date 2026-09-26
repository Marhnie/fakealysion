// Shard 14 — dropped-sentence audit, batch 5 (BT24/BT25/BT26/EX11/EX12/AD1/ST22-24/P-xxx cards whose compiled script silently lost a sentence).
//  SCRIPTS  per-card scripts (key = 'CARD-ID::firstTag'); most reuse the generic compiler for the sentences it already understands (T('printed sentence'))
//           and add ops only for the sentence that used to be dropped, so the printed ORDER and 「그 후」 conditions are kept.
//  OPS      n5_* ops. n5_link / n5_jogressPair / n5_playPaid / n5_playSum / n5_battle are ALSO emitted by the generic compiler
//           (effects.js compileTailSentences); the rest are per-card helpers.
// effects.js imports cards/index.js, so nothing from effects.js may be CALLED at load time (FX_HELPERS / compileToScript only inside functions).
import * as S from '../state.js';
import { FX_HELPERS, compileToScript } from '../effects.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const isDig = (id) => C(id).category === 'digimon';
const isTam = (id) => C(id).category === 'tamer';
const trait = (id, ...ts) => (C(id).types || []).some(t => ts.includes(t));
const nameHas = (id, ...ns) => ns.some(n => C(id).nameKo.includes(n));
const log = (ctx, msg) => S.log(ctx.state, msg);
const P = (ctx, who = 'self') => ctx.state.players[who === 'opp' ? ctx.opp : ctx.self];
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const meS = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const digs = (ctx, who = 'self') => P(ctx, who).battle.filter(s => S.isDigimonLike(s));
const oppEnd = (ctx) => (ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber);
const ask = async (ctx, prompt, who) => !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt }));
async function pickS(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
async function pickZ(ctx, who, zone, idxs, prompt) {
  if (!idxs.length) return null;
  const r = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return r == null ? null : r;
}
const mf = (id, filter) => FX_HELPERS.matchesFilter(S, id, filter || null);

// script builders: T(printed sentence) = compile that sentence with the generic compiler at run time; X(fn) = arbitrary JS step; IF(cond, then, else)
const T = (text) => ({ op: 'n5_c', text });
const X = (fn) => ({ op: 'n5_fn', fn });
const IF = (cond, then, els) => ({ op: 'n5_if', cond, then, else: els || [] });
OPS.n5_c = async (i, ctx, run) => { await run.runScript(compileToScript(i.text), ctx); };
OPS.n5_fn = async (i, ctx, run) => { await i.fn(ctx, run); };
OPS.n5_if = async (i, ctx, run) => {
  const ok = typeof i.cond === 'function' ? await i.cond(ctx) : await FX_HELPERS.condTestFor(i.cond)(ctx);
  await run.runScript(ok ? i.then : i.else, ctx);
};
// run another card's bespoke script (same effect text on a sibling card)
OPS.n5_run = async (i, ctx, run) => {
  const { lookupCardSpecific } = await import('../effects.js');
  const sc = lookupCardSpecific(i.id, [i.tag]);
  if (sc) await run.runScript(sc, ctx);
};

// ------------------------------------------------------------------ generic ops emitted by the compiler
// { thisCard, zones:['hand'|'trash'|'sources'], filter, free, host:'this'|'pick', max } — link cards onto an own Digimon (delegates to shard8's s8_link)
OPS.n5_link = async (i, ctx, run) => {
  const cardId = ctx.sourceCardId;
  const pred = (id) => (i.thisCard ? id === cardId : mf(id, i.filter));
  await run.runOne({ op: 's8_link', from: i.zones || ['hand'], sourcesOf: 'this', pred, target: i.host === 'this' ? 'this' : 'pickOwn', free: !!i.free, max: i.max || 1, allowOption: true }, ctx);
};
// "자신의 디지몬 2마리로 패의 「X」로 조그레스 진화할 수 있다" — any two own Digimon (optional: cancel a pick to decline)
OPS.n5_jogressPair = async (i, ctx) => {
  const { state, self: p } = ctx;
  const pl = state.players[p];
  const digis = pl.battle.filter(s => S.isDigimonLike(s));
  const pairs = [];
  pl.hand.forEach((id, k) => {
    if (!isDig(id) || !S.parseJogress(id) || (i.cardName && !S.cardNameIs(C(id), i.cardName)) || (i.pred && !i.pred(id))) return;
    for (let a = 0; a < digis.length; a++) for (let b = a + 1; b < digis.length; b++) if (S.canJogress(digis[a], digis[b], id).ok) pairs.push({ k, a: digis[a], b: digis[b] });
  });
  if (!pairs.length) { log(ctx, `${p} 조그레스 진화 가능한 조합이 없음`); return; }
  const k = await pickZ(ctx, p, 'hand', [...new Set(pairs.map(x => x.k))], '조그레스 진화할 패의 카드 선택');
  if (k == null) return;
  const cand = pairs.filter(x => x.k === k);
  const a = await pickS(ctx, p, [...new Set(cand.flatMap(x => [x.a, x.b]))], '조그레스 진화할 디지몬 (1마리째)');
  if (!a) return;
  const b = await pickS(ctx, p, cand.filter(x => x.a === a || x.b === a).map(x => (x.a === a ? x.b : x.a)), '조그레스 진화할 디지몬 (2마리째)');
  if (!b) return;
  const id = pl.hand[k], j = S.parseJogress(id);
  const snap = S.snapshotEvoCostMods(state, p);
  const cost = Math.max(0, (j ? j.cost : 0) + S.consumeEvoCostMod(state, p, id) + S.continuousEvoCostDiscount(state, p, S.jogressCostStack(a, b), id) + S.hookEvoCostDiscount(state, p, S.jogressCostStack(a, b), id));
  if (!S.fuseStacks(state, p, a.uid, b.uid, id, cost, 'hand')) S.restoreEvoCostMods(snap);
};
// "… 카드 1장을 지불하는 (등장)코스트 -N으로 등장(/사용)시킬 수 있다" — delegates to shard8's s8_playOrUse
OPS.n5_playPaid = async (i, ctx, run) => {
  await run.runOne({ op: 's8_playOrUse', zones: [i.zone || 'hand'], kinds: i.kinds || ['digimon', 'tamer'], delta: i.delta || 0, pred: (id) => mf(id, i.filter) }, ctx);
};
// "…를 등장 코스트 합계 N까지 코스트를 지불하지 않고 등장시킬 수 있다" (+ optional per-source bonus "…N장마다 이 효과의 등장코스트 상한 +M", or bonusFn(ctx))
OPS.n5_playSum = async (i, ctx) => {
  const { state, self: p } = ctx;
  const pl = state.players[p];
  let left = i.limit;
  if (i.bonus && i.bonus.per) left += FX_HELPERS.perCount(ctx, i.bonus.per) * i.bonus.plus;
  if (typeof i.bonusFn === 'function') left += i.bonusFn(ctx);
  const played = [];
  for (let guard = 0; guard < 8; guard++) {
    const opts = [];
    for (const z of i.zones || ['hand']) pl[z].forEach((id, k) => { if ((isDig(id) || isTam(id)) && mf(id, i.filter) && (C(id).cost || 0) <= left && (!i.pred || i.pred(id, ctx))) opts.push({ z, k, id }); });
    if (!opts.length) break;
    const ids = opts.map(o => o.id);
    const r = await ctx.choose('pickFromRevealed', { player: p, revealed: ids, eligible: ids.map((id, x) => ({ id, i: x })), min: 0, max: 1, prompt: `등장시킬 카드 선택 (남은 등장 코스트 합계 ${left})` });
    if (!r || !r.length) break;
    const o = opts[r[0]];
    const st = S.playFreeFromZone(state, p, o.z, o.k, await FX_HELPERS.xrosOptsFor(ctx, p, o.z, o.k)); // 7-2-2-13
    left -= C(o.id).cost || 0;
    if (st) played.push(st);
  }
  return played;
};
// "이 디지몬과 상대의 디지몬 1마리로 배틀할 수 있다"
OPS.n5_battle = async (i, ctx, run) => { await run.runOne({ op: 's8_battle' }, ctx); };

// ------------------------------------------------------------------ small shared helpers for the per-card scripts
const ownTurn = (ctx) => ctx.state.activePlayer === ctx.self;
const mention = (id, n) => C(id).nameKo.includes(n) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`);
const restedCount = (ctx, who, kinds = ['digimon', 'tamer']) => P(ctx, who).battle.filter(s => kinds.includes(C(s.cardId).category) && s.suspended).length;
function schedAtEnd(ctx, turnNumber, label, fn) { (ctx.state.endOfTurnEffects ||= []).push({ turnNumber, player: ctx.self, cardId: ctx.sourceCardId, label, fn }); }
function schedDestroy(ctx, uid, turnNumber, label) {
  schedAtEnd(ctx, turnNumber, label, () => { const st = findStack(ctx.state, ctx.self, uid); if (st && ctx.state.players[ctx.self].battle.includes(st)) S.deleteStack(ctx.state, ctx.self, uid, 'trash', 'ownEffect'); });
}
// pick `n` distinct stacks of `who` (each pick asked separately); returns the picked stacks
async function pickMany(ctx, who, stacks, n, prompt) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const rest = stacks.filter(s => !out.includes(s));
    const s = await pickS(ctx, who, rest, `${prompt} (${k + 1}/${n})`);
    if (!s) break;
    out.push(s);
  }
  return out;
}
// trash the opponent's security card at index i (blind pick) — same events as trashTopSecurityByEffect
function trashSecAt(ctx, who, i) {
  const pl = ctx.state.players[who];
  const [id] = pl.security.splice(i, 1);
  if (!id) return null;
  pl.trash.push(id);
  log(ctx, `${who} 시큐리티 ${i + 1}번째 카드가 효과로 파기: ${C(id).nameKo}`);
  S.emitGameEvent(ctx.state, 'securityDiscard', { owner: who, stack: null, cause: 'effect' });
  S.emitGameEvent(ctx.state, 'securityDecrease', { owner: who, stack: null, cause: 'effect' });
  return id;
}
const TOKEN = (name, dp, colors, effectKo) => ({ name, cost: 0, level: null, dp, colors, types: [], form: null, attribute: null, effectKo });

// ================================================================== BT24
SCRIPTS['BT24-016::진화 시'] = [
  X(async (ctx) => { // 상대는 자신의 패 1장을 시큐리티 아래에 놓는다 (the opponent chooses)
    const o = P(ctx, 'opp');
    if (!o.hand.length) { log(ctx, `${ctx.opp} 패가 없어 시큐리티 아래에 놓을 카드가 없음`); return; }
    const k = (await pickZ(ctx, ctx.opp, 'hand', o.hand.map((_, i) => i), '시큐리티 아래에 놓을 패 1장 선택')) ?? 0;
    const [id] = o.hand.splice(k, 1);
    S.addToSecurity(ctx.state, ctx.opp, id, 'bottom');
  }),
  T('상대의 시큐리티를 위에서부터 1장 파기한다.'),
];
SCRIPTS['BT24-017::진화 시'] = [
  T('가장 DP가 낮은 상대의 디지몬 1마리를 소멸시킨다.'),
  X(async (ctx, run) => { // 상대의 트래시 카드 2장을 덱 아래로 되돌리는 것으로, 상대는 「석화」 토큰 2마리를 등장시킨다
    const o = P(ctx, 'opp');
    if (o.trash.length < 2) { log(ctx, `${ctx.opp} 트래시가 2장 미만이라 「석화」 토큰을 등장시킬 수 없음`); return; }
    if (!(await ask(ctx, '상대의 트래시 2장을 덱 아래로 되돌려 상대가 「석화」 토큰 2마리를 등장시키게 할까요?'))) return;
    const ids = o.trash.slice();
    const r = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 2, max: 2, prompt: '상대의 트래시에서 덱 아래로 되돌릴 카드 2장 선택' });
    if (!r || r.length < 2) return;
    const moved = r.slice().sort((a, b) => b - a).map(i => o.trash.splice(i, 1)[0]);
    o.deck.push(...moved.reverse());
    await run.runOne({ op: 'spawnToken', who: 'opponent', def: TOKEN('석화', 3000, ['white'], '【자신의 턴】 이 디지몬은 레스트할 수 없다.\n【소멸 시】 자신의 시큐리티를 위에서부터 1장 파기한다.'), n: 2, rested: false, optional: false }, ctx);
  }),
  { op: 'modifyDP', target: 'self', thisStack: true, amount: 2000, duration: 'opponentTurn', per: { kind: 'stacks', side: 'opp', excludeSelf: false, anyKind: false, size: 1 } },
];
SCRIPTS['ST22-05::등장 시'] = [
  T('[턴에 1회] 「대롱 여우」(디지몬·옐로·DP 6000·《블로커》)토큰 1장을 등장시킬 수 있다.'),
  { op: 'n5_run', id: 'ST22-06', tag: '등장 시' }, // 그 후, 자신의 패나 테이머의 아래에서 「음양술」/「플러그인」 옵션 1장을 코스트 없이 사용할 수 있다
];
SCRIPTS['ST22-05::진화 시'] = SCRIPTS['ST22-05::등장 시'];
SCRIPTS['ST22-05::어택 시'] = SCRIPTS['ST22-05::등장 시'];
SCRIPTS['BT24-022::등장 시'] = [
  T('상대의 디지몬 1마리의 진화원을 위에서부터 2장 파기한다.'),
  X(async (ctx, run) => { // 그 후, 상대의 턴 종료까지, 이 디지몬의 진화원 매수 이하인 상대의 디지몬 1마리는 레스트 할 수 없다
    const me = meS(ctx); if (!me) return;
    const t = await pickS(ctx, ctx.opp, digs(ctx, 'opp').filter(s => s.sources.length <= me.sources.length), '레스트할 수 없게 할 상대의 디지몬 선택 (진화원 매수가 이 디지몬 이하)');
    if (t) S.preventRest(ctx.state, ctx.opp, t.uid, oppEnd(ctx));
  }),
];
SCRIPTS['BT24-022::진화 시'] = SCRIPTS['BT24-022::등장 시'];
SCRIPTS['BT24-050::등장 시'] = [
  T('자신의 디지몬 1마리를 액티브로 할 수 있다.'),
  { op: 's8_lock', sel: 'pick', kinds: ['digimon', 'tamer'], n: 1 }, // 그 후, 상대의 턴 종료까지, 상대의 디지몬/테이머 1장은 액티브가 되지 않는다
];
SCRIPTS['BT24-050::진화 시'] = SCRIPTS['BT24-050::등장 시'];
const EXCL_BEAST = ['수장룡형', '수생형', '수생포유류형', '정보수집 유형'];
SCRIPTS['BT24-050::어택 시'] = [{ // ▷특징으로 「수」/「짐승」을 포함(「수장룡형」/「수생형」/「수생포유류형」/「정보수집 유형」은 제외)
  op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon'], free: true,
  pred: (id) => (C(id).dp || 0) <= 4000 && ((C(id).types || []).some(t => (t.includes('수') || t.includes('짐승')) && !EXCL_BEAST.includes(t)) || trait(id, '일리아스')),
}];
SCRIPTS['BT24-018::진화 시'] = [
  X(async (ctx) => { // 상대의 시큐리티를 골라서 1장 파기할 수 있다 (blind pick by position)
    const o = P(ctx, 'opp');
    if (!o.security.length) return;
    if (!(await ask(ctx, '상대의 시큐리티 1장을 골라서 파기할까요?'))) return;
    const r = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '파기할 상대 시큐리티의 위치 (위에서부터)', options: o.security.map((_, i) => `위에서 ${i + 1}번째`) });
    trashSecAt(ctx, ctx.opp, typeof r === 'number' && r >= 0 && r < o.security.length ? r : 0);
  }),
  T('이 디지몬을 액티브로 할 수 있다.'),
];
SCRIPTS['BT24-023::등장 시'] = [
  T('Lv.4 이하인 상대의 디지몬 1마리를 덱 아래로 되돌린다.'),
  IF((ctx) => !!meS(ctx)?.playedByEffect, [T('상대의 턴 종료까지, 상대의 디지몬/테이머 1장은 레스트 할 수 없다.')]), // 그 후, 효과로 등장하고 있었다면
];
SCRIPTS['BT24-023::진화 시'] = SCRIPTS['BT24-023::등장 시'];
SCRIPTS['BT24-040::등장 시'] = [
  T('상대의 디지몬 1마리의 진화원을 전부 파기한다.'),
  X(async (ctx) => { // 그 후, 상대의 턴 종료까지, 상대의 디지몬/테이머 2마리(명)은 레스트할 수 없고, 【진화 시】 효과를 발휘할 수 없다
    const all = P(ctx, 'opp').battle.filter(s => ['digimon', 'tamer'].includes(C(s.cardId).category));
    for (const t of await pickMany(ctx, ctx.opp, all, 2, '레스트/【진화 시】 봉인할 상대의 디지몬/테이머 선택')) {
      if (S.effectBlocked(ctx.state, ctx.opp, t, 'other')) continue;
      S.preventRest(ctx.state, ctx.opp, t.uid, oppEnd(ctx));
      if (S.isDigimonLike(t)) t.noEvoTrigUntil = oppEnd(ctx);
    }
  }),
];
SCRIPTS['BT24-040::진화 시'] = SCRIPTS['BT24-040::등장 시'];
SCRIPTS['BT24-060::어택 시'] = [X(async (ctx) => { // 덱 위 3장 오픈 → 그 중 「디지대」/「시커즈」 디지몬 카드로 코스트 없이 진화 → 나머지는 덱 위 또는 아래로
  const { state, self } = ctx;
  const pl = P(ctx), st = meS(ctx);
  const rev = pl.deck.splice(0, 3);
  if (!rev.length) return;
  log(ctx, `${self} 덱 위 ${rev.length}장 오픈: ${rev.map(id => C(id).nameKo).join(', ')}`);
  let rest = rev.slice();
  const el = st && pl.battle.includes(st) ? rev.map((id, i) => ({ id, i })).filter(x => isDig(x.id) && trait(x.id, '디지대', '시커즈') && ctx.E.canEvolveAny(st.cardId, x.id, S.evoExtraArg(state, null, st), S.evolveTargetRestriction(state, self, st)).ok) : [];
  if (el.length) {
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed: rev, eligible: el, min: 0, max: 1, prompt: '이 디지몬을 코스트 없이 진화시킬 카드 선택 (취소=진화 안 함)' });
    if (r && r.length) { const id = rev[r[0]]; rest = rev.filter((_, i) => i !== r[0]); S.digivolve(state, self, st.uid, id, 0, 'deck'); }
  }
  if (rest.length) {
    const w = await ctx.choose('multipleChoice', { player: self, prompt: '나머지 카드를 덱 위/아래 어느 쪽으로 되돌릴까요?', options: ['덱 위로', '덱 아래로'] });
    let order = rest;
    if (rest.length > 1) { const o = await ctx.choose('orderCards', { player: self, ids: rest, prompt: '되돌릴 카드의 순서를 정하세요 (위쪽부터)' }); if (Array.isArray(o) && o.length === rest.length) order = o.map(i => rest[i]); }
    if (w === 1) pl.deck.push(...order); else pl.deck.unshift(...order);
  }
})];
SCRIPTS['BT24-069::이동 시'] = [
  T('자신의 패 1장을 파기한다.'),
  X(async (ctx, run) => { // 그 후, 상대는 자신의 패 1장을 파기할 수 있다. 이 효과로 상대가 파기하지 않았다면, 상대의 덱 위에서 2장 파기한다.
    const o = P(ctx, 'opp');
    let done = false;
    if (o.hand.length && (await ask(ctx, '패 1장을 파기할까요? (파기하지 않으면 덱 위 2장이 파기됩니다)', ctx.opp))) {
      const k = await pickZ(ctx, ctx.opp, 'hand', o.hand.map((_, i) => i), '파기할 패 1장 선택');
      if (k != null) { S.trashFromHand(ctx.state, ctx.opp, k); done = true; }
    }
    if (!done) await run.runOne({ op: 'trashDeckTop', who: 'opponent', n: 2 }, ctx);
  }),
];
SCRIPTS['BT24-069::진화 시'] = SCRIPTS['BT24-069::이동 시'];

// ================================================================== P- / EX11
SCRIPTS['P-216::등장 시'] = [
  T('자신의 패에서, 특징 「어둠의 4천왕」을 가진 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.'),
  X(async (ctx) => { // 이 효과로 등장한 디지몬은 진화할 수 없으며, 턴 종료 시, 소멸한다.
    const lp = ctx._lastPick; const st = lp && findStack(ctx.state, lp.player, lp.uid);
    if (!st || !ctx.state.players[ctx.self].battle.includes(st)) return;
    st.cannotEvolveUntil = ctx.state.turnNumber;
    schedDestroy(ctx, st.uid, ctx.state.turnNumber, '이 효과로 등장한 디지몬 소멸 (턴 종료 시)');
  }),
];
SCRIPTS['P-216::소멸 시'] = [X(async (ctx) => { // 자신의 시큐리티의 앞면 「어둠의 4천왕」 디지몬 1장을 코스트 없이 등장 → 자신의 턴 종료 시 소멸
  const { state, self } = ctx; const pl = P(ctx);
  const up = (id) => (pl.secUp && pl.secUp[id]) > 0;
  const idxs = pl.security.map((id, i) => i).filter(i => isDig(pl.security[i]) && trait(pl.security[i], '어둠의 4천왕') && up(pl.security[i]));
  if (!idxs.length) return;
  const ids = idxs.map(i => pl.security[i]);
  const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 0, max: 1, prompt: '시큐리티의 앞면 「어둠의 4천왕」 디지몬 카드 선택 (취소=등장 안 함)' });
  if (!r || !r.length) return;
  const i = idxs[r[0]], id = pl.security[i];
  pl.secUp[id] = Math.max(0, pl.secUp[id] - 1);
  const st = S.playFreeFromZone(state, self, 'security', i, {});
  if (!st) { pl.secUp[id] = (pl.secUp[id] || 0) + 1; return; }
  ctx._lastPick = { player: self, uid: st.uid };
  schedDestroy(ctx, st.uid, ownTurn(ctx) ? state.turnNumber : state.turnNumber + 1, '이 효과로 등장한 디지몬 소멸 (자신의 턴 종료 시)');
})];
SCRIPTS['P-220::소멸 시'] = [X(async (ctx) => { // 트래시의 「합성형」/「사신형」/「DM」 카드 3장을 덱 아래로 → 트래시의 「합성형」/「Ver.3」/「Ver.5」 Lv.6 이하 디지몬 2장 (Lv.이 같은 디지몬은 불가)
  const { state, self } = ctx; const pl = P(ctx);
  const src = pl.trash.map((id, i) => i).filter(i => trait(pl.trash[i], '합성형', '사신형', 'DM'));
  if (src.length < 3) return;
  if (!(await ask(ctx, '트래시의 「합성형」/「사신형」/「DM」 카드 3장을 덱 아래로 되돌려 디지몬 2장을 등장시킬까요?'))) return;
  const ids = src.map(i => pl.trash[i]);
  const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 3, max: 3, prompt: '덱 아래로 되돌릴 카드 3장 선택' });
  if (!r || r.length < 3) return;
  const moved = r.map(x => src[x]).sort((a, b) => b - a).map(i => pl.trash.splice(i, 1)[0]);
  pl.deck.push(...moved);
  const levels = [];
  for (let k = 0; k < 2; k++) {
    const idxs = pl.trash.map((id, i) => i).filter(i => isDig(pl.trash[i]) && trait(pl.trash[i], '합성형', 'Ver.3', 'Ver.5') && (C(pl.trash[i]).level || 0) <= 6 && !levels.includes(C(pl.trash[i]).level));
    const opts = idxs.map(i => pl.trash[i]);
    if (!opts.length) break;
    const rr = await ctx.choose('pickFromRevealed', { player: self, revealed: opts, eligible: opts.map((id, i) => ({ id, i })), min: 0, max: 1, prompt: `등장시킬 디지몬 선택 (${k + 1}/2, Lv.이 서로 달라야 함)` });
    if (!rr || !rr.length) break;
    const i = idxs[rr[0]]; levels.push(C(pl.trash[i]).level);
    S.playFreeFromZone(state, self, 'trash', i, {});
  }
})];
SCRIPTS['EX11-068::자신의 턴'] = [{ op: 's8_costThen', costs: [{ t: 'restThis' }], optional: true, prompt: '이 테이머를 레스트시켜 《1 드로우》하고 패 1장을 파기할까요?', then: [
  T('《1 드로우》하고, 자신의 패 1장을 파기한다.'),
  IF(async (ctx) => ask(ctx, '어택한 디지몬이 《에그제큐트》로 어택하고 있었습니까?'), [ // 《에그제큐트》로 어택하고 있었다면, 그 디지몬을 패의 「고스트형」 디지몬 카드로 진화 코스트 -2로 진화
    { op: 's8_evolve', subject: 'pickOwn', zones: ['hand'], pred: (ctx, s) => s.suspended, card: (id) => isDig(id) && trait(id, '고스트형'), delta: -2, prompt: '진화시킬 (어택한) 디지몬 선택' },
  ]),
] }];
SCRIPTS['EX11-024::등장 시'] = [
  T('자신의 패에서 특징 「퍼펫형」을 가진 Lv.4 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.'),
  X(async (ctx, run) => { // 그 후, 상대의 디지몬 1마리마다, 「사역마」 토큰 1마리를 등장시킬 수 있다
    const n = digs(ctx, 'opp').length;
    if (!n) return;
    if (!(await ask(ctx, `상대의 디지몬 ${n}마리 → 「사역마」 토큰 ${n}마리를 등장시킬까요?`))) return;
    await run.runOne({ op: 'spawnToken', who: 'self', def: TOKEN('사역마', 3000, ['yellow'], '【소멸 시】 턴 종료까지, 상대의 디지몬 1마리를 DP -3000.'), n, rested: false, optional: false }, ctx);
  }),
];
SCRIPTS['EX11-024::진화 시'] = SCRIPTS['EX11-024::등장 시'];
SCRIPTS['EX11-053::소멸 시'] = [IF((ctx) => P(ctx).security.length <= 1, [X(async (ctx) => { // 패나 「위그드라실_7D6」의 아래에서 「오메가몬 X항체」 1장을 코스트 없이 등장 → 그 후 이 카드를 등장한 디지몬의 진화원 아래에 둔다
  const { state, self } = ctx; const pl = P(ctx);
  const opts = [];
  pl.hand.forEach((id, k) => { if (isDig(id) && S.cardNameIs(C(id), '오메가몬 X항체')) opts.push({ z: 'hand', k, id }); });
  for (const s of pl.battle) if (S.isDigimonLike(s) && S.cardNameIs(C(s.cardId), '위그드라실_7D6')) s.sources.forEach((id, k) => { if (isDig(id) && S.cardNameIs(C(id), '오메가몬 X항체')) opts.push({ z: 'src', k, id, from: s }); });
  if (!opts.length) return;
  const ids = opts.map(o => o.id);
  const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 0, max: 1, prompt: '코스트 없이 등장시킬 「오메가몬 X항체」 선택 (취소=등장 안 함)' });
  if (!r || !r.length) return;
  const o = opts[r[0]];
  let st;
  if (o.z === 'hand') st = S.playFreeFromZone(state, self, 'hand', o.k, {});
  else { o.from.sources.splice(o.k, 1); S.recomputeStackGrants(o.from); pl.hand.push(o.id); st = S.playFreeFromZone(state, self, 'hand', pl.hand.length - 1, { fromSources: true }); }
  if (!st) return;
  const ti = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (ti >= 0) { pl.trash.splice(ti, 1); st.sources.unshift(ctx.sourceCardId); S.recomputeStackGrants(st); log(ctx, `${self} ${C(ctx.sourceCardId).nameKo}을(를) 등장한 디지몬의 진화원 아래에 둠`); }
})])];
SCRIPTS['EX11-074::진화 시'] = [X(async (ctx) => { // 디지몬 1마리를 레스트시킬 수 있다. 이 효과로 자신의 디지몬이 레스트 했다면, 상대의 턴 종료까지, 이 디지몬은 상대의 디지몬의 효과를 받지 않고 DP+6000
  const { state, self } = ctx;
  const entries = [];
  for (const pp of [self, ctx.opp]) for (const s of state.players[pp].battle) if (S.isDigimonLike(s) && !s.suspended) entries.push({ player: pp, uid: s.uid });
  if (!entries.length) return;
  const r = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 디지몬 선택 (자신/상대 무관, 취소=안 함)' });
  if (!r) return;
  S.restStack(state, r.player, r.uid);
  const rested = findStack(state, r.player, r.uid);
  const me = meS(ctx);
  if (r.player === self && rested && rested.suspended && me) {
    S.grantShield(state, self, me.uid, { kinds: ['all'], fromCategory: 'digimon', until: oppEnd(ctx) });
    S.modifyDP(state, self, me.uid, 6000, 'turn');
    const m2 = findStack(state, self, me.uid); if (m2) m2.dpExpiry = oppEnd(ctx);
  }
})];
SCRIPTS['EX11-074::어택 시'] = SCRIPTS['EX11-074::진화 시'];
SCRIPTS['EX11-074::서로의 턴'] = [T('이 디지몬을 액티브로 할 수 있다.'), { op: 'n5_battle' }];

// ================================================================== AD1
SCRIPTS['AD1-006::등장 시'] = [
  { op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { dpMaxSelf: true }, requireSuspended: null, dest: 'deckBottom' }, // 이 디지몬의 DP 이하의 상대 디지몬 1마리를 덱 아래로 되돌릴 수 있다
  T('이 디지몬을 액티브로 할 수 있다.'),
];
SCRIPTS['AD1-009::등장 시'] = [
  T('상대의 디지몬 1마리를 《퇴화 3》.'),
  X(async (ctx) => { // 그 후, 상대의 턴 종료까지, 이 디지몬과 명칭에 「가루몬」을 포함하는 자신의 디지몬 1마리는 상대 디지몬의 효과를 받지 않는다
    const me = meS(ctx); if (!me) return;
    const shield = (uid) => S.grantShield(ctx.state, ctx.self, uid, { kinds: ['all'], fromCategory: 'digimon', until: oppEnd(ctx) });
    shield(me.uid);
    const t = await pickS(ctx, ctx.self, digs(ctx).filter(s => s.uid !== me.uid && nameHas(s.cardId, '가루몬')), '상대 디지몬의 효과를 받지 않게 할 명칭에 「가루몬」을 포함하는 디지몬 선택');
    if (t) shield(t.uid);
  }),
];
SCRIPTS['AD1-009::진화 시'] = SCRIPTS['AD1-009::등장 시'];
const HYBRID_UNDER = async (ctx) => { // 자신의 패/트래시에서, 특징 「하이브리드체」를 가진 색이 다른 카드 2장까지를 이 테이머 아래에 놓을 수 있다. 이 효과로 놓았다면 《1 드로우》. 그 후, 이 테이머 아래에 「하이브리드체」 카드가 4장 이상이라면, 메모리 +2.
  const { state, self } = ctx; const pl = P(ctx); const tam = meS(ctx);
  if (!tam) return 0;
  const colorsOf = (id) => C(id).colors || [];
  const usedLists = []; // W9r2 (official Q6099/6113): "색이 다른" — a multi-colored card may be referenced by one of its colors (S.colorsAllDistinct)
  let placed = 0;
  for (let k = 0; k < 2; k++) {
    const opts = [];
    for (const z of ['hand', 'trash']) pl[z].forEach((id, i) => { if (trait(id, '하이브리드체') && colorsOf(id).length && S.colorsAllDistinct([...usedLists, colorsOf(id)])) opts.push({ z, i, id }); });
    if (!opts.length) break;
    const ids = opts.map(o => o.id);
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 0, max: 1, prompt: `테이머 아래에 놓을 「하이브리드체」 카드 선택 (${k + 1}/2, 색이 서로 달라야 함)` });
    if (!r || !r.length) break;
    const o = opts[r[0]];
    pl[o.z].splice(o.i, 1);
    tam.sources.unshift(o.id); usedLists.push(colorsOf(o.id)); placed++;
    log(ctx, `${self} ${C(o.id).nameKo}을(를) ${C(tam.cardId).nameKo} 아래에 놓음`);
  }
  if (placed) S.recomputeStackGrants(tam);
  return placed;
};
const HYBRID_SCRIPT = [
  X(async (ctx, run) => {
    const placed = await HYBRID_UNDER(ctx);
    if (placed) await run.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
    const tam = meS(ctx);
    if (tam && tam.sources.filter(id => trait(id, '하이브리드체')).length >= 4) await run.runOne({ op: 'gainMemory', who: 'self', n: 2 }, ctx);
  }),
];
SCRIPTS['AD1-020::자신의 메인 페이즈 개시 시'] = HYBRID_SCRIPT;
SCRIPTS['AD1-023::자신의 메인페이즈 개시시'] = HYBRID_SCRIPT;
SCRIPTS['AD1-021::자신의 턴 종료 시'] = [
  T('[턴에 1회] 명칭에 「아구몬」/「그레이몬」 을 포함하는 옐로의 자신의 디지몬이 있다면, 턴 종료까지 자신의 「최건우」 1장은 디지몬·DP 6000 으로 취급하고, 《속공》 을 얻고, 진화할 수 없다.'),
  T('자신의 디지몬 1장으로 어택할 수 있다'),
];
SCRIPTS['AD1-022::자신의 턴'] = [{ op: 's8_costThen', costs: [{ t: 'restThis' }], optional: true, prompt: '이 테이머를 레스트시켜 「어드벤처」 디지몬으로 진화시킬까요?', then: [
  X(async (ctx, run) => { // 자신의 테이머의 색 2색마다, 이 효과로 지불하는 진화코스트 -1
    const colors = new Set(); for (const t of P(ctx).battle.filter(s => isTam(s.cardId))) S.stackColors(t).forEach(c => colors.add(c));
    await run.runOne({ op: 's8_evolve', subject: 'pickOwn', zones: ['hand'], card: (id) => isDig(id) && trait(id, '어드벤처'), delta: -Math.floor(colors.size / 2) }, ctx);
  }),
] }];

// ================================================================== BT25
SCRIPTS['BT25-027::진화 시'] = [
  { op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: 4 }, requireSuspended: null, dest: 'hand' }, // [턴 1회] 상대의 Lv.4 이하의 디지몬 1마리를 패에 추가할 수 있다
  { op: 's8_costThen', costs: [{ t: 'tamerUnder', n: 1 }], optional: true, prompt: '테이머 아래의 뒷면 카드를 아래에서부터 1장 파기하여 이 디지몬을 액티브로 할까요?', then: [T('이 디지몬을 액티브로 한다.')] },
];
SCRIPTS['BT25-027::어택 시'] = SCRIPTS['BT25-027::진화 시'];
SCRIPTS['BT25-037::등장 시'] = [
  T('자신의 시큐리티를 위에서부터 1장 패에 추가한다.'),
  X(async (ctx) => { // 그 후, 패의 「천사형」/「대천사형」/「3대천사」/「일리아스」 디지몬 카드 1장 또는 「TS」 테이머 카드 1장을 시큐리티 위 또는 아래에 놓을 수 있다
    const { self } = ctx; const pl = P(ctx);
    const idxs = pl.hand.map((id, i) => i).filter(i => (isDig(pl.hand[i]) && trait(pl.hand[i], '천사형', '대천사형', '3대천사', '일리아스')) || (isTam(pl.hand[i]) && trait(pl.hand[i], 'TS')));
    const k = await pickZ(ctx, self, 'hand', idxs, '시큐리티에 놓을 패의 카드 선택 (취소=안 함)');
    if (k == null) return;
    const w = await ctx.choose('multipleChoice', { player: self, prompt: '시큐리티의 위/아래 어느 쪽에 놓을까요?', options: ['시큐리티 위', '시큐리티 아래'] });
    const [id] = pl.hand.splice(k, 1);
    S.addToSecurity(ctx.state, self, id, w === 1 ? 'bottom' : 'top');
  }),
];
SCRIPTS['BT25-037::진화 시'] = SCRIPTS['BT25-037::등장 시'];
SCRIPTS['BT25-050::등장 시'] = [
  T('디지몬 1마리를 레스트시킬 수 있다.'),
  IF((ctx) => restedCount(ctx, 'self', ['digimon']) + restedCount(ctx, 'opp', ['digimon']) >= 2, [{ op: 's8_lock', sel: 'pick', kinds: ['digimon'], n: 1 }]), // 그 후, 레스트 상태인 디지몬이 2마리 이상이라면, 상대의 디지몬 1마리는 상대의 턴 종료까지 액티브되지 않는다
];
SCRIPTS['BT25-050::진화 시'] = SCRIPTS['BT25-050::등장 시'];
SCRIPTS['BT25-057::메인'] = [X(async (ctx) => { // 상대의 턴 종료까지 자신의 디지몬 1마리를 《속공》, 《S 어택 +1》 DP +5000. 그 후, 그 디지몬으로 어택할 수 있다
  const { state, self } = ctx;
  const t = await pickS(ctx, self, digs(ctx), '《속공》《S 어택 +1》 DP+5000을 얻을 디지몬 선택');
  if (!t) return;
  const exp = oppEnd(ctx);
  S.grantKeyword(state, self, t.uid, '속공', undefined, 'permanent');
  S.grantKeyword(state, self, t.uid, '시큐리티어택', 1, 'permanent');
  t.keywordExpiry = t.keywordExpiry || {}; t.keywordExpiry['속공'] = exp; t.keywordExpiry['시큐리티어택'] = exp;
  S.modifyDP(state, self, t.uid, 5000, 'turn');
  const t2 = findStack(state, self, t.uid); if (t2) t2.dpExpiry = exp;
  if (t2 && !t2.suspended && ctx.startAttack && (await ask(ctx, `${C(t2.cardId).nameKo}(으)로 어택할까요?`))) ctx.startAttack(self, t2.uid);
})];
SCRIPTS['BT25-058::서로의 턴'] = [T('상대의 디지몬 1마리를 《퇴화 1》.'), { op: 'n5_battle' }];
SCRIPTS['BT25-075::등장 시'] = [
  T('자신의 패 또는 트래시에서 카드를 최대 2장까지 코스트를 지불하지 않고 자신의 디지몬에 링크할 수 있다.'),
  X(async (ctx, run) => { // 그 후, 자신의 링크 카드 1장마다 상대의 디지몬 전부를 《퇴화 1》
    const n = P(ctx).battle.reduce((a, s) => a + ((s.linkCards || []).length), 0);
    for (let k = 0; k < n; k++) await run.runOne({ op: 'retreat', target: 'opponent', n: 1, all: true }, ctx);
  }),
];
SCRIPTS['BT25-075::진화 시'] = SCRIPTS['BT25-075::등장 시'];
SCRIPTS['BT25-093::메인'] = [X(async (ctx, run) => { // 소멸시킨다 → (소멸하지 않았다면) 상대의 배틀 에어리어의 옵션 1장 파기 → 그 후 이 카드를 링크할 수 있다
  const { state } = ctx;
  const before = digs(ctx, 'opp').length;
  await run.runOne({ op: 'destroy', target: 'opponent', mode: 'lowestDP' }, ctx);
  if (digs(ctx, 'opp').length >= before) {
    const t = await pickS(ctx, ctx.opp, P(ctx, 'opp').battle.filter(s => C(s.cardId).category === 'option'), '파기할 상대의 옵션 카드 선택');
    if (t) S.deleteStack(state, ctx.opp, t.uid, 'trash', 'effect');
  }
  await run.runOne({ op: 'n5_link', thisCard: true, zones: ['trash'], filter: null, free: true, host: 'pick', max: 1 }, ctx);
})];

// ================================================================== ST23 / ST24
SCRIPTS['ST23-09::진화 시'] = [
  { op: 's8_shield', target: 'this', kinds: ['all'], fromCategory: 'digimon' }, // [턴 1회] 상대의 턴 종료까지 이 디지몬은 상대 디지몬의 효과를 받지 않는다
  T('상대의 디지몬 중 DP가 가장 낮은 디지몬 1마리를 소멸시킨다.'),
];
SCRIPTS['ST23-09::메인'] = [ // (아츠 진화 옵션측) 상대의 디지몬 1마리를 레스트시킨다 → 상대의 레스트 상태인 디지몬 중 DP가 가장 높은 디지몬 1마리를 덱 아래로
  T('상대의 디지몬 1마리를 레스트시킨다.'),
  { op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { suspended: true, extreme: { stat: 'dp', dir: 'max' } }, requireSuspended: null, dest: 'deckBottom' },
];
SCRIPTS['ST24-10::등장 시'] = [
  { op: 's8_restPick', who: 'opponent', kinds: ['digimon', 'tamer'], n: 1, lock: true }, // 레스트시킨다. 그 디지몬/테이머는 상대의 턴 종료까지 액티브가 되지 않는다
  { op: 's8_costThen', costs: [{ t: 'tamerUnder', n: 2 }], optional: true, prompt: '테이머 아래의 뒷면 카드를 아래에서부터 2장 파기하여 「세이버즈」 디지몬으로 진화시킬까요?', then: [T('이 디지몬을 패의 특징 「세이버즈」를 가진 디지몬 카드로 코스트를 지불하지 않고 진화할 수 있다.')] },
];

// ================================================================== EX12
SCRIPTS['EX12-014::등장 시'] = [
  { op: 's8_placeUnder', zones: ['hand', 'trash'], pred: (id) => isDig(id) && (C(id).level || 0) <= 5 && (mention(id, '감마몬') || trait(id, 'VB')), n: 1, target: 'this', pos: 'bottom' },
  T('자신의 디지몬 1마리로 어택할 수 있다.'),
];
SCRIPTS['EX12-014::진화 시'] = SCRIPTS['EX12-014::등장 시'];
SCRIPTS['EX12-026::등장 시'] = [
  T('상대의 디지몬 1마리의 진화원을 아래에서부터 2장 파기한다.'),
  X(async (ctx) => { // 그 후, 상대의 턴 종료까지, 진화원이 1장 이하인 상대의 디지몬 1마리는 어택/블록할 수 없다
    const t = await pickS(ctx, ctx.opp, digs(ctx, 'opp').filter(s => s.sources.length <= 1), '어택/블록할 수 없게 할 상대의 디지몬 선택 (진화원 1장 이하)');
    if (!t || S.effectBlocked(ctx.state, ctx.opp, t, 'other')) return;
    S.restrictAttack(ctx.state, ctx.opp, t.uid, oppEnd(ctx));
    S.setS3Flag(t, 'noBlock', oppEnd(ctx));
  }),
];
SCRIPTS['EX12-026::진화 시'] = SCRIPTS['EX12-026::등장 시'];
SCRIPTS['EX12-030::등장 시'] = [
  X(async (ctx, run) => { // 자신의 패 3장까지를 파기할 수 있다. 턴 종료까지, 상대의 디지몬 1마리를 이 효과로 파기한 1장마다 DP -2000.
    const pl = P(ctx);
    let n = 0;
    for (let k = 0; k < 3 && pl.hand.length; k++) {
      const i = await pickZ(ctx, ctx.self, 'hand', pl.hand.map((_, x) => x), `파기할 패 선택 (${k + 1}/3, 취소=그만)`);
      if (i == null) break;
      S.trashFromHand(ctx.state, ctx.self, i); n++;
    }
    if (n) await run.runOne({ op: 'modifyDP', target: 'opponent', amount: -2000 * n, duration: 'turn' }, ctx);
  }),
  T('DP 5000 이하의 상대의 디지몬 1마리를 덱 아래로 되돌린다.'),
];
SCRIPTS['EX12-030::진화 시'] = SCRIPTS['EX12-030::등장 시'];
SCRIPTS['EX12-035::등장 시'] = [
  { op: 's8_trashOppSources', n: 4 }, // 상대의 디지몬의 진화원을 골라 4장 파기한다
  X(async (ctx, run) => { // 그 후, 이 디지몬의 진화원 장수 이하인 상대의 디지몬 1마리를 덱 아래로 되돌린다
    const me = meS(ctx); if (!me) return;
    const t = await pickS(ctx, ctx.opp, digs(ctx, 'opp').filter(s => s.sources.length <= me.sources.length), '덱 아래로 되돌릴 상대의 디지몬 선택 (진화원 장수가 이 디지몬 이하)');
    if (!t) return;
    ctx._lastPick = { player: ctx.opp, uid: t.uid };
    await run.runOne({ op: 'returnToHandStripSources', last: true, dest: 'deckBottom' }, ctx);
  }),
];
SCRIPTS['EX12-035::진화 시'] = SCRIPTS['EX12-035::등장 시'];
SCRIPTS['EX12-037::진화 시'] = [
  T('상대의 디지몬 1마리를 소멸시킨다.'),
  X(async (ctx, run) => { // 그 후, 이 디지몬의 진화원 5장마다, 아래의 효과에서 1개를 발휘한다
    const me = meS(ctx); if (!me) return;
    for (let k = 0; k < Math.floor(me.sources.length / 5); k++) {
      await run.runOne({ op: 'choice', prompt: `효과 선택 (${k + 1}회째)`, options: [
        { label: '상대의 턴 종료까지, 상대의 디지몬 1마리를 DP -13000', then: [T('상대의 턴 종료까지, 상대의 디지몬 1마리를 DP -13000.')] },
        { label: '상대의 시큐리티를 위에서부터 1장 파기 + 《리커버리 +1》', then: [{ op: 'removeSecurity', who: 'opponent', position: 'top' }, { op: 'recoverTop', who: 'self' }] },
      ] }, ctx);
    }
  }),
];
SCRIPTS['EX12-037::어택 시'] = SCRIPTS['EX12-037::진화 시'];
SCRIPTS['EX12-048::등장 시'] = [
  X(async (ctx, run) => { // 상대의 턴 종료까지, 상대의 디지몬 1마리를 DP -8000. 이 디지몬의 진화원의 Lv.5 카드 1장마다, 이 DP 마이너스 효과의 수치 -3000.
    const me = meS(ctx);
    const n = me ? me.sources.filter(id => C(id).level === 5).length : 0;
    await run.runOne({ op: 'modifyDP', target: 'opponent', amount: -8000 - 3000 * n, duration: 'opponentTurn' }, ctx);
  }),
  T('이 디지몬으로 어택할 수 있다.'),
];
SCRIPTS['EX12-048::진화 시'] = SCRIPTS['EX12-048::등장 시'];

// ================================================================== BT26
SCRIPTS['BT26-101::메인'] = [
  IF((ctx) => P(ctx).battle.some(s => isTam(s.cardId) && nameHas(s.cardId, '유우키 단', '유우키 카난')), [T('상대의 턴 종료까지, 특징 「TS」를 가진 자신의 디지몬 전부는 《블로커》를 얻고 DP +3000.')]),
  X(async (ctx, run) => { // 그 후, 이하의 효과 중 1개를 발휘한다.
    await run.runOne({ op: 'choice', prompt: '발휘할 효과 선택', options: [
      { label: '「TS」 자신의 디지몬 1마리의 DP 이하인 상대의 디지몬 1마리를 소멸', then: [X(async (c2) => {
        const mine = await pickS(c2, c2.self, digs(c2).filter(s => trait(s.cardId, 'TS')), 'DP 기준이 될 「TS」 자신의 디지몬 선택');
        if (!mine) return;
        const dp = S.effectiveDP(c2.state, c2.self, mine);
        const t = await pickS(c2, c2.opp, digs(c2, 'opp').filter(s => S.effectiveDP(c2.state, c2.opp, s) <= dp), `DP ${dp} 이하의 소멸시킬 상대 디지몬 선택`);
        if (t) S.deleteStack(c2.state, c2.opp, t.uid, 'trash', 'effect');
      })] },
      { label: '「TS」 자신의 디지몬 1마리를 액티브로 한다', then: [T('특징 「TS」를 가진 자신의 디지몬 1마리를 액티브로 한다.')] },
    ] }, ctx);
  }),
];
SCRIPTS['BT26-082::소멸 시'] = [
  X(async (ctx) => { // 상대는 자신의 패를 1장 파기한다. 그 후, 상대의 패가 7장 이하라면, 이 카드를 자신의 시큐리티 아래에 앞면으로 놓을 수 있다
    const o = P(ctx, 'opp');
    if (o.hand.length) { const k = (await pickZ(ctx, ctx.opp, 'hand', o.hand.map((_, i) => i), '파기할 패 1장 선택')) ?? 0; S.trashFromHand(ctx.state, ctx.opp, k); }
    if (o.hand.length <= 7 && P(ctx).trash.includes(ctx.sourceCardId) && (await ask(ctx, `${C(ctx.sourceCardId).nameKo}을(를) 자신의 시큐리티 아래에 앞면으로 놓을까요?`))) S.placeThisAtSecurityBottom(ctx.state, ctx.self, ctx.sourceCardId);
  }),
];
SCRIPTS['BT26-095::서로의 턴'] = [{ op: 's8_costThen', costs: [{ t: 'restThis' }], optional: true, prompt: '이 테이머를 레스트시켜 《1 드로우》하고 패 1장을 파기할까요?', then: [
  T('《1 드로우》하고 자신의 패를 1장 파기한다.'),
  X(async (ctx) => { // 그 후, 자신의 트래시에서 디지타마 카드 이외의 특징 「비트브레이크」를 가진 카드 1장을 이 테이머 아래에 뒷면으로 놓는다
    const pl = P(ctx), tam = meS(ctx); if (!tam) return;
    const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).category !== 'digitama' && trait(pl.trash[i], '비트브레이크'));
    const i = await pickZ(ctx, ctx.self, 'trash', idxs, '테이머 아래에 뒷면으로 놓을 「비트브레이크」 카드 선택');
    if (i == null) return;
    const [id] = pl.trash.splice(i, 1);
    tam.sources.unshift(id); tam.s5fd = S.fdCount(tam) + 1; S.recomputeStackGrants(tam);
    log(ctx, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 뒷면으로 ${C(tam.cardId).nameKo} 아래에 놓음`);
  }),
] }];
SCRIPTS['BT26-054::등장 시'] = [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['tamer'], free: true,
  pred: (id, ctx) => trait(id, 'CS') && !P(ctx).battle.some(s => isTam(s.cardId) && C(s.cardId).nameKo === C(id).nameKo) }]; // 이 효과로는 자신의 테이머와 같은 이름의 카드는 등장할 수 없다
SCRIPTS['BT26-054::진화 시'] = SCRIPTS['BT26-054::등장 시'];
SCRIPTS['BT26-086::서로의 턴'] = [
  T('상대의 디지몬 1마리를 소멸시킬 수 있다.'),
  IF((ctx) => (meS(ctx)?.linkCards || []).length >= 7, [X(async (ctx) => { // 공식 Q&A idx6325: 8장 이상이어도 「7장이라면」 조건을 만족한다 / 그 후, 이 디지몬의 링크 카드가 7장이라면, 상대의 시큐리티를 위에서부터 1장 덱 아래로 되돌린다
    const o = P(ctx, 'opp'); const id = o.security.shift();
    if (!id) return;
    o.deck.push(id);
    log(ctx, `${ctx.opp} 시큐리티 맨 위 ${C(id).nameKo}을(를) 덱 아래로 되돌림`);
    S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.opp, stack: null, cause: 'effect' });
  })]),
];
SCRIPTS['BT26-049::서로의 턴'] = [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer', 'option'], free: true, // 레스트 상태인 디지몬/테이머 1마리(명)당 이 효과의 등장/사용 코스트 상한 +1
  pred: (id, ctx) => trait(id, '세이버즈') && (C(id).cost || 0) <= 3 + restedCount(ctx, 'self') + restedCount(ctx, 'opp') }];
SCRIPTS['BT26-055::등장 시'] = [
  X(async (ctx) => { // [턴 1회] 자신의 패 1장을 이 디지몬의 진화원 아래에 뒷면으로 놓을 수 있다
    const pl = P(ctx), me = meS(ctx); if (!me || !pl.hand.length) return;
    const k = await pickZ(ctx, ctx.self, 'hand', pl.hand.map((_, i) => i), '진화원 아래에 뒷면으로 놓을 패 1장 선택 (취소=안 함)');
    if (k == null) return;
    const [id] = pl.hand.splice(k, 1);
    me.sources.unshift(id); me.s5fd = S.fdCount(me) + 1; S.recomputeStackGrants(me);
    log(ctx, `${ctx.self} 패 1장을 뒷면으로 ${C(me.cardId).nameKo}의 진화원 아래에 놓음`);
    S.emitGameEvent(ctx.state, 'faceDownSource', { owner: ctx.self, stack: me, cause: 'effect' });
  }),
  X(async (ctx) => { // 그 후, 특징 「Ver.3」를 가진 자신의 디지몬 1마리와 등장 코스트가 가장 낮은 상대의 디지몬 전부를 소멸시킬 수 있다
    const oppD = digs(ctx, 'opp'), mineC = digs(ctx).filter(s => trait(s.cardId, 'Ver.3'));
    if (!oppD.length && !mineC.length) return;
    if (!(await ask(ctx, '「Ver.3」 자신의 디지몬 1마리와 등장 코스트가 가장 낮은 상대의 디지몬 전부를 소멸시킬까요?'))) return;
    const mine = await pickS(ctx, ctx.self, mineC, '소멸시킬 「Ver.3」 자신의 디지몬 선택');
    if (mine) S.deleteStack(ctx.state, ctx.self, mine.uid, 'trash', 'ownEffect');
    const m = oppD.length ? Math.min(...oppD.map(s => C(s.cardId).cost || 0)) : null;
    S.deleteSimul(ctx.state, ctx.opp, oppD.filter(x => (C(x.cardId).cost || 0) === m).map(s => s.uid), 'effect');
  }),
];
SCRIPTS['BT26-055::진화 시'] = SCRIPTS['BT26-055::등장 시'];
SCRIPTS['BT26-055::카운터'] = SCRIPTS['BT26-055::등장 시'];
SCRIPTS['BT26-077::등장 시'] = [{ op: 's8_playOrUse', zones: ['trash'], kinds: ['digimon'], free: true, // 이 디지몬의 뒷면인 진화원 1장마다, 이 효과의 등장 코스트 상한 +1
  pred: (id, ctx) => trait(id, 'Ver.3') && (C(id).cost || 0) <= 6 + S.fdCount(meS(ctx)) }];
SCRIPTS['BT26-077::진화 시'] = SCRIPTS['BT26-077::등장 시'];
SCRIPTS['BT26-077::어택 시'] = SCRIPTS['BT26-077::등장 시'];
SCRIPTS['BT26-083::등장 시'] = [
  X(async (ctx, run) => { // 자신의 시큐리티를 전부 파기한다. 이 효과로 파기한 1장마다, 상대의 디지몬 1마리를 소멸시킨다.
    let n = 0;
    while (P(ctx).security.length) { S.trashTopSecurityByEffect(ctx.state, ctx.self); n++; }
    for (let k = 0; k < n; k++) await run.runOne({ op: 'destroy', target: 'opponent', mode: 'choose' }, ctx);
  }),
  T('《리커버리 +3》.'),
];
SCRIPTS['BT26-083::진화 시'] = SCRIPTS['BT26-083::등장 시'];
SCRIPTS['BT26-080::메인'] = [
  X(async (ctx) => { // 디지몬 1마리를 액티브로 할 수 있다 (자신/상대 무관)
    const entries = [];
    for (const pp of [ctx.self, ctx.opp]) for (const s of ctx.state.players[pp].battle) if (S.isDigimonLike(s) && s.suspended) entries.push({ player: pp, uid: s.uid });
    if (!entries.length) return;
    const r = await ctx.choose('pickStackAnySide', { entries, prompt: '액티브로 할 디지몬 선택 (자신/상대 무관, 취소=안 함)' });
    if (r) S.unsuspendStack(ctx.state, r.player, r.uid);
  }),
  T('DP가 가장 낮은 액티브 상태인 상대의 디지몬 전부를 소멸시킨다.'),
];
SCRIPTS['BT26-009::어택 시'] = [
  T('《1 드로우》.'),
  IF((ctx) => P(ctx).hand.length >= 6, [X(async (ctx) => { // 그 후, 자신의 패가 6장 이상이라면 자신의 패 1장을 덱 아래로 되돌린다
    const pl = P(ctx);
    const k = (await pickZ(ctx, ctx.self, 'hand', pl.hand.map((_, i) => i), '덱 아래로 되돌릴 패 1장 선택')) ?? 0;
    const [id] = pl.hand.splice(k, 1); pl.deck.push(id);
    log(ctx, `${ctx.self} 패의 ${C(id).nameKo}을(를) 덱 아래로 되돌림`);
  })]),
];

// ================================================================== BT25 (options placed in the battle area)
SCRIPTS['BT25-102::메인'] = [
  T('자신의 시큐리티 아래에서부터 1장을 패에 추가하고, 이 카드를 앞면으로 시큐리티 아래에 놓는다.'),
  { op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon'], delta: -3, // 그 후, 패에서 블랙/레드인 특징 「TS」 디지몬 카드 1장을 등장 코스트 -3으로 등장시킬 수 있다
    pred: (id) => trait(id, 'TS') && (C(id).colors || []).some(c => c === 'black' || c === 'red') },
];
// BT25-095 (서로의 턴): 레드/그린인 특징 「TS」 디지몬 전부 DP +2000 (the 《속공》 half is parsed by the static-grant reader)
HOOKS['BT25-095'] = [{ tag: '서로의 턴', has: '레드/그린', dp: (state, hp, holder, target, tp) => (tp === hp && S.isDigimonLike(target) && trait(target.cardId, 'TS') && (C(target.cardId).colors || []).some(c => c === 'red' || c === 'green') ? 2000 : 0) }];

// ================================================================== BT20-102 오메가몬 X항체 (docs/verify-norest-attack.md)
// 【등장 시】【진화 시】 진화원에 「오메가몬」/「X항체」가 있다면(= 명칭이 「오메가몬」 또는 「X항체」인 카드, 〈룰〉 명칭 포함), 서로의 디지몬 1마리씩을 선택하고 선택한 디지몬 이외의 디지몬 전부를 소멸시킨다. 그 후, 상대의 디지몬 1마리를 덱 아래로 되돌린다.
// (「그 후」 문장도 같은 조건문에 속함 — 조건 불충족이면 전부 발휘하지 않음)
const BT20_102_ON = [X(async (ctx, run) => {
  const me = meS(ctx); if (!me) return;
  if (!me.sources.some(id => S.cardNameIs(id, '오메가몬') || S.cardNameIs(id, 'X항체'))) { log(ctx, `${ctx.self} ${C(me.cardId).nameKo}: 진화원에 「오메가몬」/「X항체」가 없어 효과 발휘 안 함`); return; }
  const mine = digs(ctx), theirs = digs(ctx, 'opp');
  const keepMine = mine.length ? await pickS(ctx, ctx.self, mine, '남길 자신의 디지몬 1마리 선택 (나머지는 소멸)') : null;
  const keepOpp = theirs.length ? await pickS(ctx, ctx.self, theirs, '남길 상대의 디지몬 1마리 선택 (나머지는 소멸)') : null;
  const doomed = [];
  for (const [who, list, keep] of [[ctx.self, mine, keepMine], [ctx.opp, theirs, keepOpp]]) for (const s of list) if (s !== keep) doomed.push([who, s.uid]);
  S.deleteSimul(ctx.state, doomed.map(([who, uid]) => ({ p: who, uid })), 'effect');
  await run.runScript(compileToScript('상대의 디지몬 1마리를 덱 아래로 되돌린다.'), ctx);
})];
SCRIPTS['BT20-102::등장 시'] = BT20_102_ON;
SCRIPTS['BT20-102::진화 시'] = BT20_102_ON;
// 【자신의 턴 종료 시】[턴에 1회] 턴 종료까지 자신의 디지몬 1마리는 《속공》을 얻고, 그 디지몬으로 레스트시키지 않고 어택할 수 있다.
// Q4417 (official ruling): despite the "…할 수 있다" wording, the attack itself is NOT optional once granted —
// the Digimon attacks as much as possible ("가능한 한 레스트하지 않고 어택합니다"). Only which Digimon receives
// ≪속공≫ is a real choice; whether it then attacks is not. (attackFlow/declareAttack still no-op this if the
// attack is actually illegal, e.g. no legal target or already mid-attack — Q4419.)
SCRIPTS['BT20-102::자신의 턴 종료 시'] = [X(async (ctx) => {
  const mine = digs(ctx); if (!mine.length) return;
  const st = await pickS(ctx, ctx.self, mine, '《속공》을 얻고 레스트시키지 않고 어택할 자신의 디지몬 1마리 선택');
  if (!st) return;
  S.grantKeyword(ctx.state, ctx.self, st.uid, '속공', undefined, 'turn');
  if (ctx.startAttack) ctx.startAttack(ctx.self, st.uid, undefined, { noRest: true });
})];

// @@END@@
