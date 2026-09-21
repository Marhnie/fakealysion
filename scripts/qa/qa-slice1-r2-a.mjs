// Round 2 (slice1): template families. Q ids refer to data/rulings/slice1.json (gitignored); outcomes are paraphrased, no ruling text stored here.
// Run: node scripts/qa/qa-slice1-r2-a.mjs < /dev/null
import { S, E, C, FILL, LOW, BIG, body, mk, put, setHand, setSec, secN, setDeck, dp, stackOf, alive, mem, drain, resolved, playCard, evolve, endTurnFull, atkSec, T, eq, ok, runAll } from './lib-s1.mjs';

// ---------- Family 1: "treat own Tamer as a Lv.3 digimon and evolve" (BT4/BT6/BT7 Lv.4 hybrid cards) ----------
// per card: [card, colour, {Q ids: digimon-treatment, evo draw, attack-this-turn, tamer is a source, gets tamer inherited (non-security) effect}]
const TAMER_BY_COLOR = { red: 'ST1-12', blue: 'ST2-12', yellow: 'ST3-12', green: 'ST4-14', black: 'ST5-14', purple: 'ST6-14' };
const FAM = [
  ['BT4-011', 'red', [1157, 1158, 1159, 1160, 1161, 1162]], ['BT4-013', 'red', [1164, 1165, 1166, 1167, 1168, 1169]],
  ['BT4-025', 'blue', [1181, 1182, 1183, 1184, 1185, 1186]], ['BT4-027', 'blue', [1188, 1189, 1190, 1191, 1192, 1193]],
  ['BT6-049', 'green', [0, 0, 0, 1437, 0, 1439]], ['BT6-050', 'green', [1441, 1442, 1443, 1444, 1445, 1446]],
  ['BT7-011', 'red', [1507, 1508, 1509, 1510, 1511, 1512]], ['BT7-021', 'blue', [1523, 1524, 1525, 1526, 1527, 1528]],
  ['BT7-022', 'blue', [1530, 1531, 1532, 1533, 1534, 1535]], ['BT7-023', 'blue', [1537, 1538, 1539, 1540, 1541, 1542]],
  ['BT7-035', 'yellow', [1552, 1553, 1554, 1555, 1556, 1557]], ['BT7-036', 'yellow', [1559, 1560, 1561, 1562, 1563, 1564]],
  ['BT7-046', 'green', [1572, 1573, 1574, 1575, 1576, 1577]], ['BT7-047', 'green', [1580, 1581, 1582, 1583, 1584, 1585]],
  ['BT7-060', 'black', [1607, 1608, 1609, 1610, 1611, 1612]], ['BT7-061', 'black', [1614, 1615, 1616, 1617, 1618, 1619]],
  ['BT7-071', 'purple', [1626, 1627, 1628, 1629, 1630, 1631]], ['BT7-073', 'purple', [1634, 1635, 1636, 1637, 1638, 1639]],
];
const evoCostOf = (id) => { const m = /진화\s*코스트\s*(\d+)/.exec(C(id).effectKo || ''); return m ? Number(m[1]) : C(id).evoNormal.cost; };
for (const [X, col, q] of FAM) {
  const TM = TAMER_BY_COLOR[col]; const other = col === 'red' ? 'blue' : 'red';
  if (q[0]) T(q[0], `${X} tamer counts as a digimon for evolution (colour must match; digivolve event fires)`, async () => {
    const st = mk(); const tm = put(st, 'p1', TM); const m = E.evolutionMethods(TM, X, [], null, { state: st, p: 'p1', stack: tm }).find(x => x.id === 'tamer-as-digimon');
    ok('method offered for matching colour', !!m); eq('cost', m.baseCost, evoCostOf(X));
    const tm2 = put(st, 'p1', TAMER_BY_COLOR[other]); ok('not offered for a tamer of the wrong colour', !E.evolutionMethods(TAMER_BY_COLOR[other], X, [], null, { state: st, p: 'p1', stack: tm2 }).some(x => x.id === 'tamer-as-digimon'));
    setHand(st, 'p1', [X]); await evolve(st, 'p1', tm.uid, X, 0); eq('counted as a digimon evolution this turn', S.digivolvedThisTurn(st, 'p1'), 1);
  });
  if (q[1]) T(q[1], `${X} evolution from a tamer still draws`, async () => {
    const st = mk(); const tm = put(st, 'p1', TM); setHand(st, 'p1', [X]); const d = st.players.p1.deck.length; await evolve(st, 'p1', tm.uid, X, 0); ok('drew at least the evolution card', st.players.p1.deck.length <= d - 1);
  });
  if (q[2]) T(q[2], `${X}: evolved from a tamer played this turn cannot attack; from an older tamer it can`, async () => {
    const st = mk(); const tm = await playCard(st, 'p1', TM); setHand(st, 'p1', [X]); await evolve(st, 'p1', tm.uid, X, 0); ok('fresh tamer: cannot attack', stackOf(st, 'p1', tm.uid).attackEligibleTurn > st.turnNumber);
    const st2 = mk(); const tm2 = put(st2, 'p1', TM); setHand(st2, 'p1', [X]); await evolve(st2, 'p1', tm2.uid, X, 0); ok('older tamer: may attack', stackOf(st2, 'p1', tm2.uid).attackEligibleTurn <= st2.turnNumber);
  });
  if (q[3]) T(q[3], `${X}: the tamer under it is an ordinary evolution source (trashed with the stack)`, async () => {
    const st = mk(); const tm = put(st, 'p1', TM); setHand(st, 'p1', [X]); await evolve(st, 'p1', tm.uid, X, 0); const s = stackOf(st, 'p1', tm.uid); ok('source present', s.sources.includes(TM));
    S.deleteStack(st, 'p1', s.uid, 'trash', 'battle'); await drain(st); ok('tamer and digimon both in trash', st.players.p1.trash.includes(TM) && st.players.p1.trash.includes(X));
  });
  if (q[4]) T(q[4], `${X}: tamer's bottom-text security effect is not gained by the digimon (it never queues when the digimon is checked/attacks)`, async () => {
    const st = mk(); const tm = put(st, 'p1', TM); setHand(st, 'p1', [X]); await evolve(st, 'p1', tm.uid, X, 0); st._qaResolved = []; secN(st, 'p2', 1); const s = stackOf(st, 'p1', tm.uid); s.attackEligibleTurn = 0; await atkSec(st, 'p1', s.uid);
    ok('no 시큐리티 effect resolved for the tamer source', !resolved(st).some(r => r.cardId === TM && (r.tags || []).some(t => String(t).includes('시큐리티'))));
  });
}
// inherited (source) effect of a tamer is gained by the digimon: red BT7-085 (own turn DP+2000), green BT7-089 (Pierce), purple BT7-091 (on-delete memory +1)
const INH = { red: 'BT7-085', green: 'BT7-089', purple: 'BT7-091' };
for (const [X, col, q] of FAM) if (q[5] && INH[col]) T(q[5], `${X}: source tamer ${INH[col]} lends its source effect`, async () => {
  const st = mk(); const tm = put(st, 'p1', INH[col]); setHand(st, 'p1', [X]); await evolve(st, 'p1', tm.uid, X, 0); const s = stackOf(st, 'p1', tm.uid);
  if (col === 'red') eq('+2000 on own turn', dp(st, 'p1', s), C(X).dp + 2000 + (C(X).effectKo.includes('+3000') ? 3000 : 0));
  if (col === 'green') ok('pierce', S.hasKeyword(s, '관통') || S.hasContinuousKeyword(st, 'p1', s, '관통'));
  if (col === 'purple') { const m0 = mem(st, 'p1'); S.deleteStack(st, 'p1', s.uid, 'trash', 'battle'); await drain(st); eq('memory +1 on deletion', mem(st, 'p1') - m0, 1); }
});

const { fail } = await runAll('qa-slice1-r2-a'); process.exit(fail ? 1 : 0);
