// Official-Q&A scenarios, slice2 part B (BT9 cards). Q ids cited per scenario; outcomes named in our own words.
import { runScenarios, FILL, S, C, fillOf } from './lib2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', GREY = 'ST1-07', MEGA = 'ST1-09', BLK5 = 'ST5-09';
// Q1808/1809: BT9-015 "source named メタルグレイモン or X抗体": a card with the X-antibody TRAIT but another name does not qualify
T(1809, 'BT9-015', 'trait-only X-antibody source: no DP bonus', async (W) => {
  W.s = W.put('p1', [RED4, 'BT9-008']); await W.evolve('p1', W.s.uid, 'BT9-015', 0);
}, (W) => [['no +3000 DP', W.dp('p1', W.s) === C('BT9-015').dp]]);
T(1809, 'BT9-015', 'control: source with the printed name gives +3000', async (W) => {
  W.s = W.put('p1', [RED4, MEGA]); await W.evolve('p1', W.s.uid, 'BT9-015', 0);
}, (W) => [['+3000 DP', W.dp('p1', W.s) === C('BT9-015').dp + 3000]]);
// Q1812: BT9-017 evolve-time: with no opposing digimon nothing can be deleted -> this digimon becomes active
T(1812, 'BT9-017', 'no target -> becomes active', async (W) => {
  W.s = W.put('p1', [RED4], { suspended: true }); await W.evolve('p1', W.s.uid, 'BT9-017', 0);
}, (W) => [['active', !W.s.suspended]]);
// Q1813: with a valid target the deletion is mandatory, so the activation clause does not apply
T(1813, 'BT9-017', 'valid target is deleted, no reactivation', async (W) => {
  W.s = W.put('p1', [RED4], { suspended: true }); W.d = W.put('p2', RED3); await W.evolve('p1', W.s.uid, 'BT9-017', 0);
}, (W) => [['target deleted', !W.alive('p2', W.d)], ['stays rested', W.s.suspended]]);
// Q1816/1817: BT9-018 evolve-time: +1 memory per opposing tamer even with fewer digimon
T(1817, 'BT9-018', 'memory +1 per opp tamer (3 tamers, 1 digimon)', async (W) => {
  W.s = W.put('p1', [RED4]); W.put('p2', 'P-241'); W.put('p2', 'P-242'); W.put('p2', 'BT8-085'); W.d = W.put('p2', RED3); W.m0 = W.mem(); await W.evolve('p1', W.s.uid, 'BT9-018', 0);
}, (W) => [['memory +3', W.mem() === W.m0 + 3], ['the digimon rested', W.d.suspended]]);
// Q1803: BT9-012 source effect: the two discarded sources need only share a Lv among themselves (not the top card's Lv)
T(1803, 'BT9-012', 'two same-level sources save it from an effect deletion', async (W) => {
  W.s = W.put('p1', [GREY, 'BT9-012', MEGA, BLK5, RED3]); W.st.activePlayer = 'p2'; W.st.memory = -10; W.d0 = W.s.sources.length; await W.useOption('p2', 'BT8-105');
}, (W) => [['still on the field', W.alive('p1', W.s)], ['two Lv5 sources trashed', W.s.sources.length === W.d0 - 2]], { allowErrors: true });
// Q1847: BT9-050 – the source to be played must be NAMED レオモン; 「レオモンX抗体」 is a different name
T(1847, 'BT9-050', 'X-antibody-named source cannot be played', async (W) => {
  W.s = W.put('p1', ['BT9-050', 'BT9-050']); W.a = W.put('p2', 'ST5-09'); W.st.activePlayer = 'p2'; await W.attack('p2', W.a.uid, W.s.uid);
}, (W) => [['no new BT9-050 entered play', W.count('p1', 'BT9-050') === 0]], { allowErrors: true });
T(1847, 'BT9-050', 'control: plain named source can be played', async (W) => {
  W.s = W.put('p1', ['BT9-050', 'BT1-035']); W.a = W.put('p2', 'ST5-09'); W.st.activePlayer = 'p2'; await W.attack('p2', W.a.uid, W.s.uid);
}, (W) => [['the plain Leomon entered play', W.count('p1', 'BT1-035') === 1]], { allowErrors: true });
// Q1854: BT9-067 – any one of the three named cards in trash is enough; each found card goes under and gives +1 memory
T(1854, 'BT9-067', 'partial set still works', async (W) => {
  W.trash('p1', ['BT9-042']); W.s = W.put('p1', [RED4]); W.m0 = W.mem(); await W.evolve('p1', W.s.uid, 'BT9-067', 0);
}, (W) => [['the found card is now a source', W.s.sources.includes('BT9-042')], ['memory +1', W.mem() === W.m0 + 1]]);
await runScenarios(L, 'b');
