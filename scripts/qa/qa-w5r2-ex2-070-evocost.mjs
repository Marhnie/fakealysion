// Official Q&A ids 3354-3360 (EX2-070 초진화 플러그인 S): 「패의 진화 코스트 3 이하로 진화할 수 있는 디지몬 카드」는 *진화* 코스트(진화 조건의 코스트)가 3 이하인 카드이지
// 등장 코스트가 아니다. 진화 코스트 4 이상이 되는 진화(다른 진화 조건)는 불가, 진화 코스트 마이너스 효과는 카드를 고르는 시점에 반영하지 않는다(printed cost 기준).
import { S, E, Fx, C, mk, put, setHand, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const digis = Object.values(S.CARDS).filter(c => c.category === 'digimon' && !c.isParallel);
const vanillaLv4 = digis.filter(c => c.level === 4 && c.colors.length === 1 && !c.effectKo && !c.inheritedKo && c.dp);
function findPair(pred) { for (const src of vanillaLv4) for (const t of digis) { if (t.level !== 5 || t.dual) continue; const chk = E.canEvolveAny(src.id, t.id, [], null); if (chk.ok && pred(chk.cost, t)) return [src.id, t.id]; } return null; }
const cheapEvoPricey = findPair((cost, t) => cost <= 3 && (t.cost || 0) > 3 && !t.effectKo.includes('진화'));
const dearEvo = findPair((cost, t) => cost >= 4 && (t.cost || 0) <= 99);
const script = () => Fx.compileToScript(S.parseEffectSegments(C('EX2-070').effectKo).segments.find(s => s.tags.includes('메인')).body);
async function run(st, srcId, handIds) {
  const s = put(st, 'p1', srcId); setHand(st, 'p1', handIds); st._qaAns = { pickStack: () => s.uid };
  const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX2-070', sourceStackUid: null, trigger: {}, choose: makeChoose(st) };
  await Fx.runScript(script(), ctx); return s;
}
T(3354, 'EX2-070: 진화 코스트 3 이하인 카드는 등장 코스트가 높아도 진화할 수 있다', async () => {
  ok('픽스처 발견', !!cheapEvoPricey); const [src, tgt] = cheapEvoPricey;
  const st = mk(); const s = await run(st, src, [tgt]);
  eq('진화 완료', s.cardId, tgt);
});
T('3360', 'EX2-070: 진화 코스트가 4 이상인 카드는 진화할 수 없다', async () => {
  ok('픽스처 발견', !!dearEvo); const [src, tgt] = dearEvo;
  const st = mk(); const s = await run(st, src, [tgt]);
  eq('진화 안 함', s.cardId, src);
});
await runAll('qa-w5r2-ex2-070');
