// 즉시형(15-8-5) "벗어날 때" 재분류 회귀 테스트, 2회차 — EX6-023/031/054/056과 EX7-014 (docs/effect-classification-rules.md 후속 조치).
// 원래 onLeave+state.pending(유발형)으로 구현되어 있던 카드들을 hookPreventLeave의 forcedOnLeave(강제)/preventLeaveOptions(선택, passive)
// 경로로 옮겨, 스택이 실제로 트래시로 넘어가기 *직전*에 아직 살아있는 진화원/트래시/패를 참조하도록 고쳤다.
// Run: node scripts/qa/qa-immediate-leave-ex6-ex7.mjs
import { S, FILL, mk, put, T, eq, ok, runAll, body } from './lib-s1.mjs';

const byName = (n) => Object.keys(S.CARDS).find((id) => S.CARDS[id].nameKo === n);
const firstPending = (st) => (st.pendingReplacements || [])[0] || null;

// ---- EX6-023 (forced, 즉시형): "이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 옐로인 디지몬 카드 1장을 패로 되돌린다."
// forcedOnLeave는 REPL.interactive 여부와 무관하게 hookPreventLeave 안에서 항상 동기적으로 실행된다 (state.js).
T('ex6023-forced-return', 'EX6-023: 벗어날 때(강제) — 소멸 직전에 진화원의 옐로 디지몬 카드를 패로 돌려받는다', async () => {
  const st = mk();
  const yellow = body('yellow', 3);
  const s = put(st, 'p1', 'EX6-023', { src: [yellow] });
  S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
  ok('EX6-023 자신은 소멸(트래시)', st.players.p1.trash.includes('EX6-023'));
  ok('진화원의 옐로 카드는 트래시로 가지 않고 패로 돌아옴', st.players.p1.hand.includes(yellow));
  ok('트래시에는 남아있지 않음(패로 이동했으므로)', !st.players.p1.trash.includes(yellow));
});
T('ex6023-no-yellow-source-noop', 'EX6-023: 옐로 진화원이 없으면 그냥 정상적으로 소멸한다(강제 효과라도 대상이 없으면 아무 일도 없음)', async () => {
  const st = mk();
  const blue = body('blue', 3);
  const s = put(st, 'p1', 'EX6-023', { src: [blue] });
  S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
  ok('EX6-023 소멸', st.players.p1.trash.includes('EX6-023'));
  ok('블루 진화원은 그대로 트래시로', st.players.p1.trash.includes(blue));
  ok('패는 비어있음', st.players.p1.hand.length === 0);
});

// ---- EX6-031 (optional/passive, 즉시형): "…소멸할 때 또는 패/덱으로 되돌아갈 때, 진화원의 「삼장몬」 1장과 「손오공몬」/「사고몬」/「초핫카이몬」
// 1장을 코스트를 지불하지 않고 등장시킬 수 있다." — 둘을 묶은 단일 후보(passive)로 제시된다.
T('ex6031-combo-use', 'EX6-031: 즉시형 콤보 보너스 사용 — 소멸 직전에 삼장몬+손오공몬류가 함께 코스트 없이 등장', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const sanzang = byName('삼장몬'), son = byName('손오공몬');
    const s = put(st, 'p1', 'EX6-031', { src: [sanzang, son] });
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    eq('배틀 소멸은 대기 상태로 파킹됨(interactive REPL)', r, null);
    const entry = firstPending(st);
    ok('후보 1개(삼장몬+손오공몬류 조합 전체가 하나의 후보)', !!entry && entry.cands.length === 1);
    ok('그 후보는 passive(=떠남을 막지 않음)', !!entry.cands[0].passive);
    S.resumeReplacement(st, entry, 0);
    ok('EX6-031 자신은 소멸함', st.players.p1.trash.includes('EX6-031'));
    ok('삼장몬이 코스트 없이 새로 등장', st.players.p1.battle.some((x) => x.cardId === sanzang && x.sources.length === 0));
    ok('손오공몬도 코스트 없이 새로 등장', st.players.p1.battle.some((x) => x.cardId === son && x.sources.length === 0));
  } finally { S.REPL.interactive = false; }
});
T('ex6031-decline', 'EX6-031: 즉시형 콤보 보너스를 거절하면 진화원이 그대로 트래시로 넘어간다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const sanzang = byName('삼장몬'), son = byName('손오공몬');
    const s = put(st, 'p1', 'EX6-031', { src: [sanzang, son] });
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = firstPending(st);
    S.resumeReplacement(st, entry, -1);
    ok('EX6-031과 진화원 전부 트래시로', ['EX6-031', sanzang, son].every((id) => st.players.p1.trash.includes(id)));
    ok('새 스택이 등장하지 않음', !st.players.p1.battle.some((x) => x.cardId === sanzang || x.cardId === son));
  } finally { S.REPL.interactive = false; }
});

