// node scripts/census-report.mjs merged.json > docs/effect-census.md   (Korean report from the merged census)
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const M = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const extra = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') : '';
const nm = (id) => `${id} ${(S.CARDS[id] || {}).nameKo || '?'}`;
const segs = Object.values(M.segs), dead = Object.values(M.dead);
const out = [];
const P = (s = '') => out.push(s);
const cards = Object.values(S.CARDS).filter(c => !c.isToken);
P('# 효과 트리거 센서스 (effect census)');
P();
P(`- 자동 생성: \`scripts/census.mjs\` (CPU 대 CPU 게임, \`src/cpusim.js\` 의 drain 에 \`globalThis.__CENSUS\` 훅) → \`scripts/census-report.mjs\``);
P(`- 총 ${M.games}게임, 카드 ${Object.keys(M.gamesByCard).length}종 중심 덱(4장 + 진화 라인 + 서포터; 1/3은 양쪽이 같은 덱인 미러), 기록된 (카드, 태그, 출처) 세그먼트 ${segs.length}개`);
P(`- 큐잉(TRIGGERED) 합계 ${segs.reduce((a, s) => a + s.queued, 0)}, 해결(RESOLVED) ${segs.reduce((a, s) => a + s.resolved, 0)}, 수동(MANUAL: 스크립트 없음) ${segs.reduce((a, s) => a + s.manual, 0)}, SILENT ${segs.reduce((a, s) => a + s.silent, 0)}, 에러 ${segs.reduce((a, s) => a + s.err, 0)}, DOUBLE ${segs.reduce((a, s) => a + s.dbl, 0)}`);
P('- 한계: 지속 효과(continuous)의 "적용 증거"는 측정하지 않음(자동 적용은 큐를 거치지 않음). DEAD 판정은 `등장 시/진화 시/소멸 시/어택 시` 자기 이벤트 한정(감시형 효과는 아래 WATCHER-SUSPECT 로 추정).');
P();
// ---- DEAD
if (extra) { P(extra); P(); }
const deadL = dead.filter(d => d.missed > 0).sort((a, b) => b.missed - a.missed);
P(`## DEAD — 이벤트가 실제 발생했는데 큐잉되지 않은 세그먼트 (${deadL.length}종)`);
P('기준: 해당 카드(또는 진화원)가 스택에 있는 상태에서 인쇄된 자기 트리거 이벤트가 발생, 같은 배치에 그 카드의 어떤 pending 도 없고 `(자동 처리)`/`발휘하지 않음` 로그도 없음.');
P();
P('| 카드 | 태그 | 출처 | 이벤트 | 누락 | 본문 | 예시 |'); P('|---|---|---|---|---|---|---|');
for (const d of deadL.slice(0, 150)) P(`| ${nm(d.card)} | ${d.tag} | ${d.src} | ${d.events} | ${d.missed} | ${d.text.replace(/\|/g, '/')} | ${d.ex ? `T${d.ex.turn} ${d.ex.kind} src${d.ex.inSources}` : ''} |`);
P();
// ---- DOUBLE
const dbl = segs.filter(s => s.dbl > 0).sort((a, b) => b.dbl - a.dbl);
P(`## DOUBLE — 한 이벤트에 같은 세그먼트가 2회 이상 큐잉 (${dbl.length}종)`); P();
P('| 카드 | 태그 | 출처 | 횟수 | 큐잉 | 본문 |'); P('|---|---|---|---|---|---|');
for (const s of dbl.slice(0, 100)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.dbl} | ${s.queued} | ${s.text.replace(/\|/g, '/')} |`);
P();
// ---- SILENT
const sil = segs.filter(s => s.resolved >= 6 && s.silent / s.resolved >= 0.95).sort((a, b) => b.silent - a.silent);
P(`## SILENT — 해결(스크립트 실행)됐지만 상태 변화도 로그도 없음 (해결 6회 이상 & 95%+ 무변화, ${sil.length}종)`);
P('조건부 효과(조건 미충족)는 정상적으로 무변화가 될 수 있음 → 상위 항목부터 수동 검토.'); P();
P('| 카드 | 태그 | 출처 | silent/해결 | 본문 | ops |'); P('|---|---|---|---|---|---|');
for (const s of sil.slice(0, 120)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.silent}/${s.resolved} | ${s.text.replace(/\|/g, '/')} | ${s.silentEx ? s.silentEx.ops : ''} |`);
P();
const COND = /(있다면|없다면|일 때|일때|할 때|일 경우|경우|이라면|라면|있을 때|없을 때|가질 때|가진다면|하는 것으로|수 있다|[〔\[]턴)/;
const silU = segs.filter(s => s.resolved >= 4 && s.silent / s.resolved >= 0.9 && !COND.test(s.text)).sort((a, b) => b.silent - a.silent);
P(`### SILENT-UNCOND — 조건/비용/선택 문구가 없는데도 무변화 (${silU.length}종) — 가장 의심스러운 no-op`); P();
P('| 카드 | 태그 | 출처 | silent/해결 | 본문 | ops |'); P('|---|---|---|---|---|---|');
for (const s of silU.slice(0, 120)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.silent}/${s.resolved} | ${s.text.replace(/\|/g, '/')} | ${s.silentEx ? s.silentEx.ops : ''} |`);
P();
const once = segs.filter(s => s.once > 0).sort((a, b) => b.once - a.once);
P(`## ONCE-VIOLATION — 〔턴에 N회〕 상한을 넘겨 "효과적으로" 두 번 이상 해결된 세그먼트 (${once.length}종)`);
P('같은 (카드, 스택, 세그먼트)가 한 턴에 상한×(스택 안 같은 카드 장수)보다 많이 상태 변화를 일으킴.'); P();
P('| 카드 | 태그 | 출처 | 위반 | 큐잉 | 본문 | 예시 |'); P('|---|---|---|---|---|---|---|');
for (const s of once.slice(0, 100)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.once} | ${s.queued} | ${s.text.replace(/\|/g, '/')} | ${s.onceEx ? `n=${s.onceEx.n} cap=${s.onceEx.cap} ${s.onceEx.ops}` : ''} |`);
P();
// ---- played but tag never queued
const NEVERQ = [];
const TAGS_OWN = ['등장 시', '진화 시', '어택 시', '소멸 시', '메인', '시큐리티', '자신의 턴 종료 시', '자신의 메인 페이즈 개시 시', '어택 종료 시'];
for (const c of cards) {
  const pl = (M.played[c.id] || 0); if (pl < 6 || !c.effectKo) continue;
  for (const seg of S.parseEffectSegments(c.effectKo).segments) {
    if (seg.zoneMarker) continue;
    const tg = seg.tags.find(x => TAGS_OWN.includes(x)); if (!tg) continue;
    if (/^[≪《]\s*딜레이\s*[≫》]/.test(seg.body.trim())) continue;
    const q = segs.filter(x => x.card === c.id && x.tags.split('/').includes(tg) && x.src !== 'inherited').reduce((a, x) => a + x.queued, 0);
    const auto = 0;
    if (q === 0) NEVERQ.push({ c, tg, pl, body: seg.body.replace(/\s+/g, ' ').slice(0, 90) });
  }
}
P(`## PLAYED-NEVER-QUEUED — 6회 이상 플레이/등장했는데 인쇄된 태그가 한 번도 큐잉되지 않은 본체 세그먼트 (${NEVERQ.length}종)`);
P('이벤트가 드문 태그(시큐리티/턴종료 등)는 자연스러울 수 있음. 자동 처리(tryAutoApplySegment)되는 단순 효과는 큐를 거치지 않으므로 함께 나열됨.'); P();
P('| 카드 | 태그 | 플레이 | 본문 |'); P('|---|---|---|---|');
for (const w of NEVERQ.sort((a, b) => b.pl - a.pl).slice(0, 150)) P(`| ${nm(w.c.id)} | ${w.tg} | ${w.pl} | ${w.body.replace(/\|/g, '/')} |`);
P();
// ---- MANUAL
const man = segs.filter(s => s.manual > 0).sort((a, b) => b.manual - a.manual);
P(`## MANUAL — 스크립트가 없어 사람이 직접 처리해야 하는 효과 (빈도순, ${man.length}종)`); P();
P('| 카드 | 태그 | 출처 | 횟수 | 사람에게 보이는 프롬프트(본문) |'); P('|---|---|---|---|---|');
for (const s of man.slice(0, 150)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.manual} | ${s.text.replace(/\|/g, '/')} |`);
P();
// ---- ERR
const err = segs.filter(s => s.err > 0).sort((a, b) => b.err - a.err);
P(`## ERRORED (${err.length}종)`); P();
for (const s of err.slice(0, 60)) P(`- ${nm(s.card)} 【${s.tags}】 ×${s.err}: ${s.errEx}`);
P();
// ---- WATCHER-SUSPECT
const wsus = [];
for (const c of cards) {
  for (const [key, isInh] of [['effectKo', false], ['inheritedKo', true]]) {
    if (!c[key]) continue;
    const pres = isInh ? (M.presentInh[c.id] || 0) : (M.present[c.id] || 0);
    if (pres < 5) continue;
    for (const seg of S.parseEffectSegments(c[key]).segments) {
      if (!seg.tags.some(t => ['자신의 턴', '상대의 턴', '서로의 턴'].includes(t))) continue;
      if (!/(했을|되었을|하였을|늘어났을|줄어들었을|놓였을|나왔을|올랐을|가 되었을)\s*때/.test(seg.body)) continue;
      const q = segs.filter(s => s.card === c.id && s.tags === seg.tags.join('/') && (isInh ? /inh/.test(s.src) : !/inh/.test(s.src))).reduce((a, s) => a + s.queued, 0);
      wsus.push({ c, tags: seg.tags.join('/'), inh: isInh, pres, q, body: seg.body.replace(/\s+/g, ' ').slice(0, 80) });
    }
  }
}
const wz = wsus.filter(w => w.q === 0).sort((a, b) => b.pres - a.pres);
P(`## WATCHER-SUSPECT — 보드에 5게임 이상 등장했는데 감시형(…했을 때) 세그먼트가 한 번도 큐잉되지 않음 (${wz.length}종 / 감시형 전체 ${wsus.length})`);
P('큐잉 0 은 (a) 이벤트 자체가 드물거나 (b) 조건이 안 맞았거나 (c) 감시자 미파싱일 수 있음 → 상위 항목만 수동 확인.'); P();
P('| 카드 | 태그 | 출처 | 보드 게임수 | 본문 |'); P('|---|---|---|---|---|');
for (const w of wz.slice(0, 120)) P(`| ${nm(w.c.id)} | ${w.tags} | ${w.inh ? '진화원' : '본체'} | ${w.pres} | ${w.body.replace(/\|/g, '/')} |`);
P();
// ---- WATCHER-DEAD (opportunity based)
const wd = [];
for (const [k, opp] of Object.entries(M.wopp || {})) {
  const [cid, tag, src] = k.split('|');
  const q = segs.filter(x => x.card === cid && x.tags === tag && (src === 'inh' ? /inh|inherited/.test(x.src) : !/inh|inherited/.test(x.src))).reduce((a, x) => a + x.queued, 0);
  if (opp >= 40 && q === 0) wd.push({ cid, tag, src, opp });
}
wd.sort((a, b) => b.opp - a.opp);
P(`## WATCHER-DEAD — 감시 이벤트가 40회 이상 실제로 발생했는데(보드에 있고 턴 범위 일치) 한 번도 큐잉되지 않은 감시형 세그먼트 (${wd.length}종)`);
P('이벤트 종류만 일치하면 집계(주체 조건은 무시)하므로, 주체/조건이 좁은 카드는 정상적으로 0일 수 있음 → 본문의 주체 조건을 보고 판정.'); P();
P('| 카드 | 태그 | 출처 | 이벤트 기회 | 본문 |'); P('|---|---|---|---|---|');
for (const w of wd.slice(0, 150)) { const c = S.CARDS[w.cid]; const txt = (w.src === 'inh' ? c.inheritedKo : c.effectKo) || ''; const seg = S.parseEffectSegments(txt).segments.find(x => x.tags[0] === w.tag); P(`| ${nm(w.cid)} | ${w.tag} | ${w.src === 'inh' ? '진화원' : '본체'} | ${w.opp} | ${(seg ? seg.body : '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 100)} |`); }
P();
// ---- NEVER SEEN
const never = cards.filter(c => c.category !== 'digitama' && !(M.played[c.id] || 0) && !(M.present[c.id] || 0) && !(M.hand[c.id] || 0));
const notPlayed = cards.filter(c => ['digimon', 'tamer', 'option'].includes(c.category) && !(M.played[c.id] || 0) && !(M.present[c.id] || 0) && (M.hand[c.id] || 0) > 0);
P(`## NEVER-SEEN — 패에도 한 번도 들어오지 않은 카드 (${never.length}장) / 패에는 왔지만 한 번도 플레이되지 않은 카드 (${notPlayed.length}장)`); P();
P('패에도 안 온 카드: ' + never.slice(0, 200).map(c => c.id).join(', ') + (never.length > 200 ? ' …' : ''));
P();
P('패에는 왔지만 미플레이(상위 200): ' + notPlayed.slice(0, 200).map(c => c.id).join(', '));
P();
// ---- fire counts (top)
P('## 카드/세그먼트별 발동 횟수 (상위 60 — 전체 데이터는 merged.json)'); P();
P('| 카드 | 태그 | 출처 | 큐잉 | 해결 | 수동 | silent | 턴당 최대 |'); P('|---|---|---|---|---|---|---|---|');
for (const s of [...segs].sort((a, b) => b.queued - a.queued).slice(0, 60)) P(`| ${nm(s.card)} | ${s.tags} | ${s.src} | ${s.queued} | ${s.resolved} | ${s.manual} | ${s.silent} | ${s.perTurnMax} |`);
P();
console.log(out.join('\n'));
