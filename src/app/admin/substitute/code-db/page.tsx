"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import swagelokCatalogSeed from "@/data/swagelokCatalogTubeFittingSeed.json";
import { db } from "@/lib/firebase";
import { ensureFirebaseAuthForAdmin } from "@/lib/ensureFirebaseAuthForAdmin";
import { TUBE_FITTING_CATEGORY } from "@/lib/substitute/constants";
import { normalizeInstrumentCode } from "@/lib/substitute/codeNormalize";
import {
  fetchSwagelokCatalogParts,
  upsertSwagelokCatalogFromSeed,
  type SwagelokCatalogSeedRow,
} from "@/lib/substitute/firestoreSwagelokCatalog";
import type { SwagelokCatalogPartDoc } from "@/lib/substitute/types";
import type { Firestore } from "firebase/firestore";

const SEED_ROWS = swagelokCatalogSeed as SwagelokCatalogSeedRow[];

let catalogSeedMergePromise: Promise<number> | null = null;

async function mergeCatalogSeedOnce(firestore: Firestore): Promise<number> {
  await ensureFirebaseAuthForAdmin();
  if (!catalogSeedMergePromise) {
    catalogSeedMergePromise = upsertSwagelokCatalogFromSeed(firestore, SEED_ROWS).finally(() => {
      catalogSeedMergePromise = null;
    });
  }
  return catalogSeedMergePromise;
}

function isTubeFittingRow(r: SwagelokCatalogPartDoc): boolean {
  const c = r.product_category?.trim();
  return !c || c === TUBE_FITTING_CATEGORY;
}

/** SS-600-1-4, SS-2M0-6-2 처럼 주문번호로 보이는 검색인지 (부분 일치 금지 모드용) */
function looksLikeSwagelokOrderingQuery(normalized: string): boolean {
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length < 3) return false;
  const body = parts[1];
  if (/^\d{3,4}[A-Z]?$/.test(body)) return true;
  if (/^\d{1,2}M\d+$/.test(body)) return true;
  return false;
}

