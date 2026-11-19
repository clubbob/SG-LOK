import { formatDateShort } from '@/lib/utils';
import {
  PRODUCTION_REQUEST_CSV_HEADERS,
  buildProductionRequestListRowCsvValues,
  formatProductionListCustomerNameDisplay,
  getProductionRequestLatestStageCompletionDisplay,
  getProductionRequestLineProductGroup,
  prepareProductionRequestProgressPdfRows,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import {
  getProductionListRowGroupLabel,
  sortProductionListRowsForViewTab,
  type ProductionRequestListViewTab,
} from '@/lib/production/productionRequestListView';
import { clampProductionRequestPriority } from '@/lib/production/productionRequestPriority';

const PAGE_MARGIN_X = 8;
const PAGE_MARGIN_Y = 10;
const LANDSCAPE_PAGE_WIDTH_MM = 297;
const CONTENT_WIDTH_MM = LANDSCAPE_PAGE_WIDTH_MM - PAGE_MARGIN_X * 2;

/** CSV 열 인덱스별 PDF 열 너비(mm) — PDF에서 제외하는 열은 사용하지 않음 */
const PDF_COL_WIDTHS_BY_CSV_INDEX = [
  6, 10, 12, 10, 10, 16, 14, 16, 17, 12, 12, 12, 14, 12, 12, 10, 15, 15, 15, 15, 12, 14, 10,
] as const;

/** PDF 테이블에서 제외 (엑셀·화면은 그대로) */
const PDF_EXCLUDED_CSV_COLUMN_LABELS = new Set([
  '지역',
  '제품군',
  '제품명',
  '비고',
  '생산완료일 (수량)',
  '생산 이슈',
  '상태',
]);

/** PDF 표 오른쪽 — 1·2·3차 · UHP 세정/EP (동일 민트 배경) */
const PDF_ATTACH_SECTION_COLUMN_LABELS = new Set([
  '1차 완료일 (수량)',
  '2차 완료일 (수량)',
  '3차 완료일 (수량)',
  'UHP 세정/EP (수량)',
]);

function pdfEqualWidthGroupLabels(): Set<string> {
  return new Set([...PDF_ATTACH_SECTION_COLUMN_LABELS]);
}

const PDF_TABLE_HEADER_BG_MAIN = '#cbd5e1';
const PDF_TABLE_DATA_BG_MAIN = '#ffffff';

/** 생산계획수량 · 완료예정일 — 헤더만 연한 파랑 (본문 흰색) */
const PDF_TABLE_HEADER_BG_PLAN = '#bfdbfe';
const PDF_TABLE_DATA_BG_PLAN = '#ffffff';

/** 1·2·3차 · UHP — 헤더만 연한 민트 (본문 흰색) */
const PDF_TABLE_HEADER_BG_ATTACH = '#bbf7d0';
const PDF_TABLE_DATA_BG_ATTACH = '#ffffff';

/** 제품군 구분줄 — 표 헤더보다 연하게 + 좌측 띠 (인쇄 부담 적음) */
const PDF_GROUP_HEADER_BG = '#e2e8f0';
const PDF_GROUP_HEADER_ACCENT_MM = 1.2;
const PDF_GROUP_HEADER_ACCENT = '#475569';
const PDF_GROUP_HEADER_BORDER = '#64748b';

/** 표·제목 텍스트 — 인쇄·화면에서 흐리지 않도록 진한 색·굵기 */
const PDF_TABLE_TEXT = '#000000';
const PDF_META_TEXT = '#374151';

/** PDF 헤더 — 한 줄 표기용 짧은 라벨 (데이터·엑셀은 CSV 그대로) */
const PDF_HEADER_DISPLAY_LABELS: Record<string, string> = {
  수주수량: '수주수량',
  생산요청수량: '요청수량',
  완료요청일: '완료요청',
  생산계획수량: '계획수량',
  완료예정일: '완료예정',
  '기계명': '기계명',
  '1차 완료일 (수량)': '1차 완료',
  '2차 완료일 (수량)': '2차 완료',
  '3차 완료일 (수량)': '3차 완료',
  'UHP 세정/EP (수량)': 'UHP 세정/EP',
};

function pdfTableCellBackground(columnLabel: string | undefined, header: boolean): string {
  if (columnLabel == null) {
    return header ? PDF_TABLE_HEADER_BG_MAIN : PDF_TABLE_DATA_BG_MAIN;
  }
  if (PDF_ATTACH_SECTION_COLUMN_LABELS.has(columnLabel)) {
    return header ? PDF_TABLE_HEADER_BG_ATTACH : PDF_TABLE_DATA_BG_ATTACH;
  }
  if (
    columnLabel === '생산계획수량' ||
    columnLabel === '완료예정일' ||
    columnLabel === '최근완료' ||
    columnLabel === '기계명'
  ) {
    return header ? PDF_TABLE_HEADER_BG_PLAN : PDF_TABLE_DATA_BG_PLAN;
  }
  return header ? PDF_TABLE_HEADER_BG_MAIN : PDF_TABLE_DATA_BG_MAIN;
}

/** 열 너비 배분 가중치 — 완료 열은 과도하게 넓히지 않음 */
const PDF_COLUMN_WIDTH_WEIGHT: Record<string, number> = {
  번호: 0.7,
  고객사명: 1.1,
  제품코드: 1.22,
  요청자: 0.95,
  요청일: 1,
  생산목적: 1,
  수주수량: 1,
  생산요청수량: 1,
  완료요청일: 1,
  생산계획수량: 1,
  완료예정일: 1,
  최근완료: 1.35,
  '기계명': 0.85,
  '1차 완료일 (수량)': 1,
  '2차 완료일 (수량)': 1,
  '3차 완료일 (수량)': 1,
  'UHP 세정/EP (수량)': 1,
};

const PDF_ATTACH_EQUAL_MIN_WIDTH_MM = 22;

const PDF_MIN_COLUMN_WIDTH_MM: Record<string, number> = {
  번호: 8,
  요청자: 9,
  요청일: 10,
  생산목적: 10,
  고객사명: 14,
  제품코드: 14,
  수주수량: 11,
  생산요청수량: 13,
  완료요청일: 11,
  생산계획수량: 13,
  완료예정일: 11,
  최근완료: 20,
  '기계명': 11,
  '1차 완료일 (수량)': PDF_ATTACH_EQUAL_MIN_WIDTH_MM,
  '2차 완료일 (수량)': PDF_ATTACH_EQUAL_MIN_WIDTH_MM,
  '3차 완료일 (수량)': PDF_ATTACH_EQUAL_MIN_WIDTH_MM,
  'UHP 세정/EP (수량)': 22,
};

function scaleWidthsToTarget(baseWidths: number[], csvLabels: string[], targetTotalMm: number): number[] {
  const weighted = baseWidths.map((w, i) => {
    const weight = PDF_COLUMN_WIDTH_WEIGHT[csvLabels[i] ?? ''] ?? 1;
    return w * weight;
  });
  const sum = weighted.reduce((a, b) => a + b, 0);
  if (sum <= 0) return baseWidths;
  const scaled = weighted.map((w) => (w / sum) * targetTotalMm);
  return equalizePdfColumnWidthGroups(
    enforceMinColumnWidths(scaled, csvLabels, targetTotalMm),
    csvLabels,
    targetTotalMm
  );
}

/** 그룹별 열 너비 통일 — 그룹 합계 유지, 각 칸 동일 mm */
function equalizePdfColumnWidthGroups(
  widths: number[],
  labels: string[],
  targetTotalMm: number
): number[] {
  let next = widths;
  next = equalizeSingleColumnGroup(next, PDF_ATTACH_SECTION_COLUMN_LABELS, labels);
  return fixPdfTableWidthDrift(next, labels, targetTotalMm);
}

function equalizeSingleColumnGroup(
  widths: number[],
  groupLabels: Set<string>,
  labels: string[]
): number[] {
  const indices = labels
    .map((label, i) => (groupLabels.has(label) ? i : -1))
    .filter((i) => i >= 0);
  if (indices.length <= 1) return widths;

  const next = widths.map((w) => w);
  const totalBefore = indices.reduce((sum, i) => sum + next[i], 0);
  let unified = totalBefore / indices.length;
  unified = Math.floor(unified * 100) / 100;
  indices.forEach((i) => {
    next[i] = unified;
  });
  const remainder = Math.round((totalBefore - unified * indices.length) * 100) / 100;
  if (Math.abs(remainder) > 0.001) {
    const last = indices[indices.length - 1];
    next[last] = Math.round((next[last] + remainder) * 100) / 100;
  }
  return next;
}

function fixPdfTableWidthDrift(
  widths: number[],
  labels: string[],
  targetTotalMm: number
): number[] {
  const locked = pdfEqualWidthGroupLabels();
  const next = widths.map((w) => Math.floor(w * 100) / 100);
  let drift = Math.round((targetTotalMm - next.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (Math.abs(drift) <= 0.001) return next;
  for (let i = next.length - 1; i >= 0; i--) {
    if (locked.has(labels[i] ?? '')) continue;
    next[i] = Math.round((next[i] + drift) * 100) / 100;
    drift = Math.round((targetTotalMm - next.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (Math.abs(drift) <= 0.001) break;
  }
  return next;
}

function enforceMinColumnWidths(
  widths: number[],
  labels: string[],
  targetTotalMm: number
): number[] {
  const next = widths.map((w) => w);
  let deficit = 0;
  next.forEach((w, i) => {
    const min = PDF_MIN_COLUMN_WIDTH_MM[labels[i] ?? ''] ?? 0;
    if (min > 0 && w < min) {
      deficit += min - w;
      next[i] = min;
    }
  });
  if (deficit > 0) {
    const shrinkable = next.map((w, i) => {
      const min = PDF_MIN_COLUMN_WIDTH_MM[labels[i] ?? ''] ?? 0;
      return Math.max(0, w - min);
    });
    const shrinkSum = shrinkable.reduce((a, b) => a + b, 0);
    if (shrinkSum > 0) {
      next.forEach((w, i) => {
        const min = PDF_MIN_COLUMN_WIDTH_MM[labels[i] ?? ''] ?? 0;
        const room = w - min;
        if (room <= 0) return;
        next[i] = w - (room / shrinkSum) * deficit;
      });
    }
  }
  const rounded = next.map((w) => Math.floor(w * 10) / 10);
  const drift = targetTotalMm - rounded.reduce((a, b) => a + b, 0);
  if (rounded.length > 0) rounded[rounded.length - 1] += drift;
  return rounded;
}

function buildPdfTableLayout(): {
  headers: string[];
  csvLabels: string[];
  colWidthsMm: number[];
  tableWidthMm: number;
} {
  const headers: string[] = [];
  const csvLabels: string[] = [];
  const baseWidths: number[] = [];
  PRODUCTION_REQUEST_CSV_HEADERS.forEach((label, index) => {
    if (PDF_EXCLUDED_CSV_COLUMN_LABELS.has(label)) return;
    csvLabels.push(label);
    headers.push(PDF_HEADER_DISPLAY_LABELS[label] ?? label);
    baseWidths.push(PDF_COL_WIDTHS_BY_CSV_INDEX[index] ?? 12);
  });
  const colWidthsMm = scaleWidthsToTarget(baseWidths, csvLabels, CONTENT_WIDTH_MM);
  const tableWidthMm = colWidthsMm.reduce((a, b) => a + b, 0);
  return { headers, csvLabels, colWidthsMm, tableWidthMm };
}

function csvRowToPdfCells(fullRow: (string | number)[]): (string | number)[] {
  const cells: (string | number)[] = [];
  PRODUCTION_REQUEST_CSV_HEADERS.forEach((label, index) => {
    if (PDF_EXCLUDED_CSV_COLUMN_LABELS.has(label)) return;
    cells.push(fullRow[index] ?? '');
  });
  return cells;
}

const MM_TO_PX = 3.779527559;

type JsPDFInstance = {
  addPage: () => void;
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  output: (type: 'blob') => Blob;
  save: (filename: string) => void;
};

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidthPx: number): string {
  const raw = String(text ?? '');
  if (!raw) return '';
  if (ctx.measureText(raw).width <= maxWidthPx) return raw;
  let t = raw;
  while (t.length > 0 && ctx.measureText(`${t}…`).width > maxWidthPx) {
    t = t.slice(0, -1);
  }
  return t ? `${t}…` : '';
}

function wrapTextToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  maxLines: number
): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [''];

  const lines: string[] = [];
  let remaining = raw;
  while (remaining && lines.length < maxLines) {
    if (ctx.measureText(remaining).width <= maxWidthPx) {
      lines.push(remaining);
      break;
    }
    let low = 1;
    let high = remaining.length;
    let best = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const part = remaining.slice(0, mid);
      if (ctx.measureText(part).width <= maxWidthPx) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    let chunk = remaining.slice(0, best).trimEnd();
    if (!chunk && remaining.length > 0) chunk = remaining.slice(0, 1);
    lines.push(chunk);
    remaining = remaining.slice(best).trimStart();
  }
  if (remaining && lines.length > 0 && lines.length >= maxLines) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = truncateToWidth(ctx, last, maxWidthPx);
  }
  return lines.length ? lines : [''];
}

function tableRowToImage(
  cells: (string | number)[],
  colWidthsMm: readonly number[],
  options: {
    header?: boolean;
    fontSizePt: number;
    minRowHeightMm?: number;
    maxLinesPerCell?: number;
    columnLabels?: readonly string[];
    cellPadPx?: number;
  }
): { dataUrl: string; widthMm: number; heightMm: number } {
  const { header, fontSizePt } = options;
  const minRowHeightMm = options.minRowHeightMm ?? 6.5;
  const maxLinesPerCell = options.maxLinesPerCell ?? (header ? 2 : 3);
  const fontSizePx = fontSizePt * 1.333;
  const lineHeightPx = fontSizePx * 1.28;
  const cellPadPx = options.cellPadPx ?? 4;
  const scale = 3;
  const totalWidthMm = colWidthsMm.reduce((a, b) => a + b, 0);

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas를 사용할 수 없습니다.');
  const weight = header ? '700' : '600';
  measureCtx.font = `${weight} ${fontSizePx}px "Noto Sans KR", "Malgun Gothic", "맑은 고딕", sans-serif`;

  const cellLines = cells.map((cell, i) => {
    const colMm = colWidthsMm[i] ?? 12;
    const colPx = colMm * MM_TO_PX - cellPadPx * 2;
    return wrapTextToLines(measureCtx, String(cell ?? ''), Math.max(colPx, 8), maxLinesPerCell);
  });

  const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
  const contentHeightPx = maxLines * lineHeightPx + cellPadPx * 2;
  const rowHeightMm = Math.max(minRowHeightMm, contentHeightPx / MM_TO_PX);

  const widthPx = totalWidthMm * MM_TO_PX * scale;
  const heightPx = rowHeightMm * MM_TO_PX * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPx);
  canvas.height = Math.ceil(heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas를 사용할 수 없습니다.');

  ctx.scale(scale, scale);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 0.6;

  let xPx = 0;
  cells.forEach((_cell, i) => {
    const colMm = colWidthsMm[i] ?? 12;
    const colPx = colMm * MM_TO_PX;
    const columnLabel = options.columnLabels?.[i];
    ctx.fillStyle = pdfTableCellBackground(columnLabel, !!header);
    ctx.fillRect(xPx, 0, colPx, rowHeightMm * MM_TO_PX);
    xPx += colPx;
  });
  ctx.strokeRect(0, 0, totalWidthMm * MM_TO_PX, rowHeightMm * MM_TO_PX);

  ctx.font = `${weight} ${fontSizePx}px "Noto Sans KR", "Malgun Gothic", "맑은 고딕", sans-serif`;
  ctx.fillStyle = PDF_TABLE_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const rowHeightPx = rowHeightMm * MM_TO_PX;

  xPx = 0;
  cells.forEach((_cell, i) => {
    const colMm = colWidthsMm[i] ?? 12;
    const colPx = colMm * MM_TO_PX;
    const lines = cellLines[i] ?? [''];
    const blockHeight = lines.length * lineHeightPx;
    const firstLineCenterY = (rowHeightPx - blockHeight) / 2 + lineHeightPx / 2;
    lines.forEach((line, lineIndex) => {
      const y = firstLineCenterY + lineIndex * lineHeightPx;
      ctx.fillStyle = /^★+$/.test(line) ? '#d97706' : PDF_TABLE_TEXT;
      ctx.fillText(line, xPx + cellPadPx, y);
    });
    xPx += colPx;
    ctx.beginPath();
    ctx.moveTo(xPx, 0);
    ctx.lineTo(xPx, rowHeightMm * MM_TO_PX);
    ctx.stroke();
  });

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthMm: totalWidthMm,
    heightMm: rowHeightMm,
  };
}

