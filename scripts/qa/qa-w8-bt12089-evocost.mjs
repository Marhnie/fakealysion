// W8 recheck (Q6066 AD1-008 デュークモン via BT12-089 オユミン 【메인】): "Lv.을 무시하고 진화" uses the printed cost of the satisfied condition
// (Lv.5 「히어로」: 코스트 3), not the normal-line cost 4 — shard2.evoInfo now passes ignoreLevel into the evolution-condition check.
import { S, E, newBoard, stk, mkChoose, Fx, scenario, report, F3, idByName, scriptFor, ctxFor } from './lib5.mjs';
await scenario('6066', 'BT12-089 main: hero 길몬 -> 듀크몬 costs 3 (memory 3 -> 0)', async (chk) => {
  const gil = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo === '길몬' && (c.types || []).includes('히어로')).id;
  const st = newBoard({ p1: { battle: ['BT12-089', gil], hand: ['AD1-008'], trash: [idByName('그라우몬'), idByName('메가로그라우몬')] }, p2: { battle: [F3[0]] }, memory: 3 });
  const seg = S.parseEffectSegments(S.card('BT12-089').effectKo).segments.find(s => s.tags.includes('메인'));
  const h = stk(st, 'p1', 'BT12-089'); const t = { player: 'p1', cardId: 'BT12-089', stackUid: h.uid, topId: h.cardId, tags: seg.tags, text: seg.body };
  await Fx.runScript(scriptFor(t), ctxFor(st, t, mkChoose(st)));
  chk(st.players.p1.battle.some(s => s.cardId === 'AD1-008'), 'evolved into 듀크몬');
  chk(st.memory === 0, 'memory must be 0 (cost 3), got ' + st.memory);
});
await scenario('5603/5604', 'BT24-025 【자신의 턴】: Lv. ignored -> 베누스몬 BT24-040 evolves for the cheaper matching condition (「TS」 Lv.5: 코스트 3, memory 5 -> 2); BT10-042 (no matching condition) is refused', async (chk) => {
  const seg = S.parseEffectSegments(S.card('BT24-025').effectKo).segments.find(s => s.tags.includes('자신의 턴'));
  for (const [hand, want] of [[['BT10-042'], null], [['BT24-040'], 2]]) {
    const st = newBoard({ p1: { battle: ['BT24-025', F3[2]], hand }, p2: { battle: [F3[0]] }, memory: 5 });
    const h = stk(st, 'p1', 'BT24-025'); const t = { player: 'p1', cardId: 'BT24-025', stackUid: h.uid, topId: h.cardId, tags: seg.tags, text: seg.body };
    await Fx.runScript(scriptFor(t), ctxFor(st, t, mkChoose(st)));
    if (want == null) chk(st.players.p1.battle.every(s => s.cardId !== 'BT10-042') && st.memory === 5, 'BT10-042 must not be usable: memory ' + st.memory);
    else chk(st.players.p1.battle.some(s => s.cardId === 'BT24-040') && st.memory === want, 'BT24-040 for cost 3: memory ' + st.memory);
  }
});
report();
