// slice2 round 2 (part e): effects that still resolve with no opposing target, mandatory "as many as possible", play restrictions,
// effect-driven attacks (entry-turn / rested restrictions). Q ids cited; own paraphrase.
import { runScenarios, FILL, S, E, C, fillOf, byName, lvl } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', GREY = 'ST1-07', MEGA = 'ST1-09';
const P3 = lvl(3, 'purple'), B3 = lvl(3, 'blue');
const dBrig = Object.values(S.CARDS).filter(c => (c.types || []).some(t => /D-브리가드|디지대/.test(t))).slice(0, 3).map(c => c.id);
// --- effects that need no opposing target still resolve their own part ---
T(2422, 'BT14-054', 'evolve with no opposing digimon: still becomes active', async (W) => { W.s = W.put('p1', [RED4], { suspended: true }); await W.evolve('p1', W.s.uid, 'BT14-054', 0); }, (W) => [['active', !W.s.suspended]]);
T(2447, 'BT14-076', 'no opposing digimon: the hand discard and own lowest-level deletion still happen', async (W) => { W.s = W.put('p1', [GREY]); W.low = W.put('p1', P3); W.hand('p1', [RED3]); await W.evolve('p1', W.s.uid, 'BT14-076', 0); }, (W) => [['lowest own digimon deleted', !W.alive('p1', W.low)], ['a hand card was discarded', W.pl('p1').trash.includes(RED3)]]);
T(2483, 'BT14-098', 'no opposing digimon: the 3-card deck-top payment can still be made', async (W) => { W.trash('p1', dBrig); W.d0 = W.pl('p1').deck.length; await W.useOption('p1', 'BT14-098'); }, (W) => [['3 cards returned to deck top', dBrig.length < 3 || W.pl('p1').deck.length === W.d0 + 3]]);
T(2485, 'BT14-102', 'attack with no opposing digimon: may delete itself', async (W) => { W.s = W.put('p1', ['BT14-102', 'BT8-005']); W.s.attackEligibleTurn = 0; W.picks.multipleChoice = 0; await W.attack('p1', W.s.uid, null); }, (W) => [['deleted (and effect payment allowed)', !W.alive('p1', W.s)]]);
T(2504, 'BT15-019', 'no opposing digimon at all: the "no one has sources" draw happens', async (W) => { W.pl('p1').deck = FILL.slice(26, 40); W.h0 = W.pl('p1').hand.length; await W.play('p1', 'BT15-019'); }, (W) => [['drew 1', W.pl('p1').hand.length === W.h0 + 1]]);
T(2506, 'BT15-023', 'no opposing digimon at all: memory +1', async (W) => { W.m0 = W.mem(); await W.play('p1', 'BT15-023'); }, (W) => [['+1', W.mem() === W.m0 + 1]]);
// BT15-054: digimon AND tamer both are rested (as many as possible), and both stay rested through the opponent's next turn
T(2538, 'BT15-054', 'one digimon + one tamer: both are rested', async (W) => { W.s = W.put('p1', ['ST1-05', 'BT9-055']); W.d = W.put('p2', RED3); W.t = W.put('p2', 'P-242'); W.picks.pickStack = (o) => o.uids?.[0]; await W.evolve('p1', W.s.uid, 'BT15-054', 0); }, (W) => [['digimon rested', W.d.suspended === true], ['tamer rested', W.t.suspended === true]]);
// BT14-037: ONE opposing digimon only (per own security card)
T(2412, 'BT14-037', 'DP reduction hits one opposing digimon only', async (W) => { W.sec('p1', FILL.slice(20, 22)); W.s = W.put('p1', [RED4]); W.a = W.put('p2', MEGA); W.b = W.put('p2', MEGA); W.da = W.dp('p2', W.a); W.picks.pickStack = (o) => o.uids?.[0]; await W.evolve('p1', W.s.uid, 'BT14-037', 0); }, (W) => [['exactly one reduced', [W.a, W.b].filter(x => W.dp('p2', x) < W.da).length === 1], ['by 3000 (2 + recovered 1 security)', Math.min(W.dp('p2', W.a), W.dp('p2', W.b)) === W.da - 3000]]);
// BT14-017: opponent (memory on holder side >= 1) cannot even declare a play of a DP<=6000 digimon, also by effect
T(2380, 'BT14-017', 'effect-play of a DP<=6000 digimon is impossible', async (W) => { W.put('p2', 'BT14-017'); W.st.memory = 3; W.st.activePlayer = 'p1'; W.pl('p1').hand = [RED3]; W.r = S.playFreeFromZone(W.st, 'p1', 'hand', 0, {}); }, (W) => [['not played', !W.r]]);
T(2384, 'BT14-017', 'normal play declaration is impossible too', async (W) => { W.put('p2', 'BT14-017'); W.st.memory = 3; W.pl('p1').hand = [RED3]; W.rs = S.isPlayRestricted(W.st, 'p1', RED3); }, (W) => [['restricted', W.rs === true]]);
T(2382, 'BT14-017', 'DP printed <= 6000 restricted; a card printed >6000 is not', async (W) => { W.put('p2', 'BT14-017'); W.st.memory = 3; W.a = S.isPlayRestricted(W.st, 'p1', RED3); W.b = S.isPlayRestricted(W.st, 'p1', MEGA); }, (W) => [['low restricted', W.a === true], ['high free', W.b === false]]);
// BT14-017 memory condition off: no restriction
T(2384, 'BT14-017', 'restriction is off while memory is on the other side', async (W) => { W.put('p2', 'BT14-017'); W.st.memory = -3; W.a = S.isPlayRestricted(W.st, 'p1', RED3); }, (W) => [['not restricted', W.a === false]]);
// --- effect-driven attack legality (BT9-095 / BT9-100 / BT11-104 / BT11-107 family): entry-turn and rested digimon cannot attack; only rested digimon are attackable ---
T(1898, 'BT9-095', 'a digimon that entered this turn cannot be made to attack', async (W) => { W.f = W.put('p1', GREY, { fresh: true }); const r = S.declareAttack(W.st, 'p1', W.f.uid, {}); W.r = r; }, (W) => [['declaration refused', W.r.ok === false]]);
T(1903, 'BT9-100', 'same: fresh digimon cannot attack', async (W) => { W.f = W.put('p1', GREY, { fresh: true }); W.r = S.declareAttack(W.st, 'p1', W.f.uid, {}); }, (W) => [['declaration refused', W.r.ok === false]]);
T(2135, 'BT11-107', 'same: fresh digimon cannot attack', async (W) => { W.f = W.put('p1', GREY, { fresh: true }); W.r = S.declareAttack(W.st, 'p1', W.f.uid, {}); }, (W) => [['declaration refused', W.r.ok === false]]);
T(2497, 'BT15-015', 'a rested digimon cannot attack', async (W) => { W.f = W.put('p1', GREY, { suspended: true }); W.r = S.declareAttack(W.st, 'p1', W.f.uid, {}); }, (W) => [['declaration refused', W.r.ok === false]]);
T(2376, 'BT14-013', 'a rested digimon cannot attack (turn-end attack grant)', async (W) => { W.f = W.put('p1', GREY, { suspended: true }); W.r = S.declareAttack(W.st, 'p1', W.f.uid, {}); }, (W) => [['declaration refused', W.r.ok === false]]);
T(2424, 'BT14-054', 'a rested digimon cannot attack (turn-end attack)', async (W) => { W.f = W.put('p1', GREY, { suspended: true }); W.r = S.declareAttack(W.st, 'p1', W.f.uid, {}); }, (W) => [['declaration refused', W.r.ok === false]]);
T(1904, 'BT9-100', 'only RESTED opposing digimon are legal attack targets', async (W) => { W.a = W.put('p1', GREY); W.act = W.put('p2', RED3); W.rst = W.put('p2', RED3, { suspended: true }); W.t = S.legalDigimonTargets(W.st, 'p1', W.a.uid); }, (W) => [['rested is targetable', W.t.some(x => (x.uid || x) === W.rst.uid)], ['active is not', !W.t.some(x => (x.uid || x) === W.act.uid)]]);
T(2132, 'BT11-104', 'active opposing digimon cannot be attacked', async (W) => { W.a = W.put('p1', GREY); W.act = W.put('p2', RED3); W.t = S.legalDigimonTargets(W.st, 'p1', W.a.uid); }, (W) => [['no legal target', W.t.length === 0]]);
await runScenarios(L, 'r2-e');
