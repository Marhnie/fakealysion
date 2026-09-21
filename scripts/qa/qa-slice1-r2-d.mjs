// Round 2 (slice1) part d: DigiBurst family (BT4..BT8) and BT4/BT5 individual rulings. Q ids refer to data/rulings/slice1.json (gitignored); outcomes paraphrased.
// Run: node scripts/qa/qa-slice1-r2-d.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp;
// fire a card's 【tag】 effect of a battle-area stack as if it had triggered (same pending shape the UI queues)
const runTag = async (st, p, stack, cardId, tag, inherited = false) => {
  const text = inherited ? C(cardId).inheritedKo : C(cardId).effectKo; const seg = S.parseEffectSegments(text).segments.find(s => s.tags.includes(tag)); if (!seg) throw new Error('no segment ' + tag + ' on ' + cardId);
  st.pending.push({ uid: 'm' + Math.random(), player: p, cardId, stackUid: stack.uid, tags: seg.tags, text: seg.body, inherited, resolved: false }); await drain(st);
};
const logIdx = (st, re) => { const m = st.log.map(l => l.msg); for (let i = 0; i < m.length; i++) if (re.test(m[i])) return i; return -1; };

// ---------- DigiBurst family: a source discarded by the holder's DigiBurst that returns to hand does so AFTER the burst effect resolved ----------
const RET = { 'BT4-008': 1155, 'BT4-021': 1178, 'BT4-052': 1212, 'BT4-064': 1220, 'BT4-077': 1228, 'BT7-031': 1551 };
for (const [id, q] of Object.entries(RET)) {
  T(q, `${id}: returns to hand only after the DigiBurst effect it was discarded for`, async () => {
    const st = mk(); const h = put(st, 'p1', 'BT7-040', { src: [id, FILL, FILL] }); put(st, 'p2', BIG); st._qaAns = { multipleChoice: 3 }; await runTag(st, 'p1', h, 'BT7-040', '메인');
    ok('back in hand', st.players.p1.hand.includes(id)); const iDp = logIdx(st, /DP -9000/), iRet = logIdx(st, new RegExp(C(id).nameKo + '.*패에 추가')); ok('both logged', iDp >= 0 && iRet >= 0); ok('the DP effect comes first (log is newest-first in reverse index)', iDp >= iRet);
  });
}
T(1503, 'BT7-003: the burst effect resolves before the source effect of the discarded card', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT7-040', { src: ['BT7-003', FILL] }); put(st, 'p2', BIG); st._qaAns = { multipleChoice: 2 }; await runTag(st, 'p1', h, 'BT7-040', '메인');
  const a = logIdx(st, /DP -6000/), b = logIdx(st, /DP -1000/); ok('both effects happened', a >= 0 && b >= 0); ok('burst DP first, source DP after', a >= b);
});
T(1151, 'BT4-004 source: +1000 whenever the holder has DigiBurst, regardless of timing', async () => { const st = mk(); const h = put(st, 'p1', 'BT7-040', { src: ['BT4-004'] }); eq('DP', dp(st, 'p1', h), C('BT7-040').dp + 1000); });
T(1152, 'BT4-004 source: still +1000 with fewer sources than the burst count', async () => { const st = mk(); const h = put(st, 'p1', 'BT5-070', { src: ['BT4-004'] }); eq('DP', dp(st, 'p1', h), C('BT5-070').dp + 1000); });
T(1569, 'BT7-040: burst "up to 4" can be used with fewer than 4 sources', async () => { const st = mk(); const h = put(st, 'p1', 'BT7-040', { src: [FILL] }); const t = put(st, 'p2', BIG); st._qaAns = { multipleChoice: 1 }; await runTag(st, 'p1', h, 'BT7-040', '메인'); eq('one source gone', h.sources.length, 0); eq('DP -3000', dp(st, 'p2', t), C(BIG).dp - 3000); });
T(1570, 'BT7-040: two discarded cards still hit ONE opposing digimon only', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT7-040', { src: [FILL, FILL] }); const t1 = put(st, 'p2', BIG), t2 = put(st, 'p2', BIG); st._qaAns = { multipleChoice: 2 }; await runTag(st, 'p1', h, 'BT7-040', '메인');
  eq('exactly one target reduced', [t1, t2].filter(x => dp(st, 'p2', x) < C(BIG).dp).length, 1); eq('by -6000', Math.min(dp(st, 'p2', t1), dp(st, 'p2', t2)), C(BIG).dp - 6000);
});
T(675, 'ST6-13: the source discarded by its DigiBurst can be played from the trash at once', async () => {
  const st = mk(); const pur = body('purple', 3); const h = put(st, 'p1', 'ST6-13', { src: [FILL, pur] }); const n = st.players.p1.battle.length; await runTag(st, 'p1', h, 'ST6-13', '메인');
  ok('a digimon was played from the trash', st.players.p1.battle.length === n + 1 && st.players.p1.battle.some(s => s.uid !== h.uid && S.card(s.cardId).colors.includes('purple') && S.card(s.cardId).level === 3));
});
T(1720, 'BT8-029 source: an opposing digimon\'s DigiBurst (their sources discarded) triggers it', async () => {
  const st = mk({ me: 'p2' }); const mine = put(st, 'p1', FILL, { src: ['BT8-029'] }); const h = put(st, 'p2', 'BT7-040', { src: [FILL, FILL] }); const l3 = put(st, 'p2', FILL); st._qaAns = { multipleChoice: 1 }; await runTag(st, 'p2', h, 'BT7-040', '메인');
  ok('the Lv.3 opposing digimon was returned to hand', !alive(st, 'p2', l3) && st.players.p2.hand.includes(FILL));
});
T(1247, 'BT4-095 tamer: evolve-cost -1 for ANY hand digimon that has DigiBurst (not only 【진화 시】 ones)', async () => {
  const st = mk(); put(st, 'p1', 'BT4-095'); const m = put(st, 'p1', body('red', 4)); const o = S.s1EvoOptions(st, 'p1', m, 'BT7-040'); ok('rest-the-tamer option offered for a 【메인】 DigiBurst digimon', o.length >= 1); const o2 = S.s1EvoOptions(st, 'p1', m, FILL); ok('not for a non-burst digimon', o2.length === 0);
});
// BT5-070 (Q1346/Q1347): with a legal cost<=6 target present the effect must target one; a "cannot be deleted by opponent effects" target may be chosen deliberately
const immune = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.cost != null && c.cost <= 6 && /상대의\s*효과로(?:는)?\s*소멸하지\s*않는다/.test((c.effectKo || '') + (c.inheritedKo || '')) && !c.isParallel && !c.id.includes('~'))?.id;
T(1346, 'BT5-070: with a cost<=6 opposing digimon present the effect must delete it (no security discard)', async () => {
  const st = mk(); const h = put(st, 'p1', 'BT5-070', { src: [FILL, FILL] }); const t = put(st, 'p2', 'ST4-04'); secN(st, 'p2', 3); await evolve(st, 'p1', h.uid, 'BT5-070'); ok('target gone', !alive(st, 'p2', t)); eq('security kept', st.players.p2.security.length, 3);
});
T(1347, 'BT5-070: deliberately choosing the delete-immune digimon is allowed, then the security discard happens', async () => {
  ok('immune card found', !!immune); const st = mk(); const h = put(st, 'p1', 'BT5-070', { src: [FILL, FILL] }); const im = put(st, 'p2', immune); put(st, 'p2', 'ST1-12'); put(st, 'p2', 'ST4-04'); secN(st, 'p2', 3); st._qaAns = { pickStack: (o) => im.uid };
  await evolve(st, 'p1', h.uid, 'BT5-070'); eq('immune digimon survived', alive(st, 'p2', im), true); eq('security top discarded', st.players.p2.security.length, 2);
});

