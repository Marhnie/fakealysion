// Shard 35 — batch-5 verification fixes (BT13-/BT14-/BT15- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-BT13-15.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's35_fn', fn: f });
OPS.s35_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const D = (id, tag, has, d, src = 'effectKo') => { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); };
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const hasType = (id, ...ts) => ts.some(t => (C(id).types || []).includes(t));
const nameHas = (id, ...ns) => ns.some(n => C(id).nameKo.includes(n));
async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
// pick one card from an arbitrary id list (temp zone trick so the stock picker UI works)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s35tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's35tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s35tmp; }
}

// ---------------------------------------------------------------- continuous "N마리(장)마다" DP (the generic turn-conditional parser has no per-count form)
// BT15-048 / BT15-051 (inherited) 【자신의 턴】 레스트 상태인 상대의 디지몬 1마리마다 이 디지몬을 DP +1000.
for (const id of ['BT15-048', 'BT15-051']) DI(id, '자신의 턴', '레스트 상태인 상대의 디지몬 1마리마다', { dp: (state, hp, h, target) => (target === h ? 1000 * state.players[opp(hp)].battle.filter(s => isDig(s) && s.suspended).length : 0) });
// BT14-075 데블몬 【자신의 턴】 자신의 트래시 3장마다 이 디지몬을 DP +1000.
D('BT14-075', '자신의 턴', '트래시 3장마다', { dp: (state, hp, h, target) => (target === h ? 1000 * Math.floor(state.players[hp].trash.length / 3) : 0) });

// BT14-017 다이노렉스몬 【서로의 턴】 메모리가 상대 쪽의 1 이상인 동안, DP 6000 이하의 상대의 디지몬은 등장할 수 없으며, 이 디지몬을 DP +4000.
const oppMem = (state, hp) => (hp === 'p1' ? -state.memory : state.memory); // memory on the OPPONENT's side, from hp's view
D('BT14-017', '서로의 턴', 'DP 6000 이하의 상대', {
  dp: (state, hp, h, target) => (target === h && oppMem(state, hp) >= 1 ? 4000 : 0),
  playLock: (state, hp, h, cardId, p) => p !== hp && oppMem(state, hp) >= 1 && C(cardId).category === 'digimon' && (C(cardId).dp || 0) <= 6000,
});

// ================================================================== "~했을 때" watchers the generic parsers can't see (nothing queued them before)
const ownFx = (state, hp) => state._fxSrc?.player === hp; // the current effect belongs to hp ("자신의 효과로")
const namesOf = (id) => (S.cardNames ? S.cardNames(id) : [C(id).nameKo]);

// BT13-076 킹에테몬 【서로의 턴】[턴에 1회] 명칭에 「에테몬」/「스카몬」을 포함하는 다른 디지몬이 소멸했을 때, 상대의 턴 종료까지 상대의 디지몬 1마리에게 《S 어택 -1》을 주고, DP -3000.  (ONE Digimon gets both)
D('BT13-076', '서로의 턴', '소멸했을 때', { limit: 1, events: { delete: (state, hp, h, info) => !!info.stack && info.stack !== h && info.stack.cardId && C(info.stack.cardId).category === 'digimon' && nameHas(info.stack.cardId, '에테몬', '스카몬') } });
sc('BT13-076::서로의 턴', async (ctx, R) => {
  await R.runOne({ op: 'modifyDP', target: 'opponent', amount: -3000, duration: 'opponentTurn' }, ctx);
  await R.runOne({ op: 'grantKeyword', target: 'opponent', last: true, keyword: '시큐리티어택', value: -1, duration: 'opponentTurn' }, ctx);
});

// BT13-040 매그너몬 【서로의 턴】 이 디지몬이 배틀 에어리어를 벗어날 때, 《1 드로우》. 그 후, 자신의 패 또는 이 디지몬의 진화원에서 「브이몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
D('BT13-040', '서로의 턴', '벗어날 때', { onLeave: () => true });
sc('BT13-040::서로의 턴', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
  const evt = ctx.trigger?.evt || {};
  const isV = (id) => C(id).category === 'digimon' && C(id).nameKo === '브이몬';
  const cands = [];
  pl.hand.forEach((id, i) => { if (isV(id)) cands.push({ zone: 'hand', i, id }); });
  for (const id of evt.sources || []) if (isV(id) && !cands.some(c => c.zone === 'trash' && c.id === id)) { const i = pl.trash.lastIndexOf(id); if (i >= 0) cands.push({ zone: 'trash', i, id }); } // the leaving stack's sources are already in the trash
  if (!cands.length) return;
  const ids = cands.map(c => c.id);
  const k = await pickFromList(ctx, ctx.self, ids, ids.map((_, i) => i), '코스트 없이 등장시킬 「브이몬」 선택 (안 해도 됨)');
  if (k == null) return;
  const c = cands[k];
  S.playFreeFromZone(state, ctx.self, c.zone, c.i, c.zone === 'trash' ? { fromSources: true } : {});
});

