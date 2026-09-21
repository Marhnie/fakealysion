// Official-Q&A scenarios, slice2 part A (BT8 / BT9 cards). Each scenario cites the Q id; expected outcomes are named in our own words.
import { runScenarios, FILL, S, E, C, fillOf } from './lib2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra });
const RED3 = 'ST1-02', RED3b = 'ST1-03', RED4 = 'ST1-05', BLUE4 = 'ST2-05', YEL4 = 'ST3-06', RB = fillOf(c => c.colors.length === 2 && c.colors.includes('red') && c.colors.includes('black'))[0], PUR3 = 'ST6-03', TAMER = 'P-242';
const evolveOn = async (W, top, sources, evoId) => { const s = W.put('p1', [top, ...sources]); await W.evolve('p1', s.uid, evoId, 0); return s; };

// Q1751: red+black sources -> both an opponent digimon and an opponent tamer can be deleted by the one evolve-time effect
T(1751, 'BT8-070', 'digimon and tamer both deleted', async (W) => {
  const s = W.put('p1', [RED4, RED3, 'ST5-02']); W.d = W.put('p2', RED3); W.t = W.put('p2', 'BT8-085'); await W.evolve('p1', s.uid, 'BT8-070', 0);
}, (W) => [['opp digimon deleted', !W.alive('p2', W.d)], ['opp tamer deleted', !W.alive('p2', W.t)]]);
// Q1752: the 6 cost budget is shared by digimon+tamer (not 6 each): a 4-cost digimon and a 4-cost tamer cannot both be chosen
T(1752, 'BT8-070', 'shared cost budget', async (W) => {
  const s = W.put('p1', [RED4, RED3, 'ST5-02']); W.d = W.put('p2', RED4); W.t = W.put('p2', TAMER); await W.evolve('p1', s.uid, 'BT8-070', 0);
}, (W) => [['not both deleted', W.alive('p2', W.d) || W.alive('p2', W.t)], ['at least one deleted', !(W.alive('p2', W.d) && W.alive('p2', W.t))]]);
// Q1753: a single two-colour (red+black) source card is enough for both halves of the effect
T(1753, 'BT8-070', 'one 2-colour source enables both', async (W) => {
  const s = W.put('p1', [RED4, RB]); W.d = W.put('p2', RED3); W.t = W.put('p2', 'BT8-085'); await W.evolve('p1', s.uid, 'BT8-070', 0);
}, (W) => [['opp digimon deleted', !W.alive('p2', W.d)], ['opp tamer deleted', !W.alive('p2', W.t)]]);
// Q1758: BT8-072 – the discarded digimon must itself be purple; with no purple digimon among the 3 nothing is discarded
T(1758, 'BT8-072', 'non-purple digimon cannot be discarded', async (W) => {
  W.deck('p1', [TAMER, RED3, RED3b, ...FILL.slice(26, 40)]); W.t0 = W.pl('p1').trash.length; await W.play('p1', 'BT8-072');
}, (W) => [['nothing trashed', W.pl('p1').trash.length === W.t0], ['tamer added to hand', W.pl('p1').hand.includes(TAMER)]]);
T(1758, 'BT8-072', 'purple digimon is discarded', async (W) => {
  W.deck('p1', [TAMER, RED3, PUR3, ...FILL.slice(26, 40)]); await W.play('p1', 'BT8-072');
}, (W) => [['purple digimon trashed', W.pl('p1').trash.includes(PUR3)], ['red digimon not trashed', !W.pl('p1').trash.includes(RED3)]]);
// Q1759: BT8-074 source effect: a card discarded because it was revealed-and-left-over is NOT "deck was trashed"
T(1759, 'BT8-074', 'reveal-and-trash does not trigger memory gain', async (W) => {
  W.put('p1', [RED4, 'BT8-074']); W.m0 = W.mem(); await W.useOption('p1', 'BT8-106');
}, (W) => [['memory only reduced by the option cost (no +1)', W.mem() === W.m0 - C('BT8-106').cost]]);
T(1759, 'BT8-074', 'control: real deck-trash triggers +1 memory', async (W) => {
  const s = W.put('p1', [RED4, 'BT8-074']); W.m0 = W.mem(); await W.evolve('p1', s.uid, 'BT8-079', 0);
}, (W) => [['memory +1', W.mem() === W.m0 + 1]]);
// Q1761/1762: BT8-082 evolve-time both halves apply with separate purple and yellow sources, or one purple+yellow source
T(1761, 'BT8-082', 'purple and yellow separate sources', async (W) => {
  const s = W.put('p1', ['BT8-082', PUR3, YEL4].reverse().slice(0, 0).concat([RED4, PUR3, YEL4])); W.d = W.put('p2', RED4); W.s0 = W.pl('p1').security.length; await W.evolve('p1', s.uid, 'BT8-082', 0);
}, (W) => [['Lv4 opp digimon deleted', !W.alive('p2', W.d)], ['recovery +1', W.pl('p1').security.length === W.s0 + 1]]);
T(1762, 'BT8-082', 'single purple/yellow source', async (W) => {
  const s = W.put('p1', [RED4, fillOf(c => c.colors.length === 2 && c.colors.includes('purple') && c.colors.includes('yellow'))[0]]); W.d = W.put('p2', RED4); W.s0 = W.pl('p1').security.length; await W.evolve('p1', s.uid, 'BT8-082', 0);
}, (W) => [['Lv4 opp digimon deleted', !W.alive('p2', W.d)], ['recovery +1', W.pl('p1').security.length === W.s0 + 1]]);
// Q1763: BT8-084 counts colours of its own sources as its colours on my turn (white + red + green)
T(1763, 'BT8-084', 'colours from sources add up', async (W) => {
  W.s = W.put('p1', ['BT8-084', RED4, 'ST4-07']);
}, (W) => { const cols = S.stackColors(W.s); return [['has white', cols.includes('white')], ['has red', cols.includes('red')], ['has green', cols.includes('green')], ['3 colours', cols.length === 3]]; });
// Q1764: BT8-085 "2+ colour digimon attacks": only the digimon's own colours count, not its sources'
T(1764, 'BT8-085', 'source colours do not count', async (W) => {
  W.tm = W.put('p1', 'BT8-085'); const a = W.put('p1', [RED4, RB]); W.d = W.put('p2', RED3b); await W.attack('p1', a.uid, null);
}, (W) => [['opp digimon survives', W.alive('p2', W.d)], ['tamer stays active', !W.tm.suspended]]);
T(1764, 'BT8-085', 'control: own 2 colours triggers', async (W) => {
  W.tm = W.put('p1', 'BT8-085'); const a = W.put('p1', [RB, RED4]); W.d = W.put('p2', RED3b); await W.attack('p1', a.uid, null);
}, (W) => [['opp digimon deleted', !W.alive('p2', W.d)], ['tamer rested', W.tm.suspended]]);
// Q1768: BT8-089 same rule for the DP-2000 tamer
T(1768, 'BT8-089', 'source colours do not count', async (W) => {
  W.tm = W.put('p1', 'BT8-089'); const a = W.put('p1', [RED4, RB]); W.d = W.put('p2', RED4); await W.attack('p1', a.uid, null);
}, (W) => [['no DP reduction', W.dp('p2', W.d) === 5000], ['tamer stays active', !W.tm.suspended]]);
T(1768, 'BT8-089', 'control: own 2 colours triggers', async (W) => {
  W.tm = W.put('p1', 'BT8-089'); const a = W.put('p1', [RB]); W.d = W.put('p2', RED4); await W.attack('p1', a.uid, null);
}, (W) => [['DP -2000', W.dp('p2', W.d) === 3000]]);
// Q1765: BT8-087 fires only when a blue digimon is chosen as the attack TARGET, not when it merely blocks
T(1765, 'BT8-087', 'targeted blue digimon -> draw', async (W) => {
  W.st.activePlayer = 'p2'; W.put('p1', 'BT8-087'); W.bl = W.put('p1', BLUE4); W.a = W.put('p2', RED4); W.h0 = W.pl('p1').hand.length; await W.attack('p2', W.a.uid, W.bl.uid);
}, (W) => [['p1 drew 1', W.pl('p1').hand.length === W.h0 + 1]]);
T(1765, 'BT8-087', 'blue digimon blocking -> no draw', async (W) => {
  W.st.activePlayer = 'p2'; W.put('p1', 'BT8-087'); W.bl = W.put('p1', BLUE4); W.a = W.put('p2', RED4); W.h0 = W.pl('p1').hand.length; await W.attack('p2', W.a.uid, null, { block: W.bl.uid });
}, (W) => [['p1 did not draw', W.pl('p1').hand.length === W.h0]]);
// Q1769: BT8-094 fires for any Lv3 opp digimon leaving the raising area for the battle area (also outside the breeding phase)
T(1769, 'BT8-094', 'raising -> battle by effect', async (W) => {
  W.put('p1', 'BT8-094'); W.st.activePlayer = 'p2'; const r = S._s4.makeStack(RED3, 1); W.pl('p2').raising = r; W.m0 = W.mem('p1'); S.moveRaisingToBattle(W.st, 'p2'); await W.drain();
}, (W) => [['p1 memory +2', W.mem('p1') === W.m0 + 2]]);
// Q1771/1772: BT8-096 "source with 2+ colours" means a single card holding 2 colours; two 1-colour sources or a granted extra colour do not count
T(1771, 'BT8-096', 'two mono-colour sources do not upgrade', async (W) => {
  W.put('p1', [RED3, RED4, BLUE4]); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-096');
}, (W) => [['DP5000 digimon survives (limit stays 4000)', W.alive('p2', W.d)]]);
T(1771, 'BT8-096', 'control: 2-colour source card upgrades', async (W) => {
  W.put('p1', [RED3, RB]); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-096');
}, (W) => [['DP5000 digimon deleted', !W.alive('p2', W.d)]]);
T(1772, 'BT8-096', 'granted-colour source does not upgrade', async (W) => {
  W.put('p1', [RED3, 'BT3-040']); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-096');
}, (W) => [['DP5000 digimon survives', W.alive('p2', W.d)]]);
// Q1779/1780: BT8-100 same criterion for the DP-3000/-6000 option
T(1779, 'BT8-100', 'two mono-colour sources -> only -3000', async (W) => {
  W.put('p1', [RED3, RED4, BLUE4]); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-100');
}, (W) => [['DP -3000', W.dp('p2', W.d) === 2000]]);
T(1780, 'BT8-100', 'granted-colour source -> only -3000', async (W) => {
  W.put('p1', [RED3, 'BT3-040']); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-100');
}, (W) => [['DP -3000', W.dp('p2', W.d) === 2000]]);
T(1780, 'BT8-100', 'control: 2-colour source -> -6000', async (W) => {
  W.put('p1', [RED3, RB]); W.d = W.put('p2', 'ST5-05'); await W.useOption('p1', 'BT8-100');
}, (W) => [['DP -6000', W.dp('p2', W.d) === C('ST5-05').dp - 6000]]);
// Q1773: BT8-097 cost reduction never goes below 0
T(1773, 'BT8-097', 'use cost floor is 0', async (W) => { for (let i = 0; i < 8; i++) W.put('p2', FILL[i]); W.hand('p1', ['BT8-097']); W.c = S.optionBaseCost ? S.optionBaseCost(W.st, 'p1', 'BT8-097') : null; },
  (W) => [['cost is 0 (not negative)', W.c === 0]]);
