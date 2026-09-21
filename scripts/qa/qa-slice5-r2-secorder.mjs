// Slice-5 round 2: security-check simultaneous triggers (Q5294 family, 22 Qs): the checked card's 【시큐리티】 effect is handled first, before any
// "시큐리티를 체크했을 때" / "시큐리티가 줄어들었을 때" watcher; watchers resolve afterwards.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, pend } from './lib5.mjs';
const IDS = [5294,5313,5390,5424,5574,5578,5581,5588,5597,5669,5693,5717,5794,5872,5884,6085,6289,6305,6310,6311,6315,6330];
const HOLD = 'BT23-035 BT23-047 BT23-102 ST22-06 BT24-001 BT24-008 BT24-012 BT24-016 BT24-018 BT24-084 BT24-093 BT24-101 EX11-008 EX11-041 EX11-043 AD1-017 BT25-025 BT25-038 BT25-040 BT25-042 BT25-044 BT25-053'.split(' ');
const sec = 'ST22-10';
for (const h of HOLD) {
  await scenario('5294 family', `${h}: with its watchers on board, the 【시큐리티】 effect is queued/handled first`, async (chk) => {
    const c = S.card(h);
    const mk = (asSource) => newBoard({ p1: { battle: c.category === 'digimon' && !asSource ? [h, F3[1]] : [{ id: F3[0], src: [h] }, F3[1]] }, p2: { battle: [], security: [sec, F3[2], F3[3]] } });
    for (const asSource of [false, true]) {
      if (c.category !== 'digimon' && asSource) continue;
      const st = mk(asSource); const a = st.players.p1.battle[0]; a.attackEligibleTurn = 0;
      const d = S.declareAttack(st, 'p1', a.uid); if (!d.ok) { chk(false, 'declare ' + d.reason); continue; }
      S.resolveSecurityCheck(st, 'p1', a.uid, 'p2');
      const un = st.pending.filter(t => !t.resolved);
      chk(un.length >= 1 && un[0].cardId === sec, `first pending must be the 【시큐리티】 effect (src=${asSource}): ${pend(st).join(', ')}`);
    }
  });
}
report();
