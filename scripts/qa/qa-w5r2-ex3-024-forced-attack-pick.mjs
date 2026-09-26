// Official Q&A ids 3397/3398 (EX3-024 슬레이어드라몬 【상대의 메인 페이즈 개시 시】): the opponent chooses one of ITS digimon to attack — a digimon that "cannot attack" is a legal choice
// (the effect then ends without an attack), and with no opposing digimon at all the effect just ends. (It used to filter the choices to attack-capable digimon only.)
import { S, E, Fx, C, mk, put, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
async function fire(st, pick) {
  const seg = S.parseEffectSegments(C('EX3-024').effectKo).segments.find(s => s.tags.includes('상대의 메인 페이즈 개시 시'));
  const script = Fx.lookupCardSpecific('EX3-024', seg.tags, seg.body, false);
  const atk = []; const base = makeChoose(st); const offered = [];
  const me = st.players.p1.battle.find(s => s.cardId === 'EX3-024');
  const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX3-024', sourceStackUid: me.uid, trigger: {}, startAttack(p, uid) { atk.push([p, uid]); },
    choose: async (k, o) => { if (k === 'pickStack' && o.player === 'p2') { offered.push(o.uids.slice()); return pick(o.uids); } return base(k, o); } };
  await Fx.runScript(script, ctx); return { atk, offered };
}
T(3397, 'EX3-024: 어택할 수 없는 디지몬도 선택할 수 있고, 고르면 어택 없이 끝난다', async () => {
  const st = mk(); put(st, 'p1', 'EX3-024'); const can = put(st, 'p2', lv(4)), cant = put(st, 'p2', lv(3)); cant.cannotAttackUntil = 'permanent';
  const r = await fire(st, () => cant.uid);
  ok('어택 불가 디지몬도 후보', r.offered[0]?.includes(cant.uid)); eq('어택 없음', r.atk.length, 0);
  const st2 = mk(); put(st2, 'p1', 'EX3-024'); const can2 = put(st2, 'p2', lv(4)), cant2 = put(st2, 'p2', lv(3)); cant2.cannotAttackUntil = 'permanent';
  const r2 = await fire(st2, () => can2.uid); eq('어택 가능 디지몬을 고르면 어택', r2.atk.length, 1); eq('그 디지몬', r2.atk[0][1], can2.uid);
});
T(3398, 'EX3-024: 상대 디지몬이 없으면 어택 없이 끝난다', async () => {
  const st = mk(); put(st, 'p1', 'EX3-024'); const r = await fire(st, (u) => u[0]); eq('어택 없음', r.atk.length, 0);
});
await runAll('qa-w5r2-ex3-024');
