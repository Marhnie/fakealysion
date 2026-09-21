// QA gaps pass: the formerly MANUAL "play from evolution sources" effects now scripted (src/cards/shard95.js).  Run: node scripts/qa/qa-gaps-sources.mjs < /dev/null
import { S, plain, W, scenario, run } from './lib-s6.mjs';
const A = Object.values(S.CARDS);
const pickBy = (f, n = 0) => A.filter(f)[n].id;
const rk = (n) => pickBy((c) => c.category === 'digimon' && (c.types || []).includes('로얄 나이츠') && !['오메가몬', '간쿠몬'].includes(c.nameKo), n);
const sister = 'BT6-082';
const tamerA = 'ST1-12';

scenario('BT3-030', 'evolve effect: plays a Lv.4-or-lower digimon card from one of your digimon sources as a NEW digimon, free; Lv.5+ and tamer cards are not offered', async () => {
  const host = plain(4, 0), lo = plain(3, 2), hi = plain(5, 0);
  const w = W({ p1: { battle: ['BT3-030', { id: host, src: [hi, lo, tamerA] }] }, p2: {} });
  const h = w.p1.stacks[1];
  w.answers.pickFromZoneIndex = (o) => o.eligibleIdxs[0];
  const mem = w.st.memory;
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(h.sources, [hi, tamerA], 'only the Lv.3 card left the sources');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === lo && s !== h), 'Lv.3 card is now its own digimon');
  w.eq(w.st.memory, mem, 'no memory paid');
  return w;
});
scenario('BT3-030b', 'no eligible source anywhere: nothing happens', async () => {
  const w = W({ p1: { battle: ['BT3-030', { id: plain(4, 0), src: [plain(5, 0)] }] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.pl('p1').battle.length, 2, 'unchanged');
  return w;
});
scenario('BT13-019', 'plays either a 시스터몬 from the trash or a royal knight (not 오메가몬/간쿠몬) from the RAISING digimon sources', async () => {
  const good = rk(0);
  const omega = 'BT1-084', gank = 'BT6-067';
  const w = W({ p1: { battle: ['BT13-019'], raising: { id: plain(3, 0), src: [omega, gank, good] }, trash: [sister] }, p2: {} });
  let offered = null;
  w.answers.pickFromZoneIndex = (o) => { offered = o.eligibleIdxs.length; return o.eligibleIdxs[o.eligibleIdxs.length - 1]; };
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(offered, 2, 'offered: the 시스터몬 and the one allowed royal knight only');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === good), 'royal knight played from raising sources');
  w.ok(w.p1.raising.sources.includes(omega) && w.p1.raising.sources.includes(gank), 'excluded names stayed');
  return w;
});
scenario('BT13-019b', 'trash option: 시스터몬 played from the trash', async () => {
  const w = W({ p1: { battle: ['BT13-019'], trash: [sister] }, p2: {} });
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === sister) && !w.pl('p1').trash.includes(sister), 'played');
  return w;
});
scenario('BT13-112', 'raising-area branch: one royal knight per distinct name, then the raising digimon is trashed and all your digimon get 속공', async () => {
  const a = rk(0), b = rk(1);
  const w = W({ p1: { battle: ['BT13-112', plain(3, 4)], raising: { id: plain(3, 0), src: [a, a, b] } }, p2: { battle: [plain(3, 1)] } });
  w.answers.confirmEffect = () => false; // not the destroy branch
  w.answers.pickFromZoneIndex = (o) => o.eligibleIdxs[0];
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  const played = w.pl('p1').battle.filter((s) => s.cardId === a || s.cardId === b).length;
  w.eq(played, S.card(a).nameKo === S.card(b).nameKo ? 1 : 2, 'one per distinct name');
  w.eq(w.pl('p1').raising, null, 'raising digimon discarded');
  w.ok(w.pl('p1').battle.every((s) => S.hasKeyword(s, '속공')), 'all own digimon have 속공');
  return w;
});
scenario('BT13-112b', 'destroy branch: deletes one opponent digimon and does NOT discard the raising digimon', async () => {
  const w = W({ p1: { battle: ['BT13-112'], raising: { id: plain(3, 0), src: [rk(0)] } }, p2: { battle: [plain(3, 1)] } });
  w.answers.confirmEffect = () => true;
  await w.run('p1', w.p1.stacks[0].uid, '진화 시');
  w.eq(w.pl('p2').battle.length, 0, 'opponent digimon gone'); w.ok(!!w.pl('p1').raising, 'raising kept');
  return w;
});
scenario('BT2-083', 'when deleted while it had sources it comes back from the trash for free; with no sources it does not', async () => {
  const w = W({ p1: { battle: [{ id: 'BT2-083', src: [plain(3, 0)] }] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'BT2-083'), 'returned');
  const w2 = W({ p1: { battle: ['BT2-083'] }, p2: {} });
  S.deleteStack(w2.st, 'p1', w2.p1.stacks[0].uid, 'trash', 'effect'); await w2.drain();
  w2.ok(!w2.pl('p1').battle.some((s) => s.cardId === 'BT2-083'), 'no sources -> stays in the trash');
  return w2;
});
scenario('BT7-080', '[turn 1] your digimon with a tamer card in its sources is deleted -> a tamer from the trash is played free (once per turn)', async () => {
  const w = W({ p1: { battle: ['BT7-080', { id: plain(3, 1), src: [tamerA] }, { id: plain(3, 2), src: [tamerA] }], trash: ['ST2-12'] }, p2: {} });
  const [, d1, d2] = w.p1.stacks;
  S.deleteStack(w.st, 'p1', d1.uid, 'trash', 'effect'); await w.drain();
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'ST2-12'), 'tamer played from trash');
  w.pl('p1').trash.push('ST3-12');
  S.deleteStack(w.st, 'p1', d2.uid, 'trash', 'effect'); await w.drain();
  w.ok(!w.pl('p1').battle.some((s) => s.cardId === 'ST3-12'), 'second time in the same turn does nothing');
  const w2 = W({ p1: { battle: ['BT7-080', { id: plain(3, 1), src: [plain(3, 3)] }], trash: ['ST2-12'] }, p2: {} });
  S.deleteStack(w2.st, 'p1', w2.p1.stacks[1].uid, 'trash', 'effect'); await w2.drain();
  w2.ok(!w2.pl('p1').battle.some((s) => s.cardId === 'ST2-12'), 'no tamer source -> no trigger');
  return w2;
});
scenario('BT15-057', 'with 워매몬 in its sources this digimon gains the 【소멸 시】 play-from-trash effect', async () => {
  const worm = 'BT14-058';
  const w = W({ p1: { battle: [{ id: 'BT15-057', src: [worm] }], trash: ['BT2-056'] }, p2: {} });
  S.deleteStack(w.st, 'p1', w.p1.stacks[0].uid, 'trash', 'effect'); await w.drain();
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'BT2-056'), '워매몬 played from the trash');
  const w2 = W({ p1: { battle: [{ id: 'BT15-057', src: [plain(3, 0)] }], trash: ['BT2-056'] }, p2: {} });
  S.deleteStack(w2.st, 'p1', w2.p1.stacks[0].uid, 'trash', 'effect'); await w2.drain();
  w2.ok(!w2.pl('p1').battle.some((s) => s.cardId === 'BT2-056'), 'without the source: no effect');
  return w2;
});
scenario('BT19-100', '【시큐리티】: play a 「디·리퍼」 card from hand whose play cost <= number of sources of your 「마더 디·리퍼」', async () => {
  const mother = A.find((c) => c.category === 'digimon' && c.nameKo === '마더 디·리퍼');
  if (!mother) { const w = W({ p1: {}, p2: {} }); w.ok(true, 'no 마더 디·리퍼 digimon card in the DB (skipped)'); return w; }
  const w = W({ p1: { battle: [{ id: mother.id, src: [plain(3, 0), plain(3, 1), plain(3, 2), plain(3, 3)] }], hand: ['P-158'] }, p2: {} });
  await w.runCard('p1', 'BT19-100', '시큐리티', { inherited: true });
  w.ok(w.pl('p1').battle.some((s) => s.cardId === 'P-158'), 'cost-4 디·리퍼 tamer played (4 sources)');
  return w;
});
scenario('BT24-062', 'attack end: plays a machine/cyborg/TS card with play cost <= 5 from its own sources', async () => {
  const src = 'BT5-062', big = 'BT1-084';
  const w = W({ p1: { battle: [{ id: 'BT24-062', src: [big, src] }] }, p2: {} });
  const h = w.p1.stacks[0];
  await w.run('p1', h.uid, '어택 종료 시');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === src), 'played the eligible source'); w.ok(h.sources.includes(big) && !h.sources.includes(src), 'the other one stayed');
  return w;
});
scenario('BT24-060', 'inherited: a 디지대/시커즈 digimon that would leave the battle area stays, and a 디지대/시커즈 tamer from the holder sources is played instead', async () => {
  const tam = 'BT14-086', dg = 'BT14-056';
  const w = W({ p1: { battle: [{ id: plain(4, 0), src: ['BT24-060', tam] }, dg] }, p2: {} });
  const target = w.p1.stacks[1];
  w.answers.confirmEffect = () => true;
  S.deleteStack(w.st, 'p1', target.uid, 'trash', 'effect'); await w.drain();
  w.ok(w.pl('p1').battle.includes(target), 'target stayed on the field');
  w.ok(w.pl('p1').battle.some((s) => s.cardId === tam), 'tamer played from the sources');
  return w;
});
await run('gaps-sources');
