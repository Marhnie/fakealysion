// Shard 47 — CS (「CS」 trait) special-evolution audit fixes. See docs/verify-cs-evolution.md.
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};

const C = (id) => S.card(id);
const fn = (f) => ({ op: 's47_fn', fn: f });
OPS.s47_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
// same lead-stripping as shard38: the HK path queues the WHOLE printed body, only the part after the first "…때," is the effect
const stripLead = (t) => { const m = String(t).match(/^[^]*?(?:했을|되었을|놓였을|늘어났을|줄어들었을|벗어날|소멸할)\s*때,\s*([^]*)$/); return m ? m[1] : t; };
const hk = (id, d) => {
  (HOOKS[id] ||= []).push(d);
  SCRIPTS[`${id}::${d.tag}@${d.has}`] = [fn(async (ctx, R) => { await R.runScript(R.compileToScript(stripLead(ctx.trigger?.text || '')), ctx); })];
};
const csDigimonAdded = (state, hp, holder, info) => info.stack === holder && info.owner === hp && (info.added || []).some((id) => C(id).category === 'digimon' && (C(id).types || []).includes('CS'));

// BT22-043 (effect): 【자신의 턴】[턴 1회] 이 디지몬의 진화원에 특징 「CS」를 가진 디지몬 카드가 효과로 놓였을 때, 자신의 테이머가 1명 이하라면, 자신의 패에서 특징 「CS」를 가진 테이머 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
// (no watcher existed: the effect never triggered)
hk('BT22-043', { tag: '자신의 턴', has: '진화원에 특징 「CS」를 가진 디지몬 카드가 효과로', limit: 1, events: { sourcesAdded: csDigimonAdded } });
// BT26-054 (effect): 【서로의 턴】[턴 1회] 이 디지몬의 진화원에 특징 「CS」를 가진 디지몬 카드가 효과로 놓였을 때, 이 디지몬을 패의 특징 「CS」를 가진 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
hk('BT26-054', { tag: '서로의 턴', has: '진화원에 특징 「CS」를 가진 디지몬 카드가 효과로', limit: 1, events: { sourcesAdded: csDigimonAdded } });