// BT14-004 시드몬 (inherited) 【자신의 턴】[턴에 1회] 테이머가 자신의 효과로 레스트했을 때, 턴 종료까지 이 디지몬을 DP +2000.
DI('BT14-004', '자신의 턴', '테이머가 자신의 효과로 레스트', { limit: 1, events: { rest: (state, hp, h, info) => isTam(info.stack) && info.cause !== 'battle' && info.cause !== 'block' && ownFx(state, hp) } });
// BT14-053 로제몬 【자신의 턴】[턴에 1회] 디지몬/테이머가 효과로 레스트했을 때, 이 디지몬을 액티브로 할 수 있다.
D('BT14-053', '자신의 턴', '효과로 레스트했을 때', { limit: 1, events: { rest: (state, hp, h, info) => !!info.stack && (isDig(info.stack) || isTam(info.stack)) && !!state._fxSrc && info.cause !== 'battle' && info.cause !== 'block' } });
// BT14-070 고부리몬 (inherited) / BT14-073 우가몬 (own + inherited) 【자신의 턴】[턴에 1회] 자신의 패가 자신의 효과로 파기되었을 때, 메모리 +1.
const ownHandDiscard = { discard: (state, hp, h, info) => info.owner === hp && ownFx(state, hp) };
DI('BT14-070', '자신의 턴', '패가 자신의 효과로 파기', { limit: 1, events: ownHandDiscard });
D('BT14-073', '자신의 턴', '패가 자신의 효과로 파기', { limit: 1, events: ownHandDiscard });
DI('BT14-073', '자신의 턴', '패가 자신의 효과로 파기', { limit: 1, events: ownHandDiscard });
// BT14-071 루가몬 / BT14-074 루갈몬 (inherited) 「마수형」/「SoC」 카드가 등장했을 때 메모리 +1 ; BT14-079 솔루가몬 (inherited) …이 디지몬을 액티브로 할 수 있다.
const beastPlay = { play: (state, hp, h, info) => info.owner === hp && !!info.stack && hasType(info.stack.cardId, '마수형', 'SoC') };
DI('BT14-071', '자신의 턴', '마수형', { limit: 1, events: beastPlay });
DI('BT14-074', '자신의 턴', '마수형', { limit: 1, events: beastPlay });
DI('BT14-079', '자신의 턴', '마수형', { limit: 1, events: beastPlay });
// BT14-083 정석 【자신의 턴】 상대의 디지몬의 진화원이 효과로 파기되었을 때, 이 테이머를 레스트시키는 것으로, 메모리 +1.
D('BT14-083', '자신의 턴', '진화원이 효과로 파기', { events: { sourcesTrashed: (state, hp, h, info) => info.owner !== hp && isDig(info.stack) && info.cause === 'effect' && !h.suspended } });
// BT15-008 레드펭귄몬 / BT15-010 레드꼬끼몬 【자신의 턴】[턴에 1회] (레드인) 자신의 디지몬이 플레이어에게 어택했을 때, ...
D('BT15-008', '자신의 턴', '플레이어에게 어택', { limit: 1, events: { attackTarget: (state, hp, h, info) => info.owner === hp && info.targetKind === 'player' && isDig(info.stack) && S.stackColors(info.stack).includes('red') } });
D('BT15-010', '자신의 턴', '플레이어에게 어택', { limit: 1, events: { attackTarget: (state, hp, h, info) => info.owner === hp && info.targetKind === 'player' && isDig(info.stack) } });
// BT15-032 플레시오몬 X항체 【상대의 턴】 진화원 매수가 이 디지몬 이하의 상대의 디지몬이 어택했을 때, 이 디지몬의 진화원에 「플레시오몬」/「X항체」가 있다면, 메모리 +2.
D('BT15-032', '상대의 턴', '어택했을 때', { events: { attack: (state, hp, h, info) => info.owner !== hp && isDig(info.stack) && info.stack.sources.length <= h.sources.length } });
sc('BT15-032::상대의 턴', async (ctx) => {
  const h = me(ctx); if (!h) return;
  if (!h.sources.slice(S.fdCount(h)).some(id => namesOf(id).some(n => n === '플레시오몬' || n === 'X항체'))) return;
  S.grantMemory(ctx.state, ctx.self, 2, ctx.sourceCardId);
});
// BT15-084 신나리 【서로의 턴】 자신의 시큐리티가 효과로 줄어들었을 때, 이 테이머를 레스트시키는 것으로, 상대의 턴 종료까지 상대의 디지몬 1마리에게 《S 어택 -1》을 준다.
D('BT15-084', '서로의 턴', '시큐리티가 효과로 줄어들었을 때', { events: { securityDecrease: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && !h.suspended } });

// BT13-015 라이즈그레이몬 【서로의 턴】[턴에 1회] 레드/옐로인 자신의 테이머가 소멸했을 때, 자신의 트래시에서 「최건우」 1장을 시큐리티 위에 놓는다. (no generic op existed -> script was empty)
sc('BT13-015::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).nameKo === '최건우');
  if (!idxs.length) return;
  const k = await pickFromList(ctx, ctx.self, pl.trash, idxs, '시큐리티 위에 놓을 「최건우」 선택');
  if (k == null) return;
  const [id] = pl.trash.splice(k, 1);
  S.addToSecurity(state, ctx.self, id, 'top');
});