function pdfReportTitleRowToImage(
  title: string,
  metaRight: string,
  widthMm: number
): { dataUrl: string; widthMm: number; heightMm: number } {
  const scale = 3;
  const paddingMm = 2;
  const rowHeightMm = 6.5;
  const heightMm = paddingMm * 2 + rowHeightMm;
  const widthPx = widthMm * MM_TO_PX * scale;
  const heightPx = heightMm * MM_TO_PX * scale;
  const contentWidthPx = widthMm * MM_TO_PX;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPx);
  canvas.height = Math.ceil(heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas를 사용할 수 없습니다.');

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, contentWidthPx, heightMm * MM_TO_PX);

  const centerYPx = (paddingMm + rowHeightMm / 2) * MM_TO_PX;
  const gapPx = 8;

  const titleFontPx = 14 * 1.333;
  ctx.font = `700 ${titleFontPx}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = PDF_TABLE_TEXT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, 0, centerYPx);
  const titleWidthPx = ctx.measureText(title).width;

  const metaFontPx = 9 * 1.333;
  ctx.font = `600 ${metaFontPx}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = PDF_META_TEXT;
  ctx.textAlign = 'right';
  let metaText = metaRight;
  const maxMetaWidthPx = Math.max(40, contentWidthPx - titleWidthPx - gapPx);
  if (ctx.measureText(metaText).width > maxMetaWidthPx) {
    metaText = truncateToWidth(ctx, metaText, maxMetaWidthPx);
  }
  ctx.fillText(metaText, contentWidthPx, centerYPx);

  return { dataUrl: canvas.toDataURL('image/png'), widthMm, heightMm };
}