// ---- EX6-054 (optional/passive, 즉시형, 신규 구현): "…벗어날 때, 자신의 트래시 또는 진화원에서 「루체몬」 1장을 덱 아래로 되돌리는 것으로,
// 자신의 트래시에서 「루체몬: 사탄 모드」 또는 Lv.6+「7대마왕」 카드 1장을 코스트 없이 등장시킬 수 있다." (이전에는 구현이 아예 없었음)
T('ex6054-cost-and-benefit', 'EX6-054: 진화원의 「루체몬」을 덱 아래로 되돌리고 트래시의 7대마왕 Lv.6 카드를 코스트 없이 등장', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const lucemon = byName('루체몬');
    const sinDigimon = byName('리리스몬'); // Lv.6 + 「7대마왕」
    const s = put(st, 'p1', 'EX6-054', { src: [lucemon] });
    st.players.p1.trash = [sinDigimon];
    const deckLenBefore = st.players.p1.deck.length;
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    eq('배틀 소멸은 대기 상태로 파킹됨(interactive REPL)', r, null);
    const entry = firstPending(st);
    ok('후보가 하나 이상 생성됨 (비용 카드 × 등장 카드 조합)', !!entry && entry.cands.length >= 1);
    ok('모든 후보는 passive', entry.cands.every((c) => c.passive));
    S.resumeReplacement(st, entry, 0);
    ok('EX6-054 자신은 소멸함', st.players.p1.trash.includes('EX6-054'));
    ok('「루체몬」은 진화원에서 사라지고 덱 아래로', st.players.p1.deck[st.players.p1.deck.length - 1] === lucemon);
    eq('덱 장수 1장 늘어남', st.players.p1.deck.length, deckLenBefore + 1);
    ok('7대마왕 Lv.6 카드가 트래시에서 코스트 없이 새로 등장', st.players.p1.battle.some((x) => x.cardId === sinDigimon && x.sources.length === 0));
    ok('그 카드는 트래시에 남아있지 않음', !st.players.p1.trash.includes(sinDigimon));
  } finally { S.REPL.interactive = false; }
});
T('ex6054-no-benefit-no-candidate', 'EX6-054: 트래시에 등장시킬 대상(사탄 모드/7대마왕 Lv.6)이 없으면 후보 자체가 생기지 않는다', async () => {
  const st = mk();
  const lucemon = byName('루체몬');
  const s = put(st, 'p1', 'EX6-054', { src: [lucemon] });
  st.players.p1.trash = [];
  const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
  ok('후보 없이 바로 정상 소멸(비활성 즉시형)', r !== null);
  ok('진화원의 「루체몬」도 그대로 트래시로 (비용을 치를 이유가 없음)', st.players.p1.trash.includes(lucemon));
});

