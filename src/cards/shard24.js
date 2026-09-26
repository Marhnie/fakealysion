// Shard 24 — starter-deck audit ST19-ST24 (docs/starter-ST19-24.md). Per-card scripts/hooks for effects the generic compiler got wrong.
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findStack = (state, p, uid) => stacksOf(state, p).find(s => s.uid === uid) || null;
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); return d; };
const fn = (f) => ({ op: 's24_fn', fn: f });
OPS.s24_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const ask = async (ctx, prompt, who) => !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt }));
const evtUid = (ctx) => ctx.trigger?.evtStackUid || ctx.trigger?.evt?.stackUid || null;

// ---- ST19-11 (inherited 【서로의 턴】[턴에 1회]): 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 자신의 토큰 또는 「퍼펫형」 다른 디지몬 1마리를 소멸시키는 것으로 벗어나지 않는다.
{
  const d = hk('ST19-11', { tag: '서로의 턴', src: 'inheritedKo', has: '벗어나지' });
  d.preventLeaveOptions = (state, hp, h, target, tp, cause) => {
    if (h !== target || cause === 'ownEffect') return [];
    if (S.turnUsesRemaining(h, S.onceLimitKey('ST19-11', [d.tag, d.has || '']), 1) <= 0) return [];
    return state.players[hp].battle.filter(s => s !== h && isDig(s) && (C(s.cardId).isToken || (C(s.cardId).types || []).includes('퍼펫형'))).map(sac => ({ apply() {
      S.hookUseOnce(h, 'ST19-11', d, 1);
      S.log(state, `${hp} ${C(h.cardId).nameKo}: ${C(sac.cardId).nameKo}을(를) 소멸시켜 배틀 에어리어를 벗어나지 않음 (ST19-11)`);
      S.deleteStack(state, hp, sac.uid, 'trash', 'ownEffect');
      return true;
    } }));
  };
}

// ---- ST19-14 【자신의 턴】 자신의 토큰 또는 「퍼펫형」 자신의 디지몬이 효과로 등장했을 때, 이 테이머를 레스트시키는 것으로, 턴 종료까지 그 디지몬 1마리는 《속공》을 얻는다.
hk('ST19-14', { tag: '자신의 턴', has: '효과로 등장했을 때', events: { play: (state, hp, h, info) => info.owner === hp && (info.cause === 'effect' || info.cause === 'ownEffect') && !!info.stack && isDig(info.stack) && (C(info.stack.cardId).isToken || (C(info.stack.cardId).types || []).includes('퍼펫형')) && !!h && !h.suspended } });
sc('ST19-14::자신의 턴', async (ctx) => {
  const { state } = ctx, me = findStack(state, ctx.self, ctx.sourceStackUid);
  const t = evtUid(ctx) && findStack(state, ctx.self, evtUid(ctx));
  if (!me || me.suspended || !t || state.activePlayer !== ctx.self) return;
  if (!(await ask(ctx, `${C(me.cardId).nameKo}을(를) 레스트시켜 ${C(t.cardId).nameKo}에게 《속공》을 줄까요?`))) return;
  S.restStack(state, ctx.self, me.uid);
  if (!me.suspended) return;
  S.grantKeyword(state, ctx.self, t.uid, '속공', undefined, 'turn');
});

// ---- helpers for "자신의 테이머의 색 N색마다" (distinct colors among the own Tamers; same counting as shard13.tamerColorN)
const tamers = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const tamerColorN = (state, p, trait) => new Set(tamers(state, p).filter(t => !trait || (C(t.cardId).types || []).includes(trait)).flatMap(t => S.stackColors(t))).size;
async function pickS(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt, required: true });
  return stacks.find(s => s.uid === uid) || null;
}
const ownDigs = (state, p) => state.players[p].battle.filter(isDig);

