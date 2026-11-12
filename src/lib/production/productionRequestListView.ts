import type { ProductionProductGroup } from '@/types';
import {
  PRODUCTION_PRODUCT_GROUP_OPTIONS,
} from '@/lib/products/requestProductLines';
import {
  getProductionRequestLineProductGroup,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';

export type ProductionRequestListViewTab = 'by_request' | 'by_product_group' | 'by_machine';

export const PRODUCTION_REQUEST_LIST_VIEW_TABS: {
  id: ProductionRequestListViewTab;
  label: string;
}[] = [
  { id: 'by_request', label: '생산요청별' },
  { id: 'by_product_group', label: '제품군별' },
  { id: 'by_machine', label: '기계별' },
];

const MACHINE_UNASSIGNED_KEY = 'machine:__unassigned__';

/** 그룹 내 정렬 (오래된 → 최신) — reverse 후 최신이 위 */
function compareListRowsWithinGroup(a: ProductionRequestListRow, b: ProductionRequestListRow): number {
  const createdA = a.request.createdAt?.getTime?.() ?? 0;
  const createdB = b.request.createdAt?.getTime?.() ?? 0;
  if (createdA !== createdB) return createdA - createdB;
  if (a.request.id !== b.request.id) return a.request.id.localeCompare(b.request.id);
  return a.productIndex - b.productIndex;
}

/** 제품군·기계별 묶음: 그룹 안에서는 최신이 위 */
function compareListRowsWithinGroupNewestFirst(
  a: ProductionRequestListRow,
  b: ProductionRequestListRow
): number {
  return -compareListRowsWithinGroup(a, b);
}

function usesAscendingGroupDisplayOrder(tab: ProductionRequestListViewTab): boolean {
  return tab === 'by_machine' || tab === 'by_product_group';
}

function productGroupSortRank(listRow: ProductionRequestListRow): number {
  const raw = listRow.request.products?.[listRow.productIndex]?.productGroup?.trim() || '';
  const optionIndex = PRODUCTION_PRODUCT_GROUP_OPTIONS.indexOf(raw as ProductionProductGroup);
  if (optionIndex >= 0) return optionIndex;
  const label = getProductionRequestLineProductGroup(listRow);
  if (label === '미지정') return PRODUCTION_PRODUCT_GROUP_OPTIONS.length + 1_000;
  return PRODUCTION_PRODUCT_GROUP_OPTIONS.length + 100;
}

function compareMachineGroupKeys(keyA: string, keyB: string): number {
  if (keyA === MACHINE_UNASSIGNED_KEY && keyB !== MACHINE_UNASSIGNED_KEY) return 1;
  if (keyB === MACHINE_UNASSIGNED_KEY && keyA !== MACHINE_UNASSIGNED_KEY) return -1;
  const a = keyA.replace(/^machine:/, '');
  const b = keyB.replace(/^machine:/, '');
  const numA = /^\d+$/.test(a) ? Number(a) : NaN;
  const numB = /^\d+$/.test(b) ? Number(b) : NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return a.localeCompare(b, 'ko', { numeric: true });
}

export function getProductionListRowGroupKey(
  listRow: ProductionRequestListRow,
  tab: ProductionRequestListViewTab
): string {
  if (tab === 'by_product_group') {
    return `group:${getProductionRequestLineProductGroup(listRow)}`;
  }
  if (tab === 'by_machine') {
    const machine = listRow.machineNo?.trim();
    return machine ? `machine:${machine}` : MACHINE_UNASSIGNED_KEY;
  }
  return '';
}

export function getProductionListRowGroupLabel(
  listRow: ProductionRequestListRow,
  tab: ProductionRequestListViewTab
): string {
  if (tab === 'by_product_group') {
    return getProductionRequestLineProductGroup(listRow);
  }
  if (tab === 'by_machine') {
    return listRow.machineNo?.trim() || '기계 미배정';
  }
  return '';
}

export function sortProductionListRowsForViewTab(
  rows: ProductionRequestListRow[],
  tab: ProductionRequestListViewTab
): ProductionRequestListRow[] {
  if (tab === 'by_request') return rows;
  const copy = [...rows];
  if (tab === 'by_product_group') {
    copy.sort((a, b) => {
      const rankA = productGroupSortRank(a);
      const rankB = productGroupSortRank(b);
      if (rankA !== rankB) return rankA - rankB;
      const labelCmp = getProductionRequestLineProductGroup(a).localeCompare(
        getProductionRequestLineProductGroup(b),
        'ko'
      );
      if (labelCmp !== 0) return labelCmp;
      return compareListRowsWithinGroupNewestFirst(a, b);
    });
    return copy;
  }
  copy.sort((a, b) => {
    const keyA = getProductionListRowGroupKey(a, tab);
    const keyB = getProductionListRowGroupKey(b, tab);
    const keyCmp = compareMachineGroupKeys(keyA, keyB);
    if (keyCmp !== 0) return keyCmp;
    return compareListRowsWithinGroupNewestFirst(a, b);
  });
  return copy;
}

/** 현재 페이지 행 (제품군·기계별: 묶음 오름차순 유지, 생산요청별: reverse로 최신이 위) */
export function sliceListRowsForPageDisplay(
  listRows: ProductionRequestListRow[],
  currentPage: number,
  itemsPerPage: number,
  tab: ProductionRequestListViewTab
): ProductionRequestListRow[] {
  const startIndex = (currentPage - 1) * itemsPerPage;
  const sliced = listRows.slice(startIndex, startIndex + itemsPerPage);
  if (usesAscendingGroupDisplayOrder(tab)) return sliced;
  return [...sliced].reverse();
}

export function defaultListPageForViewTab(tab: ProductionRequestListViewTab, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return usesAscendingGroupDisplayOrder(tab) ? 1 : totalPages;
}

export function listRowNumberForPageDisplay(
  idx: number,
  currentPage: number,
  itemsPerPage: number,
  displayedLength: number,
  tab: ProductionRequestListViewTab
): number {
  const base = (currentPage - 1) * itemsPerPage;
  if (usesAscendingGroupDisplayOrder(tab)) return base + idx + 1;
  return base + (displayedLength - 1 - idx) + 1;
}

export function excludeCompletedProductionListRows(
  rows: ProductionRequestListRow[]
): ProductionRequestListRow[] {
  return rows.filter((row) => row.lineStatus !== 'completed');
}

export function countProductionListRowGroups(
  rows: ProductionRequestListRow[],
  tab: ProductionRequestListViewTab
): Map<string, number> {
  const map = new Map<string, number>();
  if (tab === 'by_request') return map;
  for (const row of rows) {
    const key = getProductionListRowGroupKey(row, tab);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
