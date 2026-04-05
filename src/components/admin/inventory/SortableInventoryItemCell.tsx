'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';

type Props = {
  id: string;
  children: (dragHandle: ReactNode) => ReactNode;
};

export function SortableInventoryItemCell({ id, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const dragHandle = (
    <span
      className="touch-none mt-0.5 inline-flex shrink-0 cursor-grab rounded-md border border-amber-300 bg-amber-100/80 p-1 text-amber-800 shadow-sm hover:bg-amber-100 active:cursor-grabbing"
      aria-label="드래그하여 품목 순서 변경"
      title="드래그하여 품목 순서 변경"
      {...attributes}
      {...listeners}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'relative z-10 rounded-md ring-2 ring-amber-400 ring-offset-1' : ''}
    >
      {children(dragHandle)}
    </div>
  );
}
