// Shard 44 (batch 14: LM-/S2-/ST starter cards not covered by the starter docs) — per-card fixes found by the per-sentence audit.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
const C = (id) => S.card(id);
const H = (id, d) => { (HOOKS[id] ||= []).push(d); };
// 「X」가 기술되어 있는 카드: the printed NAME contains X or a 「X」 mention in the (non-〈룰〉) text.
const mentions = (id, n) => { const c = C(id); return !!c && (c.nameKo.includes(n) || `${c.effectKo || ''}\n${c.inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`)); };

// LM-004 테티스몬 【등장 시】【진화 시】 자신의 패에서 블루인 카드 2장을 파기하는 것으로, 자신의 디지몬 1마리와 자신의 「이청솔」 1명을 액티브로 하고, 상대의 턴 종료까지 이 디지몬은 《블로커》를 얻는다.
// (the compiler dropped the whole "디지몬 1마리와 「이청솔」 1명을 액티브로 한다" clause)
OPS.s44_unsuspendNamedTamer = async (instr, ctx) => {
  const pl = ctx.state.players[ctx.self];
  const uids = pl.battle.filter(s => C(s.cardId).category === 'tamer' && C(s.cardId).nameKo === instr.name && s.suspended).map(s => s.uid);
  if (!uids.length) return;
  const u = await ctx.choose('pickStack', { player: ctx.self, uids, prompt: `액티브로 할 「${instr.name}」 선택` });
  if (u) S.unsuspendStack(ctx.state, ctx.self, u);
};
SCRIPTS['LM-004::등장 시'] = [{ op: 'costGroup', cost: [{ op: 'trashHand', who: 'self', n: 2, filter: { colors: ['blue'] } }], then: [
  { op: 'unsuspend', target: 'self', digimonOnly: true, filter: { suspended: true }, prompt: '액티브로 할 자신의 디지몬 선택' },
  { op: 's44_unsuspendNamedTamer', name: '이청솔' },
  { op: 'grantKeyword', target: 'self', thisStack: true, keyword: '블로커', duration: 'opponentTurn' }] }];
// LM-004 (inherited) 【서로의 턴】[턴에 1회] 자신의 패에서 「젤리몬」이 기술되어 있는 카드가 파기되었을 때, 이 디지몬을 액티브로 할 수 있다.
H('LM-004', { tag: '서로의 턴', src: 'inheritedKo', has: '젤리몬', limit: 1, events: { discard: (st, hp, h, info) => info.owner === hp && !!info.cardId && mentions(info.cardId, '젤리몬') } });
SCRIPTS['LM-004::서로의 턴'] = [{ op: 's44_confirmThen', then: [{ op: 'unsuspend', target: 'thisStack' }] }];
// generic optional wrapper ("~할 수 있다"): ask, then run the sub-script
OPS.s44_confirmThen = async (instr, ctx, H) => {
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: instr.prompt || '효과를 발휘할까요? (임의)' }))) return;
  await H.runScript(instr.then, ctx);
};

// LM-022 파피몬 -우정의 유대- 【등장 시】【진화 시】 진화원의 매수가 이 디지몬 이하의 상대의 디지몬 2마리를 덱 아래로 되돌린다.
// (compiled with an empty filter: ignored the "진화원 매수 ≤ 이 디지몬" condition)
OPS.s44_lm022 = async (instr, ctx, H) => {
  const me = ctx.state.players[ctx.self].battle.find(s => s.uid === ctx.sourceStackUid);
  if (!me) return;
  await H.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 2, filter: { srcMax: me.sources.length }, dest: 'deckBottom' }, ctx);
};
SCRIPTS['LM-022::등장 시'] = [{ op: 's44_lm022' }];

// LM-016 감마몬 【서로의 턴】[턴에 1회] 다른 자신의 디지몬이 효과로 소멸했을 때, 이 디지몬을 트래시의 「감마몬」이 기술되어 있는 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
// (no generic watcher existed: the segment compiled to [])
H('LM-016', { tag: '서로의 턴', has: '효과로 소멸했을 때', limit: 1, events: { delete: (st, hp, h, info) => info.owner === hp && !!info.stack && info.stack !== h && (info.cause === 'effect' || info.cause === 'ownEffect') && !info.dp0 } });
SCRIPTS['LM-016::서로의 턴'] = [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'trash', cardFilter: { category: 'digimon', mentionAny: ['감마몬'] }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }];

// LM-041 레가렉스몬 【진화 시】【어택 시】[턴 1회] 메모리가 1 이상이라면, 상대는 본인의 시큐리티를 위에서부터 1장 패에 추가한다. 그 후, 메모리가 1 이하라면, 상대의 턴 종료까지 상대의 디지몬/테이머 1마리(명)는 레스트할 수 없다.
// (the compiler dropped the first sentence and kept only the second)
const memOf = (state, p) => (p === 'p1' ? state.memory : -state.memory);
OPS.s44_lm041 = async (instr, ctx, H) => {
  if (memOf(ctx.state, ctx.self) >= 1) await H.runOne({ op: 'securityTopToHand', who: 'opponent', n: 1 }, ctx);
  if (memOf(ctx.state, ctx.self) <= 1) await H.runOne({ op: 'preventRest', target: 'opponent', n: 1, filter: {}, expiresAfterTurn: 'opponentTurn' }, ctx);
};
SCRIPTS['LM-041::진화 시@메모리가 1 이상'] = [{ op: 's44_lm041' }];

// LM-010 샴블몬 【서로의 턴】 레스트 상태인 테이머 1명마다 이 디지몬을 DP +1000. (no continuous handler existed: DP never changed) — counts BOTH sides' rested Tamers.
H('LM-010', { tag: '서로의 턴', has: '레스트 상태인 테이머', dp: (state, hp, holder, target) => target !== holder ? 0
  : 1000 * ['p1', 'p2'].reduce((n, p) => n + state.players[p].battle.filter(s => C(s.cardId).category === 'tamer' && s.suspended).length, 0) });
