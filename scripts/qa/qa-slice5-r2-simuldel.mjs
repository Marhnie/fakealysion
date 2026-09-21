// Slice-5 round 2: an inherited "이 디지몬이 배틀에서 상대의 디지몬을 소멸시켰을 때" effect does NOT trigger when both digimon are deleted simultaneously (tie battle) (Q5306 family: 9 Q ids).
import { S, E, newBoard, stk, mkChoose, scenario, report, F3, fillerLv } from './lib5.mjs';
const strong = fillerLv(6)[0], weak = fillerLv(3)[0];
const trigs = (st, h) => st.pending.filter(t => !t.resolved && t.cardId === h).length;
for (const h of ['BT23-044', 'BT24-044', 'BT24-047', 'BT24-048', 'BT24-049', 'EX11-033', 'BT25-015']) {
  await scenario('5306 family', `${h}: simultaneous deletion (tie) -> the source effect does not trigger; a clean win does`, async (chk) => {
    const mk = (a, d) => newBoard({ turn: 3, memory: 5, active: S.card(h).inheritedKo?.includes('자신의 턴') ? 'p1' : 'p1', p1: { battle: [{ id: a, src: [h] }] }, p2: { battle: [d], security: [F3[2], F3[3]] } });
    let st = mk(weak, weak); let a = st.players.p1.battle[0]; a.attackEligibleTurn = 0; S.declareAttack(st, 'p1', a.uid); st.pending.length = 0;
    const r = S.resolveDigimonBattle(st, 'p1', a.uid, st.players.p2.battle[0].uid); chk(r && r.result === 'tie', 'tie: ' + JSON.stringify(r && r.result));
    chk(trigs(st, h) === 0, `tie: trigger ${trigs(st, h)} want 0`);
    st = mk(strong, weak); a = st.players.p1.battle[0]; a.attackEligibleTurn = 0; S.declareAttack(st, 'p1', a.uid); st.pending.length = 0;
    S.resolveDigimonBattle(st, 'p1', a.uid, st.players.p2.battle[0].uid);
    chk(trigs(st, h) >= 1, `win: trigger ${trigs(st, h)} want >=1`);
  });
}
report();
