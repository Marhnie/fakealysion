// g2 audit fix: the generic 'destroy' op computed "이 효과로 소멸하지 않았을 때" (EX2-012 메기드라몬 Q3302,
// BT9-017 듀크몬X항체 Q1814) by comparing the target player's battle-area length before/after — but when a
// ≪디코이≫/≪수호≫ replacement saves the SPECIFICALLY TARGETED stack by deleting a DIFFERENT stack instead, the
// battle-area length still shrinks by one, so the old code wrongly concluded "something was destroyed" and
// skipped the "이 효과로 소멸하지 않았을 때" follow-up. Official ruling: the follow-up must still fire, because
// the targeted Digimon itself survived. Fixed by tracking S.deleteStack's own return value (null = the targeted
// stack survived) instead of the battle-area length delta. Run: node scripts/qa/qa-audit-g2-destroy-decoy.mjs < /dev/null
import { S, Fx, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

// EX2-012 메기드라몬 【진화 시】 compiles to: destroy (dpMax 10000, opponent, choose) ; if 이 효과로 소멸하지
// 않았을 때 -> both decks lose the top 5 cards. BT6-059 마하몬 프린트 ≪디코이《블랙》≫ protects another black
// Digimon of the opponent's by deleting itself instead.
const SCRIPT = Fx.compileToScript(
  'DP 10000 이하의 상대 디지몬 1마리를 소멸시킨다. 이 효과로 상대의 디지몬이 소멸하지 않았을 때, 서로의 덱 위에서부터 5장 파기한다.'
);

function setup(st) {
  const holder = put(st, 'p2', 'BT6-059'); // 디코이《블랙》holder (black, DP 5000)
  const target = put(st, 'p2', 'ST5-02'); // black, DP 4000 <= 10000 — the effect's actual target
  for (const p of ['p1', 'p2']) st.players[p].deck = st.players[p].deck.length ? st.players[p].deck : [];
  return { holder, target };
}

T('g2-3302a', 'EX2-012류 DP소멸 효과: 디코이로 대상이 소멸하지 않으면 "소멸하지 않았을 때" 후속 효과가 발동한다', async () => {
  const st = mk({ me: 'p1' });
  const { holder, target } = setup(st);
  st._qaAns = { pickStack: (o) => (o.uids.includes(target.uid) ? target.uid : o.uids[0]) };
  const before1 = st.players.p1.deck.length, before2 = st.players.p2.deck.length;
  const { makeChoose } = await import('./lib-s1.mjs');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceStackUid: null, choose: makeChoose(st) };
  await Fx.runScript(SCRIPT, ctx);
  ok('target survived (decoy redirected)', st.players.p2.battle.some(s => s.uid === target.uid));
  ok('decoy holder died instead', !st.players.p2.battle.some(s => s.uid === holder.uid));
  eq('p1 deck lost 5 (follow-up fired)', st.players.p1.deck.length, Math.max(0, before1 - 5));
  eq('p2 deck lost 5 (follow-up fired)', st.players.p2.deck.length, Math.max(0, before2 - 5));
});

T('g2-3302b', 'EX2-012류 DP소멸 효과: 디코이가 없으면 대상이 실제로 소멸하고, 후속 효과는 발동하지 않는다', async () => {
  const st = mk({ me: 'p1' });
  const target = put(st, 'p2', 'ST5-02');
  const { makeChoose } = await import('./lib-s1.mjs');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceStackUid: null, choose: makeChoose(st) };
  const before1 = st.players.p1.deck.length, before2 = st.players.p2.deck.length;
  await Fx.runScript(SCRIPT, ctx);
  ok('target actually destroyed', !st.players.p2.battle.some(s => s.uid === target.uid));
  eq('p1 deck unchanged (no follow-up)', st.players.p1.deck.length, before1);
  eq('p2 deck unchanged (no follow-up)', st.players.p2.deck.length, before2);
});

await runAll('qa-audit-g2-destroy-decoy');
