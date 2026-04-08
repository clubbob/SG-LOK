"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { db, storage } from "@/lib/firebase";
import {
  INITIAL_METAL_FACE_SEAL_PRODUCTS,
  INITIAL_MICRO_WELD_PRODUCTS,
  INITIAL_TUBE_BUTT_WELD_PRODUCTS,
  INITIAL_UHP_INVENTORY_STATE,
  INVENTORY_SEED_VERSION,
  mergeLegacyLongElbowIntoTubeButtWeld,
  mergeMissingHmcItemsFromSeed,
  mergeMissingHmtbItemsFromSeed,
  mergeMissingHmrtItemsFromSeed,
  reconcileCategoryWithSeedCatalog,
  reconcileUhpInventoryWithSeedCatalog,
  stripHle02ItemFromLongElbowLine,
} from "@/lib/inventory/microWeldSeed";
import { dropRemovedDefaultCategoryProducts, persistUhpInventoryState } from "@/lib/inventory/persistUhp";
import type { InventoryProduct, UhpInventoryState } from "@/lib/inventory/types";
import {
  attachTabsToUhpState,
  findTabById,
  getTabSliceProducts,
  isCustomTab,
  newCustomCategoryId,
  setTabSliceProducts,
} from "@/lib/inventory/uhpInventoryHelpers";
import {
  deleteField,
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
  type DocumentSnapshot,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

function cloneUhp(state: UhpInventoryState): UhpInventoryState {
  return JSON.parse(JSON.stringify(state)) as UhpInventoryState;
}

function normalizeLineName(name: string): string {
  return name.trim().toLowerCase();
}

function collectImageByLineName(lines: InventoryProduct[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const image = (line.imageSrc ?? "").trim();
    if (!image) continue;
    const key = normalizeLineName(line.name);
    if (!out.has(key)) out.set(key, image);
  }
  return out;
}

function applyPreservedImages(lines: InventoryProduct[], imageMap: Map<string, string>): InventoryProduct[] {
  return lines.map((line) => {
    const preserved = imageMap.get(normalizeLineName(line.name));
    if (!preserved) return line;
    if ((line.imageSrc ?? "").trim() === preserved) return line;
    return { ...line, imageSrc: preserved };
  });
}

export default function AdminInventoryProductsPage() {
  const [activeTabId, setActiveTabId] = useState("microWeld");
  const [searchQuery, setSearchQuery] = useState("");
  const [uhpInventory, setUhpInventory] = useState<UhpInventoryState>(
    () => JSON.parse(JSON.stringify(INITIAL_UHP_INVENTORY_STATE)) as UhpInventoryState
  );
  const [listenError, setListenError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const productImageFileRef = useRef<HTMLInputElement>(null);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productModalMode, setProductModalMode] = useState<"add" | "edit">("add");
  const [productModalIndex, setProductModalIndex] = useState<number | null>(null);
  const [productNameInput, setProductNameInput] = useState("");
  const [productImageInput, setProductImageInput] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<{ productName: string } | null>(null);
  const PRODUCT_LIST_PAGE_SIZE = 10;
  const [productListPage, setProductListPage] = useState(1);

  const applyInventoryDocument = useCallback(async (
    snapshot: DocumentSnapshot,
    allowAutoPersist: boolean = false
  ) => {
    const inventoryRef = doc(db, "inventory", "microWeldProducts");
    const reseedPayload = {
      products: INITIAL_MICRO_WELD_PRODUCTS,
      tubeButtWeldProducts: INITIAL_TUBE_BUTT_WELD_PRODUCTS,
      metalFaceSealProducts: INITIAL_METAL_FACE_SEAL_PRODUCTS,
      longElbowProducts: deleteField(),
      vcrToVcrProducts: deleteField(),
      inventorySeedVersion: INVENTORY_SEED_VERSION,
      updatedAt: Timestamp.now(),
    };

    if (!snapshot.exists()) {
      try {
        if (allowAutoPersist) {
          await setDoc(inventoryRef, reseedPayload);
        }
      } catch (error) {
        console.error("재고 초기 데이터 저장 오류:", error);
        setListenError("재고 초기 데이터 저장에 실패했습니다.");
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
          uhpCategoryTabs?: unknown;
          customCategoryProducts?: unknown;
        }
      | undefined;
    const microImageMap = collectImageByLineName(
      Array.isArray(data?.products) ? data.products : undefined
    );
    const tubeImageMap = collectImageByLineName(
      Array.isArray(data?.tubeButtWeldProducts) ? data.tubeButtWeldProducts : undefined
    );
    const metalImageMap = collectImageByLineName(
      Array.isArray(data?.metalFaceSealProducts) ? data.metalFaceSealProducts : undefined
    );
    const raw = snapshot.data() as Record<string, unknown> | undefined;
    const hasLegacyLongElbowField =
      raw != null && Object.prototype.hasOwnProperty.call(raw, "longElbowProducts");
    const needReseed = data?.inventorySeedVersion !== INVENTORY_SEED_VERSION;
    if (needReseed) {
      const existingProducts = Array.isArray(data?.products) ? data.products : [];
      const tubeBaseReseed = Array.isArray(data?.tubeButtWeldProducts)
        ? data.tubeButtWeldProducts
        : [];
      const existingMetalReseed = Array.isArray(data?.metalFaceSealProducts)
        ? data.metalFaceSealProducts
        : [];
      const elbowForReseed = mergeLegacyLongElbowIntoTubeButtWeld(
        tubeBaseReseed,
        Array.isArray(data?.longElbowProducts) ? data.longElbowProducts : undefined
      );
      const tubeStrippedReseed = stripHle02ItemFromLongElbowLine(elbowForReseed.next);
      const tubeForReseed = reconcileCategoryWithSeedCatalog(
        tubeStrippedReseed.next,
        INITIAL_TUBE_BUTT_WELD_PRODUCTS,
        { fillMissingSeedLines: true, fillMissingSeedItemCodes: true }
      );
      const metalForReseed = reconcileCategoryWithSeedCatalog(
        existingMetalReseed,
        INITIAL_METAL_FACE_SEAL_PRODUCTS,
        { fillMissingSeedLines: true, fillMissingSeedItemCodes: true }
      );
      const productsForReseed = reconcileCategoryWithSeedCatalog(
        existingProducts,
        INITIAL_MICRO_WELD_PRODUCTS,
        { fillMissingSeedLines: true, fillMissingSeedItemCodes: true }
      );
      const reseedPreview: UhpInventoryState = attachTabsToUhpState(
        {
          products: productsForReseed.next,
          tubeButtWeldProducts: tubeForReseed.next,
          metalFaceSealProducts: metalForReseed.next,
        },
        data
      );
      const reseedPreviewWithImages: UhpInventoryState = {
        ...reseedPreview,
        products: applyPreservedImages(reseedPreview.products, microImageMap),
        tubeButtWeldProducts: applyPreservedImages(reseedPreview.tubeButtWeldProducts, tubeImageMap),
        metalFaceSealProducts: applyPreservedImages(reseedPreview.metalFaceSealProducts, metalImageMap),
      };
      setUhpInventory(reseedPreviewWithImages);
      if (allowAutoPersist) {
        try {
          await setDoc(
            inventoryRef,
            {
              products: reseedPreviewWithImages.products,
              tubeButtWeldProducts: reseedPreviewWithImages.tubeButtWeldProducts,
              metalFaceSealProducts: reseedPreviewWithImages.metalFaceSealProducts,
              longElbowProducts: deleteField(),
              vcrToVcrProducts: deleteField(),
              inventorySeedVersion: INVENTORY_SEED_VERSION,
              updatedAt: Timestamp.now(),
            },
            { merge: true }
          );
        } catch (error) {
          console.error("재고 시드 재적용 오류:", error);
          setListenError("재고 시드 재적용에 실패했습니다.");
        }
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
    const merged: UhpInventoryState = attachTabsToUhpState(
      {
        products: Array.isArray(data?.products)
          ? data.products
          : [...INITIAL_MICRO_WELD_PRODUCTS],
        tubeButtWeldProducts: hle02Strip.next,
        metalFaceSealProducts: Array.isArray(data?.metalFaceSealProducts)
          ? data.metalFaceSealProducts
          : [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
      },
      data
    );
    let catalogProducts = merged.products;
    const hmrtResult = mergeMissingHmrtItemsFromSeed(catalogProducts);
    catalogProducts = hmrtResult.next;
    const hmtbResult = mergeMissingHmtbItemsFromSeed(catalogProducts);
    catalogProducts = hmtbResult.next;
    const hmcResult = mergeMissingHmcItemsFromSeed(catalogProducts);
    catalogProducts = hmcResult.next;
    const catalogItemsMerged = hmrtResult.changed || hmtbResult.changed || hmcResult.changed;
    const mergedWithCatalog: UhpInventoryState = { ...merged, products: catalogProducts };
    const { next: afterDrop, shouldPersistSlice } =
      dropRemovedDefaultCategoryProducts(mergedWithCatalog);
    const reconciled = reconcileUhpInventoryWithSeedCatalog(afterDrop);
    const nextRaw = reconciled.changed ? reconciled.next : afterDrop;
    const next: UhpInventoryState = {
      ...nextRaw,
      products: applyPreservedImages(nextRaw.products, microImageMap),
      tubeButtWeldProducts: applyPreservedImages(nextRaw.tubeButtWeldProducts, tubeImageMap),
      metalFaceSealProducts: applyPreservedImages(nextRaw.metalFaceSealProducts, metalImageMap),
    };
    const shouldPersistLegacyLongElbowMerge =
      elbowMerge.changed ||
      Boolean(hasLegacyLongElbowField) ||
      hle02Strip.changed;
    if (allowAutoPersist && shouldPersistLegacyLongElbowMerge) {
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
        console.error("Long Elbow(Tube) 마이그레이션 저장 오류:", error);
      }
    }
    if (allowAutoPersist && catalogItemsMerged) {
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
        console.error("Micro Weld 도면 품목 보강 저장 오류:", error);
      }
    }
    if (allowAutoPersist && shouldPersistSlice) {
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
        console.error("레거시 TBW/MFS 제품 라인 정리 저장 오류:", error);
      }
    }
    if (allowAutoPersist && reconciled.changed) {
      try {
        await setDoc(
          inventoryRef,
          {
            products: next.products,
            tubeButtWeldProducts: next.tubeButtWeldProducts,
            metalFaceSealProducts: next.metalFaceSealProducts,
            vcrToVcrProducts: deleteField(),
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error("UHP 카탈로그 정규화 저장 오류:", error);
      }
    }
    setUhpInventory(next);
    setListenError("");
  }, []);

  useEffect(() => {
    const inventoryRef = doc(db, "inventory", "microWeldProducts");
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        void applyInventoryDocument(snapshot, true);
      },
      (error) => {
        console.error("재고 데이터 동기화 오류:", error);
        setListenError("재고 데이터 동기화에 실패했습니다.");
      }
    );
    return () => unsubscribe();
  }, [applyInventoryDocument]);

  useEffect(() => {
    if (!uhpInventory.categoryTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(uhpInventory.categoryTabs[0]?.id ?? "microWeld");
    }
  }, [uhpInventory.categoryTabs, activeTabId]);

  useEffect(() => {
    setProductListPage(1);
  }, [activeTabId, searchQuery]);

  const activeTab = findTabById(uhpInventory, activeTabId);
  /** Firestore 배열 순서 = 제품등록·재고현황 표시 순서 (위/아래 버튼으로 변경) */
  const categoryProducts = activeTab ? getTabSliceProducts(uhpInventory, activeTab) : [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredCategoryProducts = normalizedSearchQuery
    ? categoryProducts.filter((product) => product.name.toLowerCase().includes(normalizedSearchQuery))
    : categoryProducts;

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

  const persistState = async (next: UhpInventoryState) => {
    setSaving(true);
    setSaveError("");
    try {
      await persistUhpInventoryState(next);
      setUhpInventory(next);
    } catch (error) {
      console.error("UHP 제품 저장 오류:", error);
      setSaveError("저장에 실패했습니다. 네트워크와 권한을 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const openAddProduct = () => {
    setProductModalMode("add");
    setProductModalIndex(null);
    setProductNameInput("");
    setProductImageInput("");
    setSaveError("");
    if (productImageFileRef.current) productImageFileRef.current.value = "";
    setProductModalOpen(true);
  };

  const openEditProduct = (index: number) => {
    const p = categoryProducts[index];
    if (!p) return;
    setProductModalMode("edit");
    setProductModalIndex(index);
    setProductNameInput(p.name);
    setProductImageInput(p.imageSrc);
    setSaveError("");
    if (productImageFileRef.current) productImageFileRef.current.value = "";
    setProductModalOpen(true);
  };

  const handleProductImageFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSaveError("이미지 파일(jpg, png, webp 등)만 올릴 수 있습니다.");
      return;
    }
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      setSaveError("이미지는 8MB 이하만 업로드할 수 있습니다.");
      return;
    }
    setSaveError("");
    setImageUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `inventory/product-images/${Date.now()}_${safe}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setProductImageInput(url);
    } catch (err) {
      console.error("제품 이미지 업로드 오류:", err);
      setSaveError("이미지 업로드에 실패했습니다. Storage 권한·용량을 확인해 주세요.");
    } finally {
      setImageUploading(false);
      if (productImageFileRef.current) productImageFileRef.current.value = "";
    }
  };

  const saveProductModal = async () => {
    const name = productNameInput.trim();
    const imageSrc = productImageInput.trim();
    if (!name) {
      setSaveError("제품명을 입력해 주세요.");
      return;
    }
    const dup = categoryProducts.some(
      (p, i) => p.name === name && (productModalMode === "add" || i !== productModalIndex)
    );
    if (dup) {
      setSaveError("같은 카테고리에 동일한 제품명이 이미 있습니다.");
      return;
    }

    const tab = findTabById(uhpInventory, activeTabId);
    if (!tab) return;
    const next = cloneUhp(uhpInventory);
    const slice = [...getTabSliceProducts(next, tab)];

    if (productModalMode === "add") {
      slice.push({ name, imageSrc, items: [] });
      const nextPage = Math.max(1, Math.ceil(slice.length / PRODUCT_LIST_PAGE_SIZE));
      setSearchQuery("");
      setProductListPage(nextPage);
    } else if (productModalIndex !== null) {
      const prev = slice[productModalIndex];
      if (!prev) return;
      slice[productModalIndex] = { ...prev, name, imageSrc };
    }
    const updated = setTabSliceProducts(next, tab, slice);
    setProductModalOpen(false);
    setSaveError("");
    await persistState(updated);
  };

  const moveProductLine = async (index: number, delta: -1 | 1) => {
    const tab = findTabById(uhpInventory, activeTabId);
    if (!tab) return;
    const slice = [...getTabSliceProducts(uhpInventory, tab)];
    const j = index + delta;
    if (j < 0 || j >= slice.length) return;
    const next = cloneUhp(uhpInventory);
    const reordered = [...slice];
    [reordered[index], reordered[j]] = [reordered[j], reordered[index]];
    const updated = setTabSliceProducts(next, tab, reordered);
    await persistState(updated);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const tab = findTabById(uhpInventory, activeTabId);
    if (!tab) return;
    const next = cloneUhp(uhpInventory);
    const slice = [...getTabSliceProducts(next, tab)].filter((p) => p.name !== deleteTarget.productName);
    const updated = setTabSliceProducts(next, tab, slice);
    setDeleteTarget(null);
    setSaveError("");
    await persistState(updated);
  };

  const handleAddCategoryProducts = () => {
    const label = prompt("새 카테고리 이름을 입력해 주세요.")?.trim();
    if (!label) return;
    if (uhpInventory.categoryTabs.some((t) => t.label.trim().toLowerCase() === label.toLowerCase())) {
      setSaveError("같은 이름의 카테고리가 이미 있습니다.");
      return;
    }
    const customId = newCustomCategoryId();
    const newTab = { id: `tab_${customId}`, label, slice: { kind: "custom" as const, customId } };
    const next = cloneUhp(uhpInventory);
    next.categoryTabs = [...next.categoryTabs, newTab];
    next.customCategoryProducts = { ...next.customCategoryProducts, [customId]: [] };
    setSaveError("");
    void persistState(next);
    setActiveTabId(newTab.id);
  };

  const handleRenameCategoryProducts = (tabId: string) => {
    const tab = findTabById(uhpInventory, tabId);
    if (!tab) return;
    const nextLabel = prompt("카테고리 이름을 입력해 주세요.", tab.label)?.trim();
    if (!nextLabel || nextLabel === tab.label) return;
    if (
      uhpInventory.categoryTabs.some(
        (t) => t.id !== tabId && t.label.trim().toLowerCase() === nextLabel.toLowerCase()
      )
    ) {
      setSaveError("같은 이름의 카테고리가 이미 있습니다.");
      return;
    }
    const next = cloneUhp(uhpInventory);
    next.categoryTabs = next.categoryTabs.map((t) => (t.id === tabId ? { ...t, label: nextLabel } : t));
    setSaveError("");
    void persistState(next);
  };

  const handleDeleteCategoryProducts = (tabId: string) => {
    const tab = findTabById(uhpInventory, tabId);
    if (!tab || !isCustomTab(tab)) return;
    const lines = getTabSliceProducts(uhpInventory, tab);
    if (
      lines.length > 0 &&
      !confirm(
        `이 카테고리에 제품 라인이 ${lines.length}개 있습니다. 데이터가 함께 삭제됩니다. 계속할까요?`
      )
    ) {
      return;
    }
    if (!confirm("이 카테고리 탭을 삭제할까요?")) return;
    const next = cloneUhp(uhpInventory);
    next.categoryTabs = next.categoryTabs.filter((t) => t.id !== tabId);
    if (tab.slice.kind === "custom") {
      const { [tab.slice.customId]: _r, ...rest } = next.customCategoryProducts;
      next.customCategoryProducts = rest;
    }
    setSaveError("");
    void persistState(next);
    if (activeTabId === tabId) {
      setActiveTabId(next.categoryTabs[0]?.id ?? "microWeld");
    }
  };

  const moveCategoryTabProducts = (tabId: string, delta: number) => {
    const idx = uhpInventory.categoryTabs.findIndex((t) => t.id === tabId);
    const j = idx + delta;
    if (idx < 0 || j < 0 || j >= uhpInventory.categoryTabs.length) return;
    const next = cloneUhp(uhpInventory);
    const tabs = [...next.categoryTabs];
    [tabs[idx], tabs[j]] = [tabs[j]!, tabs[idx]!];
    next.categoryTabs = tabs;
    void persistState(next);
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">제품 이미지 등록</h1>
          <p className="text-gray-600 mt-2">
            <strong>제품 라인(시리즈)</strong>의 이름과 이미지(파일 업로드 또는 URL·경로)만 이 메뉴에서 등록·수정·삭제합니다.
          </p>
          {listenError && (
            <p className="mt-2 text-sm font-medium text-red-600">{listenError}</p>
          )}
          {saveError && !productModalOpen && (
            <p className="mt-2 text-sm font-medium text-red-600">{saveError}</p>
          )}
          {saving && <p className="mt-2 text-sm text-blue-600">저장 중…</p>}
        </div>
      </div>

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
            placeholder="제품명 검색"
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-2 my-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="검색어 지우기"
              title="검색어 지우기"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">제품 카테고리</h2>
          <button
            type="button"
            onClick={() => handleAddCategoryProducts()}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            + 카테고리 추가
          </button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {uhpInventory.categoryTabs.map((tab, tabIndex) => (
            <div
              key={tab.id}
              className={`inline-flex flex-wrap items-center gap-1 rounded-md border p-1 ${
                activeTabId === tab.id ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-gray-50"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                disabled={saving}
                className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                  activeTabId === tab.id ? "text-blue-800" : "text-gray-800 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
              <div className="flex items-center gap-0.5 border-l border-gray-200 pl-1">
                <button
                  type="button"
                  title="순서 앞으로"
                  disabled={saving || tabIndex === 0}
                  onClick={() => moveCategoryTabProducts(tab.id, -1)}
                  className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                >
                  ◀
                </button>
                <button
                  type="button"
                  title="순서 뒤로"
                  disabled={saving || tabIndex >= uhpInventory.categoryTabs.length - 1}
                  onClick={() => moveCategoryTabProducts(tab.id, 1)}
                  className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                >
                  ▶
                </button>
                <button
                  type="button"
                  title="이름 수정"
                  disabled={saving}
                  onClick={() => handleRenameCategoryProducts(tab.id)}
                  className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-200"
                >
                  ✎
                </button>
                {isCustomTab(tab) && (
                  <button
                    type="button"
                    title="카테고리 삭제"
                    disabled={saving}
                    onClick={() => handleDeleteCategoryProducts(tab.id)}
                    className="rounded px-1.5 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-sm text-gray-600">
            <p>
              등록된 제품 라인 <span className="font-semibold text-gray-900">{filteredCategoryProducts.length}</span>개
            </p>
          </div>
          <button
            type="button"
            onClick={openAddProduct}
            disabled={saving}
            className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            제품 추가
          </button>
        </div>

        <div className="space-y-6">
          {pagedCategoryProducts.map((product) => {
            const pi = categoryProducts.findIndex((line) => line.name === product.name);
            if (pi < 0) return null;
            return (
            <div key={product.name} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-4 min-w-0">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
                    {product.imageSrc?.trim() ? (
                      <img
                        src={product.imageSrc}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-medium text-gray-400">
                        제품 이미지 없음
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">{product.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 break-all">{product.imageSrc || '제품 이미지 없음'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => void moveProductLine(pi, -1)}
                      disabled={saving || pi === 0}
                      title="위로 이동"
                      aria-label="위로 이동"
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      위로
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveProductLine(pi, 1)}
                      disabled={saving || pi === categoryProducts.length - 1}
                      title="아래로 이동"
                      aria-label="아래로 이동"
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      아래로
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditProduct(pi)}
                    disabled={saving}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ productName: product.name })}
                    disabled={saving}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
            );
          })}

          {filteredCategoryProducts.length === 0 && (
            <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              검색 결과가 없습니다.
            </p>
          )}
          {filteredCategoryProducts.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">
                제품 라인 {productListRangeStart}–{productListRangeEnd} / 전체{" "}
                {filteredCategoryProducts.length}건 (페이지당 {PRODUCT_LIST_PAGE_SIZE}건)
                {productListTotalPages > 1 && (
                  <span className="text-gray-500">
                    {" "}
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

                  {(() => {
                    const total = productListTotalPages;
                    const current = productListEffectivePage;
                    const maxButtons = 10;

                    const parts: Array<number | "ellipsis"> =
                      total <= maxButtons
                        ? Array.from({ length: total }, (_, i) => i + 1)
                        : (() => {
                            const left = Math.max(2, current - 2);
                            const right = Math.min(total - 1, current + 2);
                            const out: Array<number | "ellipsis"> = [];
                            out.push(1);
                            if (left > 2) out.push("ellipsis");
                            for (let p = left; p <= right; p++) out.push(p);
                            if (right < total - 1) out.push("ellipsis");
                            out.push(total);
                            return out;
                          })();

                    return parts.map((part, idx) => {
                      if (part === "ellipsis") {
                        return (
                          <span key={`ellipsis-${idx}`} className="select-none px-1 text-gray-400">
                            …
                          </span>
                        );
                      }

                      const pageNum = part;
                      const isActive = pageNum === current;
                      return (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => setProductListPage(pageNum)}
                          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                            isActive
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                          aria-current={isActive ? "page" : undefined}
                        >
                          {pageNum}
                        </button>
                      );
                    });
                  })()}

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

      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {productModalMode === "add" ? "제품 추가" : "제품 수정"}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                재고현황에 표시되는 제품명·이미지입니다. 파일을 올리면 Firebase Storage에 저장되고 주소가
                자동 입력됩니다.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {saveError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {saveError}
                </p>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="prodName">
                  제품명
                </label>
                <input
                  id="prodName"
                  value={productNameInput}
                  onChange={(e) => setProductNameInput(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="예: Micro Elbow (HME)"
                />
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium text-gray-700">이미지</span>
                <input
                  ref={productImageFileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  id="prodImgFile"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    void handleProductImageFile(f);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => productImageFileRef.current?.click()}
                    disabled={imageUploading || saving}
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {imageUploading ? "업로드 중…" : "파일에서 이미지 선택"}
                  </button>
                  {productImageInput.trim() && (
                    <div className="mt-2 w-full rounded-md border border-gray-200 bg-gray-50 p-2">
                      <p className="mb-1 text-xs text-gray-500">미리보기</p>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 외부 Storage URL·상대경로 혼용 */}
                      <img
                        src={productImageInput.trim()}
                        alt=""
                        className="mx-auto max-h-36 max-w-full object-contain"
                      />
                    </div>
                  )}
                </div>
                <label className="mb-1 mt-3 block text-sm font-medium text-gray-700" htmlFor="prodImg">
                  이미지 URL 또는 경로 (직접 입력)
                </label>
                <input
                  id="prodImg"
                  value={productImageInput}
                  onChange={(e) => setProductImageInput(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="업로드 시 자동 입력되거나, /inventory/... 또는 https://..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setProductModalOpen(false);
                  setSaveError("");
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveProductModal()}
                disabled={saving || imageUploading}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">삭제 확인</h3>
            <p className="mt-2 text-sm text-gray-600">
              이 제품 라인과 포함된 모든 품목·재고·이력 데이터가 목록에서 제거됩니다. 계속할까요?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={saving}
                className="rounded-md border border-red-600 bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
