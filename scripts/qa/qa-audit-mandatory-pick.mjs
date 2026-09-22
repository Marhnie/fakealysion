// wrapChoose()가 【tag】 세그먼트 전체 텍스트로 "선택 가능 여부"를 추론하는데, 한 세그먼트 안에 필수 절과
// 선택 절이 섞여 있으면(AD1-024: "…레스트 시키고,"는 필수 / "…액티브 시킬 수 있다"는 선택) 전체가
// 선택 가능한 것으로 잘못 판단돼 필수 선택도 "대상 없음/취소"로 건너뛸 수 있었다 (g6-batch4 감사).
// Run: node scripts/qa/qa-audit-mandatory-pick.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, 'AD1-024: 대상이 있으면 레스트 선택을 취소(대상 없음)로 건너뛸 수 없다', async () => {
  const st = mk(); st.activePlayer = 'p2'; st.phase = 'main'; st.turnNumber = 5;
  put(st, 'p1', 'AD1-024');
  const opp1 = put(st, 'p2', FILL); const opp2 = put(st, 'p2', FILL);
  put(st, 'p2', FILL); // triggers the play event
  const { SCRIPTS } = await import('../../src/cards/shard7.js');
  let seenRequired = null;
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'AD1-024', trigger: { evt: {} },
    choose: async (k, o) => {
      if (k === 'pickStack' && o.fxKind === 'rest') { seenRequired = o.required; return o.uids[0]; }
      if (k === 'confirmEffect') return false; return null;
    } };
  await SCRIPTS['AD1-024::서로의 턴'][0].fn(ctx);
  eq('레스트 대상 선택에 required:true가 전달됨', seenRequired, true);
});

T(2, 'AD1-006: 발동을 수락했으면 카드를 최소 1장은 반드시 놓아야 한다(선택 안 함으로 건너뛸 수 없음)', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5;
  const tamerId = Object.values(S.CARDS).find(c => c.category === 'tamer')?.id;
  put(st, 'p1', tamerId);
  const srcCands = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes('크로스 하트')).slice(0, 2).map(c => c.id);
  st.players.p1.trash = srcCands.slice();
  const { SCRIPTS } = await import('../../src/cards/shard48.js');
  let seenRequired = null;
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'AD1-006', trigger: { evt: { sources: srcCands } },
    choose: async (k, o) => {
      if (k === 'confirmEffect') return true;
      if (k === 'pickFromZoneIndex') { if (seenRequired == null) seenRequired = o.required; return o.eligibleIdxs[0]; }
      return null;
    } };
  await SCRIPTS['AD1-006::서로의 턴'][0].fn(ctx);
  eq('첫 카드 선택에 required:true가 전달됨', seenRequired, true);
});

await runAll('qa-audit-mandatory-pick');
