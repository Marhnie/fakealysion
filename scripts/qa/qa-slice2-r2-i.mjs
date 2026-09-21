// slice2 round 2 (part i): security-related families. Q ids cited; own paraphrase.
//  * "when this card is discarded from security" fires only for a DIRECT discard from the security stack, not for a card that was opened/checked first
//  * a rested digimon with 「not affected by opposing digimon's effects」 also ignores the 【시큐리티】 effect of a security DIGIMON
//  * "DP-destroy cap +N" does not lift a cap that is not a printed number ("this digimon's DP or less")
import { runScenarios, FILL, S, E, Fx, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', MEGA = 'ST1-09';
const discardTop = async (W, who) => { const me = W.put('p1', RED3); const ctx = { state: W.st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT9-083', sourceStackUid: me.uid, trigger: null, startAttack() {}, choose: W.choose }; await Fx.runScript([{ op: 'removeSecurity', who, position: 'top' }], ctx); await W.drain(); };
// --- direct discard from the security stack vs checked card ---
for (const [q, card] of [[2345, 'BT13-098'], [2354, 'BT13-106'], [2518, 'BT15-037'], [2583, 'BT15-084']]) {
  T(q, card, 'direct discard from security: its own 「discarded from security」 trigger is queued', async (W) => { W.sec('p2', [card, ...FILL.slice(20, 23)]); W.resolved.length = 0; await discardTop(W, 'opponent'); }, (W) => [['top card left security', !W.pl('p2').security.includes(card)], ['trigger resolved once', W.resolved.filter(x => x.cardId === card).length >= 1]]);
  T(q, card, 'checked by an attack and then trashed: the 「discarded from security」 trigger does not exist for it', async (W) => { W.sec('p2', [card, ...FILL.slice(20, 23)]); const a = W.put('p1', MEGA); a.attackEligibleTurn = 0; W.resolved.length = 0; const noTrig = () => W.resolved.filter(x => x.cardId === card && (x.tags || []).some(t => /파기/.test(t))).length; await W.attack('p1', a.uid, null); W.n = noTrig(); }, (W) => [['no discard-tag trigger for the checked card', W.n === 0]]);
}
// --- rested digimon immune to opposing digimon effects also ignores a security digimon's 【시큐리티】 ---
for (const [q, card] of [[2526, 'BT15-047'], [2528, 'BT15-049'], [2537, 'BT15-053'], [2640, 'BT16-048']]) {
  const run = (immune) => async (W) => { W.s = W.put('p1', [card, RED4]); W.s.attackEligibleTurn = 0; S.modifyDP(W.st, 'p1', W.s.uid, 30000); W.sec('p2', ['AD1-018', ...FILL.slice(20, 23)]); W.top0 = W.s.cardId; await W.attack('p1', W.s.uid, null); };
  T(q, card, 'rested (attacking) digimon: the security digimon retreat/delete effect has no effect on it', run(true), (W) => { const s = W.st.players.p1.battle.find(x => x.uid === W.s.uid); return [['still alive', !!s], ['not retreated', !!s && s.cardId === card]]; });
}
T(2526, 'BT15-047', 'control: without the ability the same security digimon does retreat the attacker', async (W) => { W.s = W.put('p1', [MEGA, RED4]); W.s.attackEligibleTurn = 0; S.modifyDP(W.st, 'p1', W.s.uid, 30000); W.sec('p2', ['AD1-018', ...FILL.slice(20, 23)]); await W.attack('p1', W.s.uid, null); }, (W) => { const s = W.st.players.p1.battle.find(x => x.uid === W.s.uid); return [['retreated (top card changed)', !!s && s.cardId !== MEGA]]; });
// --- DP-destroy cap +N applies to printed numbers only ---
const BOOST = [[1802, 'BT9-011', 1000, false], [2145, 'BT12-001', 1000, false], [2714, 'BT17-008', 2000, true], [2722, 'BT17-010', 2000, true]];
for (const [q, src, boost, needMem] of BOOST) {
  T(q, src, `cap +${boost} does not lift "this digimon's DP or less"`, async (W) => { if (needMem) W.st.memory = 0; W.s = W.put('p1', ['BT9-016', src, 'BT9-109']); W.s.attackEligibleTurn = 0; W.t = W.put('p2', MEGA); const my = W.dp('p1', W.s); S.modifyDP(W.st, 'p2', W.t.uid, my + 500 - W.dp('p2', W.t)); await W.attack('p1', W.s.uid, null); }, (W) => [['target with DP slightly above own is NOT deleted', W.alive('p2', W.t)]]);
  T(q, src, 'control: target with DP equal to own DP is deleted', async (W) => { if (needMem) W.st.memory = 0; W.s = W.put('p1', ['BT9-016', src, 'BT9-109']); W.s.attackEligibleTurn = 0; W.t = W.put('p2', MEGA); const my = W.dp('p1', W.s); S.modifyDP(W.st, 'p2', W.t.uid, my - W.dp('p2', W.t)); await W.attack('p1', W.s.uid, null); }, (W) => [['deleted', !W.alive('p2', W.t)]]);
}
await runScenarios(L, 'r2-i');
