// Batch 13 (P- promo cards) per-card fixes. See docs/verify-sets-P.md.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const isDigimon = (st) => !!st && C(st.cardId).category === 'digimon';
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
OPS.s43_fn = async (instr, ctx, api) => { await instr.fn(ctx, api); };
const fn = (f) => ({ op: 's43_fn', fn: f });
const srcStack = (ctx) => { const pl = ctx.state.players[ctx.self]; return pl.raising?.uid === ctx.sourceStackUid ? pl.raising : pl.battle.find(s => s.uid === ctx.sourceStackUid) || null; };

// P-016 디아블로몬 【자신의 턴】 자신의 「디아블로몬」 1마리마다 《S 어택 +1》 (counts itself)
D('P-016', '자신의 턴', '1마리마다', { kwNum: (state, hp, holder) => state.players[hp].battle.filter(s => isDigimon(s) && S.cardNameIs(s.cardId, '디아블로몬')).length }); // QA-W6 Q3470: 「디아블로몬」 = exact name (not X항체/ACE)

// P-004 쉬라몬 (진화원) 【자신의 턴】[턴에 1회] 상대 디지몬의 진화원을 파기했을 때, 메모리 +1
DI('P-004', '자신의 턴', '진화원을 파기했을 때', { limit: 1, events: { sourcesTrashed: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) } });

// P-029 아그니몬 【어택 시】 / P-030 볼프몬 【진화 시】: may evolve (ignoring conditions, cost 2) into the hand's 에이션트X; only if that happened,
// destroy the evolved Digimon at this turn's end (the compiler destroyed it immediately and unconditionally).
function ancientEvo(name) {
  return [fn(async (ctx, api) => {
    const uid = ctx.sourceStackUid; const pl = ctx.state.players[ctx.self];
    const before = pl.battle.find(x => x.uid === uid); if (!before) return;
    const beforeId = before.cardId;
    await api.runScript([{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { exactAny: [name], category: 'digimon' }, cost: { mode: 'fixed', n: 2 }, ignoreCond: true, ignoreLevel: false }], ctx);
    const after = pl.battle.find(x => x.uid === uid);
    if (!after || after.cardId === beforeId) return;
    (ctx.state.endOfTurnEffects ||= []).push({ turnNumber: ctx.state.turnNumber, player: ctx.self, cardId: ctx.sourceCardId, label: '이 턴 종료 시 이 디지몬 소멸', fn: () => { const cur = ctx.state.players[ctx.self].battle.find(x => x.uid === uid); if (cur) S.deleteStack(ctx.state, ctx.self, uid, 'trash', 'effect'); } });
    S.log(ctx.state, `${ctx.self} 예약: 이 턴 종료 시 ${C(after.cardId).nameKo} 소멸`);
  })];
}
SCRIPTS['P-029::어택 시'] = ancientEvo('에이션트그레이몬');
SCRIPTS['P-030::진화 시'] = ancientEvo('에이션트가루몬');

// P-044 헤라클레스캅테리몬 【진화 시】 "상대의 디지몬 1마리, 또는 DP 5000 이하의 상대 디지몬 2마리를 레스트" — an OR of two options (was compiled as only the 2-small-digimon branch).
SCRIPTS['P-044::진화 시'] = [{ op: 'effectChoice', options: [
  { label: '상대의 디지몬 1마리를 레스트시킨다.', then: [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }] },
  { label: 'DP 5000 이하의 상대 디지몬 2마리를 레스트시킨다.', then: [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true, filter: { dpMax: 5000 }, distinct: 'p44' }, { op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true, filter: { dpMax: 5000 }, distinct: 'p44' }] },
] }];

