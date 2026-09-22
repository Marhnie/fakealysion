// g3 audit fix: "서로의 시큐리티를 위에서부터 N장 파기한다" (BT16-036/BT19-043/BT25-038 all print this exact
// wording) compiled to an EMPTY script — the compiler only recognised "양 측의" as "both sides", not "서로의"
// (they mean the same thing). Confirmed against official Q&A (BT16-036 id 2631): the effect still discards
// from whichever side has security even when the other side is at 0. Run: node scripts/qa/qa-audit-g3-mutual-security-trash.mjs < /dev/null
import { S, Fx, mk, put, setSec, LOW, T, eq, ok, runAll } from './lib-s1.mjs';

T('g3-2631a', '서로의 시큐리티 파기: 양쪽 다 시큐리티가 있으면 둘 다 1장씩 파기', async () => {
  const st = mk();
  setSec(st, 'p1', [LOW, LOW, LOW]);
  setSec(st, 'p2', [LOW, LOW]);
  const script = Fx.compileToScript('서로의 시큐리티를 위에서부터 1장 파기한다.');
  ok('script not empty', script.length === 2);
  const ctx = { state: st, S, self: 'p1', opp: 'p2', choose: async () => null };
  await Fx.runScript(script, ctx);
  eq('p1 security -1', st.players.p1.security.length, 2);
  eq('p2 security -1', st.players.p2.security.length, 1);
});

T('g3-2631b', '서로의 시큐리티 파기: 한쪽이 0장이어도 발동하고, 남은 쪽만 파기', async () => {
  const st = mk();
  setSec(st, 'p1', []);
  setSec(st, 'p2', [LOW]);
  const script = Fx.compileToScript('서로의 시큐리티를 위에서부터 1장 파기한다.');
  const ctx = { state: st, S, self: 'p1', opp: 'p2', choose: async () => null };
  await Fx.runScript(script, ctx);
  eq('p1 stays 0', st.players.p1.security.length, 0);
  eq('p2 security -1', st.players.p2.security.length, 0);
});

await runAll('qa-audit-g3-mutual-security-trash');
