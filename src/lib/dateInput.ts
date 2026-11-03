/** 날짜 입력: 필드 전체 클릭 시 네이티브 달력 열기 (Chrome·Edge 등) */
export const DATE_INPUT_PICKER_CLASS =
  'relative cursor-pointer [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:z-[2] [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

export function tryOpenDatePicker(el: HTMLInputElement): void {
  if (el.disabled || el.readOnly) return;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
    } catch {
      // 사용자 제스처 없음·브라우저 거부 등
    }
  }
}

export function mergeDatePickerOpenHandlers(
  el: HTMLInputElement,
  prevented: boolean
): void {
  if (!prevented) {
    tryOpenDatePicker(el);
  }
}

/** `<input type="date">` 값 — 로컬 날짜 기준 YYYY-MM-DD */
export function toLocalDateInputValue(date: Date = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 완료일 등 — 오늘 이후 선택 불가용 max */
export function todayLocalDateInputMax(): string {
  return toLocalDateInputValue(new Date());
}

/** YYYY-MM-DD 문자열이 오늘(로컬)보다 이후인지 */
export function isDateInputAfterToday(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed > todayLocalDateInputMax();
}