// ---- ST20-04 【등장 시】【진화 시】 턴 종료까지 자신의 디지몬 1마리는 《S 어택 +1》을 얻고, 자신의 테이머의 색 2색마다 DP +2000. (the compiler dropped the DP half)
sc('ST20-04::등장 시', async (ctx) => {
  const { state } = ctx;
  const t = await pickS(ctx, ctx.self, ownDigs(state, ctx.self), 'S 어택 +1 / DP를 얻을 자신의 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, ctx.self, t.uid, '시큐리티어택', 1, 'turn');
  const k = Math.floor(tamerColorN(state, ctx.self) / 2);
  if (k > 0) S.modifyDP(state, ctx.self, t.uid, 2000 * k, 'turn');
});
SCRIPTS['ST20-04::진화 시'] = SCRIPTS['ST20-04::등장 시'];

// ---- ST20-09 【등장 시】【진화 시】 자신의 디지몬 1마리를 액티브로 한다. 그 후, 「어드벤처」 자신의 테이머의 색 2색마다 상대의 디지몬 1마리를 레스트시킨다.
sc('ST20-09::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'unsuspend', target: 'self', digimonOnly: true }, ctx);
  const k = Math.floor(tamerColorN(ctx.state, ctx.self, '어드벤처') / 2);
  if (k > 0) await R.runOne({ op: 'rest', target: 'opponent', n: k, skipNextUnsuspend: false, digimonOnly: true }, ctx);
});
SCRIPTS['ST20-09::진화 시'] = SCRIPTS['ST20-09::등장 시'];

// ---- ST21-09 【등장 시】【진화 시】 DP 5000 이하의 상대의 디지몬 전부를 레스트시킨다. 그 후, 자신의 테이머의 색 2색마다 레스트 상태인 상대의 디지몬 1마리를 덱 아래로 되돌린다.
sc('ST21-09::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'restAll', target: 'opponent', filter: { dpMax: 5000, category: 'digimon' } }, ctx);
  const k = Math.floor(tamerColorN(ctx.state, ctx.self) / 2);
  if (k > 0) await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: k, filter: { suspended: true }, requireSuspended: null, dest: 'deckBottom' }, ctx);
});
SCRIPTS['ST21-09::진화 시'] = SCRIPTS['ST21-09::등장 시'];

// ---- ST20-13 【상대의 턴】 「어드벤처」 자신의 디지몬 전부는 《블로커》 / ST21-13 【자신의 턴】 「어드벤처」 Lv.5 이상 자신의 디지몬 전부는 《속공》 (continuous grants to every matching own Digimon)
hk('ST20-13', { tag: '상대의 턴', has: '블로커', grantKw: (state, hp, h, t) => (isDig(t) && S.ownerOfStack(state, t) === hp && (C(t.cardId).types || []).includes('어드벤처') ? ['블로커'] : []) });
hk('ST21-13', { tag: '자신의 턴', has: '속공', grantKw: (state, hp, h, t) => (isDig(t) && S.ownerOfStack(state, t) === hp && (C(t.cardId).types || []).includes('어드벤처') && (C(t.cardId).level || 0) >= 5 ? ['속공'] : []) });

// ---- ST23-13 / ST23-14 / ST24-13 / ST24-14 (tamers) 【자신의 메인 페이즈 개시 시】【등장 시】 자신의 덱 위에서부터 1장을 뒷면으로 이 테이머 아래에 놓을 수 있다. 그 후, 상대의 디지몬이 있다면, 메모리 +1.
// (the compiler only produced the memory half — the face-down placement that feeds the whole 「글로잉 던」/「세이버즈」 engine was missing)
function placeDeckTopFaceDownUnder(ctx, st) {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!st || !pl.deck.length) return false;
  const id = pl.deck.shift();
  st.sources.unshift(id); st.s5fd = (st.s5fd || 0) + 1; // face-down cards form the bottom block of sources (shard5 model)
  S.recomputeStackGrants(st);
  S.log(state, `${ctx.self} 덱 위 1장을 뒷면으로 ${C(st.cardId).nameKo} 아래에 놓음`);
  S.emitGameEvent(state, 'faceDownSource', { owner: ctx.self, stack: st, cause: 'effect' });
  return true;
}
for (const id of ['ST23-13', 'ST23-14', 'ST24-13', 'ST24-14']) {
  sc(`${id}::자신의 메인 페이즈 개시 시`, async (ctx, R) => {
    const { state } = ctx, me = findStack(state, ctx.self, ctx.sourceStackUid);
    if (me && state.players[ctx.self].deck.length && (await ask(ctx, `${C(me.cardId).nameKo}: 덱 위 1장을 뒷면으로 이 테이머 아래에 놓을까요?`))) placeDeckTopFaceDownUnder(ctx, me);
    if (state.players[ctx.opp].battle.some(isDig)) await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
  });
}

