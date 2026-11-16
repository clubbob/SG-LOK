'use client';

import React from 'react';
import {
  PRODUCTION_REQUEST_PRIORITY_MAX,
  clampProductionRequestPriority,
} from '@/lib/production/productionRequestPriority';

export function ProductionRequestPrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (level: number) => void;
  disabled?: boolean;
}) {
  const current = clampProductionRequestPriority(value);

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-2">중요도</label>
      <div
        className="flex h-[38px] items-center gap-1"
        role="group"
        aria-label="중요도 선택"
      >
        {Array.from({ length: PRODUCTION_REQUEST_PRIORITY_MAX }, (_, i) => {
          const level = i + 1;
          const filled = level <= current;
          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              onClick={() => onChange(current === level ? 0 : level)}
              className={`rounded px-0.5 text-2xl leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:opacity-50 ${
                filled ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-400'
              }`}
              aria-label={`중요도 ${level}${filled ? ' 선택됨' : ''}`}
              aria-pressed={filled}
            >
              ★
            </button>
          );
        })}
      </div>
    </div>
  );
}