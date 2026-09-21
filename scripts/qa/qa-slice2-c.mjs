// Official-Q&A scenarios, slice2 part C (BT9 tamers / options / big digimon). Q ids cited; outcomes named in our own words.
import { runScenarios, FILL, S, C, fillOf } from './lib2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', MEGA = 'ST1-09', UND = 'BT2-075', KUGA = 'ST4-07', JAZA = 'ST5-07';
// Q1887: BT9-084 turn-start: BOTH conditions (mine <=3 security, opp <=3 security) true -> memory +2
T(1887, 'BT9-084', 'both halves give +2', async (W) => { W.put('p1', 'BT9-084'); W.sec('p1', FILL.slice(0, 3)); W.sec('p2', FILL.slice(0, 2)); W.m0 = W.mem(); await W.newTurn('p1'); }, (W) => [['+2 memory', W.mem() === W.m0 + 2]]);
// Q1888: BT9-085 main-phase start: both hands >=8 -> +2
T(1888, 'BT9-085', 'both halves give +2', async (W) => { W.put('p1', 'BT9-085'); W.hand('p1', FILL.slice(0, 8)); W.hand('p2', FILL.slice(0, 8)); W.m0 = W.mem(); await W.newTurn('p1'); }, (W) => [['+2 memory', W.mem() === W.m0 + 2]]);
// Q1890: BT9-087 main-phase start: Lv5+ digimon on both sides -> +2
T(1890, 'BT9-087', 'both halves give +2', async (W) => { W.put('p1', 'BT9-087'); W.put('p1', MEGA); W.put('p2', MEGA); W.m0 = W.mem(); await W.newTurn('p1'); }, (W) => [['+2 memory', W.mem() === W.m0 + 2]]);
// Q1891: BT9-088 turn-start: rested digimon on both sides -> +2
T(1891, 'BT9-088', 'both halves give +2', async (W) => { W.put('p1', 'BT9-088'); W.put('p1', RED3, { suspended: true }); W.put('p2', RED3, { suspended: true }); W.m0 = W.mem(); await W.newTurn('p1'); }, (W) => [['+2 memory', W.mem() === W.m0 + 2]]);
// Q1862/1863: BT9-071 with only one undead/beast card revealed: it goes to hand, nothing is discarded
T(1863, 'BT9-071', 'single qualifying card goes to hand, none discarded', async (W) => { W.deck('p1', [UND, RED3, RED4, ...FILL.slice(26, 40)]); W.t0 = W.pl('p1').trash.length; await W.play('p1', 'BT9-071'); },
  (W) => [['card added to hand', W.pl('p1').hand.includes(UND)], ['nothing trashed', W.pl('p1').trash.length === W.t0]]);
// Q1873: BT9-080 with security <=1 the trash purple/yellow DP<=6000 play is still available
T(1873, 'BT9-080', 'security<=1: purple DP<=6000 from trash may still be played', async (W) => { W.sec('p1', [FILL[20]]); W.trash('p1', ['ST6-05']); await W.play('p1', 'BT9-080'); },
  (W) => [['ST6-05 entered play', W.count('p1', 'ST6-05') === 1]]);
// Q1877/1878: BT9-082 deletion effect: only this card returns (sources stay in trash), as a fresh digimon
T(1877, 'BT9-082', 'returns alone from the trash', async (W) => {
  W.s = W.put('p1', ['BT9-082', RED4, RED3]); W.sec('p1', FILL.slice(20, 25)); W.st.activePlayer = 'p2'; W.st.memory = -10; await W.useOption('p2', 'BT8-105');
}, (W) => { const n = W.pl('p1').battle.filter(s => s.cardId === 'BT9-082'); return [['one BT9-082 on field', n.length === 1], ['with no sources', n.length === 1 && n[0].sources.length === 0], ['old sources in trash', W.pl('p1').trash.includes(RED4) && W.pl('p1').trash.includes(RED3)]]; }, { allowErrors: true });
// Q1882: BT9-083 evolve-time: each Ultimate source deletes one opp digimon, but only ONE batch of 10 trash cards goes back
T(1882, 'BT9-083', 'one batch of 10, not per source', async (W) => {
  const ult = fillOf(c => (c.types || []).includes('궁극체'))[0]; const s = W.put('p1', [RED4, ult, ult]); for (let i = 0; i < 3; i++) W.put('p2', FILL[i]); W.trash('p2', FILL.slice(0, 30)); W.dk = W.pl('p2').deck.length; await W.evolve('p1', s.uid, 'BT9-083', 0);
}, (W) => [['2 opp digimon deleted', W.pl('p2').battle.length === 1], ['opp deck +10 exactly', W.pl('p2').deck.length === W.dk + 10]], { allowErrors: true });
// Q1897: DP-delete cap +1000 from an inherited effect lifts a "total DP 10000 or less" option to 11000
T(1897, 'BT9-094', 'cap +1000 -> total 11000', async (W) => {
  W.put('p1', [RED3, 'BT9-011']); W.a = W.put('p2', KUGA); W.b = W.put('p2', RED4); W.picks.pickStack = (o) => o.uids[0]; await W.useOption('p1', 'BT9-094');
}, (W) => [['both deleted (6000+5000)', !W.alive('p2', W.a) && !W.alive('p2', W.b)]], { allowErrors: true });
// Q1906: BT9-101 usable with only a rested digimon (no tamer) -> handled as far as possible
T(1906, 'BT9-101', 'usable with only rested digimon', async (W) => { W.put('p1', RED3); W.d = W.put('p2', RED4, { suspended: true }); await W.useOption('p1', 'BT9-101'); },
  (W) => [['option was used', W.pl('p1').trash.includes('BT9-101')], ['rested digimon returned to deck bottom', !W.alive('p2', W.d)]], { allowErrors: true });
