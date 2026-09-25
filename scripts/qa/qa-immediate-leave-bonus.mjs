// 즉시형(15-8-5) "벗어날 때, …등장시킬 수 있다"류 재분류 회귀 테스트 (docs/effect-classification-rules.md).
// BT23-032(CS 토우몬)류는 예전엔 "벗어났을 때"(유발형)처럼 구현되어 있어서 스택이 이미 트래시로 넘어간 *후*
// state.pending에서 처리됐다. 지금은 state.js의 replGate/replAttempt/hookPreventLeave(passive) 경로를 통해
// 배틀 에어리어를 벗어나기 *직전*에 끼어들어, 아직 살아있는 stack.sources를 참조한다 (떠남 자체는 막지 않음).
// Run: node scripts/qa/qa-immediate-leave-bonus.mjs
import { S, FILL, mk, put, T, eq, ok, runAll, body } from './lib-s1.mjs';

// interactive REPL 모드에서 pendingReplacements 큐를 하나 골라 진행시키는 헬퍼.
function firstPending(st) { return (st.pendingReplacements || [])[0] || null; }

T('bt23032-alone', 'BT23-032 단독: 배틀로 소멸 — 진화원 카드를 트래시로 넘어가기 전에 등장시킬 수 있다 (즉시형)', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const src = body('yellow', 3); // Lv.3 옐로 바닐라 — BT23-032 조건(Lv.4 이하 + CS 특징이거나 옐로/블랙)을 만족
    const s = put(st, 'p1', 'BT23-032', { src: [src] });
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    eq('배틀 소멸은 대기 상태로 파킹된다 (interactive REPL)', r, null);
    const entry = firstPending(st);
    ok('대체 후보가 하나 생성됨', !!entry && entry.cands.length === 1);
    ok('그 후보는 passive(=떠남을 막지 않음)', !!entry.cands[0].passive);
    S.resumeReplacement(st, entry, 0); // 후보 사용
    ok('CS 토우몬 스택은 실제로 배틀 에어리어를 벗어남 (트래시로)', st.players.p1.trash.includes('BT23-032'));
    ok('진화원 카드는 트래시에 남지 않고 새 스택으로 등장함', !st.players.p1.trash.includes(src));
    const played = st.players.p1.battle.find((x) => x.cardId === src);
    ok('진화원 카드가 배틀 에어리어에 새로 등장', !!played && played.sources.length === 0);
  } finally { S.REPL.interactive = false; }
});

T('bt23032-decline', 'BT23-032: 즉시형 효과를 사용하지 않아도 정상적으로 소멸한다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const src = body('yellow', 3);
    const s = put(st, 'p1', 'BT23-032', { src: [src] });
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    S.resumeReplacement(st, entry, -1); // 사용하지 않음
    ok('CS 토우몬은 트래시로', st.players.p1.trash.includes('BT23-032'));
    ok('진화원 카드도 그대로 트래시에 남음 (등장시키지 않음)', st.players.p1.trash.includes(src));
    ok('새 스택이 등장하지 않음', !st.players.p1.battle.some((x) => x.cardId === src));
  } finally { S.REPL.interactive = false; }
});