// ================================================================== scripts the generic compiler dropped / mangled
const evtStack = (ctx) => { const uid = ctx.trigger?.evtStackUid; if (!uid) return null; return findStack(ctx.state, 'p1', uid) || findStack(ctx.state, 'p2', uid); };

// BT13-056 두프트몬 【서로의 턴】 다른 자신의 디지몬이 등장했을 때, 상대의 턴 종료까지 특징으로 「로얄 나이츠」를 가지거나 그린인 자신의 디지몬 전부는 《블로커》를 얻는다. (generic kept only the green half)
sc('BT13-056::서로의 턴', async (ctx) => {
  for (const s of ctx.state.players[ctx.self].battle.filter(isDig)) if (hasType(s.cardId, '로얄 나이츠') || S.stackColors(s).includes('green')) S.grantKeyword(ctx.state, ctx.self, s.uid, '블로커', undefined, 'opponentTurn');
});
// BT13-059 엑자몬 【서로의 턴】[턴에 1회] 상대의 디지몬이 레스트했을 때, 이하의 효과에서 1개를 발휘할 수 있다. ·상대의 디지몬 1마리를 레스트시킨다. ·자신의 디지몬 1마리를 액티브로 한다.
sc('BT13-059::서로의 턴', async (ctx, R) => {
  const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '엑자몬: 발휘할 효과 선택 (안 해도 됨)', options: ['상대의 디지몬 1마리를 레스트', '자신의 디지몬 1마리를 액티브', '발휘하지 않음'] });
  if (k === 0) await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
  else if (k === 1) await R.runOne({ op: 'unsuspend', target: 'self', digimonOnly: true }, ctx);
});
// BT13-096 유진욱 【서로의 턴】 블루인 자신의 디지몬이 등장했을 때, 이 테이머를 레스트시키는 것으로, 자신의 패에서 블루인 Lv.4 이하의 디지몬 카드 1장을 그 디지몬의 진화원 아래에 놓을 수 있다.
sc('BT13-096::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const tgt = evtStack(ctx); const h = me(ctx);
  if (!tgt || !h) return; // (the W path already rested the Tamer as the cost)
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && (C(pl.hand[i]).colors || []).includes('blue') && (C(pl.hand[i]).level || 0) <= 4);
  if (!idxs.length) return;
  const i = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: '진화원 아래에 놓을 블루 Lv.4 이하 디지몬 선택 (안 해도 됨)' });
  if (i == null) return;
  const [id] = pl.hand.splice(i, 1);
  tgt.sources.splice(S.fdCount(tgt), 0, id);
  S.recomputeStackGrants(tgt);
  S.log(state, `${ctx.self} ${C(id).nameKo}을(를) ${C(tgt.cardId).nameKo}의 진화원 아래에 놓음`);
});
// BT13-097 토마 H 노르슈타인 【자신의 턴】 「가오몬」/「가오가몬」 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 서로는 덱에서 카드를 1장 뽑는다.
sc('BT13-097::자신의 턴', async (ctx) => {
  S.drawCards(ctx.state, ctx.self, 1); S.drawCards(ctx.state, opp(ctx.self), 1);
});
// BT14-019 올챙몬 / BT14-024 개굴몬 (inherited) 【상대의 턴】[턴에 1회] 상대의 디지몬이 어택했을 때, 그 디지몬의 진화원을 아래에서부터 2장 파기한다.
for (const id of ['BT14-019', 'BT14-024']) sc(`${id}::상대의 턴`, async (ctx) => {
  const a = evtStack(ctx); if (!a) return;
  S.trashEvoSources(ctx.state, opp(ctx.self), a.uid, 2, 'bottom');
});
// BT15-056 류우다몬 / BT15-058 긴류우몬 (inherited) 【서로의 턴】[턴에 1회] 이 디지몬이 레스트했을 때, 이 디지몬의 등장 코스트 이하의 상대의 디지몬/테이머 1마리(명)를 레스트시킨다. (generic ignored the cost cap)
for (const id of ['BT15-056', 'BT15-058']) sc(`${id}::서로의 턴`, async (ctx) => {
  const h = me(ctx); if (!h) return;
  const cost = C(h.cardId).cost ?? 0, o = opp(ctx.self);
  const cands = ctx.state.players[o].battle.filter(s => (isDig(s) || isTam(s)) && !s.suspended && (C(s.cardId).cost ?? 0) <= cost);
  const t = await pickStack(ctx, ctx.self, cands, '레스트시킬 상대의 디지몬/테이머 선택 (등장 코스트 ' + cost + ' 이하)');
  if (t) S.restStack(ctx.state, o, t.uid, 'effect');
});

// BT15-038 엔젤우몬 【서로의 턴】[턴에 1회] 자신의 시큐리티가 줄어들었을 때, 자신의 시큐리티가 3장 이하라면, 《리커버리 +1《덱》》. (the generic event watcher refused the conditional text; the generic script gates on the count)
D('BT15-038', '서로의 턴', '시큐리티가 줄어들었을 때', { ewTrusted: true });

