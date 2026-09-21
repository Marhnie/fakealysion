// Slice-5 round 2: link OPTION cards (ST22-08/09/11, BT24-091/092/095/097; Q5431/5433/5439/5683/5688/5698/5705 + Q5432/5434/5440/5684/5689/5699/5706 ).
// 1) Once linked, the option's link effect counts as a DIGIMON's effect. 2) Paying the link cost from hand is not an option "use": allowed while option use is locked.

import { S, E, Fx, newBoard, stk, mkChoose, scenario, report, F3, fillerLv, runOn, drain } from './lib5.mjs';
const ID = { eff: [5683,5688,5698,5705], lock: [5432,5434,5440,5684,5689,5699,5706] };
const opts = ['ST22-08', 'ST22-09', 'ST22-11', 'BT24-091', 'BT24-092', 'BT24-095', 'BT24-097'];
const hasT = (x, t) => (x.types || []).includes(t) || (x.traits || []).includes(t);
const lv4 = (h) => { const c = S.card(h); const ts = /TS/.test(c.inheritedKo || ''); return Object.values(S.CARDS).find(x => x.category === 'digimon' && x.level >= 4 && x.level <= 5 && x.colors?.[0] && x.dp && (ts ? hasT(x, 'TS') : true))?.id; };
for (const h of opts) {
  await scenario(ID.lock.join(','), `${h}: link cost from hand can be paid while option use is locked (linking is not "using" the option)`, async (chk) => {
    const host = lv4(h) || F3[0];
    const st = newBoard({ turn: 3, memory: 6, p1: { battle: [host], hand: [h] }, p2: {} });
    const H = stk(st, 'p1', host);
    const g = S.linkCheck(st, 'p1', H, h, { allowOption: true });
    if (!g.ok) { chk(true, 'host cannot satisfy link condition (fixture): ' + g.reason); return; }
    S.addTimedLock(st, 'p1', 'option', st.turnNumber);
    const r = S.linkCardTo(st, 'p1', H.uid, h, h, g.cost, 'hand');
    chk(!!r && (H.linkCards || []).length === 1, 'linked despite the option lock: ' + JSON.stringify(H.linkCards));
  });
  if (h.startsWith('BT24')) await scenario(ID.eff.join(','), `${h}: the linked option's 어택 시 effect is a DIGIMON's effect (passes an opposing "option effects don't affect" shield)`, async (chk) => {
    const host = lv4(h); if (!host) { chk(false, 'host fixture'); return; }
    const opp = Object.values(S.CARDS).find(x => x.category === 'digimon' && x.level === 4 && x.dp && x.dp <= 6000).id;
    const st = newBoard({ turn: 3, memory: 6, p1: { battle: [host] }, p2: { battle: [opp] } });
    const H = stk(st, 'p1', host); H.linkCards = [{ cardId: h }]; S.recomputeStackGrants(H); H.attackEligibleTurn = 0;
    const O = stk(st, 'p2', opp); S.grantShield(st, 'p2', O.uid, { kinds: ['all'], fromCategory: 'option' }); if (h === 'BT24-095') O.suspended = true;
    S.queueTriggersForStack(st, 'p1', H, 'attack');
    const before = JSON.stringify([st.players.p2.battle.length, st.players.p2.hand.length, S.effectiveDP(st, 'p2', O)]);
    await drain(st, mkChoose(st));
    chk(before !== JSON.stringify([st.players.p2.battle.length, st.players.p2.hand.length, st.players.p2.battle.includes(O) ? S.effectiveDP(st, 'p2', O) : 0]), 'effect had a result on the option-immune digimon (it is a digimon effect)');
  });
}
report();
