// ST9-06 황제드라몬: 드래곤 모드 【진화 시】 — Q&A 710 (id 710 in data/rulings/all.json):
// "may play 1 Lv.4- blue AND 1 Lv.4- green from this stack's sources, cost-free" is an all-or-nothing OPTIONAL
// action: you may decline the whole thing, but if both colors are present among the sources you may NOT take
// only one of them. The generic compiler's moveEach(groups) treated each color as an independently-skippable
// slot (min:0 each), which allowed picking blue while declining green. This regression-tests the bespoke fix.
import { S, mk, put, T, eq, ok, runAll, body } from './lib-s1.mjs';
import { runSeg } from './lib-ex13.mjs';

T(710, 'ST9-06: confirm -> both Lv.4- blue+green sources are forced out together (no partial skip)', async () => {
  const st = mk();
  const blueV = body('blue', 4), greenV = body('green', 4);
  ok('setup: distinct vanilla blue/green Lv.4 found', !!blueV && !!greenV && blueV !== greenV);
  const s = put(st, 'p1', 'ST9-06', { src: [blueV, greenV] });
  await runSeg(st, 'p1', s, 'ST9-06', '진화 시');
  eq('진화원 소진', s.sources.length, 0);
  ok('블루 카드 등장', st.players.p1.battle.some(x => x.cardId === blueV));
  ok('그린 카드 등장', st.players.p1.battle.some(x => x.cardId === greenV));
  eq('배틀 에어리어 3장 (본체+2)', st.players.p1.battle.length, 3);
});

T(710.1, 'ST9-06: declining the whole effect leaves the sources untouched', async () => {
  const st = mk();
  const blueV = body('blue', 4), greenV = body('green', 4);
  const s = put(st, 'p1', 'ST9-06', { src: [blueV, greenV] });
  st._qaAns = { confirmEffect: false };
  await runSeg(st, 'p1', s, 'ST9-06', '진화 시');
  eq('진화원 그대로', s.sources, [blueV, greenV]);
  eq('배틀 에어리어 1장 (본체만)', st.players.p1.battle.length, 1);
});

T(710.2, 'ST9-06: only a blue source present -> just the blue card comes out, no prompt needed for green', async () => {
  const st = mk();
  const blueV = body('blue', 4);
  const otherSrc = body('red', 3) || body('yellow', 3);
  const s = put(st, 'p1', 'ST9-06', { src: [otherSrc, blueV] });
  await runSeg(st, 'p1', s, 'ST9-06', '진화 시');
  ok('블루 카드 등장', st.players.p1.battle.some(x => x.cardId === blueV));
  eq('그린 후보 없음: 다른 소스 그대로 남음', s.sources, [otherSrc]);
});

await runAll('qa-st9-06');
