// Shard 36 — batch-6 audit (BT16/BT17/BT18) per-card fixes: watchers/scripts the generic compiler mishandled.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const fn = (f) => ({ op: 's36_fn', fn: f });
OPS.s36_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] = HOOKS[id] || []).push(d); };

// BT16-004: 배틀 승리 watcher with a "이 디지몬이 2색 이상이라면" gate the generic event-watcher path does not trust -> trust it (generic compile handles the color gate)
hk('BT16-004', { tag: '서로의 턴', has: '소멸시켰을 때', src: 'inheritedKo', ewTrusted: true });

const hasKw = (state, p, stack, k) => !!stack && (S.hasKeyword(stack, k) || (S.hookGrantedKeywords ? S.hookGrantedKeywords(state, p, stack).includes(k) : false));
const colorIs = (id, ...cs) => cs.some(c => (C(id).colors || []).includes(c));

// BT16-005 (inherited, 서로의 턴, 턴 1회): 《블로커》를 가진 다른 디지몬(어느 쪽이든)이 소멸했을 때 메모리 +1
hk('BT16-005', { tag: '서로의 턴', has: '소멸했을 때', src: 'inheritedKo', limit: 1, events: { delete: (state, hp, h, info) => !!info.stack && info.stack !== h && C(info.stack.cardId).category === 'digimon' && hasKw(state, info.owner, info.stack, '블로커') } });
SCRIPTS['BT16-005::서로의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];

// BT16-011 (자신의 턴, 턴 1회): 자신의 트래시에서 레드인 카드가 패로 되돌아갔을 때 -> 턴 종료까지 자신의 디지몬 1마리 《속공》
hk('BT16-011', { tag: '자신의 턴', has: '패로 되돌아갔을 때', limit: 1, events: { trashToHand: (state, hp, h, info) => info.owner === hp && !!info.cardId && colorIs(info.cardId, 'red') } });

// BT16-028 (서로의 턴): 상대의 디지몬이 효과로 등장/진화했을 때, 자신의 테이머가 있다면 이 디지몬을 패의 「황제드라몬: 파이터 모드」로 코스트 없이 "진화"시킬 수 있다 (generic compile made it a free PLAY)
sc('BT16-028::서로의 턴', async (ctx, R) => {
  const { state } = ctx;
  if (!state.players[ctx.self].battle.some(s => C(s.cardId).category === 'tamer')) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true, other: false, desc: null, name: null }, zone: 'hand', cardFilter: { exactAny: ['황제드라몬: 파이터 모드'] }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }, ctx);
});

// BT16-033 (자신의 턴): 이 디지몬이 상대의 시큐리티를 체크했을 때, 자신의 시큐리티 3장 이상이라면 메모리 +1. 그 후 2장 이하라면 《리커버리 +1《덱》》 (each sentence gated separately)
hk('BT16-033', { tag: '자신의 턴', has: '체크했을 때', events: { securityChecked: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT16-033::자신의 턴', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  if (pl.security.length >= 3) await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
  if (pl.security.length <= 2) await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
});

// BT16-047 (서로의 턴): 이 디지몬이 배틀에서 상대의 디지몬을 소멸시켰을 때, 자신의 시큐리티 3장 이상이라면 상대 시큐리티 위에서 1장 파기. 그 후 3장 이하라면 메모리 +2
hk('BT16-047', { tag: '서로의 턴', has: '소멸시켰을 때', events: { battleWin: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT16-047::서로의 턴', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  if (pl.security.length >= 3) await R.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx);
  if (pl.security.length <= 3) await R.runOne({ op: 'gainMemory', who: 'self', n: 2 }, ctx);
});

// BT16-069 (등장/진화 시): 진화원에 「연체몬」/「X항체」가 있다면 상대의 디지몬/테이머 1마리(명) 아래에서 선택하여 3장 파기. 그 후 (조건과 무관하게) 상대의 턴 종료까지 아래에 카드가 없는 상대의 디지몬/테이머 1마리(명)는 레스트할 수 없다.
const sc069 = async (ctx, R) => {
  const h = [ctx.state.players[ctx.self].raising, ...ctx.state.players[ctx.self].battle].filter(Boolean).find(s => s.uid === ctx.sourceStackUid);
  if (h && h.sources.some(id => S.cardNameHas(id, '연체몬') || S.cardNameHas(id, 'X항체'))) await R.runOne({ op: 'trashEvoSources', target: 'opponent', stacks: 1, count: 3, choose: true, anyKind: true, filter: { hasSources: true }, prompt: '아래 카드를 파기시킬 상대의 디지몬/테이머 선택' }, ctx);
  await R.runOne({ op: 'preventRest', target: 'opponent', n: 1, filter: { noSources: true }, expiresAfterTurn: 'opponentTurn', prompt: '레스트할 수 없게 할 상대의 디지몬/테이머 선택 (아래에 카드가 없는 것)' }, ctx);
};
sc('BT16-069::등장 시', sc069);
sc('BT16-069::진화 시', sc069);

// BT16-076 (서로의 턴): 특징 「SoC」를 가진 다른 자신의 디지몬이 소멸했을 때(워처가 큐잉), 진화원에 SoC 테이머 카드가 있는 이 디지몬을 트래시의 「펜리루가몬」으로 코스트 없이 진화시킬 수 있다 (generic compile was empty)
sc('BT16-076::서로의 턴', async (ctx, R) => {
  const h = [ctx.state.players[ctx.self].raising, ...ctx.state.players[ctx.self].battle].filter(Boolean).find(s => s.uid === ctx.sourceStackUid);
  if (!h || !h.sources.some(id => C(id).category === 'tamer' && (C(id).types || []).includes('SoC'))) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true, other: false, desc: null, name: null }, zone: 'trash', cardFilter: { exactAny: ['펜리루가몬'], category: 'digimon' }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }, ctx);
});