// Q1782: BT8-102 – already-rested target: the "does not become active" clause does not apply (it only binds cards rested by this effect)
T(1782, 'BT8-102', 'already rested target is not locked', async (W) => {
  W.put('p1', RED3); W.d = W.put('p2', RED4, { suspended: true }); await W.useOption('p1', 'BT8-102');
}, (W) => [['target not locked', !W.d.skipNextUnsuspend]]);
T(1782, 'BT8-102', 'control: active target rested and locked', async (W) => {
  W.put('p1', RED3); W.d = W.put('p2', RED4); await W.useOption('p1', 'BT8-102');
}, (W) => [['target rested', W.d.suspended], ['locked for next unsuspend', !!W.d.skipNextUnsuspend]]);
// Q1783/1784: BT8-105 choose any number of opponent digimon with total play cost <=15, at least one
T(1783, 'BT8-105', 'multi-target within 15', async (W) => {
  W.a = W.put('p2', 'ST8-08'); W.b = W.put('p2', RED3b); W.c = W.put('p2', RED4); await W.useOption('p1', 'BT8-105');
}, (W) => [['some deleted', [W.a, W.b, W.c].some(s => !W.alive('p2', s))]], { allowErrors: true });
// Q1788: BT8-107 may be used with no opposing digimon: own digimon is still deleted
T(1788, 'BT8-107', 'usable with no opponent digimon', async (W) => { W.me = W.put('p1', RED4); await W.useOption('p1', 'BT8-107'); },
  (W) => [['own digimon deleted', !W.alive('p1', W.me)]]);
