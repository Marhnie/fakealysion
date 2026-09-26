// W8 recheck: continuous-tag 「…했을 때」 watchers that had no wiring (found while checking BT18-065 Q6014 / BT24-060 Q5782 neighbours):
//  - BT24-060 / BT20-071 【서로의 턴】 이 디지몬의 진화원에 테이머 카드가 놓였을 때, …  (sourcesAdded with a tamer card)
//  - BT18-065 / BT21-058 (inherited) 【서로의 턴】[턴에 1회] 이 디지몬의 진화원에서 「벰몬」이 덱 아래로 되돌아갔을 때, …  (same event as BT11-065)
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, zoneNames, idByName } from './lib5.mjs';
const lv3 = fillerLv(3);
const bem = idByName('벰몬');
await scenario('5782', 'BT24-060: a tamer card placed under it -> opp digimon rested (then it may attack)', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT24-060', F3[2]] }, p2: { battle: [lv3[0]] }, memory: 3, active: 'p2', turn: 4 }); const h = st.players.p1.battle[0]; st.pending.length = 0;
  S.emitGameEvent(st, 'sourcesAdded', { owner: 'p1', stack: h, cause: 'effect', added: ['BT12-089'], srcPlayer: 'p1' });
  chk(st.pending.some(t => !t.resolved && t.cardId === 'BT24-060'), 'watcher queued');
  await drain(st, mkChoose(st)); chk(st.players.p2.battle[0].suspended === true, 'opp digimon rested');
  const st2 = newBoard({ p1: { battle: ['BT24-060', F3[2]] }, p2: { battle: [lv3[0]] }, memory: 3, active: 'p2', turn: 4 }); st2.pending.length = 0;
  S.emitGameEvent(st2, 'sourcesAdded', { owner: 'p1', stack: st2.players.p1.battle[0], cause: 'effect', added: [F3[5]], srcPlayer: 'p1' });
  chk(st2.pending.length === 0, 'a non-tamer source does not trigger');
});
await scenario('watch', 'BT20-071: tamer card under it -> DP<=6000 opp digimon destroyed', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT20-071', F3[2]] }, p2: { battle: [lv3[0]] }, memory: 3, active: 'p2', turn: 4 }); const h = st.players.p1.battle[0]; st.pending.length = 0;
  S.emitGameEvent(st, 'sourcesAdded', { owner: 'p1', stack: h, cause: 'effect', added: ['BT12-089'], srcPlayer: 'p1' });
  await drain(st, mkChoose(st)); chk(st.players.p2.battle.length === 0, 'opp digimon destroyed');
});
for (const [id, check] of [['BT18-065', (st, h) => h.suspended === false], ['BT21-058', (st, h) => st.players.p2.battle.length === 0]]) {
  await scenario('6014-nb', `${id} (inherited): 「벰몬」 returned from the sources to the deck bottom -> its effect`, async (chk) => {
    const st = newBoard({ p1: { battle: [{ id: F3[1], src: [id] }] }, p2: { battle: [lv3[0]] }, memory: 3, active: 'p2', turn: 4 }); const h = st.players.p1.battle[0]; h.suspended = true; st.pending.length = 0;
    S.emitGameEvent(st, 'b4SourceToDeckBottom', { owner: 'p1', stack: h, cause: 'effect', ids: [bem] });
    chk(st.pending.some(t => !t.resolved && t.cardId === id), 'watcher queued');
    await drain(st, mkChoose(st)); chk(check(st, h), 'effect resolved');
  });
}
await scenario('watch', 'linked watchers BT22-035/EX10-016/BT23-022/BT26-086 queue on link; BT19-075 fires when another own digimon is deleted', async (chk) => {
  for (const id of ['BT22-035', 'EX10-016', 'BT23-022', 'BT26-086']) {
    const st = newBoard({ p1: { battle: [id, F3[2]] }, p2: { battle: [lv3[0]] }, memory: 3, active: id === 'BT22-035' || id === 'EX10-016' ? 'p1' : 'p2' }); const h = st.players.p1.battle[0]; st.pending.length = 0;
    S.emitGameEvent(st, 'linked', { owner: 'p1', stack: h, linkCardId: F3[5] });
    chk(st.pending.some(t => !t.resolved && t.cardId === id), id + ' queued');
  }
  const st = newBoard({ p1: { battle: ['BT19-075', F3[2]] }, p2: { battle: [lv3[0]], security: F3.slice(10, 15) }, memory: 3, active: 'p2', turn: 4 }); st.pending.length = 0; st._fxSrc = { player: 'p2' };
  S.deleteStack(st, 'p1', st.players.p1.battle[1].uid, 'trash', 'effect'); const n0 = st.players.p2.security.length; await drain(st, mkChoose(st));
  chk(st.players.p2.security.length === n0 - 1, 'BT19-075 discards opp security');
});
report();
