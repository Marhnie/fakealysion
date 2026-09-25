// 즉시형(15-8-5) "벗어날 때"/"소멸할 때"/"진화할 때" 재분류 회귀 테스트, part 2 (docs/effect-classification-rules.md 후속 조치).
// Covers EX4-021, BT7-063, EX5-070, EX11-052 (all moved from a post-hoc state.pending trigger to the interrupt-based
// hookPreventLeave/preventLeaveOptions|forcedOnLeave|forcedOnAnyLeave path) and EX2-056 (moved from a post-hoc events.digivolve
// hook to beforeDigivolve, so the grant lands before the SAME digivolve's own 【진화 시】 triggers are queued).
// Run: node scripts/qa/qa-immediate-leave-bonus2.mjs
import { S, mk, put, T, eq, ok, runAll, FILL } from './lib-s1.mjs';

function firstPending(st) { return (st.pendingReplacements || [])[0] || null; }
const secondFiller = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.level === 3 && c.dp && !c.effectKo && !c.inheritedKo && c.id !== FILL)?.id;

// ---- EX4-021: "이 디지몬이 소멸하거나 패/덱으로 되돌아갈 때, 이 디지몬의 진화원에서 「메탈그레이몬」과 「다크나이트몬」 1장씩을
// 코스트를 지불하지 않고 등장시킬 수 있다." OPTIONAL, "1장씩" = both names independently usable in the same leave.
T('ex4021-both-offered', 'EX4-021: 「메탈그레이몬」/「다크나이트몬」이 진화원에 있으면 후보 2개가 함께 제시된다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'EX4-021', { src: ['ST1-09', 'BT7-063'] }); // ST1-09=메탈그레이몬(무효과), BT7-063=다크나이트몬
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    ok('후보 2개(메탈그레이몬 / 다크나이트몬)가 함께 제시됨', !!entry && entry.cands.length === 2);
    S.resumeReplacement(st, entry, -1); // 둘 다 거절
    ok('EX4-021은 트래시로', st.players.p1.trash.includes('EX4-021'));
    ok('두 진화원 카드 모두 그대로 트래시에 남음 (사용 안 함)', st.players.p1.trash.includes('ST1-09') && st.players.p1.trash.includes('BT7-063'));
  } finally { S.REPL.interactive = false; }
});
T('ex4021-both-usable', 'EX4-021: 두 이름 모두 같은 이탈에서 독립적으로 사용할 수 있다 (1장씩)', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'EX4-021', { src: ['ST1-09', 'BT7-063'] });
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    let guard = 0, entry;
    while ((entry = firstPending(st)) && guard++ < 5) S.resumeReplacement(st, entry, 0); // 매번 첫 후보 선택
    ok('EX4-021은 결국 트래시로', st.players.p1.trash.includes('EX4-021'));
    ok('메탈그레이몬(ST1-09)이 코스트 없이 새로 등장', st.players.p1.battle.some((x) => x.cardId === 'ST1-09' && x.sources.length === 0));
    ok('다크나이트몬(BT7-063)도 코스트 없이 새로 등장', st.players.p1.battle.some((x) => x.cardId === 'BT7-063' && x.sources.length === 0));
  } finally { S.REPL.interactive = false; }
});

// ---- BT7-063: "이 디지몬이 소멸할 때, 이 디지몬의 진화원에서 「스컬나이트몬」과 「데들리액스몬」 1장씩을 코스트를 지불하지 않고 레스트
// 상태로 등장시킬 수 있다." OPTIONAL, prospective-tense "소멸할 때" (not the literal string "벗어날 때") is still 즉시형 (15-8-5-1).
T('bt7063-rested', 'BT7-063: 진화원의 스컬나이트몬/데들리액스몬이 레스트 상태로 등장한다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'BT7-063', { src: ['BT7-058', 'BT7-059'] }); // 스컬나이트몬 / 데들리액스몬
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    let guard = 0, entry;
    while ((entry = firstPending(st)) && guard++ < 5) S.resumeReplacement(st, entry, 0);
    const skull = st.players.p1.battle.find((x) => x.cardId === 'BT7-058');
    const axe = st.players.p1.battle.find((x) => x.cardId === 'BT7-059');
    ok('스컬나이트몬이 새로 등장', !!skull);
    ok('데들리액스몬이 새로 등장', !!axe);
    ok('둘 다 레스트 상태로 등장', !!skull.suspended && !!axe.suspended);
  } finally { S.REPL.interactive = false; }
});

