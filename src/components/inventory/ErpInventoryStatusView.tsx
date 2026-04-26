"use client";

import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Fragment, useEffect, useMemo, useState } from "react";

type ErpInventoryDoc = {
  fileName?: string;
  headers?: string[];
  rowCount?: number;
  rows?: Array<Record<string, string>>;
  sheetName?: string;
};

const ERP_INVENTORY_MASTER_DOC = "erpInventoryProducts";

type ErpInventoryStatusViewProps = {
  isLimitedView?: boolean;
};

const normalizeSpecToken = (token: string) => {
  const cleaned = token.toLowerCase().trim();
  if (!cleaned) return "";
  return cleaned.replace(/^0+(?=\d)/, "");
};

const parseSpecTokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalizeSpecToken);

const matchesSpecQuery = (specValue: string, queryValue: string) => {
  const specTokens = parseSpecTokens(specValue);
  const queryTokens = parseSpecTokens(queryValue);
  if (queryTokens.length === 0) return true;
  if (specTokens.length < queryTokens.length) return false;

  for (let i = 0; i < queryTokens.length; i += 1) {
    const q = queryTokens[i];
    const s = specTokens[i] ?? "";
    if (!q) return false;
    const isLast = i === queryTokens.length - 1;
    if (isLast) {
      if (!s.startsWith(q)) return false;
    } else {
      if (s !== q) return false;
    }
  }
  return true;
};

