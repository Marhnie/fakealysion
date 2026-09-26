// Unresolved-A (1): EX2-007 (Digi-Egg with DP standing in the battle area) is a Digimon for generic "디지몬" pickers
// (rulings 3280/3281/3285, 1198/1265/2402/3558 bounce -> digi-egg deck bottom, 1270/3284 security -> digi-egg deck bottom).
// Run: node scripts/qa/qa-unres-a-ex2007.mjs < /dev/null
import { S, W, plain, scenario, run } from './lib-s6.mjs';

const pickEgg = (w) => { const f = (o) => (o.uids || []).find(u => w.find('p1', u)?.cardId === 'EX2-007') ?? undefined; w.answers.pickStack = (o) => f(o) ?? o.uids?.[0]; w.answers.pickStackAnySide = (o) => { const e = o.entries.find(x => w.find(x.player, x.uid)?.cardId === 'EX2-007'); return e ? { player: e.player, uid: e.uid } : null; }; };
const cardsOf = (w, p = 'p1') => w.pl(p).battle.map(s => s.cardId);
scenario('U1a', 'generic 「자신의 디지몬 1마리를 소멸」 can pick the Digi-Egg (Q3281)', async () => {
  const w = W({ p1: { battle: ['EX2-007'] }, p2: {} });
  await w.exec('p1', '자신의 디지몬 1마리를 소멸시킨다.', plain(3, 0));
  w.eq(cardsOf(w), [], 'EX2-007 destroyed');
  w.ok(w.pl('p1').trash.includes('EX2-007'), 'in trash');
  return w;
});
scenario('U1b', 'BT4-031 (Q1198): bounce own EX2-007 -> digi-egg deck bottom, hand does not grow, cost counts as paid', async () => {
  const w = W({ p1: { battle: ['BT4-031', 'EX2-007'] }, p2: { battle: [plain(3, 1)] } });
  pickEgg(w);
  const ds = w.pl('p1').digitamaDeck.length; let inc = 0; const orig = S.emitGameEvent;
  await w.run('p1', w.p1.stacks[0].uid, '등장 시');
  w.eq(cardsOf(w), ['BT4-031'], 'egg left');
  w.eq(w.pl('p1').hand.length, 0, 'no card in hand');
  w.eq(w.pl('p1').digitamaDeck.length - ds, 1, 'digi-egg deck +1');
  w.eq(w.pl('p2').battle.length, 0, 'opp digimon bounced (cost satisfied)');
  return w;
});
scenario('U1c', 'BT4-102 (Q1265): bounce own EX2-007 to satisfy the cost, then bounce an opp Lv.4-', async () => {
  const w = W({ p1: { hand: ['BT4-102'], battle: ['EX2-007', plain(3, 0, { color: 'blue' })] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
  pickEgg(w);
  const ds = w.pl('p1').digitamaDeck.length;
  await w.useOption('p1', 'BT4-102');
  w.ok(!cardsOf(w).includes('EX2-007'), 'own egg left');
  w.eq(w.pl('p1').digitamaDeck.length - ds, 1, 'digi-egg deck +1');
  w.eq(w.pl('p2').battle.length, 0, 'opp digimon bounced');
  return w;
});
scenario('U1d', 'BT4-105 (Q1270/1272/3284): own EX2-007 "on security" goes to the digi-egg deck bottom; security does not increase; no 늘어났을 때 trigger', async () => {
  const w = W({ p1: { hand: ['BT4-105'], battle: ['EX2-007', plain(3, 0, { color: S.card('BT4-105').colors[0] })] }, p2: {}, memory: 10 });
  pickEgg(w);
  const ds = w.pl('p1').digitamaDeck.length, sec = w.pl('p1').security.length;
  await w.useOption('p1', 'BT4-105');
  w.ok(!cardsOf(w).includes('EX2-007'), 'egg left');
  w.eq(w.pl('p1').security.length, sec, 'security unchanged');
  w.eq(w.pl('p1').digitamaDeck.length - ds, 1, 'digi-egg deck +1');
  return w;
});
scenario('U1e', 'opp-side 「상대의 디지몬 1마리를 소멸」 may choose the opp Digi-Egg (Q3285) but 상대의 효과를 받지 않음 keeps it', async () => {
  const w = W({ p1: { battle: [plain(3, 1)] }, p2: { battle: ['EX2-007'] } });
  await w.exec('p1', '상대의 디지몬 1마리를 소멸시킨다.', plain(3, 0));
  w.eq(cardsOf(w, 'p2'), ['EX2-007'], 'immune: still there');
  return w;
});
scenario('U1f', 'a Digi-Egg sent to hand/security by ANY path is redirected before the 늘어났을 때 events fire (emitGameEvent guard)', async () => {
  const w = W({ p1: { battle: [] }, p2: {} });
  const pl = w.pl('p1'); let n = 0;
  pl.security.push('EX2-007'); const ds = pl.digitamaDeck.length; const sec = pl.security.length;
  S.emitGameEvent(w.st, 'securityIncrease', { owner: 'p1', stack: null, cause: 'effect' });
  w.eq(pl.security.length, sec - 1, 'egg removed from security'); w.eq(pl.digitamaDeck.length - ds, 1, 'to digi-egg deck');
  return w;
});
await run('qa-unres-a-ex2007');