function groupHeaderToImage(
  groupLabel: string,
  count: number,
  widthMm: number
): { dataUrl: string; widthMm: number; heightMm: number } {
  const scale = 3;
  const heightMm = 6.5;
  const widthPx = widthMm * MM_TO_PX * scale;
  const heightPx = heightMm * MM_TO_PX * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPx);
  canvas.height = Math.ceil(heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas를 사용할 수 없습니다.');

  ctx.scale(scale, scale);
  const wPx = widthMm * MM_TO_PX;
  const hPx = heightMm * MM_TO_PX;
  const accentPx = PDF_GROUP_HEADER_ACCENT_MM * MM_TO_PX;
  ctx.fillStyle = PDF_GROUP_HEADER_ACCENT;
  ctx.fillRect(0, 0, accentPx, hPx);
  ctx.fillStyle = PDF_GROUP_HEADER_BG;
  ctx.fillRect(accentPx, 0, wPx - accentPx, hPx);
  ctx.strokeStyle = PDF_GROUP_HEADER_BORDER;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0.25, 0.25, wPx - 0.5, hPx - 0.5);
  ctx.font = `700 ${8 * 1.333}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = PDF_TABLE_TEXT;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${groupLabel}  (${count}건)`, accentPx + 3, hPx / 2);

  return { dataUrl: canvas.toDataURL('image/png'), widthMm, heightMm };
}

