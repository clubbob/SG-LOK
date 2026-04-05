'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';

type Props = {
  id: string;
  children: (dragHandle: ReactNode) => ReactNode;
};

export function SortableInventoryProductRow({ id, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  /* button 대신 span: 포인터/드래그 후 클릭이 기본 제출·포커스와 섞이며 [object Event] 런타임이 나는 경우 방지 */
  const dragHandle = (
    <span
      className="touch-none inline-flex shrink-0 cursor-grab rounded-md border border-gray-200 bg-gray-50 p-1.5 text-gray-500 shadow-sm hover:bg-gray-100 active:cursor-grabbing"
      aria-label="드래그하여 순서 변경"
      title="드래그하여 순서 변경"
      {...attributes}
      {...listeners}
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
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
      className={
        isDragging
          ? 'relative z-10 rounded-lg ring-2 ring-blue-400 ring-offset-2'
          : ''
      }
    >
      {children(dragHandle)}
    </div>
  );
}
