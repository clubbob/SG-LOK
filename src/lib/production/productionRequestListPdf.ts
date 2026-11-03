import {
  PRODUCTION_REQUEST_CSV_HEADERS,
  buildProductionRequestListRowCsvValues,
  getProductionRequestLineProductGroup,
  prepareProductionRequestProgressPdfRows,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';

const PAGE_MARGIN_X = 8;
const PAGE_MARGIN_Y = 10;
const LANDSCAPE_PAGE_WIDTH_MM = 297;
const CONTENT_WIDTH_MM = LANDSCAPE_PAGE_WIDTH_MM - PAGE_MARGIN_X * 2;

/** CSV 열 인덱스별 PDF 열 너비(mm) — PDF에서 제외하는 열은 사용하지 않음 */
const PDF_COL_WIDTHS_BY_CSV_INDEX = [
  5, 10, 12, 10, 10, 13, 14, 16, 12, 10, 12, 12, 14, 12, 12, 14, 14, 14, 14, 10,
] as const;

/** PDF 테이블에서 제외 (엑셀·화면은 그대로) */
const PDF_EXCLUDED_CSV_COLUMN_LABELS = new Set([
  '지역',
  '제품군',
  '제품명',
  '완료요청일',
  '비고',
  '생산완료일 (수량)',
  '상태',
]);

/** PDF 표 오른쪽 — 1·2·3차 완료(첨부) 열만 별도 배경 */
const PDF_ATTACH_SECTION_COLUMN_LABELS = new Set([
  '1차 완료일 (수량)',
  '2차 완료일 (수량)',
  '3차 완료일 (수량)',
]);

const PDF_TABLE_HEADER_BG_MAIN = '#e2e8f0';
const PDF_TABLE_DATA_BG_MAIN = '#ffffff';

/** 생산계획수량 · 완료예정일 (동일 배경) */
const PDF_TABLE_HEADER_BG_PLAN = '#dbeafe';
const PDF_TABLE_DATA_BG_PLAN = '#eff6ff';

/** 1·2·3차 완료(첨부) 열 */
const PDF_TABLE_HEADER_BG_ATTACH = '#d1fae5';
const PDF_TABLE_DATA_BG_ATTACH = '#ecfdf5';

/** PDF 헤더 — 필요 시 짧은 표기 (미설정 시 CSV 라벨 그대로) */
const PDF_HEADER_DISPLAY_LABELS: Record<string, string> = {};

function pdfTableCellBackground(columnLabel: string | undefined, header: boolean): string {
  if (columnLabel == null) {
    return header ? PDF_TABLE_HEADER_BG_MAIN : PDF_TABLE_DATA_BG_MAIN;
  }
  if (PDF_ATTACH_SECTION_COLUMN_LABELS.has(columnLabel)) {
    return header ? PDF_TABLE_HEADER_BG_ATTACH : PDF_TABLE_DATA_BG_ATTACH;
  }
  if (columnLabel === '생산계획수량' || columnLabel === '완료예정일') {
    return header ? PDF_TABLE_HEADER_BG_PLAN : PDF_TABLE_DATA_BG_PLAN;
  }
  return header ? PDF_TABLE_HEADER_BG_MAIN : PDF_TABLE_DATA_BG_MAIN;
}

/** 가독성을 위해 넓게 배분할 열 */
const PDF_COLUMN_WIDTH_WEIGHT: Record<string, number> = {
  번호: 0.65,
  고객사명: 1.15,
  제품코드: 1.25,
  요청자: 0.9,
  생산목적: 1.05,
  생산요청수량: 1.05,
  생산계획수량: 1.05,
};

const PDF_MIN_COLUMN_WIDTH_MM: Record<string, number> = {
  /** 헤더 「번호」가 한 줄에 들어가도록 */
  번호: 8,
  /** 헤더 「요청자」 한 줄 */
  요청자: 9,
};

function scaleWidthsToTarget(baseWidths: number[], csvLabels: string[], targetTotalMm: number): number[] {
  const weighted = baseWidths.map((w, i) => {
    const weight = PDF_COLUMN_WIDTH_WEIGHT[csvLabels[i] ?? ''] ?? 1;
    return w * weight;
  });
  const sum = weighted.reduce((a, b) => a + b, 0);
  if (sum <= 0) return baseWidths;
  const scaled = weighted.map((w) => (w / sum) * targetTotalMm);
  return enforceMinColumnWidths(scaled, csvLabels, targetTotalMm);
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
  }
): { dataUrl: string; widthMm: number; heightMm: number } {
  const { header, fontSizePt } = options;
  const minRowHeightMm = options.minRowHeightMm ?? 6.5;
  const maxLinesPerCell = options.maxLinesPerCell ?? (header ? 2 : 3);
  const fontSizePx = fontSizePt * 1.333;
  const lineHeightPx = fontSizePx * 1.25;
  const cellPadPx = 3;
  const scale = 2;
  const totalWidthMm = colWidthsMm.reduce((a, b) => a + b, 0);

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas를 사용할 수 없습니다.');
  const weight = header ? '600' : '400';
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
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.5;

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
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  xPx = 0;
  cells.forEach((_cell, i) => {
    const colMm = colWidthsMm[i] ?? 12;
    const colPx = colMm * MM_TO_PX;
    const lines = cellLines[i] ?? [''];
    const blockHeight = lines.length * lineHeightPx;
    let yPx = (rowHeightMm * MM_TO_PX - blockHeight) / 2;
    if (yPx < cellPadPx) yPx = cellPadPx;
    lines.forEach((line) => {
      ctx.fillText(line, xPx + cellPadPx, yPx);
      yPx += lineHeightPx;
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
  const scale = 2;
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
  ctx.font = `600 ${titleFontPx}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, 0, centerYPx);
  const titleWidthPx = ctx.measureText(title).width;

  const metaFontPx = 9 * 1.333;
  ctx.font = `400 ${metaFontPx}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = '#4b5563';
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
  const scale = 2;
  const heightMm = 6.5;
  const widthPx = widthMm * MM_TO_PX * scale;
  const heightPx = heightMm * MM_TO_PX * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPx);
  canvas.height = Math.ceil(heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas를 사용할 수 없습니다.');

  ctx.scale(scale, scale);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, widthMm * MM_TO_PX, heightMm * MM_TO_PX);
  ctx.font = `600 ${7.5 * 1.333}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${groupLabel}  (${count}건)`, 4, (heightMm * MM_TO_PX) / 2);

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
      fontSizePt: 6.5,
      minRowHeightMm: 8,
      maxLinesPerCell: 2,
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
        fontSizePt: 6,
        minRowHeightMm: 7,
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
