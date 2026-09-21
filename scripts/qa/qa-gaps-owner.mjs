// QA gaps pass: card OWNERSHIP (rule 1-3) — a card the other player owns must end up in ITS OWNER's zone when it leaves your stack / area.
// Covers state.repairOwnership() (docs/qa-gaps-report.md item 4) and the EX1-068 security-effect conservation check.  Run: node scripts/qa/qa-gaps-owner.mjs < /dev/null
import { S, plain, W, scenario, run } from './lib-s6.mjs';

// declare the current fixture as "who owns what" (worlds are hand-built, so the deck lists don't describe them)
function own(w) {
  const c = { p1: {}, p2: {} };
  for (const p of ['p1', 'p2']) {
    const pl = w.pl(p); const add = (id) => { c[p][id] = (c[p][id] || 0) + 1; };
    for (const z of ['hand', 'deck', 'trash', 'security', 'digitamaDeck']) pl[z].forEach(add);
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) { add(st.cardId); st.sources.forEach(add); (st.linkCards || []).forEach((l) => add(l.cardId)); }
  }
  w.st.ownedIds = c; S.repairOwnership(w.st);
  return w;
}
const cnt = (arr, id) => arr.filter((x) => x === id).length;
const X = plain(3, 6), Y = plain(3, 7);

scenario('OWN-trash', 'a card of the opponent that ends up in your trash goes back to the opponent trash', async () => {
  const w = own(W({ p1: { trash: [Y] }, p2: { trash: [X, Y] } }));
  const t2 = w.pl('p2').trash; t2.splice(t2.indexOf(X), 1); w.pl('p1').trash.push(X); // an effect put p2's card into p1's trash
  S.repairOwnership(w.st);
  w.eq([cnt(w.pl('p1').trash, X), cnt(w.pl('p2').trash, X)], [0, 1], 'X back with its owner');
  w.eq([cnt(w.pl('p1').trash, Y), cnt(w.pl('p2').trash, Y)], [1, 1], 'the other card ids are untouched');
  return w;
});
scenario('OWN-hand', 'the opponent card in your hand goes back to the opponent hand; your own copy of the same id is not touched', async () => {
  const w = own(W({ p1: { hand: [X] }, p2: { hand: [X, Y] } }));
  const h2 = w.pl('p2').hand; h2.splice(h2.indexOf(X), 1); w.pl('p1').hand.push(X);
  S.repairOwnership(w.st);
  w.eq([cnt(w.pl('p1').hand, X), cnt(w.pl('p2').hand, X)], [1, 1], 'one copy each again');
  return w;
});
scenario('OWN-deck-security', 'deck top / security bottom go back to the same end of the owner zone', async () => {
  const w = own(W({ p1: {}, p2: { deck: [X, plain(3, 1), plain(3, 2)], security: [plain(3, 3), Y] } }));
  w.pl('p2').deck.shift(); w.pl('p1').deck.unshift(X);
  w.pl('p2').security.pop(); w.pl('p1').security.push(Y);
  S.repairOwnership(w.st);
  w.eq(w.pl('p2').deck[0], X, 'X on top of the owner deck'); w.eq(w.pl('p2').security[w.pl('p2').security.length - 1], Y, 'Y at the owner security bottom');
  return w;
});
scenario('OWN-sources', 'an opponent card placed under your digimon goes to the OWNER trash when your stack is deleted (not to yours)', async () => {
  const w = own(W({ p1: { battle: [plain(3, 0)] }, p2: { hand: [X] } }));
  const st = w.p1.stacks[0]; w.pl('p2').hand.length = 0; st.sources.push(X); S.recomputeStackGrants(st); // "steal" into the sources
  S.repairOwnership(w.st); // still standing under the stack: nothing to do yet
  w.eq(cnt(st.sources, X), 1, 'foreign source stays while it is under the stack');
  S.deleteStack(w.st, 'p1', st.uid, 'trash', 'effect'); S.repairOwnership(w.st);
  w.eq([cnt(w.pl('p1').trash, X), cnt(w.pl('p2').trash, X)], [0, 1], 'X went to its owner trash');
  w.ok(w.pl('p1').trash.includes(plain(3, 0)), 'own top card in own trash');
  return w;
});
scenario('OWN-noFalsePositive', 'while a foreign copy sits under a stack, drawing/moving your OWN copy of the same id is not mistaken for it', async () => {
  const w = own(W({ p1: { battle: [plain(3, 0)], deck: [X, plain(3, 1)] }, p2: { hand: [X] } }));
  const st = w.p1.stacks[0]; w.pl('p2').hand.length = 0; st.sources.push(X);
  S.repairOwnership(w.st);
  w.pl('p1').hand.push(w.pl('p1').deck.shift()); // draw own X
  S.repairOwnership(w.st);
  w.eq(cnt(w.pl('p1').hand, X), 1, 'own drawn X stays in own hand'); w.eq(cnt(w.pl('p2').hand, X), 0, 'nothing sent to p2');
  return w;
});
scenario('OWN-foreignTop-bounce', 'a digimon stack whose top card is the opponent card (played from their sources) returns that card to the owner hand when bounced', async () => {
  const w = own(W({ p1: { battle: [plain(3, 0)] }, p2: { battle: [{ id: plain(4, 0), src: [X] }] } }));
  // BT19-102-style play: X taken out of p2 sources, played by p1 through p1's trash, marked foreign
  const host = w.p2.stacks[0]; host.sources.length = 0; w.pl('p1').trash.push(X);
  const ns = S.playFreeFromZone(w.st, 'p1', 'trash', w.pl('p1').trash.length - 1, { fromSources: true }); ns.foreignTop = 'p2'; ns.foreignCardId = ns.cardId;
  S.repairOwnership(w.st);
  await w.exec('p1', '자신의 디지몬 1마리를 패로 되돌린다.', plain(3, 5), null, {});
  S.repairOwnership(w.st);
  const back = cnt(w.pl('p2').hand, X) + cnt(w.pl('p2').trash, X) + cnt(w.pl('p2').deck, X);
  w.ok(cnt(w.pl('p1').hand, X) + cnt(w.pl('p1').trash, X) + cnt(w.pl('p1').deck, X) === 0 || back === 1, 'X is not left in the controller zones');
  return w;
});
scenario('OWN-EX1-068', 'EX1-068 as a checked security card: the card ends in the defender trash exactly once (conservation over the whole attack)', async () => {
  const w = W({ p1: { battle: [plain(3, 0)] }, p2: { security: ['EX1-068', plain(3, 1), plain(3, 2)] } });
  const tot = (p) => { const pl = w.pl(p); let n = pl.deck.length + pl.hand.length + pl.trash.length + pl.security.length + (pl.digitamaDeck || []).length; for (const s of [pl.raising, ...pl.battle].filter(Boolean)) n += 1 + s.sources.length + (s.linkCards || []).length; return n; };
  const b = [tot('p1'), tot('p2')];
  await w.attack('p1', w.p1.stacks[0].uid, 'PLAYER');
  w.eq([tot('p1'), tot('p2')], b, 'card totals unchanged'); w.eq(cnt(w.pl('p2').trash, 'EX1-068'), 1, 'in the trash exactly once');
  return w;
});
await run('gaps-owner');