async function loadJsPDF(): Promise<new (opts: {
  orientation: 'landscape';
  unit: 'mm';
  format: 'a4';
}) => JsPDFInstance> {
  const jspdfModule = (await import('jspdf/dist/jspdf.umd.min.js')) as unknown as Partial<{
    jsPDF: new (opts: { orientation: 'landscape'; unit: 'mm'; format: 'a4' }) => JsPDFInstance;
    default: new (opts: { orientation: 'landscape'; unit: 'mm'; format: 'a4' }) => JsPDFInstance;
  }>;
  const jsPDF = jspdfModule.jsPDF ?? jspdfModule.default;
  if (!jsPDF) throw new Error('jsPDF 로드 실패');
  return jsPDF;
}

function groupRowsByProductGroup(rows: ProductionRequestListRow[]): Map<string, ProductionRequestListRow[]> {
  const map = new Map<string, ProductionRequestListRow[]>();
  rows.forEach((row) => {
    const key = getProductionRequestLineProductGroup(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  });
  return map;
}

/**
 * 진행중 생산요청만 제품군별로 묶어, 엑셀과 동일한 항목·순서로 PDF 출력.
 */
export async function downloadProductionRequestListPdf(
  listRows: ProductionRequestListRow[],
  getStatusLabel: (listRow: ProductionRequestListRow) => string,
  fileNamePrefix = 'admin_production_requests'
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('PDF는 브라우저에서만 생성할 수 있습니다.');
  }

  const progressRows = prepareProductionRequestProgressPdfRows(listRows);
  if (progressRows.length === 0) {
    throw new Error('진행중인 생산요청이 없습니다.');
  }

  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageHeight = doc.internal.pageSize.getHeight();

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const grouped = groupRowsByProductGroup(progressRows);
  const groupCount = grouped.size;
  const { headers: pdfHeaders, csvLabels: pdfColumnLabels, colWidthsMm: pdfColWidthsMm, tableWidthMm } =
    buildPdfTableLayout();

  let y = PAGE_MARGIN_Y;
  const titleBlock = pdfReportTitleRowToImage(
    '생산 진행 현황 (제품군별)',
    `출력일시 ${new Date().toLocaleString('ko-KR')} · 제품군 ${groupCount}개 · 진행중 ${progressRows.length}건`,
    CONTENT_WIDTH_MM
  );
  doc.addImage(titleBlock.dataUrl, 'PNG', PAGE_MARGIN_X, y, titleBlock.widthMm, titleBlock.heightMm);
  y += titleBlock.heightMm + 3;

  const tableX = PAGE_MARGIN_X;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm <= pageHeight - PAGE_MARGIN_Y) return;
    doc.addPage();
    y = PAGE_MARGIN_Y;
  };

  const drawTableHeader = () => {
    const headerImg = tableRowToImage(pdfHeaders, pdfColWidthsMm, {
      header: true,
      fontSizePt: 6.75,
      minRowHeightMm: 7.5,
      maxLinesPerCell: 1,
      columnLabels: pdfColumnLabels,
    });
    ensureSpace(headerImg.heightMm);
    doc.addImage(headerImg.dataUrl, 'PNG', tableX, y, headerImg.widthMm, headerImg.heightMm);
    y += headerImg.heightMm;
  };

  let groupIndex = 0;
  for (const [groupLabel, rowsInGroup] of grouped) {
    groupIndex += 1;
    const groupHeader = groupHeaderToImage(groupLabel, rowsInGroup.length, tableWidthMm);
    ensureSpace(groupHeader.heightMm + 8);
    y += groupIndex > 1 ? 2 : 0;
    doc.addImage(groupHeader.dataUrl, 'PNG', tableX, y, groupHeader.widthMm, groupHeader.heightMm);
    y += groupHeader.heightMm;

    drawTableHeader();

    rowsInGroup.forEach((listRow, idx) => {
      const rowNumber = idx + 1;
      const statusLabel = getStatusLabel(listRow);
      const fullRow = buildProductionRequestListRowCsvValues(listRow, rowNumber, statusLabel);
      const cells = csvRowToPdfCells(fullRow);
      const rowImg = tableRowToImage(cells, pdfColWidthsMm, {
        header: false,
        fontSizePt: 6.75,
        minRowHeightMm: 7.5,
        maxLinesPerCell: 3,
        columnLabels: pdfColumnLabels,
      });
      if (y + rowImg.heightMm > pageHeight - PAGE_MARGIN_Y) {
        doc.addPage();
        y = PAGE_MARGIN_Y;
        const contHeader = groupHeaderToImage(`${groupLabel} (계속)`, rowsInGroup.length, tableWidthMm);
        doc.addImage(contHeader.dataUrl, 'PNG', tableX, y, contHeader.widthMm, contHeader.heightMm);
        y += contHeader.heightMm;
        drawTableHeader();
      }
      doc.addImage(rowImg.dataUrl, 'PNG', tableX, y, rowImg.widthMm, rowImg.heightMm);
      y += rowImg.heightMm;
    });
  }

  const fileName = `${fileNamePrefix}_in_progress_${timestamp}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  // Chrome·Edge 내장 PDF 뷰어: 왼쪽 썸네일 숨김 + 가로 맞춤
  const viewerUrl = `${blobUrl}#navpanes=0&view=FitH`;
  window.open(viewerUrl, '_blank', 'noopener,noreferrer');

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
}

