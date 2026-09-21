// Slice3 round 2 part E: data-driven templates for repeated rulings (tamer evolution, raising-area plays by effect). Q ids only, paraphrased.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);

// ===== F1: "evolving straight from a Tamer still gives the evolve draw" (BT18-011..081 family)
const F1 = [[2914, 'BT18-011'], [2917, 'BT18-012'], [2920, 'BT18-014'], [2935, 'BT18-022'], [2937, 'BT18-023'], [2941, 'BT18-024'], [2944, 'BT18-025'], [2949, 'BT18-026'], [2958, 'BT18-037'], [2974, 'BT18-047'], [2978, 'BT18-048'], [2980, 'BT18-049'], [2986, 'BT18-053'], [2995, 'BT18-063'], [2997, 'BT18-064'], [3000, 'BT18-066'], [3003, 'BT18-067'], [3012, 'BT18-070'], [3022, 'BT18-076'], [3024, 'BT18-077'], [3027, 'BT18-078'], [3035, 'BT18-079'], [3041, 'BT18-081']];
const tamer = () => cards.find(c => c.category === 'tamer' && !c.effectKo?.trim())?.id || cards.find(c => c.category === 'tamer').id;
for (const [q, id] of F1) await sc('Q' + q, `${id}: evolving from a Tamer still performs the evolve draw`, async () => {
  const st = newState(); const t = put(st, 'p1', [tamer()]); st.players.p1.hand = [id]; st.memory = 10; const d0 = st.players.p1.deck.length;
  st._evoTamerDirect = true; const r = S.digivolve(st, 'p1', t.uid, id, 0, 'hand'); st._evoTamerDirect = false;
  return all(eq('evolved', !!r && r.cardId === id, true), eq('drew 1', d0 - st.players.p1.deck.length, 1));
});
// ===== F2: a Tamer that entered this turn and evolves cannot attack this turn; an older tamer can
const F2 = [[2915, 'BT18-011'], [2918, 'BT18-012'], [2921, 'BT18-014'], [2938, 'BT18-023'], [2942, 'BT18-024'], [2945, 'BT18-025'], [2950, 'BT18-026'], [2959, 'BT18-037'], [2975, 'BT18-047'], [2981, 'BT18-049'], [2987, 'BT18-053'], [2998, 'BT18-064'], [3001, 'BT18-066'], [3004, 'BT18-067'], [3013, 'BT18-070'], [3025, 'BT18-077'], [3028, 'BT18-078'], [3036, 'BT18-079'], [3042, 'BT18-081']];
for (const [q, id] of F2) await sc('Q' + q, `${id}: tamer played this turn -> evolved card cannot attack that turn; a tamer from an earlier turn can`, async () => {
  const run = async (fresh) => {
    const st = newState(); const t = put(st, 'p1', [tamer()]); t.attackEligibleTurn = fresh ? st.turnNumber + 1 : 0; st.players.p1.hand = [id]; st.memory = 10; put(st, 'p2', [FILL[1]]);
    st._evoTamerDirect = true; S.digivolve(st, 'p1', t.uid, id, 0, 'hand'); st._evoTamerDirect = false; return S.declareAttack(st, 'p1', t.uid, {});
  };
  const a = await run(true), b = await run(false); return all(eq('fresh cannot attack', !!a?.ok, false), eq('older can attack', !!b?.ok, true));
});