// BT16-080 (소멸 시): 자신의 시큐리티가 3장이 되도록 《리커버리 +1《덱》》 — repeat until the security stack holds 3 (nothing when it already has 3+); generic compile recovered exactly once
sc('BT16-080::소멸 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  for (let g = 0; pl.security.length < 3 && pl.deck.length && g < 5; g++) await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
});

// BT16-101 (서로의 턴, 턴 1회): 상대의 디지몬이 배틀 또는 DP가 0이 되어 소멸했을 때, 메모리 +2
hk('BT16-101', { tag: '서로의 턴', has: '소멸했을 때', limit: 1, events: { delete: (state, hp, h, info) => info.owner !== hp && !!info.stack && C(info.stack.cardId).category === 'digimon' && (info.cause === 'battle' || !!info.dp0) } });

// BT16-102 (진화 시): 진화원 조건이 맞으면 상대의 턴 종료까지 효과 면역 + DP+3000. "그 후, 이 디지몬을 액티브로 한다."는 별개 문장이므로 조건과 무관하게 항상 액티브 (shard3 판은 조건에 묶여 있었음)
sc('BT16-102::진화 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const st = [pl.raising, ...pl.battle].filter(Boolean).find(s => s.uid === ctx.sourceStackUid);
  if (!st) return;
  if (st.sources.some(id => C(id).nameKo === '매그너몬 X항체' || (C(id).types || []).includes('아머체'))) {
    const until = state.activePlayer === opp(ctx.self) ? state.turnNumber : state.turnNumber + 1;
    S.grantShield(state, ctx.self, st.uid, { kinds: ['all'], until });
    S.modifyDP(state, ctx.self, st.uid, 3000, 'opponentTurn');
  }
  if ([pl.raising, ...pl.battle].filter(Boolean).find(s => s.uid === st.uid)) S.unsuspendStack(state, ctx.self, st.uid);
});

// ===================================================================== BT17 watchers (generic parser could not read these phrasings)
const isDigimon = (st) => !!st && C(st.cardId).category === 'digimon';
const isTamerSt = (st) => !!st && C(st.cardId).category === 'tamer';
const fromOwnSources = { play: (state, hp, h, info) => info.owner === hp && !!info.stack && !!info.stack.playedFromSources && isDigimon(info.stack) };
const holderOf = (ctx) => [ctx.state.players[ctx.self].raising, ...ctx.state.players[ctx.self].battle].filter(Boolean).find(s => s.uid === ctx.sourceStackUid);

