// Shard 61 — fixes found by the effect-trigger census (scripts/census.mjs, docs/effect-census.md): watcher effects whose queued text had NO script
// (every trigger became a manual prompt the CPU / auto-run could not resolve).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const opp = (p) => S.opponentOf(p);
const isDigi = (st) => !!st && C(st.cardId).category === 'digimon';
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1); // "상대의 턴 종료까지"
OPS.c61_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };

// EX5-043 두프트몬 X항체 【자신의 턴】[턴에 1회] 자신의 디지몬이 등장했을 때, DP 5000 이하의 상대의 디지몬 1마리를 패로 되돌릴 수 있다. 다른 자신의 디지몬 1마리마다 이 효과의 DP 상한 +3000.
SCRIPTS['EX5-043::자신의 턴'] = [{ op: 'c61_fn', fn: async (ctx, R) => {
  const { state } = ctx;
  const mine = state.players[ctx.self].battle.filter(isDigi);
  const others = mine.filter(s => s.uid !== ctx.sourceStackUid).length; // "다른 자신의 디지몬 1마리마다"
  const dpMax = 5000 + 3000 * others;
  if (!state.players[opp(ctx.self)].battle.some(s => isDigi(s) && S.effectiveDP(state, opp(ctx.self), s) <= dpMax)) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `두프트몬 X항체: DP ${dpMax} 이하의 상대의 디지몬 1마리를 패로 되돌릴까요?` }))) return;
  await R.runScript([{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { dpMax }, requireSuspended: null, dest: 'hand' }], ctx);
} }];

// BT25-074 탱크드라몬 【서로의 턴】[턴 1회] 특징 「D-브리가드」/「엑셀」을 가진 자신의 디지몬이 등장했을 때, 상대의 디지몬 1마리는 상대의 턴 종료까지 진화할 수 없다.
SCRIPTS['BT25-074::서로의 턴'] = [{ op: 'c61_fn', fn: async (ctx) => {
  const { state } = ctx;
  const o = opp(ctx.self);
  const uids = state.players[o].battle.filter(isDigi).map(s => s.uid);
  if (!uids.length) return;
  const uid = uids.length === 1 ? uids[0] : await ctx.choose('pickStack', { player: o, uids, prompt: '상대의 턴 종료까지 진화할 수 없게 할 상대의 디지몬 선택' });
  const t = uid && state.players[o].battle.find(s => s.uid === uid);
  if (!t) return;
  t.cannotEvolveUntil = oppTurnEnd(state, ctx.self);
  S.log(state, `${o} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 진화할 수 없음`);
} }];
