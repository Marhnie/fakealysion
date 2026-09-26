// EX6-062 얼티메이트카오스몬 【자신의 턴】 「진화원에 Lv.6의 카드가 4장 이상 있는 이 디지몬은 《관통》과 《S 어택 +3》을 얻는다」 — 상시 효과가 전혀 적용되지 않던 것을 수정 (Q3806/3807 카드).
import { S, C, mk, put, T, eq, runAll } from './lib-s1.mjs';
const has = (st, p, s, kw) => S.hasKeyword(s, kw) || S.hookGrantedKeywords(st, p, s).includes(kw);
T('ex6-062', 'EX6-062: Lv.6 진화원 4장 이상이면 관통 + S 어택 +3, 3장이면 없음, 상대 턴에는 없음', async () => {
  let st = mk(); let s = put(st, 'p1', 'EX6-062', { src: Array(3).fill('ST1-10') });
  eq('3장: 관통 없음', has(st, 'p1', s, '관통'), false); eq('3장: S어택 +0', S.hookSecurityAttackBonus(st, 'p1', s), 0);
  st = mk(); s = put(st, 'p1', 'EX6-062', { src: Array(4).fill('ST1-10') });
  eq('4장: 관통', has(st, 'p1', s, '관통'), true); eq('4장: S어택 +3', S.hookSecurityAttackBonus(st, 'p1', s), 3);
  st.activePlayer = 'p2'; eq('상대의 턴: 없음', has(st, 'p1', s, '관통'), false);
});
await runAll('qa-w5r2-ex6-062');