export default function ErpInventoryStatusView({ isLimitedView = false }: ErpInventoryStatusViewProps) {
  const PAGE_SIZE = 100;
  type StockStatus = "정상" | "부족" | "재고 없음" | "미집계";
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [erpData, setErpData] = useState<ErpInventoryDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [codeQuery, setCodeQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StockStatus>("all");
  const [page, setPage] = useState(1);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    const inventoryRef = doc(db, "inventory", ERP_INVENTORY_MASTER_DOC);
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setErpData(null);
          setLoading(false);
          setIsRefreshing(false);
          return;
        }
        setErpData(snapshot.data() as ErpInventoryDoc);
        setLoading(false);
        setIsRefreshing(false);
        setLastRefreshedAt(new Date());
        setErrorMessage("");
      },
      (error) => {
        console.error("ERP 재고 현황 조회 오류:", error);
        setErrorMessage("ERP 재고 현황을 불러오지 못했습니다.");
        setLoading(false);
        setIsRefreshing(false);
      }
    );
    return () => unsubscribe();
  }, [refreshTick]);

  const headers = useMemo(() => {
    if (Array.isArray(erpData?.headers) && erpData.headers.length > 0) {
      return erpData.headers;
    }
    const firstRow = erpData?.rows?.[0];
    if (!firstRow) return [];
    return Object.keys(firstRow);
  }, [erpData]);

  const searchedRows = useMemo(() => {
    if (!Array.isArray(erpData?.rows)) return [];
    const queryTerms = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const normalizedCode = codeQuery.trim().toLowerCase();

    return erpData.rows.filter((row) => {
      const rowText = headers.map((header) => String(row[header] ?? "")).join(" ").toLowerCase();
      const textMatched =
        queryTerms.length === 0 || queryTerms.every((term) => rowText.includes(term));
      if (!textMatched) return false;
      if (!normalizedCode) return true;
      const codeValue = String(
        row["품목코드"] ?? row["제품코드"] ?? row["itemCode"] ?? row["code"] ?? ""
      )
        .replace(/\s+/g, "")
        .toLowerCase();
      const specValue = String(
        row["규격정보"] ?? row["규격"] ?? row["spec"] ?? row["size"] ?? ""
      )
        .replace(/\s+/g, "")
        .toLowerCase();
      const normalizedCodeNoSpace = normalizedCode.replace(/\s+/g, "");
      const specMatched = matchesSpecQuery(specValue, normalizedCodeNoSpace);
      const codeMatched =
        normalizedCodeNoSpace.length >= 3 && codeValue.startsWith(normalizedCodeNoSpace);
      return specMatched || codeMatched;
    });
  }, [erpData, headers, searchQuery, codeQuery]);

  const getStockStatus = (row: Record<string, string>): StockStatus => {
    const raw = String(
      row["현재고"] ?? row["재고"] ?? row["currentStock"] ?? row["stockQty"] ?? ""
    ).trim();
    if (!raw) return "미집계";
    const parsed = Number(raw.replace(/,/g, ""));
    if (Number.isNaN(parsed)) return "미집계";
    if (parsed <= 0) return "재고 없음";
    if (parsed < 10) return "부족";
    return "정상";
  };

  const summary = useMemo(() => {
    const all = searchedRows.length;
    let normal = 0;
    let low = 0;
    let empty = 0;
    let unknown = 0;
    searchedRows.forEach((row) => {
      const status = getStockStatus(row);
      if (status === "정상") normal += 1;
      else if (status === "부족") low += 1;
      else if (status === "재고 없음") empty += 1;
      else unknown += 1;
    });
    return { all, normal, low, empty, unknown };
  }, [searchedRows]);

  const previewRows = useMemo(() => {
    if (statusFilter === "all") return searchedRows;
    return searchedRows.filter((row) => getStockStatus(row) === statusFilter);
  }, [searchedRows, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(previewRows.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (effectivePage - 1) * PAGE_SIZE;
    return previewRows.slice(start, start + PAGE_SIZE);
  }, [previewRows, effectivePage, PAGE_SIZE]);

  const rangeStart = previewRows.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(previewRows.length, effectivePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, codeQuery, statusFilter]);

  useEffect(() => {
    setSelectedRowIndex(null);
  }, [searchQuery, codeQuery, effectivePage]);

  const selectedRow =
    selectedRowIndex === null ? null : pagedRows[selectedRowIndex] ?? null;

  const getRowValue = (row: Record<string, string> | null, keys: string[]) => {
    if (!row) return "";
    for (const key of keys) {
      const value = String(row[key] ?? "").trim();
      if (value) return value;
    }
    return "";
  };

  const selectedItemCode = getRowValue(selectedRow, ["품목코드", "제품코드", "itemCode", "code"]);
  const selectedItemName = getRowValue(selectedRow, ["품목명", "제품명", "itemName", "name"]);
  const selectedSpec = getRowValue(selectedRow, ["규격정보", "규격", "spec", "size"]);
  const selectedCurrentStock = getRowValue(selectedRow, ["현재고", "재고", "currentStock", "stockQty"]);
  const selectedInbound = getRowValue(selectedRow, ["입고수량", "입고", "inboundQty", "inQty"]);
  const selectedOutbound = getRowValue(selectedRow, ["출고수량", "출고", "outboundQty", "outQty"]);
  const selectedLocation = getRowValue(selectedRow, ["창고", "보관위치", "location", "warehouse"]);

  const normalizedStock = Number(selectedCurrentStock.replace(/,/g, ""));
  const stockStatusLabel =
    selectedCurrentStock.length === 0 || Number.isNaN(normalizedStock)
      ? "미집계"
      : normalizedStock <= 0
        ? "재고 없음"
        : normalizedStock < 10
          ? "부족"
          : "정상";
  const stockStatusClass =
    stockStatusLabel === "정상"
      ? "bg-emerald-100 text-emerald-700"
      : stockStatusLabel === "부족"
        ? "bg-amber-100 text-amber-700"
        : stockStatusLabel === "재고 없음"
          ? "bg-rose-100 text-rose-700"
          : "bg-gray-100 text-gray-700";

  const tableHeaders = useMemo(() => {
    const base = headers.includes("현재고") ? headers : [...headers, "현재고"];
    return base.includes("재고상태") ? base : [...base, "재고상태"];
  }, [headers]);

  const getCurrentStockFromRow = (row: Record<string, string>) => {
    return getRowValue(row, ["현재고", "재고", "currentStock", "stockQty"]) || "미집계";
  };

  const getStatusBadgeClass = (status: StockStatus) => {
    if (status === "정상") return "bg-emerald-100 text-emerald-700";
    if (status === "부족") return "bg-amber-100 text-amber-700";
    if (status === "재고 없음") return "bg-rose-100 text-rose-700";
    return "bg-gray-100 text-gray-700";
  };
  const showExtendedDetails = !isLimitedView;
  const handleRefresh = () => {
    setSearchQuery("");
    setCodeQuery("");
    setStatusFilter("all");
    setSelectedRowIndex(null);
    setPage(1);
    setIsRefreshing(true);
    setRefreshTick((prev) => prev + 1);
  };
  const lastRefreshedLabel = lastRefreshedAt
    ? `${String(lastRefreshedAt.getHours()).padStart(2, "0")}:${String(
        lastRefreshedAt.getMinutes()
      ).padStart(2, "0")}:${String(lastRefreshedAt.getSeconds()).padStart(2, "0")}`
    : "-";

  if (loading) {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-sm text-gray-600">ERP 재고 현황을 불러오는 중...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-sm font-medium text-red-600">{errorMessage}</p>
      </div>
    );
  }

  if (!erpData || !Array.isArray(erpData.rows) || erpData.rows.length === 0) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900">재고 현황</h1>
        <p className="mt-2 text-sm text-gray-600">
          등록된 ERP 품목 데이터가 없습니다. `재고관리 &gt; 제품등록 (ERP 엑셀 업로드)`에서 먼저 등록해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">재고 현황</h1>
          <p className="mt-2 text-sm text-gray-600">
            UHP와 분리된 ERP 제품 기준 전사 재고 현황 화면입니다.
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
      <p className="mb-3 text-xs text-gray-500">최근 새로고침: {lastRefreshedLabel}</p>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <label htmlFor="erp-inventory-search" className="mb-2 block text-sm font-semibold text-blue-900">
          재고 검색
        </label>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[34ch_22ch_max-content] md:justify-start">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-blue-500">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
              </svg>
            </span>
            <input
              id="erp-inventory-search"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="품목명/코드/규격 검색"
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {searchQuery.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-2 my-auto inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-gray-700"
                aria-label="검색어 지우기"
              >
                ×
              </button>
            )}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-blue-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
              </svg>
            </span>
            <input
              type="text"
              value={codeQuery}
              onChange={(event) => setCodeQuery(event.target.value)}
              placeholder="규격/코드 검색"
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-9 pr-9 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={() => setCodeQuery("")}
              disabled={codeQuery.trim().length === 0}
              className="absolute inset-y-0 right-2 my-auto inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-gray-700 disabled:cursor-default disabled:opacity-40"
              aria-label="코드 검색어 지우기"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setCodeQuery("");
              setStatusFilter("all");
              setSelectedRowIndex(null);
              setPage(1);
            }}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-blue-300 bg-white px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            검색 초기화
          </button>
        </div>
        
      </div>

      

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">ERP 등록 데이터 목록</p>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {tableHeaders.map((header) => (
                  <th key={header} className="whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, index) => (
                <Fragment key={`row-group-${index}`}>
                  <tr
                    className={`cursor-pointer odd:bg-white even:bg-gray-50/40 hover:bg-blue-50 ${
                      selectedRowIndex === index ? "bg-blue-50" : ""
                    }`}
                    onClick={() => setSelectedRowIndex((prev) => (prev === index ? null : index))}
                  >
                    {tableHeaders.map((header) => (
                      <td key={`${index}-${header}`} className="whitespace-nowrap border-b border-gray-100 px-3 py-2 text-gray-700">
                        {header === "현재고" ? getCurrentStockFromRow(row) : null}
                        {header === "재고상태" ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(
                              getStockStatus(row)
                            )}`}
                          >
                            {getStockStatus(row)}
                          </span>
                        ) : null}
                        {header !== "현재고" && header !== "재고상태" ? row[header] || "-" : null}
                      </td>
                    ))}
                  </tr>
                  {selectedRowIndex === index ? (
                    <tr className="bg-blue-50/60">
                      <td colSpan={tableHeaders.length} className="border-b border-blue-100 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                          <span className="font-semibold text-gray-900">선택 제품 재고 상태</span>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${stockStatusClass}`}>
                            {stockStatusLabel}
                          </span>
                          <span className="text-gray-700">품목코드: <strong>{getRowValue(row, ["품목코드", "제품코드", "itemCode", "code"]) || "-"}</strong></span>
                          <span className="text-gray-700">품목명: <strong>{getRowValue(row, ["품목명", "제품명", "itemName", "name"]) || "-"}</strong></span>
                          <span className="text-gray-700">현재고: <strong>{getCurrentStockFromRow(row)}</strong></span>
                          {showExtendedDetails ? (
                            <>
                              <span className="text-gray-700">입고: <strong>{getRowValue(row, ["입고수량", "입고", "inboundQty", "inQty"]) || "미집계"}</strong></span>
                              <span className="text-gray-700">출고: <strong>{getRowValue(row, ["출고수량", "출고", "outboundQty", "outQty"]) || "미집계"}</strong></span>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            {rangeStart}-{rangeEnd} / 총 {previewRows.length}건 (페이지당 {PAGE_SIZE}건)
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={effectivePage <= 1}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {effectivePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={effectivePage >= totalPages}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {showExtendedDetails && selectedRow ? (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">선택 제품 재고 상태</h2>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${stockStatusClass}`}>
            {stockStatusLabel}
          </span>
        </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">품목코드</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedItemCode || "-"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">품목명</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedItemName || "-"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">규격정보</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedSpec || "-"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">현재고</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedCurrentStock || "미집계"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">입고 수량</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedInbound || "미집계"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">출고 수량</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedOutbound || "미집계"}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 sm:col-span-2 lg:col-span-2">
              <p className="text-xs text-gray-500">보관 위치</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{selectedLocation || "미지정"}</p>
            </div>
          </div>
      </div>
      ) : null}
    </div>
  );
}

