// Official Q&A id 3448 (EX4-011 카오스듀크몬 【자신의 턴 종료 시】): 진화원을 가진 「듀크몬」 디지몬을 소멸시킨 뒤에도 「등장시킬 수 있다」이므로 이 카드를 등장시키지 않을 수 있다.
import { S, E, Fx, C, mk, put, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
async function run(st, play) {
  const seg = S.parseEffectSegments(C('EX4-011').effectKo).segments.find(s => s.tags.includes('자신의 턴 종료 시'));
  const script = Fx.lookupCardSpecific('EX4-011', seg.tags, seg.body, false); const base = makeChoose(st); let asked = 0;
  await Fx.runScript(script, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX4-011', sourceStackUid: null, trigger: {}, choose: async (k, o) => { if (k === 'confirmEffect') { asked++; return asked === 1 ? true : play; } return base(k, o); } });
}
const duke = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo.includes('듀크몬') && c.id !== 'EX4-011' && c.dp && !c.isParallel)?.id;
const src = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
T(3448, 'EX4-011: 소멸시킨 뒤 등장을 거절할 수 있다 / 수락하면 등장', async () => {
  let st = mk(); put(st, 'p1', duke, { src: [src] }); st.players.p1.trash = ['EX4-011']; await run(st, false);
  eq('듀크몬은 소멸', st.players.p1.battle.some(s => s.cardId === duke), false); eq('카오스듀크몬은 트래시에 남음', st.players.p1.trash.includes('EX4-011'), true);
  st = mk(); put(st, 'p1', duke, { src: [src] }); st.players.p1.trash = ['EX4-011']; await run(st, true);
  eq('수락하면 등장', st.players.p1.battle.some(s => s.cardId === 'EX4-011'), true);
});
await runAll('qa-w5r2-ex4-011');
