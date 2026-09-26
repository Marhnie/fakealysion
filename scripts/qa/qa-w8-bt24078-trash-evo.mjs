// W8 recheck (Q5656-5658, 5775 BT24-078 マオウモンX抗体 [트래시]【자신의 턴】): the evolution is the COST of "…진화시키는 것으로, 상대의 시큐리티를 위에서 1장 파기한다".
// The generic compile made it a manualCost -> the attacker never evolved but the security was discarded anyway. Now: evolve (evolution draw included, deck 0 does not undo it), then discard.
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, zoneNames } from './lib5.mjs';
const lv3 = fillerLv(3);
const atk = async (st, h) => { st.pending.length = 0; S.queueTriggersForStack(st, 'p1', h, 'attack'); S.emitGameEvent(st, 'attack', { owner: 'p1', stack: h, cause: null }); };
const board = (deck, oppTrash = 11) => newBoard({ p1: { battle: ['EX10-009'], trash: ['BT24-078'], deck }, p2: { battle: [lv3[0]], trash: F3.slice(0, oppTrash), security: F3.slice(10, 15) }, memory: 3, active: 'p1' });
await scenario('5656/5657', 'attack of 「마왕몬」: evolves into BT24-078 from the trash (with evolution draw), THEN discards opp security; the attacker\'s own 【어택 시】 is dropped', async (chk) => {
  const st = board(lv3.slice(20, 25)); const h = st.players.p1.battle[0]; await atk(st, h);
  st.pending.sort((a, b) => (a.cardId === 'BT24-078' ? 0 : 1) - (b.cardId === 'BT24-078' ? 0 : 1)); // the player resolves the trash effect first (simultaneous triggers: free order)
  const hand0 = st.players.p1.hand.length, sec0 = st.players.p2.security.length;
  const ran = await drain(st, mkChoose(st));
  chk(h.cardId === 'BT24-078', 'attacker evolved: ' + h.cardId);
  chk(st.players.p1.hand.length === hand0 + 1, 'evolution draw happened');
  chk(st.players.p2.security.length === sec0 - 1, 'opp security -1: ' + sec0 + ' -> ' + st.players.p2.security.length);
  chk(!ran.some(x => /^EX10-009/.test(x) && !/SKIP|LEFT/.test(x)), 'EX10-009 pending must not run after the evolution: ' + ran.join(' ; '));
});
await scenario('5658', 'deck empty (no evolution draw): the evolution still counts as the cost -> security is discarded', async (chk) => {
  const st = board([]); st.players.p1.deck.length = 0; const h = st.players.p1.battle[0]; await atk(st, h);
  const sec0 = st.players.p2.security.length; await drain(st, mkChoose(st));
  chk(h.cardId === 'BT24-078' && st.players.p2.security.length === sec0 - 1, 'evolved ' + h.cardId + ', opp security ' + sec0 + ' -> ' + st.players.p2.security.length);
});
await scenario('5401-family', 'opp trash < 10: nothing happens (no evolution, no discard)', async (chk) => {
  const st = board(lv3.slice(20, 25), 5); const h = st.players.p1.battle[0]; await atk(st, h);
  const sec0 = st.players.p2.security.length; await drain(st, mkChoose(st));
  chk(h.cardId === 'EX10-009' && st.players.p2.security.length === sec0, 'unchanged');
});
await scenario('5775', 'BT24-078 that reaches the trash AFTER the attack was declared does not trigger', async (chk) => {
  const st = newBoard({ p1: { battle: ['EX10-009'], trash: [], deck: lv3.slice(20, 25) }, p2: { battle: [lv3[0]], trash: F3.slice(0, 11), security: F3.slice(10, 15) }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; await atk(st, h);
  st.players.p1.trash.push('BT24-078');
  st.pending = st.pending.filter(t => t.cardId === 'BT24-078');
  chk(st.pending.length === 0, 'no BT24-078 pending queued');
});
report();
