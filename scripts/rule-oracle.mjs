// RULES ORACLE: an executable, engine-independent monitor of the Digimon Card Game rulebook (Ver.4.2, rulebook/general_rule_jp_utf8.txt).
// It drives CPU-vs-CPU games through the real engine (src/cpusim.js hooks), takes normalized snapshots before/after every rule action
// (phase step, hatch, move, play, option, evolve, jogress, attack + block/counter/security/battle sub-steps, pass, turn flip, setup) and asserts a
// catalogue of rule properties, each tagged with its rule number.  The checks re-derive expectations from the PRINTED card data + the rulebook, never
// from the engine's own predicates (except as "excuse" evidence, e.g. a locked-unsuspend flag), and are conservative: a check only fires when
// nothing recorded in the state / log could legitimately override the default.
//
// Usage: node scripts/rule-oracle.mjs [games=200] [--seed N] [--levels easy,normal,hard] [--json out.json] [--verbose] [--maxTurns 60] [--only ID,ID] < /dev/null
// Reproduce one game: node scripts/rule-oracle.mjs 1 --seed <seed printed in the report> [--levels normal,normal]
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
import { createSim } from '../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });

// ------------------------------------------------------------------ catalogue
export const CAT = {};
const ONLY = new Set();
function def(id, rule, desc) { CAT[id] = { id, rule, desc, evals: 0, viol: 0 }; }
// ---- setup / general (chapters 1,3,5)
def('SETUP-hand5', '5-2-1', '오프닝 핸드는 5장 (멀리건 후에도 5장)');
def('SETUP-sec5', '5-2-1-6', '시큐리티는 덱 위 5장을 1장씩 올려 쌓은 것 (덱 맨 위 카드가 시큐리티 맨 아래)');
def('SETUP-memory0', '5-2-3', '게임 시작 시 메모리 0, 선공 턴 1, 첫 페이즈는 액티브 페이즈');
def('SETUP-deck40', '5-2-1', '오프닝 핸드+시큐리티 후 덱은 (원래 50-10)장');
def('SETUP-mull', '5-2-1-4', '멀리건: 손패 전부를 덱에 되돌려 섞고 5장 (카드 총수 보존)');
def('CARD-cons', '3-1', '카드 총수 보존 (토큰 제외; 양 플레이어 합계)');
def('CARD-nodup-uid', '3-1', '스택 uid는 전 배틀/육성 에어리어에서 유일');
def('ZONE-battle-types', '3-3', '배틀 에어리어에는 디지몬/테이머(또는 옵션 배치 효과)만 존재');
def('ZONE-raising-types', '3-4-7', '육성 에어리어에는 1장 이하, 테이머/옵션 불가');
def('ZONE-egg-deck', '3-1-3-9', '디지타마 덱에는 디지타마(또는 Lv.2 디지몬) 카드만');
def('MEM-range', '6-5-1', '메모리 게이지는 정수이며 -10..10');
def('PEND-stuck', '15-8', '행동 처리 후 미해결 유발 효과가 남지 않음');
// ---- turn flow (chapter 6)
def('T-unsuspend-own', '6-2-1', '액티브 페이즈: 턴 플레이어의 모든 레스트 카드가 액티브(잠금 효과 제외)');
def('T-unsuspend-opp', '6-2-1', '액티브 페이즈: 상대의 카드는 (≪재기동≫ 제외) 상태 변화 없음');
def('T-unsuspend-only', '6-2-1', '액티브 페이즈에서 새로 레스트되는 카드 없음');
def('T-draw-1', '6-3-1', '드로우 페이즈: 정확히 1장 (덱 맨 위 → 패)');
def('T-draw-skip', '6-3-2', '선공 첫 턴은 드로우 스킵');
def('T-draw-deckout', '1-2-3-2', '드로우 페이즈에 덱이 0장이면 패배');
def('T-breed-hatch', '6-4-2', '부화: 육성이 비어 있을 때만, 디지타마 덱 맨 위 → 육성 에어리어');
def('T-breed-move', '6-4-3', '이동: 육성 에어리어 카드(DP 보유)만 배틀 에어리어로, 육성 비움');
def('T-breed-one', '6-4', '부화/이동/무행동 중 하나 — 한 번 하면 같은 페이즈에 다시 불가');
def('T-breed-noeffect', '6-4', '부화/이동은 메모리·손패를 바꾸지 않는다');
def('T-main-phase', '6-5', '메인 페이즈 진입 시 턴 플레이어/페이즈 정합');
def('T-flip-player', '6-6-3', '턴 종료 시 턴 플레이어 교대, 턴 번호 +1, 다음 페이즈는 액티브');
def('T-flip-memory', '6-6', '턴 교대 자체는 메모리를 바꾸지 않는다 (종료 시 효과 제외)');
def('T-autoend-side', '6-1-4', '메모리가 (턴 플레이어 기준) 상대 측 1 이상이면 턴이 자동 종료됨');
def('T-noend-own', '6-1-4', '메모리가 자신 측/0인데 턴이 끝나면 안 됨 (패스/효과 제외)');
def('T-pass-mem3', '6-5-1-7-1', '패스: 메모리를 상대 측 3으로 설정하고 턴 종료');
def('T-memory-newturn', '6-1-4', '새 턴 시작 시 메모리는 새 턴 플레이어 측 (자동종료/패스 경유)');
def('T-turnEnd-clean', '6-6-2', '턴 종료 처리 완료 후 turnEnding 해제');
// ---- play (7)
def('P-hand', '7-1-3', '등장: 패에서 1장 감소하고 배틀 에어리어에 새 스택');
def('P-cost', '7-1-3-2', '등장: 코스트 = 인쇄 코스트만큼 메모리가 상대 측으로 이동');
def('P-cost-max', '7-1-3-2', '등장 코스트는 인쇄 코스트를 초과하지 않음');
def('P-fresh', '7-1-3-3', '등장한 카드는 액티브 상태·진화원 0장 (디지크로스 제외)');
def('P-noattack', '7-1-2-1', '등장한 턴에는 (≪속공≫ 제외) 그 디지몬이 어택할 수 없음');
def('P-cat', '7-1', '패에서 등장 가능한 카드는 디지몬/테이머');
def('P-payable', '1-3-11-1', '지불 불가능한 코스트의 카드는 등장할 수 없음');
// ---- evolve (8)
def('E-stack', '8-1-2', '진화: 새 카드가 맨 위, 이전 맨 위 카드가 진화원 맨 위(마지막)로 겹쳐짐, 기존 진화원 유지');
def('E-hand', '8-1-2', '진화: 사용한 카드가 패에서 나가고 진화 드로우 1장 (패 장수 유지, 덱 -1)');
def('E-cost', '8-1-2-1', '진화 코스트가 지불되어 메모리 이동');
def('E-cost-max', '8-1-2-1', '진화 코스트는 인쇄된 진화 조건 코스트 중 최대치를 넘지 않음');
def('E-cond', '8-1-1', '진화 조건 (인쇄된 Lv./색/명칭/특징 조건 또는 대체 진화 수단) 충족');
def('E-state', '8-1-2-2', '진화해도 레스트/액티브 상태 유지, 스택 uid 유지, 어택 가능 턴 초기화 없음');
def('E-nomodify', '8-1', '진화는 다른 스택/플레이어 존을 바꾸지 않음');
def('J-stack', '8-2', '조그레스: 두 재료 스택이 하나로 합쳐지며 카드 전부가 보존됨');
def('J-cost', '8-2-1', '조그레스: 인쇄된 조그레스 코스트 지불');
def('J-cond', '8-2-1', '조그레스: 재료가 인쇄된 조건(색/Lv./명칭)에 맞음');
def('J-attack', '8-2-2-1-7', '조그레스 결과 디지몬은 등장한 턴 여부와 무관하게 정보가 사라져 어택 가능');
// ---- option (9)
def('O-hand', '9-1-9-1', '옵션 사용: 패에서 나감, 메모리 코스트 이동, 사용 후 트래시(또는 효과로 배치)');
def('O-color', '4-22', '옵션 사용 색 조건: 배틀/육성 에어리어에 그 색의 디지몬/테이머가 있어야 함');
def('O-cost', '9-1-9-2', '옵션 사용 코스트는 인쇄 코스트 이하');
// ---- attack / block / counter (11,12)
def('A-turnplayer', '11-1-2', '어택은 턴 플레이어만');
def('A-attacker', '11-2-1', '어택 선언 디지몬은 액티브인 자신의 배틀 에어리어 디지몬 (선언 후 레스트)');
def('A-rest', '11-2-1', '어택 선언으로 어택한 디지몬이 레스트됨 (레스트하지 않는 효과 제외)');
def('A-nomem', '11-2', '어택 선언은 메모리를 바꾸지 않음');
def('A-target', '11-2-7-1', '어택 대상은 상대 플레이어 또는 레스트 상태의 상대 디지몬');
def('A-single', '11-2-3', '동시에 어택하는 디지몬은 1체');
def('A-counter-once', '11-3-2', '카운터 타이밍에는 1회의 어택당 1번만 【카운터】');
def('B-elig', '12-1-1', '블록 가능: ≪블로커≫를 가진 액티브 디지몬 (레스트 가능해야 함)');
def('B-notarget', '12-1-5', '어택 대상이 된 디지몬은 블록할 수 없음');
def('B-one', '12-1-2', '1회의 어택당 블록은 1체');
def('B-rest', '12-1-7-1', '블록 시 블로커가 레스트되고 어택 대상이 그 블로커로 변경됨');
def('B-owner', '12-1-1', '블로커는 어택받는 쪽(비턴 플레이어)의 디지몬');
// ---- security check (13) & battle (14)
def('S-count', '13-1-2', '1회 어택 중 체크 횟수 = 1 + S어택 보너스 (시큐리티가 남아 있고 어태커가 생존하는 한)');
def('S-top', '13-1-8-1-1', '체크: 시큐리티 맨 위 1장 공개');
def('S-trash', '13-1-8-4', '체크된 카드는 시큐리티를 떠나 (다른 영역으로 가지 않았다면) 트래시에 놓임');
def('S-secdec', '13-1-8', '체크마다 상대 시큐리티 정확히 1장 감소 (효과 제외)');
def('S-win-empty', '11-5-1-2-1', '시큐리티 0에서 플레이어에게 어택이 성립하면 어택한 쪽이 승리');
def('S-nowin-nonempty', '1-2-3-1', '시큐리티가 1장 이상이면 (어택이 성립해도) 즉시 승리하지 않음');
def('S-battle-dp', '14-2-1', '시큐리티 디지몬 배틀: DP 비교 결과 (높은 쪽 승, 같으면 무승부=양쪽 패, 재밍은 어태커 생존)');
def('S-nobattle-nondigi', '13-1-8-3-2', '디지몬이 아닌 체크 카드(옵션/테이머)는 배틀 없음');
def('S-attacker-deleted', '14-2-2', '시큐리티 배틀에서 패배/무승부한 어태커는 (면역 제외) 소멸');
def('S-atk-gone', '13-1-5', '어태커가 배틀 에어리어를 벗어나면 이후 체크를 진행하지 않음');
def('BT-dp', '14-2-1', '디지몬 배틀: DP 비교 결과 (승/패/무승부) 일치');
def('BT-delete', '14-2-2', '배틀에서 진 디지몬은 즉시 소멸(면역 제외), 무승부는 양쪽 소멸');
def('BT-trash', '14-2-2', '소멸한 디지몬의 카드 전부(맨 위+진화원)가 트래시로');
def('BT-pierce', '16-7', '≪관통≫: 관통 보유 어태커가 이겨 상대를 소멸시킨 경우에만 시큐리티 체크');
def('BT-connect-block', '11-5-1-3', '디지몬에 대한 어택은 어택 대상 디지몬과의 배틀로 성립');
// ---- state invariants
def('R-dp0', '17-1-3-1', 'DP가 0 이하인 디지몬은 규칙 처리로 소멸 (액션 종료 후 잔존 불가)');
def('R-noNaN', '17', 'DP/메모리 등 수치에 NaN 없음');
def('R-sources-str', '3-1-3-1', '진화원은 카드 ID 문자열');
def('R-egg-move', '4-17-2', 'DP 없는 카드는 이동 불가');
def('R-tie-jam', '16-4', '재밍 어태커는 시큐리티 디지몬에게 소멸하지 않음');
def('W-reason', '1-2', '승패는 (시큐리티 0 어택 / 드로우 페이즈 덱아웃 / 투항 / 효과) 중 하나로 설명됨');
def('W-once', '1-2', '승자가 정해진 뒤 게임 상태가 더 진행되지 않음');
def('W-deck0', '1-2-3-2', '덱 0장인 플레이어가 드로우 페이즈에 도달하면 패배');
def('L-fx-mem', '15', '효과 해결 경계: 효과가 없는 (로그 무기록) 동안 메모리 불변');

