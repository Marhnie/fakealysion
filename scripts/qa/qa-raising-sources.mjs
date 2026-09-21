// 3-4-7-5/-6: 육성 에어리어의 디지몬은 육성 에어리어를 지정/참조하지 않는 효과("자신의 디지몬의 진화원에서 …")의 대상이 아니다. Run: node scripts/qa/qa-raising-sources.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
import * as Fx from '../../src/effects.js';
const MINERAL = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('광물형'))?.id;
T(1, '자신의 디지몬의 진화원에서 카드 파기(P-167형): 육성 에어리어 디지몬의 진화원은 대상이 아니다', async () => {
  const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5; st.players.p1.deck = Array(10).fill(FILL);
  const a = put(st, 'p1', FILL, { src: [MINERAL] });
  const ra = S._s4.makeStack(FILL, 1); ra.sources = [MINERAL, MINERAL]; st.players.p1.raising = ra;
  const script = Fx.compileToScript('자신의 디지몬의 진화원에서 특징 「광물형」/「광석형」을 가진 카드 1장을 파기하는 것으로, 자신의 덱 위에서부터 3장 오픈한다.');
  ok('compiled', Array.isArray(script) && script.length > 0);
  const offered = [];
  const ctx = { state: st, S, E: null, self: 'p1', opp: 'p2', sourceCardId: FILL, sourceStackUid: a.uid, trigger: { text: '', tags: ['메인'], cardId: FILL, stackUid: a.uid, player: 'p1' }, startAttack() {}, attack: () => null, endAttack() {},
    choose: async (k, o) => { if (k === 'pickFromRevealed') offered.push((o.revealed || []).length); if (k === 'confirmEffect') return true; if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null; if (k === 'pickStack') return o.uids?.[0] ?? null; if (k === 'pickFromRevealed') return (o.eligible || []).slice(0, 1).map(x => x.i); if (k === 'pickSourcesMulti') return [0]; if (k === 'pickFromSources') return o.eligibleIdxs?.[0] ?? 0; return o && o.eligibleIdxs ? o.eligibleIdxs[0] : (o && o.entries && o.entries[0] ? 0 : null); } };
  await Fx.runScript(script, ctx);
  eq('후보는 배틀 에어리어 디지몬의 진화원 1장뿐', offered[0], 1);
  eq('육성 에어리어 진화원 그대로', ra.sources.length, 2);
  eq('배틀 에어리어 진화원 1장 파기', a.sources.length, 0);
});
await runAll('qa-raising-sources');
