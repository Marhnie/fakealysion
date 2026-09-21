// Slice-5 official Q&A batch 1: effect-resolution details on real cards.
import { S, E, newBoard, addStack, stk, mkChoose, drain, fire, evo, scenario, report, F3, fillerLv, pend, nm, idByName, runOn, zoneNames, dp } from './lib5.mjs';
const lv3 = fillerLv(3), lv5 = fillerLv(5), lv6 = fillerLv(6);
const has = (st, p, id) => !!stk(st, p, id);

// Q5343: BT23-071 evolve trigger MUST delete the highest-Lv opp digimon when one exists (cannot skip to get the +5000 branch)
await scenario(5343, 'BT23-071: highest-Lv opp digimon is deleted and no +5000 bonus', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT23-071'] }, p2: { battle: [lv3[0], lv5[0]] } });
  const base = dp(st, 'p1', stk(st, 'p1', 'BT23-071'));
  await runOn(st, 'p1', 'BT23-071', 'digivolve');
  chk(!has(st, 'p2', lv5[0]) && has(st, 'p2', lv3[0]), 'Lv5 should be deleted, Lv3 stay');
  chk(dp(st, 'p1', stk(st, 'p1', 'BT23-071')) === base, 'no DP bonus when something was deleted');
});
// Q5344: opp digimon that cannot be deleted by effects is the highest -> "if not deleted" branch applies (+5000)
await scenario(5344, 'BT23-071: highest-Lv opp digimon immune -> +5000 branch', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT23-071'] }, p2: { battle: [lv5[0]] } });
  const t = stk(st, 'p2', lv5[0]); S.grantShield(st, 'p2', t.uid, { kinds: ['all'] });
  const base = dp(st, 'p1', stk(st, 'p1', 'BT23-071'));
  await runOn(st, 'p1', 'BT23-071', 'digivolve');
  chk(has(st, 'p2', lv5[0]), 'immune digimon stays');
  chk(dp(st, 'p1', stk(st, 'p1', 'BT23-071')) === base + 5000, `DP bonus expected +5000, got ${dp(st, 'p1', stk(st, 'p1', 'BT23-071')) - base}`);
});
// Q5317: DP reduced to 0 by the effect does not delete before the effect finishes; rule check afterwards deletes
await scenario(5317, 'BT23-050: DP0 digimon survives until the effect resolved fully, then is deleted', async (chk) => {
  const weak = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp && c.dp <= 2000 && c.level === 3 && !c.effectKo).id;
  const st = newBoard({ p1: { battle: ['BT23-050', lv3[1]], hand: ['BT21-065'] }, p2: { battle: [weak] } });
  const seen = [];
  await runOn(st, 'p1', 'BT23-050', 'digivolve', { answer: (k, o, s) => { seen.push([k, !!stk(s, 'p2', weak)]); return undefined; } });
  chk(!has(st, 'p2', weak), 'after the effect the DP<=0 digimon must be gone');
  chk(seen.length > 0 && seen.every(x => x[1]), 'DP0 digimon must still be on board while the effect still asks questions: ' + JSON.stringify(seen));
});
// Q5395: EX10-049: "if opp trash <=10, trash 3 from both decks" is a condition; when false the "then" (delete Lv3-) still happens
await scenario(5395, 'EX10-049 evolve: opp trash > 10 -> no deck trashing but Lv3- opp digimon still deleted', async (chk) => {
  const st = newBoard({ p1: { battle: ['EX10-049'], deck: F3.slice(0, 6) }, p2: { battle: [lv3[0]], deck: F3.slice(0, 6), trash: F3.slice(0, 12) } });
  const d1 = st.players.p1.deck.length, d2 = st.players.p2.deck.length;
  await runOn(st, 'p1', 'EX10-049', 'digivolve');
  chk(st.players.p1.deck.length === d1 && st.players.p2.deck.length === d2, `decks untouched ${d1}/${d2} -> ${st.players.p1.deck.length}/${st.players.p2.deck.length}`);
  chk(!has(st, 'p2', lv3[0]), 'Lv3 opp digimon should still be deleted');
});
report();