// BT17-002 (INH 자신의 턴, 턴 1회): 진화원에서 자신의 디지몬이 등장했을 때 《1 드로우》
hk('BT17-002', { tag: '자신의 턴', has: '진화원에서 자신의 디지몬이 등장했을 때', src: 'inheritedKo', limit: 1, events: fromOwnSources });
// BT17-082 (자신의 턴): 진화원에서 자신의 디지몬이 등장했을 때, 이 테이머를 레스트시키는 것으로 블루인 자신의 디지몬 1마리 《속공》
hk('BT17-082', { tag: '자신의 턴', has: '진화원에서 자신의 디지몬이 등장했을 때', events: fromOwnSources });
// BT17-003 (INH 자신의 턴, 턴 1회): 효과로 이 디지몬의 진화원에 테이머 카드가 놓였을 때 메모리 +1
hk('BT17-003', { tag: '자신의 턴', has: '진화원에 테이머 카드가 놓였을 때', src: 'inheritedKo', limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.stack === h && info.srcPlayer === hp && (info.added || []).some(id => C(id).category === 'tamer') } });
// BT17-008 (자신의 턴, 턴 1회): 자신의 「동글몬」 또는 명칭에 「오유민」을 포함하는 자신의 테이머가 등장했을 때
hk('BT17-008', { tag: '자신의 턴', has: '등장했을 때', limit: 1, events: { play: (state, hp, h, info) => info.owner === hp && !!info.stack && (S.cardNameIs(info.stack.cardId, '동글몬') || (isTamerSt(info.stack) && S.cardNameHas(info.stack.cardId, '오유민'))) } });
// BT17-034 (서로의 턴, 턴 1회): 자신의 시큐리티가 효과로 파기되었을 때, 이 디지몬의 진화원에 「레온 알렉산더」가 있다면 《리커버리 +1《덱》》
hk('BT17-034', { tag: '서로의 턴', has: '시큐리티가 효과로 파기되었을 때', limit: 1, events: { securityDiscard: (state, hp, h, info) => info.owner === hp && info.cause !== 'battle' && info.cause !== 'check' } });
sc('BT17-034::서로의 턴@시큐리티가 효과로 파기되었을 때', async (ctx, R) => {
  const h = holderOf(ctx);
  if (h && h.sources.some(id => S.cardNameIs(id, '레온 알렉산더'))) await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
});
// BT17-040 (INH 서로의 턴, 턴 1회): 자신의 시큐리티가 줄어들었을 때, 이 디지몬이 명칭에 「펜리루가몬」을 포함한다면 DP -8000 (조건은 제너릭 컴파일이 처리)
hk('BT17-040', { tag: '서로의 턴', has: '시큐리티가 줄어들었을 때', src: 'inheritedKo', ewTrusted: true });
sc('BT17-040::서로의 턴@「펜리루가몬」을 포함한다면', async (ctx, R) => {
  const h = holderOf(ctx);
  if (h && S.cardNameHas(h.cardId, '펜리루가몬')) await R.runOne({ op: 'modifyDP', target: 'opponent', amount: -8000, duration: 'turn' }, ctx);
});
// BT17-043 (자신의 턴, 턴 1회): 자신의 「테리어몬」/「로프몬」 또는 그린인 테이머가 효과로 등장했을 때, 상대의 디지몬 1마리를 레스트시킬 수 있다
hk('BT17-043', { tag: '자신의 턴', has: '효과로 등장했을 때', limit: 1, events: { play: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && !!info.stack && (S.cardNameIs(info.stack.cardId, '테리어몬') || S.cardNameIs(info.stack.cardId, '로프몬') || (isTamerSt(info.stack) && (C(info.stack.cardId).colors || []).includes('green'))) } });
// BT17-083 (INH 자신의 턴, 턴 1회): 자신의 패가 효과로 늘어났을 때, 메모리 +1. 그 후 이 디지몬은 《재밍》 (그 후 문장이 있어 ew-unsafe였음)
hk('BT17-083', { tag: '자신의 턴', has: '패가 효과로 늘어났을 때', src: 'inheritedKo', ewTrusted: true });
// BT17-087 (서로의 턴): 이 테이머가 레스트했을 때 DP+3000, 그 후 조건부 메모리 +1 / BT17-089 (자신의 턴): 이 테이머가 레스트했을 때 메모리 +1, 그 후 조건부 드로우
hk('BT17-087', { tag: '서로의 턴', has: '이 테이머가 레스트했을 때', ewTrusted: true });
hk('BT17-089', { tag: '자신의 턴', has: '이 테이머가 레스트했을 때', ewTrusted: true });
// BT17-089 (자신의 턴): 자신의 디지몬이 효과로 레스트했을 때, 이 테이머를 레스트시킬 수 있다 (generic compile was empty)
sc('BT17-089::자신의 턴@이 테이머를 레스트시킬 수 있다', async (ctx) => {
  const h = holderOf(ctx);
  if (!h || h.suspended) return;
  if (await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 테이머를 레스트시키겠습니까?' })) S.restStack(ctx.state, ctx.self, h.uid);
});
// BT17-093 (서로의 턴): 자신의 육성 에어리어에 부화했을 때, 이 테이머를 레스트시키는 것으로 메모리 +1
hk('BT17-093', { tag: '서로의 턴', has: '부화했을 때', events: { hatch: (state, hp, h, info) => info.owner === hp } });
// BT18-031 (자신의 턴, 턴 1회): 진화원 효과를 가진 자신의 테이머가 등장했을 때 메모리 +1
hk('BT18-031', { tag: '자신의 턴', has: '진화원 효과를 가진', limit: 1, events: { play: (state, hp, h, info) => info.owner === hp && isTamerSt(info.stack) && !!C(info.stack.cardId).inheritedKo } });

// ===================================================================== BT17 continuous effects the generic parsers cannot express
const ownTamerRested = (state, hp) => state.players[hp].battle.some(s => isTamerSt(s) && s.suspended);
// BT17-037 (자신의 턴): 레스트 상태인 자신의 테이머가 있는 동안, 이 디지몬은 《관통》을 얻고 DP +3000
hk('BT17-037', { tag: '자신의 턴', has: '레스트 상태인 자신의 테이머가 있는 동안', dp: (state, hp, h, t) => (t === h && ownTamerRested(state, hp) ? 3000 : 0), kw: (state, hp, h, name) => name === '관통' && ownTamerRested(state, hp) });
// BT17-072 (서로의 턴): Lv.6의 다른 자신의 디지몬이 있는 동안, 이 디지몬은 《S 어택 +1》을 얻고 DP +2000
const otherLv6 = (state, hp, h) => state.players[hp].battle.some(s => s !== h && isDigimon(s) && C(s.cardId).level === 6);
hk('BT17-072', { tag: '서로의 턴', has: 'Lv.6의 다른 자신의 디지몬이 있는 동안', dp: (state, hp, h, t) => (t === h && otherLv6(state, hp, h) ? 2000 : 0), kwNum: (state, hp, h) => (otherLv6(state, hp, h) ? 1 : 0) });
// BT17-051 (서로의 턴): 이 디지몬의 진화원의 「아르고몬」 2장마다 이 디지몬을 DP +1000
hk('BT17-051', { tag: '서로의 턴', has: '진화원의 「아르고몬」 2장마다', dp: (state, hp, h, t) => (t === h ? Math.floor(h.sources.filter(id => S.cardNameIs(id, '아르고몬')).length / 2) * 1000 : 0) });
// BT17-048 / BT17-051 (상대의 턴) / BT5-058 (서로의 턴): 상대의 테이머 전부는 액티브가 되지 않는다
for (const [id, tag] of [['BT17-048', '상대의 턴'], ['BT17-051', '상대의 턴'], ['BT5-058', '서로의 턴']]) hk(id, { tag, has: '상대의 테이머 전부는 액티브가 되지 않는다', noUnsuspendOthers: (state, hp, h, target, tp) => tp !== hp && isTamerSt(target) });

// ===================================================================== BT17 scripts (generic compile dropped / faked the costs)
const pickUid = async (ctx, who, stacks, prompt) => { if (!stacks.length) return null; const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt }); return stacks.find(s => s.uid === uid) || null; };
const stacksAll = (state, p) => state.players[p].battle;
const oppTurnEndNo = (state, self) => (state.activePlayer === self ? state.turnNumber + 1 : state.turnNumber);

