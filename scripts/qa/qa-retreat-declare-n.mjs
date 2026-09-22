// 16-12-1: 《퇴화 N》(N>=2, 단일 선언)은 1~N장 중 원하는 매수를 선언할 수 있다. "X마다 《퇴화 1》"처럼 반복되는 카드는
// 매번 1장뿐이라 선언 단계가 없다(공식 Q&A Q2437/Q2982: 《퇴화 N》≠≪퇴화 1≫을 N번). 이 시험은 진짜 단일 《퇴화 N》 카드인
// EX11-045만 다룬다 — 반복형(BT18-052 등)에는 선언 단계를 넣으면 안 된다(수정 후 되돌린 케이스, 회귀 방지 목적).
// Run: node scripts/qa/qa-retreat-declare-n.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, 'EX11-045 《퇴화 2》: 2장보다 적게(1장) 선언하면 1장만 파기된다', async () => {
  const st = mk(); put(st, 'p1', 'EX11-045');
  const target = put(st, 'p2', 'ST4-09', { src: [FILL, 'ST1-05'] }); // Lv.5 top, 소스 배열 끝(=먼저 벗겨짐) Lv.4 → 다음 Lv.3: 2단계까지 퇴화 가능
  const { SCRIPTS } = await import('../../src/cards/shard7.js');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'EX11-045',
    choose: async (k, o) => {
      if (k === 'pickStack') return o.uids[0];
      if (k === 'multipleChoice' && /퇴화/.test(o.prompt || '')) return 0; // "1장" 선택 (2장 중 1장만)
      return null;
    } };
  await SCRIPTS['EX11-045::등장 시'][0].fn(ctx);
  eq('선언한 대로 1장만 퇴화(진화원 1장 남음)', target.sources.length, 1);
});
T(2, 'EX11-045 《퇴화 2》: 그대로(2장) 선언하면 2장 파기된다', async () => {
  const st = mk(); put(st, 'p1', 'EX11-045');
  const target = put(st, 'p2', 'ST4-09', { src: [FILL, 'ST1-05'] });
  const { SCRIPTS } = await import('../../src/cards/shard7.js');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'EX11-045',
    choose: async (k, o) => { if (k === 'pickStack') return o.uids[0]; if (k === 'multipleChoice' && /퇴화/.test(o.prompt || '')) return 1; return null; } };
  await SCRIPTS['EX11-045::등장 시'][0].fn(ctx);
  eq('선언한 대로 2장 퇴화(진화원 0장 남음)', target.sources.length, 0);
});
await runAll('qa-retreat-declare-n');
