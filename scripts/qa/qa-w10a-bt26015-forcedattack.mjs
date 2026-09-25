// Wave 10 sub-slice A (official Q&A ids 6801-6980, array index 6004-6172 of data/rulings/all.json).
// Q&A 6972 (BT26-015 부텐몬): "このカードの【自分のターン】効果で、DPをプラスしたあとに、そのデジモンでアタックしないことは
// できますか？" -> "いいえ、できません。この効果でDPをプラスしたデジモンは、可能な限りアタックします。"
// The Digimon boosted by the "덱이 자신의 효과로 늘어났을 때, ... DP +3000 하고, 그 디지몬으로 어택할 수 있다" effect
// must attack whenever legally possible -- it is not an optional prompt. src/cards/shard46.js previously gated the
// attack behind ctx.choose('confirmEffect', ...), letting the player decline.
import { S, Fx, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

T(6972, 'BT26-015: DP+3000 받은 디지몬은 가능한 한 강제로 어택한다 (거부 불가)', async () => {
  const st = mk();
  const s = put(st, 'p1', 'BT26-015', {});
  s.suspended = false;
  const script = Fx.lookupCardSpecific('BT26-015', ['자신의 턴']);
  ok('스크립트 존재', !!script);
  let attacked = null;
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT26-015', sourceStackUid: s.uid,
    startAttack(p, uid, target, opts) { attacked = { p, uid, target, opts }; },
    choose: async (k, o) => {
      if (k === 'pickStack') return o.uids?.[0] ?? null;
      if (k === 'confirmEffect') return false; // even if something still asks, declining must not skip the attack
      return null;
    },
  };
  await Fx.runScript(script, ctx);
  eq('DP +3000 적용됨', S.effectiveDP(st, 'p1', s), S.card('BT26-015').dp + 3000);
  ok('플레이어가 어택을 거부할 수 없어야 함 (강제)', !!attacked && attacked.uid === s.uid);
});

T('6972b', 'BT26-015: 대상 디지몬이 레스트 상태라면 (어택 불가능하므로) 강제 어택을 시도하지 않는다', async () => {
  const st = mk();
  const s = put(st, 'p1', 'BT26-015', {});
  s.suspended = true;
  const script = Fx.lookupCardSpecific('BT26-015', ['자신의 턴']);
  let attacked = null;
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT26-015', sourceStackUid: s.uid,
    startAttack(p, uid, target, opts) { attacked = { p, uid, target, opts }; },
    choose: async (k, o) => (k === 'pickStack' ? o.uids?.[0] ?? null : null),
  };
  await Fx.runScript(script, ctx);
  eq('DP +3000은 여전히 적용됨', S.effectiveDP(st, 'p1', s), S.card('BT26-015').dp + 3000);
  ok('레스트 상태이므로 어택 시도 없음', !attacked);
});

await runAll('qa-w10a-bt26015-forcedattack');
