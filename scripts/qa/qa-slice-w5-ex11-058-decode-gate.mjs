// Official Q&A (rulings ids 5911/5912, EX11-058 야오 친란): "《디코드》로 등장했었다면," gates the SAME 【서로의 턴】
// watcher segment as "자신의 디지몬이 등장/진화했을 때, …". Q5912: if the digimon later evolves (a SEPARATE trigger of
// the same watcher), the evolve-triggered instance must NOT satisfy the decode condition — only the entry-triggered
// instance does. Bug: stack.playedByKw is a persistent per-stack flag that survives evolution, so a naive
// `st.playedByKw === '디코드'` check alone can't tell "this trigger instance" (evtKind) apart from a later one.
// Run: node scripts/qa/qa-slice-w5-ex11-058-decode-gate.mjs
import { S, Fx, T, eq, runAll } from './lib-s1.mjs';

const EX = 'EX11-058';
const segBody = () => {
  const { segments } = S.parseEffectSegments(S.card(EX).effectKo);
  const seg = segments.find(s => s.tags.length === 1 && s.tags[0] === '서로의 턴');
  if (!seg) throw new Error('EX11-058: 【서로의 턴】 segment not found (card text may have changed)');
  return seg.body;
};
// parseWatcherTrigger folds the "《디코드》로 등장했었다면," continuation line into the watcher's effect text, and
// compileToScriptCore wraps it as {op:'condition', if:{test}} — pull that node out of the compiled script.
T(5912, 'EX11-058: 《디코드》 조건은 등장(play) 트리거에서만 만족하고, 같은 워처의 진화(digivolve) 트리거에서는 만족하지 않는다', async () => {
  const ops = Fx.compileToScript(segBody());
  const gate = ops.find(o => o.op === 'condition');
  if (!gate) throw new Error('컴파일 결과에 디코드 게이트(condition) 노드가 없음 — 카드 텍스트/컴파일러 변경 확인 필요');
  const state = S.newGame({ name: 'A', main: {}, digitama: {} }, { name: 'B', main: {}, digitama: {} });
  const dig = S._s4.makeStack('EX11-002', 1); dig.playedByKw = '디코드'; // entered via 《디코드》
  state.players.p1.battle.push(dig);
  const ctxPlay = { state, self: 'p1', trigger: { evtKind: 'play', evtStackUid: dig.uid } };
  const ctxEvo = { state, self: 'p1', trigger: { evtKind: 'digivolve', evtStackUid: dig.uid } };
  eq('play 트리거: 디코드 조건 만족', gate.if.test(ctxPlay), true);
  eq('digivolve 트리거(같은 스택, 같은 워처 재유발): 디코드 조건 불만족', gate.if.test(ctxEvo), false);
});
T('5912b', 'EX11-058: 《디코드》로 등장하지 않은 디지몬은 play 트리거에서도 조건 불만족', async () => {
  const ops = Fx.compileToScript(segBody());
  const gate = ops.find(o => o.op === 'condition');
  const state = S.newGame({ name: 'A', main: {}, digitama: {} }, { name: 'B', main: {}, digitama: {} });
  const dig = S._s4.makeStack('EX11-002', 1); // no playedByKw: plain play
  state.players.p1.battle.push(dig);
  const ctxPlay = { state, self: 'p1', trigger: { evtKind: 'play', evtStackUid: dig.uid } };
  eq('일반 등장: 디코드 조건 불만족', gate.if.test(ctxPlay), false);
});
await runAll('qa-slice-w5-ex11-058-decode-gate');
