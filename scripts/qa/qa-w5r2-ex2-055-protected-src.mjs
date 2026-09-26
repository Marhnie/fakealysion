// Official Q&A id3347 (EX2-055 리퍼): "마더 디·리퍼" 진화원에 파기할 수 없는 카드(BT9-109 X항체)가 있어도, 그 카드를 제외하고 아래에서부터 7장 이상
// 파기할 수 있으면 등장 코스트를 0으로 할 수 있다. 파기 가능한 진화원이 7장 미만이면 사용 불가(카드를 일부만 파기하고 코스트 0이 되면 안 됨).
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const opts = (st) => S.hookPlayCostOptions(st, 'p1', 'EX2-055');
T(3347, 'EX2-055: X항체 1장을 포함한 진화원 8장 -> 7장 파기하고 코스트 0', async () => {
  const st = mk(); const src = Array(7).fill(FILL); const mom = put(st, 'p1', 'EX2-007', { src: ['BT9-109', ...src] });
  const o = opts(st); ok('옵션 노출', o.length === 1);
  const d = await o[0].apply(async () => mom.uid);
  eq('코스트 -20', d, -20); eq('X항체는 남음', mom.sources.includes('BT9-109'), true); eq('진화원 1장 남음', mom.sources.length, 1);
});
T('3347b', 'EX2-055: 파기 가능한 진화원이 6장뿐(7장 중 X항체 1장) -> 사용 불가, 아무것도 파기되지 않음', async () => {
  const st = mk(); const src = Array(6).fill(FILL); const mom = put(st, 'p1', 'EX2-007', { src: ['BT9-109', ...src] });
  const o = opts(st);
  if (o.length) { const d = await o[0].apply(async () => mom.uid); eq('코스트 0 할인 없음', d, 0); }
  eq('진화원 7장 그대로', mom.sources.length, 7);
});
await runAll('qa-w5r2-ex2-055');
