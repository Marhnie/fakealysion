// BT17-050 패러사이몬: "상대 디지몬을 레스트시키고, 어택할 수 있다"는 하나로 묶인 처리다(Q2804) —
// 레스트만 시키고 어택을 거절/취소할 수 없다(상대는 레스트되지 않은 채로 남아야 한다).
// Run: node scripts/qa/qa-audit-parasite-atomic.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const HOST = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && c.dp && !c.effectKo)?.id;
T(1, '어택을 거절하면 상대 디지몬도 레스트되지 않는다', async () => {
  const st = mk(); const host = put(st, 'p1', HOST); st.players.p1.hand.push('BT17-050');
  const opp1 = put(st, 'p2', FILL);
  const { OPS } = await import('../../src/cards/shard4.js');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT17-050',
    choose: async (k, o) => { if (k === 'pickStack') return o.uids ? o.uids[0] : null; if (k === 'confirmEffect') return false; return null; },
    startAttack: () => { throw new Error('should not attack'); } };
  await OPS.s4_parasite({}, ctx);
  ok('상대 디지몬은 레스트되지 않음', !opp1.suspended);
});
T(2, '어택을 수락하면 상대 디지몬이 레스트되고 어택이 시작된다', async () => {
  const st = mk(); const host = put(st, 'p1', HOST); st.players.p1.hand.push('BT17-050');
  const opp1 = put(st, 'p2', FILL);
  const { OPS } = await import('../../src/cards/shard4.js');
  let attacked = false;
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT17-050',
    choose: async (k, o) => { if (k === 'pickStack') return o.uids ? o.uids[0] : null; if (k === 'confirmEffect') return true; return null; },
    startAttack: () => { attacked = true; } };
  await OPS.s4_parasite({}, ctx);
  ok('상대 디지몬이 레스트됨', opp1.suspended);
  ok('어택이 시작됨', attacked);
});
await runAll('qa-audit-parasite-atomic');
