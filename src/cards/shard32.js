// Shard 32 — batch-2 verification fixes (BT4-/BT5-/BT6- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-BT4-6.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's32_fn', fn: f });
OPS.s32_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const faceUp = (h) => h.sources.slice(S.fdCount(h));
const ownFx = (state, hp) => !!state._fxSrc && state._fxSrc.player === hp; // the effect being resolved is hp's own
const oppDigimon = (state, hp) => state.players[opp(hp)].battle.filter(isDig);
const digiburstOwner = (st) => C(st.cardId).effectKo?.includes('《디지버스트');

// ======================================================================= continuous (dp / colors / keywords)
// BT4-016 아루다몬 【자신의 턴】 진화원에 「하이브리드체」 디지몬 카드 또는 레드인 테이머 카드가 존재하는 동안 DP +4000 (unparsed "존재하는" phrasing)
D('BT4-016', '자신의 턴', '존재하는 동안', { dp: (state, hp, h, t) => (t === h && faceUp(h).some(id => { const c = C(id); return (c.category === 'digimon' && (c.types || []).includes('하이브리드체')) || (c.category === 'tamer' && (c.colors || []).includes('red')); }) ? 4000 : 0) });
// 「X로도 취급」 (continuous colour grants that had no descriptor)
D('BT4-017', '자신의 턴', '옐로로도 취급', { addColors: () => ['yellow'] });
D('BT6-013', '자신의 턴', '블랙으로도 취급', { addColors: () => ['black'] });
D('BT6-061', '자신의 턴', '레드로도 취급', { addColors: () => ['red'] });
D('BT6-077', '서로의 턴', '블랙으로도 취급', { addColors: () => ['black'] });
// BT4-066 록몬 【서로의 턴】 블랙인 자신의 디지몬 전부 DP +1000
D('BT4-066', '서로의 턴', 'DP를 +1000', { dp: (state, hp, h, t, tp) => (tp === hp && state.players[hp].battle.includes(t) && isDig(t) && S.stackColors(t).includes('black') ? 1000 : 0) });
// BT4-094 신태일 【자신의 턴】 자신의 시큐리티가 3장 이하인 동안 자신의 디지몬 전부 DP +1000
D('BT4-094', '자신의 턴', '3장 이하인 동안', { dp: (state, hp, h, t, tp) => (tp === hp && state.players[hp].battle.includes(t) && isDig(t) && state.players[hp].security.length <= 3 ? 1000 : 0) });
// (BT4-073 반쵸록몬 【상대의 턴】 상대의 디지몬이 3마리 이상 있는 동안 DP +3000 is now handled by the generic continuous parser)
// BT5-045 로드나이트몬 【서로의 턴】 자신의 다른 디지몬 1마리마다 DP +1000 / BT5-053 뿌띠몬 【자신의 턴】 레스트 상태인 자신의 다른 디지몬 1마리마다 DP +2000
D('BT5-045', '서로의 턴', '1마리마다', { dp: (state, hp, h, t) => (t === h ? 1000 * state.players[hp].battle.filter(s => s !== h && isDig(s)).length : 0) });
D('BT5-053', '자신의 턴', '1마리마다', { dp: (state, hp, h, t) => (t === h ? 2000 * state.players[hp].battle.filter(s => s !== h && isDig(s) && s.suspended).length : 0) });
// BT6-020 기자몬 (진화원) 【자신의 턴】 진화원을 갖는 상대 디지몬이 없는 동안 DP +2000 ("갖는" spelling was not recognised)
DI('BT6-020', '자신의 턴', '진화원을 갖는', { dp: (state, hp, h, t) => (t === h && !oppDigimon(state, hp).some(s => s.sources.length > 0) ? 2000 : 0) });
// BT4-004 버드몬 (진화원) 【자신의 턴】 이 디지몬이 《디지버스트》를 가질 때 DP +1000 ("가질 때" spelling)
DI('BT4-004', '자신의 턴', '디지버스트', { dp: (state, hp, h, t) => (t === h && digiburstOwner(h) ? 1000 : 0) });
// BT6-010 화염몬 (진화원) 【자신의 턴】 특징으로 「하이브리드체」 또는 「10투사」를 가지는 동안 《관통》 ("그 디지몬은" subject)
DI('BT6-010', '자신의 턴', '관통', { kw: (state, hp, h, name) => name === '관통' && (S.effectiveInfo(state, h, hp).hasTrait('하이브리드체') || S.effectiveInfo(state, h, hp).hasTrait('10투사')) });
// BT5-063 크리사리몬 (진화원) 【자신의 턴】 이 디지몬과 명칭이 동일한 자신의 디지몬 전부는 《속공》
DI('BT5-063', '자신의 턴', '명칭이 동일한', { grantKw: (state, hp, h, t) => (isDig(t) && S.effectiveInfo(state, t, hp).names.some(n => S.effectiveInfo(state, h, hp).names.includes(n)) ? ['속공'] : []) });
// 《시큐리티 어택 +N》 per count
D('BT4-113', '자신의 턴', '1장마다', { kwNum: (state, hp, h) => faceUp(h).filter(id => { const c = C(id); return c.category === 'digimon' && (S.cardNameHas(id, '그레이몬') || (c.types || []).includes('하이브리드체')); }).length });
D('BT6-029', '자신의 턴', '1마리당', { kwNum: (state, hp, h) => oppDigimon(state, hp).filter(s => s.sources.length === 0).length });
// BT4-115 루체몬: 자신의 트래시가 10장 이상인 동안 패의 이 카드의 등장 코스트 -8
HOOKS['BT4-115'] = [{ tag: null, has: '등장 코스트를', src: 'effectKo', selfPlayDiscount: (state, p) => (state.players[p].trash.length >= 10 ? -8 : 0) }];
// BT5-062 메카노몬 / BT5-065 셰이드몬 【자신의 턴】 이 디지몬은 어택할 수 없다 (no generic handling of the bare sentence)
D('BT5-062', '자신의 턴', '어택할 수 없다', { noAttack: () => true });
D('BT5-065', '자신의 턴', '어택할 수 없다', { noAttack: () => true });

