// slice2 round 2 (part f): BT16/BT17 "security >=3 ... then security <=3" cards (both halves at exactly 3), security-decrease watchers. Q ids cited; own paraphrase.
import { runScenarios, FILL, S, E, C, fillOf, byName, lvl } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', GREY = 'ST1-07', MEGA = 'ST1-09';
const two = (W, a, b) => { W.picks.pickStack = (o) => (/소멸/.test(String(o.prompt)) ? b : a); };
const cheapLv4 = fillOf(c => c.level === 4)[0] || RED4;
const PULSE = 'BT17-030'; // named 「펄스몬」 (evolution source for the printed evolution lines; effects are irrelevant as a source of a plain evolve)
// [card, Q for security exactly 3, first-half check, second-half check, setup]
const fam = [
  ['BT16-043', 2635, 'opp digimon rested', 'memory +1',
    (W) => { W.o = W.put('p2', RED4); W.m0 = W.mem(); W.picks.pickStack = (o) => o.uids?.[0]; },
    (W) => W.o.suspended === true, (W) => W.mem() === W.m0 + 1 ],
  ['BT16-023', 2618, 'own digimon made active', 'opp Lv<=4 digimon returned to deck bottom',
    (W) => { W.own = W.put('p1', RED3, { suspended: true }); W.o = W.put('p2', RED4); W.picks.pickStack = (o) => (o.uids || []).includes(W.own.uid) ? W.own.uid : o.uids?.[0]; },
    (W) => W.own.suspended === false, (W) => !W.alive('p2', W.o) ],
];
for (const [card, q, h1, h2, setup, c1, c2] of fam) {
  for (const [n, want1, want2] of [[3, true, true], [4, true, false], [2, false, true]]) {
    T(n === 3 ? q : q, card, `security ${n}: ${want1 ? h1 : '(no) ' + h1} / ${want2 ? h2 : '(no) ' + h2}`, async (W) => { W.sec('p1', FILL.slice(20, 20 + n)); W.s = W.put('p1', [RED4]); setup(W); await W.evolve('p1', W.s.uid, card, 0); }, (W) => [['first half', c1(W) === want1], ['second half', c2(W) === want2]]);
  }
}
// BT16-059: retreat 1 on one digimon, THEN delete a cost<=6 digimon (a second, independent target)
for (const [n, w1, w2] of [[3, true, true], [4, true, false], [2, false, true]])
  T(2646, 'BT16-059', `security ${n}: retreat ${w1} / delete ${w2}`, async (W) => { W.sec('p1', FILL.slice(20, 20 + n)); W.s = W.put('p1', [RED4]); W.a = W.put('p2', [RED4, RED3]); W.b = W.put('p2', RED3); two(W, W.a.uid, W.b.uid); W.top0 = W.a.cardId; await W.evolve('p1', W.s.uid, 'BT16-059', 0); }, (W) => { return [['retreat happened', (W.a.cardId !== W.top0) === w1], ['second target deleted', !W.alive('p2', W.b) === w2]]; });
// BT16-047 (either turn): after deleting an opposing digimon in battle: sec>=3 -> discard opp security top; then sec<=3 -> memory +2 (both at exactly 3)
for (const [n, w1, w2] of [[3, true, true], [4, true, false], [2, false, true]])
  T(2639, 'BT16-047', `security ${n}: opp security discard ${w1} / memory +2 ${w2}`, async (W) => { W.sec('p1', FILL.slice(20, 20 + n)); W.s = W.put('p1', ['BT16-047', RED4]); W.t = W.put('p2', RED3, { suspended: true }); W.o0 = W.pl('p2').security.length; W.m0 = W.mem(); W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, W.t.uid); }, (W) => [['opp security', (W.pl('p2').security.length === W.o0 - 1) === w1], ['memory', (W.mem() === W.m0 + 2) === w2]]);
// BT16-013: "when security decreases" fires also when the decrease comes from your OWN effect; once per turn even with two checks
T(2606, 'BT16-013', 'own effect removes own security -> DP<=8000 opposing digimon is deleted', async (W) => { W.put('p1', 'BT16-013'); W.sec('p1', FILL.slice(20, 24)); W.o = W.put('p2', RED4); W.picks.pickStack = (o) => o.uids?.[0]; await W.play('p1', 'BT1-087'); }, (W) => [['deleted', !W.alive('p2', W.o)]]);
T(2608, 'BT16-013', 'two checks in one attack (security attack +1) -> only one activation', async (W) => { W.put('p1', 'BT16-013'); W.sec('p1', FILL.slice(20, 25)); const a = W.put('p2', 'BT4-016'); W.b = W.put('p2', RED4); W.c = W.put('p2', RED4); W.st.activePlayer = 'p2'; W.st.memory = -5; W.picks.pickStack = (o) => o.uids?.[0]; a.attackEligibleTurn = 0; await W.attack('p2', a.uid, null); }, (W) => [['at most one of the two extra digimon deleted', [W.b, W.c].filter(x => !W.alive('p2', x)).length <= 1]]);
// BT16-036 (opp turn end): both discard security; a player with 0 security simply skips
T(2631, 'BT16-036', 'one player has no security: the other still discards', async (W) => { W.put('p1', 'BT16-036'); W.sec('p1', FILL.slice(20, 24)); W.sec('p2', []); W.n0 = W.pl('p1').security.length; W.st.activePlayer = 'p2'; E.endTurn(W.st, false); let g = 0; while (W.st.turnEnding && g++ < 8) { await W.drain(); E.settleTurnEnd(W.st); } await W.drain(); }, (W) => [['p1 discarded one', W.pl('p1').security.length === W.n0 - 1], ['no crash', true]]);
// BT17-064: source Patamon (BT16-016) discards the opponent's source first -> the attacked digimon now has no source but the trigger was already missed
T(2816, 'BT17-064', 'digimon with sources attacked: no instant deletion even if its sources are removed during the attack', async (W) => { W.s = W.put('p1', ['BT17-064', 'BT16-016']); W.t = W.put('p2', [RED4, RED3], { suspended: true }); W.s.attackEligibleTurn = 0; W.picks.confirmEffect = true; await W.attack('p1', W.s.uid, W.t.uid); }, (W) => [['effect delete did not fire (target lost by battle result only)', W.alive('p2', W.t) || W.pl('p2').trash.length >= 1]]);
await runScenarios(L, 'r2-f');
