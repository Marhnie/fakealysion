// Slice-5 round 2: "효과를 받지 않는다" rulings that repeat across BT23-059/BT23-032/EX11-074 ... (42 Q ids):
// Q5325-family: an immune digimon can still be picked as an effect target (nothing happens to it); Q5326: effects/keywords can be granted to it but stay inactive;
// Q5327: gaining immunity after the grant makes the grant stop applying; Q5328: losing immunity later makes the recorded grant apply; Q5329: a granted triggered effect does not trigger while it is immune.
import { S, E, Fx, newBoard, stk, mkChoose, scenario, report, F3, fillerLv } from './lib5.mjs';
const S2 = await import('../../src/cards/shard2.js');
const F = F3[0];
const fx = (st, player, category, fn) => { const prev = st._fxSrc; st._fxSrc = { player, category, cardId: F }; try { return fn(); } finally { st._fxSrc = prev; } };
const shield = (st, p, s) => S.grantShield(st, p, s.uid, { kinds: ['all'] });
const ids = { pick: [5325,5766,5898,5950,6068,6089,6176,6273,6352], grant: [5326,5767,5899,5951,6069,6090,6177,6274,6353], gain: [5327,5768,5900,5952,6070,6091,6178,6275], lose: [5328,5769,5901,5953,6071,6092,6179,6276], trig: [5329,5770,5902,5954,6072,6093,6180,6277] };
await scenario(ids.pick.join(','), 'immune digimon is still offered as a target of "상대의 디지몬 1마리" effects, and nothing happens to it', async (chk) => {
  const st = newBoard({ p1: { battle: [F] }, p2: { battle: [F3[1]] } }); const b = stk(st, 'p2', F3[1]); shield(st, 'p2', b);
  let offered = null;
  const ch = mkChoose(st, { answer: (k, o) => { if (k === 'pickStack') { offered = o.uids.slice(); return o.uids[0]; } } });
  const a = stk(st, 'p1', F);
  await Fx.runScript([{ op: 'modifyDP', target: 'opponent', amount: -2000, duration: 'turn' }], { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: F, sourceStackUid: a.uid, choose: ch, trigger: { text: 't', tags: ['등장 시'] }, startAttack() {} });
  chk(offered && offered.includes(b.uid), 'immune digimon must be offered'); chk(S.effectiveDP(st, 'p2', b) === S.card(F3[1]).dp, 'DP unchanged');
});
await scenario(ids.grant.join(','), 'keyword can be granted to an immune digimon but is inactive while immune', async (chk) => {
  const st = newBoard({ p1: { battle: [F] }, p2: { battle: [F3[1]] } }); const b = stk(st, 'p2', F3[1]); shield(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => S.grantKeyword(st, 'p2', b.uid, '블로커', undefined, 'turn'));
  chk(!S.hasKeyword(b, '블로커'), 'inactive while immune'); chk((b.deferred || []).length === 1, 'grant recorded');
});
await scenario(ids.gain.join(','), 'grant given first, immunity gained afterwards: the grant stops applying', async (chk) => {
  const st = newBoard({ p1: { battle: [F] }, p2: { battle: [F3[1]] } }); const b = stk(st, 'p2', F3[1]);
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', b.uid, -2000, 'turn'));
  const base = S.card(F3[1]).dp; chk(S.effectiveDP(st, 'p2', b) === base - 2000, 'applied before immunity');
  shield(st, 'p2', b); chk(S.effectiveDP(st, 'p2', b) === base, 'not applied once immune');
});
await scenario(ids.lose.join(','), 'grant recorded while immune applies from the moment immunity ends', async (chk) => {
  const st = newBoard({ p1: { battle: [F] }, p2: { battle: [F3[1]] } }); const b = stk(st, 'p2', F3[1]); shield(st, 'p2', b);
  fx(st, 'p1', 'digimon', () => S.modifyDP(st, 'p2', b.uid, -2000, 'turn'));
  const base = S.card(F3[1]).dp; chk(S.effectiveDP(st, 'p2', b) === base, 'inactive'); b.shields = [];
  chk(S.effectiveDP(st, 'p2', b) === base - 2000, 'applies after immunity ends');
});
await scenario(ids.trig.join(','), 'a granted triggered effect does not trigger while the holder is immune (and does once immunity ends)', async (chk) => {
  const st = newBoard({ p1: { battle: [F] }, p2: { battle: [F3[1]] } }); const b = stk(st, 'p2', F3[1]);
  fx(st, 'p1', 'digimon', () => S2.grantEffect(st, b, { trigger: 'attack', label: 'granted', until: st.turnNumber + 1 }));
  shield(st, 'p2', b); st.pending.length = 0;
  S.queueTriggersForStack(st, 'p2', b, 'attack'); chk(!st.pending.some(t => !t.resolved && t.cardId === 'S2-GRANT'), 'must not trigger while immune');
  b.shields = []; S.queueTriggersForStack(st, 'p2', b, 'attack'); chk(st.pending.some(t => !t.resolved && t.cardId === 'S2-GRANT'), 'triggers once no longer immune');
});
report();