export default function AdminSubstituteCodeDbPage() {
  const [rows, setRows] = useState<SwagelokCatalogPartDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useRef(true);
  const autoPopulateAttemptedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      await ensureFirebaseAuthForAdmin();
      const list = await fetchSwagelokCatalogParts(db);
      setRows(list);
    } catch (e) {
      console.error(e);
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "permission-denied") {
        setErr(
          "Firestore 권한이 없습니다. (1) Firebase Console → Authentication → **익명** 사용 설정 (2) Firestore 규칙에 `swagelok_catalog_parts` 읽기·쓰기 블록 추가 — `FIRESTORE_SECURITY_RULES.md` 참고 후 규칙 **게시**."
        );
      } else {
        setErr("목록을 불러오지 못했습니다. 네트워크·로그인을 확인하세요.");
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (rows.length > 0) return;
    if (autoPopulateAttemptedRef.current) return;
    autoPopulateAttemptedRef.current = true;

    (async () => {
      setSyncing(true);
      setErr(null);
      setMsg(null);
      try {
        const n = await mergeCatalogSeedOnce(db);
        if (!mounted.current) return;
        await refresh();
        if (!mounted.current) return;
        setMsg(
          `DB가 비어 있어 ${n}건을 자동 등록했습니다. (Swagelok · ${TUBE_FITTING_CATEGORY}, SS 번들)`
        );
      } catch (e) {
        console.error(e);
        if (mounted.current) {
          setErr(
            "자동 등록에 실패했습니다. Firestore 규칙(swagelok_catalog_parts 쓰기 허용)을 확인한 뒤 「번들 시드로 DB 동기화」를 눌러 주세요."
          );
        }
      } finally {
        if (mounted.current) setSyncing(false);
      }
    })();
  }, [loading, rows.length, refresh]);

  const tubeRows = useMemo(() => rows.filter(isTubeFittingRow), [rows]);

  const filtered = useMemo(() => {
    const raw = q.trim();
    if (!raw) return tubeRows;

    const norm = normalizeInstrumentCode(raw);
    if (norm && looksLikeSwagelokOrderingQuery(norm)) {
      return tubeRows.filter((r) => r.normalized_code === norm);
    }

    const s = raw.toLowerCase();
    return tubeRows.filter(
      (r) =>
        r.product_name.toLowerCase().includes(s) ||
        (r.category_path?.toLowerCase().includes(s) ?? false)
    );
  }, [tubeRows, q]);

  const runSyncSeed = async () => {
    setSyncing(true);
    setMsg(null);
    setErr(null);
    try {
      const n = await mergeCatalogSeedOnce(db);
      setMsg(`시드 동기화 완료: ${n}건 merge 저장 (Swagelok · ${TUBE_FITTING_CATEGORY})`);
      await refresh();
    } catch (e) {
      console.error(e);
      setErr("시드 저장 실패. Firestore에 swagelok_catalog_parts 쓰기 권한이 있는지 확인하세요.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">코드 DB</h1>
      <p className="text-gray-600 mt-2 text-sm max-w-3xl">
        <strong>Swagelok</strong> 제품 중 범주 <strong>{TUBE_FITTING_CATEGORY}</strong>의{" "}
        <strong>제품코드</strong>(주문번호)와 <strong>제품명</strong>을 조회합니다. Firestore 컬렉션{" "}
        <code className="text-xs bg-gray-100 px-1 rounded">swagelok_catalog_parts</code> 를
        사용합니다. DB가 비어 있으면 이 페이지를 열 때 시드가 자동으로 올라갑니다. 주문번호 검색은 정규화 후{" "}
        <strong>한 건과 완전 일치</strong>할 때만 표시합니다(예: <code className="text-xs bg-gray-100 px-1 rounded">SS-600-1-4</code> → 접미
        옵션이 다른 품번은 나오지 않음).
      </p>
      <p className="mt-2 text-xs text-gray-500">
        강제 동기화: 아래 버튼 또는 서버{" "}
        <code className="bg-gray-100 px-1 rounded">npm run import:swagelok-catalog</code>. 예전에
        올라간 접미 변형 문서만 지우려면 서비스 계정으로{" "}
        <code className="bg-gray-100 px-1 rounded">npm run prune:swagelok-catalog-firestore</code> (
        <code className="bg-gray-100 px-1 rounded">--dry-run</code> 으로 목록만 확인).
      </p>

      <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주문번호는 정확히 일치 (예: SS-600-1-4) · 그 외는 제품명·섹션 검색"
          className="w-full sm:flex-1 sm:min-w-[200px] max-w-xl border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            type="button"
            onClick={runSyncSeed}
            disabled={syncing}
            className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {syncing ? "저장 중…" : `번들 시드로 DB 동기화 (${SEED_ROWS.length}건)`}
          </button>
        </div>
      </div>

      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 text-sm text-gray-600">
        {loading ? (
          "불러오는 중…"
        ) : (
          <>
            Tube Fitting <strong>{tubeRows.length}</strong>건 · 표시 <strong>{filtered.length}</strong>건
            {tubeRows.length < rows.length ? (
              <span className="text-amber-700 ml-1">
                (전체 {rows.length}건 중 Tube Fitting 외 {rows.length - tubeRows.length}건은 숨김)
              </span>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="text-left font-semibold px-3 py-2 border-b w-[1%] whitespace-nowrap">
                  제품코드
                </th>
                <th className="text-left font-semibold px-3 py-2 border-b">제품명</th>
                <th className="text-left font-semibold px-3 py-2 border-b text-gray-600">
                  세부(섹션)
                </th>
                <th className="text-left font-semibold px-3 py-2 border-b text-gray-500 text-xs font-normal">
                  정규화코드
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/80">
                  <td className="px-3 py-2 font-mono text-xs sm:text-sm whitespace-nowrap align-top">
                    {r.product_code}
                  </td>
                  <td className="px-3 py-2 text-gray-800 align-top">{r.product_name}</td>
                  <td className="px-3 py-2 text-gray-600 align-top text-xs sm:text-sm">
                    {r.category_path ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400 align-top">{r.normalized_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !syncing && filtered.length === 0 && (
          <p className="p-6 text-center text-gray-500 text-sm">
            데이터가 없습니다. 자동 등록이 실패했다면 위 「번들 시드로 DB 동기화」를 눌러 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