// ---------------------------------------------------------------- Tamer "treated as a Digimon (DP 3000) until the opponent's turn ends"
const untilOppTurnEnd = (state, self) => (state.activePlayer === self ? state.turnNumber + 1 : state.turnNumber);
function asDigimonUntilOpp(ctx, st, blocker) {
  const { state } = ctx, until = untilOppTurnEnd(state, ctx.self);
  st.s2AsDigimon = true; st.s2NoEvolve = true;
  (st.baseOv ||= []).push({ ts: S.stamp(), until, dp: 3000 }); S.refreshBaseInfo(state, st);
  (state.endOfTurnEffects ||= []).push({ turnNumber: until, expire: true, fn: () => { st.s2AsDigimon = false; st.s2NoEvolve = false; } });
  if (blocker) S.grantKeyword(state, ctx.self, st.uid, '블로커', undefined, 'opponentTurn');
  S.log(state, `${C(st.cardId).nameKo}: 상대의 턴 종료까지 디지몬·DP 3000으로도 취급${blocker ? ', 《블로커》' : ''}, 진화할 수 없음`);
}
// BT13-018 샤인그레이몬 【자신의 메인 페이즈 개시 시】【진화 시】 상대의 턴 종료까지 자신의 「최건우」 1명은 디지몬·DP 3000으로도 취급하며, 《블로커》를 얻고, 진화할 수 없다. (generic gave 《블로커》 to an arbitrary Digimon instead)
for (const tag of ['자신의 메인 페이즈 개시 시', '진화 시']) sc(`BT13-018::${tag}`, async (ctx) => {
  const t = await pickStack(ctx, ctx.self, ctx.state.players[ctx.self].battle.filter(s => isTam(s) && C(s.cardId).nameKo === '최건우'), '디지몬으로 취급할 「최건우」 선택');
  if (t) asDigimonUntilOpp(ctx, t, true);
});
// BT13-099 최영재 【자신의 턴 종료 시】[턴에 1회] 서로의 시큐리티 합계가 6장 이하라면, 상대의 턴 종료까지 이 테이머는 디지몬·DP 3000으로도 취급하며, 《블로커》를 얻고, 진화할 수 없다.
sc('BT13-099::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, h = me(ctx);
  if (!h || state.players.p1.security.length + state.players.p2.security.length > 6) return;
  asDigimonUntilOpp(ctx, h, true);
});