const SUMMARY_PDF_COLUMNS = [
  '중요도',
  '요청일',
  '고객사명',
  '제품코드',
  '수주수량',
  '생산요청수량',
  '완료요청일',
  '생산계획수량',
  '완료예정일',
  '최근완료',
] as const;

const SUMMARY_PDF_HEADER_LABELS: Record<(typeof SUMMARY_PDF_COLUMNS)[number], string> = {
  중요도: '중요',
  요청일: '요청일',
  고객사명: '고객사',
  제품코드: '제품코드',
  수주수량: '수주',
  생산요청수량: '생산요청',
  완료요청일: '완료요청',
  생산계획수량: '생산계획',
  완료예정일: '완료예정',
  최근완료: '최근완료',
};

function summaryPdfHeaderCells(): string[] {
  return SUMMARY_PDF_COLUMNS.map((label) => SUMMARY_PDF_HEADER_LABELS[label]);
}

const SUMMARY_PDF_SPLIT_BASE_WIDTHS = [8, 11.5, 21, 17, 10, 11, 12, 11, 12, 25];
const SUMMARY_PDF_COLUMN_GAP_MM = 4;
const SUMMARY_PDF_FONT_PT = 5.5;
const SUMMARY_PDF_HEADER_FONT_PT = 5.75;
const SUMMARY_PDF_CELL_PAD_PX = 2;

