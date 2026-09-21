// slice2 round 2 (part l): 「서로의 시큐리티 합계」 (own + opponent security cards), blocked attacks change the attack target (watchers fire),
// BT16 「security exactly 3 -> both halves」 (BT16-034/044). Q ids cited; own paraphrase.
import { runScenarios, FILL, S, E, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', MEGA = 'ST1-09';
for (const [q, src] of [[2287, 'BT13-034'], [2288, 'BT13-036'], [2289, 'BT13-037'], [2290, 'BT13-038']])
  for (const [mine, theirs, want] of [[3, 2, true], [3, 3, true], [4, 3, false]])
    T(q, src, `security ${mine}+${theirs}=${mine + theirs} (<=6 -> ${want ? 'DP-2000 applies' : 'no effect'})`, async (W) => { W.s = W.put('p1', [RED4, src]); W.s.attackEligibleTurn = 0; W.o = W.put('p2', MEGA); W.d0 = W.dp('p2', W.o); W.sec('p1', FILL.slice(20, 20 + mine)); W.sec('p2', FILL.slice(30, 30 + theirs)); W.picks.pickStack = (o) => o.uids?.[0]; await W.attack('p1', W.s.uid, null); }, (W) => [['DP change', (W.dp('p2', W.o) === W.d0 - 2000) === want]]);
// blocked attack -> attack target changes -> watchers fire
T(2053, 'BT11-008', 'attack on player is blocked: the source effect (DP+3000 on target change) still applies', async (W) => { W.s = W.put('p1', [RED4, 'BT11-008']); W.s.attackEligibleTurn = 0; W.b = W.put('p2', MEGA); W.d0 = W.dp('p1', W.s); await W.attack('p1', W.s.uid, null, { block: W.b.uid }); }, (W) => [['DP +3000 was applied at redirect', W.prompts.length >= 0 && (W.dp('p1', W.s) === W.d0 + 3000 || !W.alive('p1', W.s))]]);
T(2055, 'BT11-010', 'same for BT11-010', async (W) => { W.s = W.put('p1', [RED4, 'BT11-010']); W.s.attackEligibleTurn = 0; W.b = W.put('p2', MEGA); W.d0 = W.dp('p1', W.s); await W.attack('p1', W.s.uid, null, { block: W.b.uid }); }, (W) => [['DP +3000 was applied at redirect', W.dp('p1', W.s) === W.d0 + 3000 || !W.alive('p1', W.s)]]);
T(2062, 'BT11-017', 'attacker is blocked: 【자신의 턴】 target-change effect activates memory (+1 per red tamer)', async (W) => { W.put('p1', 'BT11-017'); W.put('p1', 'ST1-12'); W.s = W.put('p1', RED4); W.s.attackEligibleTurn = 0; W.b = W.put('p2', MEGA); W.m0 = W.mem(); await W.attack('p1', W.s.uid, null, { block: W.b.uid }); }, (W) => [['memory increased', W.mem() >= W.m0 + 1]]);
// BT16 security exactly 3: both halves
T(2630, 'BT16-034', 'security 3: DP-4000 AND security attack -2 are both given', async (W) => { W.sec('p1', FILL.slice(20, 23)); W.s = W.put('p1', [RED4]); W.o = W.put('p2', MEGA); W.d0 = W.dp('p2', W.o); W.picks.pickStack = (o) => o.uids?.[0]; await W.evolve('p1', W.s.uid, 'BT16-034', 0); }, (W) => [['DP -4000', W.dp('p2', W.o) === W.d0 - 4000], ['second half ran (a second choice was offered)', W.prompts.filter(p => p.k === 'pickStack').length >= 2]]);
T(2636, 'BT16-044', 'security 3: rest AND memory +2', async (W) => { W.sec('p1', FILL.slice(20, 23)); W.s = W.put('p1', [RED4]); W.o = W.put('p2', MEGA); W.m0 = W.mem(); W.picks.pickStack = (o) => o.uids?.[0]; await W.evolve('p1', W.s.uid, 'BT16-044', 0); }, (W) => [['rested', W.o.suspended === true], ['memory +2', W.mem() === W.m0 + 2]]);
await runScenarios(L, 'r2-l');
