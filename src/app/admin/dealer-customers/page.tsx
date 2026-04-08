"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type DealerCustomerRow = {
  id: string;
  dealerName: string;
  customerName: string;
  managerName: string;
  status: "업체등록중" | "판매중" | "거래중단중";
  createdBy: string;
  createdAtMs: number;
  createdAtText: string;
  statusChangedAtText: string;
};

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function normalizeUppercaseForEnglish(value: string): string {
  return value.trim().toUpperCase();
}

export default function AdminDealerCustomersPage() {
  const PAGE_SIZE = 10;
  const [dealerName, setDealerName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [status, setStatus] = useState<"" | "업체등록중" | "판매중" | "거래중단중">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState<DealerCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDealerName, setEditingDealerName] = useState("");
  const [editingCustomerName, setEditingCustomerName] = useState("");
  const [editingManagerName, setEditingManagerName] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const q = query(collection(db, "dealer_customers"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
          const statusUpdatedAt = (data.statusUpdatedAt ?? data.status_updated_at) as { toDate?: () => Date } | undefined;
          const createdAtDate = createdAt?.toDate ? createdAt.toDate() : null;
          const statusChangedAtDate = statusUpdatedAt?.toDate ? statusUpdatedAt.toDate() : null;
          const statusValue: DealerCustomerRow["status"] =
            String(data.status ?? "업체등록중") === "판매중"
              ? "판매중"
              : String(data.status ?? "업체등록중") === "거래중단중"
                ? "거래중단중"
                : "업체등록중";
          return {
            id: docSnap.id,
            dealerName: String(data.dealerName ?? data.dealer_name ?? "-"),
            customerName: String(data.customerName ?? data.customer_name ?? "-"),
            managerName: String(data.managerName ?? data.manager_name ?? data.manager ?? data.contactName ?? "-"),
            status: statusValue,
            createdBy: String(data.createdByName ?? data.created_by_name ?? data.createdBy ?? data.created_by ?? "관리자"),
            createdAtMs: createdAtDate ? createdAtDate.getTime() : 0,
            createdAtText: createdAtDate ? formatDateTimeLocal(createdAtDate) : "-",
            statusChangedAtText: statusChangedAtDate ? formatDateTimeLocal(statusChangedAtDate) : "-",
          };
        });
        setRows(next);
        setLoading(false);
      },
      (error) => {
        console.error("대리점 담당고객 관리 목록 조회 오류:", error);
        setRows([]);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    const base = !normalizedQuery
      ? rows
      : rows.filter((row) => {
      return (
        row.dealerName.toLowerCase().includes(normalizedQuery) ||
        row.customerName.toLowerCase().includes(normalizedQuery) ||
        row.managerName.toLowerCase().includes(normalizedQuery) ||
        row.status.toLowerCase().includes(normalizedQuery) ||
        row.createdBy.toLowerCase().includes(normalizedQuery)
      );
    });
    return [...base].sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [rows, normalizedQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const effectivePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const sliced = filteredRows.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);
    return [...sliced].reverse();
  }, [filteredRows, effectivePage]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setCurrentPage(1);
      return;
    }
    if (!normalizedQuery) {
      setCurrentPage(totalPages);
    } else {
      setCurrentPage(1);
    }
  }, [normalizedQuery, filteredRows.length, totalPages]);

  const handleDownloadExcel = async () => {
    const XLSX = await import("xlsx");
    const exportSource = [...filteredRows].reverse();
    const exportRows = exportSource.map((row, index) => ({
      번호: filteredRows.length - index,
      대리점: row.dealerName,
      담당고객사: row.customerName,
      담당자: row.managerName,
      현황: row.status,
      최초등록일: row.createdAtText,
      현황변경일: row.statusChangedAtText,
      등록자: row.createdBy,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "대리점담당고객");
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, `dealer-customers-${y}${m}${d}.xlsx`);
  };

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = normalizeUppercaseForEnglish(dealerName);
    const c = normalizeUppercaseForEnglish(customerName);
    const m = normalizeUppercaseForEnglish(managerName);
    if (!d || !c || !m || !status) {
      alert("대리점, 담당고객사, 담당자, 현황을 모두 입력/선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "dealer_customers"), {
        dealerName: d,
        customerName: c,
        managerName: m,
        manager_name: m,
        manager: m,
        contactName: m,
        status,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid ?? "admin",
        createdByName: "관리자",
      });
      setDealerName("");
      setCustomerName("");
      setManagerName("");
      setStatus("");
    } catch (error) {
      console.error("대리점 담당고객 등록 오류:", error);
      alert("등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: DealerCustomerRow) => {
    setEditingId(row.id);
    setEditingDealerName(row.dealerName);
    setEditingCustomerName(row.customerName);
    setEditingManagerName(row.managerName);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingDealerName("");
    setEditingCustomerName("");
    setEditingManagerName("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const d = normalizeUppercaseForEnglish(editingDealerName);
    const c = normalizeUppercaseForEnglish(editingCustomerName);
    const m = normalizeUppercaseForEnglish(editingManagerName);
    if (!d || !c || !m) {
      alert("대리점, 담당고객사, 담당자를 모두 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "dealer_customers", editingId), {
        dealerName: d,
        customerName: c,
        managerName: m,
        manager_name: m,
        manager: m,
        contactName: m,
        updatedAt: serverTimestamp(),
      });
      cancelEdit();
    } catch (error) {
      console.error("대리점 담당고객 수정 오류:", error);
      alert("수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (id: string, name: string) => {
    if (!confirm(`"${name}" 담당고객 정보를 삭제할까요?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "dealer_customers", id));
      if (editingId === id) cancelEdit();
    } catch (error) {
      console.error("대리점 담당고객 삭제 오류:", error);
      alert("삭제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, nextStatus: "업체등록중" | "판매중" | "거래중단중") => {
    const currentRow = rows.find((r) => r.id === id);
    if (!currentRow || currentRow.status === nextStatus) return;
    setUpdatingStatusId(id);
    try {
      await updateDoc(doc(db, "dealer_customers", id), {
        status: nextStatus,
        statusUpdatedAt: serverTimestamp(),
        status_updated_at: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("대리점 담당고객 현황 수정 오류:", error);
      alert("현황 수정 중 오류가 발생했습니다.");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">대리점 담당고객 관리</h1>
            <p className="mt-2 text-gray-600">대리점 담당고객을 등록/수정/삭제합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-100"
            >
              엑셀다운로드
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              새로고침
            </button>
          </div>
        </div>

        <form onSubmit={handleCreate} className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">담당고객 등록</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_180px_auto]">
            <input
              type="text"
              value={dealerName}
              onChange={(e) => setDealerName(e.target.value)}
              placeholder="대리점"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="담당고객사"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <input
              type="text"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder="담당자"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(
                  e.target.value === "판매중"
                    ? "판매중"
                    : e.target.value === "거래중단중"
                      ? "거래중단중"
                      : e.target.value === "업체등록중"
                        ? "업체등록중"
                        : ""
                )
              }
              required
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">-- 선택 --</option>
              <option value="업체등록중">업체등록중</option>
              <option value="판매중">판매중</option>
              <option value="거래중단중">거래중단중</option>
            </select>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              등록
            </button>
          </div>
        </form>

        <div className="mt-4">
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
              placeholder="대리점, 담당고객사, 담당자, 현황, 등록자 검색"
              className="h-11 w-full rounded-md border border-gray-300 bg-white py-2.5 pl-9 pr-10 text-base text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            {searchQuery.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-2 my-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="검색어 지우기"
                title="검색어 지우기"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 01-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">번호</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">대리점</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">담당고객사</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">담당자</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">현황</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">최초등록일</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">현황변경일</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">등록자</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={9}>
                    목록을 불러오는 중입니다...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={9}>
                    {rows.length === 0 ? "등록된 담당고객이 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, index) => {
                  const isEditing = editingId === row.id;
                  const reversedIdx = pagedRows.length - 1 - index;
                  const displayNumber = (effectivePage - 1) * PAGE_SIZE + reversedIdx + 1;
                  return (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{displayNumber}</td>
                      <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingDealerName}
                            onChange={(e) => setEditingDealerName(e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.dealerName
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingCustomerName}
                            onChange={(e) => setEditingCustomerName(e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.customerName
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingManagerName}
                            onChange={(e) => setEditingManagerName(e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          row.managerName
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                        <select
                          value={row.status}
                          onChange={(e) =>
                            updateStatus(
                              row.id,
                              e.target.value === "판매중"
                                ? "판매중"
                                : e.target.value === "거래중단중"
                                  ? "거래중단중"
                                  : "업체등록중"
                            )
                          }
                          disabled={updatingStatusId === row.id}
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="업체등록중">업체등록중</option>
                          <option value="판매중">판매중</option>
                          <option value="거래중단중">거래중단중</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.createdAtText}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.statusChangedAtText}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.createdBy}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={saveEdit}
                                disabled={saving}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={saving}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                disabled={saving}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRow(row.id, row.customerName)}
                                disabled={saving}
                                className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                삭제
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filteredRows.length > 0 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={effectivePage <= 1}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              이전
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                type="button"
                onClick={() => setCurrentPage(pageNum)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  pageNum === effectivePage
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                aria-current={pageNum === effectivePage ? "page" : undefined}
              >
                {pageNum}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={effectivePage >= totalPages}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

