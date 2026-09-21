// Slice3 round 2 part H: cost-gated sentences, leave-area triggers, raising-area evolution discounts, evolve-cost surcharges, DP caps, face-up-less conditions (Q ids only, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const mono = (color, lv, skip = []) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;
const F = (pred, skip = []) => cards.find(c => !c.isToken && pred(c) && !skip.includes(c.id))?.id;
const handMain = (id) => { const seg = S.parseEffectSegments(C(id).effectKo || '').segments.find(s => s.zoneMarker === '패' && s.tags.includes('메인')); return seg; };

// ===== Q3701/3702/3760/3761/3762: "1코스트 지불하고 이 카드를 <조건> 자신의 디지몬의 진화원 아래에 놓는 것으로 ..." — the cost is only paid together with the placement; with no legal host nothing is paid
for (const [q, id, lv] of [['Q3701', 'EX6-007', 3], ['Q3702', 'EX6-008', 4], ['Q3760', 'EX6-037', 3], ['Q3761', 'EX6-038', 3], ['Q3762', 'EX6-040', 4]]) await sc(q, `${id}: [패]【메인】 without a legal host digimon the 1 memory cost is not paid`, async () => {
  const seg = handMain(id); if (!seg) return 'no [패]【메인】 segment';
  const run = async (withHost) => {
    const st = newState(); const host = withHost ? put(st, 'p1', [mono('red', lv) || mono('blue', lv)]) : put(st, 'p1', [mono('blue', 6)]); if (!withHost) host.cardId = mono('green', 6);
    st.players.p1.hand = [id]; st.memory = 5; const t = S.queuePending(st, { player: 'p1', cardId: id, stackUid: null, tags: ['메인'], text: seg.body.trim(), zone: 'hand' });
    await drain(st, (k, o) => (k === 'pickStack' ? host.uid : undefined)); return { mem: st.memory, hand: st.players.p1.hand.includes(id), under: host.sources.includes(id) };
  };
  const none = await run(false); const ok = await run(true);
  return all(eq('no host: memory untouched', none.mem, 5), eq('no host: card stays in hand', none.hand, true), eq('with host: cost paid + placed under', ok.mem === 4 && ok.under, true));
});

// ===== Q3792/3798/3802/3805: the 【서로의 턴】 leave effect of the 7대마왕 (EX6-056/058/060/061) cannot take the leaving digimon ITSELF from the trash (it is not there yet)
const gate = F((c) => c.nameKo === '대죄의 문');
const demon = F((c) => (c.types || []).includes('7대마왕') && c.category === 'digimon' && !['EX6-056', 'EX6-058', 'EX6-060', 'EX6-061'].includes(c.id));
for (const [q, id] of [['Q3792', 'EX6-056'], ['Q3798', 'EX6-058'], ['Q3802', 'EX6-060'], ['Q3805', 'EX6-061']]) await sc(q, `${id}: leaving by an effect places another 7대마왕 card from the trash under 「대죄의 문」, never itself`, async () => {
  if (!gate || !demon) return 'no fixture'; const run = async (withOther) => {
    const st = newState(); const me = put(st, 'p1', [id]); const g = S._s4.makeStack(gate, 1); st.players.p1.raising = g; st.players.p1.trash = withOther ? [demon] : [];
    S.bounceStack ? null : null; S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st); return g.sources.slice();
  };
  const a = await run(false), b = await run(true);
  return all(eq('nothing but itself in the trash -> nothing placed', a.includes(id), false), eq('another 7대마왕 card is placed', b.includes(demon), true));
});

// ===== Q3954/3955/3962/3963/3969/3970: EX8-068/069/071 with 0 security cards
for (const [qa, qb, id] of [['Q3954', 'Q3955', 'EX8-068'], ['Q3962', 'Q3963', 'EX8-069'], ['Q3969', 'Q3970', 'EX8-071']]) {
  await sc(qa, `${id}: with 0 security, "no face-up security" holds so the colour requirement can be ignored`, async () => {
    const st = newState(); st.players.p1.security = []; st.players.p1.hand = [id]; st.memory = 5; put(st, 'p1', [mono('red', 3)]);
    const used = S.useOptionCard(st, 'p1', 0); return eq('usable without the colour', !!used, true);
  });
  await sc(qb, `${id}: 【메인】 with 0 security adds nothing to hand and still places the option face-up under security`, async () => {
    const st = newState(); st.players.p1.security = []; st.players.p1.hand = [id]; st.memory = 5; put(st, 'p1', [mono('red', 3)]); const h0 = st.players.p1.hand.length;
    S.useOptionCard(st, 'p1', 0); await drain(st);
    return all(eq('placed in security', st.players.p1.security.includes(id), true), eq('face-up', S.secFaceUpCount(st.players.p1), 1), eq('hand empty (nothing added)', st.players.p1.hand.length, 0));
  });
}

