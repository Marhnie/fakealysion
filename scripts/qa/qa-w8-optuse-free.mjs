// W8 recheck (Q5449-5518 family, "옵션 카드를 사용했을 때" also fires when an option is used FOR FREE by an effect):
// every free-use path must emit optionUsed (ST22-07 tamer-under use, BT16-014, P-027, EX2-060). Holder = ST22-06 (own-side optionUsed trigger).
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, nm, runOn, idByName } from './lib5.mjs';
const sawHolder = (ran) => ran.some(x => /^ST22-06/.test(x));
await scenario('5430', 'ST22-07 【자신의 턴】: option used from under the tamer counts as a use -> ST22-06 triggers', async (chk) => {
  const opt = Object.values(S.CARDS).find(c => c.category === 'option' && (c.types || []).includes('플러그인') && (c.cost || 0) <= 3 && (c.cost || 0) >= 1)?.id;
  const st = newBoard({ p1: { battle: ['ST22-04', 'ST22-07', 'ST22-06'] }, p2: { battle: [F3[0]] }, memory: 3 });
  const tam = stk(st, 'p1', 'ST22-07'); tam.sources.push(opt);
  S.emitGameEvent(st, 'attack', { owner: 'p1', stack: stk(st, 'p1', 'ST22-04'), cause: null });
  const ran = await drain(st, mkChoose(st));
  chk(ran.some(x => /^ST22-07/.test(x)), 'ST22-07 effect ran: ' + ran.join(' ; '));
  chk(sawHolder(ran), 'ST22-06 optionUsed trigger must fire after the tamer-under use: ' + ran.join(' ; '));
  chk(!tam.sources.includes(opt), 'option left the tamer');
});
await scenario('5449', 'BT16-014 【진화 시】 free option use -> optionUsed', async (chk) => {
  const godf = idByName('갓 플레임');
  const st = newBoard({ p1: { battle: ['BT16-014', 'ST22-06'], hand: [godf] }, p2: { battle: [F3[0]] }, memory: 3 });
  const { ran } = await runOn(st, 'p1', 'BT16-014', 'digivolve', {});
  chk(sawHolder(ran), 'ST22-06 must trigger: ' + ran.join(' ; '));
});
await scenario('5449', 'EX2-060 free plug-in use -> optionUsed', async (chk) => {
  const opt = Object.values(S.CARDS).find(c => c.category === 'option' && /플러그인/.test(c.nameKo) && c.colors?.length === 1 && (c.cost || 0) <= 4)?.id;
  const st = newBoard({ p1: { battle: ['EX2-060', 'ST22-06', S.card('EX2-060') && F3[3]], hand: [opt] }, p2: { battle: [F3[0]] }, memory: 3 });
  const t = stk(st, 'p1', 'EX2-060');
  const ch = mkChoose(st); const tr = { player: 'p1', cardId: 'EX2-060', stackUid: t.uid, tags: ['자신의 턴'], text: '' };
  const { Fx } = await import('./lib5.mjs');
  await Fx.runScript(Fx.lookupCardSpecific('EX2-060', ['자신의 턴'], '', false), { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX2-060', sourceStackUid: t.uid, choose: ch, trigger: tr });
  const ran = await drain(st, ch);
  chk(ran.some(x => /^ST22-06/.test(x)), 'ST22-06 must trigger after free plug-in use: ' + ran.join(' ; ') + ' hand=' + st.players.p1.hand.length);
});
report();
