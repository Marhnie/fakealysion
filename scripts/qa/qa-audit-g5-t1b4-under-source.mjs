// Audit batch g5/tier1_batch4 (EX10-056 바그라몬): official Q5145 — when this card's 【등장 시】/【진화 시】 effect places an
// opponent's Digimon under another opponent Digimon's/Tamer's evolution sources, the moved Digimon leaves the battle area as
// a single card: its OWN evolution sources are discarded to the trash at the same time, not carried along under the target.
// Bug found: src/cards/shard6.js's moveStackUnder() (shared by several "place this stack under another's sources" cards)
// spliced `[...from.sources, from.cardId]` into the destination — i.e. it dragged the moved Digimon's whole material pile
// along. Fixed by adding a dedicated moveOnlyUnder() for EX10-056's forced-under-opponent effect that trashes from.sources
// and only moves the single top card.
import { S, E, Fx, FILL, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';

T(5145, 'EX10-056: opponent Digimon forced under another opponent Digimon only moves 1 card (its own sources are trashed)', async () => {
  const st = mk();
  const from = put(st, 'p2', FILL, { src: [FILL, FILL] }); // 2 evolution sources of its own
  const to = put(st, 'p2', FILL, { src: [FILL] }); // already has 1 source stacked
  st.players.p1.hand.push('EX10-056');
  st.memory = 20;
  const s = await (async () => { const r = S.playDigimonFresh(st, 'p1', st.players.p1.hand.indexOf('EX10-056')); return r; })();
  ok('EX10-056 played', !!s);
  await drain(st);
  ok('「from」디지몬이 배틀 에어리어를 벗어남', !st.players.p2.battle.includes(from));
  eq('「to」의 진화원에 1장만 추가됨 (from 자신만, 진화원은 안 딸려옴)', to.sources.length, 2);
  eq('「to」 진화원 맨 아래는 from 자신의 카드', to.sources[0], FILL);
  ok('from 의 원래 진화원 2장은 트래시로 (딸려오지 않음)', st.players.p2.trash.filter(id => id === FILL).length >= 2);
});
T(5146, 'EX10-056: placing the opponent Digimon under an opponent TAMER still just adds it as a source (no special tamer-only rule broken)', async () => {
  const st = mk();
  const from = put(st, 'p2', FILL, { src: [FILL] });
  st.players.p2.battle.push((() => { const s = S._s4.makeStack(Object.values(S.CARDS).find(c => c.category === 'tamer')?.id, 1); return s; })());
  const tamer = st.players.p2.battle[st.players.p2.battle.length - 1];
  st.players.p1.hand.push('EX10-056');
  st.memory = 20;
  S.playDigimonFresh(st, 'p1', st.players.p1.hand.indexOf('EX10-056'));
  await drain(st);
  ok('from이 벗어남', !st.players.p2.battle.includes(from));
  ok('테이머 아래에 카드가 1장 놓임 (from 자신만)', tamer.sources.length === 1 && tamer.sources[0] === FILL);
});
await runAll('qa-audit-g5-t1b4-under-source');
