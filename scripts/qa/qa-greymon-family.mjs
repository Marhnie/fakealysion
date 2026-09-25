// Greymon/MetalGreymon (그라우몬/메가로그라우몬) family 진화 시 free-play predicates.
// Playtester reports: EX8-012 그라우몬 X항체 wrongly let 길몬/듀크몬 be played straight from HAND right after
// digivolving (should instead grant a delayed 【소멸 시】 trash-only, 「길몬」-named play, per official text);
// EX3-062 메가로그라우몬 wrongly refused 길몬 even though the printed text names it explicitly.
// Run: node scripts/qa/qa-greymon-family.mjs < /dev/null
import { S, mk, put, drain, setHand, setTrash, T, eq, ok, runAll, evolve, FILL } from './lib-s1.mjs';

const GIGIMON = 'ST7-03';   // exact name 길몬
const GALLANTMON = 'ST7-09'; // exact name 듀크몬
const GROWLMON = 'ST7-05';  // exact name 그라우몬 (Lv.4 base — also a valid EX3-062 evo base and EX8-012 evo-source)

T('EX3-062-a', 'EX3-062 메가로그라우몬: 자신의 트래시가 5장 이상이면 패의 「길몬」을 코스트 없이 등장시킬 수 있다', async () => {
  const st = mk();
  const base = put(st, 'p1', GROWLMON);
  st.memory = 10;
  setTrash(st, 'p1', Array(5).fill(FILL));
  setHand(st, 'p1', [GIGIMON]);
  await evolve(st, 'p1', base.uid, 'EX3-062', 0, 'hand');
  ok('오류 없음', !(st._qaErr && st._qaErr.length));
  ok('길몬이 배틀 영역에 코스트 없이 등장', st.players.p1.battle.some(s => s.cardId === GIGIMON));
  ok('길몬이 패에서 사라짐', !st.players.p1.hand.includes(GIGIMON));
});

T('EX3-062-b', 'EX3-062 메가로그라우몬: 자신의 트래시가 5장 미만이면 패의 「길몬」이 있어도 등장시키지 않는다 (조건 미충족 — blanket-allow 방지 확인)', async () => {
  const st = mk();
  const base = put(st, 'p1', GROWLMON);
  st.memory = 10;
  setTrash(st, 'p1', []); // 서로의 덱 위 3장 파기 후에도 3장 < 5
  setTrash(st, 'p2', Array(6).fill(FILL)); // 상대 트래시 조건은 이 브랜치(패의 「길몬」)와 무관해야 함
  setHand(st, 'p1', [GIGIMON]);
  await evolve(st, 'p1', base.uid, 'EX3-062', 0, 'hand');
  ok('오류 없음', !(st._qaErr && st._qaErr.length));
  ok('길몬이 패에 그대로 남음 (조건 미충족)', st.players.p1.hand.includes(GIGIMON));
  ok('길몬이 배틀 영역에 없음', !st.players.p1.battle.some(s => s.cardId === GIGIMON));
});

T('EX8-012-a', 'EX8-012 그라우몬 X항체: 【진화 시】는 드로우/디스카드만 하고, 패의 카드를 즉시 코스트 없이 등장시키지 않는다 (길몬/듀크몬 포함)', async () => {
  const st = mk();
  const base = put(st, 'p1', GROWLMON); // 진화원에 「그라우몬」이 들어가 조건 충족
  st.memory = 10;
  setHand(st, 'p1', [GIGIMON, GALLANTMON, FILL]);
  // 필수 파기(자신의 패 1장) 대상은 필러로 강제 지정해 길몬/듀크몬이 살아남는지만 순수하게 확인
  st._qaAns = { pickFromHandIndexes: (o) => { const i = (o.eligibleIdxs || []).find(i => st.players.p1.hand[i] === FILL); return i != null ? [i] : (o.eligibleIdxs || []).slice(0, 1); } };
  await evolve(st, 'p1', base.uid, 'EX8-012', 0, 'hand');
  ok('오류 없음', !(st._qaErr && st._qaErr.length));
  ok('길몬이 패에 남음 (즉시 등장 안 됨)', st.players.p1.hand.includes(GIGIMON));
  ok('듀크몬이 패에 남음 (즉시 등장 안 됨)', st.players.p1.hand.includes(GALLANTMON));
  eq('배틀에는 진화한 스택 1개만 존재 (추가로 등장한 디지몬 없음)', st.players.p1.battle.filter(s => S.card(s.cardId).category === 'digimon').length, 1);
});

T('EX8-012-b', 'EX8-012 그라우몬 X항체: 진화원 조건 충족 시 부여되는 【소멸 시】 효과는 트래시의 「길몬」만 등장시킬 수 있고 「듀크몬」은 대상이 아니다', async () => {
  const st = mk();
  const base = put(st, 'p1', GROWLMON);
  st.memory = 10;
  setHand(st, 'p1', [FILL]);
  st._qaAns = { pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) };
  await evolve(st, 'p1', base.uid, 'EX8-012', 0, 'hand');
  const stack = st.players.p1.battle.find(s => s.cardId === 'EX8-012');
  ok('스택 존재', !!stack);
  ok('진화원(「그라우몬」) 조건 충족으로 【소멸 시】 효과가 부여됨', (stack.s2Granted || []).some(g => g.trigger === 'delete'));

  setTrash(st, 'p1', [GALLANTMON, GIGIMON]); // 듀크몬 + 길몬이 함께 트래시에 있는 상태
  let eligibleSeen = null;
  st._qaAns = { pickFromZoneIndex: (o) => { if (o.zone === 'trash') eligibleSeen = (o.eligibleIdxs || []).map(i => st.players.p1.trash[i]); return o.eligibleIdxs?.[0] ?? null; } };
  S.queueTriggersForStack(st, 'p1', stack, 'delete');
  await drain(st);
  ok('오류 없음', !(st._qaErr && st._qaErr.length));
  eq('트래시에서 고를 수 있는 카드는 「길몬」뿐 (듀크몬은 선택지에 없음)', eligibleSeen, [GIGIMON]);
  ok('길몬이 트래시에서 코스트 없이 등장함', st.players.p1.battle.some(s => s.cardId === GIGIMON));
  ok('듀크몬은 트래시에 그대로 남음 (대상이 아님)', st.players.p1.trash.includes(GALLANTMON));
});

await runAll('qa-greymon-family');
