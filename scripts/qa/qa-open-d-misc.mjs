// open-d (4)/(5): BT14-030 sees bespoke bounces, AD1-025's option destroy, data typo corrections.
// Run: node scripts/qa/qa-open-d-misc.mjs < /dev/null
import { S, E, Fx, C, mk, put, FILL, secN, drain, resolved, stackOf, T, eq, ok, runAll } from './lib-s1.mjs';
const fired = (st, id, tag = null) => resolved(st).filter((r) => r.cardId.split('~')[0] === id && (!tag || (r.tags || []).includes(tag))).length;
const optId = Object.values(S.CARDS).find((c) => c.category === 'option' && !c.isParallel).id;

T('od-bt14030', 'BT14-030: a digimon returned to hand by a BESPOKE bounce (card script splices pl.battle itself) still triggers it', async () => {
  const st = mk(); put(st, 'p1', 'BT14-030'); put(st, 'p1', FILL); const b = put(st, 'p2', FILL); secN(st, 'p1', 2);
  const pl = st.players.p2; pl.battle.splice(pl.battle.indexOf(b), 1); pl.hand.push(b.cardId); // what shard4/7/8/11 bespoke bounces do
  S.flushLeaves(st); await drain(st);
  eq('fired', fired(st, 'BT14-030', '자신의 턴'), 1); eq('recovered', st.players.p1.security.length, 3);
});
T('od-bt14030-neg', 'BT14-030: a deletion via a bespoke path does not trigger it', async () => {
  const st = mk(); put(st, 'p1', 'BT14-030'); const b = put(st, 'p2', FILL); secN(st, 'p1', 2);
  const pl = st.players.p2; pl.battle.splice(pl.battle.indexOf(b), 1); pl.trash.push(b.cardId); S.flushLeaves(st); await drain(st);
  eq('not fired', fired(st, 'BT14-030', '자신의 턴'), 0);
});
T('od-ad1025', 'AD1-025: an opposing digimon leaves -> ALSO destroys 1 opposing battle-area option, and trashes the top security', async () => {
  const st = mk(); put(st, 'p1', 'AD1-025'); const d = put(st, 'p2', FILL); const o = put(st, 'p2', optId); secN(st, 'p2', 3);
  S.deleteStack(st, 'p2', d.uid, 'trash', 'effect'); await drain(st);
  ok('option destroyed', !stackOf(st, 'p2', o.uid) && st.players.p2.trash.includes(optId)); eq('security -1', st.players.p2.security.length, 2);
});
T('od-ad1025-noopt', 'AD1-025: no opposing option -> still trashes the top security', async () => {
  const st = mk(); put(st, 'p1', 'AD1-025'); const d = put(st, 'p2', FILL); secN(st, 'p2', 3);
  S.deleteStack(st, 'p2', d.uid, 'trash', 'effect'); await drain(st); eq('security -1', st.players.p2.security.length, 2);
});
T('od-typos', 'BT9-055 / BT10-026 / AD1-024 card-text typos corrected (data/ko-corrections.json via build-cards)', async () => {
  ok('BT9-055 evolves from 그랜쿠가몬', /「그랜쿠가몬」에서 1/.test(S.card('BT9-055').effectKo) && !/그랑쿠가몬/.test(S.card('BT9-055').effectKo));
  ok('BT10-026 trait spelling + 때', /「블루 플레어」/.test(S.card('BT10-026').effectKo) && !/떄/.test(S.card('BT10-026').effectKo));
  ok('AD1-024 name/reference', S.card('AD1-024').nameKo === '황제드라몬: 파이터 모드' && /「황제드라몬: 드래곤 모드」/.test(S.card('AD1-024').effectKo));
  ok('every referenced name exists', [['그랜쿠가몬'], ['황제드라몬: 드래곤 모드'], ['데커드라몬']].every(([n]) => Object.values(S.CARDS).some((c) => c.nameKo === n)));
});
T('od-egg-isdig', 'shard7/shard14 stack-based digimon checks see a battle-area Digi-Egg (EX2-007)', async () => {
  const { HOOKS } = await import('../../src/cards/index.js');
  const st = mk(); const h = put(st, 'p1', 'BT25-028'); const egg = put(st, 'p1', 'EX2-007'); const dig = put(st, 'p1', FILL); S.isDigimonLike(egg); // binds the state
  ok('egg is digimon-like in battle', S.isDigimonLike(egg));
  const d = HOOKS['BT25-028'].find((x) => x.events && x.events.play);
  ok('hook accepts the egg', !!d.events.play(st, 'p1', h, { stack: egg, owner: 'p1' })); ok('hook accepts a digimon', !!d.events.play(st, 'p1', h, { stack: dig, owner: 'p1' }));
});
runAll('qa-open-d-misc');
