"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { db, storage } from "@/lib/firebase";
import {
  INITIAL_METAL_FACE_SEAL_PRODUCTS,
  INITIAL_MICRO_WELD_PRODUCTS,
  INITIAL_TUBE_BUTT_WELD_PRODUCTS,
  INVENTORY_SEED_VERSION,
} from "@/lib/inventory/microWeldSeed";
import { persistUhpInventoryState } from "@/lib/inventory/persistUhp";
import type { InventoryProduct, UhpInventoryState } from "@/lib/inventory/types";
import {
  UHP_CATEGORY_TABS,
  UHP_STATE_KEYS,
  type UhpCategoryId,
} from "@/lib/inventory/uhpInventoryHelpers";
import {
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

export default function AdminInventoryProductsPage() {
  const [activeCategoryId, setActiveCategoryId] = useState<UhpCategoryId>("microWeld");
  const [uhpInventory, setUhpInventory] = useState<UhpInventoryState>(() => ({
    products: [...INITIAL_MICRO_WELD_PRODUCTS],
    tubeButtWeldProducts: [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
    metalFaceSealProducts: [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
  }));
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

  const applyInventoryDocument = useCallback(async (snapshot: DocumentSnapshot) => {
    const inventoryRef = doc(db, "inventory", "microWeldProducts");
    const reseedPayload = {
      products: INITIAL_MICRO_WELD_PRODUCTS,
      tubeButtWeldProducts: INITIAL_TUBE_BUTT_WELD_PRODUCTS,
      metalFaceSealProducts: INITIAL_METAL_FACE_SEAL_PRODUCTS,
      inventorySeedVersion: INVENTORY_SEED_VERSION,
      updatedAt: Timestamp.now(),
    };

    if (!snapshot.exists()) {
      try {
        await setDoc(inventoryRef, reseedPayload);
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
          inventorySeedVersion?: number;
        }
      | undefined;
    const needReseed = data?.inventorySeedVersion !== INVENTORY_SEED_VERSION;
    if (needReseed) {
      try {
        await setDoc(inventoryRef, reseedPayload, { merge: true });
      } catch (error) {
        console.error("재고 시드 재적용 오류:", error);
        setListenError("재고 시드 재적용에 실패했습니다.");
      }
      return;
    }

    setUhpInventory({
      products: Array.isArray(data?.products) ? data.products : [...INITIAL_MICRO_WELD_PRODUCTS],
      tubeButtWeldProducts: Array.isArray(data?.tubeButtWeldProducts)
        ? data.tubeButtWeldProducts
        : [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
      metalFaceSealProducts: Array.isArray(data?.metalFaceSealProducts)
        ? data.metalFaceSealProducts
        : [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
    });
    setListenError("");
  }, []);

  useEffect(() => {
    const inventoryRef = doc(db, "inventory", "microWeldProducts");
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        void applyInventoryDocument(snapshot);
      },
      (error) => {
        console.error("재고 데이터 동기화 오류:", error);
        setListenError("재고 데이터 동기화에 실패했습니다.");
      }
    );
    return () => unsubscribe();
  }, [applyInventoryDocument]);

  const categoryKey = UHP_STATE_KEYS[activeCategoryId];
  /** Firestore 배열 순서 = 제품등록·재고현황 표시 순서 (위/아래 버튼으로 변경) */
  const categoryProducts = uhpInventory[categoryKey];

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
    setProductImageInput("/inventory/micro-elbow-hme.png");
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
    const imageSrc = productImageInput.trim() || "/inventory/micro-elbow-hme.png";
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

    const next = cloneUhp(uhpInventory);
    const slice = [...next[categoryKey]];

    if (productModalMode === "add") {
      slice.push({ name, imageSrc, items: [] });
    } else if (productModalIndex !== null) {
      const prev = slice[productModalIndex];
      if (!prev) return;
      slice[productModalIndex] = { ...prev, name, imageSrc };
    }
    next[categoryKey] = slice;
    setProductModalOpen(false);
    setSaveError("");
    await persistState(next);
  };

  const moveProductLine = async (index: number, delta: -1 | 1) => {
    const slice = [...uhpInventory[categoryKey]];
    const j = index + delta;
    if (j < 0 || j >= slice.length) return;
    const next = cloneUhp(uhpInventory);
    const reordered = [...slice];
    [reordered[index], reordered[j]] = [reordered[j], reordered[index]];
    next[categoryKey] = reordered;
    await persistState(next);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const next = cloneUhp(uhpInventory);
    const slice = [...next[categoryKey]];
    next[categoryKey] = slice.filter((p) => p.name !== deleteTarget.productName);
    setDeleteTarget(null);
    setSaveError("");
    await persistState(next);
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">UHP 제품등록</h1>
          <p className="text-gray-600 mt-2">
            <strong>제품 라인(시리즈)</strong>의 이름과 이미지(파일 업로드 또는 URL·경로)만 이 메뉴에서 등록·수정·삭제합니다.
            저장 시 Firestore에 반영되며 <strong>UHP 재고현황</strong>과 같은 목록을 공유합니다.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            <span className="font-medium text-gray-800">품목 코드·안전재고·재고 수량·입출고·생산계획·이력</span> →{" "}
            <Link
              href="/admin/inventory/status"
              className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
            >
              UHP 재고현황
            </Link>
          </p>
          {listenError && (
            <p className="mt-2 text-sm font-medium text-red-600">{listenError}</p>
          )}
          {saveError && !productModalOpen && (
            <p className="mt-2 text-sm font-medium text-red-600">{saveError}</p>
          )}
          {saving && <p className="mt-2 text-sm text-blue-600">저장 중…</p>}
        </div>
        <Link
          href="/admin/inventory/status"
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
        >
          UHP 재고현황
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">카테고리</h2>
        <div className="flex flex-wrap gap-2 mb-6">
          {UHP_CATEGORY_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveCategoryId(id)}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                activeCategoryId === id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-sm text-gray-600">
            <p>
              등록된 제품 라인 <span className="font-semibold text-gray-900">{categoryProducts.length}</span>개
            </p>
            <p className="mt-1 text-xs text-gray-500">
              표시 순서는 「위로」「아래로」로 바꿀 수 있으며 재고현황과 동일하게 저장됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddProduct}
            disabled={saving}
            className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            제품 라인 추가
          </button>
        </div>

        <div className="space-y-6">
          {categoryProducts.map((product, pi) => (
            <div key={product.name} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-4 min-w-0">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
                    <img
                      src={product.imageSrc}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">{product.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 break-all">{product.imageSrc}</p>
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

              <p className="mt-4 rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600">
                품목 코드·안전재고·세부 variant(6종)는{" "}
                <Link
                  href="/admin/inventory/status"
                  className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                >
                  UHP 재고현황
                </Link>
                에서 이 제품 카드의 「품목 추가」로 등록합니다. (현재 연결된 품목{" "}
                <span className="font-semibold text-gray-800">{product.items.length}</span>개)
              </p>
            </div>
          ))}

          {categoryProducts.length === 0 && (
            <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              이 카테고리에 등록된 제품 라인이 없습니다. 「제품 라인 추가」를 눌러 주세요.
            </p>
          )}
        </div>
      </div>

      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {productModalMode === "add" ? "제품 라인 추가" : "제품 라인 수정"}
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
