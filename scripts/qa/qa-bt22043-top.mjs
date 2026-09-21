// BT22-043 진화원 【메인】: 「CS」 디지몬의 최상단 카드가 진화원 맨 아래로 가고 다음 카드가 최상단이 된다 + 《1 드로우》 (공식 영문: top stacked card as its bottom digivolution card)
import { S, FILL, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, 'BT22-043 inherited: top card -> bottom of sources, next becomes top, draw 1', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5; st.players.p1.deck = Array(10).fill(FILL);
  const h = put(st, 'p1', 'BT23-027', { src: [FILL, 'BT22-043'] }); // top = 엔젤몬(CS), sources bottom→top: FILL, BT22-043
  const ab = S.activatableMainAbilities(st, 'p1', h, 'battle').find(a => a.cardId === 'BT22-043');
  ok('ability offered', !!ab);
  const h0 = st.players.p1.hand.length;
  st.pending.push({ uid: 'm', player: 'p1', cardId: ab.cardId, stackUid: h.uid, tags: ab.tags, text: ab.text, resolved: false });
  await drain(st);
  eq('new top card', h.cardId, 'BT22-043'); eq('sources', h.sources, ['BT23-027', FILL]); eq('drew 1', st.players.p1.hand.length - h0, 1);
});
T(2, 'BT22-044 top effect: CS digimon card placed under it by effect -> memory +1', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5; st.memory = 0; st.players.p1.deck = Array(10).fill(FILL);
  const h = put(st, 'p1', 'BT22-044', { src: ['BT23-027'] }); // Palmon on top (traits unknown) — its own effect needs the card added to be CS
  const before = st.memory;
  S.emitGameEvent(st, 'sourcesAdded', { owner: 'p1', stack: h, cause: 'effect', added: ['BT23-027'], srcPlayer: 'p1', srcCategory: 'digimon' });
  await drain(st);
  eq('memory +1', st.memory - before, 1);
});
await runAll('qa-bt22043-top');