// ---- 「이 테이머 아래의 카드가 효과로 파기되었을 때」 (event 'sourcesTrashed', info.stack = the tamer) reactions
const idle = (h) => !!h && C(h.cardId).category === 'tamer' && !h.suspended;
const underTrashedByEffect = (hp, h, info) => info.owner === hp && info.stack === h && info.cause === 'effect';
// ST23-14 【자신의 턴】: 이 테이머를 레스트시키는 것으로, 특징 「글로잉 던」을 가진 자신의 디지몬 1마리는 턴 종료까지 《재밍》을 얻는다.
// ST24-13 【자신의 턴】: 이 테이머를 레스트시키는 것으로, 특징 「세이버즈」를 가진 자신의 디지몬 1마리는 턴 종료까지 《재밍》을 얻는다.
for (const [id, trait] of [['ST23-14', '글로잉 던'], ['ST24-13', '세이버즈']]) {
  hk(id, { tag: '자신의 턴', has: '파기되었을 때', events: { sourcesTrashed: (state, hp, h, info) => underTrashedByEffect(hp, h, info) && idle(h) } });
  sc(`${id}::자신의 턴`, async (ctx) => {
    const { state } = ctx, me = findStack(state, ctx.self, ctx.sourceStackUid);
    if (!idle(me) || state.activePlayer !== ctx.self) return;
    const cands = ownDigs(state, ctx.self).filter(s => (C(s.cardId).types || []).includes(trait));
    if (!cands.length || !(await ask(ctx, `${C(me.cardId).nameKo}을(를) 레스트시켜 「${trait}」 디지몬 1마리에게 《재밍》을 줄까요?`))) return;
    S.restStack(state, ctx.self, me.uid);
    if (!me.suspended) return;
    const t = await pickS(ctx, ctx.self, cands, '《재밍》을 얻을 자신의 디지몬 선택');
    if (t) S.grantKeyword(state, ctx.self, t.uid, '재밍', undefined, 'turn');
  });
}
// ST24-14 【서로의 턴】: 효과로 이 테이머 아래의 카드가 파기되었을 때, 이 테이머를 레스트시키는 것으로, 상대의 디지몬 1마리를 레스트시킨다.
hk('ST24-14', { tag: '서로의 턴', has: '파기되었을 때', events: { sourcesTrashed: (state, hp, h, info) => underTrashedByEffect(hp, h, info) && idle(h) } });
sc('ST24-14::서로의 턴', async (ctx, R) => {
  const { state } = ctx, me = findStack(state, ctx.self, ctx.sourceStackUid);
  if (!idle(me) || !state.players[ctx.opp].battle.some(s => isDig(s) && !s.suspended)) return;
  if (!(await ask(ctx, `${C(me.cardId).nameKo}을(를) 레스트시켜 상대의 디지몬 1마리를 레스트시킬까요?`))) return;
  S.restStack(state, ctx.self, me.uid);
  if (!me.suspended) return;
  await R.runOne({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }, ctx);
});

// ---- ST24-11 【서로의 턴】[턴에 1회] 상대의 디지몬 또는 테이머가 레스트했을 때, 또는 효과로 자신의 테이머 아래의 카드가 파기되었을 때, 상대의 시큐리티를 위에서부터 1장 파기한다.
hk('ST24-11', { tag: '서로의 턴', has: '레스트했을 때', limit: 1, events: {
  rest: (state, hp, h, info) => info.owner === opp(hp) && !!info.stack && (isDig(info.stack) || C(info.stack.cardId).category === 'tamer'),
  sourcesTrashed: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'tamer' && info.cause === 'effect',
} });
sc('ST24-11::서로의 턴', async (ctx) => { S.trashTopSecurityByEffect(ctx.state, ctx.opp); });