// BT17-041 (어택 시): 옐로인 자신의 테이머 2명까지를 레스트시키는 것으로, 턴 종료까지 이 효과로 레스트한 1명마다 《S 어택 +1》 (generic: manualCost + always +1)
sc('BT17-041::어택 시', async (ctx, R) => {
  const { state } = ctx; let n = 0;
  for (let k = 0; k < 2; k++) {
    const cands = stacksAll(state, ctx.self).filter(s => isTamerSt(s) && !s.suspended && (C(s.cardId).colors || []).includes('yellow'));
    if (!cands.length) break;
    const t = await pickUid(ctx, ctx.self, cands, `레스트시킬 옐로인 자신의 테이머 선택 (${k + 1}/2, 안 해도 됨)`);
    if (!t) break;
    S.restStack(state, ctx.self, t.uid); n++;
  }
  const h = holderOf(ctx);
  if (n && h) S.grantKeyword(state, ctx.self, h.uid, '시큐리티어택', n, 'turn');
});
// BT17-025 (진화 시): 자신의 트래시 또는 디지몬의 진화원에서 블루/퍼플인 Lv.3의 디지몬 카드 1장을 코스트 없이 등장. 다음 상대의 턴 종료 시 그 디지몬을 패로 되돌린다 (generic: manual note)
sc('BT17-025::진화 시', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const before = new Set(pl.battle.map(s => s.uid));
  await R.runOne({ op: 'moveEach', who: 'self', from: ['trash', 'sources'], groups: [{ filter: { category: 'digimon', colors: ['blue', 'purple'], level: 3 }, max: 1, label: '블루/퍼플인 Lv.3의 디지몬 카드' }], dest: 'play', rested: false, noTriggers: false }, ctx);
  const ns = pl.battle.find(s => !before.has(s.uid));
  if (ns) await R.runOne({ op: 'atTurnEnd', when: 'opp', then: [{ op: 'returnToHandStripSources', target: 'self', last: true, thisStack: false, n: 1, filter: {}, requireSuspended: null, dest: 'hand' }] }, { ...ctx, _lastPick: { player: ctx.self, uid: ns.uid } });
});
// BT17-082 (등장 시): 자신의 패 또는 디지몬의 진화원에서 「래브라몬」/「시사몬」 1장을 코스트 없이 등장시킬 수 있다 (generic: manual note)
sc('BT17-082::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'moveEach', who: 'self', from: ['hand', 'sources'], groups: [{ filter: { exactAny: ['래브라몬', '시사몬'], category: 'digimon' }, max: 1, label: '「래브라몬」/「시사몬」' }], dest: 'play', rested: false, noTriggers: false }, ctx);
});
// BT17-078 (등장/진화 시): 조그레스 진화하고 있었다면 상대의 디지몬 1마리를 선택, 그 디지몬과 같은 Lv.의 상대의 디지몬 전부를 덱 아래로. 그 후 상대의 디지몬 1마리를 소멸 (generic did it in the wrong order / returned everything)
const sc078 = async (ctx, R) => {
  const { state } = ctx, h = holderOf(ctx);
  if (!h || !h.viaFusion) return;
  const opl = state.players[ctx.opp];
  const chosen = await pickUid(ctx, ctx.self, opl.battle.filter(isDigimon), '선택할 상대의 디지몬 (같은 Lv.의 상대 디지몬 전부를 덱 아래로)');
  if (chosen) {
    const lv = C(chosen.cardId).level;
    await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', all: true, filter: { level: lv, category: 'digimon' }, requireSuspended: null, dest: 'deckBottom' }, ctx);
  }
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose' }, ctx);
};
sc('BT17-078::등장 시', sc078);
sc('BT17-078::진화 시', sc078);
// BT17-084 (서로의 턴): 특징 「프리」를 가진 Lv.5 이상의 자신의 디지몬이 배틀에서 소멸할 때, 이 테이머를 레스트시키는 것으로 그 디지몬의 진화원에서 Lv.4 이하의 디지몬 카드 1장을 코스트 없이 등장 (generic: manual)
hk('BT17-084', { tag: '서로의 턴', has: '배틀에서 소멸할 때', events: { delete: (state, hp, h, info) => info.owner === hp && info.cause === 'battle' && !!info.stack && isDigimon(info.stack) && (C(info.stack.cardId).types || []).includes('프리') && (C(info.stack.cardId).level || 0) >= 5 && !h.suspended } });
sc('BT17-084::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const h = holderOf(ctx);
  if (!h || h.suspended) return;
  const uid = ctx.trigger && ctx.trigger.evt && ctx.trigger.evt.stackUid;
  const info = state.deletedInfo && state.deletedInfo[uid];
  if (!info) return;
  const srcIds = info.sources.slice();
  const idxs = pl.trash.map((id, i) => i).filter(i => { const c = C(pl.trash[i]); return c.category === 'digimon' && (c.level || 9) <= 4 && srcIds.includes(pl.trash[i]); });
  if (!idxs.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 테이머를 레스트시켜, 소멸한 디지몬의 진화원에서 Lv.4 이하의 디지몬 1장을 등장시키겠습니까?' }))) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: '진화원에서 등장시킬 카드 선택 (트래시에 있는 카드)' });
  if (idx == null) return;
  S.restStack(state, ctx.self, h.uid);
  S.playFreeFromZone(state, ctx.self, 'trash', idx, { fromSources: true });
});
// BT17-087 (등장 시): 상대의 턴 종료까지 자신의 「최건우」 1명은 디지몬·DP 3000으로도 취급하고 진화할 수 없으며 《블로커》를 얻는다 (generic: keyword to a random digimon)
sc('BT17-087::등장 시', async (ctx) => {
  const { state } = ctx;
  const cands = stacksAll(state, ctx.self).filter(s => isTamerSt(s) && S.cardNameIs(s.cardId, '최건우'));
  const t = await pickUid(ctx, ctx.self, cands, '블로커가 될 자신의 「최건우」 선택');
  if (!t) return;
  S.grantKeyword(state, ctx.self, t.uid, '블로커', undefined, 'opponentTurn');
  S.modifyDP(state, ctx.self, t.uid, 3000, 'opponentTurn');
});