// Q1792: BT8-111 evolve-time: 4+ discarded -> only ONE purple Lv5- digimon may be played from trash
T(1792, 'BT8-111', 'only one played from trash', async (W) => {
  for (let i = 0; i < 4; i++) W.put('p2', FILL[i]); W.trash('p1', ['ST6-05', 'ST6-03']); const s = W.put('p1', [RED4]); await W.evolve('p1', s.uid, 'BT8-111', 0);
}, (W) => [['exactly one purple digimon entered play', W.count('p1', 'ST6-05') + W.count('p1', 'ST6-03') === 1]]);
// Q1793: BT8-111 attack-time: trash 20 -> opponent deck -6, this digimon DP +6000
T(1793, 'BT8-111', 'per 10 trash scaling', async (W) => {
  W.s = W.put('p1', 'BT8-111'); W.trash('p1', FILL.slice(0, 20)); W.dd = W.pl('p2').deck.length; await W.fire('p1', W.s, 'attack');
}, (W) => [['opp deck -6', W.pl('p2').deck.length === W.dd - 6], ['DP +6000', W.dp('p1', W.s) === C('BT8-111').dp + 6000]]);
// Q1799: BT9-009/011 inherited: DP-delete limit +1000 -> a DP4000 opponent digimon can be deleted by a "DP 3000 or less" effect; Q1800: not for "this digimon's DP"
T(1799, 'BT9-009', 'limit +1000 raises printed cap', async (W) => {
  const s = W.put('p1', [RED4, 'BT9-011']); W.d = W.put('p2', RED3); W.d2 = W.put('p2', 'ST1-04'); W.picks.pickStack = (o) => o.uids.find(u => u === W.d2.uid); await W.evolve('p1', s.uid, 'BT9-009', 0);
}, (W) => [['DP4000 digimon deleted', !W.alive('p2', W.d2)]]);
await runScenarios(L, 'a');
