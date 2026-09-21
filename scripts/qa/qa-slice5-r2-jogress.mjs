// Slice-5 round 2: jogress rulings.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, fillerLv, runOn, idByName, nm } from './lib5.mjs';
const toumon = 'BT23-032';
// Q5256/5318: a digimon that cannot evolve (Betamon BT23-017 source effect) cannot be used as a jogress material by its own on-play jogress option.
for (const [holder, q] of [['BT23-027', '5256'], ['BT23-050', '5318']]) {
  await scenario(q, `${holder}: cannot-evolve digimon cannot jogress through its own 등장 시`, async (chk) => {
    const j = S.parseJogress(toumon), sample = fillerLv(4);
    chk(!!j, 'parse jogress');
    // partner: any Lv.4 filler that satisfies the other side
    const partner = fillerLv(4, 200).find(id => S.canJogress({ cardId: holder }, { cardId: id }, toumon).ok) || fillerLv(3, 200).find(id => S.canJogress({ cardId: holder }, { cardId: id }, toumon).ok);
    chk(!!partner, 'partner fixture'); if (!partner) return;
    const run = async (locked) => {
      const st = newBoard({ turn: 3, memory: 10, p1: { battle: [holder, partner], hand: [toumon] }, p2: {} });
      if (locked) stk(st, 'p1', holder).cannotEvolveUntil = st.turnNumber;
      await runOn(st, 'p1', holder, 'play', {});
      return !!S.fuseStacks && st.players.p1.battle.some(s => s.cardId === toumon);
    };
    chk(await run(false), 'control: unlocked holder should jogress');
    chk(!(await run(true)), 'locked holder must not jogress');
  });
}
// Q6074/6075/6076/6268/6269: turn-end jogress effects (AD1-009 -> EX4-060, BT25-018 -> BT25-103): (a) may still attack with the fused digimon; (b) may attack with another digimon without jogressing;
// (c) the new card's 진화 시 is NOT resolved before the "그 후" part of the running effect (it queues after).
import { ctxFor, scriptFor, Fx } from './lib5.mjs';
const colorLv = (color, lv, skip = []) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === lv && c.colors?.includes(color) && !skip.includes(c.id) && !c.effectKo?.trim());
for (const [holder, target, q] of [['AD1-009', 'EX4-060', '6074/6075/6076'], ['BT25-018', 'BT25-103', '6268/6269']]) {
  await scenario(q, `${holder}: turn-end jogress into ${target} then attack; 진화 시 queued after`, async (chk) => {
    const hc = S.card(holder).colors[0], other = hc === 'red' ? 'blue' : 'red';
    const partner = colorLv(other, 6, [holder]); chk(!!partner, 'partner');
    const mk = () => newBoard({ turn: 3, memory: 10, p1: { battle: [holder, partner.id, fillerLv(4)[0]], hand: [target] }, p2: { battle: [fillerLv(4)[1]] } });
    const go = async (st, ch) => { S.queueTriggersForStack(st, 'p1', stk(st, 'p1', holder), 'turnEndOwn'); const t = st.pending.find(x => !x.resolved && x.cardId === holder && x.tags.some(g => g.includes('종료 시'))); if (!t) return false; await Fx.runScript(scriptFor(t), ctxFor(st, t, ch)); S.resolvePending(st, t.uid); return true; };
    let st = mk(); let ch = mkChoose(st);
    chk(await go(st, ch), 'turn-end trigger queued');
    const fused = st.players.p1.battle.find(s => s.cardId === target);
    chk(!!fused, 'jogress happened: ' + ch.log.join(' / '));
    chk((st._atk || []).length === 1, 'an attack was declared after jogress: ' + JSON.stringify(st._atk));
    if (fused) chk(st.pending.some(x => !x.resolved && x.cardId === target && x.tags.includes('진화 시')), '진화 시 of the new card is still pending (not resolved mid-effect)');
    st = mk(); let n = 0;
    ch = mkChoose(st, { answer: (k) => (k === 'confirmEffect' ? false : k === 'pickFromZoneIndex' ? null : undefined) });
    await go(st, ch);
    chk(!st.players.p1.battle.some(s => s.cardId === target), 'declined: no jogress');
    chk((st._atk || []).length === 1, 'declined jogress: attack still declared: ' + ch.log.join(' / '));
  });
}
report();