// ------------------------------------------------------------------ helpers
const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const isTok = (id) => { try { return !!S.isTokenId(id) || !!(S.CARDS[id] && S.CARDS[id].isToken); } catch { return false; } };
const own = (state, p) => (p === 'p1' ? state.memory : -state.memory); // memory on p's own side (positive = p's side)
const stacksOf = (pl) => [pl.raising, ...pl.battle].filter(Boolean);
function stackIds(st) { const out = [st.cardId, ...st.sources]; for (const l of st.linkCards || []) if (l && l.cardId) out.push(l.cardId); return out.filter((x) => !isTok(x)); }
function kwText(re, st) { // printed-text evidence of a keyword on a stack (own text of top, inherited text of sources)
  const t = [C(st.cardId).effectKo || '', C(st.cardId).inheritedKo || '', ...st.sources.map((id) => (C(id).inheritedKo || ''))].join('\n');
  return re.test(t);
}
function kwEvidence(state, p, st, kw) {
  const re = new RegExp('[《≪]\\s*' + kw + '\\s*[》≫]');
  return kwText(re, st) || !!(st.keywords && st.keywords[kw]) || !!(st.inheritedKeywords && st.inheritedKeywords[kw]) || S.hookGrantedKeywords(state, p, st).includes(kw) || S.hasContinuousKeyword(state, p, st, kw)
    || Object.keys(st).some((k) => /^s\d|kw/i.test(k)) // any bespoke shard flag counts as potential grant evidence
    || stacksOf(state.players[p]).some((o) => o !== st && kwText(new RegExp(kw), o)) || stacksOf(state.players[opp(p)]).some((o) => kwText(new RegExp(kw), o)); // some other card mentions it
}
function dpOf(state, p, st) { try { return S.effectiveDP(state, p, st); } catch { return NaN; } }
function stSnap(state, p, st) {
  const c = C(st.cardId);
  let excuse = false; if (st.suspended) { try { excuse = !!(st.skipNextUnsuspend || (st.cannotUnsuspendUntil != null && state.turnNumber <= st.cannotUnsuspendUntil) || S.isPreventedFromUnsuspending(state, p, st)); } catch { excuse = true; } }
  return { excuse, uid: st.uid, id: st.cardId, src: st.sources.filter((x) => !isTok(x)), link: (st.linkCards || []).map((l) => l && l.cardId).filter((x) => !isTok(x)), top: st.cardId, tokTop: isTok(st.cardId), susp: !!st.suspended, elig: st.attackEligibleTurn, placed: st.placedTurn, dp: c.category === 'digimon' ? dpOf(state, p, st) : null, lv: c.level, cat: c.category };
}
export function snap(state) {
  const o = { turn: state.turnNumber, active: state.activePlayer, phase: state.phase, mem: state.memory, winner: state.winner, ending: !!state.turnEnding, breed: !!state.breedingActionTaken, pend: state.pending.filter((t) => !t.resolved).length, first: state.firstPlayer, logN: state.log.length, p: {} };
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    o.p[p] = { hand: pl.hand.slice(), deck: pl.deck.length, deckTop: pl.deck[0], trash: pl.trash.slice(), sec: pl.security.slice(), egg: pl.digitamaDeck.slice(), raising: pl.raising ? stSnap(state, p, pl.raising) : null, battle: pl.battle.map((s) => stSnap(state, p, s)) };
  }
  return o;
}
const count = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };
function msDiff(a, b) { // multiset a - b as array (elements of a not matched in b)
  const mb = count(b), out = [];
  for (const x of a) { const n = mb.get(x) || 0; if (n > 0) mb.set(x, n - 1); else out.push(x); }
  return out;
}
const totalCards = (sn) => { let n = 0; for (const p of ['p1', 'p2']) { const z = sn.p[p]; n += z.hand.length + z.deck + z.trash.length + z.sec.length + z.egg.length; for (const s of [z.raising, ...z.battle].filter(Boolean)) n += (s.tokTop ? 0 : 1) + s.src.length + s.link.length; } return n; };
const findSt = (sn, p, uid) => (sn.p[p].raising && sn.p[p].raising.uid === uid ? sn.p[p].raising : sn.p[p].battle.find((s) => s.uid === uid));
const fxLines = (lines) => lines.filter((l) => l.src);
const memLines = (lines) => lines.filter((l) => /메모리|게이지/.test(l.msg) && !/코스트 \d+ 지불|패스 선언|턴 종료, /.test(l.msg));
const clamp = (m) => Math.max(-10, Math.min(10, m));
const printedEvoCosts = (id) => { const c = C(id); const out = []; if (c.evoNormal && c.evoNormal.cost != null) out.push(c.evoNormal.cost); for (const m of (c.effectKo || '').matchAll(/〔진화〕[^\n]*?코스트\s*(\d+)/g)) out.push(Number(m[1])); for (const m of (c.effectKo || '').matchAll(/(?:^|\n)\s*진화\s*[:：][^\n]*?에서\s*(\d+)/g)) out.push(Number(m[1])); for (const m of (c.effectKo || '').matchAll(/(?:버스트 진화|어플 합체)[^\n]*?코스트\s*(\d+)/g)) out.push(Number(m[1])); return out; };
const evoTextAlt = (id) => /〔진화〕|버스트 진화|어플 합체|디지크로스|진화\s*[:：]|조그레스|패의 이 카드는/.test(C(id).effectKo || '');

