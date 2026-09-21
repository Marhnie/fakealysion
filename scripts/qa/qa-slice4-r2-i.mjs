// Slice-4 round 2, batch I: 「【진화 시】 효과는 발휘하지 않는다」 (BT20-033 / BT22-038 …), evolving from a play-turn tamer, hand 【메인】 with no digimon.
import { S, E, Fx, newBoard, F3, fillerLv, scenario, report, stk, mkChoose, drain, fire, pend, nm, evo } from './lib5.mjs';
const L5 = fillerLv(5), L3 = fillerLv(3), L4 = fillerLv(4);
const seal = async (id, src, fd) => {
  const st = newBoard({ p1: { battle: [{ id, src, fd }] }, p2: { battle: [L5[0]] } }); st.activePlayer = 'p1';
  const t = stk(st, 'p2', L5[0]); await fire(st, 'p1', stk(st, 'p1', id), 'digivolve', mkChoose(st));
  st.activePlayer = 'p2'; st.turnNumber++; return { st, t };
};
for (const [id, src, fd, qs] of [['BT20-033', [], 0, [4326, 4327, 4330]], ['BT22-038', [L3[0]], 1, [4885, 4886, 4889]]]) {
  await scenario(qs[0], `${id}: sealed opponent digimon evolves into a card with 【진화 시】 -> it does not trigger (control: unsealed does)`, async (chk) => {
    const { st, t } = await seal(id, src, fd); chk(t.noEvoTrigUntil != null, 'seal not applied');
    evo(st, 'p2', t, 'RB1-025', 0); chk(!pend(st).some(x => x.startsWith('RB1-025')), 'sealed 진화 시 was queued: ' + pend(st));
    const st2 = newBoard({ p2: { battle: [L5[0]] }, p1: { battle: [] } }); st2.activePlayer = 'p2'; evo(st2, 'p2', stk(st2, 'p2', L5[0]), 'RB1-025', 0); chk(pend(st2).some(x => x.startsWith('RB1-025')), 'control: unsealed 진화 시 not queued');
  });
  await scenario(qs[1], `${id}: the sealed digimon's 【어택 시】 (same printed 【진화 시】【어택 시】 line) still triggers`, async (chk) => {
    const { st, t } = await seal(id, src, fd); evo(st, 'p2', t, 'RB1-025', 0); st.pending.length = 0;
    S.queueTriggersForStack(st, 'p2', t, 'attack'); chk(pend(st).some(x => x.startsWith('RB1-025')), '어택 시 not triggered: ' + pend(st));
  });
  await scenario(qs[2], `${id}: a sealed 【진화 시】 does not consume the once-per-turn count`, async (chk) => {
    const { st, t } = await seal(id, src, fd); evo(st, 'p2', t, 'RB1-030', 0); chk(t.cardId === 'RB1-030', 'evolve did not happen');
    chk(Object.keys(t.turnEffectUses || {}).length === 0, 'turn uses consumed: ' + JSON.stringify(t.turnEffectUses));
  });
}
// 4920 family: a card evolved from a tamer that entered play this turn cannot attack this turn (control: an older tamer can)
for (const [q, id, tn] of [[4920, 'BT22-063', '쿠레미 쿄코'], [4925, 'BT22-067', '키시베 리에'], [4948, 'BT22-081', '카미시로 유코'], [4949, 'BT22-082', '사나다 아라타']]) {
  await scenario(q, id + ': evolved from a tamer that entered play this turn -> cannot attack this turn', async (chk) => {
    const tam = Object.values(S.CARDS).find(c => c.category === 'tamer' && c.nameKo === tn);
    for (const fresh of [true, false]) {
      const st = newBoard({ p1: { battle: [F3[0]], security: [] }, p2: { battle: [{ id: F3[1], rested: true }] }, memory: 10 });
      const t = S._s4.makeStack(tam.id, fresh ? st.turnNumber : st.turnNumber - 1); t.attackEligibleTurn = fresh ? st.turnNumber + 1 : 0; st.players.p1.battle.push(t);
      evo(st, 'p1', t, id, 0); const r = S.declareAttack(st, 'p1', t.uid);
      chk(t.cardId === id && r.ok === !fresh, (fresh ? 'fresh tamer' : 'older tamer') + ': attack ok=' + r.ok);
    }
  });
}
// 5035 family: the [패]【메인】 "…이외의 자신의 디지몬이 없다면 코스트 -5 하여 등장" works with no digimon at all (control: another digimon blocks it)
for (const [q, id] of [[5035, 'EX10-012'], [5062, 'EX10-020'], [5109, 'EX10-035'], [5154, 'EX10-057']]) {
  await scenario(q, id + ': hand 【메인】 usable when I have no digimon (not usable with an unrelated digimon)', async (chk) => {
    for (const other of [false, true]) {
      const st = newBoard({ p1: { hand: [id], battle: other ? [F3[0]] : [] }, p2: { battle: [F3[1]] }, memory: 10 });
      const ab = S.zoneMainAbilities(st, 'p1', 'hand')[0]; chk(!!ab, 'no zone ability offered');
      const sc = Fx.lookupCardSpecific(id, ['메인'], ab.text) || Fx.compileToScript(ab.text);
      await Fx.runScript(sc, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: id, sourceStackUid: null, choose: mkChoose(st), trigger: { player: 'p1', cardId: id, tags: ['메인'], handIdx: ab.idx }, startAttack() {} });
      const played = st.players.p1.battle.some(x => x.cardId === id); chk(played === !other, 'other digimon=' + other + ' played=' + played);
    }
  });
}
// 4715 family: "어택 중이라면" is satisfied by ANY attack in progress, including the opponent's
for (const [q, id] of [[4715, 'BT20-015'], [4721, 'BT20-053']]) {
  await scenario(q, id + ': evolving during the opponent attack satisfies "어택 중이라면" (no attack -> not satisfied)', async (chk) => {
    for (const atk of [true, false]) {
      const st = newBoard({ p1: { battle: [id, F3[0]] }, p2: { battle: [F3[1]] } }); const h = stk(st, 'p1', id); st.pending.length = 0;
      if (atk) st.attackCtx = { attacker: 'p2', uid: stk(st, 'p2', F3[1]).uid, targetUid: h.uid };
      const dp0 = S.effectiveDP(st, 'p1', h) + S.effectiveDP(st, 'p1', stk(st, 'p1', F3[0]));
      await fire(st, 'p1', h, 'digivolve', mkChoose(st)); st.attackCtx = null;
      const dp1 = S.effectiveDP(st, 'p1', h) + S.effectiveDP(st, 'p1', stk(st, 'p1', F3[0]));
      chk((dp1 - dp0 === 5000) === atk, 'attack in progress=' + atk + ' but DP change ' + (dp1 - dp0));
    }
  });
}
// EX9-044 【자신의 턴】 "자신의 디지몬이 등장/진화했을 때" also fires for this card itself being played (Q4799) / evolved into (Q4800); BT22-039 (Q4893) for itself played
await scenario(4799, 'EX9-044: triggers when this card itself is played', async (chk) => {
  const st = newBoard({ p1: { hand: ['EX9-044'] }, p2: { battle: [F3[1]] }, memory: 10 }); st.pending.length = 0; S.playDigimonFresh(st, 'p1', 0);
  chk(pend(st).some(x => x.startsWith('EX9-044【자신의 턴】')), 'not triggered: ' + pend(st));
});
await scenario(4800, 'EX9-044: triggers when a digimon evolves into this card', async (chk) => {
  const wg = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && (c.types || []).includes('WG')).id;
  const st = newBoard({ p1: { battle: [wg] }, p2: { battle: [F3[1]] }, memory: 10 }); st.pending.length = 0; evo(st, 'p1', stk(st, 'p1', wg), 'EX9-044', 0);
  chk(pend(st).some(x => x.startsWith('EX9-044【자신의 턴】')), 'not triggered: ' + pend(st));
});
await scenario(4893, 'BT22-039: 【서로의 턴】 "자신의 디지몬이 등장했을 때" fires for this card itself being played', async (chk) => {
  const st = newBoard({ p1: { hand: ['BT22-039'] }, p2: { battle: [F3[1]] }, memory: 10 }); st.pending.length = 0; S.playDigimonFresh(st, 'p1', 0);
  chk(pend(st).some(x => x.startsWith('BT22-039【서로의 턴】')), 'not triggered: ' + pend(st));
});
report();