// ===================================================================== BT18
// BT18-018 (진화 시): 이 디지몬의 진화원의 색 1색마다 상대의 디지몬의 진화원을 선택하여 1장 파기하고, 상대의 디지몬 1마리를 레스트시킨다. 그 후 이 디지몬으로 어택할 수 있다 (generic compile dropped the source-trash half)
sc('BT18-018::진화 시', async (ctx, R) => {
  const h = holderOf(ctx);
  if (!h) return;
  const colors = new Set(h.sources.flatMap(id => C(id).colors || []));
  for (let k = 0; k < colors.size; k++) {
    await R.runOne({ op: 'trashEvoSources', target: 'opponent', stacks: 1, count: 1, choose: true, prompt: '진화원을 파기시킬 상대의 디지몬 선택' }, ctx);
    await R.runOne({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }, ctx);
  }
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: true }, ctx);
});

// BT18-042 (진화 시 / 상대의 턴 종료 시, 턴 1회): 이 디지몬의 진화원에서 디지몬 카드 1장을 시큐리티 아래에 놓는 것으로, 놓은 카드와 같은 Lv.의 상대의 디지몬 전부를 소멸시킨다 (generic destroyed EVERY opponent Digimon)
const sc042 = async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self], h = holderOf(ctx);
  if (!h) return;
  const idxs = h.sources.map((id, i) => i).filter(i => C(h.sources[i]).category === 'digimon');
  if (!idxs.length) return;
  pl.s36tmp = h.sources.slice();
  let k;
  try { k = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's36tmp', eligibleIdxs: idxs, prompt: '시큐리티 아래에 놓을 진화원의 디지몬 카드 선택' }); } finally { delete pl.s36tmp; }
  if (k == null) return;
  const [id] = h.sources.splice(k, 1);
  S.recomputeStackGrants(h);
  pl.security.push(id); // bottom
  S.log(state, `${ctx.self} ${C(id).nameKo}을(를) 진화원에서 시큐리티 아래에 놓음`);
  const lv = C(id).level;
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'all', filter: { level: lv, category: 'digimon' } }, ctx);
};
sc('BT18-042::진화 시', sc042);
sc('BT18-042::상대의 턴 종료 시', sc042);