// ===== Q2925/Q2966: BT18-018 / BT18-042 evolve from the named Tamer holding MORE than 5 hybrid cards (6+ is fine, cost 5)
for (const [q, id, tname] of [['Q2925', 'BT18-018', '우정훈'], ['Q2966', 'BT18-042', '원건우'] ]) await sc(q, `${id}: the tamer condition ("5장 있는") is satisfied by a tamer with more than 5 hybrid cards`, async () => {
  const line = (C(id).effectKo || '').split('\n').find(l => /〔진화〕/.test(l)); const tn = [...line.matchAll(/「([^」]+)」/g)].map(m => m[1]).pop(); const tid = cards.find(c => c.category === 'tamer' && S.cardNameIs(c, tn))?.id; if (!tid) return 'no tamer fixture ' + tn;
  const hyb = cards.filter(c => c.category === 'digimon' && (c.types || []).includes('하이브리드체')).slice(0, 7).map(c => c.id);
  const run = (n) => { const st = newState(); const t = put(st, 'p1', [tid]); t.sources = hyb.slice(0, n); return E.evolutionMethods(t.cardId, id, S.evoExtraArg(st, 'p1', t), S.evolveTargetRestriction(st, 'p1', t), { state: st, p: 'p1', stack: t }); };
  return all(eq('6 cards -> allowed', run(6).some(m => m.baseCost === 5), true), eq('7 cards -> allowed', run(7).some(m => m.baseCost === 5), true), eq('4 cards -> not allowed', run(4).some(m => m.baseCost === 5), false));
});

// ===== Q3097/Q3845/Q3239/Q3246: 【자신의 턴】 evolve-cost discounts do not apply while the digimon is in the RAISING area
for (const [q, holder, target] of [['Q3097', 'BT19-045', 'BT19-048'], ['Q3845', 'EX7-024', F((c) => c.category === 'digimon' && (c.types || []).includes('퍼펫형') && c.level === 4)], ['Q3239', 'EX1-052', F((c) => c.category === 'digimon' && /에테몬/.test(c.nameKo) && c.level === 6)], ['Q3246', 'EX1-061', F((c) => c.category === 'digimon' && /묘티스몬/.test(c.nameKo) && c.level === 6)]]) await sc(q, `${holder}: the own-turn evolve discount is not given in the raising area (given in the battle area)`, async () => {
  if (!target) return 'no target fixture'; const mk = (inRaising) => { const st = newState(); const s = S._s4.makeStack(holder, 1); s.attackEligibleTurn = 0; if (inRaising) st.players.p1.raising = s; else st.players.p1.battle.push(s); return { st, s }; };
  const b = mk(false), r = mk(true); const d = (o) => S.continuousEvoCostDiscount(o.st, 'p1', o.s, target) + S.hookEvoCostDiscount(o.st, 'p1', o.s, target);
  return all(eq('battle area discount', d(b), -1), eq('raising area no discount', d(r), 0));
});

// ===== Q3382/Q3389: the EX3-016/EX3-019 surcharge counts a TAMER (which has no sources) treated as a digimon, e.g. BT4-011 evolving from a red tamer
for (const [q, holder] of [['Q3382', 'EX3-016'], ['Q3389', 'EX3-019']]) await sc(q, `${holder} source on the opponent side: a source-less tamer evolving into a digimon pays +1`, async () => {
  const st = newState(); put(st, 'p2', [FILL[3], holder]); const t = put(st, 'p1', [F((c) => c.category === 'tamer' && c.colors.includes('red') && !c.effectKo)]); st.activePlayer = 'p2'; st.turnNumber++; st.activePlayer = 'p1'; st.turnNumber++;
  // the surcharge is an 【상대의 턴】 effect of the holder: it is live while p1 (the evolving player) takes its own turn
  return eq('surcharge', S.continuousEvoCostDiscount(st, 'p1', t, 'BT4-011'), 1);
});

