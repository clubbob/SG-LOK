'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  AdminUhpInventoryProductCard,
  type AdminUhpProductCardHandlers,
  type AdminUhpProductListRow,
} from '@/components/admin/inventory/AdminUhpInventoryProductCard';
import { SortableInventoryProductRow } from '@/components/admin/inventory/SortableInventoryProductRow';

type Props = {
  items: AdminUhpProductListRow[];
  sortableIds: string[];
  productCardHandlers: AdminUhpProductCardHandlers;
  onReorder: (oldIndex: number, newIndex: number) => void;
};

export function InventoryProductDndList({
  items,
  sortableIds,
  productCardHandlers,
  onReorder,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    try {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = items.findIndex((r) => r.listKey === activeId);
      const newIndex = items.findIndex((r) => r.listKey === overId);
      if (oldIndex < 0 || newIndex < 0) return;
      // dnd-kit 내부 정리가 끝난 뒤 부모 setState (React 19 / Next에서 Event가 에러로 뜨는 경우 방지)
      requestAnimationFrame(() => {
        try {
          onReorder(oldIndex, newIndex);
        } catch (e) {
          console.error('[InventoryProductDndList] onReorder:', e);
        }
      });
    } catch (e) {
      console.error('[InventoryProductDndList] onDragEnd:', e);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {items.map((product) => (
          <SortableInventoryProductRow key={product.listKey} id={product.listKey}>
            {(dragHandle) => (
              <AdminUhpInventoryProductCard
                product={product}
                dragHandle={dragHandle}
                {...productCardHandlers}
              />
            )}
          </SortableInventoryProductRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}
