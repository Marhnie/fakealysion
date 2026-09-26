// Official Q&A ids 3420-3422 (EX3-053 메탈릭드라몬 【등장 시】 …액티브 상태의 상대의 디지몬 전부는 진화할 수 없다): 조그레스는 두 재료 모두 레스트여야 하고, 액티브 상태의 테이머를
// 디지몬으로 취급해 진화하는 경우(BT4-011 등)도 액티브 상태의 디지몬으로 간주되어 진화할 수 없다.
import { S, E, C, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
const tamer = Object.values(S.CARDS).find(c => c.category === 'tamer' && !c.effectKo)?.id || Object.values(S.CARDS).find(c => c.category === 'tamer')?.id;
T(3420, 'EX3-053 잠금: 액티브 디지몬은 진화 불가, 레스트 디지몬은 가능, 후에 등장한 액티브도 잠김', async () => {
  const st = mk(); const a = put(st, 'p2', lv(4)), r = put(st, 'p2', lv(4), { susp: true }); S.addEvolveLock(st, 'p2', 99, st.turnNumber + 1, true);
  eq('액티브 진화 불가', !!S.evolveTargetRestriction(st, 'p2', a).cannotEvolve, true);
  eq('레스트는 진화 가능', !!S.evolveTargetRestriction(st, 'p2', r).cannotEvolve, false);
  const late = put(st, 'p2', lv(5)); eq('나중에 나온 액티브도 잠김', !!S.evolveTargetRestriction(st, 'p2', late).cannotEvolve, true);
});
T(3422, 'EX3-053 잠금: 액티브 상태의 테이머(디지몬으로 취급해 진화)도 진화 불가', async () => {
  const st = mk(); const t = put(st, 'p2', tamer); S.addEvolveLock(st, 'p2', 99, st.turnNumber + 1, true);
  eq('액티브 테이머 진화 불가', !!S.evolveTargetRestriction(st, 'p2', t).cannotEvolve, true);
  t.suspended = true; eq('레스트 테이머는 가능', !!S.evolveTargetRestriction(st, 'p2', t).cannotEvolve, false);
});
await runAll('qa-w5r2-ex3-053');