// ---- EX5-070 (inherited): "이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 디지몬 카드 1장을 패로
// 되돌리고, 「X항체」 1장을 시큐리티 위에 놓는다." MANDATORY ("…놓는다", no "…수 있다") -> forcedOnLeave, no interactive REPL needed.
// (EX5-070 declares its own 〈룰〉명칭: 「X항체」로도 취급, so it doubles as both the ability's source AND the "X항체 1장" it places
// on security once the other digimon source (secondFiller, placed ON TOP so it is found first) has been returned to hand.)
T('ex5070-forced', 'EX5-070(진화원): 벗어날 때 디지몬 1장은 패로, X항체 1장은 시큐리티 위로 (강제, 즉시)', async () => {
  const st = mk();
  const host = put(st, 'p1', FILL, { src: ['EX5-070', secondFiller] });
  st._fxSrc = { player: 'p2', category: 'digimon', cardId: FILL };
  const secBefore = st.players.p1.security.length;
  const r = S.deleteStack(st, 'p1', host.uid, 'trash', 'effect');
  st._fxSrc = null;
  ok('강제 효과라 REPL 파킹 없이 바로 처리됨', r === null || st.players.p1.trash.includes(FILL));
  ok('진화원의 디지몬 카드(secondFiller)가 패로 되돌아감', st.players.p1.hand.includes(secondFiller));
  ok('진화원의 「X항체」(EX5-070 자신)가 트래시가 아니라 시큐리티로', !st.players.p1.trash.includes('EX5-070'));
  eq('시큐리티가 1장 늘어남 (X항체가 위에 놓임)', st.players.p1.security.length, secBefore + 1);
});
T('ex5070-own-effect-skips', 'EX5-070(진화원): 자신의 효과로 벗어날 때는 발동하지 않는다', async () => {
  const st = mk();
  const host = put(st, 'p1', FILL, { src: ['EX5-070', secondFiller] });
  st._fxSrc = { player: 'p1', category: 'digimon', cardId: FILL };
  S.deleteStack(st, 'p1', host.uid, 'trash', 'ownEffect');
  st._fxSrc = null;
  ok('자신의 효과로 소멸: 디지몬이 패로 되돌아가지 않음', !st.players.p1.hand.includes(secondFiller));
  ok('자신의 효과로 소멸: X항체도 시큐리티로 옮겨지지 않음', st.players.p1.trash.includes('EX5-070'));
});

