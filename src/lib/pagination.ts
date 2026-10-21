/** 페이지 번호 버튼에 한 번에 표시할 최대 개수 */
export const PAGINATION_PAGE_BUTTON_COUNT = 10;

/**
 * 현재 페이지를 중심으로 최대 windowSize개의 페이지 번호를 반환한다.
 * (총 페이지가 windowSize 이하면 1..totalPages 전부)
 */
export function getPaginationPageNumbers(
  currentPage: number,
  totalPages: number,
  windowSize: number = PAGINATION_PAGE_BUTTON_COUNT
): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= windowSize) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const safeCurrent = Math.min(Math.max(1, currentPage), totalPages);
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, safeCurrent - half);
  let end = start + windowSize - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - windowSize + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