// P-049 페닉스몬 【자신의 턴】[턴에 1회] 이 디지몬이 블록당했을 때, 상대의 시큐리티를 위에서부터 1장 파기 ('blocked' is emitted by main.js when a blocker is chosen)
D('P-049', '자신의 턴', '블록당했을 때', { limit: 1, events: { blocked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });

// P-062 은하준 / P-064 이청솔 【자신의 턴】 진화원에 「감마몬」/「젤리몬」을 가진 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로 그 디지몬에게 《S 어택 +1》/《재밍》 (this turn).
// (no attack-event hook existed, so the effect never triggered) — modelled on P-063 in shard1.js.
const payRestThis = async (ctx, prompt) => {
  const st = srcStack(ctx);
  if (!st || st.suspended) return false;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt }))) return false;
  S.restStack(ctx.state, ctx.self, st.uid);
  return !!st.suspended;
};
function tamerAtkGrant(id, srcName, keyword, value, prompt) {
  D(id, '자신의 턴', srcName, { events: { attack: (state, hp, holder, info) => info.owner === hp && info.stack !== holder && isDigimon(info.stack) && info.stack.sources.some(x => C(x).nameKo === srcName) && !holder.suspended } });
  SCRIPTS[id + '::자신의 턴'] = [fn(async (ctx) => {
    const evt = srcStack(ctx)?.hookEvt;
    const tgt = evt && ctx.state.players[ctx.self].battle.find(s => s.uid === evt.stackUid);
    if (!tgt) return;
    if (!(await payRestThis(ctx, prompt))) return;
    S.grantKeyword(ctx.state, ctx.self, tgt.uid, keyword, value, 'turn');
  })];
}
tamerAtkGrant('P-062', '감마몬', '시큐리티어택', 1, '이 테이머를 레스트시켜 어택한 디지몬에게 《S 어택 +1》을 주시겠습니까?');
tamerAtkGrant('P-064', '젤리몬', '재밍', true, '이 테이머를 레스트시켜 어택한 디지몬에게 《재밍》을 주시겠습니까?');

// P-075 왕쿠가몬 【자신의 턴】 곤충형인 동안 상대의 디지몬 전부가 "【서로의 턴】 이 디지몬이 레스트했을 때, 메모리 -1"을 (다음 상대의 턴 종료까지) 갖는다.
// The compiled grantText never ran (this segment is not a trigger); modelled as an event hook on the opponent's rests while this insect Digimon is on the field.
D('P-075', '서로의 턴', '', { text: '상대의 디지몬이 레스트했을 때, 메모리 -1 (왕쿠가몬이 부여한 효과)', events: { rest: (state, hp, holder, info) => info.owner !== hp && !!info.stack && isDigimon(info.stack) && (C(holder.cardId).types || []).includes('곤충형') } });
SCRIPTS['P-075::서로의 턴'] = [fn(async (ctx) => { S.grantMemory(ctx.state, ctx.opp, -1); S.log(ctx.state, `${ctx.opp} 왕쿠가몬의 효과: 레스트했으므로 메모리 -1`); })];

// P-076 델타몬 (진화원) 【어택 시】 이 디지몬의 색 1색마다 DP 3000 이하의 상대 디지몬 1마리를 소멸시킨다 (was compiled as a single kill)
SCRIPTS['P-076::어택 시'] = [fn(async (ctx, api) => {
  const st = srcStack(ctx); if (!st) return;
  const n = S.stackColors(st).length;
  const key = 'p76' + Math.random();
  await api.runScript(Array.from({ length: n }, () => ({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 3000 }, distinct: key })), ctx);
})];

// P-087 코도우 리츠 【자신의 턴】 펄스몬이 등장했을 때, 테이머를 레스트시키는 것으로, 시큐리티 3장 이상이면 《1 드로우》, 3장 이하면 메모리 +1 (both apply at exactly 3).
// The compiler drew unconditionally and put the memory gain outside the rest cost.
SCRIPTS['P-087::자신의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [
  { op: 'condition', if: { test: (ctx) => ctx.state.players[ctx.self].security.length >= 3 }, then: [{ op: 'draw', who: 'self', n: 1 }], else: [] },
  { op: 'condition', if: { test: (ctx) => ctx.state.players[ctx.self].security.length <= 3 }, then: [{ op: 'gainMemory', who: 'self', n: 1 }], else: [] },
] }];

// P-090 딜비트몬 【서로의 턴】[턴에 1회] 자신의 디지몬이 배틀에서 상대의 디지몬만을 소멸시켰을 때, 이 디지몬의 진화원에 「앙고라몬」이 있다면 자신의 디지몬 1마리를 액티브로 한다.
// The generic battle-win watcher refused the conditional text (stayed manual); trust it with a bespoke script that checks the 「앙고라몬」 source.
D('P-090', '서로의 턴', '이 디지몬의 진화원에', { ewTrusted: true });
SCRIPTS['P-090::서로의 턴'] = [fn(async (ctx, api) => {
  const st = srcStack(ctx); if (!st || !st.sources.some(id => C(id).nameKo === '앙고라몬')) return;
  await api.runScript([{ op: 'unsuspend', target: 'self', digimonOnly: true }], ctx);
})];

// P-092 드라코몬 (진화원) 【자신의 턴】 그라운드라몬이 등장했을 때, 이 디지몬을 패의 「윙드라몬」으로 코스트를 지불하지 않고 진화 (was compiled as playFree from hand)
SCRIPTS['P-092::자신의 턴@코스트를 지불하지 않고 진화'] = [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { exactAny: ['윙드라몬'], category: 'digimon' }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }];

