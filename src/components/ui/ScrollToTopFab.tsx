'use client';

import { useCallback, useEffect, useState } from 'react';

const DEFAULT_THRESHOLD = 280;

type Props = {
  /** 이 값(px) 이상 스크롤 시 버튼 표시 */
  threshold?: number;
};

export function ScrollToTopFab({ threshold = DEFAULT_THRESHOLD }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > threshold);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  const goTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={goTop}
      className="fixed bottom-5 right-5 z-40 flex h-11 min-w-[2.75rem] items-center justify-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 shadow-md transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:bottom-8 sm:right-8"
      aria-label="맨 위로"
      title="맨 위로"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 15l-6-6-6 6" />
      </svg>
      <span className="hidden sm:inline">맨 위</span>
    </button>
  );
}