// ===== Q3061/3066/3292/3295: 「DP 소멸 효과의 상한 +N」 raises only NUMERIC caps ("DP 6000 이하"), not "이 디지몬의 DP 이하"
for (const [q, id] of [['Q3061', 'BT19-007'], ['Q3066', 'BT19-009'], ['Q3292', 'EX2-010'], ['Q3295', 'EX2-011']]) await sc(q, `${id}: the DP-cap bonus does not raise a cap that is not printed as a number ("this digimon's DP or less")`, async () => {
  const st = newState(); const me = put(st, 'p1', [FILL[0], id]); st.memory = 0; const o = put(st, 'p2', [mono('red', 5)]); const dpMe = S.effectiveDP(st, 'p1', me); o.tempDP = dpMe + 1000 - S.effectiveDP(st, 'p2', o);
  S.queuePending(st, { player: 'p1', cardId: FILL[0], stackUid: me.uid, tags: ['등장 시'], text: '이 디지몬의 DP 이하의 상대의 디지몬 1마리를 소멸시킨다.' }); await drain(st);
  return eq('foe above own DP is not deleted even with the cap bonus', st.players.p2.battle.length, 1);
});

// ===== Q3876/3877/3924/3925/3928/3930/3985: "디지몬 1마리를 레스트시킬 수 있다" may pick an own OR an opponent's digimon
const RESTC = [['Q3876', 'EX8-014'], ['Q3877', 'EX8-016'], ['Q3924', 'EX8-038'], ['Q3925', 'EX8-040'], ['Q3928', 'EX8-043'], ['Q3930', 'EX8-044']];
for (const [q, id] of RESTC) await sc(q, `${id}: the rest effect can target an own digimon`, async () => {
  const st = newState(); const me = put(st, 'p1', [id]); const mine = put(st, 'p1', [FILL[1]]); put(st, 'p2', [FILL[2]]);
  await trig(st, 'p1', me, 'play', (k, o) => (k === 'pickStackAnySide' ? { player: 'p1', uid: mine.uid } : undefined));
  const ok = mine.suspended === true || me.suspended === true; return eq('own digimon rested', ok, true);
});
await sc('Q3985', 'EX8-074: on evolution the rest effect can target an own digimon', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX8-074']); const mine = put(st, 'p1', [FILL[1]]); put(st, 'p2', [FILL[2]]);
  await trig(st, 'p1', me, 'digivolve', (k, o) => (k === 'pickStackAnySide' ? { player: 'p1', uid: mine.uid } : undefined)); return eq('own rested', mine.suspended === true, true);
});

// ===== Q3874/3875: EX8-009 / EX8-012 source (own turn, once): if the source holder is deleted at the same time as the opp digimon, no memory
for (const [q, id] of [['Q3874', 'EX8-009'], ['Q3875', 'EX8-012']]) await sc(q, `${id} source: opp digimon deleted together with the holder -> no memory; deleted alone -> +1`, async () => {
  const run = async (together) => {
    const st = newState(); const holder = put(st, 'p1', [FILL[0], id]); const foe = put(st, 'p2', [FILL[1]]); st.memory = 0;
    if (together) S.deleteStack(st, 'p1', holder.uid, 'trash', 'effect'); S.deleteStack(st, 'p2', foe.uid, 'trash', 'effect'); await drain(st); return st.memory;
  };
  return all(eq('alone', await run(false), 1), eq('together', await run(true), 0));
});
// ===== Q3961: EX8-068 face-up in security: as soon as memory is 1+ (e.g. after the opponent's evolution) own DS digimon cannot be deleted in battle
await sc('Q3961', 'EX8-068 (face-up in security): with memory 1+ own 「DS」 digimon are not deleted in battle; at memory 0 they are', async () => {
  const ds = F((c) => c.category === 'digimon' && (c.types || []).includes('DS') && c.level === 3 && !c.effectKo?.trim()) || F((c) => c.category === 'digimon' && (c.types || []).includes('DS'));
  const run = async (mem) => { const st = newState(); st.players.p1.security = [FILL[0]]; S.secAddFaceUp(st, 'p1', 'EX8-068', 'top'); const mine = put(st, 'p1', [ds]); const foe = put(st, 'p2', [mono('red', 6)]); st.memory = mem; mine.suspended = true;
    S.resolveDigimonBattle(st, 'p2', foe.uid, mine.uid); return st.players.p1.battle.includes(mine); };
  return all(eq('memory 1: survives', await run(1), true), eq('memory 0: deleted', await run(0), false));
});
finish('slice3-r2-h');
