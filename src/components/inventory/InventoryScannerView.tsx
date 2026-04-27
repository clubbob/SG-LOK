"use client";

import { db } from "@/lib/firebase";
import { addDoc, collection, doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type ScannerMode = "in" | "out" | "production";

type ErpInventoryDoc = {
  rows?: Array<Record<string, string>>;
};

type InventoryProduct = {
  id: string;
  code: string;
  group: string;
  name: string;
  spec: string;
  stock: string;
  inbound: string;
  outbound: string;
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
  in: "border-emerald-700 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-200",
  out: "border-rose-700 bg-rose-600 text-white shadow-md ring-2 ring-rose-200",
  production: "border-indigo-700 bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200",
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

function getRowCode(row: Record<string, string>) {
  return readFirst(row, ["품목코드", "제품코드", "itemCode", "code"]);
}

function getStockField(row: Record<string, string>) {
  if ("현재고" in row) return "현재고";
  if ("재고" in row) return "재고";
  if ("currentStock" in row) return "currentStock";
  if ("stockQty" in row) return "stockQty";
  return "현재고";
}

function parseStockNumber(raw: string) {
  const parsed = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSpecToken(token: string) {
  const cleaned = token.toLowerCase().trim();
  if (!cleaned) return "";
  return cleaned.replace(/^0+(?=\d)/, "");
}

function parseSpecTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalizeSpecToken);
}

function matchesSegmentedPrefix(value: string, queryValue: string) {
  const valueTokens = parseSpecTokens(value);
  const queryTokens = parseSpecTokens(queryValue);
  if (queryTokens.length === 0) return true;
  if (valueTokens.length < queryTokens.length) return false;

  for (let i = 0; i < queryTokens.length; i += 1) {
    const q = queryTokens[i];
    const v = valueTokens[i] ?? "";
    if (!q) return false;
    const isLast = i === queryTokens.length - 1;
    if (isLast) {
      if (!v.startsWith(q)) return false;
    } else if (v !== q) {
      return false;
    }
  }
  return true;
}

function mapProducts(rows: Array<Record<string, string>>): InventoryProduct[] {
  return rows
    .map((row, index) => {
      const code = readFirst(row, ["품목코드", "제품코드", "itemCode", "code"]);
      const group = readFirst(row, [
        "품목그룹1명",
        "품목그룹",
        "품목 그룹",
        "품목군",
        "품목분류",
        "품목그룹명",
        "품목계정",
        "그룹명",
        "분류",
        "대분류",
        "중분류",
        "소분류",
        "제품군",
        "계정구분",
        "자재유형",
        "itemGroup",
        "itemGroupName",
        "group",
        "groupName",
        "category",
        "type",
      ]);
      const name = readFirst(row, ["품목명", "제품명", "itemName", "name"]);
      const spec = readFirst(row, ["규격정보", "규격", "spec", "size"]);
      const stock = readFirst(row, ["현재고", "재고", "currentStock", "stockQty"]);
      const inbound = readFirst(row, ["입고수량", "입고", "inboundQty", "inQty"]);
      const outbound = readFirst(row, ["출고수량", "출고", "outboundQty", "outQty"]);
      const id = `${code || "unknown"}-${index}`;
      const familySource = `${name} ${code}`.trim();
      const familyKey = familySource.split(/[\s\-_/]+/)[0]?.toLowerCase() ?? "";
      const searchText = `${name}`.replace(/\s+/g, "").toLowerCase();
      return { id, code, group, name, spec, stock, inbound, outbound, familyKey, searchText };
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

export function InventoryScannerView() {
  const [mode, setMode] = useState<ScannerMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [products, setProducts] = useState<InventoryProduct[]>([]);

  const [query, setQuery] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [navIndex, setNavIndex] = useState(0);
  const [quantityInput, setQuantityInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const displayedRowsRef = useRef<InventoryProduct[]>([]);
  const prevQueryRef = useRef<string | null>(null);

  useEffect(() => {
    const inventoryRef = doc(db, "inventory", ERP_INVENTORY_MASTER_DOC);
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setProducts([]);
          setLoading(false);
          setIsRefreshing(false);
          setLoadError("ERP 제품 데이터가 없습니다. 관리자에서 먼저 제품등록을 진행해 주세요.");
          return;
        }
        const data = snapshot.data() as ErpInventoryDoc;
        const mapped = mapProducts(Array.isArray(data.rows) ? data.rows : []);
        setProducts(mapped);
        setLoading(false);
        setIsRefreshing(false);
        setLoadError("");
      },
      (error) => {
        console.error("스캔용 제품 목록 조회 오류:", error);
        setLoading(false);
        setIsRefreshing(false);
        const message =
          error instanceof Error && error.message.includes("Failed to fetch")
            ? "제품 목록 조회에 실패했습니다. 네트워크 연결 또는 Firebase 접근 권한/보안 규칙을 확인해 주세요."
            : "제품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        setLoadError(message);
      }
    );

    return () => unsubscribe();
  }, [refreshTick]);

  const { displayedRows, totalMatched, isTruncated, cap, subCodeHints } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let matched = [...products];
    if (terms.length > 0) {
      matched = matched.filter((product) => {
        return terms.every((term) => product.searchText.includes(term.replace(/\s+/g, "")));
      });
    }

    const beforeSubFilter = [...matched];
    const sub = subQuery.trim().toLowerCase();
    if (sub) {
      matched = matched.filter((product) => {
        return matchesSegmentedPrefix(product.spec, sub);
      });
    }

    const subCodeHints = Array.from(
      new Set(
        beforeSubFilter
          .map((product) => product.spec.trim())
          .filter(Boolean)
          .map((spec) => spec.split(/\s+/)[0])
      )
    ).sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));

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

  const submitAction = async () => {
    setSubmitError("");
    setSubmitSuccess("");
    if (isSubmitting) return;
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

    setIsSubmitting(true);
    try {
      const inventoryRef = doc(db, "inventory", ERP_INVENTORY_MASTER_DOC);
      let nextStock = 0;

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(inventoryRef);
        if (!snap.exists()) {
          throw new Error("ERP 재고 마스터 문서를 찾을 수 없습니다.");
        }
        const data = snap.data() as ErpInventoryDoc;
        const rows = Array.isArray(data.rows)
          ? data.rows.map((row) =>
              Object.fromEntries(
                Object.entries(row ?? {}).map(([k, v]) => [String(k), String(v ?? "").trim()])
              )
            )
          : [];

        const targetIndex = rows.findIndex((row) => getRowCode(row) === selectedProduct.code);
        if (targetIndex < 0) {
          throw new Error(`품목코드 ${selectedProduct.code || "-"} 행을 찾지 못했습니다.`);
        }

        const currentRow = rows[targetIndex];
        const stockField = getStockField(currentRow);
        const currentStock = parseStockNumber(currentRow[stockField] ?? "");
        const delta = mode === "out" ? -quantity : quantity;
        nextStock = Math.max(0, currentStock + delta);
        rows[targetIndex] = { ...currentRow, [stockField]: String(nextStock) };

        tx.set(
          inventoryRef,
          {
            rows,
            rowCount: rows.length,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });

      let transactionLogFailed = false;
      try {
        await addDoc(collection(db, "inventoryTransactions"), {
          mode,
          quantity,
          note: noteInput.trim(),
          code: selectedProduct.code,
          name: selectedProduct.name,
          spec: selectedProduct.spec,
          createdAt: serverTimestamp(),
        });
      } catch (logError) {
        transactionLogFailed = true;
        console.warn("inventoryTransactions 이력 저장 실패(재고 반영은 완료):", logError);
      }

      setQuantityInput("");
      setNoteInput("");
      const successBaseMessage = `${MODE_LABELS[mode]} 처리가 완료되었습니다. ${selectedProduct.name || "품목명 없음"} (${selectedProduct.code || "-"}) 수량 ${quantity}, 현재고 ${nextStock}`;
      setSubmitSuccess(
        transactionLogFailed
          ? `${successBaseMessage}. 참고: 재고 반영은 완료되었지만, 거래 이력 저장 권한이 없어 이력은 기록되지 않았습니다.`
          : successBaseMessage
      );
    } catch (e) {
      const message =
        e instanceof Error && e.message.includes("Failed to fetch")
          ? "처리 요청에 실패했습니다. 네트워크 연결 또는 Firebase 접근 권한/보안 규칙을 확인해 주세요."
          : e instanceof Error
            ? e.message
            : "처리 중 오류가 발생했습니다.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefresh = () => {
    setMode(null);
    setQuery("");
    setSubQuery("");
    setSelectedProductId("");
    setNavIndex(0);
    setQuantityInput("");
    setNoteInput("");
    setSubmitError("");
    setSubmitSuccess("");
    setLoadError("");
    setIsRefreshing(true);
    setRefreshTick((prev) => prev + 1);
  };

  if (loading) {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-sm text-gray-600">제품 목록을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">입출고 처리</h1>
          <p className="mt-2 text-sm text-gray-600">
            제품 검색 후 선택하여 입고/출고/생산 처리를 진행합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            className={`h-4 w-4 text-gray-600 ${isRefreshing ? "animate-spin" : ""}`}
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
          {isRefreshing ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border-2 border-gray-300 bg-white p-4 shadow-sm">
        <p className="mb-3 text-base font-extrabold tracking-tight text-gray-900">처리 유형 선택</p>
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-gray-100 p-3 sm:grid-cols-3">
          {(["in", "out", "production"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setSubmitError("");
              }}
              className={`h-16 w-full rounded-xl border-2 px-4 text-xl font-extrabold leading-none transition-all ${
                mode === m
                  ? MODE_ACTIVE_CLASS[m]
                  : "border-gray-400 bg-white text-gray-900 hover:bg-gray-200"
              }`}
              aria-pressed={mode === m}
            >
              <span className="inline-flex items-center justify-center">{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
        {mode ? (
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
        ) : null}
      </div>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <label htmlFor="inventory-product-search" className="mb-2 block text-sm font-semibold text-blue-900">
          제품 검색
        </label>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[34ch_22ch_max-content] md:justify-start">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-blue-500">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
              </svg>
            </span>
            <input
              id="inventory-product-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="품목명 검색"
              autoComplete="off"
            />
            {query.trim().length > 0 ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                tabIndex={-1}
                className="absolute inset-y-0 right-2 my-auto inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-gray-700"
                aria-label="검색어 지우기"
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-blue-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
              </svg>
            </span>
            <input
              value={subQuery}
              onChange={(event) => setSubQuery(event.target.value)}
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-9 pr-9 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="규격 검색"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setSubQuery("")}
              disabled={subQuery.trim().length === 0}
              tabIndex={-1}
              className="absolute inset-y-0 right-2 my-auto inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-gray-700 disabled:cursor-default disabled:opacity-40"
              aria-label="규격 검색어 지우기"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSubQuery("");
              setSelectedProductId("");
              setSubmitError("");
              setSubmitSuccess("");
            }}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-blue-300 bg-white px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            검색 초기화
          </button>
        </div>

        {query.trim() ? (
          <>
            {hasPrimaryQuery && displayedRows.length > 0 ? (
              <p className="mt-2 text-xs text-gray-600">
                일치 <span className="font-semibold text-gray-900">{totalMatched}</span>건
                {subQuery.trim() ? (
                  <span className="text-blue-700"> · 2차 필터: {subQuery.trim()}</span>
                ) : null}
                {isTruncated ? (
                  <>
                    {" "}
                    · 표시 <span className="font-semibold">{cap}</span>건까지
                  </>
                ) : null}
              </p>
            ) : null}

            {subCodeHints.length > 0 && subQuery.trim().length === 0 ? (
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

            <div className="mt-2 max-h-[min(58vh,520px)] overflow-y-auto rounded-md border border-gray-200 bg-white">
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
                              <span className="text-gray-700">품목코드: </span>
                              <span className="font-mono font-semibold text-gray-800">
                                <HighlightMatch text={product.code || "코드없음"} needle={query} />
                              </span>
                              <span className="mx-2 text-gray-300">|</span>
                              <span className="text-gray-700">품목명: </span>
                              <span className="font-semibold text-gray-900">{product.name || "(품목명 없음)"}</span>
                              <span className="mx-2 text-gray-300">|</span>
                              <span className="text-gray-700">현재고: </span>
                              <span className="font-semibold text-gray-800">{product.stock || "미집계"}</span>
                              <span className="mx-2 text-gray-300">|</span>
                              <span className="text-gray-700">입고: </span>
                              <span className="font-semibold text-gray-800">{product.inbound || "미집계"}</span>
                              <span className="mx-2 text-gray-300">|</span>
                              <span className="text-gray-700">출고: </span>
                              <span className="font-semibold text-gray-800">{product.outbound || "미집계"}</span>
                            </p>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">처리 입력</h2>
        {selectedProduct ? (
          <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
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
          </div>
        ) : (
          <p className="mt-3 text-xs text-amber-700">상단에서 제품을 선택해 주세요.</p>
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
        {submitSuccess ? (
          <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {submitSuccess}
          </p>
        ) : null}

        <button
          type="button"
          onClick={submitAction}
          disabled={!mode || isSubmitting}
          className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {!mode
            ? "처리 유형을 먼저 선택하세요"
            : isSubmitting
              ? "처리 중..."
              : `${MODE_LABELS[mode]} 처리에 추가`}
        </button>
      </div>

    </div>
  );
}