// P-135 슈슈몬 【진화 시】 상대의 턴 종료까지 상대의 디지몬 1마리에게 《S 어택 -1》을 주고, 그 디지몬은 자신의 디지몬에게 어택할 수 없다 (the compiler dropped the second half)
SCRIPTS['P-135::진화 시'] = [fn(async (ctx) => {
  const uids = ctx.state.players[ctx.opp].battle.filter(isDigimon).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids, prompt: '《S 어택 -1》을 주고 자신의 디지몬에게 어택할 수 없게 할 디지몬 선택' });
  const st = uid && ctx.state.players[ctx.opp].battle.find(s => s.uid === uid);
  if (!st) return;
  S.grantKeyword(ctx.state, ctx.opp, uid, '시큐리티어택', -1, 'opponentTurn');
  st.noAtkDigUntil = S.durationEnd(ctx.state, 'opponentTurn');
  S.log(ctx.state, `${ctx.opp} ${C(st.cardId).nameKo}: 상대의 턴 종료까지 자신의 디지몬에게 어택할 수 없음`);
})];

// P-139 레오몬 X항체 【서로의 턴】 진화원에 「레오몬」/「X항체」가 있는 이 디지몬은 《블로커》와 《불굴》을 얻는다 (name 「레오몬」 or trait 「X항체」 among the sources; the generic parser could not read this condition)
const leoSrc = (holder) => (holder.sources || []).some(id => C(id).nameKo === '레오몬' || S.cardNameIs(id, 'X항체')); // slice-4 QA 4246: the X-antibody TRAIT alone does not count (a card named/treated as 「X항체」 does)
D('P-139', '서로의 턴', '진화원에', { kw: (state, hp, holder, name) => (name === '블로커' || name === '불굴') && leoSrc(holder) });

// P-171/172/174 「이 카드가 등장할 때, 자신의 앞면의 시큐리티에 「딥 세이버즈」/「네이처 스피릿츠」/「나이트메어 솔저스」가 있다면, 지불하는 등장 코스트 -4」 (no hook existed → never discounted).
const faceUpSecNamed = (state, p, name) => { const pl = state.players[p]; return Object.entries(pl.secUp || {}).some(([id, n]) => n > 0 && pl.security.includes(id) && C(id).nameKo === name); };
for (const [id, nm] of [['P-171', '딥 세이버즈'], ['P-172', '네이처 스피릿츠'], ['P-174', '나이트메어 솔저스']]) {
  (HOOKS[id] ||= []).push({ tag: '__handPlay', selfPlayDiscount: (state, hp) => (faceUpSecNamed(state, hp, nm) ? -4 : 0) });
}
// P-170 어벤지키드몬 「이 카드가 등장할 때, 자신의 트래시에서 「3총사」가 기술되어 있는 카드 3장을 덱 아래로 되돌리는 것으로, 지불하는 등장 코스트 -6」 (optional, confirmed by the player)
const mention3 = (id) => (C(id).types || []).includes('3총사') || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes('「3총사」');
(HOOKS['P-170'] ||= []).push({ tag: '__handPlay', handPlayOption: (state, p) => {
  const pl = state.players[p];
  if (pl.trash.filter(mention3).length < 3) return null;
  return { label: '자신의 트래시에서 「3총사」가 기술되어 있는 카드 3장을 덱 아래로 되돌려 등장 코스트 -6?', apply: () => {
    let n = 0;
    for (let i = pl.trash.length - 1; i >= 0 && n < 3; i--) if (mention3(pl.trash[i])) { pl.deck.push(pl.trash.splice(i, 1)[0]); n++; }
    S.log(state, `${p} 트래시의 「3총사」 카드 3장을 덱 아래로 되돌림 (등장 코스트 -6)`);
    return -6;
  } };
} });

// P-212 시로키 아스나 【등장 시】 《1 드로우》하고 패 1장을 파기한다. 이 효과로 특징 「3총사」/「TS」를 가진 카드를 파기했다면 Lv.3의 상대 디지몬 1마리를 소멸 (the compiler only checked "something was discarded")
SCRIPTS['P-212::등장 시'] = [fn(async (ctx, api) => {
  const pl = ctx.state.players[ctx.self];
  await api.runScript([{ op: 'draw', who: 'self', n: 1 }], ctx);
  const before = pl.trash.length, hb = pl.hand.length;
  await api.runScript([{ op: 'trashHand', who: 'self', n: 1 }], ctx);
  if (pl.hand.length >= hb || pl.trash.length <= before) return;
  const d = pl.trash[pl.trash.length - 1];
  if (!((C(d).types || []).some(t => t === '3총사' || t === 'TS'))) return;
  await api.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { level: 3 } }], ctx);
})];