// ---- EX11-052: "특징 「마룡형」/「사룡형」을 가진 자신의 디지몬이 배틀 에어리어를 벗어날 때, 자신의 패가 4장 이하라면, 상대의 시큐리티
// 1장을 파기한다." MANDATORY, and NOT self-only ("이 디지몬이") — any of hp's qualifying digimon leaving, so forcedOnAnyLeave.
T('ex11052-any-leave', 'EX11-052: 자기 자신이 아닌 다른 마룡형/사룡형 디지몬이 벗어나도 발동한다', async () => {
  const st = mk();
  put(st, 'p1', 'EX11-052', {});
  const other = put(st, 'p1', 'ST7-05', {}); // 그라우몬, 마룡형, 무효과
  st.players.p1.hand = [FILL, FILL]; // 패 4장 이하
  st.players.p2.security = [FILL, FILL, FILL];
  const secBefore = st.players.p2.security.length;
  S.deleteStack(st, 'p1', other.uid, 'trash', 'battle');
  eq('상대 시큐리티 1장 파기됨', st.players.p2.security.length, secBefore - 1);
});
T('ex11052-once-per-turn', 'EX11-052: [턴에 1회] — 같은 턴에 두 번째로 벗어나도 다시 발동하지 않는다', async () => {
  const st = mk();
  const holder = put(st, 'p1', 'EX11-052', {});
  const o1 = put(st, 'p1', 'ST7-05', {});
  const o2 = put(st, 'p1', 'BT2-013', {}); // 다른 그라우몬 인스턴스, 마룡형
  st.players.p1.hand = [FILL];
  st.players.p2.security = [FILL, FILL, FILL];
  S.deleteStack(st, 'p1', o1.uid, 'trash', 'battle');
  const secAfterFirst = st.players.p2.security.length;
  S.deleteStack(st, 'p1', o2.uid, 'trash', 'battle');
  eq('두 번째 이탈에서는 시큐리티가 더 줄지 않음', st.players.p2.security.length, secAfterFirst);
});
T('ex11052-hand-gate', 'EX11-052: 패가 4장 초과면 발동하지 않는다', async () => {
  const st = mk();
  put(st, 'p1', 'EX11-052', {});
  const other = put(st, 'p1', 'ST7-05', {});
  st.players.p1.hand = [FILL, FILL, FILL, FILL, FILL]; // 패 5장
  st.players.p2.security = [FILL, FILL, FILL];
  const secBefore = st.players.p2.security.length;
  S.deleteStack(st, 'p1', other.uid, 'trash', 'battle');
  eq('시큐리티가 줄지 않음', st.players.p2.security.length, secBefore);
});

// ---- EX2-056: "자신의 디지몬이 명칭에 「듀크몬」/「그라우몬」을 포함하는 디지몬으로 진화할 때, 이 턴 동안 그 디지몬은
// 「【진화 시】《진격》」을 얻는다." Prospective tense ("진화할 때") = 즉시형: the grant must land in THIS digivolve's own 【진화 시】
// batch, not a later one — verified by finding the granted-effect pending entry already queued before any drain runs.
T('ex2056-grant-timing', 'EX2-056: 그라우몬으로 진화하는 바로 그 순간(같은 【진화 시】 배치)에 《진격》을 얻는다', async () => {
  const st = mk();
  put(st, 'p1', 'EX2-056', {});
  const pre = put(st, 'p1', FILL, {});
  st.players.p1.hand.push('ST7-05'); // ST7-05 = 그라우몬 (무효과)
  const r = S.digivolve(st, 'p1', pre.uid, 'ST7-05', 0, 'hand');
  ok('진화 성공', !!r);
  const grantPending = st.pending.some((t) => !t.resolved && t.stackUid === r.uid && t.text === '《진격》');
  ok('드레인 전에 이미 이 진화의 【진화 시】 배치에 《진격》 부여가 큐잉되어 있음 (즉시형 타이밍)', grantPending);
  const { drain } = await import('./lib-s1.mjs');
  await drain(st);
  ok('《진격》 키워드가 실제로 부여됨', S.hasKeyword(r, '진격'));
});
T('ex2056-non-matching-name-no-grant', 'EX2-056: 듀크몬/그라우몬이 아닌 디지몬으로 진화하면 부여되지 않는다', async () => {
  const st = mk();
  put(st, 'p1', 'EX2-056', {});
  const pre = put(st, 'p1', FILL, {});
  st.players.p1.hand.push(secondFiller);
  const r = S.digivolve(st, 'p1', pre.uid, secondFiller, 0, 'hand');
  ok('진화 성공', !!r);
  ok('《진격》 부여 없음', !st.pending.some((t) => !t.resolved && t.stackUid === r.uid && t.text === '《진격》'));
});

await runAll('qa-immediate-leave-bonus2');