// ---- EX6-056 (forced, 즉시형): "이 디지몬이 배틀 이외로 배틀 에어리어를 벗어날 때, 자신의 트래시에서 특징 「7대마왕」 카드 1장을 육성
// 에어리어의 「대죄의 문」 진화원 아래에 놓는다." — forcedOnLeave, "배틀 이외로"라 배틀 소멸(cause 'battle')은 제외.
T('ex6056-forced-gate', 'EX6-056: 배틀 이외로 벗어날 때(강제) — 소멸 직전에 트래시의 7대마왕 카드를 「대죄의 문」 진화원 아래에 놓는다', async () => {
  const st = mk();
  const gateId = byName('대죄의 문');
  const gate = S._s4.makeStack(gateId, 1);
  st.players.p1.raising = gate;
  const sinId = byName('리리스몬'); // 특징 「7대마왕」, EX6-056 자신과 다른 카드
  st.players.p1.trash = [sinId];
  const s = put(st, 'p1', 'EX6-056', {});
  S.deleteStack(st, 'p1', s.uid, 'trash', 'effect'); // 배틀이 아닌 사유
  ok('EX6-056 소멸', st.players.p1.trash.includes('EX6-056'));
  ok('7대마왕 카드가 트래시에서 사라짐', !st.players.p1.trash.includes(sinId));
  eq('「대죄의 문」 진화원 맨 아래(배열 인덱스 0)에 추가됨', gate.sources[0], sinId);
});
T('ex6056-battle-cause-skips', 'EX6-056: "배틀 이외로"이므로 배틀로 소멸할 때는 발동하지 않는다', async () => {
  const st = mk();
  const gateId = byName('대죄의 문');
  const gate = S._s4.makeStack(gateId, 1);
  st.players.p1.raising = gate;
  const sinId = byName('리리스몬');
  st.players.p1.trash = [sinId];
  const s = put(st, 'p1', 'EX6-056', {});
  S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
  ok('배틀 소멸이라 7대마왕 카드는 그대로 트래시에 남음', st.players.p1.trash.includes(sinId));
  eq('「대죄의 문」 진화원 아래에 추가되지 않음', gate.sources.length, 0);
});

// ---- EX7-014 (optional/passive, 즉시형, [턴에 1회]): "이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 자신의 패에서 특징
// 「기룡형」/「천룡형」을 가진 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다."
T('ex7014-optional-hand-play', 'EX7-014: 자신의 효과 이외로 벗어날 때(선택형) — 패의 기룡형/천룡형 디지몬 카드를 코스트 없이 등장시킬 수 있다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const cand = Object.keys(S.CARDS).find((id) => S.CARDS[id].category === 'digimon' && (S.CARDS[id].types || []).some((t) => ['기룡형', '천룡형'].includes(t)));
    st.players.p1.hand = [cand];
    const s = put(st, 'p1', 'EX7-014', {});
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'effect');
    eq('파킹됨(interactive REPL)', r, null);
    const entry = firstPending(st);
    ok('후보 1개(passive)', !!entry && entry.cands.length === 1 && entry.cands[0].passive);
    S.resumeReplacement(st, entry, 0);
    ok('패의 카드가 코스트 없이 등장', st.players.p1.battle.some((x) => x.cardId === cand));
    ok('패에서는 사라짐', !st.players.p1.hand.includes(cand));
  } finally { S.REPL.interactive = false; }
});
T('ex7014-ownEffect-excluded', 'EX7-014: "자신의 효과 이외로"이므로 자신의 효과로 벗어날 때는 후보가 뜨지 않는다', async () => {
  S.REPL.interactive = true;
  try {
    const st = mk();
    const cand = Object.keys(S.CARDS).find((id) => S.CARDS[id].category === 'digimon' && (S.CARDS[id].types || []).some((t) => ['기룡형', '천룡형'].includes(t)));
    st.players.p1.hand = [cand];
    const s = put(st, 'p1', 'EX7-014', {});
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'ownEffect');
    ok('자신의 효과로 인한 소멸은 후보 없이 바로 처리됨', r !== null);
    ok('패의 카드는 그대로 남음(즉시형 후보가 아예 안 뜸)', st.players.p1.hand.includes(cand));
  } finally { S.REPL.interactive = false; }
});

await runAll('qa-immediate-leave-ex6-ex7');
