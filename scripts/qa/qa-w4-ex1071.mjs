// w4 recheck2, official Q&A 2609-2615 (EX1-071 「승리율 60%!」): next evolution this turn may discard a hand digimon card of the EVOLVING digimon's colour for evolution cost -4.
// Run: node scripts/qa/qa-w4-ex1071.mjs < /dev/null
import { S, C, plain, W, scenario, run } from './lib-s6.mjs';
const cards = Object.values(S.CARDS);
const mono = (col, lv) => cards.filter(c => c.category === 'digimon' && c.dp && c.level === lv && c.colors.length === 1 && c.colors[0] === col && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim());
const red3 = mono('red', 3)[0].id, red3b = mono('red', 3)[1].id, blue3 = mono('blue', 3)[0].id, red4 = mono('red', 4)[0].id;
const white5 = cards.find(c => c.category === 'digimon' && c.level === 5 && c.colors.length === 1 && c.colors[0] === 'white' && c.evoNormal && c.evoNormal.level === 4 && !(c.effectKo || '').includes('【진화 시】')).id;
const wm = cards.find(c => c.category === 'digimon' && c.dp && c.colors.includes('white') && c.level === 3).id;
const arm = async (w) => { w.pl('p1').hand.push('EX1-071'); const r = await w.useOption('p1', 'EX1-071'); return r; };
const optsFor = (w, stack, target) => S.hookEvoCostOptions(w.st, 'p1', stack, target);

scenario('2609', 'EX1-071: the discarded card matches the colour of the EVOLVING digimon (red), not the card it evolves into (white)', async () => {
  const w = W({ p1: { hand: ['EX1-071', white5, blue3, red3], battle: [{ id: red4 }, { id: wm }] }, p2: {}, memory: 10 });
  w.pl('p1').battle.forEach(s => { s.attackEligibleTurn = 0; });
  await w.useOption('p1', 'EX1-071').catch(() => {});
  const o = optsFor(w, w.p1.stacks[0], white5);
  w.eq(o.length, 1, 'option offered');
  let offered = null;
  const d = await o[0].apply(async (k, p) => { offered = p.eligibleIdxs.map(i => w.pl('p1').hand[i]); return [p.eligibleIdxs[0]]; });
  w.eq(d, -4, 'delta -4');
  w.eq(offered, [red3], 'only the red hand digimon card is eligible (not blue, not the white evolution target)');
  w.ok(w.pl('p1').trash.includes(red3), 'discarded');
  return w;
});
scenario('2610', 'EX1-071: not offered for the digimon in the BREEDING area', async () => {
  const w = W({ p1: { hand: ['EX1-071', white5, red3], battle: [{ id: wm }], raising: { id: red4 } }, p2: {}, memory: 10 });
  await w.useOption('p1', 'EX1-071').catch(() => {});
  w.eq(optsFor(w, w.p1.raising, white5).length, 0, 'no option in the breeding area');
  return w;
});
scenario('2615', 'EX1-071: only the NEXT evolution of the turn: after one evolution the option is gone', async () => {
  const w = W({ p1: { hand: ['EX1-071', white5, red3, red3b], battle: [{ id: red4 }, { id: red4 }, { id: wm }] }, p2: {}, memory: 10 });
  await w.useOption('p1', 'EX1-071').catch(() => {});
  const [a, b] = w.p1.stacks;
  w.eq(optsFor(w, a, white5).length, 1, 'offered before any evolution');
  await w.evolve('p1', a.uid, white5, 0);
  w.eq(optsFor(w, b, white5).length, 0, 'gone after the next evolution');
  return w;
});
await run('w4-ex1071');
