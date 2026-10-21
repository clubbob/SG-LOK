'use client';

import { cn } from '@/lib/utils';

type FormPageAlertProps = {
  success?: string;
  error?: string;
};

/** 긴 폼 하단에서 제출 후에도 보이도록 뷰포트에 고정 */
export function FormPageAlert({ success, error }: FormPageAlertProps) {
  const message = error || success;
  const isError = Boolean(error);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-lg border-2 px-5 py-4 shadow-lg sm:bottom-8',
        isError
          ? 'border-red-400 bg-red-50 text-red-800'
          : 'border-green-400 bg-green-50 text-green-800'
      )}
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <svg
            className="mt-0.5 h-6 w-6 shrink-0 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ) : (
          <svg
            className="mt-0.5 h-6 w-6 shrink-0 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <p className="font-semibold text-sm sm:text-base">{message}</p>
      </div>
    </div>
  );
}