// BT13-060 로제몬: 버스트 모드 【어택 시】 레스트 상태인 상대의 디지몬과 테이머 2마리(명)마다 상대의 시큐리티를 위에서부터 1장 파기한다. (generic discarded exactly one)
sc('BT13-060::어택 시', async (ctx, R) => {
  const n = Math.floor(ctx.state.players[opp(ctx.self)].battle.filter(s => (isDig(s) || isTam(s)) && s.suspended).length / 2);
  for (let i = 0; i < n; i++) await R.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx);
});
// BT13-092 레이브몬: 버스트 모드 【어택 시】 상대의 트래시에서 디지몬 카드 1장을 덱 아래로 되돌리는 것으로, 되돌린 카드와 같은 명칭의 상대의 디지몬 전부를 소멸시킨다. (generic destroyed EVERY opposing Digimon)
sc('BT13-092::어택 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), pl = state.players[o];
  const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).category === 'digimon');
  if (!idxs.length) return;
  const k = await pickFromList(ctx, ctx.self, pl.trash, idxs, '덱 아래로 되돌릴 상대 트래시의 디지몬 카드 선택 (안 해도 됨)');
  if (k == null) return;
  const [id] = pl.trash.splice(k, 1);
  pl.deck.push(id);
  S.log(state, `${o} 트래시의 ${C(id).nameKo}을(를) 덱 아래로 되돌림`);
  const retNames = S.cardNames(id); // idx1693/1694: "같은 명칭" — every name of the returned card (〈룰〉 aliases included) vs every name of the opp digimon; a plain same-name card only matches the exact name
  for (const s of pl.battle.filter(x => isDig(x) && retNames.some(n => S.effectiveInfo(state, x, o).nameIs(n)))) S.deleteStack(state, o, s.uid, 'trash', 'effect');
});
// BT13-094 최민지 【등장 시】 상대의 턴 종료까지 자신의 디지몬 1마리는 「【소멸 시】 자신의 패/트래시에서 「피요몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.」의 효과를 얻는다. (generic compiled a bogus "패에서 아무 카드 등장" + truncated label at the nested 「」)
SCRIPTS['BT13-094::등장 시'] = [{ op: 'grantText', trigger: 'delete', label: '자신의 패/트래시에서 「피요몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.', until: 'opponentTurn', side: 'self', all: false, n: 1 }];
// BT14-047 스파이더몬 【등장 시】【진화 시】 상대의 디지몬 1마리를 레스트시킨다. 그 후, 다음 상대의 액티브 페이즈에서는 DP 5000 이하의 상대의 디지몬 전부는 액티브가 되지 않는다.
sc('BT14-047::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
  const o = opp(ctx.self);
  S.addLateUnsuspendSkip(ctx.state, o, { kind: 'dpMax', dpMax: 5000 }); // idx1769: "DP 5000 이하의 상대의 디지몬 전부" — judged at the active phase (later DP changes / arrivals count)
});
// BT13-089 레이브몬 【자신의 턴 종료 시】 진화원에 특징으로 「조」/「새」/「병아리」를 포함하는 카드가 있는 이 디지몬을 소멸시키는 것으로, 다음 상대의 턴 종료 시에, 자신의 트래시에서 「레이브몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
// (was a generic manualCost: the destroy-self cost was never actually paid — the free re-play got scheduled while the digimon stayed on the field). idx1690/1691.
sc('BT13-089::자신의 턴 종료 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  if (!st || !st.sources.some(id => (C(id).types || []).some(t => /조|새|병아리/.test(t)))) return;
  if (!(await ask(ctx, '이 디지몬을 소멸시키고, 다음 상대의 턴 종료 시에 트래시에서 「레이브몬」 1장을 등장시킬까요?'))) return;
  S.deleteStack(state, ctx.self, st.uid, 'trash', 'ownEffect');
  if (findStack(state, ctx.self, st.uid)) return; // it survived (a replacement): the cost was not paid
  await R.runOne({ op: 'atTurnEnd', when: 'opp', then: [{ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['레이브몬'] }, rested: false, noTriggers: false, optional: true }] }, ctx);
});
// BT13-033 미라쥬가오가몬: 버스트 모드 【어택 시】 상대의 패가 9장 이상이라면, 상대의 패가 8장이 되도록 보지 않고 선택하여 덱 아래로 되돌리는 것으로, 이 디지몬을 액티브로 한다.
// (was a manual cost). idx1641/1642: the effect's owner picks WITHOUT looking (the cards' owner may still look at his own hand until they go back) -> a blind pick = random cards, random order.
sc('BT13-033::어택 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self), pl = state.players[o], st = me(ctx);
  if (pl.hand.length < 9) return;
  const k = pl.hand.length - 8;
  for (let i = 0; i < k; i++) { const idx = Math.floor(Math.random() * pl.hand.length); const [id] = pl.hand.splice(idx, 1); pl.deck.push(id); }
  S.log(state, `${o} 패 ${k}장을 (보지 않고 선택하여) 덱 아래로 되돌림`);
  if (st) S.unsuspendStack(state, ctx.self, st.uid);
});
// BT13-108 엔드·왈츠 【메인】 상대의 턴 종료까지 자신의 디지몬 1마리는 「【상대의 턴】 이 디지몬이 레스트했을 때, 이 디지몬의 등장 코스트 이하의 상대의 디지몬 전부를 소멸시킨다.」와
// 「【상대의 턴】 이 디지몬은 상대의 옵션 카드의 효과를 받지 않는다.」의 효과를 얻는다. (was a manual noop; two granted effects) — idx1714/1715: the option immunity also covers the option's 【시큐리티】 effect,
// while the granted destroy effect is a DIGIMON effect (option immunity does not stop it).
const BT13108_LABEL = '이 디지몬의 등장 코스트 이하의 상대의 디지몬 전부를 소멸시킨다.';
sc('BT13-108::메인', async (ctx) => {
  const { state } = ctx, mine = state.players[ctx.self];
  const t = await pickStack(ctx, ctx.self, mine.battle.filter(isDig), '「효과」를 얻을 자신의 디지몬 선택');
  if (!t) return;
  const until = state.activePlayer === ctx.self ? state.turnNumber + 1 : state.turnNumber;
  S.grantShield(state, ctx.self, t.uid, { kinds: ['all'], until, fromCategory: 'option' });
  (t.s2Granted ||= []).push({ trigger: 'g:rest', label: BT13108_LABEL, until, turnTag: '상대의 턴', cardId: 'BT13-108' });
  S.log(state, `${ctx.self} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 「레스트했을 때 소멸」 효과와 「상대의 옵션 카드 효과를 받지 않음」을 얻음`);
});
SCRIPTS[`BT13-108::부여:${BT13108_LABEL}`] = [fn(async (ctx) => {
  const { state } = ctx, st = findStack(state, ctx.self, ctx.sourceStackUid); if (!st) return;
  const cost = C(st.cardId).cost ?? 0, o = opp(ctx.self);
  for (const s of [...state.players[o].battle]) if (isDig(s) && (C(s.cardId).cost ?? 99) <= cost) S.deleteStack(state, o, s.uid, 'trash', 'effect');
})];
// BT12-088 (진화원) 【자신의 턴】 이 디지몬을 DP +2000. DP 10000 이상의 이 디지몬은 「【자신의 턴】[턴에 1회] 이 디지몬이 상대의 시큐리티를 체크했을 때, 메모리 +2.」의 효과를 얻는다.
// (was a manual noop for the granted memory+2). idx1576-1578: DP >= 10000 is judged when the effect resolves (after the checked card's 【시큐리티】 effect, before the security battle).
DI('BT12-088', '자신의 턴', '체크했을 때', { limit: 1, events: { securityChecked: (state, hp, h, info) => info.owner === hp && info.stack === h && S.effectiveDP(state, hp, h) >= 10000 } });
sc('BT12-088::자신의 턴', async (ctx) => {
  const h = me(ctx); if (!h || S.effectiveDP(ctx.state, ctx.self, h) < 10000) return;
  S.grantMemory(ctx.state, ctx.self, 2, ctx.sourceCardId);
});
// BT14-088 흰수염 도사 【상대의 턴】 Lv.5 이상의 상대의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 육성 에어리어의 자신의 디지몬 1마리를 배틀 에어리어로 이동시킨다.
// (was a generic manual noop). idx1816/1817: a DP-less raising digimon (Lv.2 / 위그드라실_7D6) cannot move; 마더 디·리퍼 (has DP) can. An effect-move is not the once-per-breeding-phase action.
sc('BT14-088::상대의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!pl.raising) return;
  const saved = state.breedingActionTaken; state.breedingActionTaken = false;
  try { S.moveRaisingToBattle(state, ctx.self); } finally { state.breedingActionTaken = saved; }
});
// BT14-030 마린엔젤몬 【등장 시/진화 시】 Lv.3의 상대의 디지몬 1마리 또는 자신의 디지몬 1마리를 패로 되돌리는 것으로, 되돌린 디지몬의 Lv. 이하의 상대의 디지몬 1마리를 패로 되돌린다.
// (was a generic manualCost). idx1753-1757: any own digimon is legal; a Lv-less returned card (마더 디·리퍼 / token) still pays the cost but leaves no Lv to reference -> no second bounce.
sc('BT14-030::등장 시', async (ctx, R) => {
  const { state } = ctx, mine = ctx.self, o = opp(mine);
  const entries = [];
  for (const s of state.players[o].battle) if (isDig(s) && C(s.cardId).level === 3 && !S.effectBlocked(state, o, s, 'bounce')) entries.push({ player: o, uid: s.uid });
  for (const s of state.players[mine].battle) if (isDig(s) || C(s.cardId).category === 'digitama') entries.push({ player: mine, uid: s.uid });
  if (!entries.length) return;
  const pick = entries.length === 1 ? entries[0] : await ctx.choose('pickStackAnySide', { entries, prompt: '패로 되돌릴 Lv.3의 상대 디지몬 또는 자신의 디지몬 선택 (취소 = 비용을 지불하지 않음)' });
  if (!pick) return;
  const st = findStack(state, pick.player, pick.uid); if (!st) return;
  const lv = C(st.cardId).level ?? null;
  ctx._lastPick = { player: pick.player, uid: pick.uid };
  await R.runOne({ op: 'returnToHandStripSources', last: true, target: pick.player === mine ? 'self' : 'opponent' }, ctx);
  if (findStack(state, pick.player, pick.uid)) return; // it did not leave: the cost was not paid
  if (lv == null) { S.log(state, `${mine} 되돌린 카드가 Lv.를 가지지 않아 Lv.를 참조할 수 없음 — 상대의 디지몬을 되돌리지 못함`); return; }
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: lv } }, ctx);
});
SCRIPTS['BT14-030::진화 시'] = SCRIPTS['BT14-030::등장 시'];
SCRIPTS['BT14-047::진화 시'] = SCRIPTS['BT14-047::등장 시'];
// BT14-049 릴리몬 【등장 시】【진화 시】 상대의 디지몬 1마리를 레스트시킨다. 그 후, DP 5000 이하의 레스트 상태인 상대의 디지몬 1마리를 덱 아래로 되돌릴 수 있다.
sc('BT14-049::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
  const o = opp(ctx.self);
  if (!ctx.state.players[o].battle.some(x => isDig(x) && x.suspended && S.effectiveDP(ctx.state, o, x) <= 5000)) return;
  if (!(await ask(ctx, 'DP 5000 이하의 레스트 상태인 상대의 디지몬 1마리를 덱 아래로 되돌릴까요?'))) return;
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { dpMax: 5000, suspended: true }, requireSuspended: null, dest: 'deckBottom' }, ctx);
});
SCRIPTS['BT14-049::진화 시'] = SCRIPTS['BT14-049::등장 시'];
// BT15-039 보머몬 【등장 시】【진화 시】 상대의 턴 종료까지 상대의 디지몬 1마리에게 「【소멸 시】 메모리 -1.」의 효과를 주고, DP -3000. (generic dropped the DP -3000; both apply to the SAME Digimon)
sc('BT15-039::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, ctx.self, state.players[o].battle.filter(isDig), '「【소멸 시】 메모리 -1」 부여 + DP -3000 할 상대의 디지몬 선택');
  if (!t) return;
  (t.s2Granted ||= []).push({ trigger: 'delete', label: '메모리 -1.', until: untilOppTurnEnd(state, ctx.self) });
  S.modifyDP(state, o, t.uid, -3000, 'opponentTurn');
});
SCRIPTS['BT15-039::진화 시'] = SCRIPTS['BT15-039::등장 시'];

