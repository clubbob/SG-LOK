"use client";

import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type ScannerMode = "in" | "out" | "production";

type ErpInventoryDoc = {
  rows?: Array<Record<string, string>>;
};

type InventoryProduct = {
  id: string;
  code: string;
  name: string;
  spec: string;
  stock: string;
  familyKey: string;
  searchText: string;
};

type PendingAction = {
  at: number;
  mode: ScannerMode;
  quantity: number;
  note: string;
  product: InventoryProduct;
};

const ERP_INVENTORY_MASTER_DOC = "erpInventoryProducts";

const LIST_CAP_WITH_QUERY = 120;
const LIST_CAP_NO_QUERY = 50;

const MODE_LABELS: Record<ScannerMode, string> = {
  in: "입고",
  out: "출고",
  production: "생산",
};
const MODE_ACTIVE_CLASS: Record<ScannerMode, string> = {
  in: "bg-emerald-600 text-white ring-2 ring-emerald-300 shadow-sm",
  out: "bg-rose-600 text-white ring-2 ring-rose-300 shadow-sm",
  production: "bg-indigo-600 text-white ring-2 ring-indigo-300 shadow-sm",
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightMatch({ text, needle }: { text: string; needle: string }) {
  const q = needle.trim();
  if (!q) return <>{text}</>;
  try {
    const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
    const parts = text.split(re);
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

function readFirst(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function mapProducts(rows: Array<Record<string, string>>): InventoryProduct[] {
  return rows
    .map((row, index) => {
      const code = readFirst(row, ["품목코드", "제품코드", "itemCode", "code"]);
      const name = readFirst(row, ["품목명", "제품명", "itemName", "name"]);
      const spec = readFirst(row, ["규격정보", "규격", "spec", "size"]);
      const stock = readFirst(row, ["현재고", "재고", "currentStock", "stockQty"]);
      const id = `${code || "unknown"}-${index}`;
      const familySource = `${name} ${code}`.trim();
      const familyKey = familySource.split(/[\s\-_/]+/)[0]?.toLowerCase() ?? "";
      const searchText = `${code} ${name} ${spec}`.toLowerCase();
      return { id, code, name, spec, stock, familyKey, searchText };
    })
    .filter((product) => product.code || product.name);
}

function compareProducts(a: InventoryProduct, b: InventoryProduct) {
  const na = (a.name || "").localeCompare(b.name || "", "ko");
  if (na !== 0) return na;
  const sa = (a.spec || "").localeCompare(b.spec || "", "ko", { numeric: true });
  if (sa !== 0) return sa;
  return (a.code || "").localeCompare(b.code || "", "ko", { numeric: true });
}

export function InventoryScannerView({
  initialMode,
}: {
  initialMode?: ScannerMode;
}) {
  const [mode, setMode] = useState<ScannerMode | null>(initialMode ?? null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [products, setProducts] = useState<InventoryProduct[]>([]);

  const [query, setQuery] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [navIndex, setNavIndex] = useState(0);
  const [quantityInput, setQuantityInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [submitError, setSubmitError] = useState("");

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const displayedRowsRef = useRef<InventoryProduct[]>([]);
  const prevQueryRef = useRef<string | null>(null);

  useEffect(() => {
    setMode(initialMode ?? null);
  }, [initialMode]);

  useEffect(() => {
    const inventoryRef = doc(db, "inventory", ERP_INVENTORY_MASTER_DOC);
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setProducts([]);
          setLoading(false);
          setLoadError("ERP 제품 데이터가 없습니다. 관리자에서 먼저 제품등록을 진행해 주세요.");
          return;
        }
        const data = snapshot.data() as ErpInventoryDoc;
        const mapped = mapProducts(Array.isArray(data.rows) ? data.rows : []);
        setProducts(mapped);
        setLoading(false);
        setLoadError("");
      },
      (error) => {
        console.error("스캔용 제품 목록 조회 오류:", error);
        setLoading(false);
        setLoadError("제품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    );

    return () => unsubscribe();
  }, []);

  const { displayedRows, totalMatched, isTruncated, cap, subCodeHints } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let matched = [...products];
    if (terms.length > 0) {
      const [familyTerm, ...detailTerms] = terms;
      matched = matched.filter((product) => {
        const familyMatched =
          product.familyKey === familyTerm ||
          product.familyKey.startsWith(familyTerm) ||
          product.searchText.includes(familyTerm);
        if (!familyMatched) return false;
        if (detailTerms.length === 0) return true;
        return detailTerms.every((term) => product.searchText.includes(term));
      });
    }

    const beforeSubFilter = [...matched];
    const sub = subQuery.trim().toLowerCase();
    if (sub) {
      const normalizedSub = sub.replace(/\s+/g, "");
      matched = matched.filter((product) => {
        const specKey = product.spec.replace(/\s+/g, "").toLowerCase();
        const codeKey = product.code.replace(/\s+/g, "").toLowerCase();
        return specKey.startsWith(normalizedSub) || codeKey.startsWith(normalizedSub);
      });
    }

    const subCodeHints = Array.from(
      new Set(
        beforeSubFilter
          .map((product) => product.spec.trim())
          .filter(Boolean)
          .map((spec) => spec.split(/\s+/)[0])
      )
    )
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
      .slice(0, 18);

    matched.sort(compareProducts);
    const totalMatched = matched.length;
    const cap = q ? LIST_CAP_WITH_QUERY : LIST_CAP_NO_QUERY;
    const isTruncated = totalMatched > cap;
    matched = matched.slice(0, cap);

    return { displayedRows: matched, totalMatched, isTruncated, cap, subCodeHints };
  }, [products, query, subQuery]);

  const displayedRowCount = displayedRows.length;
  displayedRowsRef.current = displayedRows;
  const hasPrimaryQuery = query.trim().length > 0;

  useEffect(() => {
    const prevQ = prevQueryRef.current;
    prevQueryRef.current = query;
    if (prevQ !== null && prevQ !== query) {
      setNavIndex(0);
      setSubQuery("");
      return;
    }
    setNavIndex((i) => {
      if (displayedRowCount === 0) return 0;
      return Math.min(Math.max(0, i), displayedRowCount - 1);
    });
  }, [query, displayedRowCount]);

  useEffect(() => {
    const row = rowRefs.current[navIndex];
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [navIndex, displayedRowCount]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const onSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    const rows = displayedRowsRef.current;
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setNavIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setNavIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const row = rows[navIndex];
      if (row) {
        e.preventDefault();
        setSelectedProductId(row.id);
      }
    }
  }, [navIndex]);

  const submitAction = () => {
    setSubmitError("");
    if (!mode) {
      setSubmitError("처리 유형(입고/출고/생산)을 먼저 선택해 주세요.");
      return;
    }
    if (!selectedProduct) {
      setSubmitError("제품을 먼저 선택해 주세요.");
      return;
    }
    const rawQty = quantityInput.trim();
    if (!rawQty) {
      setSubmitError("수량을 입력해 주세요.");
      return;
    }
    const quantity = Number(rawQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSubmitError("수량은 1 이상의 숫자로 입력해 주세요.");
      return;
    }

    const next: PendingAction = {
      at: Date.now(),
      mode,
      quantity,
      note: noteInput.trim(),
      product: selectedProduct,
    };

    setPendingActions((prev) => [next, ...prev].slice(0, 30));
    setQuantityInput("");
    setNoteInput("");
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">
        <p className="text-sm text-gray-600">제품 목록을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-gray-900">제품 선택 처리</h1>
      <p className="mt-1 text-sm text-gray-600">
        바코드 북 없이 제품을 검색해서 선택한 뒤, 입고/출고/생산 처리 수량을 입력하세요.
      </p>

      <div className="mt-4 flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(["in", "out", "production"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setSubmitError("");
            }}
            className={`flex-1 rounded-md px-2 py-2 text-sm font-semibold transition-colors ${
              mode === m ? MODE_ACTIVE_CLASS[m] : "text-gray-600 hover:text-gray-900 hover:bg-white"
            }`}
            aria-pressed={mode === m}
          >
            <span className="inline-flex items-center gap-1.5">
              {mode === m ? <span aria-hidden>●</span> : <span aria-hidden>○</span>}
              {MODE_LABELS[m]}
            </span>
          </button>
        ))}
      </div>
      {!mode ? (
        <p className="mt-2 text-xs text-amber-700">
          먼저 처리 유형(입고/출고/생산)을 선택해야 처리에 추가할 수 있습니다.
        </p>
      ) : (
        <p className="mt-2 text-xs text-gray-700">
          현재 선택:{" "}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
              mode === "in"
                ? "bg-emerald-100 text-emerald-800"
                : mode === "out"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-indigo-100 text-indigo-800"
            }`}
          >
            {MODE_LABELS[mode]}
          </span>
        </p>
      )}

      {loadError ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      ) : null}

      <div className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
        <label htmlFor="inventory-product-search" className="text-sm font-semibold text-gray-800">
          제품 검색
        </label>
        <input
          id="inventory-product-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2.5 text-base sm:text-sm"
          placeholder="품목코드 / 품목명 / 규격 (예: gmc 10-08)"
          autoComplete="off"
        />
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={subQuery}
              onChange={(event) => setSubQuery(event.target.value)}
              disabled={!query.trim()}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
              placeholder="2차 필터: 규격/서브코드 (예: 06M-08R)"
              autoComplete="off"
            />
            {subQuery ? (
              <button
                type="button"
                onClick={() => setSubQuery("")}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-xs text-gray-700 hover:bg-gray-100"
              >
                초기화
              </button>
            ) : null}
          </div>
          {!query.trim() ? (
            <p className="mt-2 text-xs text-gray-500">먼저 1단계 계열 코드(예: gmc)를 입력하세요.</p>
          ) : subCodeHints.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {subCodeHints.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setSubQuery(hint)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    subQuery.toLowerCase() === hint.toLowerCase()
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {hint}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          1단계: 계열 코드(예: <span className="font-medium text-gray-700">gmc</span>) · 2단계: 규격(예:{" "}
          <span className="font-medium text-gray-700">10-08</span>)으로 좁혀 주세요. 목록에서{" "}
          <span className="font-medium text-gray-700">↑↓</span> 이동,{" "}
          <span className="font-medium text-gray-700">Enter</span>로 선택합니다.
        </p>

        {hasPrimaryQuery && displayedRows.length > 0 ? (
          <p className="mt-2 text-xs text-gray-600">
            {query.trim() ? (
              <>
                일치 <span className="font-semibold text-gray-900">{totalMatched}</span>건
                {subQuery.trim() ? (
                  <span className="text-blue-700"> · 2차 필터: {subQuery.trim()}</span>
                ) : null}
                {isTruncated ? (
                  <>
                    {" "}
                    · 표시 <span className="font-semibold">{cap}</span>건까지 (더 좁히면 찾기 쉬워요)
                  </>
                ) : null}
              </>
            ) : (
              <>
                검색어 없음 · 미리보기 <span className="font-semibold">{displayedRows.length}</span>건 / 전체{" "}
                <span className="font-semibold">{totalMatched}</span>건
                {totalMatched > cap ? (
                  <span className="text-amber-700"> · 전체는 검색으로 좁혀 주세요</span>
                ) : null}
              </>
            )}
          </p>
        ) : null}

        {!hasPrimaryQuery ? (
          <div className="mt-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-10 text-center text-sm text-gray-500">
            1차 검색어를 입력하면 제품 목록이 표시됩니다.
          </div>
        ) : (
          <div className="mt-2 max-h-[min(58vh,520px)] overflow-y-auto rounded-md border border-gray-200">
            {displayedRows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-gray-500">검색 결과가 없습니다.</p>
            ) : (
            <ul className="divide-y divide-gray-100">
              {displayedRows.map((product, index) => {
                const selected = selectedProductId === product.id;
                const keyboardHere = navIndex === index;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      id={`inv-scan-row-${index}`}
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      onClick={() => {
                        setNavIndex(index);
                        setSelectedProductId(product.id);
                      }}
                      className={[
                        "flex w-full gap-3 px-3 py-3.5 text-left transition-colors min-h-[4.25rem] items-start",
                        selected ? "bg-blue-50" : "bg-white hover:bg-gray-50",
                        keyboardHere && !selected ? "ring-2 ring-inset ring-amber-300" : "",
                        keyboardHere && selected ? "ring-2 ring-inset ring-blue-400" : "",
                      ].join(" ")}
                      title={`${product.code || ""} ${product.name || ""} ${product.spec || ""}`.trim()}
                    >
                      <span className="mt-0.5 w-7 shrink-0 text-right text-xs font-medium tabular-nums text-gray-400">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold leading-snug text-gray-900 sm:text-sm line-clamp-2">
                          <HighlightMatch text={product.name || "(품목명 없음)"} needle={query} />
                          {product.spec ? (
                            <span className="text-gray-800">
                              {" "}
                              · <HighlightMatch text={product.spec} needle={query} />
                            </span>
                          ) : (
                            <span className="text-gray-400 font-normal"> · (규격 없음)</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-gray-600 sm:text-[13px]">
                          <span className="font-mono text-gray-800">
                            <HighlightMatch text={product.code || "코드없음"} needle={query} />
                          </span>
                          <span className="text-gray-400"> · 현재고 </span>
                          <span className="font-medium text-gray-700">{product.stock || "미집계"}</span>
                        </p>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">처리 입력</h2>
        {selectedProduct ? (
          <div className="mt-1 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <p className="text-sm font-semibold leading-snug text-gray-900">
              {selectedProduct.name || "(품목명 없음)"}
              {selectedProduct.spec ? (
                <span className="text-gray-800">
                  {" "}
                  · {selectedProduct.spec}
                </span>
              ) : (
                <span className="text-gray-400 font-normal"> · (규격 없음)</span>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-mono text-gray-800">{selectedProduct.code || "코드없음"}</span>
              <span className="text-gray-400"> · 현재고 </span>
              <span className="font-medium text-gray-800">{selectedProduct.stock || "미집계"}</span>
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-amber-700">상단에서 제품을 선택해 주세요.</p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr]">
          <label htmlFor="inventory-qty" className="self-center text-sm text-gray-700">
            수량
          </label>
          <input
            id="inventory-qty"
            type="number"
            step={1}
            value={quantityInput}
            onChange={(event) => setQuantityInput(event.target.value)}
            placeholder="숫자 입력"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />

          <label htmlFor="inventory-note" className="self-center text-sm text-gray-700">
            메모
          </label>
          <input
            id="inventory-note"
            value={noteInput}
            onChange={(event) => setNoteInput(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="작업 비고 (선택)"
          />
        </div>

        {submitError ? <p className="mt-2 text-sm text-red-600">{submitError}</p> : null}

        <button
          type="button"
          onClick={submitAction}
          disabled={!mode}
          className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {mode ? `${MODE_LABELS[mode]} 처리에 추가` : "처리 유형을 먼저 선택하세요"}
        </button>
      </div>

      {pendingActions.length > 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">최근 처리 대기 목록</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pendingActions.map((action, index) => (
              <li
                key={`${action.at}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 px-3 py-2"
              >
                <span className="text-gray-800">
                  [{MODE_LABELS[action.mode]}]{" "}
                  <span className="font-medium">
                    {action.product.name || "품목명 없음"}
                    {action.product.spec ? ` · ${action.product.spec}` : ""}
                  </span>
                  <span className="text-gray-600">
                    {" "}
                    (<span className="font-mono">{action.product.code || "-"}</span>) × {action.quantity}
                  </span>
                </span>
                <span className="text-xs text-gray-500">{new Date(action.at).toLocaleTimeString("ko-KR")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            현재는 화면 임시 목록입니다. 원하시면 다음 단계로 Firestore 입출고 이력 저장까지 연결하겠습니다.
          </p>
        </div>
      ) : null}
    </div>
  );
}