// ======================================================================= security digimon DP (checked when a security Digimon battles; info.p = defender)
D('BT4-045', '상대의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, h, info) => (info.p === hp && state.players[hp].security.length <= 3 ? 4000 : 0) });
DI('BT5-038', '자신의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, h, info) => (info.p !== hp ? -1000 : 0) });
DI('BT5-041', '자신의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, h, info) => (info.p !== hp ? -1000 : 0) });
D('BT5-044', '자신의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, h, info) => (info.p !== hp ? -3000 : 0) });

// ======================================================================= watchers that had no handler ("events" hooks)
// BT4-094 【자신의 턴】 상대 디지몬의 DP가 0이 되어 소멸했을 때, 이 테이머를 레스트시키는 것으로 메모리 +1
D('BT4-094', '자신의 턴', 'DP가 0이 되어', { events: { delete: (state, hp, h, info) => info.owner !== hp && !!info.dp0 } });
SCRIPTS['BT4-094::자신의 턴@DP가 0이 되어'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];
// BT4-020 샤인그레이몬 【자신의 턴】 레드 혹은 옐로인 자신의 테이머가 레스트했을 때, 이 턴 동안 이 디지몬은 《시큐리티 어택 +1》 (the "혹은" colour list was not parsed)
D('BT4-020', '자신의 턴', '레스트했을 때', { events: { rest: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'tamer' && S.stackColors(info.stack).some(c => c === 'red' || c === 'yellow') } });
SCRIPTS['BT4-020::자신의 턴'] = [{ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '시큐리티어택', value: 1, duration: 'turn' }];
// BT4-087 아누비스몬 【자신의 턴】 자신의 트래시에서 디지몬이 등장했을 때, 이 턴 동안 그 디지몬은 《속공》
D('BT4-087', '자신의 턴', '트래시에서 디지몬이 등장', { events: { play: (state, hp, h, info) => info.owner === hp && info.fromZone === 'trash' && !!info.stack && isDig(info.stack) } });
sc('BT4-087::자신의 턴', async (ctx) => { const uid = ctx.trigger?.evt?.stackUid; if (uid && findStack(ctx.state, ctx.self, uid)) S.grantKeyword(ctx.state, ctx.self, uid, '속공', undefined, 'turn'); });
// BT5-044 샤크라몬 【상대의 턴】 상대의 디지몬이 육성 에어리어에서 배틀 에어리어로 이동했을 때, 이 턴 동안 그 디지몬에게 《시큐리티 어택 -3》
D('BT5-044', '상대의 턴', '이동했을 때', { events: { move: (state, hp, h, info) => info.owner !== hp && !!info.stack && isDig(info.stack) } });
sc('BT5-044::상대의 턴', async (ctx) => { const uid = ctx.trigger?.evt?.stackUid; if (uid && findStack(ctx.state, ctx.opp, uid)) S.grantKeyword(ctx.state, ctx.opp, uid, '시큐리티어택', -3, 'turn'); });
// 자신의 효과로 자신의 패가 파기되었을 때 (BT6-006 / 069 / 073 inherited, BT6-081): "자신의 패가 자신의 효과로" was not parsed
const ownHandDiscard = { discard: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && ownFx(state, hp) };
DI('BT6-006', '자신의 턴', '패를 파기했을 때', { limit: 1, events: ownHandDiscard });
SCRIPTS['BT6-006::자신의 턴'] = [{ op: 'draw', who: 'self', n: 1 }];
DI('BT6-069', '자신의 턴', '패를 파기했을 때', { limit: 1, events: ownHandDiscard });
SCRIPTS['BT6-069::자신의 턴'] = [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 2000, duration: 'turn' }];
DI('BT6-073', '자신의 턴', '패를 파기했을 때', { limit: 1, events: ownHandDiscard });
SCRIPTS['BT6-073::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];
D('BT6-081', '자신의 턴', '파기되었을 때', { limit: 1, events: ownHandDiscard });
SCRIPTS['BT6-081::자신의 턴'] = [{ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '시큐리티어택', value: 1, duration: 'turn' }, { op: 'modifyDP', target: 'self', thisStack: true, amount: 2000, duration: 'turn' }];
// 상대 디지몬의 진화원을 (자신의 효과로) 파기했을 때 (BT5-022 mem +1 / BT6-002 draw), inherited 【자신의 턴】〔턴에 1회〕
const oppSrcTrashed = { sourcesTrashed: (state, hp, h, info) => info.owner !== hp && info.cause === 'effect' && ownFx(state, hp) && isDig(info.stack) };
DI('BT5-022', '자신의 턴', '진화원을 파기했을 때', { limit: 1, events: oppSrcTrashed });
SCRIPTS['BT5-022::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];
DI('BT6-002', '자신의 턴', '진화원을 파기했을 때', { limit: 1, events: oppSrcTrashed });
SCRIPTS['BT6-002::자신의 턴'] = [{ op: 'draw', who: 'self', n: 1 }];
// QA recheck2 (Q1430-1432): BT6-044 듀나스몬 【서로의 턴】[턴에 1회] 자신의 시큐리티가 줄어들었을 때, 자신의 시큐리티가 3장 이하라면 《리커버리 +1《덱》》 — the conditional text was filtered out of the generic event-watcher path (EW_UNSAFE) so it never fired; the printed condition is re-checked when it resolves (rc: 3장 이하), the compiler reads it as 「이하라면」 + recover.
D('BT6-044', '서로의 턴', '줄어들었을', { ewTrusted: true });
// BT5-056 라플레시몬 【자신의 턴】〔턴에 1회〕 자신의 디지몬이 《디지버스트》를 발휘했을 때, 다음 상대의 턴 종료 시까지 상대 디지몬 1마리는 어택과 블록을 할 수 없다
// ('digiburst' is emitted by the trashEvoSources op when a 《디지버스트》 cost was paid)
D('BT5-056', '자신의 턴', '디지버스트》를 발휘했을 때', { limit: 1, events: { digiburst: (state, hp, h, info) => info.owner === hp } });
sc('BT5-056::자신의 턴', async (ctx) => {
  const { state } = ctx;
  const uids = oppDigimon(state, ctx.self).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids, prompt: '다음 상대의 턴 종료 시까지 어택과 블록을 할 수 없게 할 상대 디지몬 선택' });
  const st = uid && findStack(state, ctx.opp, uid); if (!st) return;
  const until = S.durationEnd(state, 'nextOpponentTurn');
  (st.s1 ||= {}).noAttack = until; st.s1.noBlock = until;
  S.log(state, `${ctx.opp} ${C(st.cardId).nameKo} 다음 상대의 턴 종료 시까지 어택·블록 불가`);
});

// ======================================================================= scripts
// BT4-002 둥실몬 (진화원) 【어택 시】 Lv.4 이하의 상대 디지몬 1마리의 진화원을 아래에서부터 1장 파기 (the Lv.4 이하 restriction was dropped)
SCRIPTS['BT4-002::어택 시'] = [{ op: 'trashEvoSources', target: 'opponent', stacks: 1, count: 1, from: 'bottom', filter: { levelMax: 4 } }];
// BT4-034 레가렉스몬 【어택 시】 진화원을 아래에서부터 1장 파기한다. 그렇게 했을 때, 1 드로우하여 메모리 +1 (was unconditional)
sc('BT4-034::어택 시', async (ctx) => {
  const { state } = ctx;
  const uids = oppDigimon(state, ctx.self).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids, prompt: '진화원을 파기시킬 디지몬 선택' });
  if (!uid) return;
  const removed = S.trashEvoSources(state, ctx.opp, uid, 1, 'bottom');
  if (!removed || !removed.length) return;
  S.drawCards(state, ctx.self, 1);
  S.grantMemory(state, ctx.self, 1, ctx.sourceCardId);
});
// BT4-048 워그레이몬 【어택 시】〔턴에 1회〕 시큐리티 위 1장을 패에 추가하는 것으로 이 디지몬을 액티브로 하고, 상대 디지몬 1마리 DP -6000 (the unsuspend was dropped)
SCRIPTS['BT4-048::어택 시'] = [{ op: 'costGroup', cost: [{ op: 'securityTopToHand', who: 'self', n: 1 }], then: [{ op: 'unsuspend', target: 'thisStack' }, { op: 'modifyDP', target: 'opponent', amount: -6000, duration: 'turn' }] }];
// BT4-091 카오스몬: 발두르 암 【진화 시】 이하의 효과를 2회 발휘한다 (was once)
SCRIPTS['BT4-091::진화 시'] = [{ op: 'modifyDP', target: 'opponent', amount: -7000, duration: 'turn' }, { op: 'modifyDP', target: 'opponent', amount: -7000, duration: 'turn' }];
// BT6-016 제스몬 【자신의 턴】〔턴에 1회〕 다른 디지몬 등장: 이 디지몬 DP +3000 & 《관통》 (the keyword asked to pick a Digimon)
SCRIPTS['BT6-016::자신의 턴'] = [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'turn' }, { op: 'grantKeyword', target: 'self', thisStack: true, keyword: '관통', duration: 'turn' }];
// BT5-031 메탈가루몬 【진화 시】 진화원에 「가루몬」이 있을 때, 【소멸 시】 효과를 가진 상대의 디지몬 1마리를 덱 아래로 (the 【소멸 시】 filter was dropped)
const hasDeleteEffect = (s) => C(s.cardId).effectKo?.includes('【소멸 시】') || faceUp(s).some(id => C(id).inheritedKo?.includes('【소멸 시】'));
sc('BT5-031::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st || !st.sources.some(id => C(id).category === 'digimon' && C(id).nameKo.includes('가루몬'))) return;
  const uids = oppDigimon(ctx.state, ctx.self).filter(hasDeleteEffect).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids, prompt: '덱 아래로 되돌릴 【소멸 시】 효과를 가진 상대 디지몬 선택' });
  if (uid) await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', last: true, dest: 'deckBottom' }, ctx);
});
// BT5-057 로제몬 【메인】《디지버스트 3》 이 턴 동안 《디지버스트》를 갖는 자신의 디지몬 전부는 《시큐리티 어택 +1》 (was: asked to pick one Digimon)
SCRIPTS['BT5-057::메인'] = [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 3, digiburst: true }], then: [fn(async (ctx) => {
  for (const s of ctx.state.players[ctx.self].battle) if (isDig(s) && digiburstOwner(s)) S.grantKeyword(ctx.state, ctx.self, s.uid, '시큐리티어택', 1, 'turn');
})] }];
// BT5-071 길몬 【소멸 시】 효과로 소멸했을 때, 메모리 +1 (was unconditional)
sc('BT5-071::소멸 시', async (ctx) => { const info = ctx.state.deletedInfo?.[ctx.sourceStackUid]; if (info && (info.cause === 'effect' || info.cause === 'ownEffect')) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId); });
// BT5-083 메기드라몬 【진화 시】 서로의 덱 위에서부터 5장 파기 (only the own deck was trashed)
sc('BT5-083::진화 시', async (ctx) => { S.trashTopOfDeck(ctx.state, ctx.self, 5); S.trashTopOfDeck(ctx.state, ctx.opp, 5); });
// BT5-112 오메가몬 즈왈트 DEFEAT 【시큐리티】 배틀을 진행하지 않고, 이 카드를 코스트를 지불하지 않고 등장시킨다 (generic compile played a HAND card)
SCRIPTS['BT5-112::시큐리티'] = [{ op: 'playThisFree' }];
// BT6-042 할매몬 【소멸 시】 패에서 「로제몬」 1장 또는 옐로인 Lv.3의 디지몬 카드 2장까지 (either ONE 로제몬 OR up to two yellow Lv.3, not a mix)
sc('BT6-042::소멸 시', async (ctx, R) => {
  const hand = ctx.state.players[ctx.self].hand;
  const rose = hand.some(id => C(id).category === 'digimon' && C(id).nameKo === '로제몬');
  const yel = hand.some(id => C(id).category === 'digimon' && C(id).level === 3 && (C(id).colors || []).includes('yellow'));
  if (!rose && !yel) return;
  let mode = rose ? 'rose' : 'yellow';
  if (rose && yel) { const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '등장시킬 카드를 선택', options: ['「로제몬」 1장', '옐로인 Lv.3 디지몬 2장까지', '취소'] }); if (k === 0) mode = 'rose'; else if (k === 1) mode = 'yellow'; else return; }
  if (mode === 'rose') await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', exactAny: ['로제몬'] }, rested: false, noTriggers: false, optional: true }, ctx);
  else for (let i = 0; i < 2; i++) await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', level: 3, colors: ['yellow'] }, rested: false, noTriggers: false, optional: true }, ctx);
});
// BT6-078 스컬그레이몬 자신의 효과로 이 카드가 패로부터 파기되었을 때, 이 카드를 퍼플인 자신의 디지몬 1마리의 진화원의 가장 밑에 놓을 수 있다 (no handler: stayed in the trash)
sc('BT6-078::__ownDiscard', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!pl.trash.includes(ctx.sourceCardId)) return;
  if (!pl.battle.some(s => isDig(s) && S.stackColors(s).includes('purple'))) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `${C(ctx.sourceCardId).nameKo}을(를) 퍼플인 자신의 디지몬의 진화원 가장 밑에 놓을까요?` }))) return;
  await R.runOne({ op: 'placeThisUnderSource', filter: { colors: ['purple'] } }, ctx);
});
// BT4-093 토마 H 노르슈타인 【메인】 상대의 패가 8장 이상일 때, 이 테이머를 레스트시키는 것으로 명칭에 「가오」를 포함한 자신의 디지몬 1마리를 액티브로 한다 (the name filter was dropped: any Digimon could be picked)
SCRIPTS['BT4-093::메인'] = [{ op: 'condition', if: { test: (ctx) => ctx.state.players[ctx.opp].hand.length >= 8 }, then: [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [fn(async (ctx) => {
  const { state } = ctx;
  const uids = state.players[ctx.self].battle.filter(s => isDig(s) && s.suspended && S.cardNameHas(s.cardId, '가오')).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids, prompt: '액티브로 만들 명칭에 「가오」를 포함한 디지몬 선택' });
  if (uid) S.unsuspendStack(state, ctx.self, uid);
})] }], else: [] }];
// BT5-091 아이바 타쿠미 【서로의 턴】 Lv.3의 디지몬 전부에게 「【어택 시】 메모리를 -1 한다.」의 효과를 준다 (was not implemented): whenever a Lv.3 Digimon of either player attacks, its controller loses 1 memory
D('BT5-091', '서로의 턴', 'Lv.3의 디지몬 전부', { events: { attack: (state, hp, h, info) => !!info.stack && isDig(info.stack) && C(info.stack.cardId).level === 3 } });
sc('BT5-091::서로의 턴@Lv.3의 디지몬 전부', async (ctx) => { const who = ctx.trigger?.evt?.owner || ctx.self; S.grantMemory(ctx.state, who, -1, ctx.sourceCardId); });
// QA recheck2 (Q1354 BT5-085 / BT8-043): "패의 이 카드를 등장시킬 때, 자신의 「X」 1마리를 소멸시키는 것으로, 지불하는 등장 코스트 -N" hand-play cost options were never wired up (the sacrifice is optional, a 「디아블로몬」 token counts).
const sacrificeHandPlay = (id, pred, disc, what) => (HOOKS[id] ||= []).push({ tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const cands = () => state.players[p].battle.filter(s => isDig(s) && pred(state, p, s));
  if (!cands().length) return null;
  return { label: `${C(cardId).nameKo}: ${what} 1마리를 소멸시켜 등장 코스트 ${disc}?`, async apply(choose) {
    const cs = cands(); if (!cs.length) return 0;
    const uid = cs.length === 1 ? cs[0].uid : await choose('pickStack', { player: p, uids: cs.map(s => s.uid), prompt: `소멸시킬 ${what} 선택` });
    if (!uid) return 0;
    const ok = S.deleteStack(state, p, uid, 'trash', 'ownEffect');
    return ok || !state.players[p].battle.some(s => s.uid === uid) ? disc : 0;
  } };
} });
sacrificeHandPlay('BT5-085', (state, p, s) => S.effectiveInfo(state, s, p).nameIs('디아블로몬'), -12, '자신의 「디아블로몬」');
sacrificeHandPlay('BT8-043', (state, p, s) => S.effectiveInfo(state, s, p).nameIs('케루비몬') && S.stackColors(s).includes('purple'), -8, '퍼플인 자신의 「케루비몬」');
