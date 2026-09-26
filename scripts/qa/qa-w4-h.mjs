// w4 recheck2 (rulings idx 2001-2667) batch H: continuous / replacement abilities implemented by text hooks. Run: node scripts/qa/qa-w4-h.mjs < /dev/null
import { S, E, Fx, C, plain, W, scenario, run } from './lib-s6.mjs';
const cards = Object.values(S.CARDS);
const named = (n, lv) => cards.find(c => c.category === 'digimon' && c.nameKo.includes(n) && (lv == null || c.level === lv) && c.dp);

scenario('2064s', 'BT17-016 【자신의 턴】: immune to opp effects only while memory is 0 or on the own side (<=0 from opp view)', async () => {
  const mk = (mem) => W({ p1: { battle: [{ id: 'BT17-016' }] }, p2: { battle: [{ id: plain(3, 1) }] }, active: 'p1', memory: mem });
  const wa = mk(0), wb = mk(3);
  const dpA = wa.dp('p1', wa.p1.stacks[0]), dpB = wb.dp('p1', wb.p1.stacks[0]);
  await wa.exec('p2', '턴 종료까지 상대의 디지몬 1마리를 DP -3000.', plain(3, 1), wa.p2.stacks[0].uid, {});
  await wb.exec('p2', '턴 종료까지 상대의 디지몬 1마리를 DP -3000.', plain(3, 1), wb.p2.stacks[0].uid, {});
  wa.eq(wa.dp('p1', wa.p1.stacks[0]), dpA, 'memory 0: immune, DP unchanged');
  wa.eq(wb.dp('p1', wb.p1.stacks[0]), dpB - 3000, 'memory +3 (own side): affected');
  return wa;
});
scenario('2196s', 'BT17-076 【자신의 턴】: +1000 DP per tamer for all own 에오스몬', async () => {
  const eos = cards.find(c => c.category === 'digimon' && c.nameKo === '에오스몬' && c.dp && !(c.effectKo || '').includes('【'));
  const tam = cards.filter(c => c.category === 'tamer' && !/DP/.test((c.effectKo || '') + (c.inheritedKo || '')) && !/【자신의 턴】/.test(c.effectKo || '')).slice(0, 2).map(c => ({ id: c.id }));
  const w = W({ p1: { battle: [{ id: 'BT17-076' }, { id: (eos || named('에오스몬')).id }, ...tam] }, p2: {} });
  const base = C((eos || named('에오스몬')).id).dp;
  w.eq(w.dp('p1', w.p1.stacks[1]), base + 2000, 'other Eosmon +1000 x 2 tamers');
  return w;
});
scenario('2536s', 'BT19-077 (Calumon) 【서로의 턴】: cannot attack or block', async () => {
  const w = W({ p1: { battle: [{ id: 'BT19-077' }] }, p2: { battle: [{ id: plain(3, 1) }] } });
  const r = S.declareAttack(w.st, 'p1', w.p1.stacks[0].uid);
  w.eq(r.ok, false, 'cannot attack: ' + r.reason);
  return w;
});
scenario('2555s', 'EX1-019 inherited: 황제드라몬-named digimon cannot be blocked', async () => {
  const imp = named('황제드라몬', 6);
  const w = W({ p1: { battle: [{ id: imp.id, src: ['EX1-019'] }] }, p2: { battle: [{ id: 'BT16-102' }] } });
  const blk = w.p2.stacks[0];
  w.eq(S.cannotBeBlockedBy(w.st, 'p1', w.p1.stacks[0].uid, blk), true, 'unblockable');
  return w;
});
scenario('2590s', 'BT19-045: evolving into a 로얄 베이스 card costs 1 less (battle area only)', async () => {
  const rb = cards.find(c => c.category === 'digimon' && (c.types || []).includes('로얄 베이스') && c.level === 4);
  const w = W({ p1: { battle: [{ id: 'BT19-045' }], hand: [rb.id] }, p2: {} });
  const d = S.continuousEvoCostDiscount(w.st, 'p1', w.p1.stacks[0], rb.id);
  w.eq(d, -1, 'discount -1');
  const w2 = W({ p1: { raising: { id: 'BT19-045' } }, p2: {} });
  w2.eq(S.continuousEvoCostDiscount(w2.st, 'p1', w2.p1.raising, rb.id) || 0, 0, 'none in breeding area (Q2448)');
  return w;
});
scenario('2228s', 'BT17-092 【서로의 턴】: while own 에오스몬 exists, opp tamers 【등장 시】 does not fire (a 【메인】 tamer effect still does)', async () => {
  const eos = named('에오스몬');
  const otam = cards.find(c => c.category === 'tamer' && /【등장 시】/.test(c.effectKo || '') && /메모리 \+\d|드로우/.test(c.effectKo || ''));
  const w = W({ p1: { battle: [{ id: 'BT17-092' }, { id: eos.id }] }, p2: { hand: [otam.id] }, active: 'p2' });
  const s = S.playDigimonFresh(w.st, 'p2', 0); await w.drain();
  w.eq(w.fires(otam.id, '등장 시'), 0, '등장 시 suppressed (' + otam.id + ')');
  return w;
});
await run('w4-h');
