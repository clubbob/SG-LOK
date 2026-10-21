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