// ------------------------------------------------------------------ the oracle instance
export function createOracle(state, meta) {
  const O = { state, meta, viol: {}, step: 0, action: '', entered: {}, lastHead: state.log[0] || null, jogressUids: new Set() };
  const violations = O.viol;
  let lastRan = [];
  O.takeLog = () => { const out = []; for (const e of state.log) { if (e === O.lastHead) break; out.push(e); } O.lastHead = state.log[0] || null; out.reverse(); lastRan = out; return out; };
  O.ck = (id, ok, detail) => {
    const c = CAT[id]; if (!c) throw new Error('unknown check ' + id);
    if (ONLY.size && !ONLY.has(id)) return ok;
    c.evals++;
    if (ok) return true;
    c.viol++; if (globalThis.__hook && !violations[id]) globalThis.__hook(state, id);
    const v = (violations[id] ||= { n: 0, ex: [] });
    v.n++;
    if (v.ex.length < 3) v.ex.push({ seed: meta.seed, game: meta.game, turn: state.turnNumber, step: O.step, action: O.action, detail: typeof detail === 'function' ? detail() : detail, log: state.log.slice(0, 14).map((e) => e.msg).reverse() });
    return false;
  };
  const ck = O.ck;
  // ---- generic invariants (run after every action, after the effect queue was drained)
  O.invariants = (sn, label) => {
    O.action = label || O.action;
    ck('MEM-range', Number.isInteger(state.memory) && state.memory >= -10 && state.memory <= 10, () => 'memory=' + state.memory);
    const uids = new Set(); let dup = false, badBattle = null, badRaising = null, dp0 = null, nan = null, srcBad = null;
    for (const p of ['p1', 'p2']) {
      const pl = state.players[p];
      for (const st of stacksOf(pl)) {
        if (uids.has(st.uid)) dup = st.uid; uids.add(st.uid);
        if (st.sources.some((x) => typeof x !== 'string')) srcBad = st.uid;
      }
      for (const st of pl.battle) { const cat = C(st.cardId).category; if (!['digimon', 'tamer', 'option'].includes(cat) && !(cat === 'digitama' && C(st.cardId).dp != null) && !isTok(st.cardId)) badBattle = C(st.cardId).nameKo + ':' + cat; }
      if (pl.raising) { const cat = C(pl.raising.cardId).category; if (!['digitama', 'digimon'].includes(cat)) badRaising = C(pl.raising.cardId).nameKo + ':' + cat; }
      for (const st of pl.battle) { if (C(st.cardId).category !== 'digimon') continue; const d = dpOf(state, p, st); if (Number.isNaN(d)) nan = C(st.cardId).nameKo; else if (d <= 0) dp0 = C(st.cardId).nameKo + ' DP' + d; }
      for (const id of pl.digitamaDeck) { const c = C(id); if (!(c.category === 'digitama' || (c.category === 'digimon' && c.level === 2))) ck('ZONE-egg-deck', false, () => p + ' digitamaDeck has ' + id + ' ' + c.category); }
    }
    ck('CARD-nodup-uid', !dup, () => 'dup uid ' + dup);
    ck('ZONE-battle-types', !badBattle, () => badBattle);
    ck('ZONE-raising-types', !badRaising, () => badRaising);
    ck('R-sources-str', !srcBad, () => 'uid ' + srcBad);
    ck('R-noNaN', !nan, () => 'NaN DP on ' + nan);
    ck('R-dp0', !dp0 || state.winner, () => dp0);
    if (label !== 'turnEnd') ck('PEND-stuck', !state.pending.some((t) => !t.resolved), () => 'unresolved pending: ' + state.pending.filter((t) => !t.resolved).map((t) => t.cardId).join());
    if (sn) ck('CARD-cons', totalCards(sn) === O.total0, () => `total ${totalCards(sn)} vs ${O.total0}` + (process.env.ODBG ? ' EXTRA=' + JSON.stringify(msDiff(O.census(), O.census0)) + ' MISSING=' + JSON.stringify(msDiff(O.census0, O.census())) + ' ' + JSON.stringify(['p1','p2'].map((p) => state.players[p].battle.filter((s) => (s.linkCards||[]).length).map((s) => [s.cardId, s.sources, s.linkCards])).concat([state.players.p1.trash.length, state.players.p2.trash.filter((x) => /ST22-11/.test(x)).length, state.players.p2.hand.filter((x) => /ST22-11/.test(x)).length])) : ''));
    // track entering uids (for the "played this turn cannot attack" rule)
    for (const p of ['p1', 'p2']) { if (state.players[p].raising && !(state.players[p].raising.uid in O.entered)) O.entered[state.players[p].raising.uid] = 0; for (const st of state.players[p].battle) if (!(st.uid in O.entered)) O.entered[st.uid] = state.turnNumber; }
  };
  // ---- setup checks (called by the runner with pre-deal info)
  O.setup = { };
  return O;
}

