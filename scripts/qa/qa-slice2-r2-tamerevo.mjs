// slice2 round 2 (tamer-evo family): 8 cards say "in hand this card may treat your <colour> tamer as a Lv.3 digimon and evolve from it".
// Official Q&As (same wording on every card, ids listed below) rule:
//  A the tamer really evolves (digivolve triggers fire) unless "digimon cannot evolve" applies;  B the evolution draw is made;
//  C a tamer that was placed THIS turn cannot attack after evolving that turn;  D the tamer card is an ordinary source (goes to the trash with the stack);
//  E the digimon does NOT gain the tamer's 【시큐리티】 text;  F it DOES gain the tamer's source (inherited) effect.
import { runScenarios, FILL, S, E, C, fillOf, world } from './lib-r2.mjs';
const L = [];
const T = (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, allowErrors: true, ...extra });
const all = Object.values(S.CARDS);
const CARDS = [ // [card, colour of the tamer, Q ids A,B,C,D,E,F]
  ['BT12-024', 'blue', 2151, 2152, 2153, 2154, 2155, 2156], ['BT12-025', 'blue', 2158, 2159, 2160, 2161, 2162, 2163],
  ['BT12-065', 'black', 2190, 2191, 2192, 2193, 2194, 2195], ['BT12-066', 'black', 2200, 2201, 2202, 2203, 2204, 2205],
  ['BT17-011', 'red', 2723, 2725, 2726, 2727], ['BT17-012', 'red', 2732, 2734, 2735, 2736],
  ['BT17-022', 'yellow', 2754, 2756, 2757, 2758], ['BT17-023', 'yellow', 2763, 2765, 2766, 2767]];
const tam = (col, pred) => all.find(c => c.category === 'tamer' && c.colors.length === 1 && c.colors[0] === col && pred(c))?.id;
const anyTamer = (col) => tam(col, (c) => !/【시큐리티】/.test(c.inheritedKo || '') && !(c.effectKo || '').trim() && c.cost != null) || tam(col, () => true);
const secTamer = (col) => tam(col, (c) => /【시큐리티】/.test(c.inheritedKo || ''));
const atkTamer = (col) => tam(col, (c) => /【어택 시】/.test(c.inheritedKo || '') && !/【시큐리티】/.test(c.inheritedKo || ''));
const evolveTamer = (W, tamerId, card, opts = {}) => { const t = W.put('p1', tamerId, opts); W.hand('p1', [card]); W.t = t; const rs = S.evolveTargetRestriction(W.st, 'p1', t); W.methods = E.evolutionMethods(t.cardId, card, [], rs, { state: W.st, p: 'p1', stack: t }); W.h0 = W.pl('p1').hand.length; W.dk0 = W.pl('p1').deck.length; return t; };
for (const [card, col, qA, qB, qC, qD, qE, qF] of CARDS) {
  const tid = anyTamer(col);
  T(qA, card, 'tamer is offered as a Lv.3 digimon and evolving fires 「digivolved」 triggers', async (W) => { evolveTamer(W, tid, card); W.opts = W.methods.some(m => m.id === 'tamer-as-digimon'); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); }, (W) => [['method offered', W.opts], ['evolved', W.r?.cardId === card], ['tamer card is now a source', W.r?.sources.includes(tid)]]);
  T(qA, card, '「digimon cannot evolve」 blocks the tamer route too', async (W) => { W.put('p2', 'BT13-007'); const t = W.put('p1', tid); (S.hookEvolveBan || (() => 0)); W.hand('p1', [card]); const stk = t; stk.s1NoEvolve = true; W.rs = S.evolveTargetRestriction(W.st, 'p1', stk); W.m = E.evolutionMethods(stk.cardId, card, [], { cannotEvolve: true }, { state: W.st, p: 'p1', stack: stk }); }, (W) => [['no tamer-as-digimon method under a cannot-evolve restriction', !W.m.some(m => m.id === 'tamer-as-digimon')]]);
  T(qB, card, 'evolution draw is made', async (W) => { W.pl('p1').deck = FILL.slice(26, 40); evolveTamer(W, tid, card); S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); }, (W) => [['deck shrank by the evolution draw', W.pl('p1').deck.length <= W.dk0 - 1]]);
  T(qC, card, 'a tamer placed this turn: the evolved digimon cannot attack this turn', async (W) => { evolveTamer(W, tid, card, { fresh: true }); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); W.d = S.declareAttack(W.st, 'p1', W.r.uid, {}); }, (W) => [['attack refused', W.d.ok === false]]);
  T(qC, card, 'control: a tamer from an earlier turn can attack after evolving', async (W) => { evolveTamer(W, tid, card); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); W.d = S.declareAttack(W.st, 'p1', W.r.uid, {}); }, (W) => [['attack allowed', W.d.ok === true]]);
  T(qD, card, 'the tamer under it is discarded with the stack like any source', async (W) => { evolveTamer(W, tid, card); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); W.tr0 = W.pl('p1').trash.length; S.deleteStack(W.st, 'p1', W.r.uid, 'trash', 'ownEffect'); await W.drain(); }, (W) => [['tamer card in trash', W.pl('p1').trash.includes(tid)]]);
  if (qE) {
    const st = secTamer(col), at = atkTamer(col);
    T(qE, card, 'the digimon does not gain the tamer\'s 【시큐리티】 text (nothing queued with that tag)', async (W) => { evolveTamer(W, st, card); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); W.q0 = W.st.pending.length; S.queueTriggersForStack(W.st, 'p1', W.r, 'attack'); }, (W) => [['no security-tag effect queued', !W.st.pending.slice(W.q0).some(x => (x.tags || []).includes('시큐리티'))]]);
    T(qF, card, 'the digimon does gain the tamer\'s source effect (【어택 시】 fires from it)', async (W) => { evolveTamer(W, at, card); W.r = S.digivolve(W.st, 'p1', W.t.uid, card, 0, 'hand'); await W.drain(); W.r.attackEligibleTurn = 0; W.o = W.put('p2', 'ST1-05', { suspended: true }); W.resolved.length = 0; await W.attack('p1', W.r.uid, null); }, (W) => [['source tamer trigger resolved', !at || W.resolved.some(x => x.cardId === at)]]);
  }
}
await runScenarios(L, 'r2-tamerevo');
