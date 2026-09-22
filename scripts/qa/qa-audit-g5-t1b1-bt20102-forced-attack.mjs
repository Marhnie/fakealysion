// Audit batch g5/tier1_batch1 — BT20-102 (오메가몬 X항체) official ruling Q4417/Q4419:
// its 【자신의 턴 종료 시】 "…속공을 얻고, 그 디지몬으로 레스트시키지 않고 어택할 수 있다" is NOT optional once
// granted — the Digimon must attack "as much as possible" (Q4417). Only WHICH Digimon receives the keyword is a
// real choice. Bug found: src/cards/shard14.js gated the ctx.startAttack() call behind an extra confirmEffect
// ask(), letting a player silently decline the mandatory attack. Fixed by dropping that ask() (the underlying
// attackFlow/declareAttack path already no-ops the attack if it's actually illegal — e.g. Q4419's "already
// mid-attack" case — so nothing else needs to change to keep that half correct).
// Run: node scripts/qa/qa-audit-g5-t1b1-bt20102-forced-attack.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll, endTurnFull } from './lib-s1.mjs';

T('4417', 'BT20-102 자신의 턴 종료 시: 속공 부여된 디지몬은 거부해도 강제로 어택한다', async () => {
  const st = mk();
  const me = put(st, 'p1', 'BT20-102');
  put(st, 'p2', FILL); // a legal attack target must exist
  // simulate the player declining every confirmEffect prompt (old buggy code asked "레스트시키지 않고 어택할까요?"
  // and would skip the attack on "no" — the fix removes that ask entirely so this must have no effect)
  st._qaAns = { confirmEffect: false };
  await endTurnFull(st);
  // (keyword itself is granted "until end of turn" and is swept away by clearExpiredModifiers once the turn
  // actually finishes, so checking it post-hoc here would be a test artifact, not a real assertion — the
  // load-bearing check is that ctx.startAttack still fired despite every confirmEffect prompt answering "no")
  ok('거부해도 강제로 어택 시도됨', (st._qaAtk || []).some(a => a.uid === me.uid && a.o && a.o.noRest));
});

T('4419a', 'BT20-102 2장: [턴에 1회]는 카드별로 각자 소비되고, 각자 강제로 어택을 시도한다', async () => {
  const st = mk();
  const a = put(st, 'p1', 'BT20-102');
  const b = put(st, 'p1', 'BT20-102');
  put(st, 'p2', FILL);
  let n = 0;
  // let the first trigger pick `a`, the second pick `b`, so both independently exercise the forced-attack path
  st._qaAns = { pickStack: () => (n++ === 0 ? a.uid : b.uid), confirmEffect: false };
  await endTurnFull(st);
  ok('둘 다 강제로 어택 시도됨', (st._qaAtk || []).some(x => x.uid === a.uid) && (st._qaAtk || []).some(x => x.uid === b.uid));
});

await runAll('qa-audit-g5-t1b1-bt20102-forced-attack');