// BT18-079 (등장/진화 시): 상대의 디지몬과 테이머의 색 1색마다 서로의 덱 위에서부터 1장 파기. 그 후, 이 효과로 파기한 1장마다 턴 종료까지 이 디지몬을 DP +1000 (generic: flat +1000)
const sc079 = async (ctx, R) => {
  const { state } = ctx;
  const colors = new Set(state.players[ctx.opp].battle.filter(s => C(s.cardId).category === 'digimon' || isTamerSt(s)).flatMap(s => S.stackColors(s)));
  const n = colors.size;
  const before = state.players.p1.trash.length + state.players.p2.trash.length;
  if (n) { S.trashTopOfDeck(state, ctx.opp, n); S.trashTopOfDeck(state, ctx.self, n); }
  const discarded = (state.players.p1.trash.length + state.players.p2.trash.length) - before;
  const h = holderOf(ctx);
  if (h && discarded > 0) S.modifyDP(state, ctx.self, h.uid, 1000 * discarded, 'turn');
};
sc('BT18-079::등장 시', sc079);
sc('BT18-079::진화 시', sc079);
// BT18-079 (어택 종료 시): 퍼플인 Lv.4 이하의 디지몬 1마리를 소멸시키는 것으로, 가장 Lv.이 낮은 상대의 디지몬 전부를 소멸시킨다 (cost = real destroy of an own/any purple Lv.4- Digimon; generic treated it as a manual cost)
sc('BT18-079::어택 종료 시', async (ctx, R) => {
  const { state } = ctx;
  const cands = [];
  for (const p of ['p1', 'p2']) for (const s of state.players[p].battle) if (isDigimon(s) && (C(s.cardId).colors || []).includes('purple') && (C(s.cardId).level || 9) <= 4) cands.push({ s, p });
  if (!cands.length) return;
  const uid = await ctx.choose('pickStackAnySide', { player: ctx.self, entries: cands.map(x => ({ player: x.p, uid: x.s.uid })), prompt: '소멸시킬 퍼플인 Lv.4 이하의 디지몬 선택 (비용, 안 해도 됨)' });
  if (!uid) return;
  const pick = typeof uid === 'object' ? uid : cands.map(x => ({ player: x.p, uid: x.s.uid })).find(e => e.uid === uid);
  if (!pick) return;
  S.deleteStack(state, pick.player, pick.uid, 'trash', pick.player === ctx.self ? 'ownEffect' : 'effect');
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'all', filter: { extreme: { stat: 'level', dir: 'min' } } }, ctx);
});

