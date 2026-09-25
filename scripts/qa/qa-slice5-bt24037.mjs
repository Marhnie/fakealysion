// Slice-5 official Q&A: BT24-037 leave-time source play candidates (Q5618/5619): Lv4- AND (TS trait OR yellow/red); a Lv5 TS card or a blue/green non-TS card is not offered.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, nm, zoneNames } from './lib5.mjs';
const D = Object.values(S.CARDS).filter(c => c.category === 'digimon');
const ok1 = D.find(c => c.level === 4 && (c.types || []).includes('TS') && !(c.colors || []).some(x => ['yellow', 'red'].includes(x))).id;   // TS, other colour
const ok2 = D.find(c => c.level === 3 && (c.colors || []).length === 1 && c.colors[0] === 'red' && !(c.types || []).includes('TS') && !c.effectKo?.trim()).id; // red non-TS
const bad1 = D.find(c => c.level === 5 && (c.types || []).includes('TS')).id;
const bad2 = D.find(c => c.level === 4 && (c.colors || []).length === 1 && c.colors[0] === 'green' && !(c.types || []).includes('TS') && !c.effectKo?.trim()).id;
// NOTE (2026-09-25 즉시형 재분류): BT24-037's own leave bonus moved from a post-hoc state.pending trigger to the interrupt-based
// hookPreventLeave/preventLeaveOptions REPL mechanism (docs/effect-classification-rules.md), matching BT23-032. That mechanism only
// exposes its candidate list through S.REPL.interactive + state.pendingReplacements (see scripts/qa/qa-immediate-leave-bonus.mjs) —
// a plain non-interactive S.deleteStack() call now auto-applies the single best candidate synchronously with no ctx.choose prompt at
// all, so the old 'pickFromZoneIndex' probe can no longer observe the offered set. Re-expressed via the REPL path below; the guarantee
// under test (Q5618/5619: exactly the Lv.4- + (TS or yellow/red) sources are offered) is unchanged.
await scenario('5618/5619', 'BT24-037 leaves by an opponent effect: offered sources = {TS Lv4-, yellow/red Lv4-}', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: 'BT24-037', src: [ok1, ok2, bad1, bad2] }] }, p2: { battle: [F3[0]] }, active: 'p2' });
  const s = stk(st, 'p1', 'BT24-037');
  S.REPL.interactive = true;
  try {
    st._fxSrc = { player: 'p2', category: 'digimon', cardId: F3[0] };
    const r = S.deleteStack(st, 'p1', s.uid, 'trash', 'effect');
    st._fxSrc = null;
    chk(r === null, 'delete parked for a replacement decision (interactive REPL)');
    const entry = (st.pendingReplacements || [])[0];
    const offered = entry ? entry.cands.length : null;
    chk(offered === 2, 'offered ' + offered + ' candidates (want 2)');
    if (entry) S.resumeReplacement(st, entry, 0);
    chk(st.players.p1.battle.length === 1 && [ok1, ok2].includes(st.players.p1.battle[0].cardId), 'one candidate played: ' + zoneNames(st, 'p1', 'battle'));
  } finally { S.REPL.interactive = false; }
});
report();
