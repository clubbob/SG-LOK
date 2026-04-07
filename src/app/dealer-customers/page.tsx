"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Header, Footer } from "@/components/layout";
import { collection, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

type DealerCustomerRow = {
  id: string;
  dealerName: string;
  customerName: string;
  managerName: string;
  status: "업체등록중" | "판매중" | "거래중단중";
  createdAt: Date | null;
  statusUpdatedAt: Date | null;
  createdBy: string;
};

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "object" && value !== null && "toDate" in (value as Record<string, unknown>)) {
    const maybeTimestamp = value as { toDate: () => Date };
    return maybeTimestamp.toDate();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export default function DealerCustomersPage() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<DealerCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRows([]);
      setLoading(false);
      setPermissionDenied(false);
      return;
    }

    const q = query(collection(db, "dealer_customers"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
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
            createdAt: toDateOrNull(data.createdAt ?? data.created_at),
            statusUpdatedAt: toDateOrNull(data.statusUpdatedAt ?? data.status_updated_at),
            createdBy: String(data.createdByName ?? data.created_by_name ?? data.createdBy ?? data.created_by ?? "-"),
          };
        });
        setRows(next);
        setPermissionDenied(false);
        setLoading(false);
      },
      (error: { code?: string }) => {
        if (error?.code === "permission-denied") {
          setPermissionDenied(true);
        } else {
          console.error("대리점 담당고객 목록 조회 오류:", error);
        }
        setRows([]);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [authLoading, user]);

  const hasRows = useMemo(() => rows.length > 0, [rows]);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows;
    return rows.filter((row) => {
      const dealer = row.dealerName.toLowerCase();
      const customer = row.customerName.toLowerCase();
      const managerName = row.managerName.toLowerCase();
      const status = row.status.toLowerCase();
      const registrant = row.createdBy.toLowerCase();
      return (
        dealer.includes(normalizedQuery) ||
        customer.includes(normalizedQuery) ||
        managerName.includes(normalizedQuery) ||
        status.includes(normalizedQuery) ||
        registrant.includes(normalizedQuery)
      );
    });
  }, [rows, normalizedQuery]);
  const hasFilteredRows = filteredRows.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">대리점 담당고객</h1>
              <p className="mt-2 text-gray-600">관리자에서 등록/수정한 담당고객 목록입니다.</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              새로고침
            </button>
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
                placeholder="대리점, 담당고객사, 담당자, 현황, 등록자 검색"
                className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                disabled={searchQuery.trim().length === 0}
                className="absolute inset-y-0 right-2 my-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-default disabled:opacity-40"
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
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 sm:p-8">
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[760px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">대리점</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">담당고객사</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">담당자</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">현황</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">최초등록일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">현황변경일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">등록자</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-gray-500" colSpan={7}>
                        목록을 불러오는 중입니다...
                      </td>
                    </tr>
                  ) : !user ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-gray-500" colSpan={7}>
                        목록 조회는 로그인 후 사용할 수 있습니다.
                      </td>
                    </tr>
                  ) : permissionDenied ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-red-600" colSpan={7}>
                        조회 권한이 없습니다. 관리자에게 권한을 요청해 주세요.
                      </td>
                    </tr>
                  ) : !hasRows ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-gray-500" colSpan={7}>
                        등록된 담당고객이 없습니다.
                      </td>
                    </tr>
                  ) : !hasFilteredRows ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-gray-500" colSpan={7}>
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">{row.dealerName}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">{row.customerName}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.managerName}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.status}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {row.createdAt ? formatDateTimeLocal(row.createdAt) : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {row.statusUpdatedAt ? formatDateTimeLocal(row.statusUpdatedAt) : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.createdBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

