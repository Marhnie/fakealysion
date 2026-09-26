// open-e (1): the interactive replacement prompt (S.REPL.interactive, main.js pumpReplacementPrompt -> S.resumeReplacement) parked by a lost security battle
// (BT8-095 Q4705, normal S-attack check OR the ≪관통≫ bonus check driven by main.js scriptedSecurityCheck) resumes the remaining ≪S 어택≫ checks.
// This mirrors the main.js loops (doSecurityStep / scriptedSecurityCheck) headlessly; the real-browser run is documented in docs/audit-2026-09-open-e.md.
// Run: node scripts/qa/qa-open-e-repl-resume.mjs < /dev/null
import { S, FILL, LOW, BIG, mk, put, setSec, drain, stackOf, T, eq, ok, runAll } from './lib-s1.mjs';

// the exact loop of main.js scriptedSecurityCheck (post-fix): waits for ctl.onLossResolved when settleSecurityLoss reports 'deferred'
async function pierceLoop(st, ctl, answer) {
  let guard = 0, waits = 0;
  for (;;) {
    while (!ctl.done && !st.winner && guard++ < 30) {
      if (ctl.awaiting) { await drain(st); S.battleSecurityCheck(ctl, ctl.awaiting.id); } else S.stepSecurityCheck(ctl);
      await drain(st);
    }
    if (st.winner) break;
    let r = S.settleSecurityLoss(ctl);
    if (r === 'deferred') {
      waits++;
      r = await new Promise((res) => { ctl.onLossResolved = res; const e = st.pendingReplacements[0]; ok('prompt parked', !!e); setTimeout(() => S.resumeReplacement(st, e, answer), 0); });
    }
    if (r !== 'survived') break;
  }
  return { waits };
}
const setup = () => {
  const st = mk(); S.REPL.interactive = true;
  const a = put(st, 'p1', 'BT8-012', { src: [BIG] }); a.keywords = { ...(a.keywords || {}), '시큐리티어택': 1 };
  setSec(st, 'p2', [BIG, LOW, LOW, LOW]);
  return { st, a };
};
T('use', 'accepting the parked 아머 퍼지 prompt: the second check happens and the attacker stays', async () => {
  try {
    const { st, a } = setup(); const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true;
    const { waits } = await pierceLoop(st, ctl, 0);
    eq('one prompt', waits, 1); eq('two cards checked', 4 - st.players.p2.security.length, 2); ok('attacker alive', !!stackOf(st, 'p1', a.uid));
    eq('source purged by 아머 퍼지', stackOf(st, 'p1', a.uid).sources.length, 0);
  } finally { S.REPL.interactive = false; }
});
T('decline', 'declining the prompt: the attacker is deleted and the remaining check does NOT happen', async () => {
  try {
    const { st, a } = setup(); const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true;
    const { waits } = await pierceLoop(st, ctl, -1);
    eq('one prompt', waits, 1); eq('one card checked', 4 - st.players.p2.security.length, 1); ok('attacker deleted', !stackOf(st, 'p1', a.uid));
  } finally { S.REPL.interactive = false; }
});
T('doSecurityStep', 'normal attack flow shape (doSecurityStep): onLossResolved gets survived / deleted', async () => {
  try {
    for (const [ans, want] of [[0, 'survived'], [-1, 'deleted']]) {
      const { st, a } = setup(); const ctl = S.beginSecurityCheck(st, 'p1', a.uid, 'p2'); ctl.deferBattle = true;
      while (!ctl.done) { if (ctl.awaiting) S.battleSecurityCheck(ctl, ctl.awaiting.id); else S.stepSecurityCheck(ctl); await drain(st); }
      eq('deferred', S.settleSecurityLoss(ctl), 'deferred');
      let got = null; ctl.onLossResolved = (r) => { got = r; }; S.resumeReplacement(st, st.pendingReplacements[0], ans);
      eq('outcome reported for ' + ans, got, want);
    }
  } finally { S.REPL.interactive = false; }
});
await runAll('qa-open-e-repl-resume');
