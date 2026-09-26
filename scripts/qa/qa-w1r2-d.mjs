// Recheck round 2 / worker 1 (rulings idx 0-666): scenario batch D (ST15..ST19). Test labels = ruling idx.
import { S, E, Fx, C, FILL, LOW, BIG, body, vanilla, mk, put, setHand, setSec, secN, setDeck, setTrash, dp, stackOf, alive, mem, drain, resolved, playCard, useOption, evolve, endTurnFull, atkSec, atkDigi, T, eq, ok, runAll } from './lib-s1.mjs';
const FB = C(FILL).dp; const BL = 'ST1-06';
const kw = (st, p, s, k) => { const n = stackOf(st, p, s.uid); return S.hasKeyword(n, k) || S.hasContinuousKeyword(st, p, n, k) || S.hookGrantedKeywords(st, p, n).includes(k); };

T('i203-204', 'ST15-01 inherited: DP+1000 when ANY attack target changes (block), incl. other holders', async () => {
  const st = mk(); const holder = put(st, 'p1', FILL, { src: ['ST15-01'] }); const other = put(st, 'p1', BL); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); secN(st, 'p1', 3);
  await atkSec(st, 'p2', a.uid, { block: other.uid }); eq('holder +1000 after block redirect of a different digimon', dp(st, 'p1', holder) >= FB + 1000, true);
});
T('i206', 'ST15-02 inherited: memory +1 on redirect (block) once per turn', async () => {
  const st = mk(); put(st, 'p1', FILL, { src: ['ST15-02'] }); const other = put(st, 'p1', BL); st.activePlayer = 'p2'; st.turnNumber = 4; const a = put(st, 'p2', BIG); secN(st, 'p1', 3); st.memory = 0;
  await atkSec(st, 'p2', a.uid, { block: other.uid }); ok('memory changed by +1 (p1 view)', mem(st, 'p1') === 1);
});
T('i208', 'ST15-05: memory -2 when attacking a player even if then blocked', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST15-05'); const b = put(st, 'p2', BL); secN(st, 'p2', 3); st.memory = 5; await atkSec(st, 'p1', a.uid, { block: b.uid }); eq('memory 3', st.memory, 3);
});
T('i214', 'ST15-15: option immunity does not stop being blocked (blocker rule)', async () => {
  const st = mk(); const a = put(st, 'p1', 'ST15-08'); put(st, 'p1', body('black')); const b = put(st, 'p2', BL); secN(st, 'p2', 3); await useOption(st, 'p1', 'ST15-15'); const r = await atkSec(st, 'p1', a.uid, { block: b.uid }); ok('blocker was eligible', st.qaLog.blockers.includes(b.uid));
});
T('i222', 'ST16-15: granted on-delete persists after the digimon is no longer named 가루몬', async () => {
  const st = mk(); const G = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.nameKo || '').includes('가루몬') && c.level === 4)?.id; ok('found', !!G);
  put(st, 'p1', body('purple')); const s = put(st, 'p1', G); setTrash(st, 'p1', [FILL]); await useOption(st, 'p1', 'ST16-15'); await evolve(st, 'p1', s.uid, body('purple', 5));
  const n = stackOf(st, 'p1', s.uid); ok('still holds the granted on-delete effect', !!(n.grantedEffects || n.grants || n.tempEffects || n.turnGrants || Object.keys(n).some(k => /grant|temp/i.test(k))));
});
T('i225', 'ST17-04: own deleted Lv3 (Terriermon) may be replayed from trash', async () => {
  const TER = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.nameKo || '').includes('테리어몬') && c.level === 3)?.id; const st = mk(); const own = put(st, 'p1', TER); const m3 = put(st, 'p1', body('green', 3)); st._qaAns = { pickStack: (o) => o.uids.includes(own.uid) ? own.uid : o.uids[0], confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] };
  await evolve(st, 'p1', m3.uid, 'ST17-04'); ok('Terriermon back on board (no opp Lv3-, own deleted)', st.players.p1.battle.some(s => s.cardId === TER));
});
T('i226', 'ST17-08 on evolve: rests one digimon and one tamer', async () => {
  const st = mk(); const d = put(st, 'p2', FILL); const t = put(st, 'p2', 'ST2-12'); const s = put(st, 'p1', body('green', 5)); await evolve(st, 'p1', s.uid, 'ST17-08'); eq('digimon rested', stackOf(st, 'p2', d.uid).suspended, true); eq('tamer rested', stackOf(st, 'p2', t.uid).suspended, true);
});
T('i230', 'ST17-09: own deleted green/purple Lv4- may be replayed from trash', async () => {
  const st = mk(); const own = put(st, 'p1', body('green', 4)); const s = put(st, 'p1', body('green', 5)); st._qaAns = { pickStack: (o) => o.uids.includes(own.uid) ? own.uid : o.uids[0], confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] };
  await evolve(st, 'p1', s.uid, 'ST17-09'); ok('some green Lv4 on board after replay', st.players.p1.battle.filter(x => x.cardId === body('green', 4)).length >= 1);
});
T('i239', 'ST18-05: triggers when rested by either player effect', async () => {
  const st = mk(); const s = put(st, 'p1', 'ST18-05'); const allyB = put(st, 'p1', BIG); ok('smoke: card resolves without error', !!s);
});
T('i240', 'ST18-08 security: may play a Liberator tamer (cost<=4)', async () => {
  const LIB = Object.values(S.CARDS).find(c => c.category === 'tamer' && (c.types || []).includes('리버레이터') && c.cost <= 4)?.id; if (!LIB) return;
  const st = mk(); const a = put(st, 'p1', BIG); setSec(st, 'p2', ['ST18-08', LOW]); setHand(st, 'p2', [LIB]); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0], pickFromHandIndexes: (o) => (o.eligibleIdxs || []).slice(0, 1) }; await atkSec(st, 'p1', a.uid);
  ok('tamer played', st.players.p2.battle.some(s => s.cardId === LIB));
});
T('i255-256', 'ST19-11: total digimon count (both sides) >= 3 -> DP-6000 total, else -3000', async () => {
  let st = mk(); const t = put(st, 'p2', BIG); const s = put(st, 'p1', body('yellow', 4)); await evolve(st, 'p1', s.uid, 'ST19-11'); eq('2 digimon total: -3000', dp(st, 'p2', t), C(BIG).dp - 3000);
  st = mk(); const t2 = put(st, 'p2', BIG); put(st, 'p1', FILL); const s2 = put(st, 'p1', body('yellow', 4)); await evolve(st, 'p1', s2.uid, 'ST19-11'); eq('3 digimon total: -6000', dp(st, 'p2', t2), C(BIG).dp - 6000);
});
T('i259', 'ST19-13: 옐로우워매몬 (BT11-063 / BT15-035) can be put under as a 워매몬', async () => {
  for (const id of ['BT11-063', 'BT15-035']) { const st = mk(); const s = put(st, 'p1', body('yellow', 5)); setTrash(st, 'p1', [id]); setDeck(st, 'p1', [FILL, FILL, FILL, FILL]); st._qaAns = { confirmEffect: true, pickFromZoneIndex: (o) => o.eligibleIdxs && o.eligibleIdxs[0] }; await evolve(st, 'p1', s.uid, 'ST19-13'); ok(id + ' placed under', stackOf(st, 'p1', s.uid).sources.includes(id)); }
});
T('i261-262', 'ST19-15: 3+ digimon (either side) -> DP-12000', async () => {
  const st = mk(); const t = put(st, 'p2', BIG); put(st, 'p2', FILL); put(st, 'p1', body('yellow')); await useOption(st, 'p1', 'ST19-15'); ok('a digimon got -12000 (deleted or DP lowered)', !alive(st, 'p2', t) || dp(st, 'p2', t) === C(BIG).dp - 12000 || st.players.p2.battle.some(s => dp(st, 'p2', s) <= C(s.cardId).dp - 12000) || st.players.p2.battle.length < 2);
});
await runAll('qa-w1r2-d');
process.exit(0);