// BT14-076 스컬그레이몬 【진화 시】 자신의 패 1장을 파기하는 것으로, 가장 Lv.이 낮은 자신의 디지몬 1마리와 가장 Lv.이 낮은 상대의 디지몬 1마리를 소멸시킨다. (generic only destroyed the opponent's)
sc('BT14-076::진화 시', async (ctx, R) => {
  await R.runOne({ op: 'costGroup', cost: [{ op: 'trashHand', who: 'self', n: 1 }], then: [{ op: 's35_fn', fn: async (c2) => {
    const { state } = c2;
    for (const p of [c2.self, opp(c2.self)]) {
      const ds = state.players[p].battle.filter(isDig); if (!ds.length) continue;
      const lo = Math.min(...ds.map(s => C(s.cardId).level ?? 0));
      const t = await pickStack(c2, c2.self, ds.filter(s => (C(s.cardId).level ?? 0) === lo), `소멸시킬 가장 Lv.이 낮은 ${p === c2.self ? '자신' : '상대'}의 디지몬 선택`);
      if (t) S.deleteStack(state, p, t.uid, 'trash', p === c2.self ? 'ownEffect' : 'effect');
    }
  } }] }, ctx);
});
// BT14-077 스컬사탄몬 【등장 시】【진화 시】 서로의 덱 위에서부터 2장 파기한다. (generic only trashed the owner's)
sc('BT14-077::등장 시', async (ctx, R) => { await R.runOne({ op: 'trashDeckTop', who: 'self', n: 2 }, ctx); await R.runOne({ op: 'trashDeckTop', who: 'opponent', n: 2 }, ctx); });
SCRIPTS['BT14-077::진화 시'] = SCRIPTS['BT14-077::등장 시'];
// BT14-078 헬루가몬 【자신의 턴 종료 시】 이 디지몬을 소멸시키고, 《2 드로우》. 그 후, 자신의 트래시에서 「루가몬」 1장을 패로 되돌릴 수 있다. (generic never destroyed itself)
sc('BT14-078::자신의 턴 종료 시', async (ctx, R) => {
  const h = me(ctx);
  if (h) S.deleteStack(ctx.state, ctx.self, h.uid, 'trash', 'ownEffect');
  await R.runOne({ op: 'draw', who: 'self', n: 2 }, ctx);
  await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { exactAny: ['루가몬'] } }, ctx);
});
// BT14-080 데스몬 【진화 시】【어택 시】[턴에 1회] 자신의 트래시 10장마다 상대의 덱 위에서부터 3장 파기한다. (generic trashed the OWNER's deck)
sc('BT14-080::진화 시', async (ctx, R) => {
  const n = Math.floor(ctx.state.players[ctx.self].trash.length / 10);
  if (n > 0) await R.runOne({ op: 'trashDeckTop', who: 'opponent', n: 3 * n }, ctx);
});
// BT15-029 메가시드라몬 【등장 시】【진화 시】 블루인 다른 자신의 디지몬 1마리를 이 디지몬의 진화원 아래에 놓는 것으로, 놓은 카드의 Lv. 이하의 상대의 디지몬 1마리를 덱 아래로 되돌린다. (generic ignored the Lv cap)
sc('BT15-029::등장 시', async (ctx, R) => {
  const { state } = ctx, h = me(ctx); if (!h) return;
  const pl = state.players[ctx.self];
  const t = await pickStack(ctx, ctx.self, pl.battle.filter(s => s !== h && isDig(s) && S.stackColors(s).includes('blue')), '이 디지몬의 진화원 아래에 놓을 블루의 다른 디지몬 선택 (안 해도 됨)');
  if (!t) return;
  const lv = C(t.cardId).level ?? 0;
  pl.battle.splice(pl.battle.indexOf(t), 1);
  pl.trash.push(...(t.linkCards || []).map(l => l.cardId));
  h.sources.splice(S.fdCount(h), 0, ...t.sources, t.cardId);
  S.recomputeStackGrants(h);
  S.log(state, `${ctx.self} ${C(t.cardId).nameKo}을(를) ${C(h.cardId).nameKo}의 진화원 아래에 놓음`);
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: lv }, requireSuspended: null, dest: 'deckBottom' }, ctx);
});
SCRIPTS['BT15-029::진화 시'] = SCRIPTS['BT15-029::등장 시'];
// BT15-013 버드라몬 【진화 시】 자신의 트래시에서 레드인 디지몬 카드 1장을 패로 되돌린다. ▷특징으로 「조」/「새」/「병아리」/「수」/「짐승」을 포함(「수장룡형」/「수생형」/「수생포유류형」/「정보수집 타입」은 제외) (generic had no exclusion list)
const BIRDBEAST_EXCL = ['수장룡형', '수생형', '수생포유류형', '정보수집 타입'];
const birdBeast = (id) => (C(id).types || []).some(t => ['조', '새', '병아리', '수', '짐승'].some(k => t.includes(k)) && !BIRDBEAST_EXCL.includes(t));
sc('BT15-013::진화 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const idxs = pl.trash.map((id, i) => i).filter(i => C(pl.trash[i]).category === 'digimon' && (C(pl.trash[i]).colors || []).includes('red') && birdBeast(pl.trash[i]));
  if (!idxs.length) return;
  const k = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: '패로 되돌릴 레드의 「조/새/병아리/수/짐승」 디지몬 선택' });
  if (k == null) return;
  const [id] = pl.trash.splice(k, 1); pl.hand.push(id);
  S.log(state, `${ctx.self} 트래시의 ${C(id).nameKo}을(를) 패로`);
});

