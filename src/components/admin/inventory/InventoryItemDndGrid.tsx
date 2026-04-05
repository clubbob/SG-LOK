'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { InventoryItem } from '@/lib/inventory/types';
import type { ReactNode } from 'react';
import { SortableInventoryItemCell } from '@/components/admin/inventory/SortableInventoryItemCell';

type Props = {
  items: InventoryItem[];
  sortableIds: string[];
  onReorder: (oldIndex: number, newIndex: number) => void;
  renderItem: (item: InventoryItem, dragHandle: ReactNode) => ReactNode;
};

/**
 * 품목 드래그는 핸들에만 listeners가 있음. delay는 카드 안 버튼(품목 삭제 등)의 click을 삼켜서
 * distance 제약만 사용함(제품 줄 DnD와 동일한 패턴).
 */
export function InventoryItemDndGrid({ items, sortableIds, onReorder, renderItem }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    try {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = sortableIds.indexOf(activeId);
      const newIndex = sortableIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      requestAnimationFrame(() => {
        try {
          onReorder(oldIndex, newIndex);
        } catch (e) {
          console.error('[InventoryItemDndGrid] onReorder:', e);
        }
      });
    } catch (e) {
      console.error('[InventoryItemDndGrid] onDragEnd:', e);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item, i) => {
            const sid = sortableIds[i];
            if (!sid) return null;
            return (
              <SortableInventoryItemCell key={sid} id={sid}>
                {(handle) => renderItem(item, handle)}
              </SortableInventoryItemCell>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
