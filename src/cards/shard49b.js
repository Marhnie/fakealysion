// Shard 49b — pass-2 batch-2 verification fixes (docs/verify-pass2-b2.md).
// (numbered 49b because shard49.js was already taken by another batch)
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const fn = (f) => ({ op: 's49b_fn', fn: f });
OPS.s49b_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hasTr = (id, ...ts) => (C(id).types || []).some((t) => ts.includes(t));
const digs = (state, p) => state.players[p].battle.filter((s) => C(s.cardId).category === 'digimon');

// BT12-090 【자신의 턴】 블루와 그린 2색의 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 그 디지몬을 패의 명칭에 「황제드라몬」을 포함하는 디지몬 카드로 진화시킬 수 있다.
// (was: the evolve clause compiled to a manual "noop" note — nothing evolved)
SCRIPTS['BT12-090::자신의 턴'] = [{
  op: 's2_evolve', subject: { pred: (s, ctx) => { const u = ctx.trigger?.evt?.stackUid ?? ctx.trigger?.evtStackUid; return u ? s.uid === u : false; } },
  zone: 'hand', cardPred: (c) => c.category === 'digimon' && c.nameKo.includes('황제드라몬'),
  cardPrompt: '진화할 「황제드라몬」 카드 선택 (선택 안 함 = 진화하지 않음)',
}];

// BT12-108 【시큐리티】 자신의 패에서 특징으로 「머신형」/「사이보그형」을 가진 카드 1장을 파기하는 것으로, 이 효과로 파기한 카드의 등장 코스트 이하의 상대의 디지몬 1마리를 소멸시킨다.
// (was: manual cost + no cost limit on the destroyed digimon)
sc('BT12-108::시큐리티', async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], o = opp(me);
  const idxs = pl.hand.map((id, i) => i).filter((i) => hasTr(pl.hand[i], '머신형', '사이보그형'));
  if (!idxs.length) { S.log(state, `${me} 파기할 머신형/사이보그형 카드가 패에 없음`); return; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: me, zone: 'hand', eligibleIdxs: idxs, prompt: '파기할 「머신형」/「사이보그형」 카드 선택 (선택 안 함 = 효과 없음)' });
  if (idx == null || !idxs.includes(idx)) return;
  const cid = pl.hand[idx];
  S.trashFromHand(state, me, idx);
  const limit = C(cid).cost || 0;
  const cands = digs(state, o).filter((s) => (C(s.cardId).cost || 0) <= limit);
  if (!cands.length) return;
  const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: me, uids: cands.map((s) => s.uid), prompt: `소멸시킬 상대 디지몬 선택 (등장 코스트 ${limit} 이하)` });
  if (uid) S.deleteStack(state, o, uid, 'trash', 'effect');
});

// BT17-013 (inherited) 【서로의 턴】[턴에 1회] 상대의 디지몬이 효과로 소멸했을 때, 명칭에 「듀크몬」을 포함하는 이 디지몬을 액티브로 할 수 있다.
// (was: the 「듀크몬」 name filter on "이 디지몬" was dropped -> any digimon carrying this source was activated)
sc('BT17-013::서로의 턴', async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const pl = state.players[me];
  const st = [pl.raising, ...pl.battle].filter(Boolean).find((s) => s.uid === ctx.sourceStackUid);
  if (!st || !st.suspended) return;
  if (!S.effectiveInfo(state, st, me).nameHas?.('듀크몬') && !C(st.cardId).nameKo.includes('듀크몬')) return;
  if (!(await ctx.choose('confirmEffect', { player: me, prompt: `${C(st.cardId).nameKo}을(를) 액티브로 할까요?` }))) return;
  S.unsuspendStack(state, me, st.uid);
});
