'use client';

import React from 'react';
import { clampProductionRequestPriority } from '@/lib/production/productionRequestPriority';

export function ProductionRequestPriorityStars({
  value,
  className = '',
  size = 'sm',
}: {
  value?: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const level = clampProductionRequestPriority(value);
  if (level === 0) return null;

  const starClass = size === 'md' ? 'text-base leading-none' : 'text-xs leading-none';

  return (
    <span
      className={`inline-flex items-center gap-px text-amber-500 ${className}`}
      title={`중요도 ${level}`}
      aria-label={`중요도 ${level}`}
    >
      {Array.from({ length: level }, (_, i) => (
        <span key={i} className={starClass} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}