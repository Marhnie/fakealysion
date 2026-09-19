// Scanner: lists every effect segment whose executed script contains a manual fallback
// (noop placeholder / manualCost / "ask the player" condition / dropped sentence).
// The script lookup mirrors main.js scriptFor (specific script first, else compileToScript), and the
// "handled live elsewhere" skips are taken verbatim from scripts/audit-effects.mjs so the two stay in sync.
//
// Run: node scripts/scan-manual.mjs [out.md]      (writes docs/manual-effects.md by default)
import fs from 'node:fs';
import * as S from '../src/state.js';
import * as Effects from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();

// --- reuse the audit's skip block (segments handled by continuous/watcher machinery instead of scripts) ---
const auditSrc = fs.readFileSync(new URL('./audit-effects.mjs', import.meta.url), 'utf8');
const a0 = auditSrc.indexOf('totalSegments++;') + 'totalSegments++;'.length;
const a1 = auditSrc.indexOf('let script = [];');
const skipBody = auditSrc.slice(a0, a1).replace(/turnConditionalHandled\+\+;\s*continue;/g, 'return true;');
const TURN_TAGS = new Set(['자신의 턴', '상대의 턴', '서로의 턴']);
const auditSkip = new Function('S', 'seg', 'cardId', 'TURN_TAGS', skipBody + '\n return false;');

function scriptFor(t) {
  const sp = Effects.lookupCardSpecific(t.cardId, t.tags, t.text);
  if (sp) return sp;
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) {
    const { segments } = S.parseEffectSegments(S.card(t.cardId).effectKo || '');
    const m = segments.find(s => s.tags.includes('메인'));
    if (m) return Effects.lookupCardSpecific(t.cardId, m.tags, m.body) || Effects.compileToScript(m.body);
  }
  return Effects.compileToScript(t.text);
}
function walk(x, out, seen = new Set()) {
  if (!x || seen.has(x)) return;
  if (typeof x === 'function') { if (x.manualLabel) out.push(['조건수동', x.manualLabel]); return; }
  if (typeof x !== 'object') return;
  seen.add(x);
  if (Array.isArray(x)) { x.forEach(y => walk(y, out, seen)); return; }
  if (x.op === 'noop') out.push(['noop', x.note || '']);
  else if (x.op === 'manualCost') out.push(['manualCost', x.text || '']);
  for (const v of Object.values(x)) walk(v, out, seen);
}
// 사유 분류 (docs 표의 사유 칼럼 앞에 붙는 Korean 라벨)
function classify(kind, r) {
  if (kind === 'manualCost') {
    if (/어셈블리/.test(r)) return '어셈블리 코스트(엔진 미지원)';
    if (/코스트를\s*\d+까지\s*지불/.test(r)) return '가변 코스트 지불';
    if (/(?:했을|일|났을|졌을|들었을|할|될|놓였을|이동했을)\s*때,|경우,/.test(r)) return '트리거 조건이 엔진 감시 목록에 없음';
    if (/배틀\s*에어리어(?:의|에)[^.]*옵션\s*카드|옵션\s*카드[^.]*배틀\s*에어리어/.test(r)) return '배틀 에어리어의 옵션(딜레이) 배치/파기';
    if (/거나,/.test(r) || /파기하거나|소멸시키거나/.test(r)) return '비용 선택지(OR) 분기 미지원';
    if (/서로\s*다른|이외의/.test(r)) return '서로 다른 번호/Lv·제외 조건';
    if (/^(?:그\s*후,\s*)?(?:특징\s*「[^」]+」\/?)*.*디지몬\s*1마리를\s*(?:레스트|소멸|패로|덱|시큐리티)/.test(r) && !/자신|상대/.test(r)) return '대상 진영이 양측(자신/상대 선택)';
    if (/겹쳐져\s*있는\s*카드|이\s*카드를\s*배틀\s*에어리어|육성\s*에어리어/.test(r)) return '스택/육성 에어리어 특수 이동';
    return '비용 패턴 미지원';
  }
  if (kind === 'noop') {
    if (/진화원의 카드를 코스트 없이 등장/.test(r)) return /벗어날|떠날|소멸했을|소멸할|어택 종료|대상이 변경|놓였을/.test(r) ? '이탈/이벤트 트리거형 진화원 등장' : '진화원 등장(대상 스택·복합 조건 미지원)';
    if (/효과 부여/.test(r)) return '부여 효과 종류 미지원';
    if (/지불하는\s*(?:진화\s*|등장\s*|사용\s*)?코스트|코스트를?\s*마이너스|코스트\s*-\d/.test(r)) return '코스트 경감 효과(상호작용형)';
    if (/공격 중 진화|대체 배리어/.test(r)) return '엔진 타이밍/대체 효과 미모델';
    return '효과 패턴 미지원';
  }
  if (kind === '조건수동') return '이전 문장 결과/문맥 참조 조건';
  return '컴파일되지 않은 문장';
}

const rows = [];
for (const c of Object.values(S.CARDS)) for (const src of ['effectKo', 'inheritedKo']) {
  if (!c[src]) continue;
  for (const seg of S.parseEffectSegments(c[src]).segments) {
    if (auditSkip(S, seg, c.id, TURN_TAGS)) continue;
    let sc = []; try { sc = scriptFor({ cardId: c.id, tags: seg.tags, text: seg.body }) || []; } catch { /* audit counts a throwing compile as uncovered */ }
    const out = []; walk(sc, out);
    const dropped = Effects.lookupCardSpecific(c.id, seg.tags, seg.body) ? [] : Effects.droppedSentences(seg.body);
    for (const d of dropped) out.push(['dropped', d]);
    for (const [k, r] of out) rows.push({ id: c.id, tag: seg.tags.join('/'), kind: k, reason: r, cat: classify(k, r) });
  }
}
const esc = s => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 170);
const byKind = {}; rows.forEach(r => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
const cardsSet = new Set(rows.map(r => r.id));
let md = `# 수동 처리 효과 목록\n\n스캔: \`node scripts/scan-manual.mjs\` — 항목 ${rows.length}건 / 카드 ${cardsSet.size}장 (${JSON.stringify(byKind)})\n\n` +
  `종류: noop = 자동 처리 불가 안내만 남는 자리표시 op / manualCost = 엔진이 해석 못한 비용을 플레이어가 직접 확인 / 조건수동 = 엔진이 평가 못해 플레이어에게 묻는 조건 / dropped = 컴파일되지 않고 남는 문장\n\n` +
  `이 목록은 "직접 처리 폴백이 남아 있는" 항목만 담는다. 이 스캐너가 자동 해결한 항목(비용 이동/시큐리티 확인/진화원 등장/조건 평가/감시 트리거 등)은 더 이상 나오지 않는다.\n\n`;
const byCat = {}; rows.forEach(r => { (byCat[r.cat] ||= new Set()).add(r.id); byCat[r.cat].n = (byCat[r.cat].n || 0) + 1; });
md += `## 사유별 요약\n\n| 사유 분류 | 항목 | 카드 |\n|---|---|---|\n`;
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1].n - a[1].n)) md += `| ${k} | ${v.n} | ${v.size} |\n`;
md += `\n## 전체 목록\n\n| 카드 | 종류 | 사유 |\n|---|---|---|\n`;
for (const r of rows) md += `| ${r.id} 【${esc(r.tag)}】 | ${r.kind} | [${r.cat}] ${esc(r.reason)} |\n`;
fs.writeFileSync(process.argv[2] || 'docs/manual-effects.md', md);
console.log(rows.length, 'rows', cardsSet.size, 'cards', JSON.stringify(byKind));