// P-214 베타몬 X항체 【등장 시】【진화 시】 이 디지몬을 「시드라몬」이 기술되어 있는 다른 자신의 디지몬 1마리의 진화원 아래에 놓는 것으로, 그 디지몬의 Lv. 이하의 상대 디지몬 1마리를 덱 아래로 되돌린다
// (the compiler dropped the "그 디지몬의 Lv. 이하" bound)
SCRIPTS['P-214::등장 시'] = [{ op: 'costGroup', cost: [{ op: 'stackMove', mode: 'thisUnderOther', anyKind: false, filter: { category: 'digimon', mentionAny: ['시드라몬'] } }], then: [fn(async (ctx, api) => {
  const lp = ctx._lastPick; const st = lp && ctx.state.players[lp.player].battle.find(s => s.uid === lp.uid);
  if (!st) return;
  await api.runScript([{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: C(st.cardId).level ?? 0 }, requireSuspended: null, dest: 'deckBottom' }], ctx);
})] }];

// P-218 이랑호 / P-233 강에리 【자신의 턴】 자신의 디지몬에게 특징 「…」를 가진 카드가 링크했을 때, 이 테이머를 레스트시키는 것으로 메모리 +1 (no watcher existed for 'linked' with a card-trait filter → never fired)
for (const [id, traits] of [['P-218', ['엔터테인먼트', '툴', '내비']], ['P-233', ['게임', '라이프', '엔터테인먼트']]]) {
  D(id, '자신의 턴', '링크했을 때', { events: { linked: (state, hp, holder, info) => info.owner === hp && isDigimon(info.stack) && !!info.linkCardId && (C(info.linkCardId).types || []).some(t => traits.includes(t)) && !holder.suspended } });
}

// BT16-077 디노비몬 【진화 시】 (QA-W6 Q3628 / Q4000): the 「그 후」 part runs even if 조그레스 진화하고 있었다면 is unmet, and the Digimon granted ≪속공≫
// then attacks the Player as far as possible (the generic compile only granted the keyword and dropped the attack clause).
SCRIPTS['BT16-077::진화 시'] = [fn(async (ctx, api) => {
  const st = srcStack(ctx);
  const fused = ctx.trigger && ctx.trigger.evtSnap ? !!ctx.trigger.evtSnap.viaFusion : !!(st && st.viaFusion);
  if (fused) await api.runScript([{ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['프리'], levelMax: 5 }, rested: false, noTriggers: false, optional: true }], ctx);
  const mine = ctx.state.players[ctx.self].battle.filter((s) => isDigimon(s));
  if (!mine.length) return;
  const uid = mine.length === 1 ? mine[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: mine.map((s) => s.uid), prompt: '《속공》을 얻고 플레이어에게 어택할 디지몬 선택' });
  const t = mine.find((s) => s.uid === uid); if (!t) return;
  S.grantKeyword(ctx.state, ctx.self, t.uid, '속공', true, 'turn');
  if (!t.suspended && ctx.startAttack) ctx.startAttack(ctx.self, t.uid, 'PLAYER');
})];

// ST20-04 가루다몬 【자신의 턴】 (QA-W6 Q3987-3995): 「그 디지몬이 특징 「어드벤처」를 가진다면」 only gates the ≪연계≫ grant (mandatory when met); the
// 「그 후」 attack (optional, any of our digimon) is processed either way. The generic compile granted ≪연계≫ unconditionally.
const advEntrant = (ctx) => { // (no event info = a unit test / manual run: keep the printed-text default "condition met")
  const tr = ctx.trigger || {};
  if (!tr.evtStackUid && !tr.evtSnap) return true;
  const live = tr.evtStackUid ? [...ctx.state.players.p1.battle, ...ctx.state.players.p2.battle].find((s) => s.uid === tr.evtStackUid) : null;
  const cid = live ? live.cardId : (tr.evtSnap && tr.evtSnap.cardId);
  return !!cid && (C(cid).types || []).includes('어드벤처');
};
for (const id of ['ST20-04', 'ST20-06', 'ST20-09', 'ST21-04', 'ST21-06', 'ST21-09', 'BT21-061', 'BT21-078']) SCRIPTS[id + '::자신의 턴'] = [
  { op: 'condition', if: { test: advEntrant }, then: [{ op: 'grantKeyword', target: 'self', thisStack: false, keyword: '연계', duration: 'turn' }], else: [] },
  { op: 'attackNow', who: 'self', thisStack: false },
];
