// Slice-6 official Q&A scenarios, part G (cost stacking, stale triggers, tamer evolution, known feature gaps).  G# = group index in scripts/qa/s6/_groups.json.
// Run: node scripts/qa/qa-slice6-g.mjs [G#...] < /dev/null
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);

// ---- Q7002 / Q7077: the played card's own printed cost reduction adds to the effect's reduction ----
scenario('G252', 'BT26-032 evolve effect plays BT25-077 with -5 AND its own -5 (total -10): cost 12 -> 2', async () => {
  const w = W({ p1: { battle: ['BT26-032', plain(6, 0), plain(6, 1)], hand: ['BT25-077'] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'BT25-077'), 'played'); w.eq(w.st.memory, 8, 'cost paid = 2');
  return w;
});
scenario('G274', 'BT26-059 plays BT26-045 with -7 and its own -4 (total -11): cost 11 -> 0', async () => {
  const w = W({ p1: { battle: ['BT26-059'], hand: [plain(3, 1)], trash: ['BT26-045'] }, p2: { hand: [plain(3, 2), plain(3, 3), plain(3, 4)] }, memory: 10 });
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'BT26-045'), 'played'); w.eq(w.st.memory, 10, 'no cost paid');
  return w;
});
// ---- Q6819 / Q6977: a 【소멸 시】 trigger of a digimon whose card left the trash before it resolves cannot be used ----
scenario('G179', 'EX12-047: destroyed digimon\'s 【소멸 시】 effect is lost when the card is returned to the deck first', async () => {
  const w = W({ p1: { battle: ['EX12-047', plain(3, 0)] }, p2: { battle: ['BT25-076'], trash: [plain(3, 4)] } });
  w.answers.pickFromZoneIndex = (o) => { const ids = w.pl('p2').trash; const i = ids.indexOf('BT25-076'); return i >= 0 && (o.eligibleIdxs || []).includes(i) ? i : undefined; };
  const before = w.pl('p1').battle.length;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.ok(!w.pl('p2').trash.includes('BT25-076'), 'the card was returned to the deck'); w.eq(w.pl('p1').battle.length, before, 'no 【소멸 시】 destroy happened');
  return w;
});
// ---- Q6905: evolving from a tamer that entered this turn: the digimon can attack only with 《속공》 ----
scenario('G212', 'AD1-002 (has 《속공》) evolved from a tamer that entered this turn can attack', async () => {
  const hy = all.filter((c) => c.category === 'digimon' && (c.types || []).includes('하이브리드체')).slice(0, 2).map((c) => c.id);
  const w = W({ p1: { battle: [{ id: 'BT7-085', fresh: true, src: hy }], hand: ['AD1-002'] }, p2: {}, memory: 10 });
  const t = w.p1.stacks[0];
  await w.evolve('p1', t.uid, 'AD1-002', 3);
  w.eq(S.declareAttack(w.st, 'p1', t.uid).ok, true, 'attack allowed by 《속공》');
  return w;
});
// ---- Q7198: BT11-112 cannot use the 【진화 시】 effect of a digimon that has "no evolve effect" ----
scenario('G327', 'BT11-112: another digimon whose evolve effect is suppressed cannot have it activated by the tamer', async () => {
  const v = 'ST8-10';
  const w = W({ p1: { battle: ['BT11-112', v] }, p2: {} });
  const d = w.p1.stacks[1]; d.noEvoTrigUntil = w.st.turnNumber + 1;
  S.restStack(w.st, 'p1', d.uid, 'effect'); await w.drain();
  w.eq(w.fires(v, '진화 시'), 0, 'evolve effect not activated');
  return w;
});
// ---- feature gap: continuous "also treated as a DP12000 digimon" (BT25-104) ----
scenario('G100', 'BT25-104 own-turn effect: the tamer 최건우 is treated as a DP-12000 digimon while it is on the field', async () => {
  const gw = all.find((c) => c.nameKo === '최건우' && c.category === 'tamer').id;
  const w = W({ p1: { battle: ['BT25-104', gw] }, p2: {} });
  const tam = w.p1.stacks[1];
  w.eq(w.dp('p1', tam), 12000, 'DP 12000'); w.ok(S.effectiveInfo(w.st, tam, 'p1').categories.includes('digimon'), 'also a digimon');
  return w;
}, { xfail: 'BT25-104 【자신의 턴】 continuous "「최건우」는 모두 DP 12000의 디지몬으로도 취급하며 《속공》을 얻는다" is not implemented (only the one-shot s2_asDigimon exists); Q6499-6507/6947 groups depend on this feature and are therefore NOT verified.' });
await run('slice6-g');
