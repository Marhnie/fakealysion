// Round 2 (slice1) part b: security-effect digimon family, jogress-inheritance family, attack/memory and attack-target-change families.
// Q ids refer to data/rulings/slice1.json (gitignored); outcomes paraphrased. Run: node scripts/qa/qa-slice1-r2-b.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, dp, stackOf, alive, mem, drain, resolved, playCard, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const WB = 'ST5-03'; // DP1000 blocker (weak so the attacker survives)
const nm = (id) => C(id).nameKo;

// ---------- Family S: 【시큐리티】 "배틀 종료 시 코스트 없이 등장" digimon ----------
const SEC_LOSS = { 'ST7-06': 684, 'ST8-06': 699, 'ST9-10': 716, 'ST10-09': 741, 'BT3-011': 1052, 'BT3-024': 1062, 'BT3-036': 1073, 'BT3-049': 1083, 'BT3-065': 1093, 'BT3-082': 1100, 'BT5-065': 1340, 'BT6-058': 1451 };
const SEC_ORDER = { 'ST8-06': 701, 'ST9-10': 718, 'ST10-09': 743, 'BT3-011': 1053, 'BT3-024': 1063, 'BT3-036': 1074, 'BT3-049': 1084, 'BT3-065': 1094, 'BT3-082': 1101, 'BT5-065': 1341, 'BT6-058': 1452 };
const SEC_NORMAL = { 'ST7-06': 684, 'BT3-011': 1051, 'BT3-024': 1061, 'BT3-036': 1072, 'BT3-049': 1082, 'BT3-065': 1092, 'BT3-082': 1099, 'BT5-065': 1339, 'BT6-058': 1450 };
const SEC_ONPLAY = { 'ST8-06': 700, 'ST9-10': 717, 'ST10-09': 742 };
const played = (st, id) => st.players.p2.battle.find(s => s.cardId === id);
for (const [id, q] of Object.entries(SEC_LOSS)) {
  T(q, `${id} security digimon plays at battle end whether it won or lost`, async () => {
    const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', [id, LOW]); await atkSec(st, 'p1', a.uid); ok('attacker wins: still played', !!played(st, id));
    const st2 = mk(); const a2 = put(st2, 'p1', LOW); setSec(st2, 'p2', [id, LOW]); await atkSec(st2, 'p1', a2.uid); ok('attacker loses: still played', !!played(st2, id));
  });
}
for (const [id, q] of Object.entries(SEC_ORDER)) {
  T(q, `${id} is played before the attacker's next check`, async () => {
    const st = mk(); const a = put(st, 'p1', 'ST1-11', { src: [FILL, FILL] }); setSec(st, 'p2', [id, LOW, LOW]); await atkSec(st, 'p1', a.uid);
    const msgs = st.log.map(l => l.msg).reverse(); const iPlay = msgs.findIndex(m => m.includes(nm(id)) && /등장/.test(m)); const iChk2 = msgs.findIndex(m => /시큐리티 체크\(2\//.test(m)); ok('both logged', iPlay >= 0 && iChk2 >= 0); ok('play before the 2nd check', iPlay < iChk2);
  });
}
for (const [id, q] of Object.entries(SEC_NORMAL)) {
  if (q === 684 && SEC_LOSS[id] === 684) { /* same Q id as above; still a separate scenario */ }
  T(q, `${id} after security play is an ordinary digimon (no "security digimon" bonus in the battle area)`, async () => {
    const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p2', FILL, { src: ['BT7-088'] }); setSec(st, 'p2', [id, LOW]); await atkSec(st, 'p1', a.uid); const s = played(st, id); ok('played', !!s);
    eq('no security-digimon DP bonus once in the battle area', dp(st, 'p2', s), C(id).dp);
  });
}
for (const [id, q] of Object.entries(SEC_ONPLAY)) {
  T(q, `${id} 【등장 시】 resolves when it enters through its security effect`, async () => {
    const st = mk(); const a = put(st, 'p1', BIG); put(st, 'p2', FILL); setSec(st, 'p2', [id, LOW]); setHand(st, 'p2', []); await atkSec(st, 'p1', a.uid);
    ok('on-play resolved', resolved(st).some(r => r.cardId === id && (r.tags || []).some(t => String(t).includes('등장'))));
  });
}
// BT6-056 (Q1448/Q1449): the security "de-digivolve after battle" effect happens even when the security digimon lost; BT6-111 (Q1495): added to hand after battle even after losing
T(1448, 'BT6-056 security effect (deevolve 1) still applies after it lost', async () => {
  const st = mk(); const a = put(st, 'p1', BIG, { src: [FILL] }); setSec(st, 'p2', ['BT6-056', LOW]); await atkSec(st, 'p1', a.uid); const s = stackOf(st, 'p1', a.uid); ok('attacker survived', !!s); eq('lost 1 source', s.sources.length, 0);
});
T(1495, 'BT6-111 security card is added to hand at battle end even after losing', async () => {
  const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['BT6-111', LOW]); await atkSec(st, 'p1', a.uid); ok('in hand', st.players.p2.hand.includes('BT6-111'));
});

// ---------- Family J: jogress-at-turn-end source effects cannot ignore the jogress condition ----------
const JSRC = { 'ST9-08': [713, 714], 'ST10-02': [725, 726], 'ST10-04': [730, 731], 'ST13-04': [771, 772], 'ST13-13': [788, 789], 'BT8-020': [1709, 1710] };
const NONJ = body('yellow', 5) || FILL;
for (const [src, [q1, q2]] of Object.entries(JSRC)) {
  T(q1, `${src} source effect: a hand digimon without 조그레스 cannot be jogressed into`, async () => {
    const st = mk(); const h = put(st, 'p1', body('green', 4), { src: [src] }); put(st, 'p1', body('blue', 4)); setHand(st, 'p1', [NONJ]); await endTurnFull(st); eq('holder unchanged', stackOf(st, 'p1', h.uid).cardId, C(body('green', 4)).id);
  });
  T(q2, `${src} source effect: a jogress card whose materials do not match cannot be used`, async () => {
    const st = mk(); const h = put(st, 'p1', body('red', 4), { src: [src] }); put(st, 'p1', body('red', 4)); setHand(st, 'p1', ['ST9-11']); await endTurnFull(st); eq('holder unchanged', stackOf(st, 'p1', h.uid).cardId, body('red', 4));
    const st2 = mk(); const h2 = put(st2, 'p1', body('green', 4), { src: [src] }); put(st2, 'p1', body('blue', 4)); setHand(st2, 'p1', ['ST9-11']); await endTurnFull(st2); ok('control: matching materials do jogress', st2.players.p1.battle.some(s => s.cardId === 'ST9-11'));
  });
}

// ---------- Family M: "cannot attack unless memory >= 2"? no: the digimon may attack; the -2 memory applies after ----------
for (const [id, q] of Object.entries({ 'ST1-06': 602, 'ST2-07': 610, 'ST3-07': 633, 'ST4-08': 651, 'ST5-08': 664, 'ST6-08': 672, 'BT1-072': 923 })) {
  T(q, `${id} can attack at memory 0 and ends up on the opponent's side`, async () => {
    const st = mk(); const a = put(st, 'p1', id); secN(st, 'p2', 2); const r = await atkSec(st, 'p1', a.uid); ok('attack happened', !r.declined); eq('memory -2', mem(st, 'p1'), -2);
  });
}
// ---------- Family M3: attack +3 memory / end of turn -3 (BT1-040, BT1-058, BT1-075) ----------
for (const [id, [qa, qb]] of Object.entries({ 'BT1-040': [896, 897], 'BT1-058': [917, 918], 'BT1-075': [925, 926] })) {
  T(qa, `${id} deleted after attacking: the end-of-turn -3 still happens`, async () => {
    const st = mk(); const a = put(st, 'p1', id); setSec(st, 'p2', [BIG]); await atkSec(st, 'p1', a.uid); ok('attacker deleted', !alive(st, 'p1', a)); eq('+3', mem(st, 'p1'), 3); await endTurnFull(st); eq('-3 at end of turn', mem(st, 'p1'), 0);
  });
  T(qb, `${id} passing after +3: side change first, then -3 more`, async () => {
    const st = mk(); const a = put(st, 'p1', id); secN(st, 'p2', 3); await atkSec(st, 'p1', a.uid); E.declarePass(st); let g = 0; while (st.turnEnding && g++ < 10) { await drain(st); E.settleTurnEnd(st); } eq('memory', mem(st, 'p1'), -6);
  });
}
// ---------- Family B: attack declared on the player, then blocked: "attacked the player" effects still apply ----------
const blk = (st) => st.players.p2.battle.find(s => s.cardId === WB).uid;
const blockedAtk = async (st, a) => { put(st, 'p2', WB); secN(st, 'p2', 2); return atkSec(st, 'p1', a.uid, { block: blk(st) }); };
T(680, 'ST7-02 source: DP+2000 still applies after a block', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST7-02'] }); await blockedAtk(st, a); eq('DP', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp + 2000); });
T(996, 'BT2-012 +4000 still applies after a block', async () => { const st = mk(); const a = put(st, 'p1', 'BT2-012'); await blockedAtk(st, a); eq('DP', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C('BT2-012').dp + 4000); });
T(997, 'BT2-015 draws even if blocked', async () => { const st = mk(); const a = put(st, 'p1', 'BT2-015'); const h = st.players.p1.hand.length; await blockedAtk(st, a); eq('drew 1', st.players.p1.hand.length - h, 1); });
T(998, 'BT2-019 memory +1 even if blocked', async () => { const st = mk(); const a = put(st, 'p1', 'BT2-019'); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), 1); });
T(810, 'ST15-05 attacked a player and got blocked: memory -2 still applies', async () => { const st = mk(); const a = put(st, 'p1', 'ST15-05'); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), -2); });
T(822, 'ST16-05 declared at the player, blocked: the "attacked a digimon" effect does not fire', async () => { const st = mk(); const a = put(st, 'p1', 'ST16-05'); await blockedAtk(st, a); eq('memory unchanged', mem(st, 'p1'), 0); });
T(822, 'ST16-05 control: attacking a digimon directly does apply memory -2', async () => { const st = mk(); const a = put(st, 'p1', 'ST16-05'); const t = put(st, 'p2', WB, { susp: true }); await atkDigi(st, 'p1', a.uid, t.uid); eq('memory -2', mem(st, 'p1'), -2); });
T(1036, 'BT2-084 tamer: +2000 still applies after the target was changed by a block', async () => {
  const st = mk(); const rd = put(st, 'p1', 'BT1-020'); put(st, 'p1', 'BT2-084'); await blockedAtk(st, rd);
  ok('tamer effect resolved', resolved(st).some(r => r.cardId === 'BT2-084')); const s = stackOf(st, 'p1', rd.uid); ok('alive', !!s); eq('DP+2000', dp(st, 'p1', s), C('BT1-020').dp + 2000);
});
// ---------- Family R: "attack target was changed" source/tamer effects (ST15-01/02/08/14) ----------
T(805, 'ST15-01 source: holder blocked -> DP+1000', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST15-01'] }); await blockedAtk(st, a); eq('DP', dp(st, 'p1', stackOf(st, 'p1', a.uid)), C(BIG).dp + 1000); });
T(808, 'ST15-02 source: holder blocked -> memory +1', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST15-02'] }); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), 1); });
T(812, 'ST15-08 source: holder blocked -> memory +1', async () => { const st = mk(); const a = put(st, 'p1', BIG, { src: ['ST15-08'] }); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), 1); });
T(806, 'ST15-01 source on another digimon: another digimon\'s redirect still triggers it', async () => { const st = mk(); const h = put(st, 'p1', FILL, { src: ['ST15-01'] }); const a = put(st, 'p1', BIG); await blockedAtk(st, a); eq('holder DP', dp(st, 'p1', stackOf(st, 'p1', h.uid)), FB + 1000); });
T(809, 'ST15-02 source on another digimon: memory +1', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['ST15-02'] }); const a = put(st, 'p1', BIG); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), 1); });
T(813, 'ST15-08 source on another digimon: memory +1', async () => { const st = mk(); put(st, 'p1', FILL, { src: ['ST15-08'] }); const a = put(st, 'p1', BIG); await blockedAtk(st, a); eq('memory', mem(st, 'p1'), 1); });
T(815, 'ST15-14 tamer: block changes the target -> draw', async () => { const st = mk(); put(st, 'p1', 'ST15-14'); const a = put(st, 'p1', BIG); const h = st.players.p1.hand.length; await blockedAtk(st, a); eq('drew 1', st.players.p1.hand.length - h, 1); });
const { fail } = await runAll('qa-slice1-r2-b'); process.exit(fail ? 1 : 0);
