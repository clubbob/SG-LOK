"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { Header, Footer } from "@/components/layout";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import { deleteMapping, fetchAllMappings, updateMapping } from "@/lib/substitute/firestoreMapping";
import { MANUFACTURER } from "@/lib/substitute/constants";
import { normalizeInstrumentCode } from "@/lib/substitute/codeNormalize";
import { downloadSubstituteListXlsx } from "@/lib/substitute/exportXlsx";
import { resolveSubstituteRegistrantLabel } from "@/lib/substitute/registrantDisplay";
import type { SubstituteMappingDoc } from "@/lib/substitute/types";

function toMillis(ts: unknown): number {
  if (!ts || typeof ts !== "object") return 0;
  const v = ts as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number")
    return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1_000_000);
  return 0;
}

function formatDateTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (ms <= 0) return "-";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function SubstituteCodeListView({ embedded = false }: { embedded?: boolean }) {
  const PAGE_SIZE = 10;
  const { isAuthenticated, loading, user } = useAuth();
  const canAccessPage = embedded ? Boolean(user) : isAuthenticated;
  const canEditRows = canAccessPage;
  const canDeleteRows = embedded;
  const router = useRouter();
  const [rows, setRows] = useState<SubstituteMappingDoc[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFromName, setEditFromName] = useState("");
  const [editFromCode, setEditFromCode] = useState("");
  const [editToName, setEditToName] = useState("");
  const [editToCode, setEditToCode] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !canAccessPage) {
      router.push(embedded ? "/admin/login" : "/login");
    }
  }, [loading, canAccessPage, embedded, router]);

  const loadRows = async () => {
    setIsLoadingRows(true);
    setListError(null);
    try {
      const all = await fetchAllMappings(db);
      const usersSnap = await getDocs(collection(db, "users"));
      const nextUserNameById: Record<string, string> = {};
      usersSnap.forEach((d) => {
        const data = d.data() as { name?: unknown; isAdmin?: unknown; role?: unknown; email?: unknown };
        const isAdminUser = data.isAdmin === true || data.role === "admin";
        if (isAdminUser) {
          nextUserNameById[d.id] = "관리자";
          return;
        }
        if (typeof data.name === "string" && data.name.trim()) {
          nextUserNameById[d.id] = data.name.trim();
          return;
        }
        if (typeof data.email === "string" && data.email.includes("@")) {
          nextUserNameById[d.id] = data.email.split("@")[0] || d.id;
          return;
        }
        nextUserNameById[d.id] = d.id;
      });
      setUserNameById(nextUserNameById);
      const onlySwToSlok = all.filter(
        (m) =>
          m.manufacturer_from === MANUFACTURER.SWAGELOK &&
          m.manufacturer_to === MANUFACTURER.SLOK
      );
      onlySwToSlok.sort((a, b) => {
        const aCreated = toMillis(a.created_at);
        const bCreated = toMillis(b.created_at);
        if (bCreated !== aCreated) return bCreated - aCreated;
        const aUpdated = toMillis(a.updated_at);
        const bUpdated = toMillis(b.updated_at);
        if (bUpdated !== aUpdated) return bUpdated - aUpdated;
        return b.id.localeCompare(a.id, "en", { sensitivity: "base" });
      });
      setRows(onlySwToSlok);
    } catch (e) {
      console.error(e);
      setListError("코드 목록을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setIsLoadingRows(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const startEdit = (row: SubstituteMappingDoc) => {
    setEditingId(row.id);
    setEditFromName(row.product_name_from ?? "");
    setEditFromCode(row.code_from ?? "");
    setEditToName(row.product_name_to ?? "");
    setEditToCode(row.code_to ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFromName("");
    setEditFromCode("");
    setEditToName("");
    setEditToCode("");
  };

  const saveEdit = async (row: SubstituteMappingDoc) => {
    const nextFromName = editFromName.trim();
    const nextFromCode = normalizeInstrumentCode(editFromCode);
    const nextToName = editToName.trim();
    const nextToCode = normalizeInstrumentCode(editToCode);
    if (!nextFromName || !nextFromCode || !nextToName || !nextToCode) {
      alert("제품명/제품코드는 비워둘 수 없습니다.");
      return;
    }

    const changedBy = user?.uid ?? "admin";
    setSavingId(row.id);
    try {
      await updateMapping(
        db,
        row.id,
        {
          product_name_from: nextFromName,
          code_from: nextFromCode,
          normalized_code_from: normalizeInstrumentCode(nextFromCode),
          product_name_to: nextToName,
          code_to: nextToCode,
          normalized_code_to: normalizeInstrumentCode(nextToCode),
        },
        changedBy
      );
      cancelEdit();
      await loadRows();
    } catch (error) {
      console.error(error);
      alert("수정에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  };

  const removeRow = async (row: SubstituteMappingDoc) => {
    if (!window.confirm("이 매핑을 삭제하시겠습니까?")) return;
    setDeletingId(row.id);
    try {
      await deleteMapping(db, row.id, user?.uid ?? "admin");
      if (editingId === row.id) cancelEdit();
      await loadRows();
    } catch (error) {
      console.error(error);
      alert("삭제에 실패했습니다.");
    } finally {
      setDeletingId(null);
    }
  };

  const normalized = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!normalized) return rows;
    return rows.filter((r) => {
      const haystack = [r.product_name_from, r.code_from, r.product_name_to, r.code_to]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [rows, normalized]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const displayPage = totalPages - effectivePage + 1;
  const pagedRows = filteredRows.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);
  const rangeStart = filteredRows.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filteredRows.length, effectivePage * PAGE_SIZE);

  if (loading) {
    return (
      <div
        className={
          embedded
            ? "min-h-[40vh] flex items-center justify-center"
            : "min-h-screen flex items-center justify-center"
        }
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!canAccessPage) {
    return null;
  }

  return (
    <div className={embedded ? "min-h-full bg-gray-50 p-4 sm:p-8" : "min-h-screen flex flex-col"}>
      {!embedded && <Header />}
      <main className={embedded ? "" : "flex-1 bg-gray-50"}>
        <div className={embedded ? "max-w-[1400px] mx-auto" : "max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">코드 목록</h1>
              <p className="text-gray-600 mt-2 text-sm sm:text-base">
                Swagelok / S-LOK 매핑 목록을 확인할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() =>
                  downloadSubstituteListXlsx(
                    filteredRows,
                    userNameById,
                    `substitute-code-list-${new Date().toISOString().slice(0, 10)}.xlsx`
                  )
                }
                disabled={filteredRows.length === 0}
                className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                엑셀 다운로드
              </button>
              <button
                type="button"
                onClick={() => void loadRows()}
                disabled={isLoadingRows}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isLoadingRows ? "불러오는 중..." : "새로고침"}
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex-1">
              <label htmlFor="code-list-search" className="mb-1 block text-sm font-medium text-gray-700">
                목록 검색
              </label>
              <div className="relative">
                <input
                  id="code-list-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="제품명 또는 제품코드 검색"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="검색어 지우기"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
              <table className="min-w-[1100px] divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">번호</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">Swagelok 제품명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">Swagelok 제품코드</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">S-LOK 제품명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">S-LOK 제품코드</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">등록일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">등록자</th>
                    {canEditRows && (
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">관리</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {pagedRows.map((row, index) => (
                    <tr key={row.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 text-sm text-gray-800">
                        {filteredRows.length - ((effectivePage - 1) * PAGE_SIZE + index)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                        {canEditRows && editingId === row.id ? (
                          <input
                            type="text"
                            value={editFromName}
                            onChange={(e) => setEditFromName(e.target.value)}
                            className="w-full min-w-[220px] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.product_name_from || "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">
                        {canEditRows && editingId === row.id ? (
                          <input
                            type="text"
                            value={editFromCode}
                            onChange={(e) => setEditFromCode(e.target.value.toUpperCase())}
                            className="w-full min-w-[150px] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.code_from || "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                        {canEditRows && editingId === row.id ? (
                          <input
                            type="text"
                            value={editToName}
                            onChange={(e) => setEditToName(e.target.value)}
                            className="w-full min-w-[220px] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.product_name_to || "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">
                        {canEditRows && editingId === row.id ? (
                          <input
                            type="text"
                            value={editToCode}
                            onChange={(e) => setEditToCode(e.target.value.toUpperCase())}
                            className="w-full min-w-[150px] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.code_to || "-"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatDateTime(row.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {row.created_by ? resolveSubstituteRegistrantLabel(row.created_by, userNameById) : "-"}
                      </td>
                      {canEditRows && (
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {editingId === row.id ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void saveEdit(row)}
                                disabled={savingId === row.id}
                                className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                              >
                                {savingId === row.id ? "저장 중..." : "저장"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={savingId === row.id}
                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                disabled={Boolean(editingId) || deletingId === row.id}
                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                수정
                              </button>
                              {canDeleteRows && (
                                <button
                                  type="button"
                                  onClick={() => void removeRow(row)}
                                  disabled={Boolean(editingId) || deletingId === row.id}
                                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  {deletingId === row.id ? "삭제 중..." : "삭제"}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {listError && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {listError}
              </p>
            )}
            {!listError && !isLoadingRows && filteredRows.length === 0 && (
              <p className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                표시할 코드 목록이 없습니다.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">
                {rangeStart}-{rangeEnd} / 총 {filteredRows.length}건
                {normalized ? ` (전체 ${rows.length}건 중 검색 결과)` : ""}
              </p>
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={displayPage <= 1}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    이전
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => {
                    const isActive = n === displayPage;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(totalPages - n + 1)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                          isActive
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {n}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={displayPage >= totalPages}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      {!embedded && <Footer />}
    </div>
  );
}
