// Official Q&A (ruling ids 6062/6063, AD1-006 샤우트몬X7): "이 디지몬의 진화원에서 특징 「크로스 하트」/「블루 플레어」를
// 가진 카드를 4장까지 테이머의 아래에 놓고, 1장을 코스트를 지불하지 않고 등장시킬 수 있다." The placed-under-tamer group
// and the free-summoned card share ONE pool of eligible source cards, consumed in order — placement (mandatory, min 1,
// whenever a Tamer exists) happens first and the summon draws from whatever is LEFT afterward, never from the cards
// that were just placed. Q6062: with exactly 1 eligible card and a Tamer present, that card is consumed by the
// mandatory placement, leaving nothing to summon. Q6063: with NO Tamer at all, placement is skipped entirely and the
// single eligible card can be summoned directly.
// Bug found in src/cards/shard48.js SCRIPTS['AD1-006::서로의 턴']: it placed cards under the Tamer and then re-picked
// the SUMMON target from that very same placed group (the opposite pool), and returned immediately with no Tamer at
// all (blocking the Q6063 case entirely).
// Run: node scripts/qa/qa-slice-w5-ad1-006-source-pool.mjs
import { S, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';

const SHOUT = 'AD1-006', XH_DIGI = 'BT10-007' /* 특징 「크로스 하트」디지몬 */, VANILLA_TAMER = 'P-242';

function mkState() {
  const state = S.newGame({ name: 'A', main: {}, digitama: {} }, { name: 'B', main: {}, digitama: {} });
  for (const p of ['p1', 'p2']) { const pl = state.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.raising = null; }
  state.turnNumber = 3; state.activePlayer = 'p2'; state.phase = 'main'; state.memory = 0; state.pending = [];
  state._qaAns = { confirmEffect: true };
  return state;
}

T(6062, 'AD1-006: 테이머 있음 + 진화원에 해당 카드 1장뿐 -> 그 카드는 테이머 아래에 놓이고, 등장은 불가', async () => {
  const state = mkState();
  put(state, 'p1', VANILLA_TAMER, {});
  const s = put(state, 'p1', SHOUT, { src: [XH_DIGI] }); // exactly 1 eligible source card
  S.deleteStack(state, 'p1', s.uid, 'trash', 'effect'); // leaves other than by DigiXros
  await drain(state);
  ok('배틀 에어리어에 소환되지 않음 (등장 불가)', !state.players.p1.battle.some(x => x.cardId === XH_DIGI));
  const tamer = state.players.p1.battle.find(x => x.cardId === VANILLA_TAMER);
  ok('테이머 아래에 그 카드가 놓임', !!tamer && tamer.sources.includes(XH_DIGI));
});

T(6063, 'AD1-006: 테이머가 전혀 없음 -> 진화원 카드 1장을 (테이머 아래에 놓는 절차 없이) 바로 등장시킬 수 있다', async () => {
  const state = mkState();
  const s = put(state, 'p1', SHOUT, { src: [XH_DIGI] }); // no tamer anywhere
  S.deleteStack(state, 'p1', s.uid, 'trash', 'effect');
  await drain(state);
  ok('배틀 에어리어에 바로 등장함', state.players.p1.battle.some(x => x.cardId === XH_DIGI));
});
await runAll('qa-slice-w5-ad1-006-source-pool');
