// 《돌진》 어택 대상 변경 pickStack: payload.player가 uid들이 속한 플레이어(=상대)와 일치해야 한다.
// 예전엔 player: ctx.self(공격자)를 넘겨서, 사람이 두는 화면의 렌더러(state.players[payload.player]로 uid를 찾음)가
// 상대 쪽 대상을 하나도 못 찾아 "대상 없음"처럼 보였다 (src/main.js renderUiChoice 'pickStack' 참고).
// Run: node scripts/qa/qa-charge-pickstack-owner.mjs < /dev/null
import { S, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';
const charge = Object.values(S.CARDS).find(c => c.category === 'digimon' && /《돌진》/.test(c.effectKo || ''));
T(1, 'pickStack(chargeKw) payload.player == 대상 uid들이 속한 플레이어(상대), ctx.self 아님', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const a = put(st, 'p1', charge.id);
  const t1 = put(st, 'p2', 'ST1-05'); // DP5000
  st.attackCtx = { attacker: 'p1', opp: 'p2', uid: a.uid, targetKind: 'player', targetUid: null, ended: false };
  let seen = null;
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: charge.id, sourceStackUid: a.uid,
    attack: () => st.attackCtx, choose: async (k, o) => { if (k === 'pickStack' && o.chargeKw) { seen = o; return null; } return null; } };
  const { SCRIPTS } = await import('../../src/cards/shard96.js');
  await SCRIPTS['*::__돌진'][0].fn(ctx);
  ok('pickStack(chargeKw) 프롬프트가 열림', !!seen);
  eq('payload.player는 상대(p2) — 대상 uid들이 실제로 속한 쪽', seen.player, 'p2');
  ok('대상 uid가 그 플레이어의 실제 스택', st.players[seen.player].battle.some(s => s.uid === seen.uids[0]));
});
await runAll('qa-charge-pickstack-owner');
