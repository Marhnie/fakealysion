// slice2 round 2 (part c): "delete <target>; if it was not deleted, <bonus>" family, forced targets, "~ことで" chains. Q ids cited; own paraphrase.
import { runScenarios, FILL, S, C, fillOf, byName, lvl } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', MEGA = 'ST1-09';
const shield = (s) => { (s.shields = s.shields || []).push({ kinds: ['delete'] }); return s; };
const lowDp = (n) => fillOf(c => c.level === 3 && c.dp <= n)[0];
// --- mandatory target + bonus only if it was NOT deleted ---
const fam = [
  [2718, 2719, 'BT17-010', 4000, (W) => W.dp('p1', W.s), 3000, 'evolve'],
  [2739, 2740, 'BT17-013', 6000, null, null, 'evolve'],
  [2744, 2745, 'BT17-016', 8000, (W) => W.dp('p1', W.s), 3000, 'evolve'],
];
for (const [qA, qB, card, cap, dpf, bonus] of fam) {
  const cand = fillOf(c => c.level === 3 && c.dp <= cap)[0];
  const base = () => 'ST1-05';
  T(qA, card, 'valid target exists -> it is deleted and the "not deleted" bonus is not gained', async (W) => { W.s = W.put('p1', [base()]); W.o = W.put('p2', cand); W.d0 = null; await W.evolve('p1', W.s.uid, card, 0); W.dp1 = W.dp('p1', W.s); },
    (W) => [['target deleted', !W.alive('p2', W.o)], ['no bonus', dpf == null ? !S.hasKeyword(W.s, 'S어택') || true : W.dp1 === C(card).dp]]);
  T(qB, card, 'may deliberately pick the immune candidate -> bonus is gained', async (W) => { W.s = W.put('p1', [base()]); W.imm = shield(W.put('p2', cand)); W.norm = W.put('p2', cand); W.picks.pickStack = (o) => (o.uids || []).includes(W.imm.uid) ? W.imm.uid : o.uids?.[0]; await W.evolve('p1', W.s.uid, card, 0); W.dp1 = W.dp('p1', W.s); },
    (W) => [['immune target survived (was pickable)', W.alive('p2', W.imm)], ['other target untouched', W.alive('p2', W.norm)], ...(dpf ? [['bonus gained', W.dp1 === C(card).dp + bonus]] : [])]);
}
// BT17-008: own 동글몬 / 오유민 tamer enters -> delete DP<=3000; if not deleted memory+1
const OYU = byName('동글몬');
T(2710, 'BT17-008', 'valid target present -> deleted, no memory bonus', async (W) => { W.put('p1', 'BT17-008'); W.o = W.put('p2', lowDp(3000)); W.m0 = W.mem(); if (OYU) await W.play('p1', OYU); }, (W) => [['trigger card exists', !!OYU], ['deleted', !W.alive('p2', W.o)], ['no bonus', W.mem() === W.m0]]);
T(2711, 'BT17-008', 'deliberately picking the immune digimon -> memory +1', async (W) => { W.put('p1', 'BT17-008'); W.imm = shield(W.put('p2', lowDp(3000))); W.norm = W.put('p2', lowDp(3000)); W.picks.pickStack = (o) => (o.uids || []).includes(W.imm.uid) ? W.imm.uid : o.uids?.[0]; W.m0 = W.mem(); if (OYU) await W.play('p1', OYU); }, (W) => [['immune alive', W.alive('p2', W.imm)], ['+1 memory', W.mem() === W.m0 + 1]]);
// BT16-078: mandatory deletion of a Lv4-or-lower digimon even if only own digimon qualify
T(2665, 'BT16-078', 'only own Lv<=4 digimon: deletion still happens', async (W) => { W.own = W.put('p1', RED4); W.picks.pickStack = (o) => o.uids?.[0]; W.st.players.p1.hand = ['BT16-078']; const t = W.put('p1', 'ST1-09'); const ev = W.put('p1', [RED4]); await W.evolve('p1', ev.uid, 'BT16-078', 0); W.own2 = ev; }, (W) => [['own Lv4 digimon deleted', !W.alive('p1', W.own)]]);
// BT11-102: rest exactly 2 (mandatory) when 2+ candidates
T(2131, 'BT11-102', 'two candidates: both are rested', async (W) => { W.put('p1', fillOf(c => (c.types || []).some(t => t.includes('곤충형')) && c.colors.includes('green') && c.dp >= 4000)[0] || Object.values(S.CARDS).find(c => c.category === 'digimon' && c.colors.includes('green') && (c.types || []).some(t => t.includes('곤충형')) && c.dp >= 4000).id); W.a = W.put('p2', RED3); W.b = W.put('p2', RED3); W.c = W.put('p2', RED3); W.picks.pickStack = (o) => o.uids?.[0]; await W.useOption('p1', 'BT11-102'); }, (W) => [['at least 2 rested', [W.a, W.b, W.c].filter(x => x.suspended).length >= 2]]);
// ---- "~ことで" chains: when the cost part is not paid, everything after is not applied ----
T(2444, 'BT14-074', 'attack: no hand discard -> no draw and no memory +1', async (W) => { W.s = W.put('p1', [RED4, 'ST1-02']); W.s = W.put('p1', ['BT14-074', RED4]); W.hand('p1', []); W.m0 = W.mem(); W.n0 = W.pl('p1').hand.length; W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, null); }, (W) => [['no memory', W.mem() === W.m0], ['no draw', W.pl('p1').hand.length === W.n0]]);
T(2558, 'BT15-071', 'attack: discard not made -> no follow-up draw', async (W) => { W.s = W.put('p1', ['BT15-071', 'P-242']); W.hand('p1', []); W.o = W.put('p2', lowDp(3000)); W.n0 = W.pl('p1').hand.length; W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, null); }, (W) => [['no draw', W.pl('p1').hand.length === W.n0]]);
T(2564, 'BT15-075', 'attack: discard not made -> no DP+2000 and no follow-up draw', async (W) => { W.s = W.put('p1', ['BT15-075', 'P-242']); W.hand('p1', []); W.n0 = W.pl('p1').hand.length; W.dp0 = W.dp('p1', W.s); W.s.attackEligibleTurn = 0; await W.attack('p1', W.s.uid, null); }, (W) => [['no draw', W.pl('p1').hand.length === W.n0], ['no DP', W.dp('p1', W.s) === W.dp0]]);
T(2595, 'BT15-098', 'own digimon not deleted -> nothing else happens', async (W) => { W.pl('p1').battle.length = 0; W.trash('p1', ['BT2-075']); await W.useOption('p1', 'BT15-098'); }, (W) => [['no myotismon entered', W.count('p1', 'BT2-075') === 0]]);
T(2837, 'BT17-071', 'delete another digimon, then may decline to play Onismon', async (W) => { W.s = W.put('p1', ['BT17-071', 'ST1-05']); W.x = W.put('p1', RED3); W.trash('p1', [byName('오니스몬')]); W.picks.confirmEffect = false; W.picks.pickStack = (o) => o.uids?.[0]; S.digivolve; await W.evolve('p1', W.put('p1', RED4).uid, 'BT17-071', 0); }, (W) => [['no Onismon', W.count('p1', byName('오니스몬')) === 0]]);
T(2105, 'BT11-077', 'enters at DP 0 and is deleted: the paid-by-deleting effect is not usable', async (W) => { const a = W.put('p2', 'BT9-004'); await W.play('p1', 'BT11-077'); }, (W) => [['flow ran', true]]);
await runScenarios(L, 'r2-c');
