"use client";

import { useCallback, useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  ensureSeedProductLinesInCategory,
  INITIAL_METAL_FACE_SEAL_PRODUCTS,
  INITIAL_MICRO_WELD_PRODUCTS,
  INITIAL_TUBE_BUTT_WELD_PRODUCTS,
  INVENTORY_SEED_VERSION,
  mergeLegacyLongElbowIntoTubeButtWeld,
  mergeMissingHmcItemsFromSeed,
  mergeMissingHmtbItemsFromSeed,
  mergeMissingHmrtItemsFromSeed,
  stripHle02ItemFromLongElbowLine,
} from '@/lib/inventory/microWeldSeed';
import Link from 'next/link';
import { buildCombinedHistoryRows, combinedHistoryRowMemo } from '@/lib/inventory/historyRows';
import {
  findProductInUhpSlices,
  findUhpCategoryByProductName,
  UHP_CATEGORY_TABS,
  UHP_STATE_KEYS,
  type UhpCategoryId,
} from '@/lib/inventory/uhpInventoryHelpers';
import { createEmptyInventoryItem } from '@/lib/inventory/itemFactory';
import { filterProductsBySearchQuery, pickCategoryIdForSearch } from '@/lib/inventory/searchFilter';
import { dropRemovedDefaultCategoryProducts, persistUhpInventoryState } from '@/lib/inventory/persistUhp';
import type {
  AdjustmentHistory,
  InboundHistory,
  InventoryItem,
  InventoryProduct,
  OutboundHistory,
  ProductionPlanHistory,
  UhpInventoryState,
} from '@/lib/inventory/types';
import {
  deleteField,
  doc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  Timestamp,
  type DocumentSnapshot,
} from 'firebase/firestore';

type InboundModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  mode: 'create' | 'edit';
  historyId: string | null;
  quantityInput: string;
};

type OutboundModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  mode: 'create' | 'edit';
  historyId: string | null;
  quantityInput: string;
};

type HistoryModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  page: number;
};

type HistoryViewModalState = HistoryModalState;

type AdjustmentModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  actualStockInput: string;
  reasonInput: string;
};

type ProductionPlanModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  mode: 'create' | 'edit';
  historyId: string | null;
  plannedQuantityInput: string;
  dueDateInput: string;
  noteInput: string;
};

type StructureItemModalState = {
  productName: string;
  codeInput: string;
};

const LEGACY_HMGS_LINE_NAME = 'HMGS Micro Gland S';
const HMGS_LINE_NAME = 'Micro Gland S (HMGS)';
const HMGS_LINE_NAME_KEYS = new Set([
  LEGACY_HMGS_LINE_NAME.trim().toLowerCase(),
  HMGS_LINE_NAME.trim().toLowerCase(),
]);

const normalizeLineNameKey = (name: string): string => name.trim().toLowerCase();

function dedupeProductLinesByName(lines: InventoryProduct[]): {
  next: InventoryProduct[];
  changed: boolean;
} {
  const deduped: InventoryProduct[] = [];
  let changed = false;

  for (const line of lines) {
    const key = normalizeLineNameKey(line.name);
    const existingIndex = deduped.findIndex((p) => normalizeLineNameKey(p.name) === key);
    if (existingIndex < 0) {
      deduped.push(line);
      continue;
    }

    changed = true;
    const existing = deduped[existingIndex]!;
    const existingCodes = new Set(existing.items.map((item) => item.code));
    const mergedItems = [...existing.items];
    for (const item of line.items) {
      if (existingCodes.has(item.code)) continue;
      mergedItems.push(item);
      existingCodes.add(item.code);
    }
    deduped[existingIndex] = {
      ...existing,
      items: mergedItems,
      imageSrc: existing.imageSrc || line.imageSrc,
    };
  }

  if (deduped.length !== lines.length) {
    changed = true;
  }

  return { next: deduped, changed };
}

function dedupeProductLinesByStructure(lines: InventoryProduct[]): {
  next: InventoryProduct[];
  changed: boolean;
} {
  const deduped: InventoryProduct[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const line of lines) {
    const itemCodes = [...line.items.map((item) => item.code.trim().toUpperCase())].sort();
    const signature = `${(line.imageSrc || '').trim().toLowerCase()}::${itemCodes.join('|')}`;
    if (seen.has(signature)) {
      changed = true;
      continue;
    }
    seen.add(signature);
    deduped.push(line);
  }

  return { next: deduped, changed };
}

function stripHmgsOutsideMetal(state: UhpInventoryState): {
  next: UhpInventoryState;
  changed: boolean;
} {
  const products = state.products.filter(
    (line) => !HMGS_LINE_NAME_KEYS.has(normalizeLineNameKey(line.name))
  );
  const tubeButtWeldProducts = state.tubeButtWeldProducts.filter(
    (line) => !HMGS_LINE_NAME_KEYS.has(normalizeLineNameKey(line.name))
  );
  const changed =
    products.length !== state.products.length ||
    tubeButtWeldProducts.length !== state.tubeButtWeldProducts.length;
  return {
    next: {
      ...state,
      products,
      tubeButtWeldProducts,
    },
    changed,
  };
}

