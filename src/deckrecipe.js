// 덱 레시피(.docx) 내보내기 — assets/deck-recipe-template.docx 서식(대회 제출용 "덱 레시피 제출 양식")의
// "메인 덱"/"디지타마 덱" 표에 현재 덱을 채워 넣어 다운로드한다. (기존 "덱 복사(내보내기)" 텍스트 내보내기는 그대로 둔 채 추가하는 기능.)
//
// .docx는 OOXML(zip 안의 word/document.xml)이라, JSZip(index.html에서 CDN으로 로드)으로 열어 XML 문자열을
// 표 단위로 안전하게 편집한 뒤 다시 압축한다. "카드 넘버" 같은 헤더 문구는 4개 표 중 여러 곳(특히 "작성 예시"
// 표)에 겹쳐 나오므로, 전역 문자열 치환은 절대 하지 않고 각 표를 자신의 제목 행 텍스트("메인 덱"/"디지타마 덱")로
// 정확히 찾아 그 표 안에서만 편집한다.
import * as DT from './decktools.js';

const TEMPLATE_URL = './assets/deck-recipe-template.docx';

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// OOXML 블록(태그) 찾기: 같은 태그가 중첩될 수 있는 경우(w:tbl 등)도 대비한 균형 매칭.
function findBlocks(xml, tag) {
  const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
  const close = `</${tag}>`;
  const blocks = [];
  let i = 0;
  while (true) {
    openRe.lastIndex = i;
    const om = openRe.exec(xml);
    if (!om) break;
    let depth = 1, j = om.index + om[0].length;
    while (depth > 0) {
      openRe.lastIndex = j;
      const nom = openRe.exec(xml);
      const nextOpen = nom ? nom.index : -1;
      const nextOpenLen = nom ? nom[0].length : 0;
      const nextClose = xml.indexOf(close, j);
      if (nextClose === -1) { depth = 0; j = xml.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; j = nextOpen + nextOpenLen; }
      else { depth--; j = nextClose + close.length; }
    }
    blocks.push({ start: om.index, end: j, xml: xml.slice(om.index, j) });
    i = j;
  }
  return blocks;
}