// ---- ST22-06 【서로의 턴】[턴에 1회] 자신이 옵션을 사용했을 때, 또는 자신의 시큐리티가 줄어들었을 때, 가장 DP가 낮은 상대 디지몬 1마리를 시큐리티의 아래에 놓는 것으로, 상대의 시큐리티를 위에서부터 1장 파기한다.
hk('ST22-06', { tag: '서로의 턴', has: '옵션을 사용했을 때', limit: 1, events: {
  optionUsed: (state, hp, h, info) => info.owner === hp,
  securityDecrease: (state, hp, h, info) => info.owner === hp,
} });
function stackToSecurityBottom(ctx, p, st) { // digimon stack -> owner's security bottom (face-down); sources/links go to the trash like a bounce
  const { state } = ctx, pl = state.players[p];
  if (!pl.battle.includes(st)) return false;
  const cause = p === ctx.self ? 'ownEffect' : 'effect';
  const go = () => {
    if (!pl.battle.includes(st)) return false;
    pl.battle.splice(pl.battle.indexOf(st), 1);
    pl.trash.push(...st.sources.filter(id => !C(id).isToken), ...(st.linkCards || []).map(l => l.cardId));
    if (!C(st.cardId).isToken) S.addToSecurity(state, p, st.cardId, 'bottom');
    return true;
  };
  if (S.effectBlocked(state, p, st, 'bounce')) return false;
  let deferred = false;
  if (S.leaveGate(state, p, st, cause, 'bounce', () => { go(); })) deferred = true;
  return deferred ? false : go();
}
sc('ST22-06::서로의 턴', async (ctx) => {
  const { state } = ctx, o = ctx.opp;
  let pool = state.players[o].battle.filter(isDig);
  if (!pool.length) return;
  const m = Math.min(...pool.map(s => S.effectiveDP(state, o, s)));
  pool = pool.filter(s => S.effectiveDP(state, o, s) === m);
  const t = await pickS(ctx, ctx.self, pool, '시큐리티 아래에 놓을 가장 DP가 낮은 상대의 디지몬 선택');
  if (!t || !stackToSecurityBottom(ctx, o, t)) return;
  S.trashTopSecurityByEffect(state, o);
});

// ---- ST23-04 【등장 시】【진화 시】 턴 종료까지 상대의 디지몬 1마리를 DP -5000. 그 후, 자신의 턴이라면, 자신의 테이머 아래의 뒷면 카드를 아래에서부터 1장 파기하는 것으로, 패에서 특징 「글로잉 던」을 가진 카드 1장을 사용 코스트 -3으로 등장시키거나 사용할 수 있다.
// (the compiler paid the under-card cost and then left the play/use half as a manual note)
SCRIPTS['ST23-04::등장 시'] = [
  { op: 'modifyDP', target: 'opponent', amount: -5000, duration: 'turn' },
  { op: 's8_if', test: (ctx) => ctx.state.activePlayer === ctx.self, then: [{ op: 's8_costThen', costs: [{ t: 'tamerUnder', n: 1 }], optional: true, then: [{ op: 's8_playOrUse', zones: ['hand'], pred: (id) => (C(id).types || []).includes('글로잉 던'), delta: -3 }] }] },
];
SCRIPTS['ST23-04::진화 시'] = SCRIPTS['ST23-04::등장 시'];

// ---- ST23-15 e-펄스 / ST24-15 디지소울 차지 (Option kept in the battle area) 【자신의 메인 페이즈 개시 시】 이 카드를 배틀 에어리어에서 특징 「비트브레이크」/「세이버즈」를 가진 자신의 테이머 (중 1명)의 아래에 뒷면으로 놓는 것으로, 《1 드로우》하고 메모리 +1.
// (the compiler treated the cost as a manual confirm and never moved the card)
for (const [id, trait] of [['ST23-15', '비트브레이크'], ['ST24-15', '세이버즈']]) {
  sc(`${id}::자신의 메인 페이즈 개시 시`, async (ctx, R) => {
    const { state } = ctx, pl = state.players[ctx.self];
    const me = findStack(state, ctx.self, ctx.sourceStackUid);
    if (!me || !pl.battle.includes(me)) return;
    const tams = pl.battle.filter(s => C(s.cardId).category === 'tamer' && (C(s.cardId).types || []).includes(trait));
    if (!tams.length) return;
    if (!(await ask(ctx, `${C(me.cardId).nameKo}을(를) 「${trait}」 테이머 아래에 뒷면으로 놓고 《1 드로우》/메모리 +1 할까요?`))) return;
    const tam = tams.length === 1 ? tams[0] : await pickS(ctx, ctx.self, tams, `${C(me.cardId).nameKo}을(를) 뒷면으로 놓을 「${trait}」 테이머 선택`);
    if (!tam) return;
    pl.battle.splice(pl.battle.indexOf(me), 1);
    tam.sources.unshift(me.cardId); tam.s5fd = (tam.s5fd || 0) + 1; // face-down at the bottom of the tamer's stack
    S.recomputeStackGrants(tam);
    S.log(state, `${ctx.self} ${C(me.cardId).nameKo}을(를) 배틀 에어리어에서 ${C(tam.cardId).nameKo} 아래에 뒷면으로 놓음`);
    S.emitGameEvent(state, 'faceDownSource', { owner: ctx.self, stack: tam, cause: 'effect' });
    await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
    await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
  });
}
