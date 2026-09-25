// Regression for the playtester bug: the replacement-effect choice prompt (≪방벽≫/회피/아머퍼지/… "…하는 것으로
// 소멸/벗어나지 않는다" survive abilities) must never leak an unchecked security card's identity before the player
// has decided whether to use the replacement (rule 3-1-2: security is secret even to its own owner). The UI
// (pumpReplacementPrompt in src/main.js) builds its preview text from state.pendingReplacements[*].lines /
// .cands[*].lines, which come straight from the dry-run probe's log lines (state.js replGate/replAttempt). This
// script is headless (state-layer only) and checks those log lines directly, without touching the UI.
// Run: node scripts/qa/qa-security-replacement-secrecy.mjs
import { S, mk, put, setSec, T, ok, runAll } from './lib-s1.mjs';

// two distinct real cards to stand in for "the" security card, so a leak is unambiguous either way
const secVanilla = Object.values(S.CARDS).filter((c) => c.category === 'digimon' && c.dp && c.nameKo).slice(0, 2);
const [SEC_A, SEC_B] = secVanilla.map((c) => c.id);
const FILLER = Object.values(S.CARDS).find((c) => c.category === 'digimon' && c.dp && !c.effectKo && !c.inheritedKo && c.id !== SEC_A && c.id !== SEC_B).id;

const linesOf = (entry) => JSON.stringify(entry.cands ? entry.cands.map((c) => c.lines) : entry.lines);

T('barrier-single', '단일 후보(《방벽》)의 대체 효과 선택 미리보기는 시큐리티 카드 이름을 노출하지 않는다', async () => {
  const st = mk();
  const s = put(st, 'p1', FILLER, {});
  s.keywords = { 방벽: 1 }; // printed/granted 《방벽》: 시큐리티 1장 파기하여 배틀로 인한 소멸을 대신함
  setSec(st, 'p1', [SEC_A]);
  S.REPL.interactive = true;
  try {
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    ok('대체 효과가 있어 실제 소멸은 보류되어야 함 (deleteStack -> null)', r === null);
    const pend = st.pendingReplacements;
    ok('대체 선택이 대기 중이어야 함', !!(pend && pend.length === 1));
    const entry = pend[0];
    ok('후보가 정확히 1개', entry.cands.length === 1);
    const text = linesOf(entry);
    ok('안내 문구 자체는 만들어져야 함 (파기 언급)', /파기/.test(text));
    ok('시큐리티 카드 이름이 노출되지 않음 (SEC_A)', !text.includes(S.card(SEC_A).nameKo));
  } finally { S.REPL.interactive = false; delete st.pendingReplacements; }
});

T('barrier-multi', '다중 후보(《회피》+《방벽》 동시 발동 가능)의 대체 효과 선택 미리보기도 시큐리티 카드 이름을 노출하지 않는다', async () => {
  const st = mk();
  const s = put(st, 'p1', FILLER, {});
  s.keywords = { 회피: 1, 방벽: 1 }; // 둘 다 "배틀로 인한 소멸"에 쓸 수 있는 후보라 18-2 선택지가 2개 이상 생겨야 함
  setSec(st, 'p1', [SEC_B]);
  S.REPL.interactive = true;
  try {
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    ok('대체 효과가 있어 실제 소멸은 보류되어야 함 (deleteStack -> null)', r === null);
    const pend = st.pendingReplacements;
    ok('대체 선택이 대기 중이어야 함', !!(pend && pend.length === 1));
    const entry = pend[0];
    ok('후보가 2개 이상 (회피 + 방벽)', entry.cands.length >= 2);
    const text = linesOf(entry);
    ok('방벽 후보의 안내 문구는 만들어져야 함 (파기 언급)', /파기/.test(text));
    ok('시큐리티 카드 이름이 노출되지 않음 (SEC_B)', !text.includes(S.card(SEC_B).nameKo));
  } finally { S.REPL.interactive = false; delete st.pendingReplacements; }
});

T('barrier-committed-reveals', '(대조군) 실제로 선택을 확정해 방벽을 사용하면 그 시점부터는 트래시로 이동한 카드 이름이 로그에 정상적으로 남는다', async () => {
  const st = mk();
  const s = put(st, 'p1', FILLER, {});
  s.keywords = { 방벽: 1 };
  setSec(st, 'p1', [SEC_A]);
  S.REPL.interactive = true;
  try {
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle');
    const entry = st.pendingReplacements[0];
    S.resumeReplacement(st, entry, 0); // player agrees to use the (only) candidate — 방벽
    ok('시큐리티 카드가 실제로 트래시로 이동함(더 이상 비공개가 아님)', st.players.p1.trash.includes(SEC_A));
    ok('커밋된 실제 로그에는 이제 이름이 남아도 된다', st.log.some((l) => l.msg.includes(S.card(SEC_A).nameKo)));
  } finally { S.REPL.interactive = false; }
});

await runAll('qa-security-replacement-secrecy');