// ================================================================== "이 카드가 등장할 때, …지불하는 등장 코스트 -N" (hand play) — printed on the card being played
const battleDigs = (state, p) => state.players[p].battle.filter(isDig);
// BT13-045 킹체스몬: 패의 이 카드가 등장할 때, 자신의 트래시에 명칭에 「체스몬」을 포함하는 디지몬 카드가 8장 이상 있다면 지불하는 등장 코스트 -8.
HOOKS['BT13-045'] = [...(HOOKS['BT13-045'] || []), { tag: '__handPlay', selfPlayDiscount: (state, hp) => (state.players[hp].trash.filter(id => C(id).category === 'digimon' && C(id).nameKo.includes('체스몬')).length >= 8 ? -8 : 0) }];
// BT13-111 듀크몬: 패의 이 카드가 등장할 때, 자신의 디지몬이 없다면 서로의 트래시 합계 5장마다 지불하는 등장 코스트 -2.
HOOKS['BT13-111'] = [...(HOOKS['BT13-111'] || []), { tag: '__handPlay', selfPlayDiscount: (state, hp) => (battleDigs(state, hp).length ? 0 : -2 * Math.floor((state.players.p1.trash.length + state.players.p2.trash.length) / 5)) }];
// BT13-080 프로토 기즈몬 / BT13-083 기즈몬: AT / BT13-086 기즈몬: XT — 이 카드가 등장할 때, <Lv.N>의 자신의 디지몬 1마리를 소멸시키는 것으로, 지불하는 등장 코스트 -X. (optional; 080 = 육성 에어리어의 Lv.2, the others = battle-area Digimon)
for (const [id, lv, disc, raising] of [['BT13-080', 2, -2, true], ['BT13-083', 3, -4, false], ['BT13-086', 4, -6, false]]) {
  HOOKS[id] = [...(HOOKS[id] || []), { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
    const pl = state.players[p];
    const cands = () => (raising ? [pl.raising] : battleDigs(state, p)).filter(s => s && (isDig(s) || (raising && C(s.cardId).category === 'digitama')) && (C(s.cardId).level ?? -1) === lv); // (a hatched Digi-Egg counts as the Lv.2 Digimon)
    if (!cands().length) return null;
    return { label: `${C(cardId).nameKo}: ${raising ? '육성 에어리어의 ' : ''}Lv.${lv}의 자신의 디지몬 1마리를 소멸시켜 등장 코스트 ${disc}?`, async apply(choose) {
      const cs = cands();
      const uid = cs.length === 1 ? cs[0].uid : await choose('pickStack', { player: p, uids: cs.map(s => s.uid), prompt: `소멸시킬 Lv.${lv}의 디지몬 선택` });
      if (!uid) return 0;
      const before = pl.raising === cs.find(s => s.uid === uid) || pl.battle.some(s => s.uid === uid);
      S.deleteStack(state, p, uid, 'trash', 'ownEffect');
      const gone = !(pl.raising?.uid === uid) && !pl.battle.some(s => s.uid === uid);
      return before && gone ? disc : 0;
    } };
  } }];
}