// Q6250 (シャッコウモン/BT23-032 공식 룰링): 진화원에 「BT23-027 엔젤몬」이 있는 채로 배틀에서 소멸할 때, ≪방벽≫과
// 이 카드의 즉시형 leave-보너스가 같은 시점(요인 직전)에 함께 뜬다. 두 순서 모두 지원해야 하며, "즉시형 효과를 먼저
// 발휘해 엔젤몬을 등장시키면, 그 엔젤몬의 진화원 효과(≪방벽≫ 부여)를 잃어서 이후 ≪방벽≫을 쓸 수 없다"는 순서
// 의존성이 정확히 재현되어야 한다. (반대 순서 — 방벽을 먼저 써서 살아남은 뒤에도 이 효과를 쓸 수 있다는 룰링의
// 나머지 절반은 현재 엔진 구조상 모델링하지 않음: docs/effect-classification-rules.md 후속 조치 참고.)
T('q6250-order-barrier-first', 'Q6250: ≪방벽≫을 먼저 선택하면 소멸하지 않고, 엔젤몬은 그대로 진화원에 남는다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'BT23-032', { src: ['BT23-027'] });
    st.players.p1.security = Array(3).fill(FILL);
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    ok('두 후보(방벽 / 즉시형 보너스)가 함께 제시됨', entry && entry.cands.length === 2);
    const barrierIdx = entry.cands.findIndex((c) => !c.passive);
    ok('방벽 후보가 존재 (passive 아님 — 떠남을 막는 효과)', barrierIdx !== -1);
    const secBefore = st.players.p1.security.length;
    S.resumeReplacement(st, entry, barrierIdx);
    ok('CS 토우몬이 소멸하지 않고 그대로 배틀 에어리어에 있음', st.players.p1.battle.some((x) => x.uid === s.uid));
    eq('시큐리티 1장 파기됨 (≪방벽≫ 비용)', st.players.p1.security.length, secBefore - 1);
    ok('진화원의 엔젤몬은 그대로 남아있음 (즉시형 보너스는 쓰이지 않음)', s.sources.includes('BT23-027'));
  } finally { S.REPL.interactive = false; }
});

T('q6250-order-bonus-first', 'Q6250: 즉시형 보너스를 먼저 써서 엔젤몬을 등장시키면, 이후 ≪방벽≫을 쓸 수 없어 소멸한다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'BT23-032', { src: ['BT23-027'] });
    st.players.p1.security = Array(3).fill(FILL);
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    const bonusIdx = entry.cands.findIndex((c) => c.passive);
    ok('즉시형 보너스 후보가 존재', bonusIdx !== -1);
    const secBefore = st.players.p1.security.length;
    S.resumeReplacement(st, entry, bonusIdx);
    ok('CS 토우몬은 결국 소멸함 (방벽을 재사용할 수 없으므로)', st.players.p1.trash.includes('BT23-032'));
    eq('시큐리티는 파기되지 않음 (방벽 미사용)', st.players.p1.security.length, secBefore);
    ok('엔젤몬은 코스트 없이 새로 등장함', st.players.p1.battle.some((x) => x.cardId === 'BT23-027' && x.sources.length === 0));
  } finally { S.REPL.interactive = false; }
});

T('bt14018-forced-token-cleanup', 'BT14-018: 배틀 에어리어를 벗어날 때 자신의 토큰 전부 소멸은 강제(즉시형)이며, 소멸 전에 바로 처리되어 플레이어가 거절할 선택지로 노출되지 않는다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const s = put(st, 'p1', 'BT14-018', {});
    const secBefore0 = 3; st.players.p1.security = Array(secBefore0).fill(FILL);
    st.players.p1.deck = [FILL, ...st.players.p1.deck];
    const tokId = Object.keys(S.CARDS).find((id) => S.CARDS[id].nameKo === '홍염의 아몬');
    const tok = put(st, 'p1', tokId, {});
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    ok('강제 효과는 후보 목록에 노출되지 않음 (파킹되더라도 그 후보에 forcedOnLeave 선택지는 없음)',
      !(st.pendingReplacements || []).some((e) => e.uid === s.uid));
    ok('강제 효과라 바로 진행되어 이미 소멸 처리됨', r !== null || st.players.p1.trash.includes('BT14-018'));
    if (r === null) S.resumeReplacement(st, firstPending(st), -1); // 다른 (무관한) 후보가 있었다면 전부 거절해도 강제 효과 결과는 그대로여야 함
    ok('토큰이 정리됨(소멸)', !st.players.p1.battle.some((x) => x.uid === tok.uid));
    ok('《리커버리 +1《덱》》: 시큐리티가 1장 늘어남', st.players.p1.security.length === secBefore0 + 1);
  } finally { S.REPL.interactive = false; }
});

await runAll('qa-immediate-leave-bonus');