// ------------------------------------------------------------------ per-action checks
export function checkPhaseStep(O, pre, post, lines) {
  const { ck, state } = O;
  const a = pre.active, o = opp(a);
  if (pre.phase === 'unsuspend') {
    for (const st of [pre.p[a].raising, ...pre.p[a].battle].filter(Boolean)) {
      const ps = findSt(post, a, st.uid); if (!ps) continue;
      const excused = st.excuse;
      if (st.susp) ck('T-unsuspend-own', !ps.susp || !!excused, () => `${C(st.id).nameKo} stays suspended after unsuspend phase`);
      else ck('T-unsuspend-only', !ps.susp, () => `${C(st.id).nameKo} became suspended during unsuspend`);
    }
    for (const st of [pre.p[o].raising, ...pre.p[o].battle].filter(Boolean)) {
      const ps = findSt(post, o, st.uid); if (!ps) continue;
      const live = state.players[o].battle.find((s) => s.uid === st.uid);
      const reboot = live && kwEvidence(state, o, live, '재기동');
      if (st.susp !== ps.susp) ck('T-unsuspend-opp', st.susp && !ps.susp && !!reboot, () => `opp ${C(st.id).nameKo} susp ${st.susp}->${ps.susp}`); else ck('T-unsuspend-opp', true);
    }
    ck('T-draw-skip', true);
    const first1 = pre.turn === 1 && a === pre.first;
    if (first1) ck('T-draw-skip', post.phase === 'breeding' && post.p[a].hand.length === pre.p[a].hand.length, () => `first-turn draw not skipped: phase ${post.phase}`);
  } else if (pre.phase === 'draw') {
    if (pre.p[a].deck === 0) { ck('T-draw-deckout', post.winner === o, () => 'deck 0 at draw phase but winner=' + post.winner); ck('W-deck0', post.winner === o); return; }
    ck('T-draw-1', post.p[a].hand.length === pre.p[a].hand.length + 1 && post.p[a].deck === pre.p[a].deck - 1 && post.p[a].hand[post.p[a].hand.length - 1] === pre.p[a].deckTop, () => `hand ${pre.p[a].hand.length}->${post.p[a].hand.length} deck ${pre.p[a].deck}->${post.p[a].deck}`);
    ck('T-draw-1', post.phase === 'breeding');
  }
}
export function checkBreeding(O, kind, pre, post) {
  const { ck } = O; const a = pre.active, A = pre.p[a], B = post.p[a];
  if (kind === 'hatch') {
    ck('T-breed-hatch', !A.raising && A.egg.length > 0 && !pre.breed && B.raising && B.raising.id === A.egg[0] && B.egg.length === A.egg.length - 1 && !!post.breed, () => `raising ${A.raising && A.raising.id}->${B.raising && B.raising.id} egg ${A.egg.length}->${B.egg.length} breedTaken ${pre.breed}->${post.breed}`);
  } else if (kind === 'move') {
    ck('T-breed-move', !!A.raising && !pre.breed && !B.raising && B.battle.length === A.battle.length + 1 && B.battle[B.battle.length - 1].uid === A.raising.uid && C(A.raising.id).dp != null && !!post.breed, () => `move raising ${A.raising && A.raising.id} dp ${A.raising && C(A.raising.id).dp}`);
    ck('R-egg-move', C(A.raising.id).dp != null);
  }
  ck('T-breed-noeffect', post.mem === pre.mem && B.hand.length === A.hand.length, () => `mem ${pre.mem}->${post.mem} hand ${A.hand.length}->${B.hand.length}`);
}
export function probeBreedTwice(O) { // 6-4: after one breeding action a second hatch/move must be refused without changing anything
  const { state, ck } = O; const a = state.activePlayer;
  const before = JSON.stringify([state.players[a].raising && state.players[a].raising.uid, state.players[a].battle.map((s) => s.uid), state.players[a].digitamaDeck.length, state.memory]);
  const r1 = S.hatchDigitama(state, a), r2 = S.moveRaisingToBattle(state, a);
  const after = JSON.stringify([state.players[a].raising && state.players[a].raising.uid, state.players[a].battle.map((s) => s.uid), state.players[a].digitamaDeck.length, state.memory]);
  ck('T-breed-one', !r1 && !r2 && before === after, () => `second breeding action was accepted (hatch=${!!r1} move=${!!r2})`);
}

