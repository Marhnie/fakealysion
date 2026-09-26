// W6 recheck2 (Q&A idx 3335-4001): batch B — promo (P-xxx) rulings.
// Run: node scripts/qa/qa-w6-b.mjs < /dev/null
import { S, E, Fx, C, plain, plainTamer, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const devi = all.filter((c) => c.category === 'digimon' && /데블몬/.test(c.nameKo) && c.nameKo !== '단데블몬').slice(0, 6).map((c) => c.id);

scenario('3470-71', 'P-016: only exact-name 디아블로몬 count (self included; X항체/ACE do not)', async () => {
  const w = W({ p1: { battle: ['P-016', 'BT2-082', 'BT24-065', 'P-114'] }, p2: {} });
  w.eq(S.securityAttackBonus(w.p1.stacks[0]), 3, 'P-016 + BT2-082 + P-114 (ACE is a rarity mark, name is 디아블로몬) = 3');
  return w;
});
scenario('3491', 'P-034 소멸 시: trash devimon count includes itself (moved to trash first) -> 단데블몬 playable', async () => {
  const w = W({ p1: { battle: [{ id: plain(3, 0), src: ['P-034'] }], trash: [...devi.slice(0, 5), 'BT4-088'] }, p2: {} });
  w.answers.pickFromZoneIndex = (o) => o.eligibleIdxs[0];
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  console.log('battle after', w.pl('p1').battle.map((s) => s.cardId), w.prompts.map((p) => p.k));
  w.ok(w.pl('p1').battle.some((s) => /^(BT4-088|EX6-055)$/.test(s.cardId)), '단데블몬 played');
  return w;
});
scenario('3506', 'P-047 진화 시: deck has 2 cards -> discard what exists, still +3000 with tamer', async () => {
  const w = W({ p1: { battle: ['P-047', 'RB1-035'], deck: [plain(3, 0), plain(3, 1)] }, p2: {} });
  const d0 = w.dp('p1', w.p1.stacks[0]);
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.pl('p1').deck.length, 0, 'deck emptied');
  w.eq(w.dp('p1', w.p1.stacks[0]) - d0, 3000, 'DP +3000');
  return w;
});
scenario('3512', 'P-052 진화 시: targets fixed at resolution — a target that later gets a source still cannot attack', async () => {
  const w = W({ p1: { battle: ['P-052', 'RB1-035'] }, p2: { battle: [plain(3, 0), plain(3, 1)] }, memory: 3 });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.st.activePlayer = 'p2'; w.st.turnNumber = 4;
  const a = w.p2.stacks[0];
  w.eq(S.declareAttack(w.st, 'p2', a.uid).ok, false, 'blocked at first');
  a.sources.push(plain(3, 3)); S.recomputeStackGrants(a);
  w.eq(S.declareAttack(w.st, 'p2', a.uid).ok, false, 'still blocked after gaining a source');
  return w;
});
scenario('3474', 'P-022: with only one of 엑스브이몬/스팅몬 in hand nothing is returned or played', async () => {
  const w = W({ p1: { battle: ['BT3-093', 'BT3-094'], hand: ['P-022', 'ST9-04', 'ST9-05'] }, p2: {}, memory: 3 });
  await w.useOption('p1', 'P-022');
  w.ok(w.pl('p1').hand.includes('ST9-04'), '엑스브이몬 stays in hand');
  w.ok(!w.pl('p1').battle.some((s) => C(s.cardId).nameKo === '파일드라몬'), '파일드라몬 not played');
  return w;
});
await run('w6-b');