const rowText = (rowXml) => [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');

// (원래 비어 있던) 셀의 단락 끝에 텍스트 런을 삽입한다. 단락의 rPr(글꼴/크기)을 그대로 재사용해 서식이 template과 맞도록 한다.
function fillCell(cellXml, value) {
  const text = value == null ? '' : String(value);
  if (!text) return cellXml;
  const m = cellXml.match(/<w:pPr>[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>\s*<\/w:pPr>/);
  const runProps = m ? `<w:rPr>${m[1]}</w:rPr>` : '';
  const run = `<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  const idx = cellXml.lastIndexOf('</w:p>');
  if (idx === -1) return cellXml; // 예상과 다른 구조면 손대지 않고 그대로 둔다 (xml 깨짐 방지)
  return cellXml.slice(0, idx) + run + cellXml.slice(idx);
}

// 한 행(row) 템플릿의 셀들(최대 5개)을 values 순서대로 채운다.
function fillRow(rowXml, values) {
  const cells = findBlocks(rowXml, 'w:tc');
  if (!cells.length) return rowXml;
  let out = rowXml.slice(0, cells[0].start);
  cells.forEach((c, i) => { out += fillCell(c.xml, values[i]); });
  out += rowXml.slice(cells[cells.length - 1].end);
  return out;
}

// 첫 행(제목 행) 텍스트가 titleText와 정확히 일치하는 <w:tbl>을 찾아, 그 표의 데이터 행(제목+헤더 다음 행들)을
// entries로 채운다. 미리 만들어진 빈 행 수보다 entries가 많으면 마지막 빈 행의 XML을 복제해 표 끝에 추가한다.
function fillDeckTable(docXml, titleText, entries) {
  const tables = findBlocks(docXml, 'w:tbl');
  for (const t of tables) {
    const rows = findBlocks(t.xml, 'w:tr');
    if (rows.length < 3 || rowText(rows[0].xml).trim() !== titleText) continue;
    const dataRows = rows.slice(2); // 0=제목 행, 1=헤더 행
    if (!dataRows.length) return docXml; // 채울 빈 행이 없음 — 표는 건드리지 않는다
    const blankTemplate = dataRows[0].xml;
    const filled = entries.slice(0, dataRows.length).map((vals, i) => fillRow(dataRows[i].xml, vals));
    const untouched = dataRows.slice(entries.length).map(r => r.xml); // 남는 빈 행은 그대로 유지
    const overflow = entries.slice(dataRows.length).map(vals => fillRow(blankTemplate, vals));
    const newRows = rows[0].xml + rows[1].xml + filled.join('') + untouched.join('') + overflow.join('');
    const newTableXml = t.xml.slice(0, rows[0].start) + newRows + t.xml.slice(rows[rows.length - 1].end);
    return docXml.slice(0, t.start) + newTableXml + docXml.slice(t.end);
  }
  return docXml; // 표를 못 찾음 — 서식이 예상과 다르면 문서를 건드리지 않는다
}

// 맨 위 "Name / Date." 표의 Name 값 칸(1행 2번째 셀)만 덱 이름으로 채운다. Date.는 제출일이라 손대지 않는다.
function fillNameTable(docXml, name) {
  if (!name) return docXml;
  const tables = findBlocks(docXml, 'w:tbl');
  for (const t of tables) {
    const rows = findBlocks(t.xml, 'w:tr');
    if (!rows.length || rowText(rows[0].xml).trim() !== 'Name') continue;
    const cells = findBlocks(rows[0].xml, 'w:tc');
    if (cells.length < 2) continue;
    const filledCell = fillCell(cells[1].xml, name);
    const newRow = rows[0].xml.slice(0, cells[1].start) + filledCell + rows[0].xml.slice(cells[1].end);
    const newTableXml = t.xml.slice(0, rows[0].start) + newRow + t.xml.slice(rows[0].end);
    return docXml.slice(0, t.start) + newTableXml + docXml.slice(t.end);
  }
  return docXml;
}

function buildEntries(zone, S) {
  const entries = DT.sortEntries(Object.entries(zone || {}), 'no', S.card); // 카드 번호순 (template의 작성 예시와 동일한 정렬)
  return entries.map(([id, n]) => {
    const c = S.card(id);
    return [id, c.level != null ? String(c.level) : '', c.nameKo || id, DT.CAT_KO[c.category] || c.category || '', String(n)];
  });
}

// draft: { name, main:{cardId:n}, digitama:{cardId:n} }, S: import * as S from './state.js'
// 반환: { ok:true } 또는 { ok:false, error }
export async function exportDeckRecipeDocx(draft, S) {
  const mainEntries = buildEntries(draft && draft.main, S);
  const digEntries = buildEntries(draft && draft.digitama, S);
  if (!mainEntries.length && !digEntries.length) return { ok: false, error: '내보낼 카드가 없습니다' };
  if (typeof JSZip === 'undefined') return { ok: false, error: 'JSZip 라이브러리를 불러오지 못했습니다 (네트워크 확인)' };

  let res;
  try { res = await fetch(TEMPLATE_URL); } catch (e) { return { ok: false, error: '서식 파일을 불러오지 못했습니다: ' + (e.message || e) }; }
  if (!res.ok) return { ok: false, error: `서식 파일을 불러오지 못했습니다 (${res.status})` };
  const buf = await res.arrayBuffer();
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { return { ok: false, error: '서식 파일이 손상되었습니다: ' + (e.message || e) }; }
  const docFile = zip.file('word/document.xml');
  if (!docFile) return { ok: false, error: '서식 파일이 손상되었습니다 (document.xml 없음)' };
  let xml = await docFile.async('string');

  xml = fillDeckTable(xml, '메인 덱', mainEntries);
  xml = fillDeckTable(xml, '디지타마 덱', digEntries);
  xml = fillNameTable(xml, (draft && draft.name) || '');

  zip.file('word/document.xml', xml);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const filename = `${((draft && draft.name) || '덱').replace(/[\\/:*?"<>|]/g, '_')}_덱레시피.docx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true };
}