/** 제품군별 요약 PDF — 좌·우 고정 배치 */
const SUMMARY_PDF_LEFT_PRODUCT_GROUPS = ['LOK FITTING', 'PIPE FITTING'] as const;
const SUMMARY_PDF_RIGHT_PRODUCT_GROUPS = ['LOK VALVE', 'UHP FITTING', 'UHP VALVE', 'OTHERS'] as const;

export type ProductionRequestSummaryPdfGroup = Extract<
  ProductionRequestListViewTab,
  'by_product_group' | 'by_machine'
>;

function summaryPdfQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '';
  return value.toLocaleString('ko-KR');
}

function summaryPdfPriorityStars(priority?: number): string {
  const level = clampProductionRequestPriority(priority);
  if (level <= 0) return '';
  return '★'.repeat(level);
}

function summaryPdfRowCells(listRow: ProductionRequestListRow): string[] {
  const request = listRow.request;
  const isOrder = listRow.productionReason === 'order';
  const requestedDate = listRow.requestedCompletionDate ?? request.requestedCompletionDate;
  const productCode =
    listRow.productCode?.trim() && listRow.productCode !== '-' ? listRow.productCode.trim() : '';
  const latestCompletion = getProductionRequestLatestStageCompletionDisplay(listRow).replace(
    /\u00a0/g,
    ' '
  );

  return [
    summaryPdfPriorityStars(listRow.priority),
    request.requestDate ? formatDateShort(request.requestDate) : '',
    formatProductionListCustomerNameDisplay(listRow.productionReason, listRow.customerName),
    productCode,
    isOrder ? summaryPdfQuantity(listRow.orderQuantity) : '',
    summaryPdfQuantity(listRow.requestQuantity),
    requestedDate ? formatDateShort(requestedDate) : '',
    summaryPdfQuantity(listRow.plannedQuantity),
    listRow.plannedCompletionDate ? formatDateShort(listRow.plannedCompletionDate) : '',
    latestCompletion === '-' ? '' : latestCompletion,
  ];
}

function openPdfBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const viewerUrl = `${blobUrl}#navpanes=0&view=FitH`;
  window.open(viewerUrl, '_blank', 'noopener,noreferrer');

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
}

type SummaryPdfSection = {
  label: string;
  rows: string[][];
};

function collectSummaryPdfSections(
  listRows: ProductionRequestListRow[],
  groupBy: ProductionRequestSummaryPdfGroup
): SummaryPdfSection[] {
  const sorted = sortProductionListRowsForViewTab(listRows, groupBy);
  const sections: SummaryPdfSection[] = [];
  for (const row of sorted) {
    const label = getProductionListRowGroupLabel(row, groupBy);
    const last = sections[sections.length - 1];
    if (last && last.label === label) {
      last.rows.push(summaryPdfRowCells(row));
      continue;
    }
    sections.push({
      label,
      rows: [summaryPdfRowCells(row)],
    });
  }
  return sections;
}

