// slice2 round 2 (part j): "when you use an option card with use cost >= 2" holders (BT10-032, BT17-031, BT17-032, BT17-038). Q ids cited; own paraphrase.
//  (a) the trigger resolves AFTER the option's own 【메인】 effect;  (b) an option whose effect is activated WITHOUT being used (security effect) does not trigger;
//  (c) an option whose use cost was reduced in hand to 1 or less does not trigger, one reduced to 2+ does.
import { runScenarios, FILL, S, E, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const RED3 = 'ST1-02', RED4 = 'ST1-05', MEGA = 'ST1-09';
const HOLD = [['BT10-032', 1954, 1955, 1956, 'src'], ['BT17-031', 2778, 2779, 2780, 'src'], ['BT17-032', 2782, 2783, null, 'src'], ['BT17-038', 2788, 2789, 2790, 'top']];
const holder = (W, card, kind) => (kind === 'top' ? W.put('p1', [card, RED4]) : W.put('p1', [RED4, card]));
const fired = (W, card) => W.resolved.filter(x => x.cardId === card).length;
for (const [card, qOrder, qSec, qCost, kind] of HOLD) {
  T(qOrder, card, 'trigger resolves after the used option\'s own main effect', async (W) => { holder(W, card, kind); W.put('p1', RED3); W.put('p2', RED4); W.picks.pickStack = (o) => o.uids?.[0]; W.resolved.length = 0; await W.useOption('p1', 'BT9-093'); const iOpt = W.resolved.findIndex(x => x.cardId === 'BT9-093'), iH = W.resolved.findIndex(x => x.cardId === card); W.order = [iOpt, iH]; }, (W) => [['holder triggered', W.order[1] >= 0], ['after the option effect (or the option effect ran inline before)', W.order[0] < W.order[1] || W.order[0] === -1]]);
  T(qSec, card, 'option effect activated as a 【시큐리티】 effect (not used): no trigger', async (W) => { holder(W, card, kind); const a = W.put('p1', MEGA); a.attackEligibleTurn = 0; W.sec('p2', ['BT8-101', ...FILL.slice(20, 23)]); W.put('p2', RED4); W.picks.pickStack = (o) => o.uids?.[0]; W.resolved.length = 0; await W.attack('p1', a.uid, null); }, (W) => [['holder did not trigger', fired(W, card) === 0]]);
  if (qCost) {
    T(qCost, card, 'use cost reduced in hand to 1 or less: no trigger (BT8-097, six opposing digimon)', async (W) => { holder(W, card, kind); for (let i = 0; i < 6; i++) W.put('p2', RED3); W.picks.pickStack = (o) => o.uids?.[0]; W.resolved.length = 0; W.st.memory = 10; await W.useOption('p1', 'BT8-097'); }, (W) => [['no trigger', fired(W, card) === 0]]);
    T(qCost, card, 'control: reduced only to 4 (two opposing digimon): triggers', async (W) => { holder(W, card, kind); for (let i = 0; i < 2; i++) W.put('p2', RED3); W.picks.pickStack = (o) => o.uids?.[0]; W.resolved.length = 0; W.st.memory = 10; await W.useOption('p1', 'BT8-097'); }, (W) => [['triggered', fired(W, card) >= 1]]);
  }
}
await runScenarios(L, 'r2-j');