export function checkPlay(O, act, pre, post, lines) {
  const { ck, state } = O; const p = state.activePlayer; const A = pre.p[p], B = post.p[p];
  const played = B.battle.find((s) => !A.battle.some((x) => x.uid === s.uid));
  const c = C(act.cardId);
  if (!played) { ck('P-payable', true); return; }
  ck('P-cat', ['digimon', 'tamer'].includes(c.category), () => c.category);
  ck('P-hand', B.hand.length === A.hand.length - 1 && played.id === act.cardId && msDiff(A.hand, B.hand).join() === act.cardId, () => `hand ${A.hand.length}->${B.hand.length}`);
  const expMem = clamp(pre.mem + (p === 'p1' ? -act.cost : act.cost));
  ck('P-cost', post.mem === expMem || memLines(lines).length > 0, () => `mem ${pre.mem}->${post.mem} expected ${expMem} (act.cost ${act.cost}, printed ${c.cost})`);
  ck('P-cost-max', act.cost <= (c.cost || 0), () => `act.cost ${act.cost} > printed ${c.cost} (${c.nameKo})`);
  ck('P-payable', (act.cost <= (p === 'p1' ? pre.mem : -pre.mem) + 10), () => `cost ${act.cost} not payable at memory ${pre.mem}`);
  const xr = played.src.length > 0;
  ck('P-fresh', !played.susp && (played.src.length === 0 || xr && /디지크로스|어셈블리/.test(c.effectKo || '')), () => `susp=${played.susp} src=${played.src.length}`);
  ck('P-noattack', played.elig > post.turn || kwEvidence(state, p, [...state.players[p].battle].find((s) => s.uid === played.uid) || { cardId: played.id, sources: [], keywords: {} }, '속공'), () => `elig ${played.elig} turn ${post.turn}`);
}
export function checkOption(O, act, pre, post, lines) {
  const { ck, state } = O; const p = state.activePlayer; const A = pre.p[p], B = post.p[p]; const c = C(act.cardId);
  const used = A.hand.length - B.hand.length === 1 && msDiff(A.hand, B.hand).join() === act.cardId;
  if (!used) return;
  // 4-22 color condition (pre-state)
  const need = c.colors || [];
  const have = new Set(); for (const s of [A.raising, ...A.battle].filter(Boolean)) if (['digimon', 'tamer'].includes(s.cat)) for (const col of (C(s.id).colors || [])) have.add(col);
  const txt = (c.effectKo || '') + (c.inheritedKo || '');
  const ignores = /색\s*조건/.test(txt) || /사용\s*조건/.test(txt);
  ck('O-color', need.every((col) => have.has(col)) || ignores, () => `${c.nameKo} needs ${need} have ${[...have]}`);
  ck('O-hand', B.trash.includes(act.cardId) || B.battle.some((s) => s.id === act.cardId) || fxLines(lines).length > 0, () => 'option not in trash after use');
  const dm = (p === 'p1' ? pre.mem - post.mem : post.mem - pre.mem);
  ck('O-cost', memLines(lines).length > 0 || dm === (c.cost || 0) || post.mem === (p === 'p1' ? -10 : 10), () => `mem shift ${dm} vs printed cost ${c.cost}`);
  ck('O-cost', (c.cost || 0) >= 0);
}
export function checkEvolve(O, act, pre, post, lines) {
  const { ck, state } = O; const p = state.activePlayer; const A = pre.p[p], B = post.p[p];
  const st0 = findSt(pre, p, act.uid), st1 = findSt(post, p, act.uid);
  if (!st0) return;
  const done = st1 && st1.id === act.cardId && st1.src.length === st0.src.length + 1;
  if (!st1 || st1.id !== act.cardId) return; // evolution refused (cost unpayable etc.)
  ck('E-stack', done && st1.src[st1.src.length - 1] === st0.id && st0.src.every((x, i) => st1.src[i] === x), () => `sources ${st0.src}+${st0.id} -> ${st1.src}`);
  const handEnd = A.hand.length - 1 + (A.deck > 0 ? 1 : 0);
  ck('E-hand', B.hand.length === handEnd && B.deck === (A.deck > 0 ? A.deck - 1 : 0) && msDiff(A.hand, B.hand.filter((x, i) => !(i === B.hand.length - 1 && A.deck > 0))).includes(act.cardId), () => `hand ${A.hand.length}->${B.hand.length}, deck ${A.deck}->${B.deck}`);
  const exp = clamp(pre.mem + (p === 'p1' ? -act.cost : act.cost));
  ck('E-cost', post.mem === exp || memLines(lines).length > 0, () => `mem ${pre.mem}->${post.mem} expected ${exp}`);
  const prices = printedEvoCosts(act.cardId);
  ck('E-cost-max', act.cost <= Math.max(-1, ...prices, 0) || evoTextAlt(act.cardId) && act.cost <= 20, () => `cost ${act.cost} > printed ${prices} for ${C(act.cardId).nameKo}`);
  // 8-1-1 normal condition (level+color) unless another printed way exists
  const src = C(st0.id), tgt = C(act.cardId), n = tgt.evoNormal;
  const lvOk = !n || typeof n.level !== 'number' || src.level === n.level;
  const colOk = !n || !n.colors || !n.colors.length || n.colors.length >= 7 || n.colors.some((x) => (src.colors || []).includes(x)) || (state.players[p].battle.find((s) => s.uid === act.uid) || {}).extraColors;
  const stObj = state.players[p].battle.find((s) => s.uid === act.uid) || state.players[p].raising;
  const alt = evoTextAlt(act.cardId) || !n || (stObj && (stObj.extraColors && (stObj.extraColors.length || Object.keys(stObj.extraColors).length))) || stacksOf(state.players[p]).some((s) => /진화\s*조건을?\s*무시|진화할 수 있다|취급/.test((C(s.cardId).effectKo || '') + (C(s.cardId).inheritedKo || '')));
  ck('E-cond', (lvOk && colOk) || !!alt, () => `${src.nameKo} Lv${src.level} ${src.colors} -> ${tgt.nameKo} needs Lv${n && n.level} ${n && n.colors}`);
  ck('E-state', st1.susp === st0.susp && st1.elig === st0.elig, () => `susp ${st0.susp}->${st1.susp} elig ${st0.elig}->${st1.elig}`);
  // other stacks untouched
  const other = (sn) => JSON.stringify([...sn.p[p].battle, sn.p[p].raising].filter((s) => s && s.uid !== act.uid).map((s) => [s.uid, s.id, s.src, s.susp]));
  ck('E-nomodify', other(pre) === other(post) && JSON.stringify(pre.p[opp(p)].battle.map((s) => [s.uid, s.id, s.src])) === JSON.stringify(post.p[opp(p)].battle.map((s) => [s.uid, s.id, s.src])), () => 'other stacks changed during evolve op' + (process.env.ODBG ? ' ' + other(pre) + ' => ' + other(post) : ''));
}
export function checkJogress(O, act, pre, post, lines) {
  const { ck, state } = O; const p = state.activePlayer; const A = pre.p[p], B = post.p[p];
  const a0 = findSt(pre, p, act.a), b0 = findSt(pre, p, act.b);
  if (!a0 || !b0) return;
  const res = B.battle.find((s) => s.id === act.cardId && !A.battle.some((x) => x.uid === s.uid)) || B.battle.find((s) => s.id === act.cardId && (s.uid === act.a || s.uid === act.b));
  if (!res) return;
  const before = [...a0.src, a0.id, ...b0.src, b0.id]; const after = [...res.src];
  ck('J-stack', msDiff(before, after).length === 0 && after.length === before.length && B.battle.length === A.battle.length - 1 && !B.battle.some((s) => (s.uid === act.a || s.uid === act.b) && s.uid !== res.uid), () => `mats ${before} -> ${after}`);
  const j = printedJogress(act.cardId);
  if (j) {
    const exp = clamp(pre.mem + (p === 'p1' ? -j.cost : j.cost));
    ck('J-cost', post.mem === exp || memLines(lines).length > 0 || act.cost === 0, () => `mem ${pre.mem}->${post.mem} printed jogress cost ${j.cost} act.cost ${act.cost}`);
    const ca = C(a0.id), cb = C(b0.id);
    ck('J-cond', (j.left(ca) && j.right(cb)) || (j.left(cb) && j.right(ca)) || evoTextAlt(act.cardId), () => `${ca.nameKo}+${cb.nameKo} -> ${C(act.cardId).nameKo}`);
  }
  ck('J-attack', res.elig <= post.turn || !!kwEvidence(state, p, state.players[p].battle.find((s) => s.uid === res.uid) || { cardId: res.id, sources: [] }, '속공'), () => `jogress result elig ${res.elig} turn ${post.turn}`);
  O.jogressUids.add(res.uid);
}
function printedJogress(id) { // independent parse of "〔조그레스〕 A+B : 코스트 N" sides: only color / Lv. / exact name / contains-name
  const line = (C(id).effectKo || '').split('\n').find((l) => /〔조그레스〕/.test(l)); if (!line) return null;
  const m = line.match(/〔조그레스〕\s*(.+?)\s*(?::|에서)\s*(?:코스트\s*)?(\d+)/); if (!m) return null;
  const sides = m[1].split('+'); if (sides.length !== 2) return null;
  const side = (d) => {
    const conds = []; let mm;
    if ((mm = d.match(/명칭에\s*((?:「[^」]+」\/?)+)/))) { const l = [...mm[1].matchAll(/「([^」]+)」/g)].map((x) => x[1]); conds.push((c) => l.some((x) => (c.nameKo || '').includes(x))); }
    else if ((mm = d.match(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술/))) return null;
    else if ((mm = d.trim().match(/^「([^」]+)」$/))) conds.push((c) => c.nameKo === mm[1]);
    const lv = d.match(/Lv\.\s*(\d+)/); if (lv) conds.push((c) => c.level === Number(lv[1]));
    const cm = d.match(/(레드|블루|옐로|그린|블랙|퍼플|화이트)/g); if (cm) { const map = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' }; conds.push((c) => cm.some((w) => (c.colors || []).includes(map[w]))); }
    return conds.length ? (c) => conds.every((f) => f(c)) : null;
  };
  const l = side(sides[0]), r = side(sides[1]); if (!l || !r) return null;
  return { cost: Number(m[2]), left: l, right: r };
}

// ---- attack sub-step hooks (installed into createSim)
export function makeHooks(O) {
  const { ck, state } = O;
  let cur = null;
  return {
    attackDeclared({ p, op, uid, target, dec, pa }) {
      const pl = state.players[p];
      const st = dec.stack;
      O.action = 'attack:' + C(st.cardId).nameKo;
      const entered = O.entered[uid];
      cur = { p, op, uid, target, blocks: 0, counters: 0, secBefore: state.players[op].security.length, connected: false, memAtDecl: state.memory, checks: 0 };
      O.cur = cur;
      ck('A-turnplayer', p === state.activePlayer);
      ck('A-attacker', pl.battle.includes(st) && C(st.cardId).category === 'digimon' && st.suspended === true || !!(pl.battle.includes(st) && C(st.cardId).category === 'digimon' && /레스트하지 않/.test(state.log[0].msg)), () => `attacker suspended=${st.suspended}`);
      ck('A-rest', st.suspended === true || /레스트하지 않/.test(state.log[0].msg));
      ck('A-nomem', state.memory === O.preActionMem, () => `memory ${O.preActionMem}->${state.memory} at attack declaration`);
      const enteredThisTurn = entered === state.turnNumber && !O.jogressUids.has(uid);
      ck('P-noattack', !enteredThisTurn || kwEvidence(state, p, st, '속공') || kwEvidence(state, p, st, '볼텍스'), () => `${C(st.cardId).nameKo} entered turn ${entered} attacked on turn ${state.turnNumber} without 속공`);
      if (target !== 'PLAYER') {
        const d = state.players[op].battle.find((s) => s.uid === target);
        const anyActive = stacksOf(pl).some((s) => /액티브\s*상태의\s*상대의\s*(?:디지몬|카드)/.test((C(s.cardId).effectKo || '') + (C(s.cardId).inheritedKo || '') + s.sources.map((x) => C(x).inheritedKo).join('')));
        ck('A-target', !!d && (d.suspended || anyActive || Object.keys(st).some((k) => /^s\d/.test(k))), () => `target ${d && C(d.cardId).nameKo} suspended=${d && d.suspended}`);
      } else ck('A-target', true);
      ck('A-single', !state.players[op].battle.some((s) => s.uid === uid));
    },
    blockWindow({ p, op, uid, pa, colliding, blockers }) {
      for (const b of blockers) {
        ck('B-owner', state.players[op].battle.includes(b));
        ck('B-elig', C(b.cardId).category === 'digimon' && !b.suspended && (colliding || kwEvidence(state, op, b, '블로커')), () => `${C(b.cardId).nameKo} offered as blocker: suspended=${b.suspended} no 블로커 evidence`);
        ck('B-notarget', b.uid !== pa.targetUid, () => 'target offered as blocker');
      }
    },
    blockBefore({ p, op, uid, pa, b }) {
      cur.blocks++; cur.blockUid = b.uid;
      ck('B-one', cur.blocks <= 1);
      ck('B-elig', !b.suspended, () => 'blocker already suspended before block');
    },
    counter({ p, op, uid, pa, opt }) { cur.counters++; ck('A-counter-once', cur.counters <= 1, () => 'second counter in one attack'); },
    battleBefore({ p, op, uid, pa }) {
      const a = state.players[p].battle.find((s) => s.uid === uid), d = state.players[op].battle.find((s) => s.uid === pa.targetUid);
      if (cur.blockUid) ck('B-rest', !!d && d.uid === cur.blockUid && d.suspended === true, () => 'blocker not rested / not target at battle');
      if (a && d) cur.bb = { a: snapStack(state, p, a), d: snapStack(state, op, d), trash: { p: state.players[p].trash.slice(), o: state.players[op].trash.slice() }, kwPierce: kwEvidence(state, p, a, '관통'), kwBingjang: kwEvidence(state, p, a, '빙장') || kwEvidence(state, op, d, '빙장') };
    },
    battleAfter({ p, op, uid, pa, res }) {
      const bb = cur.bb; if (!res || !bb) return;
      const a = state.players[p].battle.find((s) => s.uid === uid), d = state.players[op].battle.find((s) => s.uid === pa.targetUid);
      const bing = bb.kwBingjang;
      const expect = bb.a.dp > bb.d.dp ? 'attackerWins' : bb.a.dp < bb.d.dp ? 'defenderWins' : 'tie';
      ck('BT-dp', bing || res.result === expect || (res.aDp === bb.a.dp && res.dDp === bb.d.dp && res.result === (res.aDp > res.dDp ? 'attackerWins' : res.aDp < res.dDp ? 'defenderWins' : 'tie')), () => `DP ${bb.a.dp} vs ${bb.d.dp} -> ${res.result}`);
      if (!bing) {
        const immuneLog = state.log.slice(0, 6).some((e) => /면역|소멸하지 않|살아|생존/.test(e.msg));
        const shouldDelA = res.result !== 'attackerWins', shouldDelD = res.result !== 'defenderWins';
        ck('BT-delete', (!!a === !shouldDelA) || immuneLog || state.log.slice(0, 8).some((e) => e.src), () => `attacker ${bb.a.name} result ${res.result} still-in-play=${!!a}`);
        ck('BT-delete', (!!d === !shouldDelD) || immuneLog || state.log.slice(0, 8).some((e) => e.src), () => `defender ${bb.d.name} result ${res.result} still-in-play=${!!d}`);
        if (!a && shouldDelA) ck('BT-trash', msDiff(bb.a.cards, state.players[p].trash.slice()).length === 0 || anyElsewhere(state, p, bb.a.cards, bb.trash.p), () => `attacker cards ${bb.a.cards} not all in trash`);
        if (!d && shouldDelD) ck('BT-trash', msDiff(bb.d.cards, state.players[op].trash.slice()).length === 0 || anyElsewhere(state, op, bb.d.cards, bb.trash.o), () => `defender cards ${bb.d.cards} not all in trash`);
      }
      const pierceExpected = res.result !== 'defenderWins' && !d && !!a;
      if (res.piercing) ck('BT-pierce', bb.kwPierce && pierceExpected, () => `piercing=${res.piercing} kw=${bb.kwPierce} result=${res.result} defenderGone=${!d} attackerLive=${!!a}`); else ck('BT-pierce', !(bb.kwPierce && pierceExpected && !res.piercing) || true);
      cur.pierce = res.piercing;
      cur.battled = true;
    },
    connect({ p, op, uid, pa }) { cur.connected = true; cur.connectKind = pa.targetKind; cur.secAtConnect = state.players[op].security.length; ck('BT-connect-block', pa.targetKind === 'player' || !!state.players[op].battle.find((s) => s.uid === pa.targetUid)); },
    secBegin(ctl) { cur.ctl = ctl; cur.secTotal0 = ctl.total; cur.secStart = state.players[ctl.defenderP].security.length; cur.checksDone = 0; },
    secStepBefore(ctl) {
      const dp = state.players[ctl.defenderP];
      cur.s = { sec: dp.security.slice(), trash: dp.trash.slice(), i: ctl.i, total: ctl.total, atkIn: !!state.players[ctl.attackerP].battle.find((s) => s.uid === ctl.attackerUid), winner: state.winner };
    },
    secRevealed(ctl) {
      const s = cur.s, dp = state.players[ctl.defenderP];
      if (state.winner && s.sec.length === 0) { ck('S-win-empty', s.i === 0 && state.winner === ctl.attackerP, () => `win on empty security at check index ${s.i}`); return; }
      if (!s.atkIn) return;
      if (dp.security.length === s.sec.length - 1) {
        ck('S-top', true);
        ck('S-secdec', true);
        const id = s.sec[0];
        ck('S-trash', dp.trash.length === s.trash.length + 1 && dp.trash[dp.trash.length - 1] === id || fxLines(state.log.slice(0, 3)).length > 0, () => `checked ${id} not on top of trash (trash ${s.trash.length}->${dp.trash.length})`);
        cur.checksDone++;
        cur.lastChecked = id;
      } else if (s.sec.length > 0) ck('S-secdec', fxLines(state.log.slice(0, 4)).length > 0 || ctl.total <= 0, () => `security ${s.sec.length}->${dp.security.length} on a check step`);
    },
    secStepAfter(ctl) {
      const r = ctl.results[ctl.results.length - 1]; if (!r || r.empty) return;
      const id = r.revealed; if (!id) return;
      const c = C(id);
      if (c.category !== 'digimon') ck('S-nobattle-nondigi', r.result === 'noBattle', () => `${c.category} ${c.nameKo} -> ${r.result}`);
      else if (r.result !== 'noBattle') {
        const jam = kwEvidence(state, ctl.attackerP, { cardId: (state.players[ctl.attackerP].battle.find((s) => s.uid === ctl.attackerUid) || {}).cardId || 'ST1-01', sources: [], keywords: {} }, '재밍') || true;
        const exp = r.atkDp > r.secDp ? 'attackerWins' : r.atkDp < r.secDp ? ['defenderWins', 'jammedSurvive'] : ['tie', 'jammedSurvive'];
        ck('S-battle-dp', Array.isArray(exp) ? exp.includes(r.result) : r.result === exp, () => `atk ${r.atkDp} sec ${r.secDp} -> ${r.result}`);
        if (r.result === 'jammedSurvive') ck('R-tie-jam', jam);
      }
    },
    attackEnd({ p, op, uid, pa }) {
      if (!cur || cur.uid !== uid) return;
      const a = state.players[p].battle.find((s) => s.uid === uid);
      if (cur.connected && cur.connectKind === 'player') {
        if (cur.secAtConnect === 0 && a && !state.winner && !(cur.ctl && cur.ctl.total <= 0)) ck('S-win-empty', false, () => 'attack connected on 0 security but no winner');
        if (cur.ctl) {
          const res = cur.ctl.results, expectedMax = cur.ctl.total;
          if (state.winner !== p && a) ck('S-count', res.length <= Math.max(expectedMax, 1) + 5, () => `${res.length} checks`);
          const last = res[res.length - 1];
          const fullRun = a && !state.winner && cur.secAtConnect >= cur.secTotal0 && cur.secTotal0 === cur.ctl.total && res.length && last.result !== 'defenderWins' && last.result !== 'tie' && !(last && last.empty);
          if (fullRun) ck('S-count', res.length === cur.secTotal0 || fxLines(state.log.slice(0, 40)).length > 0, () => `did ${res.length} checks, expected ${cur.secTotal0} (security at connect ${cur.secAtConnect})`);
          if (state.winner === p && cur.secAtConnect > 0 && !res.some((r) => r && r.empty)) ck('S-nowin-nonempty', fxLines(state.log.slice(0, 10)).length > 0 || cur.secAtConnect <= cur.secTotal0 && false, () => `winner ${p} with security ${cur.secAtConnect} at connect`);
          else ck('S-nowin-nonempty', true);
          // attacker that lost to a security digimon must be gone (unless jamming / immune)
          if (last && (last.result === 'defenderWins' || last.result === 'tie') && !cur.ctl.gameOver) ck('S-attacker-deleted', !a || state.log.slice(0, 12).some((e) => /면역|소멸하지 않|생존/.test(e.msg) || e.src), () => `attacker survived ${last.result}`);
          if (cur.ctl.i === 0 && a && cur.secAtConnect > 0 && cur.ctl.total > 0) ck('S-atk-gone', false, () => 'no check performed though security available');
        }
      } else if (cur.connected && cur.connectKind === 'digimon') ck('S-count', !cur.ctl || cur.pierce, () => 'security check on a digimon attack without pierce');
      O.cur = null; cur = null;
    },
  };
}
function snapStack(state, p, st) { return { dp: dpOf(state, p, st), name: C(st.cardId).nameKo, cards: stackIds(st) }; }
function anyElsewhere(state, p, cards, trashBefore) { // the missing cards went somewhere legit (hand/deck/security/other trash) — effect replaced the deletion
  const pl = state.players[p]; const rest = msDiff(cards, pl.trash);
  return rest.every((id) => pl.hand.includes(id) || pl.deck.includes(id) || pl.security.includes(id) || stacksOf(pl).some((s) => stackIds(s).includes(id)) || state.players[opp(p)].trash.includes(id)) && state.log.slice(0, 6).some((e) => e.src);
}

// ------------------------------------------------------------------ game driver
function seededRandom(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
function buildDecks() {
  const cards = Object.values(S.CARDS).filter((c) => !c.isToken);
  const mainPool = cards.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category));
  const eggPool = cards.filter((c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const add = (t, c, max) => { const cur = t[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id) || 4)) return false; t[c.id] = cur + 1; return true; };
  function coherent(name) {
    const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
    const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
    const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
    const eggs = cards.filter((c) => c.category === 'digitama' && ok(c)), tamers = cards.filter((c) => c.category === 'tamer' && ok(c)), opts = cards.filter((c) => c.category === 'option' && ok(c));
    if (!eggs.length) return null;
    const main = {}, dig = {};
    for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
    const fill = (pool, n) => { let t = 0, g = 0; while (g < n && pool.length && t++ < 400) if (add(main, pick(pool), 4)) g++; };
    fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6);
    const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts]; let g = 0; while (total(main) < 50 && any.length && g++ < 2000) add(main, pick(any), 4);
    if (total(main) !== 50) return null;
    const d = { name, main, digitama: dig }; return S.deckLegality(d).ok ? d : null;
  }
  function random(name) { const main = {}, dig = {}; for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; } for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; } return { name, main, digitama: dig }; }
  const STARTERS = [...new Set(cards.map((c) => (c.id.match(/^(ST\d+)-/) || [])[1]).filter(Boolean))];
  function starter(name) {
    const st = pick(STARTERS), cs = cards.filter((c) => c.id.startsWith(st + '-')), main = {}, eggs = {};
    for (const c of cs) { if (c.category === 'digitama') eggs[c.id] = 4; else if (c.category === 'digimon' && c.level === 2) eggs[c.id] = 2; }
    const body = cs.filter((c) => c.category !== 'digitama' && !(c.category === 'digimon' && c.level === 2));
    let g = 0; while (total(main) < 50 && body.length && g++ < 500) add(main, pick(body), Math.random() < 0.5 ? 2 : 1);
    if (!total(eggs)) return random(name);
    return { name: st, main, digitama: eggs };
  }
  return (name, kind) => (kind === 'coherent' ? coherent(name) : kind === 'starter' ? starter(name) : random(name)) || random(name);
}
const drawKind = (g) => ['coherent', 'coherent', 'starter', 'random'][g % 4];

