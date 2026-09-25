// Official Q&A (ruling id 5947, EX11-073 엑스마키나몬): "이 디지몬의 링크 카드 1장마다, 상대의 시큐리티를 위에서부터 1장
// 파기하고, 상대의 디지몬 1마리를 덱 아래로 되돌린다" is a "○○마다, △△하고, □□한다" effect. The Q&A spells out the
// resolution order explicitly: do △△ (discard security) once per ○○ (link card) FIRST, for all of them, THEN do □□
// (bounce a digimon) once per ○○, for all of them — never interleaved (△,□,△,□,…) per occurrence.
// Bug found in src/cards/shard7.js SCRIPTS['EX11-073::상대의 턴 종료 시']: a single loop did [discard, bounce] together
// per link card, i.e. interleaved. Fixed by splitting into two separate loops (all discards, then all bounces).
// Run: node scripts/qa/qa-slice-w5-ex11-073-link-order.mjs
import { S, E, put, drain, T, eq, runAll } from './lib-s1.mjs';

const XMAK = 'EX11-073';
const digi = (lv) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === lv && c.dp && !c.effectKo && !c.inheritedKo)[0]?.id;
const FILL = digi(3);

T(5947, 'EX11-073: 링크 카드 N장 -> 시큐리티 파기 N번을 전부 먼저, 그다음 디지몬 반환 N번 (교차 처리 금지)', async () => {
  const state = S.newGame({ name: 'A', main: {}, digitama: {} }, { name: 'B', main: {}, digitama: {} });
  for (const p of ['p1', 'p2']) { const pl = state.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.raising = null; }
  state.turnNumber = 3; state.activePlayer = 'p2'; state.phase = 'main'; state.memory = 0; state.pending = [];
  const h = put(state, 'p1', XMAK, {});
  h.linkCards = [{ cardId: FILL, grantedBy: null }, { cardId: FILL, grantedBy: null }]; // 2 link cards -> n=2
  state.players.p2.security = [FILL, FILL, FILL];
  for (let i = 0; i < 3; i++) put(state, 'p2', FILL, {}); // 3 opposing digimon, each a distinct bounce target
  // trashTopSecurityByEffect is a real ESM export (can't be monkeypatched/reassigned), so instead of spying on the call
  // directly, snapshot the opponent's remaining security count at the moment of each digimon-bounce PICK (pickStack ->
  // ctx.choose('pickStack', …)): if the two discards both run BEFORE either bounce (the ruled order), security should
  // already read 1 (3 - 2) by the very first bounce pick; the old interleaved code would still read 2 (3 - 1) then.
  const secAtPick = [];
  state._qaAns = { pickStack: (o) => { secAtPick.push(state.players.p2.security.length); return o.uids?.[0] ?? null; } };
  E.beginTurnEnd(state, false);
  await drain(state);
  eq('반환 선택 2회 발생', secAtPick.length, 2);
  eq('첫 번째 반환 선택 시점에 이미 시큐리티 2장 모두 파기되어 있어야 함 (파기 전부 먼저 처리)', secAtPick[0], 1);
  eq('두 번째 반환 선택 시점에도 동일 (추가 파기 없음)', secAtPick[1], 1);
  eq('시큐리티 2장 파기됨', state.players.p2.security.length, 1);
  eq('디지몬 2마리 반환됨 (배틀에 1마리 남음)', state.players.p2.battle.length, 1);
});
await runAll('qa-slice-w5-ex11-073-link-order');
