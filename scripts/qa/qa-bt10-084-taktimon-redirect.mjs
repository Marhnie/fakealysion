// BT10-084 택티몬 【상대의 턴】 "효과로 자신의 다른 디지몬의 진화원을 파기할 때, 대신 이 디지몬의 진화원을 파기할 수 있다."
// Official ruling (rulings idx1364/id2002, idx1366/id2004): this replacement can be used even when 택티몬 itself has NO
// evolution sources (or fewer than the requested count) — trashEvoSources already clamps the count to what's actually
// there, so redirecting just discards as many as possible (0 is fine). The important effect is protecting the ORIGINAL
// target's sources from ever being touched.
// Regression: src/cards/shard2.js's sourceTrashRedirect() used to require `h.sources.length >= 1` before even OFFERING
// the redirect, so a source-less 택티몬 could never protect a teammate — contradicting the ruling.
// Run: node scripts/qa/qa-bt10-084-taktimon-redirect.mjs < /dev/null
import { S, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

T('BT10-084-a', '택티몬의 진화원이 0장이어도, 다른 자신의 디지몬의 진화원 파기 효과를 이 카드로 치환할 수 있다 (원래 대상은 보호됨)', async () => {
  const st = mk();
  const tak = put(st, 'p1', 'BT10-084', { src: [] });
  const other = put(st, 'p1', 'ST1-04', { src: ['ST1-02', 'ST1-02', 'ST1-02'] });
  st.activePlayer = 'p2'; // 【상대의 턴】
  st._fxSrc = { player: 'p2', category: 'digimon' };
  const removed = S.trashEvoSources(st, 'p1', other.uid, 3, 'top');
  st._fxSrc = null;
  eq('택티몬 진화원이 없으므로 0장만 파기됨', removed, []);
  eq('원래 대상 디지몬의 진화원은 그대로 3장', other.sources.length, 3);
  eq('택티몬 자신의 진화원도 그대로 0장', tak.sources.length, 0);
});

T('BT10-084-b', '택티몬의 진화원이 2장뿐이어도, "위에서 3장 파기" 효과를 치환하면 가능한 한(2장) 파기한다', async () => {
  const st = mk();
  const tak = put(st, 'p1', 'BT10-084', { src: ['ST1-02', 'ST1-04'] });
  const other = put(st, 'p1', 'ST1-04', { src: ['ST1-02', 'ST1-02', 'ST1-02'] });
  st.activePlayer = 'p2';
  st._fxSrc = { player: 'p2', category: 'digimon' };
  const removed = S.trashEvoSources(st, 'p1', other.uid, 3, 'top');
  st._fxSrc = null;
  eq('택티몬 진화원 2장 모두 파기됨', removed.length, 2);
  eq('원래 대상 디지몬의 진화원은 그대로 3장', other.sources.length, 3);
  eq('택티몬 자신의 진화원은 0장이 됨', tak.sources.length, 0);
});

await runAll('qa-bt10-084-taktimon-redirect');
