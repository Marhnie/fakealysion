// W2 part1 audit fix verification: BT5-019 샤우트몬 DX has TWO separate 【진화 시】 segments
// ("《진격》(...)" and the "패의 레드 디지몬을 진화원 위에 놓고, 그 후 「오메가샤우트몬」/「지크그레이몬」 1장마다 소멸" effect).
// Before the fix, both segments shared the flat lookup key 'BT5-019::진화 시' and resolved to the
// SAME custom script (the placement/destroy one), so 《진격》 was never granted and the placement/destroy
// script ran twice instead of once. Run: node scripts/qa/qa-w2-part1-bt5-019-jingyeok.mjs < /dev/null
import { S, FILL, LOW, mk, put, setHand, evolve, T, eq, ok, runAll } from './lib-s1.mjs';

T('w2p1-bt5019-1', 'BT5-019: 진화 시 both 《진격》 grant and the placement/destroy effect fire exactly once each (not the destroy effect twice, not 진격 dropped)', async () => {
  const st = mk();
  const base = put(st, 'p1', FILL, { src: ['BT5-014'] }); // pre-existing source already has 「오메가샤우트몬」 -> k=1 destroy expected
  put(st, 'p2', LOW); put(st, 'p2', LOW); // two low-DP (<=5000) opponents so we can tell 1 destroy from 2
  setHand(st, 'p1', ['ST1-02']); // a red digimon card available to place on top of sources (should be offered, but declining is fine for this check)
  st.memory = -2; // opponent side by 2 -> 《진격》's "메모리가 상대측 1 이상" raid condition is met
  st._qaAns = { pickFromZoneIndex: () => null, pickStack: (o) => o.uids?.[0] ?? null }; // decline placing the red card so the destroy count is driven purely by the pre-existing source
  await evolve(st, 'p1', base.uid, 'BT5-019', 0, 'hand');
  const oppLeft = st.players.p2.battle.length;
  eq('exactly ONE opponent digimon destroyed (destroy op ran once, not twice)', oppLeft, 1);
  ok('《진격》 was granted and used to start a raid attack (memory favored opponent)', (st._qaAtk || []).length === 1);
});
await runAll('qa-w2-part1-bt5-019-jingyeok');