// BT14-101 워그레이몬 / BT15-101 메탈가루몬: <명칭에 「X」를 포함하는 자신의 테이머>와 DP 10000 이상의 상대의 디지몬이 있는 동안, 자신의 「Y」는 패의 이 카드로 진화 조건을 무시하고 진화 코스트 4로 진화할 수 있다.
for (const [id, tamerName, baseName] of [['BT14-101', '신태일', '아구몬'], ['BT15-101', '매튜', '파피몬']]) {
  HOOKS[id] = [...(HOOKS[id] || []), { tag: '진화', has: '진화 조건을 무시', evoTargetAlt: (state, p, stack, tid) => {
    if (tid !== id || !stack || !isDig(stack) || !S.cardNameIs(stack.cardId, baseName)) return null;
    const pl = state.players[p], op = state.players[opp(p)];
    if (!pl.battle.some(s => isTam(s) && C(s.cardId).nameKo.includes(tamerName))) return null;
    if (!op.battle.some(s => isDig(s) && S.effectiveDP(state, opp(p), s) >= 10000)) return null;
    return { cost: 4, test: (tgt) => tgt.id === tid };
  } }];
}

// BT15-067 오류우몬 【진화 시】 이 디지몬의 진화원에 특징으로 「디지대」를 가진 테이머 카드가 있다면, 레스트 상태인 상대의 디지몬/테이머 1마리(명)를 덱 아래로 되돌린다. (the generic op only offered Digimon)
sc('BT15-067::진화 시', async (ctx, R) => {
  const h = me(ctx); if (!h) return;
  if (!h.sources.slice(S.fdCount(h)).some(id => C(id).category === 'tamer' && hasType(id, '디지대'))) return;
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, anyKind: true, filter: {}, requireSuspended: true, dest: 'deckBottom' }, ctx);
});