// BT18-046 (상대의 턴): 이 디지몬의 DP 이하의 상대의 디지몬 전부는 플레이어에게 어택할 수 없다 (was unimplemented)
hk('BT18-046', { tag: '상대의 턴', has: '플레이어에게 어택할 수 없다', atkPlayerBlocked: (state, hp, h, ap, attacker) => isDigimon(attacker) && S.effectiveDP(state, ap, attacker) <= S.effectiveDP(state, hp, h) });

// BT17-101 ([트래시]【자신의 턴】): 「펄스몬」이 기술되어 있는 Lv.6의 자신의 디지몬이 등장했을 때, 자신의 디지몬 2마리로 이 카드로 조그레스 진화할 수 있다 (generic compile was empty)
sc('BT17-101::자신의 턴@조그레스 진화할 수 있다', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const ti = pl.trash.indexOf('BT17-101');
  if (ti < 0) return;
  const digs = pl.battle.filter(isDigimon);
  const pairs = [];
  for (let i = 0; i < digs.length; i++) for (let j = i + 1; j < digs.length; j++) if (S.canJogress(digs[i], digs[j], 'BT17-101').ok && S.parseJogress('BT17-101')) pairs.push([digs[i], digs[j]]);
  if (!pairs.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '트래시의 「펜리루가몬: 타케미 카즈치」로 조그레스 진화하시겠습니까?' }))) return;
  const a = await pickUid(ctx, ctx.self, [...new Set(pairs.map(p => p[0]).concat(pairs.map(p => p[1])))], '조그레스 재료 1 선택');
  if (!a) return;
  const b = await pickUid(ctx, ctx.self, pairs.filter(p => p.includes(a)).map(p => (p[0] === a ? p[1] : p[0])), '조그레스 재료 2 선택');
  if (!b) return;
  pl.trash.splice(ti, 1); pl.hand.push('BT17-101');
  if (!S.fuseStacks(state, ctx.self, a.uid, b.uid, 'BT17-101', S.parseJogress('BT17-101').cost || 0, 'hand')) { pl.hand.pop(); pl.trash.splice(ti, 0, 'BT17-101'); }
});