// ===== F3-F7: raising-area play by the Deva cards (EX5-009..052 all print the same 【등장 시】 clause)
const DEVA = [['EX5-009', 3532, 3535, 3536, 3533, 3534], ['EX5-010', 3538, 3541, 3542, 3539, 3540], ['EX5-011', 3544, 3547, 3548, 3545, 3546], ['EX5-019', 3564, 3567, 3568, 3565, 3566], ['EX5-021', 3571, 3574, 3575, 3572, 3573], ['EX5-022', 3578, 3581, 3582, 3579, 3580], ['EX5-037', 3602, 3605, 3606, 3603, 3604], ['EX5-038', 3609, 3612, 3613, 3610, 3611], ['EX5-040', 3616, 3619, 3620, 3617, 3618], ['EX5-050', 3627, 3630, 3631, 3628, 3629], ['EX5-051', 3633, 3636, 3637, 3634, 3635], ['EX5-052', 3639, 3642, 3643, 3640, 3641]];
const devaList = cards.filter(c => c.category === 'digimon' && (c.types || []).includes('데바') && c.level != null && !c.isToken);
const pickDeva = (holder, w) => { const ok = devaList.filter(c => c.nameKo !== C(holder).nameKo); return (w ? ok.find(c => /【등장 시】/.test(c.effectKo || '')) : (ok.find(c => !/【등장 시】/.test(c.effectKo || '')) || ok[0]))?.id; };
const CLAUSE = '자신의 패에서 배틀 에어리어와 트래시에 같은 명칭의 자신의 카드가 없는, 특징으로 「데바」를 가진 디지몬 카드 1장을 비어 있는 자신의 육성 에어리어에 코스트를 지불하지 않고 등장시킬 수 있다.';
const runClause = async (st, holder) => { const me = put(st, 'p1', [holder]); st.pending.length = 0; S.queuePending(st, { player: 'p1', cardId: holder, stackUid: me.uid, tags: ['등장 시'], text: CLAUSE }); await drain(st); return me; };
for (const [id, qName, qWatch, qLock, qOnPlay, qAtk] of DEVA) {
  const devaA = pickDeva(id, false), devaW = pickDeva(id, true);
  await sc('Q' + qName, `${id}: same-name check ignores cards under digimon/tamers (only battle area tops and trash count)`, async () => {
    const st = newState(); put(st, 'p1', [FILL[5], devaA]); const tm = put(st, 'p1', [tamer()]); tm.sources = [devaA]; st.players.p1.hand = [devaA];
    await runClause(st, id); const okUnder = st.players.p1.raising?.cardId === devaA;
    const st2 = newState(); put(st2, 'p1', [devaA]); st2.players.p1.hand = [devaA]; await runClause(st2, id);
    return all(eq('name only under other cards -> playable', okUnder, true), eq('name on battle-area top -> not playable', !!st2.players.p1.raising, false));
  });
  await sc('Q' + qWatch, `${id}: playing into the raising area does not trigger "digimon played" watchers`, async () => {
    const watcher = cards.find(c => c.category === 'digimon' && /자신의\s*디지몬이\s*등장했을\s*때/.test(c.effectKo || '') && !c.isToken)?.id;
    const st = newState(); if (watcher) put(st, 'p1', [watcher]); st.players.p1.hand = [devaA];
    await runClause(st, id);
    return all(eq('played into raising', st.players.p1.raising?.cardId, devaA), eq('watcher did not queue', watcher ? st.pending.some(t => t.cardId === watcher) : false, false));
  });
  await sc('Q' + qLock, `${id}: a "cannot play by effect" lock also blocks the raising-area play`, async () => {
    const st = newState(); S.addTimedLock(st, 'p1', 'effectPlay', st.turnNumber + 1); st.players.p1.hand = [devaA]; await runClause(st, id);
    return all(eq('raising empty', !!st.players.p1.raising, false), eq('card still in hand', st.players.p1.hand.includes(devaA), true));
  });
  await sc('Q' + qOnPlay, `${id}: the digimon placed in the raising area does not resolve its own 【등장 시】`, async () => {
    if (!devaW) return 'no fixture'; const st = newState(); st.players.p1.hand = [devaW]; await runClause(st, id);
    return all(eq('placed', st.players.p1.raising?.cardId, devaW), eq('no pending 등장 시 for the raised digimon', st.pending.some(t => t.cardId === devaW && (t.tags || []).includes('등장 시')), false));
  });
  await sc('Q' + qAtk, `${id}: a digimon placed in the raising area by an effect cannot attack the same turn even if moved to the battle area`, async () => {
    const st = newState(); st.players.p1.hand = [devaA]; await runClause(st, id);
    const rs = st.players.p1.raising; if (!rs) return 'not placed'; S.moveRaisingToBattle(st, 'p1'); put(st, 'p2', [FILL[1]]); const r = S.declareAttack(st, 'p1', rs.uid, {});
    return eq('cannot attack', !!r?.ok, false);
  });
}
finish('slice3-r2-e');
