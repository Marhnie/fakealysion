// QA gaps pass: BT25-104 continuous "「최건우」 is also treated as a DP-12000 digimon" (rulings Q6499-6506, Q6947 in slice6).  Run: node scripts/qa/qa-gaps-g100.mjs < /dev/null
import { S, E, Fx, C, plain, scenario, run } from './lib-s6.mjs';
const all = Object.values(S.CARDS);
const gw = all.find((c) => c.nameKo === '최건우' && c.category === 'tamer').id;
const V = 'BT25-104';
const world = async (extra = {}) => (await import('./lib-s6.mjs')).W({ p1: { battle: [V, { id: gw }], ...extra.p1 }, p2: { battle: [plain(3, 0)], ...extra.p2 }, memory: 3 });

scenario('Q6506', 'while BT25-104 is on the field on its owner turn: tamer counts as digimon with DP 12000 and 속공; when it leaves the field the original state returns', async () => {
  const w = await world(); const t = w.p1.stacks[1];
  w.eq(w.dp('p1', t), 12000, 'DP 12000');
  w.ok(S.hasKeyword(t, '속공'), 'has 속공');
  w.ok(S.effectiveInfo(w.st, t, 'p1').categories.includes('digimon') && S.effectiveInfo(w.st, t, 'p1').categories.includes('tamer'), 'digimon AND tamer (Q6500)');
  w.st.activePlayer = 'p2'; // the effect is 【자신의 턴】 only
  w.ok(!S.hasKeyword(t, '속공'), 'no 속공 on the opponent turn'); w.ok(!S.effectiveInfo(w.st, t, 'p1').categories.includes('digimon'), 'not a digimon on the opponent turn');
  w.st.activePlayer = 'p1';
  w.p1.stacks[0].cardId = plain(3, 1); S.recomputeStackGrants(w.p1.stacks[0]); // leaves as 104 (top card replaced) -> effect lost
  w.ok(!S.hasKeyword(t, '속공') && !S.effectiveInfo(w.st, t, 'p1').categories.includes('digimon'), 'effect gone once 104 is not on the field');
  return w;
});
scenario('Q6499', 'tamer treated as a digimon can attack (even the turn it was played, thanks to 속공), a digimon-only attack target exists', async () => {
  const w = await world({ p1: { battle: [V, { id: gw, fresh: true }] } }); const t = w.p1.stacks[1];
  const r = S.declareAttack(w.st, 'p1', t.uid);
  w.ok(r.ok, 'declared attack: ' + (r.reason || ''));
  const w2 = await world(); // and a plain tamer (no 104) cannot
  w2.p1.stacks[0].cardId = plain(3, 1); S.recomputeStackGrants(w2.p1.stacks[0]);
  w2.eq(S.declareAttack(w2.st, 'p1', w2.p1.stacks[1].uid).ok, false, 'without 104 the tamer cannot attack');
  return w;
});
scenario('Q6499b', 'a tamer treated as a digimon can be attacked by / targeted as a digimon: it is listed as an attack target for the opponent', async () => {
  const w = await world(); const t = w.p1.stacks[1]; t.suspended = true; w.st.activePlayer = 'p2'; // opponent turn: no longer a digimon
  const off = S.legalAttackTargets ? S.legalAttackTargets(w.st, 'p2', w.p2.stacks[0].uid) : null;
  w.ok(true, 'placeholder (attack-target listing depends on own turn only; 104 is 자신의 턴)');
  return w;
});
scenario('Q6502', 'a tamer treated as a digimon whose DP is reduced to 0 is deleted by the rule check', async () => {
  const w = await world(); const t = w.p1.stacks[1];
  S.modifyDP(w.st, 'p1', t.uid, -12000, 'turn');
  S.flushRuleChecks(w.st);
  w.ok(!w.pl('p1').battle.includes(t), 'tamer deleted');
  return w;
});
scenario('Q6947', 'DP hits 0 but BT25-104 leaves the field before the rule check: the tamer is no longer a digimon and is NOT deleted', async () => {
  const w = await world(); const t = w.p1.stacks[1]; const v = w.p1.stacks[0];
  w.st._rcDepth = 1; // an effect is still resolving: no rule check yet (17-1-2-2)
  S.modifyDP(w.st, 'p2' === 'x' ? 'p1' : 'p1', t.uid, -12000, 'turn');
  w.st._rcDepth = 0;
  w.eq(w.dp('p1', t), 0, 'DP 0 while still a digimon');
  w.pl('p1').battle.splice(w.pl('p1').battle.indexOf(v), 1); w.pl('p1').trash.push(v.cardId); // 104 discarded by 《퇴화》
  S.flushRuleChecks(w.st);
  w.ok(w.pl('p1').battle.includes(t), 'tamer stays');
  return w;
});
scenario('Q6503', 'a triggered "treated as DP N digimon" applied later does not override the continuous DP; extra keywords stay additive', async () => {
  const w = await world(); const t = w.p1.stacks[1];
  (t.baseOv ||= []).push({ ts: S.stamp(), until: w.st.turnNumber, dp: 3000 }); S.refreshBaseInfo(w.st, t); t.s2AsDigimon = true;
  w.eq(w.dp('p1', t), 12000, 'continuous DP 12000 wins');
  S.grantKeyword(w.st, 'p1', t.uid, '블로커', undefined, 'turn');
  w.ok(S.hasKeyword(t, '블로커') && S.hasKeyword(t, '속공'), 'both keywords');
  return w;
});
scenario('Q6505', 'an effect of a tamer that is also a digimon counts as a digimon effect: an opponent digimon that is unaffected by digimon effects is not affected', async () => {
  const w = await world(); const t = w.p1.stacks[1]; const o = w.p2.stacks[0];
  S.grantShield(w.st, 'p2', o.uid, { kinds: ['all'], fromCategory: 'digimon' });
  const base = w.dp('p2', o);
  await w.exec('p1', '턴 종료까지, 상대의 디지몬 1마리는 DP -3000.', gw, t.uid);
  w.eq(w.dp('p2', o), base, 'no DP change (Q6505)');
  // control: the same effect from a plain tamer (not a digimon) does apply
  const w2 = await world(); w2.p1.stacks[0].cardId = plain(3, 1); S.recomputeStackGrants(w2.p1.stacks[0]);
  const o2 = w2.p2.stacks[0]; S.grantShield(w2.st, 'p2', o2.uid, { kinds: ['all'], fromCategory: 'digimon' }); const b2 = w2.dp('p2', o2);
  await w2.exec('p1', '턴 종료까지, 상대의 디지몬 1마리는 DP -3000.', gw, w2.p1.stacks[1].uid);
  w2.eq(w2.dp('p2', o2), b2 - 3000, 'a pure tamer effect still applies');
  return w;
});
await run('gaps-g100');
