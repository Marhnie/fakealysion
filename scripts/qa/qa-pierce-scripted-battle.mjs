// Piercing (≪관통≫) bonus security check for card scripts that call S.resolveDigimonBattle
// directly for a "이 디지몬(과 상대의 디지몬 1마리로 배틀할 수 있다/으로 상대의 디지몬 1마리와 배틀할 수 있다)"
// ability (src/cards/shard8.js OPS.s8_battle, shard42.js EX12-052, shard130.js EX13-044/076/077,
// shard7.js BT25-020). Official Q&A attached to EX12-052/EX13-045/EX13-076 (docs/audit-rulings-g7.md
// section 3): winning such a scripted battle with ≪관통≫ must ALSO trigger the mandatory bonus
// security check (16-7-3/16-7-4) — capped at ONE check per attack even if the attack's own normal
// end-of-attack battle ALSO destroys the opponent with Piercing later in the same attack.
// Fixed via a new ctx.securityCheck driver capability (main.js / cpusim.js / qa libs) gated by
// S.consumePierceCheck (state.js) — see docs/audit-rulings-g7.md section 3 for the design writeup.
// Run: node scripts/qa/qa-pierce-scripted-battle.mjs < /dev/null
import { S, FILL, LOW, mk, put, setSec, drain, attack, T, eq, ok, runAll } from './lib-s1.mjs';

async function runSeg(st, p, stack, id, tagWanted) {
  const seg = S.parseEffectSegments(S.card(id).effectKo || '').segments.find((s) => s.tags.includes(tagWanted));
  if (!seg) throw new Error(`no segment ${tagWanted} on ${id}`);
  st.pending.push({ uid: 'q' + Math.random().toString(36).slice(2), player: p, cardId: id, stackUid: stack.uid, tags: seg.tags, text: seg.body, resolved: false, topId: stack.cardId });
  await drain(st);
}

T(1, 'EX12-052: 어택이 예약된(효과로 선언 직전) 이 디지몬의 스크립트 배틀이 ≪관통≫으로 승리하면 시큐리티 체크가 1회 발동한다 (EX13-045형, _effAtkQueued 보류)', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX12-052'); // 《관통》《볼텍스》, DP 12000
  a._effAtkQueued = true; // set by the driver's ctx.startAttack when the effect declared this digimon's attack but it has not started yet
  const o = put(st, 'p2', LOW);
  setSec(st, 'p2', [FILL, FILL, FILL]);
  await runSeg(st, 'p1', a, 'EX12-052', '카운터'); // state.attackCtx is null the whole time (attack still queued)
  ok('배틀에서 상대 디지몬 소멸', !st.players.p2.battle.includes(o));
  eq('≪관통≫ 시큐리티 체크 1회 (시큐리티 1장 소모)', st.players.p2.security.length, 2);
  eq('오류 없음', st._qaErr || [], []);
});

T('1b', 'W8 Q5959 (EX11-074): 어택하지 않는 디지몬(어택 없음 / 다른 디지몬의 어택 중)의 스크립트 배틀은 ≪관통≫ 체크를 발동하지 않는다', async () => {
  for (const mode of ['no attack', 'other digimon attacking']) {
    const st = mk();
    const a = put(st, 'p1', 'EX12-052');
    const other = put(st, 'p1', LOW);
    const o = put(st, 'p2', LOW);
    setSec(st, 'p2', [FILL, FILL, FILL]);
    if (mode !== 'no attack') st.attackCtx = { attacker: 'p1', opp: 'p2', uid: other.uid, targetKind: 'player' };
    await runSeg(st, 'p1', a, 'EX12-052', '카운터');
    ok(mode + ': 배틀에서 상대 디지몬 소멸', !st.players.p2.battle.includes(o));
    eq(mode + ': 시큐리티 체크 없음', st.players.p2.security.length, 3);
  }
});

T(2, 'EX12-052: 「카운터」 스크립트 배틀에 ≪관통≫이 없으면(가상: 상대 소멸 안 됨) 체크가 발동하지 않는다', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX12-052');
  const o = put(st, 'p2', 'EX13-077'); // DP 16000 > 12000+3000=15000: 이번엔 EX12-052가 패배(관통 무관)
  setSec(st, 'p2', [FILL, FILL, FILL]);
  await runSeg(st, 'p1', a, 'EX12-052', '카운터');
  ok('EX12-052가 배틀에서 패배', !st.players.p1.battle.includes(a));
  eq('시큐리티 소모 없음 (관통 유발 안 됨)', st.players.p2.security.length, 3);
});

T(3, 'EX12-052: 어택 시 스크립트 배틀(다른 상대 디지몬)로 ≪관통≫ 체크가 발동하면, 같은 어택의 자연스러운 종료 배틀이 또 상대를 소멸시켜도 2번째 체크는 발동하지 않는다 (16-7-3)', async () => {
  const st = mk();
  const a = put(st, 'p1', 'EX12-052'); // DP 12000 (+3000 이 효과로 → 15000), 관통
  const o1 = put(st, 'p2', LOW); // 어택 시 스크립트가 배틀할 대상 (digs() 순서상 먼저 고름)
  const o2 = put(st, 'p2', LOW); // 어택의 실제(선언된) 대상
  setSec(st, 'p2', [FILL, FILL, FILL]);
  const r = await attack(st, 'p1', a.uid, o2.uid); // 【어택 시】 트리거로 EX12-052 스크립트가 먼저 o1과 배틀, 그 후 어택 자체가 o2와 배틀
  ok('스크립트 배틀 대상(o1) 소멸', !st.players.p2.battle.includes(o1));
  ok('어택 대상(o2)도 배틀로 소멸', !st.players.p2.battle.includes(o2));
  eq('≪관통≫ 체크는 어택당 1회만 (시큐리티 1장만 소모)', st.players.p2.security.length, 2);
  eq('오류 없음', st._qaErr || [], []);
});

await runAll('qa-pierce-scripted-battle');
