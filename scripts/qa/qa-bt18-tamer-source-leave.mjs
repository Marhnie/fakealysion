// 즉시형(15-8-5) "…벗어날 때, 이 디지몬의 진화원에서 진화원 효과를 가진 테이머 카드 1장을 코스트 없이 등장시킬 수 있다"
// (docs/effect-classification-rules.md). BT18-022/048/063/076 공유 상속 효과 — 예전엔 onLeave+queueHookSegment로
// 유발형(15-8-3)처럼 구현되어 있어서, 카드가 이미 트래시로 넘어간 *후*에 state.pending에서 처리됐다. 지금은
// state.js hookPreventLeave의 preventLeaveOptions(passive) 경로를 통해 배틀 에어리어를 벗어나기 *직전*에 끼어들어
// 아직 살아있는 holder.sources를 참조한다 (src/cards/shard4.js tamerSourceLeaveOptions).
//
// 이 효과는 BT18-022의 effectKo가 아니라 inheritedKo에만 적혀 있다 (BT23-032류와 달리 두 필드에 동일 문구가 중복 인쇄돼
// 있지 않음) — 즉 이 카드 자신이 배틀 에어리어 맨 위에 있을 때가 아니라, "다른 디지몬의 진화원으로 깔려 있을 때" 그
// 디지몬("이 디지몬" = holder)이 벗어나는 순간에만 발동한다. 그래서 아래 시나리오는 BT18-022를 어떤 host 디지몬의
// 진화원에 넣어두고, 그 host가 배틀 에어리어를 벗어나는 상황으로 구성한다. 4장이 완전히 동일한 inheritedKo 문구를
// 공유하므로(코스트/색만 다름) BT18-022 하나로 대표 검증한다.
// Run: node scripts/qa/qa-bt18-tamer-source-leave.mjs
import { S, mk, put, T, ok, runAll, body } from './lib-s1.mjs';

function firstPending(st) { return (st.pendingReplacements || [])[0] || null; }

// 진화원 효과(inheritedKo)를 가진 테이머 카드 하나 — 필터("테이머 카드 + 진화원 효과를 가진")의 대상.
const TAMER_WITH_SRC_EFFECT = Object.values(S.CARDS).find((c) => c.category === 'tamer' && (c.inheritedKo || '').trim())?.id;

T('bt18022-alone', 'BT18-022: 진화원으로 깔려 있는 채로 host가 소멸 — 진화원 효과를 가진 테이머 카드를 트래시로 넘어가기 전에 등장시킬 수 있다 (즉시형)', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const host = body('blue', 4);
    const vanilla = body('yellow', 3); // 진화원 효과 없는 디지몬 — 후보에서 제외돼야 함
    const s = put(st, 'p1', host, { src: ['BT18-022', vanilla, TAMER_WITH_SRC_EFFECT] });
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    ok('배틀 소멸은 대기 상태로 파킹된다 (interactive REPL)', r === null);
    const entry = firstPending(st);
    ok('대체 후보가 하나 생성됨 (BT18-022 자신/바닐라 디지몬은 제외, 테이머만)', !!entry && entry.cands.length === 1);
    ok('그 후보는 passive(=떠남을 막지 않음)', !!entry.cands[0].passive);
    S.resumeReplacement(st, entry, 0); // 후보 사용
    ok('host 스택은 실제로 배틀 에어리어를 벗어남 (트래시로)', st.players.p1.trash.includes(host));
    ok('테이머 카드는 트래시에 남지 않고 새 스택으로 등장함', !st.players.p1.trash.includes(TAMER_WITH_SRC_EFFECT));
    const played = st.players.p1.battle.find((x) => x.cardId === TAMER_WITH_SRC_EFFECT);
    ok('테이머 카드가 배틀 에어리어에 새로 등장 (진화원 없이)', !!played && played.sources.length === 0);
    ok('선택되지 않은 BT18-022/바닐라 디지몬은 나머지 진화원과 함께 트래시로 감', st.players.p1.trash.includes('BT18-022') && st.players.p1.trash.includes(vanilla));
  } finally { S.REPL.interactive = false; }
});

T('bt18022-decline', 'BT18-022: 즉시형 효과를 사용하지 않아도 host는 정상적으로 소멸하고, 테이머 카드도 함께 트래시로', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const host = body('blue', 4);
    const s = put(st, 'p1', host, { src: ['BT18-022', TAMER_WITH_SRC_EFFECT] });
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    S.resumeReplacement(st, entry, -1); // 사용하지 않음
    ok('host는 트래시로', st.players.p1.trash.includes(host));
    ok('테이머 카드도 그대로 트래시에 남음 (등장시키지 않음)', st.players.p1.trash.includes(TAMER_WITH_SRC_EFFECT));
    ok('새 스택이 등장하지 않음', !st.players.p1.battle.some((x) => x.cardId === TAMER_WITH_SRC_EFFECT));
  } finally { S.REPL.interactive = false; }
});

T('bt18022-own-effect-no-bonus', 'BT18-022: "자신의 효과 이외로"만 해당 — host가 자신의 효과로 벗어날 때는 후보 자체가 뜨지 않는다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const host = body('blue', 4);
    const s = put(st, 'p1', host, { src: ['BT18-022', TAMER_WITH_SRC_EFFECT] });
    S.deleteStack(st, 'p1', s.uid, 'trash', 'ownEffect');
    ok('자신의 효과로 소멸할 때는 파킹되지 않고 (후보 없음) 바로 처리됨', !(st.pendingReplacements || []).some((e) => e.uid === s.uid));
    ok('host는 트래시로', st.players.p1.trash.includes(host));
    ok('테이머 카드도 그대로 진화원과 함께 트래시로 (즉시형 보너스 미적용)', st.players.p1.trash.includes(TAMER_WITH_SRC_EFFECT));
  } finally { S.REPL.interactive = false; }
});

await runAll('qa-bt18-tamer-source-leave');
