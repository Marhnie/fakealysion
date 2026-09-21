import re
p='src/state.js'
t=open(p,encoding='utf8').read()
a="""export function hookSuppressTrigger(state, tp, target, tag) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.suppressTrigger && d.suppressTrigger(state, hp, holder, tp, target, tag)) return true;
  return false;
}
"""
assert a in t
t=t.replace(a,a+"""// QA-S6 Q6792/6793 (EX12-036, BT26-028): 「【진화 시】 효과는 발휘하지 않는다」 also stops OTHER effects from resolving that stack's 【진화 시】 (borrowed / "발휘할 수 있다").
export function evoTrigSuppressed(state, p, stack) { return !!stack && ((stack.noEvoTrigUntil != null && state.turnNumber <= stack.noEvoTrigUntil) || hookSuppressTrigger(state, p, stack, '진화 시')); }
""",1)
open(p,'w',encoding='utf8').write(t)
p='src/cards/shard42.js'
t=open(p,encoding='utf8').read()
a="  const h = me(ctx);\n  if (!h) return;\n  const segs = S.parseEffectSegments(C(h.cardId).effectKo).segments.filter(s => s.tags.some(t => t.includes('진화 시')));"
assert a in t
t=t.replace(a,"  const h = me(ctx);\n  if (!h || S.evoTrigSuppressed(ctx.state, ctx.self, h)) return; // QA-S6 Q6792: 【진화 시】 suppressed\n  const segs = S.parseEffectSegments(C(h.cardId).effectKo).segments.filter(s => s.tags.some(t => t.includes('진화 시')));",1)
open(p,'w',encoding='utf8').write(t)
p='src/cards/shard52.js'
t=open(p,encoding='utf8').read()
a="  if (!st) return;\n  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `${C(st.cardId).nameKo}의 【진화 시】 효과 1개를 발휘할까요?` }))) return;"
assert a in t
t=t.replace(a,"  if (!st || S.evoTrigSuppressed(ctx.state, ctx.self, st)) return; // QA-S6 Q6792: 【진화 시】 suppressed\n  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `${C(st.cardId).nameKo}의 【진화 시】 효과 1개를 발휘할까요?` }))) return;",1)
open(p,'w',encoding='utf8').write(t)
print('ok')
