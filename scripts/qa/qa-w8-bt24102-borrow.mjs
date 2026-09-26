// W8 recheck (Q6029 BT24-102 【자신의 턴 종료 시】 / Q5721): borrowing another card's 【등장 시】/【진화 시】 effect
//  - cannot use an effect whose [턴에 N회] is already used up this turn (Q6029), and a used activation spends it;
//  - cannot use a 【진화 시】-only effect of a digimon that has "【진화 시】 효과는 발휘하지 않는다"; a 【등장 시】【진화 시】 dual one still works as its 【등장 시】 (Q5721).
import { S, E, Fx, newBoard, stk, mkChoose, drain, scenario, report, F3, zoneNames, fillerLv, scriptFor, ctxFor } from './lib5.mjs';
// run a printed segment of a card on the board through the real script pipeline (records every prompt)
async function runSeg(st, p, holderId, tag) {
  const seg = S.parseEffectSegments(S.card(holderId).effectKo || '').segments.find(s => s.tags.some(t => t.includes(tag)));
  const h = stk(st, p, holderId); const t = { player: p, cardId: holderId, stackUid: h.uid, topId: h.cardId, tags: seg.tags, text: seg.body };
  const ch = mkChoose(st); await Fx.runScript(scriptFor(t), ctxFor(st, t, ch)); return { log: ch.log };
}
const lv3 = fillerLv(3);
const OAT = S.parseEffectSegments(S.card('EX5-025').effectKo).segments.find(s => s.tags.some(t => /진화 시/.test(t)));
async function go(id, prep) {
  const st = newBoard({ p1: { battle: ['BT24-102', id], hand: [lv3[8]], deck: lv3.slice(20, 30) }, p2: { battle: [lv3[0], lv3[1]] }, memory: 3 });
  const d = stk(st, 'p1', id); prep && prep(st, d);
  const r = await runSeg(st, 'p1', 'BT24-102', '자신의 턴 종료 시');
  return { st, d, r };
}
await scenario('6029', 'EX5-025 【진화 시】【어택 시】[턴에 1회] already used -> not activated through BT24-102', async (chk) => {
  const { st, d, r } = await go('EX5-025', (st, d) => S.markTurnEffectUsed(d, S.onceLimitKey('EX5-025', OAT.tags)));
  chk(!r.log.some(x => /^pickStack/.test(x)), 'no target prompts: ' + r.log.join(','));
});
await scenario('6029', 'EX5-025 fresh -> activated and the borrowed use spends the [턴에 1회]', async (chk) => {
  const { st, d } = await go('EX5-025');
  chk(S.turnUsesRemaining(d, S.onceLimitKey('EX5-025', OAT.tags), 1) === 0, 'once limit consumed by the borrowed activation');
});
await scenario('5721', 'ST10-13 【진화 시】 only + 【진화 시】 suppressed -> cannot be activated', async (chk) => {
  const { r, st } = await go('ST10-13', (st, d) => { d.noEvoTrigUntil = st.turnNumber + 1; });
  chk(!r.log.some(x => /pickFromZoneIndex/.test(x)), 'ST10-13 effect must not run: ' + r.log.join(','));
});
await scenario('5721', 'BT24-030 【등장 시】【진화 시】 dual + 【진화 시】 suppressed -> still usable as 【등장 시】', async (chk) => {
  const { st } = await go('BT24-030', (st, d) => { d.noEvoTrigUntil = st.turnNumber + 1; });
  chk(st.players.p2.battle.length < 2, 'BT24-030 effect resolved: opp ' + zoneNames(st, 'p2', 'battle'));
});
report();