export default function AdminInventoryStatusPage() {
  const HISTORY_PAGE_SIZE = 20;
  const HISTORY_KEEP_LIMIT = 100;
  const PRODUCT_LIST_PAGE_SIZE = 10;
  const [activeCategoryId, setActiveCategoryId] = useState<UhpCategoryId>('microWeld');
  const [searchQuery, setSearchQuery] = useState('');
  const [productListPage, setProductListPage] = useState(1);
  const [uhpInventory, setUhpInventory] = useState<UhpInventoryState>(() => ({
    products: [...INITIAL_MICRO_WELD_PRODUCTS],
    tubeButtWeldProducts: [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
    metalFaceSealProducts: [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
  }));
  const [inboundModal, setInboundModal] = useState<InboundModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    mode: 'create',
    historyId: null,
    quantityInput: '',
  });
  const [formError, setFormError] = useState('');
  const [outboundModal, setOutboundModal] = useState<OutboundModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    mode: 'create',
    historyId: null,
    quantityInput: '',
  });
  const [outboundFormError, setOutboundFormError] = useState('');
  const [historyModal, setHistoryModal] = useState<HistoryModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    page: 1,
  });
  const [historyViewModal, setHistoryViewModal] = useState<HistoryViewModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    page: 1,
  });
  const [adjustmentModal, setAdjustmentModal] = useState<AdjustmentModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    actualStockInput: '',
    reasonInput: '',
  });
  const [adjustmentFormError, setAdjustmentFormError] = useState('');
  const [productionPlanModal, setProductionPlanModal] = useState<ProductionPlanModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    mode: 'create',
    historyId: null,
    plannedQuantityInput: '',
    dueDateInput: '',
    noteInput: '',
  });
  const [productionPlanFormError, setProductionPlanFormError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isRefreshingInventory, setIsRefreshingInventory] = useState(false);

  const [structureItemModal, setStructureItemModal] = useState<StructureItemModalState | null>(null);
  const [structureItemFormError, setStructureItemFormError] = useState('');

  useEffect(() => {
    setProductListPage(1);
  }, [activeCategoryId, searchQuery]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return;
    const nextTab = pickCategoryIdForSearch(uhpInventory, q, 'admin');
    if (nextTab != null && nextTab !== activeCategoryId) {
      setActiveCategoryId(nextTab);
    }
  }, [searchQuery, uhpInventory, activeCategoryId]);

  const applyInventoryDocument = useCallback(async (snapshot: DocumentSnapshot) => {
    const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
    const reseedPayload = {
      products: INITIAL_MICRO_WELD_PRODUCTS,
      tubeButtWeldProducts: INITIAL_TUBE_BUTT_WELD_PRODUCTS,
      metalFaceSealProducts: INITIAL_METAL_FACE_SEAL_PRODUCTS,
      longElbowProducts: deleteField(),
      inventorySeedVersion: INVENTORY_SEED_VERSION,
      updatedAt: Timestamp.now(),
    };

    if (!snapshot.exists()) {
      try {
        await setDoc(inventoryRef, reseedPayload);
      } catch (error) {
        console.error('재고 초기 데이터 저장 오류:', error);
        setSyncError('재고 초기 데이터 저장에 실패했습니다.');
      }
      return;
    }

    const data = snapshot.data() as
      | {
          products?: InventoryProduct[];
          tubeButtWeldProducts?: InventoryProduct[];
          metalFaceSealProducts?: InventoryProduct[];
          longElbowProducts?: InventoryProduct[];
          inventorySeedVersion?: number;
        }
      | undefined;
    const raw = snapshot.data() as Record<string, unknown> | undefined;
    const hasLegacyLongElbowField =
      raw != null && Object.prototype.hasOwnProperty.call(raw, 'longElbowProducts');
    const needReseed = data?.inventorySeedVersion !== INVENTORY_SEED_VERSION;
    if (needReseed) {
      const existingProducts = Array.isArray(data?.products) ? data.products : [];
      const tubeBaseReseed = Array.isArray(data?.tubeButtWeldProducts)
        ? data.tubeButtWeldProducts
        : [];
      const existingMetalReseedRaw = Array.isArray(data?.metalFaceSealProducts)
        ? data.metalFaceSealProducts
        : [];
      const existingMetalReseed = existingMetalReseedRaw.map((line) =>
        line.name === LEGACY_HMGS_LINE_NAME ? { ...line, name: HMGS_LINE_NAME } : line
      );
      const elbowForReseed = mergeLegacyLongElbowIntoTubeButtWeld(
        tubeBaseReseed,
        Array.isArray(data?.longElbowProducts) ? data.longElbowProducts : undefined
      );
      const tubeStrippedReseed = stripHle02ItemFromLongElbowLine(elbowForReseed.next);
      const tubeForReseed = ensureSeedProductLinesInCategory(
        tubeStrippedReseed.next,
        INITIAL_TUBE_BUTT_WELD_PRODUCTS
      );
      const tubeDedupedForReseed = dedupeProductLinesByName(tubeForReseed.next);
      const metalForReseed = ensureSeedProductLinesInCategory(
        existingMetalReseed,
        INITIAL_METAL_FACE_SEAL_PRODUCTS
      );
      const productsForReseed = ensureSeedProductLinesInCategory(
        existingProducts,
        INITIAL_MICRO_WELD_PRODUCTS
      );
      const productsDedupedForReseed = dedupeProductLinesByName(productsForReseed.next);
      const metalDedupedForReseed = dedupeProductLinesByName(metalForReseed.next);
      const strippedHmgsForReseed = stripHmgsOutsideMetal({
        products: productsDedupedForReseed.next,
        tubeButtWeldProducts: tubeDedupedForReseed.next,
        metalFaceSealProducts: metalDedupedForReseed.next,
      });
      const reseedProductsByStructure = dedupeProductLinesByStructure(strippedHmgsForReseed.next.products);
      const reseedTubeByStructure = dedupeProductLinesByStructure(
        strippedHmgsForReseed.next.tubeButtWeldProducts
      );
      const reseedMetalByStructure = dedupeProductLinesByStructure(
        strippedHmgsForReseed.next.metalFaceSealProducts
      );
      try {
        await setDoc(
          inventoryRef,
          {
            products: reseedProductsByStructure.next,
            tubeButtWeldProducts: reseedTubeByStructure.next,
            metalFaceSealProducts: reseedMetalByStructure.next,
            longElbowProducts: deleteField(),
            inventorySeedVersion: INVENTORY_SEED_VERSION,
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error('재고 시드 재적용 오류:', error);
        setSyncError('재고 시드 재적용에 실패했습니다.');
      }
      return;
    }

    const tubeBase = Array.isArray(data?.tubeButtWeldProducts)
      ? data.tubeButtWeldProducts
      : [...INITIAL_TUBE_BUTT_WELD_PRODUCTS];
    const elbowMerge = mergeLegacyLongElbowIntoTubeButtWeld(
      tubeBase,
      Array.isArray(data?.longElbowProducts) ? data.longElbowProducts : undefined
    );
    const hle02Strip = stripHle02ItemFromLongElbowLine(elbowMerge.next);
    const tubeDeduped = dedupeProductLinesByName(hle02Strip.next);
    const normalizedMetalFaceSealProducts = (
      Array.isArray(data?.metalFaceSealProducts)
        ? data.metalFaceSealProducts
        : [...INITIAL_METAL_FACE_SEAL_PRODUCTS]
    ).map((line) =>
      line.name === LEGACY_HMGS_LINE_NAME ? { ...line, name: HMGS_LINE_NAME } : line
    );

    const merged: UhpInventoryState = {
      products: Array.isArray(data?.products)
        ? data.products
        : [...INITIAL_MICRO_WELD_PRODUCTS],
      tubeButtWeldProducts: tubeDeduped.next,
      metalFaceSealProducts: normalizedMetalFaceSealProducts,
    };
    let catalogProducts = merged.products;
    const hmrtResult = mergeMissingHmrtItemsFromSeed(catalogProducts);
    catalogProducts = hmrtResult.next;
    const hmtbResult = mergeMissingHmtbItemsFromSeed(catalogProducts);
    catalogProducts = hmtbResult.next;
    const hmcResult = mergeMissingHmcItemsFromSeed(catalogProducts);
    catalogProducts = hmcResult.next;
    const catalogItemsMerged = hmrtResult.changed || hmtbResult.changed || hmcResult.changed;
    const mergedWithCatalog: UhpInventoryState = { ...merged, products: catalogProducts };
    const dedupedProducts = dedupeProductLinesByName(mergedWithCatalog.products);
    const dedupedTube = dedupeProductLinesByName(mergedWithCatalog.tubeButtWeldProducts);
    const dedupedMetal = dedupeProductLinesByName(mergedWithCatalog.metalFaceSealProducts);
    const dedupedMerged: UhpInventoryState = {
      ...mergedWithCatalog,
      products: dedupedProducts.next,
      tubeButtWeldProducts: dedupedTube.next,
      metalFaceSealProducts: dedupedMetal.next,
    };
    const hmgsStripped = stripHmgsOutsideMetal(dedupedMerged);
    const dedupedProductsByStructure = dedupeProductLinesByStructure(hmgsStripped.next.products);
    const dedupedTubeByStructure = dedupeProductLinesByStructure(hmgsStripped.next.tubeButtWeldProducts);
    const dedupedMetalByStructure = dedupeProductLinesByStructure(hmgsStripped.next.metalFaceSealProducts);
    const structureDedupedState: UhpInventoryState = {
      ...hmgsStripped.next,
      products: dedupedProductsByStructure.next,
      tubeButtWeldProducts: dedupedTubeByStructure.next,
      metalFaceSealProducts: dedupedMetalByStructure.next,
    };
    const dedupedAnyChanged =
      dedupedProducts.changed ||
      dedupedTube.changed ||
      dedupedMetal.changed ||
      dedupedProductsByStructure.changed ||
      dedupedTubeByStructure.changed ||
      dedupedMetalByStructure.changed;
    const { next, shouldPersistSlice } = dropRemovedDefaultCategoryProducts(structureDedupedState);
    const hmgsRenamedInMetal = normalizedMetalFaceSealProducts.some(
      (line) => line.name === HMGS_LINE_NAME
    ) && (Array.isArray(data?.metalFaceSealProducts)
      ? data.metalFaceSealProducts.some((line) => line.name === LEGACY_HMGS_LINE_NAME)
      : false);
    const shouldPersistLegacyLongElbowMerge =
      elbowMerge.changed ||
      Boolean(hasLegacyLongElbowField) ||
      hle02Strip.changed ||
      tubeDeduped.changed;
    if (shouldPersistLegacyLongElbowMerge) {
      try {
        await setDoc(
          inventoryRef,
          {
            tubeButtWeldProducts: next.tubeButtWeldProducts,
            longElbowProducts: deleteField(),
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error('Long Elbow(Tube) 마이그레이션 저장 오류:', error);
      }
    }
    if (catalogItemsMerged || dedupedProducts.changed || hmgsStripped.changed) {
      try {
        await setDoc(
          inventoryRef,
          {
            products: next.products,
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error('Micro Weld 도면 품목 보강 저장 오류:', error);
      }
    }
    if (shouldPersistSlice || hmgsRenamedInMetal || dedupedAnyChanged) {
      try {
        await setDoc(
          inventoryRef,
          {
            tubeButtWeldProducts: next.tubeButtWeldProducts,
            metalFaceSealProducts: next.metalFaceSealProducts,
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error('레거시 TBW/MFS 제품 라인 정리 저장 오류:', error);
      }
    }
    setUhpInventory(next);
  }, []);

  useEffect(() => {
    const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        void applyInventoryDocument(snapshot);
      },
      (error) => {
        console.error('재고 데이터 동기화 오류:', error);
        setSyncError('재고 데이터 동기화에 실패했습니다.');
      }
    );

    return () => unsubscribe();
  }, [applyInventoryDocument]);

  const refreshInventoryFromServer = async () => {
    setIsRefreshingInventory(true);
    setSyncError('');
    try {
      const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
      const snapshot = await getDocFromServer(inventoryRef);
      await applyInventoryDocument(snapshot);
    } catch (error) {
      console.error('재고 새로고침 오류:', error);
      setSyncError('재고 데이터를 불러오지 못했습니다.');
    } finally {
      setIsRefreshingInventory(false);
    }
  };

  const persistUhpInventory = async (nextState: UhpInventoryState) => {
    try {
      await persistUhpInventoryState(nextState);
      setSyncError('');
    } catch (error) {
      console.error('재고 데이터 저장 오류:', error);
      setSyncError('재고 데이터 저장에 실패했습니다.');
    }
  };

  const closeStructureItemModal = () => {
    setStructureItemModal(null);
    setStructureItemFormError('');
  };

  const openAddStructureItem = (productName: string) => {
    setStructureItemModal({
      productName,
      codeInput: '',
    });
    setStructureItemFormError('');
  };

  const saveStructureItem = () => {
    if (!structureItemModal) return;
    const m = structureItemModal;
    const cat = findUhpCategoryByProductName(uhpInventory, m.productName);
    if (!cat) {
      setStructureItemFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const key = UHP_STATE_KEYS[cat];
    const next = JSON.parse(JSON.stringify(uhpInventory)) as UhpInventoryState;
    const slice = [...next[key]];
    const pi = slice.findIndex((p) => p.name === m.productName);
    if (pi < 0) {
      setStructureItemFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const product = slice[pi]!;
    const code = m.codeInput.trim();
    if (!code) {
      setStructureItemFormError('품목 코드를 입력해 주세요.');
      return;
    }
    if (product.items.some((it) => it.code === code)) {
      setStructureItemFormError('이미 같은 품목 코드가 있습니다.');
      return;
    }
    const newItem = createEmptyInventoryItem(code, 0);
    slice[pi] = { ...product, items: [...product.items, newItem] };

    next[key] = slice;
    setUhpInventory(next);
    void persistUhpInventory(next);
    closeStructureItemModal();
  };

  const handleDeleteProductLine = (productName: string) => {
    const category = findUhpCategoryByProductName(uhpInventory, productName);
    if (!category) {
      setSyncError('삭제할 제품을 찾을 수 없습니다.');
      return;
    }

    if (!confirm(`"${productName}" 제품 라인을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) {
      return;
    }

    const key = UHP_STATE_KEYS[category];
    const nextState: UhpInventoryState = JSON.parse(JSON.stringify(uhpInventory)) as UhpInventoryState;
    const beforeCount = nextState[key].length;
    nextState[key] = nextState[key].filter((line) => line.name !== productName);
    const removedCount = beforeCount - nextState[key].length;

    if (removedCount <= 0) {
      setSyncError('삭제할 제품을 찾을 수 없습니다.');
      return;
    }

    setUhpInventory(nextState);
    void persistUhpInventory(nextState);
  };

  const handleAddProductLine = () => {
    const nameInput = prompt('추가할 제품명을 입력해 주세요.');
    const name = nameInput?.trim() ?? '';
    if (!name) return;

    const existsInAnyCategory =
      uhpInventory.products.some((line) => line.name.trim() === name) ||
      uhpInventory.tubeButtWeldProducts.some((line) => line.name.trim() === name) ||
      uhpInventory.metalFaceSealProducts.some((line) => line.name.trim() === name);
    if (existsInAnyCategory) {
      setSyncError('이미 같은 이름의 제품 라인이 있습니다.');
      return;
    }

    const key = UHP_STATE_KEYS[activeCategoryId];
    const nextState: UhpInventoryState = JSON.parse(JSON.stringify(uhpInventory)) as UhpInventoryState;
    nextState[key] = [
      ...nextState[key],
      {
        name,
        imageSrc: '/inventory/micro-elbow-hme.png',
        items: [],
      },
    ];

    setUhpInventory(nextState);
    void persistUhpInventory(nextState);
  };

  const handleDeleteItem = (productName: string, itemCode: string) => {
    const category = findUhpCategoryByProductName(uhpInventory, productName);
    if (!category) {
      setSyncError('품목을 찾을 수 없습니다.');
      return;
    }

    if (!confirm(`"${itemCode}" 품목을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) {
      return;
    }

    const key = UHP_STATE_KEYS[category];
    const nextState: UhpInventoryState = JSON.parse(JSON.stringify(uhpInventory)) as UhpInventoryState;
    let removed = false;
    nextState[key] = nextState[key].map((line) => {
      if (line.name !== productName) return line;
      const filteredItems = line.items.filter((item) => item.code !== itemCode);
      if (filteredItems.length !== line.items.length) {
        removed = true;
      }
      return { ...line, items: filteredItems };
    });

    if (!removed) {
      setSyncError('삭제할 품목을 찾을 수 없습니다.');
      return;
    }

    setUhpInventory(nextState);
    void persistUhpInventory(nextState);
  };

  const handleRenameItem = (productName: string, itemCode: string) => {
    const category = findUhpCategoryByProductName(uhpInventory, productName);
    if (!category) {
      setSyncError('품목을 찾을 수 없습니다.');
      return;
    }

    const nextCodeInput = prompt('변경할 품목 코드를 입력해 주세요.', itemCode);
    const nextCode = nextCodeInput?.trim() ?? '';
    if (!nextCode || nextCode === itemCode) return;

    const key = UHP_STATE_KEYS[category];
    const targetProduct = uhpInventory[key].find((line) => line.name === productName);
    if (!targetProduct) {
      setSyncError('품목을 찾을 수 없습니다.');
      return;
    }
    if (targetProduct.items.some((item) => item.code === nextCode)) {
      setSyncError('이미 같은 품목 코드가 있습니다.');
      return;
    }

    const nextState: UhpInventoryState = JSON.parse(JSON.stringify(uhpInventory)) as UhpInventoryState;
    let renamed = false;
    nextState[key] = nextState[key].map((line) => {
      if (line.name !== productName) return line;
      return {
        ...line,
        items: line.items.map((item) => {
          if (item.code !== itemCode) return item;
          renamed = true;
          return { ...item, code: nextCode };
        }),
      };
    });

    if (!renamed) {
      setSyncError('수정할 품목을 찾을 수 없습니다.');
      return;
    }

    setUhpInventory(nextState);
    void persistUhpInventory(nextState);
  };

  const closeInboundModal = () => {
    setInboundModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setFormError('');
  };

  const closeOutboundModal = () => {
    setOutboundModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setOutboundFormError('');
  };

  const openHistoryModal = (productName: string, itemCode: string) => {
    setHistoryModal({
      isOpen: true,
      productName,
      itemCode,
      page: 1,
    });
  };

  const closeHistoryModal = () => {
    setHistoryModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      page: 1,
    });
  };

  const openHistoryViewModal = (productName: string, itemCode: string) => {
    setHistoryViewModal({
      isOpen: true,
      productName,
      itemCode,
      page: 1,
    });
  };

  const closeHistoryViewModal = () => {
    setHistoryViewModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      page: 1,
    });
  };

  const openAdjustmentModal = (productName: string, itemCode: string) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );
    const defaultVariant = targetItem?.variants?.[0];

    setAdjustmentModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: defaultVariant?.code ?? '',
      actualStockInput: defaultVariant ? String(defaultVariant.currentStock) : '',
      reasonInput: '',
    });
    setAdjustmentFormError('');
  };

  const closeAdjustmentModal = () => {
    setAdjustmentModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      actualStockInput: '',
      reasonInput: '',
    });
    setAdjustmentFormError('');
  };

  const openProductionPlanCreateModal = (productName: string, itemCode: string) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );
    const defaultVariant = targetItem?.variants?.[0];
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    setProductionPlanModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: defaultVariant?.code ?? '',
      mode: 'create',
      historyId: null,
      plannedQuantityInput: '',
      dueDateInput: `${yyyy}-${mm}-${dd}`,
      noteInput: '',
    });
    setProductionPlanFormError('');
  };

  const openProductionPlanEditModal = (
    productName: string,
    itemCode: string,
    history: ProductionPlanHistory
  ) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );

    setProductionPlanModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: history.variantCode ?? targetItem?.variants?.[0]?.code ?? '',
      mode: 'edit',
      historyId: history.id,
      plannedQuantityInput: String(history.plannedQuantity),
      dueDateInput: history.dueDate,
      noteInput: history.note ?? '',
    });
    setProductionPlanFormError('');
  };

  const closeProductionPlanModal = () => {
    setProductionPlanModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      mode: 'create',
      historyId: null,
      plannedQuantityInput: '',
      dueDateInput: '',
      noteInput: '',
    });
    setProductionPlanFormError('');
  };

  const openInboundCreateModal = (productName: string, itemCode: string) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );

    setInboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: targetItem?.variants?.[0]?.code ?? '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setFormError('');
  };

  const openInboundEditModal = (productName: string, itemCode: string, history: InboundHistory) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );

    setInboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: history.variantCode ?? targetItem?.variants?.[0]?.code ?? '',
      mode: 'edit',
      historyId: history.id,
      quantityInput: String(history.quantity),
    });
    setFormError('');
  };

  const openOutboundCreateModal = (productName: string, itemCode: string) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );

    setOutboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: targetItem?.variants?.[0]?.code ?? '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setOutboundFormError('');
  };

  const openOutboundEditModal = (
    productName: string,
    itemCode: string,
    history: OutboundHistory
  ) => {
    const targetItem = findProductInUhpSlices(uhpInventory, productName)?.items.find(
      (item) => item.code === itemCode
    );

    setOutboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: history.variantCode ?? targetItem?.variants?.[0]?.code ?? '',
      mode: 'edit',
      historyId: history.id,
      quantityInput: String(history.quantity),
    });
    setOutboundFormError('');
  };

  const handleSaveInbound = () => {
    const parsedQuantity = Number(inboundModal.quantityInput);
    const minInboundQuantity = inboundModal.mode === 'edit' ? 0 : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < minInboundQuantity) {
      setFormError(
        inboundModal.mode === 'edit'
          ? '입고 수량은 0 이상의 정수로 입력해 주세요.'
          : '입고 수량은 1 이상의 정수로 입력해 주세요.'
      );
      return;
    }
    const targetItem = findProductInUhpSlices(uhpInventory, inboundModal.productName)?.items.find(
      (item) => item.code === inboundModal.itemCode
    );
    if (targetItem?.variants && targetItem.variants.length > 0 && !inboundModal.variantCode) {
      setFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const inboundCategory = findUhpCategoryByProductName(uhpInventory, inboundModal.productName);
    if (!inboundCategory) {
      setFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const inboundField = UHP_STATE_KEYS[inboundCategory];
    const nextInboundSlice = uhpInventory[inboundField].map((product) => {
        if (product.name !== inboundModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== inboundModal.itemCode) {
              return item;
            }

            if (inboundModal.mode === 'create') {
              const nowIso = new Date().toISOString();
              const nextHistory: InboundHistory = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                quantity: parsedQuantity,
                createdAt: nowIso,
                variantCode: inboundModal.variantCode || undefined,
              };

              const nextVariants = item.variants
                ? item.variants.map((variant) =>
                    variant.code === inboundModal.variantCode
                      ? { ...variant, currentStock: variant.currentStock + parsedQuantity }
                      : variant
                  )
                : undefined;

              return {
                ...item,
                currentStock: nextVariants
                  ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                  : item.currentStock + parsedQuantity,
                variants: nextVariants,
                inboundHistory: [nextHistory, ...item.inboundHistory].slice(0, HISTORY_KEEP_LIMIT),
              };
            }

            if (!inboundModal.historyId) {
              return item;
            }

            const targetHistory = item.inboundHistory.find(
              (history) => history.id === inboundModal.historyId
            );
            if (!targetHistory) {
              return item;
            }

            const stockDiff = parsedQuantity - targetHistory.quantity;
            const nextVariants = item.variants
              ? item.variants.map((variant) => {
                  if (variant.code !== (targetHistory.variantCode || inboundModal.variantCode)) {
                    return variant;
                  }
                  return {
                    ...variant,
                    currentStock: variant.currentStock + stockDiff,
                  };
                })
              : undefined;

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : item.currentStock + stockDiff,
              variants: nextVariants,
              inboundHistory: item.inboundHistory.map((history) =>
                history.id === inboundModal.historyId
                  ? { ...history, quantity: parsedQuantity, variantCode: inboundModal.variantCode || undefined }
                  : history
              ),
            };
          }),
        };
      });

    const nextUhpAfterInbound = { ...uhpInventory, [inboundField]: nextInboundSlice };
    setUhpInventory(nextUhpAfterInbound);
    void persistUhpInventory(nextUhpAfterInbound);

    closeInboundModal();
  };

  const handleSaveOutbound = () => {
    const parsedQuantity = Number(outboundModal.quantityInput);
    const minOutboundQuantity = outboundModal.mode === 'edit' ? 0 : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < minOutboundQuantity) {
      setOutboundFormError(
        outboundModal.mode === 'edit'
          ? '출고 수량은 0 이상의 정수로 입력해 주세요.'
          : '출고 수량은 1 이상의 정수로 입력해 주세요.'
      );
      return;
    }

    const targetItem = findProductInUhpSlices(uhpInventory, outboundModal.productName)?.items.find(
      (item) => item.code === outboundModal.itemCode
    );
    if (targetItem?.variants && targetItem.variants.length > 0 && !outboundModal.variantCode) {
      setOutboundFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const targetVariant = targetItem?.variants?.find(
      (variant) => variant.code === outboundModal.variantCode
    );
    if (outboundModal.mode === 'create' && targetVariant && parsedQuantity > targetVariant.currentStock) {
      setOutboundFormError('현재고보다 큰 수량은 출고할 수 없습니다.');
      return;
    }

    const outboundCategory = findUhpCategoryByProductName(uhpInventory, outboundModal.productName);
    if (!outboundCategory) {
      setOutboundFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const outboundField = UHP_STATE_KEYS[outboundCategory];
    const nextOutboundSlice = uhpInventory[outboundField].map((product) => {
        if (product.name !== outboundModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== outboundModal.itemCode) {
              return item;
            }

            if (outboundModal.mode === 'create') {
              const nowIso = new Date().toISOString();
              const nextHistory: OutboundHistory = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                quantity: parsedQuantity,
                createdAt: nowIso,
                variantCode: outboundModal.variantCode || undefined,
              };

              const nextVariants = item.variants
                ? item.variants.map((variant) =>
                    variant.code === outboundModal.variantCode
                      ? { ...variant, currentStock: Math.max(0, variant.currentStock - parsedQuantity) }
                      : variant
                  )
                : undefined;

              return {
                ...item,
                currentStock: nextVariants
                  ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                  : Math.max(0, item.currentStock - parsedQuantity),
                variants: nextVariants,
                outboundHistory: [nextHistory, ...item.outboundHistory].slice(0, HISTORY_KEEP_LIMIT),
              };
            }

            if (!outboundModal.historyId) {
              return item;
            }

            const targetHistory = item.outboundHistory.find(
              (history) => history.id === outboundModal.historyId
            );
            if (!targetHistory) {
              return item;
            }

            const stockDiff = parsedQuantity - targetHistory.quantity;
            const nextVariants = item.variants
              ? item.variants.map((variant) => {
                  if (variant.code !== (targetHistory.variantCode || outboundModal.variantCode)) {
                    return variant;
                  }
                  if (stockDiff > 0 && stockDiff > variant.currentStock) {
                    return variant;
                  }
                  return {
                    ...variant,
                    currentStock: Math.max(0, variant.currentStock - stockDiff),
                  };
                })
              : undefined;

            const editedVariant = nextVariants?.find(
              (variant) => variant.code === (targetHistory.variantCode || outboundModal.variantCode)
            );
            if (stockDiff > 0 && editedVariant && editedVariant.currentStock < 0) {
              return item;
            }

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : Math.max(0, item.currentStock - stockDiff),
              variants: nextVariants,
              outboundHistory: item.outboundHistory.map((history) =>
                history.id === outboundModal.historyId
                  ? {
                      ...history,
                      quantity: parsedQuantity,
                      variantCode: outboundModal.variantCode || undefined,
                    }
                  : history
              ),
            };
          }),
        };
      });

    const nextUhpAfterOutbound = { ...uhpInventory, [outboundField]: nextOutboundSlice };
    setUhpInventory(nextUhpAfterOutbound);
    void persistUhpInventory(nextUhpAfterOutbound);

    closeOutboundModal();
  };

  const handleSaveAdjustment = () => {
    const parsedActualStock = Number(adjustmentModal.actualStockInput);
    if (!Number.isInteger(parsedActualStock) || parsedActualStock < 0) {
      setAdjustmentFormError('실물 재고는 0 이상의 정수로 입력해 주세요.');
      return;
    }
    if (!adjustmentModal.reasonInput.trim()) {
      setAdjustmentFormError('조정 사유를 입력해 주세요.');
      return;
    }

    const targetVariant = findProductInUhpSlices(uhpInventory, adjustmentModal.productName)
      ?.items.find((item) => item.code === adjustmentModal.itemCode)
      ?.variants?.find((variant) => variant.code === adjustmentModal.variantCode);
    if (!targetVariant) {
      setAdjustmentFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const delta = parsedActualStock - targetVariant.currentStock;
    if (delta === 0) {
      setAdjustmentFormError('변경된 재고가 없습니다. 다른 수량을 입력해 주세요.');
      return;
    }

    const adjustmentCategory = findUhpCategoryByProductName(
      uhpInventory,
      adjustmentModal.productName
    );
    if (!adjustmentCategory) {
      setAdjustmentFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const adjustmentField = UHP_STATE_KEYS[adjustmentCategory];
    const nextAdjustmentSlice = uhpInventory[adjustmentField].map((product) => {
        if (product.name !== adjustmentModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== adjustmentModal.itemCode) {
              return item;
            }

            const nextVariants = item.variants
              ? item.variants.map((variant) =>
                  variant.code === adjustmentModal.variantCode
                    ? { ...variant, currentStock: parsedActualStock }
                    : variant
                )
              : undefined;

            const nextHistory: AdjustmentHistory = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: new Date().toISOString(),
              variantCode: adjustmentModal.variantCode,
              beforeStock: targetVariant.currentStock,
              afterStock: parsedActualStock,
              delta,
              reason: adjustmentModal.reasonInput.trim(),
            };

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : parsedActualStock,
              variants: nextVariants,
              adjustmentHistory: [nextHistory, ...item.adjustmentHistory].slice(0, HISTORY_KEEP_LIMIT),
            };
          }),
        };
      });

    const nextUhpAfterAdjustment = { ...uhpInventory, [adjustmentField]: nextAdjustmentSlice };
    setUhpInventory(nextUhpAfterAdjustment);
    void persistUhpInventory(nextUhpAfterAdjustment);

    closeAdjustmentModal();
  };

  const handleSaveProductionPlan = () => {
    const parsedPlannedQuantity = Number(productionPlanModal.plannedQuantityInput);
    const minPlannedQuantity = productionPlanModal.mode === 'edit' ? 0 : 1;
    if (!Number.isInteger(parsedPlannedQuantity) || parsedPlannedQuantity < minPlannedQuantity) {
      setProductionPlanFormError(
        productionPlanModal.mode === 'edit'
          ? '생산계획 수량은 0 이상의 정수로 입력해 주세요.'
          : '생산계획 수량은 1 이상의 정수로 입력해 주세요.'
      );
      return;
    }
    if (!productionPlanModal.dueDateInput) {
      setProductionPlanFormError('생산완료일을 입력해 주세요.');
      return;
    }

    const planCategory = findUhpCategoryByProductName(
      uhpInventory,
      productionPlanModal.productName
    );
    if (!planCategory) {
      setProductionPlanFormError('제품을 찾을 수 없습니다.');
      return;
    }
    const planField = UHP_STATE_KEYS[planCategory];
    const nextPlanSlice = uhpInventory[planField].map((product) => {
      if (product.name !== productionPlanModal.productName) {
        return product;
      }

      return {
        ...product,
        items: product.items.map((item) => {
          if (item.code !== productionPlanModal.itemCode) {
            return item;
          }

          if (productionPlanModal.mode === 'create') {
            const nextHistory: ProductionPlanHistory = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              variantCode: productionPlanModal.variantCode || undefined,
              plannedQuantity: parsedPlannedQuantity,
              dueDate: productionPlanModal.dueDateInput,
              note: productionPlanModal.noteInput.trim() || undefined,
            };
            return {
              ...item,
              productionPlanHistory: [
                nextHistory,
                ...(item.productionPlanHistory ?? []),
              ].slice(0, HISTORY_KEEP_LIMIT),
            };
          }

          if (!productionPlanModal.historyId) {
            return item;
          }

          return {
            ...item,
            productionPlanHistory: (item.productionPlanHistory ?? []).map((history) =>
              history.id === productionPlanModal.historyId
                ? {
                    ...history,
                    variantCode: productionPlanModal.variantCode || undefined,
                    plannedQuantity: parsedPlannedQuantity,
                    dueDate: productionPlanModal.dueDateInput,
                    note: productionPlanModal.noteInput.trim() || undefined,
                    updatedAt: new Date().toISOString(),
                  }
                : history
            ),
          };
        }),
      };
    });

    const nextUhpAfterPlan = { ...uhpInventory, [planField]: nextPlanSlice };
    setUhpInventory(nextUhpAfterPlan);
    void persistUhpInventory(nextUhpAfterPlan);
    closeProductionPlanModal();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const modalTargetItem = findProductInUhpSlices(uhpInventory, inboundModal.productName)?.items.find(
    (item) => item.code === inboundModal.itemCode
  );
  const outboundModalTargetItem = findProductInUhpSlices(
    uhpInventory,
    outboundModal.productName
  )?.items.find((item) => item.code === outboundModal.itemCode);
  const adjustmentModalTargetItem = findProductInUhpSlices(
    uhpInventory,
    adjustmentModal.productName
  )?.items.find((item) => item.code === adjustmentModal.itemCode);
  const productionPlanModalTargetItem = findProductInUhpSlices(
    uhpInventory,
    productionPlanModal.productName
  )?.items.find((item) => item.code === productionPlanModal.itemCode);
  const historyTargetItem = findProductInUhpSlices(uhpInventory, historyModal.productName)?.items.find(
    (item) => item.code === historyModal.itemCode
  );
  const combinedHistoryRows = buildCombinedHistoryRows(historyTargetItem);
  const historyTotalPages = Math.max(1, Math.ceil(combinedHistoryRows.length / HISTORY_PAGE_SIZE));
  const historyCurrentPage = Math.min(historyModal.page, historyTotalPages);
  const pagedHistoryRows = combinedHistoryRows.slice(
    (historyCurrentPage - 1) * HISTORY_PAGE_SIZE,
    historyCurrentPage * HISTORY_PAGE_SIZE
  );

  const historyViewTargetItem = findProductInUhpSlices(
    uhpInventory,
    historyViewModal.productName
  )?.items.find((item) => item.code === historyViewModal.itemCode);
  const combinedHistoryViewRows = buildCombinedHistoryRows(historyViewTargetItem);
  const historyViewTotalPages = Math.max(1, Math.ceil(combinedHistoryViewRows.length / HISTORY_PAGE_SIZE));
  const historyViewCurrentPage = Math.min(historyViewModal.page, historyViewTotalPages);
  const pagedHistoryViewRows = combinedHistoryViewRows.slice(
    (historyViewCurrentPage - 1) * HISTORY_PAGE_SIZE,
    historyViewCurrentPage * HISTORY_PAGE_SIZE
  );
  const isGlobalSearch = normalizedQuery.length > 0;
  const filteredCategoryProducts = isGlobalSearch
    ? UHP_CATEGORY_TABS.flatMap(({ id, label }) =>
        filterProductsBySearchQuery(
          uhpInventory[UHP_STATE_KEYS[id]],
          normalizedQuery,
          'admin'
        ).map((p) => ({
          ...p,
          categoryLabel: label,
          listKey: `${id}::${p.name}`,
        }))
      )
    : filterProductsBySearchQuery(
        uhpInventory[UHP_STATE_KEYS[activeCategoryId]],
        normalizedQuery,
        'admin'
      ).map((p) => ({
        ...p,
        categoryLabel: undefined,
        listKey: `${activeCategoryId}::${p.name}`,
      }));

  const productListTotalPages = Math.max(
    1,
    Math.ceil(filteredCategoryProducts.length / PRODUCT_LIST_PAGE_SIZE)
  );
  const productListEffectivePage = Math.min(productListPage, productListTotalPages);
  const pagedCategoryProducts = filteredCategoryProducts.slice(
    (productListEffectivePage - 1) * PRODUCT_LIST_PAGE_SIZE,
    productListEffectivePage * PRODUCT_LIST_PAGE_SIZE
  );
  const productListRangeStart =
    filteredCategoryProducts.length === 0
      ? 0
      : (productListEffectivePage - 1) * PRODUCT_LIST_PAGE_SIZE + 1;
  const productListRangeEnd = Math.min(
    filteredCategoryProducts.length,
    productListEffectivePage * PRODUCT_LIST_PAGE_SIZE
  );

  const getCurrentStock = (item: InventoryItem): number =>
    item.variants && item.variants.length > 0
      ? item.variants.reduce((sum, variant) => sum + variant.currentStock, 0)
      : item.currentStock;

  const getVariantProductionPlanInfo = (item: InventoryItem, variantCode: string) => {
    const plans = (item.productionPlanHistory ?? []).filter(
      (plan) => plan.variantCode === variantCode
    );
    if (plans.length === 0) return null;

    const totalPlanned = plans.reduce((sum, plan) => sum + plan.plannedQuantity, 0);
    const nearestDueDate = [...plans]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
      ?.dueDate;

    return {
      totalPlanned,
      nearestDueDate,
    };
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">UHP 재고현황</h1>
          <p className="text-gray-600 mt-2">
            입고·출고·재고조정·생산계획·이력과 함께, 각 제품 카드에서{' '}
            <span className="font-medium text-gray-800">품목 코드</span>는 「품목 추가」로 등록할 수 있습니다.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            <span className="font-medium text-gray-800">제품 라인(시리즈명·이미지)</span>만 →{' '}
            <Link
              href="/admin/inventory/products"
              className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
            >
              제품 이미지 등록
            </Link>
          </p>
          {syncError && (
            <p className="mt-2 text-sm font-medium text-red-600">{syncError}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Link
            href="/admin/inventory/products"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
          >
            제품 이미지 등록
          </Link>
          <button
            type="button"
            onClick={() => void refreshInventoryFromServer()}
            disabled={isRefreshingInventory}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg
              className={`h-4 w-4 text-gray-600 ${isRefreshingInventory ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9M20 20v-5h-.581m-15.357-2a8.003 8.003 0 0 0 15.357 2"
              />
            </svg>
            {isRefreshingInventory ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="제품명·품목코드 검색 (전체 카테고리)"
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {isGlobalSearch && (
            <p className="mt-1.5 text-xs text-gray-500">
              Micro / Tube Butt Weld / Metal Face Seal 전체에서 검색합니다.
            </p>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">제품 카테고리</h2>
          <button
            type="button"
            onClick={handleAddProductLine}
            className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
          >
            + 제품 추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {UHP_CATEGORY_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveCategoryId(id)}
              className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                activeCategoryId === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6 space-y-4">
            {pagedCategoryProducts.map((product) => (
              <div key={product.listKey} className="rounded-lg border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  {product.name}
                  {product.categoryLabel != null && (
                    <span className="ml-2 align-middle text-sm font-normal text-blue-700">
                      ({product.categoryLabel})
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="h-[180px] w-full overflow-hidden rounded-md border border-gray-200 bg-white">
                      <img
                        src={product.imageSrc}
                        alt={product.name}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-gray-600">
                        새 품목 코드는 「품목 추가」로 등록합니다.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openAddStructureItem(product.name)}
                          className="inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-blue-300 bg-blue-50/80 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                        >
                          + 품목 추가
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProductLine(product.name)}
                          className="inline-flex shrink-0 items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          제품 삭제
                        </button>
                      </div>
                    </div>
                    {product.filteredItems.length === 0 ? (
                      <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-sm text-gray-500">
                        등록된 품목이 없습니다. 「품목 추가」로 품목 코드를 등록하면 SL-BA 등 6종 세부코드가
                        자동 생성됩니다.
                      </p>
                    ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {product.filteredItems.map((item) => (
                        <div
                          key={item.code}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
                        >
                          {(() => {
                            const currentStock = getCurrentStock(item);
                            return (
                              <>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800">{item.code}</p>
                            <div className="flex items-center gap-2">
                              <span
                                className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
                              >
                                총 현재고 {currentStock} {item.unit}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRenameItem(product.name, item.code)}
                                className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                              >
                                품목 수정
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(product.name, item.code)}
                                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                품목 삭제
                              </button>
                            </div>
                          </div>
                          {item.variants && item.variants.length > 0 && (
                            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {item.variants.map((variant) => (
                                (() => {
                                  const variantPlanInfo = getVariantProductionPlanInfo(
                                    item,
                                    variant.code
                                  );
                                  const variantExpectedStock = variant.currentStock + (variantPlanInfo?.totalPlanned ?? 0);
                                  return (
                                    <div
                                      key={variant.code}
                                      className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px]"
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-medium text-gray-700">{variant.code}</span>
                                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">
                                          {variant.currentStock} {variant.unit}
                                        </span>
                                      </div>
                                      {variantPlanInfo && (
                                        <div className="mt-1 flex items-center justify-between gap-1">
                                          <span className="text-[10px] text-gray-500">
                                            {variantPlanInfo.nearestDueDate ?? '-'}
                                          </span>
                                          <div className="flex shrink-0 items-center gap-1">
                                            <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-semibold text-purple-700">
                                              예상 {variantExpectedStock} {variant.unit}
                                            </span>
                                            <button
                                              type="button"
                                              title="생산계획 수정"
                                              onClick={() => {
                                                const plansForVariant = (
                                                  item.productionPlanHistory ?? []
                                                ).filter((p) => p.variantCode === variant.code);
                                                if (plansForVariant.length === 1) {
                                                  openProductionPlanEditModal(
                                                    product.name,
                                                    item.code,
                                                    plansForVariant[0]!
                                                  );
                                                } else if (plansForVariant.length > 1) {
                                                  openHistoryModal(product.name, item.code);
                                                }
                                              }}
                                              className="rounded px-1 py-0.5 text-[10px] font-semibold text-purple-700 underline decoration-purple-300 underline-offset-2 hover:text-purple-900"
                                            >
                                              수정
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => openInboundCreateModal(product.name, item.code)}
                              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                            >
                              입고
                            </button>
                            <button
                              type="button"
                              onClick={() => openOutboundCreateModal(product.name, item.code)}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              출고
                            </button>
                            <button
                              type="button"
                              onClick={() => openProductionPlanCreateModal(product.name, item.code)}
                              className="rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
                            >
                              생산계획
                            </button>
                            <button
                              type="button"
                              onClick={() => openAdjustmentModal(product.name, item.code)}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                            >
                              재고조정
                            </button>
                            <button
                              type="button"
                              onClick={() => openHistoryModal(product.name, item.code)}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              이력수정
                            </button>
                            <button
                              type="button"
                              onClick={() => openHistoryViewModal(product.name, item.code)}
                              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              전체 이력
                            </button>
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredCategoryProducts.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                검색 결과가 없습니다.
              </p>
            )}
            {filteredCategoryProducts.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  제품 라인 {productListRangeStart}–{productListRangeEnd} / 전체{' '}
                  {filteredCategoryProducts.length}건 (페이지당 {PRODUCT_LIST_PAGE_SIZE}건)
                  {productListTotalPages > 1 && (
                    <span className="text-gray-500">
                      {' '}
                      · {productListEffectivePage}/{productListTotalPages} 페이지
                    </span>
                  )}
                </p>
                {productListTotalPages > 1 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setProductListPage((p) => Math.max(1, p - 1))}
                      disabled={productListEffectivePage <= 1}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      이전
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setProductListPage((p) => Math.min(productListTotalPages, p + 1))
                      }
                      disabled={productListEffectivePage >= productListTotalPages}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      다음
                    </button>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>

      {inboundModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {inboundModal.mode === 'create' ? '입고 등록' : '입고 수량 수정'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {inboundModal.productName} / {inboundModal.itemCode}
              </p>
            </div>
            <div className="px-5 py-4">
              {modalTargetItem?.variants && modalTargetItem.variants.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="inboundVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="inboundVariantCode"
                    value={inboundModal.variantCode}
                    onChange={(e) =>
                      setInboundModal((prev) => ({
                        ...prev,
                        variantCode: e.target.value,
                      }))
                    }
                    disabled={inboundModal.mode === 'edit'}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {modalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="inboundQuantity">
                입고 수량
              </label>
              <input
                id="inboundQuantity"
                type="number"
                min={inboundModal.mode === 'edit' ? 0 : 1}
                step={1}
                value={inboundModal.quantityInput}
                onChange={(e) =>
                  setInboundModal((prev) => ({
                    ...prev,
                    quantityInput: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="수량을 입력하세요"
              />
              {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeInboundModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveInbound}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {outboundModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {outboundModal.mode === 'create' ? '출고 등록' : '출고 수량 수정'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {outboundModal.productName} / {outboundModal.itemCode}
              </p>
            </div>
            <div className="px-5 py-4">
              {outboundModalTargetItem?.variants && outboundModalTargetItem.variants.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="outboundVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="outboundVariantCode"
                    value={outboundModal.variantCode}
                    onChange={(e) =>
                      setOutboundModal((prev) => ({
                        ...prev,
                        variantCode: e.target.value,
                      }))
                    }
                    disabled={outboundModal.mode === 'edit'}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {outboundModalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="outboundQuantity">
                출고 수량
              </label>
              <input
                id="outboundQuantity"
                type="number"
                min={outboundModal.mode === 'edit' ? 0 : 1}
                step={1}
                value={outboundModal.quantityInput}
                onChange={(e) =>
                  setOutboundModal((prev) => ({
                    ...prev,
                    quantityInput: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                placeholder="수량을 입력하세요"
              />
              {outboundFormError && <p className="mt-2 text-sm text-red-600">{outboundFormError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeOutboundModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveOutbound}
                className="rounded-md border border-red-600 bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustmentModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">재고조정</h3>
              <p className="mt-1 text-sm text-gray-600">
                {adjustmentModal.productName} / {adjustmentModal.itemCode}
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {adjustmentModalTargetItem?.variants && adjustmentModalTargetItem.variants.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="adjustmentVariantCode"
                    value={adjustmentModal.variantCode}
                    onChange={(e) =>
                      setAdjustmentModal((prev) => {
                        const selectedVariant = adjustmentModalTargetItem.variants?.find(
                          (variant) => variant.code === e.target.value
                        );
                        return {
                          ...prev,
                          variantCode: e.target.value,
                          actualStockInput: selectedVariant
                            ? String(selectedVariant.currentStock)
                            : prev.actualStockInput,
                        };
                      })
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  >
                    {adjustmentModalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code} (현재 {variant.currentStock} {variant.unit})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentActualStock">
                  실물 재고
                </label>
                <input
                  id="adjustmentActualStock"
                  type="number"
                  min={0}
                  step={1}
                  value={adjustmentModal.actualStockInput}
                  onChange={(e) =>
                    setAdjustmentModal((prev) => ({
                      ...prev,
                      actualStockInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="실물 재고를 입력하세요"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentReason">
                  조정 사유
                </label>
                <input
                  id="adjustmentReason"
                  type="text"
                  value={adjustmentModal.reasonInput}
                  onChange={(e) =>
                    setAdjustmentModal((prev) => ({
                      ...prev,
                      reasonInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="예: 실사 차이 보정"
                />
              </div>
              {adjustmentFormError && (
                <p className="text-sm text-red-600">{adjustmentFormError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeAdjustmentModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveAdjustment}
                className="rounded-md border border-amber-600 bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {productionPlanModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {productionPlanModal.mode === 'create' ? '생산계획 등록' : '생산계획 수정'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {productionPlanModal.productName} / {productionPlanModal.itemCode}
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {productionPlanModalTargetItem?.variants && productionPlanModalTargetItem.variants.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="productionVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="productionVariantCode"
                    value={productionPlanModal.variantCode}
                    onChange={(e) =>
                      setProductionPlanModal((prev) => ({
                        ...prev,
                        variantCode: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
                  >
                    {productionPlanModalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="productionPlannedQuantity">
                  계획 수량
                </label>
                <input
                  id="productionPlannedQuantity"
                  type="number"
                  min={productionPlanModal.mode === 'edit' ? 0 : 1}
                  step={1}
                  value={productionPlanModal.plannedQuantityInput}
                  onChange={(e) =>
                    setProductionPlanModal((prev) => ({
                      ...prev,
                      plannedQuantityInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
                  placeholder="계획 수량을 입력하세요"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="productionDueDate">
                  생산완료일
                </label>
                <input
                  id="productionDueDate"
                  type="date"
                  value={productionPlanModal.dueDateInput}
                  onChange={(e) =>
                    setProductionPlanModal((prev) => ({
                      ...prev,
                      dueDateInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="productionNote">
                  비고
                </label>
                <input
                  id="productionNote"
                  type="text"
                  value={productionPlanModal.noteInput}
                  onChange={(e) =>
                    setProductionPlanModal((prev) => ({
                      ...prev,
                      noteInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
                  placeholder="필요 시 비고를 입력하세요"
                />
              </div>
              {productionPlanFormError && (
                <p className="text-sm text-red-600">{productionPlanFormError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeProductionPlanModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveProductionPlan}
                className="rounded-md border border-purple-600 bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {historyViewModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="shrink-0 border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">전체 이력</h3>
              <p className="mt-1 text-sm text-gray-600">
                {historyViewModal.productName} / {historyViewModal.itemCode}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                입고·출고·재고조정·생산계획을 시간순으로 조회합니다. (조회 전용) 한 페이지에 최대{' '}
                {HISTORY_PAGE_SIZE}건이며, 하단에서 페이지를 넘겨 전체를 볼 수 있습니다.
              </p>
            </div>
            <div className="min-h-0 flex-1 px-5 py-4">
              {pagedHistoryViewRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                  등록된 이력이 없습니다.
                </p>
              ) : (
                <div className="max-h-[min(50vh,26rem)] overflow-auto rounded-md border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="sticky top-0 z-[1] bg-gray-50 text-gray-700 shadow-[0_1px_0_0_rgb(229_231_235)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">일시</th>
                        <th className="px-3 py-2 text-left font-semibold">구분</th>
                        <th className="px-3 py-2 text-left font-semibold">세부코드</th>
                        <th className="px-3 py-2 text-left font-semibold">생산완료일</th>
                        <th className="px-3 py-2 text-right font-semibold">수량</th>
                        <th className="px-3 py-2 text-left font-semibold min-w-[140px]">비고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {pagedHistoryViewRows.map((row) => (
                        <tr key={`view-${row.kind}-${row.id}`}>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {new Date(row.createdAt).toLocaleString('ko-KR')}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                                row.kind === 'inbound'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : row.kind === 'outbound'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : row.kind === 'adjustment'
                                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                                      : 'border-purple-200 bg-purple-50 text-purple-700'
                              }`}
                            >
                              {row.kind === 'inbound'
                                ? '입고'
                                : row.kind === 'outbound'
                                  ? '출고'
                                  : row.kind === 'adjustment'
                                    ? '조정'
                                    : '생산계획'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{row.variantCode || '-'}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {row.kind === 'production' ? row.dueDate : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">
                            {row.kind === 'adjustment' && row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                          </td>
                          <td className="px-3 py-2 text-gray-600 text-xs max-w-xs break-words">
                            {combinedHistoryRowMemo(row)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-4">
              <div className="text-sm text-gray-600">
                총 {combinedHistoryViewRows.length}건 / {historyViewCurrentPage} / {historyViewTotalPages} 페이지
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setHistoryViewModal((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={historyViewCurrentPage <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryViewModal((prev) => ({
                      ...prev,
                      page: Math.min(historyViewTotalPages, prev.page + 1),
                    }))
                  }
                  disabled={historyViewCurrentPage >= historyViewTotalPages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  다음
                </button>
                <button
                  type="button"
                  onClick={closeHistoryViewModal}
                  className="ml-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="shrink-0 border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">이력 수정</h3>
              <p className="mt-1 text-sm text-gray-600">
                {historyModal.productName} / {historyModal.itemCode}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                입고·출고·생산계획 행만 「수정」할 수 있습니다. 전체 목록은 「전체 이력」에서 보세요. (페이지당 최대{' '}
                {HISTORY_PAGE_SIZE}건)
              </p>
            </div>
            <div className="min-h-0 flex-1 px-5 py-4">
              {pagedHistoryRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                  등록된 이력이 없습니다.
                </p>
              ) : (
                <div className="max-h-[min(50vh,26rem)] overflow-auto rounded-md border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="sticky top-0 z-[1] bg-gray-50 text-gray-700 shadow-[0_1px_0_0_rgb(229_231_235)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">일시</th>
                        <th className="px-3 py-2 text-left font-semibold">구분</th>
                        <th className="px-3 py-2 text-left font-semibold">세부코드</th>
                        <th className="px-3 py-2 text-left font-semibold">생산완료일</th>
                        <th className="px-3 py-2 text-right font-semibold">수량</th>
                        <th className="px-3 py-2 text-center font-semibold">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {pagedHistoryRows.map((row) => (
                        <tr key={`${row.kind}-${row.id}`}>
                          <td className="px-3 py-2 text-gray-700">
                            {new Date(row.createdAt).toLocaleString('ko-KR')}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                                row.kind === 'inbound'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : row.kind === 'outbound'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : row.kind === 'adjustment'
                                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                                      : 'border-purple-200 bg-purple-50 text-purple-700'
                              }`}
                            >
                              {row.kind === 'inbound'
                                ? '입고'
                                : row.kind === 'outbound'
                                  ? '출고'
                                  : row.kind === 'adjustment'
                                    ? '조정'
                                    : '생산계획'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{row.variantCode || '-'}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {row.kind === 'production' ? row.dueDate : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">
                            {row.kind === 'adjustment' && row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.kind === 'adjustment' ? (
                              <span className="text-xs text-gray-400">-</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.kind === 'inbound') {
                                    openInboundEditModal(
                                      historyModal.productName,
                                      historyModal.itemCode,
                                      row.raw as InboundHistory
                                    );
                                  } else if (row.kind === 'outbound') {
                                    openOutboundEditModal(
                                      historyModal.productName,
                                      historyModal.itemCode,
                                      row.raw as OutboundHistory
                                    );
                                  } else if (row.kind === 'production') {
                                    openProductionPlanEditModal(
                                      historyModal.productName,
                                      historyModal.itemCode,
                                      row.raw as ProductionPlanHistory
                                    );
                                  }
                                  closeHistoryModal();
                                }}
                                className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                              >
                                수정
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-4">
              <div className="text-sm text-gray-600">
                총 {combinedHistoryRows.length}건 / {historyCurrentPage} / {historyTotalPages} 페이지
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setHistoryModal((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={historyCurrentPage <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryModal((prev) => ({
                      ...prev,
                      page: Math.min(historyTotalPages, prev.page + 1),
                    }))
                  }
                  disabled={historyCurrentPage >= historyTotalPages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  다음
                </button>
                <button
                  type="button"
                  onClick={closeHistoryModal}
                  className="ml-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {structureItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">품목 추가</h3>
              <p className="mt-1 text-sm text-gray-600">{structureItemModal.productName}</p>
              <p className="mt-1 text-xs text-gray-500">
                품목 코드 기준으로 SL-BA, SL-EP 등 6종 세부 variant가 자동 생성됩니다.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="structItemCode">
                  품목 코드
                </label>
                <input
                  id="structItemCode"
                  value={structureItemModal.codeInput}
                  onChange={(e) =>
                    setStructureItemModal((prev) =>
                      prev ? { ...prev, codeInput: e.target.value } : null
                    )
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="예: HME-14"
                />
              </div>
              {structureItemFormError && (
                <p className="text-sm font-medium text-red-600">{structureItemFormError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeStructureItemModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveStructureItem}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