function summaryPdfSectionsInOrder(
  sections: SummaryPdfSection[],
  order: readonly string[]
): SummaryPdfSection[] {
  const byLabel = new Map(sections.map((section) => [section.label.toUpperCase(), section]));
  return order.flatMap((label) => {
    const found = byLabel.get(label);
    return found ? [found] : [];
  });
}

function splitProductGroupSummarySections(sections: SummaryPdfSection[]): {
  left: SummaryPdfSection[];
  right: SummaryPdfSection[];
} {
  const left = summaryPdfSectionsInOrder(sections, SUMMARY_PDF_LEFT_PRODUCT_GROUPS);
  const right = summaryPdfSectionsInOrder(sections, SUMMARY_PDF_RIGHT_PRODUCT_GROUPS);
  const known = new Set<string>([
    ...SUMMARY_PDF_LEFT_PRODUCT_GROUPS,
    ...SUMMARY_PDF_RIGHT_PRODUCT_GROUPS,
  ]);
  const extras = sections.filter((section) => !known.has(section.label.toUpperCase()));
  return { left, right: [...right, ...extras] };
}

type SummaryPdfColumnCursor = {
  sections: SummaryPdfSection[];
  sectionIndex: number;
  rowIndex: number;
  headerDrawn: boolean;
  y: number;
  x: number;
};

function splitMachineSummarySections(sections: SummaryPdfSection[]): {
  left: SummaryPdfSection[];
  right: SummaryPdfSection[];
} {
  if (sections.length <= 1) {
    return { left: sections, right: [] };
  }
  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const half = totalRows / 2;
  let leftRows = 0;
  let splitAt = 1;
  for (let i = 0; i < sections.length - 1; i++) {
    const section = sections[i];
    if (!section) break;
    const next = leftRows + section.rows.length;
    const overshoot = next - half;
    const undershoot = half - leftRows;
    if (leftRows > 0 && overshoot > 0 && overshoot > undershoot) break;
    leftRows = next;
    splitAt = i + 1;
    if (leftRows >= half) break;
  }
  return {
    left: sections.slice(0, splitAt),
    right: sections.slice(splitAt),
  };
}

function summaryPdfColumnWidths(targetMm: number): number[] {
  const sum = SUMMARY_PDF_SPLIT_BASE_WIDTHS.reduce((total, width) => total + width, 0);
  const scaled = SUMMARY_PDF_SPLIT_BASE_WIDTHS.map(
    (width) => Math.floor((width / sum) * targetMm * 100) / 100
  );
  const drift = Math.round((targetMm - scaled.reduce((total, width) => total + width, 0)) * 100) / 100;
  const last = scaled.length - 1;
  scaled[last] = Math.round((scaled[last] + drift) * 100) / 100;
  return scaled;
}

