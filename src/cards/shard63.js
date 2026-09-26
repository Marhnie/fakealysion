// Shard 63 — official Q&A (slice 3) conformance fixes for cards whose continuous text had no descriptor.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }

// EX7-023 헥세블라우몬 【상대의 턴】 진화원 매수가 이 디지몬 이하의 상대의 디지몬 전부는 레스트할 수 없다. (Q3844: evaluated live -- a Digimon that later gets more sources than this one can rest again)
D('EX7-023', '상대의 턴', '레스트할 수 없다', { restLock: (state, hp, h, target) => isDig(target) && (target.sources || []).length <= (h.sources || []).length });