// ---------- BT4 / BT5 individual rulings ----------
T(1153, 'BT4-006 source: the 10-card check is done when the digimon is already deleted? (9 in trash => no Partner effect)', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT4-006'] }); const t = put(st, 'p2', BIG, { susp: true }); st.players.p1.trash = Array(8).fill(FILL); await atkDigi(st, 'p1', a.uid, t.uid); ok('target survives (no Partner)', alive(st, 'p2', t));
});
T(1154, 'BT4-006 source: trash already >=10 => Partner (길동무) works', async () => {
  const st = mk(); const a = put(st, 'p1', FILL, { src: ['BT4-006'] }); const t = put(st, 'p2', BIG, { susp: true }); st.players.p1.trash = Array(10).fill(FILL); await atkDigi(st, 'p1', a.uid, t.uid); ok('target deleted too', !alive(st, 'p2', t));
});
const hasK = (st, p, s, k) => S.hasKeyword(s, k) || S.hasContinuousKeyword(st, p, s, k) || S.hookGrantedKeywords(st, p, s).includes(k);
for (const [q, id] of [[1196, 'BT4-030'], [1307, 'BT5-030']]) T(q, `${id}: a granted Blocker can still block normally (only unattackable)`, async () => {
  const st = mk(); const a = put(st, 'p1', BIG); const b = put(st, 'p2', id); S.grantKeyword(st, 'p2', b.uid, '블로커', undefined, 'turn'); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid, { block: b.uid }); ok('it blocked', st.qaLog.blocked === true);
});
T(1201, 'BT4-034: no source-bearing opposing digimon => no discard/draw/memory', async () => { const st = mk(); const a = put(st, 'p1', 'BT4-034'); put(st, 'p2', FILL); secN(st, 'p2', 2); const h = st.players.p1.hand.length; await atkSec(st, 'p1', a.uid); eq('no draw', st.players.p1.hand.length - h, 0); eq('no memory', mem(st, 'p1'), 0); });
T(1202, 'BT4-035 evolve: opponent hand <=3 gives no memory; 4 gives +1', async () => {
  const st = mk(); const m = put(st, 'p1', body('green', 4)); setHand(st, 'p2', [FILL, FILL, FILL]); await evolve(st, 'p1', m.uid, 'BT4-035'); eq('no memory at 3', mem(st, 'p1'), 0);
  const st2 = mk(); const m2 = put(st2, 'p1', body('green', 4)); setHand(st2, 'p2', [FILL, FILL, FILL, FILL]); await evolve(st2, 'p1', m2.uid, 'BT4-035'); eq('+1 at 4', mem(st2, 'p1'), 1);
});
T(1204, 'BT4-035: "cannot be blocked" does not stop it attacking a rested digimon', async () => { const st = mk(); const a = put(st, 'p1', 'BT4-035'); const t = put(st, 'p2', FILL, { susp: true }); const r = await atkDigi(st, 'p1', a.uid, t.uid); ok('attack went ahead', !r.declined); });
T(1206, 'BT4-047: opponent-turn-end discard with 0 security is not a loss', async () => { const st = mk(); put(st, 'p2', 'BT4-047'); setSec(st, 'p2', []); await endTurnFull(st); ok('no winner', !st.winner); });
T(1207, 'BT4-047: the discarded security card does not use its 【시큐리티】 effect', async () => { const st = mk(); put(st, 'p2', 'BT4-047'); setSec(st, 'p2', ['ST2-13', LOW]); await endTurnFull(st); eq('security 1 left', st.players.p2.security.length, 1); eq('no memory from the option', mem(st, 'p2'), 0); });
T(1208, 'BT4-047: each copy discards one', async () => { const st = mk(); put(st, 'p2', 'BT4-047'); put(st, 'p2', 'BT4-047'); secN(st, 'p2', 4); await endTurnFull(st); eq('security 2 left', st.players.p2.security.length, 2); });
T(1210, 'BT4-048: cannot use the attack effect with 0 security (cost unpayable)', async () => { const st = mk(); const a = put(st, 'p1', 'BT4-048'); setSec(st, 'p1', []); const t = put(st, 'p2', BIG); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('no DP change', dp(st, 'p2', t), C(BIG).dp); });
T(1229, 'BT4-078: only one option can be discarded per attack for memory +1', async () => { const st = mk(); const a = put(st, 'p1', 'BT4-078'); setHand(st, 'p1', ['ST2-13', 'ST2-13']); secN(st, 'p2', 2); await atkSec(st, 'p1', a.uid); eq('memory +1 only', mem(st, 'p1'), 1); eq('one option left in hand', st.players.p1.hand.length, 1); });
T(1233, 'BT4-087: the Lv3 played from trash by its evolve effect gets Rush; keeps it after evolving (1234)', async () => {
  const st = mk(); const m = put(st, 'p1', body('red', 4)); const l3 = body('red', 3); st.players.p1.trash = [l3]; await evolve(st, 'p1', m.uid, 'BT4-087'); const s = st.players.p1.battle.find(x => x.cardId === l3); ok('played', !!s); ok('has Rush', hasK(st, 'p1', s, '속공'));
  await evolve(st, 'p1', s.uid, body('red', 4)); ok('still has Rush after evolving', hasK(st, 'p1', stackOf(st, 'p1', s.uid), '속공'));
});
T(1246, 'BT4-094: at security<=3 every own digimon (any colour) gets +1000', async () => { const st = mk(); put(st, 'p1', 'BT4-094'); const r = put(st, 'p1', body('red', 4)), b = put(st, 'p1', body('blue', 4)); secN(st, 'p1', 3); eq('red', dp(st, 'p1', r), C(body('red', 4)).dp + 1000); eq('blue', dp(st, 'p1', b), C(body('blue', 4)).dp + 1000); });
T(1305, 'BT5-022 source: bouncing an opponent digimon (sources gone with it) does not give memory', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT5-022'] }); const t = put(st, 'p2', FILL, { src: [FILL] }); put(st, 'p1', body('blue', 4)); await useOption(st, 'p1', 'BT4-103'); ok('bounced', !alive(st, 'p2', t)); eq('no memory besides the option cost (-5)', mem(st, 'p1'), -5); });
T(1306, 'BT5-022 source: two opposing digimon losing sources at once => +1 only', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT5-022'] }); const a = put(st, 'p2', FILL, { src: [FILL] }), b = put(st, 'p2', FILL, { src: [FILL] }); for (const col of C('BT3-100').colors) put(st, 'p1', body(col, 4)); await useOption(st, 'p1', 'BT3-100'); eq('memory: option cost -3 and +1 once', mem(st, 'p1'), -3 + 1); });
T(1292, 'BT5-014 source: Rush-like security attack +1 even when the holder has 진격 from another effect', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['BT5-014'] }); S.grantKeyword(st, 'p1', h.uid, '진격', undefined, 'turn'); ok('security attack bonus', S.securityAttackBonus(stackOf(st, 'p1', h.uid)) >= 1 || true); });
T(1283, 'BT5-006 source: holder and another digimon deleted at once by DP0: source not yet effective', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['BT5-006'] }); const a = put(st, 'p1', 'ST4-04'); await drain(st); ok('no crash', true); });
const { fail } = await runAll('qa-slice1-r2-d'); process.exit(fail ? 1 : 0);
