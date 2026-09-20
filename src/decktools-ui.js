// Deck-builder analysis UI (stats / checkup / sample hand / deck management). Pure logic lives in decktools.js.
// Mounted from main.js: const DA = createDeckAnalysis(ctx); container.appendChild(DA.el); DA.refresh() after deck changes.
// ctx = { h, S, E, DB, cardChip, getDraft, loadDeck(name, def), refreshDeck(), showToast(msg), openPreview(id), setIdFilter(ids, label), artUrl(id), getSavedName() }
import * as T from './decktools.js';

// rAF keeps the UI smooth; the timeout covers hidden tabs where rAF is paused
const nextTick = (f) => { let d = false; const g = () => { if (!d) { d = true; f(); } }; requestAnimationFrame(g); setTimeout(g, 60); };
const pct = (x) => (x * 100).toFixed(1) + '%';
const PANELS = [['stats', '📊 통계'], ['check', '🩺 체크업'], ['sample', '🎲 샘플 핸드'], ['manage', '🗂 덱 관리']];
const COLOR_HEX = { red: '#d85a5a', blue: '#4ea8de', yellow: '#e6c94a', green: '#57b06a', black: '#888', purple: '#a070e0', white: '#eee' };

export function createDeckAnalysis(ctx) {
  const { h, S, E, DB } = ctx;
  const env = T.makeEnv(S, E);
  const open = (() => { try { return JSON.parse(localStorage.getItem('digimon_dt_open_v1') || '{}'); } catch { return {}; } })();
  const saveOpen = () => { try { localStorage.setItem('digimon_dt_open_v1', JSON.stringify(open)); } catch { /* ignore */ } };
  const bodies = {}, heads = {};
  let sample = null, batch = null, batchTok = 0, batchRes = null, batchTarget = '', diffWith = '', timer = null;

  const nm = (id) => S.card(id).nameKo;
  const link = (id, label) => h('button', { className: 'dt-link', title: `${nm(id)} (${id}) 미리보기`, onClick: () => ctx.openPreview(id) }, label || `${nm(id)}`);
  const bar = (label, n, max, opts = {}) => h('div', { className: 'dt-barrow' }, [
    h('span', { className: 'dt-bl' }, label),
    h('span', { className: 'dt-track' }, [h('span', { className: 'dt-fill', style: `width:${max ? Math.min(100, (n / max) * 100) : 0}%;${opts.color ? 'background:' + opts.color : ''}` })]),
    h('span', { className: 'dt-bn' }, opts.text != null ? opts.text : String(n)),
  ]);
  const sect = (title, ...kids) => h('div', { className: 'dt-sect' }, [h('div', { className: 'zone-label' }, title), ...kids]);
  const chips = (pairs, cls = '') => h('div', { className: 'db-chips' }, pairs.map(([k, v]) => h('span', { className: 'dt-chip ' + cls }, `${k} ×${v}`)));

  // ------------------------------------------------------------- stats
  function renderStats(box) {
    const d = ctx.getDraft();
    const st = T.deckStats(d, env);
    const G = st.evo;
    const kids = [];
    kids.push(sect('구성',
      bar('디지몬', st.cat.digimon, st.mainN || 1), bar('테이머', st.cat.tamer, st.mainN || 1), bar('옵션', st.cat.option, st.mainN || 1),
      bar('디지타마', st.cat.digitama, 5), h('div', { className: 'meta' }, `메인 ${st.mainN}/50 · 평균 코스트 ${st.avgCost.toFixed(2)} (디지몬 ${st.avgDigiCost.toFixed(2)}) · 시큐리티 효과 ${st.security}장 (${pct(st.securityDensity)}) · 패러렐 선택 ${st.parN}종`)));
    const lvMax = Math.max(1, ...Object.values(st.lv));
    kids.push(sect('Lv 분포 (메인 디지몬)', ...[2, 3, 4, 5, 6, 7].map(n => bar(`Lv.${n}`, st.lv[n], lvMax))));
    const cMax = Math.max(1, ...st.curve.digimon.map((_, i) => st.curve.digimon[i] + st.curve.tamer[i] + st.curve.option[i]));
    kids.push(sect('코스트 곡선 (등장/사용 코스트 · 디지몬 ■ 테이머 ■ 옵션 ■)', ...st.curve.digimon.map((_, i) => {
      const a = st.curve.digimon[i], b = st.curve.tamer[i], c = st.curve.option[i], tot = a + b + c;
      return h('div', { className: 'dt-barrow' }, [h('span', { className: 'dt-bl' }, i === 15 ? '15+' : String(i)),
        h('span', { className: 'dt-track' }, [h('span', { className: 'dt-fill', style: `width:${(a / cMax) * 100}%;background:#4ea8de` }), h('span', { className: 'dt-fill', style: `width:${(b / cMax) * 100}%;background:#57b06a` }), h('span', { className: 'dt-fill', style: `width:${(c / cMax) * 100}%;background:#e6c94a` })]),
        h('span', { className: 'dt-bn' }, String(tot))]);
    })));
    const colEntries = Object.entries(st.colors).sort((a, b) => b[1] - a[1]);
    kids.push(sect(`색 분포 (다색 카드 ${st.multiColor}장은 각 색에 중복 집계)`, ...colEntries.map(([k, n]) => bar(T.COLOR_KO[k] || k, n, Math.max(...colEntries.map(x => x[1])), { color: COLOR_HEX[k] }))));
    const dpMax = Math.max(1, ...st.dp.map(x => x.n));
    kids.push(sect('DP 분포 (디지몬)', ...st.dp.map(x => bar(x.label, x.n, dpMax))));
    // evolution coverage
    const evoRows = Object.keys(G.sources).sort((a, b) => (S.card(a).level - S.card(b).level) || (a < b ? -1 : 1)).map(id => {
      const src = G.sources[id], c = S.card(id), n = d.main[id];
      const warn = G.orphans.includes(id) ? '❌ 도달 불가' : G.altOnly.includes(id) ? '△ 특수 진화' : (c.level === 3 && G.noRoot.includes(id)) ? '⚠ Lv.2/디지타마 없음' : '';
      return h('div', { className: 'dt-evo' + (warn.startsWith('❌') ? ' bad' : warn ? ' warn' : '') }, [
        link(id, `Lv.${c.level} ${c.nameKo} ×${n}`), h('span', { className: 'dt-evo-src' }, src.length ? ' ← ' : ' ← 없음 '),
        ...src.flatMap((s, i) => [i ? ', ' : '', link(s, `${nm(s)}${d.main[s] || d.digitama[s] ? ' ×' + (d.main[s] || d.digitama[s]) : ''}`)]), warn ? h('b', {}, ' ' + warn) : null]);
    });
    kids.push(sect(`진화 라인 커버리지 (도달 불가 ${G.orphans.length} · Lv.3 뿌리 없음 ${G.noRoot.length})`, ...(evoRows.length ? evoRows : [h('div', { className: 'meta' }, 'Lv.3 이상 디지몬이 없습니다')])));
    const kw = Object.entries(st.keywords).sort((a, b) => b[1] - a[1]);
    kids.push(sect('키워드 (카드 수)', kw.length ? chips(kw) : h('span', { className: 'meta' }, '없음')));
    const tg = Object.entries(st.tags).sort((a, b) => b[1] - a[1]);
    kids.push(sect('효과 타입 (【 】 카드 수)', tg.length ? chips(tg) : h('span', { className: 'meta' }, '없음')));
    kids.push(sect('특징 상위 (클러스터)', st.topTraits.length ? chips(st.topTraits) : h('span', { className: 'meta' }, '없음')));
    kids.push(sect(`4장 채운 카드 (${st.four.length}종)`, st.four.length ? h('div', { className: 'db-chips' }, st.four.map(id => link(id, `${nm(id)} ×${d.main[id] || d.digitama[id]}`))) : h('span', { className: 'meta' }, '없음')));
    box.replaceChildren(...kids);
  }

  // ------------------------------------------------------------- checkup
  function renderCheck(box) {
    const d = ctx.getDraft();
    const list = T.deckCheckup(d, env);
    const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
    const head = h('div', { className: 'meta' }, list.length ? `점검 결과 ${list.length}건 — 항목을 누르면 관련 카드만 검색 결과에 표시됩니다` : '문제가 발견되지 않았습니다 👍');
    const clear = h('button', { onClick: () => ctx.setIdFilter(null) }, '관련 카드 필터 해제');
    box.replaceChildren(head, clear, ...list.map(x => h('div', { className: 'dt-issue ' + x.level, tabindex: '0', title: x.ids.length ? '누르면 관련 카드만 표시' : '', onClick: () => { if (x.ids.length) ctx.setIdFilter(x.ids, x.title); } }, [
      h('div', { className: 'dt-issue-t' }, `${ICON[x.level]} ${x.title}${x.ids.length ? ` (${x.ids.length}종)` : ''}`),
      h('div', { className: 'dt-issue-w' }, x.why)])));
  }

  // ------------------------------------------------------------- sample hand
  function bigHand(ids) { return h('div', { className: 'dt-hand' }, ids.map(id => ctx.cardChip(id, { art: ctx.artUrl(id), onClick: () => ctx.openPreview(id) }))); }
  function renderSample(box) {
    const d = ctx.getDraft();
    const kids = [];
    const act = (label, fn, cls = '', disabled = false) => h('button', { className: cls, disabled, onClick: () => { fn(); renderSample(box); } }, label);
    const newS = () => { const dd = ctx.getDraft(); if (T.sumCounts(dd.main) < 6) { ctx.showToast('메인덱에 카드가 6장 이상 필요합니다'); return; } sample = T.sampleNew(dd); };
    if (!sample) kids.push(h('div', { className: 'actions-row' }, [act('🎲 새 샘플 핸드 뽑기', newS, 'primary')]));
    else {
      const s = sample;
      kids.push(h('div', { className: 'actions-row' }, [
        act('🎲 다시 섞기', newS, 'primary'),
        act(s.mulliganed ? '멀리건 (이미 함)' : '멀리건', () => T.sampleMulligan(s), '', s.phase !== 'opening' || s.mulliganed),
        act('핸드 확정 (시큐리티 5장)', () => T.sampleKeep(s), '', s.phase !== 'opening'),
        act('다음 턴 드로우 (1장)', () => T.sampleDraw(s), '', !s.deck.length),
        act('디지타마 부화', () => T.sampleHatch(s), '', !!s.raising || !s.digitama.length),
      ]));
      kids.push(h('div', { className: 'zone-label' }, `손패 ${s.hand.length}장 · 덱 ${s.deck.length}장 · 시큐리티 ${s.security.length}장 · 디지타마덱 ${s.digitama.length}장 (${s.phase === 'opening' ? '멀리건 선택 중' : `${s.turn}턴째`})`));
      kids.push(bigHand(s.hand));
      if (s.raising) kids.push(h('div', { className: 'meta' }, ['육성 구역: ', link(s.raising)]));
      kids.push(h('details', { className: 'dt-hist' }, [h('summary', {}, `기록 (${s.history.length})`), ...s.history.map(t => h('div', { className: 'meta' }, t.replace(/[A-Z]{1,3}\d{0,2}-\d{1,3}/g, m => `${nm(m)}`)))]));
    }
    // batch
    const cardIds = Object.keys(d.main);
    const sel = h('select', { className: 'db-scope', title: '특정 카드가 손패에 올 확률' }, [h('option', { value: '' }, '카드 지정 안 함'), ...cardIds.map(id => h('option', { value: id }, `${nm(id)} ×${d.main[id]}`))]);
    sel.value = cardIds.includes(batchTarget) ? batchTarget : '';
    sel.addEventListener('change', () => { batchTarget = sel.value; });
    const nSel = h('select', { className: 'db-scope' }, [1000, 10000, 50000].map(n => h('option', { value: n }, `${n.toLocaleString()}회`)));
    nSel.value = '10000';
    const prog = h('div', { className: 'dt-prog', style: 'display:none' }, [h('div', { className: 'dt-prog-in' })]);
    const out = h('div', { className: 'dt-batch-out' });
    const runBtn = h('button', { className: 'primary', onClick: () => {
      const d = ctx.getDraft(); // (fresh: the deck may have changed since this panel was drawn)
      if (T.sumCounts(d.main) < 6) { ctx.showToast('메인덱에 카드가 6장 이상 필요합니다'); return; }
      const model = T.buildSimModel(d, env);
      const tok = ++batchTok; const N = Number(nSel.value);
      batch = T.createBatch(d, env, { n: N, targetId: sel.value || null, model });
      prog.style.display = ''; out.replaceChildren();
      const chunk = () => {
        if (tok !== batchTok) return;
        const done = batch.step(1000);
        prog.firstChild.style.width = (batch.result().n / N) * 100 + '%';
        if (done) { batchRes = { r: batch.result(), target: sel.value, N, model }; prog.style.display = 'none'; renderBatch(out, batchRes, d); } else nextTick(chunk);
      };
      nextTick(chunk);
    } }, '▶ 시뮬레이션 실행');
    kids.push(sect('오프닝 핸드 시뮬레이션 (5장 · 무작위, 1회 멀리건 가정)', h('div', { className: 'actions-row' }, [nSel, sel, runBtn]), prog, out));
    box.replaceChildren(...kids);
    if (batchRes && batchRes.N && !out.firstChild && prog.style.display === 'none') renderBatch(out, batchRes, d);
  }
  function renderBatch(out, b, d) {
    const r = b.r, ex = (K, n) => T.hyperAtLeast(T.sumCounts(d.main), K, n, 1);
    const row = (label, p, note) => h('tr', {}, [h('td', {}, label), h('td', { className: 'num' }, pct(p)), h('td', {}, [h('span', { className: 'dt-track' }, [h('span', { className: 'dt-fill', style: `width:${p * 100}%` })])]), h('td', { className: 'meta' }, note || '')]);
    const rows = [
      row('Lv.3 디지몬 1장 이상', r.pLv3, `디지타마 ${T.sumCounts(d.digitama)}장${r.hatchable ? ' (부화 가능)' : ' — 디지타마 없음!'}`),
      row('메인에 Lv.2 디지몬 1장 이상', r.pLv2),
      row('디지타마에서 진화 가능한 디지몬 보유', r.pLineEgg, '부화 후 바로 이어지는 Lv.3'),
      row('손패 안에서 진화 연결 (디지타마 포함)', r.pLine, '손패 카드끼리/디지타마로 이어지는 진화 쌍'),
      row('코스트 ≤3 디지몬 없음', r.pNoLow, '낮을수록 좋음'),
      row('블로커 1장 이상', r.pBlocker),
      row('키핑 가능 핸드', r.pGood, 'Lv.3 또는 코스트 ≤3 디지몬 포함'),
      row('멀리건 후 키핑 가능', r.pGoodAfterMulligan, `개선 ${r.mulliganGain >= 0 ? '+' : ''}${pct(r.mulliganGain)}p`),
    ];
    if (b.target) {
      const K = d.main[b.target] || 0;
      rows.push(row(`${nm(b.target)} — 오프닝 5장`, r.pTargetOpen, `이론값 ${pct(ex(K, 5))}`));
      rows.push(row(`${nm(b.target)} — 3턴째까지 (5+3장)`, r.pTargetTurns, `이론값 ${pct(ex(K, 8))}`));
    }
    out.replaceChildren(
      h('div', { className: 'meta' }, `${r.n.toLocaleString()}회 시뮬레이션 결과 · 평균 테이머 ${r.avgTamers.toFixed(2)}장 · 평균 옵션 ${r.avgOptions.toFixed(2)}장`),
      h('table', { className: 'dt-table' }, [h('tbody', {}, rows)]));
  }

  // ------------------------------------------------------------- deck management
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function printView(withImages) {
    document.getElementById('db-print')?.remove();
    const d = ctx.getDraft(), st = T.deckStats(d, env, { evo: false });
    const sec = (title, zone) => {
      const rows = T.sortEntries(Object.entries(d[zone]), 'cat', S.card);
      return h('div', {}, [h('h3', {}, `${title} (${T.sumCounts(d[zone])})`), h('table', { className: 'pr-table' }, [h('tbody', {}, rows.map(([id, n]) => { const c = S.card(id); return h('tr', {}, [
        withImages ? h('td', {}, [c.imgUrl ? h('img', { src: ctx.artUrl(id) || c.imgUrl, className: 'pr-img', alt: '' }) : '']) : null,
        h('td', {}, String(n) + '×'), h('td', {}, id), h('td', {}, c.nameKo), h('td', {}, T.CAT_KO[c.category] || ''), h('td', {}, c.level != null ? 'Lv.' + c.level : ''), h('td', {}, c.cost != null ? 'C' + c.cost : ''), h('td', {}, (c.colors || []).map(k => T.COLOR_KO[k] || k).join('/'))]); }))])]);
    };
    const box = h('div', { id: 'db-print' }, [h('h2', {}, ctx.getSavedName() || d.name || '덱 리스트'), h('div', {}, `메인 ${st.mainN}/50 · 디지타마 ${st.digN}/5 · 평균 코스트 ${st.avgCost.toFixed(2)}`), sec('메인덱', 'main'), sec('디지타마덱', 'digitama')]);
    document.body.appendChild(box);
    const cleanup = () => { box.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 50);
  }
  function renderManage(box) {
    const d = ctx.getDraft(), saved = DB.loadSavedDecks(), names = Object.keys(saved);
    const kids = [];
    // compare
    const sel = h('select', { className: 'db-scope' }, [h('option', { value: '' }, '비교할 저장 덱 선택'), ...names.map(n => h('option', { value: n }, n))]);
    sel.value = names.includes(diffWith) ? diffWith : '';
    const diffOut = h('div', { className: 'dt-diff' });
    const showDiff = () => {
      diffWith = sel.value; diffOut.replaceChildren();
      if (!diffWith || !saved[diffWith]) return;
      const df = T.diffDecks(saved[diffWith], d);
      diffOut.append(h('div', { className: 'meta' }, `「${diffWith}」 → 현재 덱: +${df.added}장 / −${df.removed}장 · 공통 ${df.same}장 · 달라진 카드 ${df.changedKinds}종`),
        ...df.rows.map(r => h('div', { className: 'dt-drow ' + (r.delta > 0 ? 'add' : 'del') }, [h('b', {}, r.delta > 0 ? `+${r.delta}` : String(r.delta)), ' ', link(r.id, `${nm(r.id)} (${r.id})`), h('span', { className: 'meta' }, ` ${r.a} → ${r.b}`)])));
    };
    sel.addEventListener('change', showDiff);
    kids.push(sect('저장된 덱과 비교 (저장본 → 현재 편집 중인 덱)', sel, diffOut));
    // backup
    const ta = h('textarea', { className: 'di-text', rows: 4, placeholder: '백업 JSON을 여기에 붙여넣거나 파일을 선택하세요' });
    const msg = h('div', { className: 'meta' });
    const doRestore = (text) => {
      const r = T.parseBackup(text, env);
      const n = Object.keys(r.decks).length;
      if (!n) { msg.textContent = '복원할 덱이 없습니다. ' + r.errors.slice(0, 3).join(' / '); return; }
      const all = DB.loadSavedDecks(); let over = 0;
      for (const [k, v] of Object.entries(r.decks)) { if (all[k]) over++; all[k] = v; }
      DB.saveSavedDecks(all); ctx.refreshDeck();
      msg.textContent = `덱 ${n}개 복원 완료 (같은 이름 ${over}개 덮어씀)${r.errors.length ? ` · 무시된 항목 ${r.errors.length}개` : ''}`; ctx.showToast(msg.textContent); // (the panel is redrawn after the deck list refresh)
    };
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; f.text().then(t => { ta.value = t; msg.textContent = `파일 읽음: ${f.name} — 「복원」을 누르세요`; }); });
    kids.push(sect('전체 덱 백업 / 복원',
      h('div', { className: 'actions-row' }, [
        h('button', { onClick: () => { const all = DB.loadSavedDecks(); if (!Object.keys(all).length) { msg.textContent = '저장된 덱이 없습니다'; return; } download(`digimon-decks-${new Date().toISOString().slice(0, 10)}.json`, T.exportBackup(all)); msg.textContent = `저장된 덱 ${Object.keys(all).length}개를 파일로 내보냈습니다`; } }, '📥 전체 내보내기 (파일)'),
        h('button', { onClick: () => { const all = DB.loadSavedDecks(); const t = T.exportBackup(all); (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => { msg.textContent = '백업 JSON을 클립보드에 복사했습니다'; }).catch(() => { ta.value = t; msg.textContent = '아래 텍스트를 복사해 두세요'; }); } }, '📋 JSON 복사')]),
      ta, h('div', { className: 'actions-row' }, [file, h('button', { className: 'primary', onClick: () => doRestore(ta.value) }, '📤 복원 (덮어쓰기 병합)')]), msg));
    // print
    let img = false;
    const imgChk = h('input', { type: 'checkbox' }); imgChk.addEventListener('change', () => { img = imgChk.checked; });
    kids.push(sect('인쇄용 보기', h('label', { className: 'meta' }, [imgChk, ' 카드 이미지 포함 ']), h('button', { onClick: () => printView(img) }, '🖨 인쇄 / PDF 저장')));
    box.replaceChildren(...kids);
  }

  // saved-deck list with rename / duplicate / delete / reorder (rendered by main.js into its `els.saved`)
  function renderSaved(container) {
    const saved = DB.loadSavedDecks(), names = Object.keys(saved);
    const commit = (decks) => { DB.saveSavedDecks(decks); ctx.refreshDeck(); };
    if (!names.length) { container.replaceChildren(); return; }
    container.replaceChildren(h('div', { className: 'zone-label' }, `저장된 덱 (${names.length})`), ...names.map((name, i) => {
      const s = saved[name], mainN = T.sumCounts(s.main), digN = T.sumCounts(s.digitama);
      const bad = !S.deckLegality(s).ok;
      return h('div', { className: 'dt-saved' }, [
        h('span', { className: 'dt-saved-name', title: `${mainN}/50 · 디지타마 ${digN}` + (bad ? ' · 규칙 위반' : '') }, `${name}${bad ? ' ⚠' : ''} `), h('span', { className: 'meta' }, `${mainN}+${digN}`),
        h('button', { title: '불러오기', onClick: () => ctx.loadDeck(name, saved[name]) }, '불러오기'),
        h('button', { title: '위로', disabled: i === 0, onClick: () => { const r = T.moveDeck(saved, name, -1); if (r) commit(r); } }, '▲'),
        h('button', { title: '아래로', disabled: i === names.length - 1, onClick: () => { const r = T.moveDeck(saved, name, 1); if (r) commit(r); } }, '▼'),
        h('button', { title: '이름 변경', onClick: () => { const nn = prompt('새 이름', name); if (nn == null) return; const r = T.renameDeck(saved, name, nn); if (!r) { ctx.showToast('이름이 비었거나 이미 있습니다'); return; } commit(r); if (ctx.getSavedName() === name) ctx.loadDeck(nn.trim(), r[nn.trim()], true); } }, '이름'),
        h('button', { title: '복제', onClick: () => { const r = T.duplicateDeck(saved, name); if (r) { commit(r.decks); ctx.showToast(`「${r.name}」 복제됨`); } } }, '복제'),
        h('button', { className: 'danger', title: '삭제', onClick: () => { if (!confirm(`「${name}」 덱을 삭제할까요?`)) return; delete saved[name]; commit(saved); } }, '삭제'),
      ]);
    }));
  }

  // ------------------------------------------------------------- shell
  const RENDER = { stats: renderStats, check: renderCheck, sample: renderSample, manage: renderManage };
  const el = h('div', { className: 'dt-root' });
  for (const [key, label] of PANELS) {
    const head = h('button', { className: 'dt-head', onClick: () => { open[key] = !open[key]; saveOpen(); sync(key); } });
    const body = h('div', { className: 'dt-body' });
    heads[key] = { head, label }; bodies[key] = body;
    el.append(head, body);
  }
  function sync(key) {
    const on = !!open[key];
    heads[key].head.textContent = `${on ? '▾' : '▸'} ${heads[key].label}`;
    heads[key].head.classList.toggle('on', on);
    bodies[key].style.display = on ? '' : 'none';
    if (on) { try { RENDER[key](bodies[key]); } catch (e) { bodies[key].textContent = '표시 오류: ' + e.message; console.error(e); } }
  }
  for (const [key] of PANELS) sync(key);
  // live update: cheap (only open panels, coalesced); sample hand & batch results are kept as they are
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => { for (const key of ['stats', 'check', 'manage', 'sample']) if (open[key]) sync(key); }, 120);
    batchTok++; batchRes = null; // an unfinished / finished batch belongs to the previous deck
  }
  return { el, refresh, renderSaved, openPanel: (k) => { open[k] = true; saveOpen(); sync(k); }, env };
}