// ---- BT10 block ----
const RB2 = fillOf(c => c.colors.length === 2 && c.colors.includes('red') && c.colors.includes('black'))[0];
// Q1929: BT10-001 source: "a non-red card among sources" - a red+black card counts as red-containing, so no +1000
T(1929, 'BT10-001', 'red-including 2-colour source does not count as non-red', async (W) => { W.s = W.put('p1', [RED4, 'BT10-001', RB2]); }, (W) => [['no DP bonus', W.dp('p1', W.s) === C(RED4).dp]]);
T(1929, 'BT10-001', 'control: pure blue source gives +1000', async (W) => { W.s = W.put('p1', [RED4, 'BT10-001', 'ST2-05']); }, (W) => [['+1000 DP', W.dp('p1', W.s) === C(RED4).dp + 1000]]);
// Q1948: BT10-023 evolve-time checks hand AFTER the evolution draw: 5 cards -> 6 after draw -> still <=6 -> 2 more
T(1948, 'BT10-023', 'draws 2 more when hand is 6 after the bonus draw', async (W) => { W.hand('p1', FILL.slice(0, 5)); const s = W.put('p1', RED4); await W.evolve('p1', s.uid, 'BT10-023', 0); }, (W) => [['hand 5 -> 8 (1 bonus + 2)', W.pl('p1').hand.length === 8]]);
T(1948, 'BT10-023', 'no extra draw when the bonus draw makes it 7', async (W) => { W.hand('p1', FILL.slice(0, 6)); const s = W.put('p1', RED4); await W.evolve('p1', s.uid, 'BT10-023', 0); }, (W) => [['hand 6 -> 7 (bonus only)', W.pl('p1').hand.length === 7]]);
// Q1951: BT10-027 attack-time: when sources hold a Lv3 AND a Lv4 digimon, both must be played (no picking just one)
T(1951, 'BT10-027', 'both Lv3 and Lv4 sources played', async (W) => { W.s = W.put('p1', ['BT10-027', RED3, RED4]); W.put('p2', RED3); await W.fire('p1', W.s, 'attack'); }, (W) => [['Lv3 played', W.count('p1', RED3) === 1], ['Lv4 played', W.count('p1', RED4) === 1]], { allowErrors: true });
// Q1959: BT10-040 attack-time with exactly 3 security: both the DP-5000 half and memory +2 apply
T(1959, 'BT10-040', 'security 3 -> both halves', async (W) => { W.sec('p1', FILL.slice(20, 23)); W.s = W.put('p1', 'BT10-040'); W.d = W.put('p2', 'ST5-09'); W.m0 = W.mem(); await W.fire('p1', W.s, 'attack'); }, (W) => [['opp DP -5000', W.dp('p2', W.d) === C('ST5-09').dp - 5000], ['memory +2', W.mem() === W.m0 + 2]], { allowErrors: true });
// Q2138: BT11-111 "would leave the battle area" replacement is NOT an answer to a de-evolve (the stack stays in the area): no Bemon go to the deck bottom
T(2138, 'BT11-111', 'retreat does not trigger the leave replacement', async (W) => {
  W.s = W.put('p1', ['BT11-111', 'BT11-061', 'BT11-061', 'BT11-061', 'BT11-061', 'ST1-05']); W.dk = W.pl('p1').deck.length; W.n0 = W.s.sources.length; S.retreat(W.st, 'p1', W.s.uid, 1); await W.drain();
}, (W) => [['deck unchanged', W.pl('p1').deck.length === W.dk], ['only the top card peeled', W.s.sources.length === W.n0 - 1]], { allowErrors: true });
await runScenarios(L, 'c');