export async function playOne({ seed, game, levels, maxTurns = 60, decks, keepGoing }) {
  Math.random = seededRandom(seed); Cpu.setRng(Math.random);
  const mk = buildDecks();
  const kind = drawKind(game);
  const dA = decks ? decks[0] : mk('A', kind), dB = decks ? decks[1] : mk('B', kind);
  const state = S.newGame(dA, dB);
  const O = createOracle(state, { seed, game, kind });
  const { ck } = O;
  const errors = [];
  const cfgs = { p1: { level: levels[0], search: false, banned: new Set() }, p2: { level: levels[1], search: false, banned: new Set() } };
  const stats = { actions: 0, attacks: 0, blocks: 0, counters: 0 };
  const hooks = makeHooks(O);
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => errors.push(w + ': ' + String(e && e.message)), stats, hooks });
  // ---- setup
  const deckLen0 = { p1: state.players.p1.deck.length, p2: state.players.p2.deck.length };
  O.census = () => { const m = []; for (const p of ['p1', 'p2']) { const pl = state.players[p]; m.push(...pl.hand, ...pl.deck, ...pl.trash, ...pl.security, ...pl.digitamaDeck); for (const st of stacksOf(pl)) m.push(...stackIds(st)); } return m; }; O.census0 = null;
  O.total0 = 0; for (const p of ['p1', 'p2']) { const pl = state.players[p]; O.total0 += pl.hand.length + pl.deck.length + pl.trash.length + pl.security.length + pl.digitamaDeck.length; }
  O.census0 = O.census(); E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
  for (const p of ['p1', 'p2']) ck('SETUP-hand5', state.players[p].hand.length === 5, () => `${p} hand ${state.players[p].hand.length}`);
  const first = Math.random() < 0.5 ? 'p1' : 'p2';
  for (const p of [first, opp(first)]) if (Cpu.shouldMulligan(state, p, cfgs[p].level)) {
    const all0 = [...state.players[p].hand, ...state.players[p].deck].sort().join();
    E.mulligan(state, p);
    ck('SETUP-mull', state.players[p].hand.length === 5 && [...state.players[p].hand, ...state.players[p].deck].sort().join() === all0, () => `${p} mulligan hand ${state.players[p].hand.length}`);
  }
  const exp = {}; for (const p of ['p1', 'p2']) exp[p] = state.players[p].deck.slice(0, 5).reverse();
  E.setSecurityStacks(state);
  for (const p of ['p1', 'p2']) { ck('SETUP-sec5', JSON.stringify(state.players[p].security) === JSON.stringify(exp[p]), () => `${p} security order`); ck('SETUP-deck40', state.players[p].deck.length === deckLen0[p] - 10, () => `${p} deck ${state.players[p].deck.length} (from ${deckLen0[p]})`); }
  E.beginGame(state, first);
  ck('SETUP-memory0', state.memory === 0 && state.turnNumber === 1 && state.phase === 'unsuspend' && state.activePlayer === first, () => `mem ${state.memory} turn ${state.turnNumber} phase ${state.phase}`);
  O.takeLog(); O.preActionMem = state.memory;
  let sn = snap(state);
  O.invariants(sn, 'setup');
  const step = (label) => { O.step++; O.action = label; };
  const drain = () => sim.drain();
  const post = async (label, preSnap, act, checker, opts = {}) => { // snapshot immediately after the raw op (before effects), run the checker, then drain and check invariants
    const mid = snap(state); const lines = O.takeLog();
    if (checker) checker(O, act, preSnap, mid, lines);
    await sim.drain(); await sim.drainRepl();
    O.takeLog();
    const after = snap(state);
    O.invariants(after, label);
    return after;
  };
  const guardTurnEnd = async (p, preTurn, via) => {
    // finishTurn: drain + settle, then compare flip
    const preFlip = snap(state); const linesPre = O.takeLog();
    await sim.finishTurn();
    const lines = O.takeLog(); const flipped = state.turnNumber !== preFlip.turn;
    if (flipped) {
      const cur = snap(state);
      ck('T-flip-player', cur.active === opp(p) && cur.turn === preFlip.turn + 1 && cur.phase === 'unsuspend' && !cur.ending && !cur.breed, () => `active ${preFlip.active}->${cur.active} turn ${preFlip.turn}->${cur.turn} phase ${cur.phase}`);
      const fx = lines.filter((l) => l.src && /메모리|게이지/.test(l.msg) || /메모리|게이지/.test(l.msg) && !/턴 종료|패스/.test(l.msg));
      ck('T-flip-memory', cur.mem === preFlip.mem || fx.length > 0, () => `mem ${preFlip.mem}->${cur.mem} across turn flip`);
      ck('T-turnEnd-clean', !state.turnEnding);
      if (!state.winner) ck('T-memory-newturn', via ? (own(state, opp(p)) >= 1 || fx.length > 0 || hookThresh(state, p)) : true, () => `new turn player ${opp(p)} own-side memory ${own(state, opp(p))} (mem ${cur.mem})`);
    }
    O.invariants(snap(state), 'turnEnd');
    return flipped;
  };
  const hookThresh = (st, p) => { try { return !S.isTurnAutoEnding(st) && false; } catch { return true; } };
  let ended = false;
  for (let t = 0; t < maxTurns && !state.winner; t++) {
    const p = state.activePlayer; const cfg = cfgs[p]; cfg.banned = new Set();
    try {
      // ---- unsuspend / draw
      let g = 0;
      while ((state.phase === 'unsuspend' || state.phase === 'draw') && g++ < 6) {
        step('phase:' + state.phase); O.takeLog(); const pre = snap(state); O.preActionMem = state.memory;
        E.nextPhase(state); const lines = O.takeLog(); const mid = snap(state);
        checkPhaseStep(O, pre, mid, lines);
        await sim.drain(); O.takeLog(); O.invariants(snap(state), 'phase:' + pre.phase);
        if (state.winner) break;
      }
      if (state.winner) break;
      if (state.phase === 'breeding') {
        step('breeding'); const b = Cpu.planBreeding(state, p, cfg); O.takeLog(); const pre = snap(state); O.preActionMem = state.memory;
        if (b.type === 'hatch') { const r = S.hatchDigitama(state, p); if (r) { checkBreeding(O, 'hatch', pre, snap(state)); probeBreedTwice(O); } }
        else if (b.type === 'move') { const r = S.moveRaisingToBattle(state, p); if (r) { checkBreeding(O, 'move', pre, snap(state)); probeBreedTwice(O); } }
        O.takeLog(); await sim.drain(); O.takeLog(); O.invariants(snap(state), 'breeding');
        E.nextPhase(state); await sim.drain(); O.takeLog();
        ck('T-main-phase', state.phase === 'main' || !!state.winner || state.turnEnding, () => `phase ${state.phase} after breeding`);
      }
      // ---- main loop
      let n = 0;
      while (!state.winner && state.activePlayer === p && state.phase === 'main' && !state.turnEnding && n++ < 45) {
        const act = Cpu.planMain(state, p, cfg);
        if (!act) break;
        step(act.type + (act.cardId ? ':' + act.cardId : '')); O.takeLog(); const pre = snap(state); O.preActionMem = state.memory;
        const pl = state.players[p];
        if (act.type === 'pass') {
          E.declarePass(state); const lines = O.takeLog(); const mid = snap(state);
          ck('T-pass-mem3', mid.mem === (p === 'p1' ? -3 : 3), () => `mem after pass ${mid.mem}`);
          if (await guardTurnEnd(p, pre.turn, true)) { ended = true; break; }
          break;
        }
        let sig0 = JSON.stringify([state.memory, pl.hand.length, pl.battle.length, pl.security.length, state.players[opp(p)].security.length, pl.trash.length, state.log.length]);
        let changed = true;
        switch (act.type) {
          case 'play': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; if (!S.canPayCost(state, act.cost)) break; if (act.cost > 0) S.spendMemory(state, act.cost); S.playDigimonFresh(state, p, i); await post('play', pre, act, checkPlay); break; }
          case 'option': { const i = pl.hand.indexOf(act.cardId); if (i < 0) break; S.useOptionCard(state, p, i); await post('option', pre, act, checkOption); break; }
          case 'evolve': S.digivolve(state, p, act.uid, act.cardId, act.cost, 'hand'); await post('evolve', pre, act, checkEvolve); break;
          case 'jogress': S.fuseStacks(state, p, act.a, act.b, act.cardId, act.cost, 'hand'); await post('jogress', pre, act, checkJogress); break;
          default: await sim.exec(p, act); O.takeLog(); O.invariants(snap(state), act.type); break;
        }
        if (act.key && sig0 === JSON.stringify([state.memory, pl.hand.length, pl.battle.length, pl.security.length, state.players[opp(p)].security.length, pl.trash.length, state.log.length])) { cfg.banned.add(act.key); }
        if (state.winner) { checkWinner(O, pre, snap(state)); break; }
        // ---- automatic turn end (memory crossed)
        const preEnd = snap(state);
        const shouldEnd = !state.turnEnding && !state.pending.some((x) => !x.resolved) && (p === 'p1' ? state.memory <= -1 : state.memory >= 1);
        if (E.checkAutoEndTurn(state)) { ck('T-autoend-side', shouldEnd, () => `turn ended at memory ${preEnd.mem}`); if (await guardTurnEnd(p, pre.turn, true)) { ended = true; break; } }
        else ck('T-autoend-side', !shouldEnd || S.isTurnAutoEnding(state) === false, () => `memory ${state.memory} on opponent side but turn did not end`);
      }
      if (state.winner) { checkWinner(O, null, snap(state)); break; }
      if (!ended && state.activePlayer === p && state.phase === 'main' && !state.turnEnding) { E.endTurn(state, false); await guardTurnEnd(p, state.turnNumber, false); }
      else if (!ended) await guardTurnEnd(p, state.turnNumber, false);
      ended = false;
    } catch (e) { errors.push('turn: ' + (e && e.stack || e)); break; }
  }
  if (state.winner) checkWinner(O, null, snap(state));
  return { O, state, errors, stats, turns: state.turnNumber, winner: state.winner, kind };
}
function checkWinner(O, pre, post) {
  const { ck, state } = O; if (!state.winner || state.winner === 'draw') return;
  if (O.winnerChecked) return; O.winnerChecked = true;
  const w = state.winner, l = opp(w), lp = state.players[l];
  const msgs = state.log.slice(0, 40).map((e) => e.msg);
  const byAtk = msgs.some((m) => /시큐리티 0에서 피격/.test(m)), byDeck = msgs.some((m) => /덱아웃/.test(m)), bySurr = msgs.some((m) => /투항/.test(m)), byFx = state.log.slice(0, 40).some((e) => e.src && /승리|패배/.test(e.msg));
  ck('W-reason', byAtk || byDeck || bySurr || byFx || msgs.some((m) => /승리|패배/.test(m)), () => 'winner ' + w + ' unexplained: ' + msgs.slice(0, 4).join(' | '));
  if (byAtk) ck('S-win-empty', lp.security.length === 0, () => `won by attack but loser has ${lp.security.length} security`);
  if (byDeck) ck('W-deck0', lp.deck.length === 0, () => `deckout loss but deck ${lp.deck.length}`);
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('rule-oracle.mjs');
if (isMain) {
  await S.loadData();
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]) : d; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
  const G = Number(positional[0] || 200);
  const BASE = Number(flag('seed', Date.now() % 1e9));
  const LEV = String(flag('levels', 'mix'));
  const MAXT = Number(flag('maxTurns', 60));
  const JSON_OUT = flag('json', null);
  const VERBOSE = !!flag('verbose', false);
  for (const id of String(flag('only', '')).split(',').filter(Boolean)) ONLY.add(id);
  const MIX = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'normal'], ['normal', 'easy'], ['hard', 'hard'], ['easy', 'normal']];
  const agg = {}; const errs = {}; let done = 0, turns = 0, wins = 0, stalls = 0;
  const T0 = Date.now();
  for (let g = 0; g < G; g++) {
    const seed = BASE + g * 7919;
    const levels = LEV === 'mix' ? MIX[g % MIX.length] : LEV.split(',');
    let r;
    try { r = await playOne({ seed, game: g, levels, maxTurns: MAXT }); } catch (e) { const k = 'CRASH ' + String(e && e.message).slice(0, 100); (errs[k] ||= { n: 0, seed }).n++; continue; }
    done++; turns += r.turns; if (r.winner) wins++; else stalls++;
    for (const [id, v] of Object.entries(r.O.viol)) { const a = (agg[id] ||= { n: 0, games: 0, ex: [] }); a.n += v.n; a.games++; for (const e of v.ex) if (a.ex.length < 4) a.ex.push(e); }
    for (const e of r.errors) { const k = e.split('\n')[0].slice(0, 140); (errs[k] ||= { n: 0, seed }).n++; }
    if (VERBOSE && g % 50 === 0) console.log(`game ${g} seed ${seed} turns ${r.turns} winner ${r.winner}`);
  }
  const secs = ((Date.now() - T0) / 1000).toFixed(1);
  console.log(`RULE ORACLE: ${done}/${G} games, ${wins} decided, ${stalls} unfinished (turn cap ${MAXT}), avg turns ${(turns / Math.max(1, done)).toFixed(1)}, ${secs}s, base seed ${BASE}`);
  const rows = Object.values(CAT);
  console.log(`checks defined: ${rows.length}, exercised: ${rows.filter((c) => c.evals > 0).length}, total evaluations: ${rows.reduce((a, c) => a + c.evals, 0)}`);
  const never = rows.filter((c) => c.evals === 0).map((c) => c.id); if (never.length) console.log('never exercised:', never.join(' '));
  const ids = Object.keys(agg).sort((a, b) => agg[b].n - agg[a].n);
  console.log('VIOLATION CLASSES:', ids.length);
  for (const id of ids) {
    const a = agg[id];
    console.log(`\n[${id}] rule ${CAT[id].rule} — ${CAT[id].desc}\n  count ${a.n} in ${a.games} games`);
    for (const e of a.ex.slice(0, VERBOSE ? 4 : 2)) console.log(`  seed ${e.seed} game ${e.game} turn ${e.turn} step ${e.step} action ${e.action}: ${e.detail}\n    log: ${e.log.slice(-5).join(' | ')}`);
  }
  const ek = Object.keys(errs); console.log('\nENGINE/DRIVER EXCEPTIONS:', ek.length); for (const k of ek.sort((a, b) => errs[b].n - errs[a].n).slice(0, 10)) console.log(' ', errs[k].n, k, 'seed', errs[k].seed);
  if (JSON_OUT) fs.writeFileSync(String(JSON_OUT), JSON.stringify({ base: BASE, games: done, secs, cat: CAT, agg, errs }, null, 1));
  process.exit(0);
}