function drawSummaryPdfProductGroupColumns(
  doc: JsPDFInstance,
  pageHeight: number,
  startY: number,
  left: SummaryPdfSection[],
  right: SummaryPdfSection[]
) {
  const columnWidth = (CONTENT_WIDTH_MM - SUMMARY_PDF_COLUMN_GAP_MM) / 2;
  const colWidthsMm = summaryPdfColumnWidths(columnWidth);
  const tableWidthMm = colWidthsMm.reduce((sum, width) => sum + width, 0);
  const tableHeader = tableRowToImage(summaryPdfHeaderCells(), colWidthsMm, {
    header: true,
    fontSizePt: SUMMARY_PDF_HEADER_FONT_PT,
    minRowHeightMm: 5.2,
    maxLinesPerCell: 1,
    cellPadPx: SUMMARY_PDF_CELL_PAD_PX,
    columnLabels: SUMMARY_PDF_COLUMNS,
  });
  const bottom = pageHeight - PAGE_MARGIN_Y;
  const leftCursor: SummaryPdfColumnCursor = {
    sections: left,
    sectionIndex: 0,
    rowIndex: 0,
    headerDrawn: false,
    y: startY,
    x: PAGE_MARGIN_X,
  };
  const rightCursor: SummaryPdfColumnCursor = {
    sections: right,
    sectionIndex: 0,
    rowIndex: 0,
    headerDrawn: false,
    y: startY,
    x: PAGE_MARGIN_X + tableWidthMm + SUMMARY_PDF_COLUMN_GAP_MM,
  };

  const tryAdvance = (cursor: SummaryPdfColumnCursor): boolean => {
    if (cursor.sectionIndex >= cursor.sections.length) return false;
    const section = cursor.sections[cursor.sectionIndex];
    if (!section) return false;

    if (!cursor.headerDrawn) {
      const continued = cursor.rowIndex > 0;
      const groupHeader = groupHeaderToImage(
        continued ? `${section.label} (계속)` : section.label,
        section.rows.length,
        tableWidthMm
      );
      const gap =
        !continued && cursor.sectionIndex > 0 && cursor.y > PAGE_MARGIN_Y + 0.5 ? 2 : 0;
      const firstRow = section.rows[cursor.rowIndex];
      const firstRowImg = firstRow
        ? tableRowToImage(firstRow, colWidthsMm, {
            header: false,
            fontSizePt: SUMMARY_PDF_FONT_PT,
            minRowHeightMm: 4.8,
            maxLinesPerCell: 1,
            cellPadPx: SUMMARY_PDF_CELL_PAD_PX,
            columnLabels: SUMMARY_PDF_COLUMNS,
          })
        : null;
      const needed =
        gap + groupHeader.heightMm + tableHeader.heightMm + (firstRowImg?.heightMm ?? 0);
      if (cursor.y + needed > bottom && cursor.y > PAGE_MARGIN_Y + 0.5) return false;

      let y = cursor.y + gap;
      doc.addImage(groupHeader.dataUrl, 'PNG', cursor.x, y, groupHeader.widthMm, groupHeader.heightMm);
      y += groupHeader.heightMm;
      doc.addImage(tableHeader.dataUrl, 'PNG', cursor.x, y, tableHeader.widthMm, tableHeader.heightMm);
      y += tableHeader.heightMm;
      if (firstRowImg) {
        doc.addImage(firstRowImg.dataUrl, 'PNG', cursor.x, y, firstRowImg.widthMm, firstRowImg.heightMm);
        y += firstRowImg.heightMm;
        cursor.rowIndex += 1;
      }
      cursor.y = y;
      cursor.headerDrawn = true;
      if (cursor.rowIndex >= section.rows.length) {
        cursor.sectionIndex += 1;
        cursor.rowIndex = 0;
        cursor.headerDrawn = false;
      }
      return true;
    }

    const cells = section.rows[cursor.rowIndex];
    if (!cells) return false;
    const rowImg = tableRowToImage(cells, colWidthsMm, {
      header: false,
      fontSizePt: SUMMARY_PDF_FONT_PT,
      minRowHeightMm: 4.8,
      maxLinesPerCell: 1,
      cellPadPx: SUMMARY_PDF_CELL_PAD_PX,
      columnLabels: SUMMARY_PDF_COLUMNS,
    });
    if (cursor.y + rowImg.heightMm > bottom) return false;
    doc.addImage(rowImg.dataUrl, 'PNG', cursor.x, cursor.y, rowImg.widthMm, rowImg.heightMm);
    cursor.y += rowImg.heightMm;
    cursor.rowIndex += 1;
    if (cursor.rowIndex >= section.rows.length) {
      cursor.sectionIndex += 1;
      cursor.rowIndex = 0;
      cursor.headerDrawn = false;
    }
    return true;
  };

  let guard = 0;
  while (
    leftCursor.sectionIndex < left.length ||
    rightCursor.sectionIndex < right.length
  ) {
    const leftMoved = tryAdvance(leftCursor);
    const rightMoved = tryAdvance(rightCursor);
    if (leftMoved || rightMoved) {
      guard = 0;
      continue;
    }
    const atTop =
      leftCursor.y <= PAGE_MARGIN_Y + 0.5 && rightCursor.y <= PAGE_MARGIN_Y + 0.5;
    if (atTop || guard > 4) break;
    doc.addPage();
    leftCursor.y = PAGE_MARGIN_Y;
    rightCursor.y = PAGE_MARGIN_Y;
    leftCursor.headerDrawn = false;
    rightCursor.headerDrawn = false;
    guard += 1;
  }
}

/**
 * 관리자 현황 요약 PDF — 제품군별·기계별 묶음, 지정 열만 출력.
 * 두 경우 모두 한 페이지를 좌·우로 나눠 배치한다.
 */
export async function downloadProductionRequestSummaryPdf(
  listRows: ProductionRequestListRow[],
  groupBy: ProductionRequestSummaryPdfGroup
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('PDF는 브라우저에서만 생성할 수 있습니다.');
  }
  if (listRows.length === 0) {
    throw new Error('표시할 생산요청이 없습니다.');
  }

  const sections = collectSummaryPdfSections(listRows, groupBy);
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageHeight = doc.internal.pageSize.getHeight();
  const title =
    groupBy === 'by_product_group' ? '생산요청 현황 (제품군별)' : '생산요청 현황 (기계별)';
  const fileToken = groupBy === 'by_product_group' ? 'product_group' : 'machine';
  const { left, right } =
    groupBy === 'by_product_group'
      ? splitProductGroupSummarySections(sections)
      : splitMachineSummarySections(sections);

  let y = PAGE_MARGIN_Y;
  const titleBlock = pdfReportTitleRowToImage(
    title,
    `출력일시 ${new Date().toLocaleString('ko-KR')} · ${sections.length}개 묶음 · ${listRows.length}건`,
    CONTENT_WIDTH_MM
  );
  doc.addImage(titleBlock.dataUrl, 'PNG', PAGE_MARGIN_X, y, titleBlock.widthMm, titleBlock.heightMm);
  y += titleBlock.heightMm + 3;

  drawSummaryPdfProductGroupColumns(doc, pageHeight, y, left, right);

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  openPdfBlob(doc.output('blob'), `admin_production_summary_${fileToken}_${timestamp}.pdf`);
}
