"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import {
  expandAlternateSearchKeys,
  normalizeInstrumentCode,
} from '@/lib/substitute/codeNormalize';
import {
  CONFIDENCE,
  MANUFACTURER,
  MAPPING_STATUS,
  MAPPING_STATUS_LABEL,
  SLOK_CATALOG_URL,
  SOURCE_TYPE,
  SWAGELOK_CATALOG_URL,
} from '@/lib/substitute/constants';
import {
  createMapping,
  deleteMapping,
  fetchMappingHistory,
  searchMappingsBySwagelokCode,
  updateMapping,
} from '@/lib/substitute/firestoreMapping';
import { loadTubeFittingMasterMaps } from '@/lib/substitute/firestoreMasters';
import type { TubeFittingMasterMaps } from '@/lib/substitute/masterTypes';
import { parseTubeFittingCode } from '@/lib/substitute/parseTubeFitting';
import {
  buildSwagelokEnProductPageUrl,
  resolveSwagelokImageUrl,
} from '@/lib/substitute/swagelokProductImage';
import type { SubstituteMappingDoc, SubstituteMappingHistoryEntry } from '@/lib/substitute/types';

function StatusBadge({ status }: { status: string }) {
  const verified = status === MAPPING_STATUS.VERIFIED;
  const candidate = status === MAPPING_STATUS.CANDIDATE;
  const reviewed = status === MAPPING_STATUS.REVIEWED;
  const cls = verified
    ? 'bg-emerald-100 text-emerald-800'
    : reviewed
      ? 'bg-amber-100 text-amber-900'
      : candidate
        ? 'bg-slate-200 text-slate-800'
        : 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {MAPPING_STATUS_LABEL[status as keyof typeof MAPPING_STATUS_LABEL] ?? status}
    </span>
  );
}

function openCatalogPopup(url: string, windowName: string) {
  const w = 1180;
  const h = 820;
  const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - h) / 2));
  window.open(
    url,
    windowName,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
}

function ParseBadge({ status }: { status: string }) {
  const cls =
    status === 'parsed'
      ? 'bg-sky-100 text-sky-900'
      : status === 'partially_parsed'
        ? 'bg-orange-100 text-orange-900'
        : 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

type EditFormState = {
  code_to: string;
  image_url_from: string;
  product_name_from: string;
  product_name_to: string;
  remarks: string;
  source_note: string;
  source_name: string;
  source_url: string;
  confidence: number;
};

export function SubstituteCodeRegisterView({ embedded = false }: { embedded?: boolean }) {
  const { isAuthenticated, loading, user } = useAuth();
  const router = useRouter();
  const canAccessPage = embedded ? Boolean(user) : isAuthenticated;
  const [queryInput, setQueryInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [results, setResults] = useState<SubstituteMappingDoc[]>([]);
  const [lastNormalized, setLastNormalized] = useState<string | null>(null);

  const [masterMaps, setMasterMaps] = useState<TubeFittingMasterMaps | null>(null);
  const [mastersReady, setMastersReady] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SubstituteMappingDoc | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    code_to: '',
    image_url_from: '',
    product_name_from: '',
    product_name_to: '',
    remarks: '',
    source_note: '',
    source_name: '',
    source_url: '',
    confidence: CONFIDENCE.PUBLIC_CROSS_REFERENCE,
  });
  const [saving, setSaving] = useState(false);

  const [histOpen, setHistOpen] = useState(false);
  const [histId, setHistId] = useState<string | null>(null);
  const [histRows, setHistRows] = useState<SubstituteMappingHistoryEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [swagelokImageFailed, setSwagelokImageFailed] = useState(false);
  const [quickSwName, setQuickSwName] = useState('');
  const [quickSlokName, setQuickSlokName] = useState('');
  const [quickSlokCode, setQuickSlokCode] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [officialRef, setOfficialRef] = useState<{
    productPageUrl: string;
    imageUrl: string | null;
    loading: boolean;
  }>({ productPageUrl: '', imageUrl: null, loading: false });

  const manualSwagelokImageUrl = useMemo(
    () =>
      lastNormalized && !searching
        ? resolveSwagelokImageUrl(lastNormalized, results)
        : null,
    [lastNormalized, results, searching]
  );

  const displaySwagelokImageUrl = manualSwagelokImageUrl || officialRef.imageUrl;

  const expandedKeysForSearch = useMemo(
    () => (lastNormalized ? expandAlternateSearchKeys(lastNormalized) : []),
    [lastNormalized]
  );

  /** 현재 검색 키와 일치하는 매핑만 사용. 검색 중·이전 검색 결과 잔상으로 저장 버튼이 잘못 켜지지 않게 함 */
  const primaryMapping = useMemo(() => {
    if (!lastNormalized || searching) return null;
    const relevant = results.filter((r) =>
      expandedKeysForSearch.includes(r.normalized_code_from)
    );
    if (relevant.length === 0) return null;
    return (
      relevant.find((r) => r.normalized_code_from === lastNormalized) ?? relevant[0]
    );
  }, [lastNormalized, results, searching, expandedKeysForSearch]);

  const mappingRegistered = Boolean(primaryMapping);

  useEffect(() => {
    if (!lastNormalized || searching) return;
    const m = primaryMapping;
    if (m) {
      setQuickSwName((m.product_name_from ?? '').toUpperCase());
      setQuickSlokName((m.product_name_to ?? '').toUpperCase());
      setQuickSlokCode((m.code_to ?? '').toUpperCase());
    } else {
      setQuickSwName('');
      setQuickSlokName('');
      setQuickSlokCode('');
    }
  }, [lastNormalized, searching, primaryMapping]);

  useEffect(() => {
    setSwagelokImageFailed(false);
  }, [displaySwagelokImageUrl, lastNormalized]);

  useEffect(() => {
    if (!lastNormalized) {
      setOfficialRef({ productPageUrl: '', imageUrl: null, loading: false });
      return;
    }
    const pageUrl = buildSwagelokEnProductPageUrl(lastNormalized);
    if (searching) {
      setOfficialRef({ productPageUrl: pageUrl, imageUrl: null, loading: true });
      return;
    }
    let cancelled = false;
    setOfficialRef({ productPageUrl: pageUrl, imageUrl: null, loading: true });
    fetch(`/api/swagelok-reference?code=${encodeURIComponent(lastNormalized)}`)
      .then((r) => r.json())
      .then((d: { productPageUrl?: string; imageUrl?: string | null }) => {
        if (cancelled) return;
        setOfficialRef({
          productPageUrl: typeof d.productPageUrl === 'string' ? d.productPageUrl : pageUrl,
          imageUrl: typeof d.imageUrl === 'string' && d.imageUrl ? d.imageUrl : null,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setOfficialRef({ productPageUrl: pageUrl, imageUrl: null, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lastNormalized, searching]);

  useEffect(() => {
    if (!loading && !canAccessPage) {
      router.push(embedded ? '/admin/login' : '/login');
    }
  }, [loading, canAccessPage, embedded, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadTubeFittingMasterMaps(db);
        if (!cancelled) {
          setMasterMaps(maps);
          setMastersReady(true);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setMasterMaps(null);
          setMastersReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const runSearch = useCallback(async () => {
    setError(null);
    setInfo(null);
    const trimmed = queryInput.trim();
    if (!trimmed) {
      setError('Swagelok 코드를 입력하세요.');
      setResults([]);
      setLastNormalized(null);
      setQuickSwName('');
      setQuickSlokName('');
      setQuickSlokCode('');
      return;
    }
    const norm = normalizeInstrumentCode(trimmed);
    setLastNormalized(norm);
    setQuickSwName('');
    setQuickSlokName('');
    setQuickSlokCode('');
    setSearching(true);
    setResults([]);
    try {
      const rows = await searchMappingsBySwagelokCode(db, norm, false);
      setResults(rows);
    } catch (e: unknown) {
      console.error(e);
      setError('검색 중 오류가 발생했습니다. Firestore 규칙·인덱스를 확인하세요.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [queryInput]);

  /** 입력·검색 결과·참고/매핑 영역을 비우고 초기 상태로 (검색은 현재 코드로 다시 조회) */
  const handleRefresh = useCallback(() => {
    setSearching(false);
    setError(null);
    setQueryInput('');
    setResults([]);
    setLastNormalized(null);
    setQuickSwName('');
    setQuickSlokName('');
    setQuickSlokCode('');
    setEditOpen(false);
    setEditing(null);
    setHistOpen(false);
    setHistId(null);
    setHistRows([]);
    setInfo('화면을 초기화했습니다.');
  }, []);

  const openEdit = (m: SubstituteMappingDoc) => {
    setEditing(m);
    setEditForm({
      code_to: m.code_to,
      image_url_from: m.image_url_from ?? '',
      product_name_from: m.product_name_from ?? '',
      product_name_to: m.product_name_to ?? '',
      remarks: m.remarks ?? '',
      source_note: m.source_note ?? '',
      source_name: m.source_name ?? '',
      source_url: m.source_url ?? '',
      confidence: m.confidence,
    });
    setEditOpen(true);
    setError(null);
    setInfo(null);
  };

  const saveEdit = async () => {
    if (!editing || !user?.uid) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const normTo = normalizeInstrumentCode(editForm.code_to);
      await updateMapping(
        db,
        editing.id,
        {
          code_to: editForm.code_to.trim(),
          normalized_code_to: normTo,
          image_url_from: editForm.image_url_from.trim(),
          product_name_from: editForm.product_name_from,
          product_name_to: editForm.product_name_to,
          remarks: editForm.remarks,
          source_note: editForm.source_note,
          source_name: editForm.source_name,
          source_url: editForm.source_url,
          confidence: editForm.confidence,
        },
        user.uid
      );
      setInfo('저장되었습니다. 이력에 기록됩니다.');
      setEditOpen(false);
      setEditing(null);
      await runSearch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '저장 실패';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickSave = async () => {
    if (!user?.uid || !lastNormalized || searching || primaryMapping) return;
    setQuickBusy(true);
    setError(null);
    setInfo(null);
    try {
      const codeTo = quickSlokCode.trim();
      if (!codeTo) {
        setError('S-LOK 제품코드를 입력하세요.');
        return;
      }
      await createMapping(db, {
        manufacturer_from: MANUFACTURER.SWAGELOK,
        code_from: lastNormalized,
        normalized_code_from: lastNormalized,
        image_url_from: '',
        product_name_from: quickSwName.trim(),
        manufacturer_to: MANUFACTURER.SLOK,
        code_to: codeTo,
        normalized_code_to: normalizeInstrumentCode(codeTo),
        product_name_to: quickSlokName.trim(),
        confidence: CONFIDENCE.PUBLIC_CROSS_REFERENCE,
        source_type: SOURCE_TYPE.PUBLIC_CROSS_REFERENCE,
        source_name: 'Code Find',
        source_url: '',
        source_note: '',
        remarks: '',
        status: MAPPING_STATUS.CANDIDATE,
        created_by: user.uid,
        updated_by: user.uid,
      });
      setInfo('저장되었습니다.');
      await runSearch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '저장 실패';
      setError(msg);
    } finally {
      setQuickBusy(false);
    }
  };

  const handleQuickUpdate = async () => {
    if (!user?.uid || !primaryMapping || searching) return;
    setQuickBusy(true);
    setError(null);
    setInfo(null);
    try {
      const codeTo = quickSlokCode.trim();
      if (!codeTo) {
        setError('S-LOK 제품코드를 입력하세요.');
        return;
      }
      await updateMapping(
        db,
        primaryMapping.id,
        {
          product_name_from: quickSwName.trim(),
          code_to: codeTo,
          normalized_code_to: normalizeInstrumentCode(codeTo),
          product_name_to: quickSlokName.trim(),
        },
        user.uid
      );
      setInfo('수정되었습니다.');
      await runSearch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '수정 실패';
      setError(msg);
    } finally {
      setQuickBusy(false);
    }
  };

  const handleQuickDelete = async () => {
    if (!user?.uid || !primaryMapping || searching) return;
    if (!window.confirm('이 매핑을 삭제할까요?')) return;
    setQuickBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteMapping(db, primaryMapping.id, user.uid);
      setInfo('삭제되었습니다.');
      await runSearch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '삭제 실패';
      setError(msg);
    } finally {
      setQuickBusy(false);
    }
  };

  const openHistory = async (id: string) => {
    setHistId(id);
    setHistOpen(true);
    setHistLoading(true);
    setHistRows([]);
    try {
      const h = await fetchMappingHistory(db, id);
      setHistRows(h);
    } catch (e) {
      console.error(e);
      setHistRows([]);
    } finally {
      setHistLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        className={
          embedded ? 'min-h-[40vh] flex items-center justify-center' : 'min-h-screen flex items-center justify-center'
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

  const showNoMappingHelp =
    results.length === 0 && Boolean(lastNormalized) && !searching && !error;

  const masterEmpty =
    mastersReady &&
    masterMaps &&
    masterMaps.materials.size === 0 &&
    masterMaps.families.size === 0 &&
    masterMaps.sizes.size === 0;

  return (
    <div className={embedded ? 'min-h-full bg-gray-50 p-4 sm:p-8' : 'min-h-screen flex flex-col'}>
      {!embedded && <Header />}
      <main className={embedded ? '' : 'flex-1 bg-gray-50'}>
        <div className={embedded ? 'max-w-6xl mx-auto' : 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">코드 등록</h1>
              <p className="text-gray-600 mt-2 text-sm sm:text-base">
                Swagelok 품번을 정확히 입력하면 S-LOK 대체 품번을 표시합니다.
              </p>
            </div>
          </div>

          {masterEmpty && (
            <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              코드 마스터가 비어 있어 파서 보조가 제한됩니다. 관리자{' '}
              <strong>코드 마스터</strong> 화면에서 시드를 넣어 주세요.
            </p>
          )}

          <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label htmlFor="sw-code" className="block text-base font-medium text-gray-700 mb-1">
                  Swagelok 코드
                </label>
                <input
                  id="sw-code"
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder="예: SS-400-1-4"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runSearch}
                  disabled={searching}
                  className="px-5 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {searching ? '검색 중…' : '검색'}
                </button>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="px-5 py-2 rounded-md border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50"
                >
                  새로고침
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-emerald-700">{info}</p>}

            {showNoMappingHelp && (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 space-y-2">
                <p>등록된 매핑이 없습니다. 품번 미등록이거나 표기 차이일 수 있습니다.</p>
              </div>
            )}
          </div>

          {lastNormalized && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Swagelok 제품 참고</h2>
                <button
                  type="button"
                  onClick={() => openCatalogPopup(SWAGELOK_CATALOG_URL, 'swagelok_catalog')}
                  className="self-start px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-800 text-xs sm:text-sm font-medium hover:bg-gray-50 whitespace-nowrap"
                >
                  SWAGELOK 카탈로그
                </button>
              </div>
              {officialRef.productPageUrl ? (
                <p className="mt-2 text-sm">
                  <a
                    href={officialRef.productPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 font-medium hover:underline break-all"
                  >
                    {officialRef.productPageUrl}
                  </a>
                </p>
              ) : null}
              <div className="mt-4 flex flex-col justify-center rounded-md bg-gray-50 p-4 min-h-[140px] items-center gap-2">
                {officialRef.loading && !displaySwagelokImageUrl ? (
                  <p className="text-sm text-gray-500">Swagelok 공식 페이지에서 이미지를 불러오는 중…</p>
                ) : null}
                {displaySwagelokImageUrl && !swagelokImageFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displaySwagelokImageUrl}
                    alt={`Swagelok ${lastNormalized} 참고 이미지`}
                    className="max-h-56 w-auto max-w-full object-contain rounded border border-gray-200 bg-white shadow-sm"
                    onError={() => setSwagelokImageFailed(true)}
                  />
                ) : null}
                {!officialRef.loading && !displaySwagelokImageUrl ? (
                  <p className="text-sm text-gray-500 text-center px-2">
                    공식 페이지에서 이미지 URL을 찾지 못했습니다. 품번이 없거나 페이지 구조가 바뀌었을 수 있습니다.
                    매핑 수정에서 이미지 URL을 직접 넣을 수 있습니다.
                  </p>
                ) : null}
                {!officialRef.loading && displaySwagelokImageUrl && swagelokImageFailed ? (
                  <p className="text-sm text-amber-800 text-center px-2">
                    이미지 표시에 실패했습니다. 링크로 공식 페이지에서 확인하거나, 다른 이미지 URL을 등록해 보세요.
                  </p>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Swagelok® 제품·이미지는 Swagelok 사의 자산입니다. 참고용으로만 사용하세요.
              </p>
            </div>
          )}

          {lastNormalized && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 sm:p-5 shadow-sm space-y-5">
              <h2 className="text-base font-semibold text-gray-900">매핑 입력</h2>
              <p className="text-xs text-gray-500">
                검색 후 표시되는 정규화 Swagelok 코드를 기준으로 저장·수정·삭제합니다. 먼저 위에서 검색하세요.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    Swagelok
                  </h3>
                  <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
                    <label className="block text-sm">
                      <span className="text-gray-600">제품명</span>
                      <input
                        type="text"
                        value={quickSwName}
                        onChange={(e) => setQuickSwName(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="제품명"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-gray-600">제품코드</span>
                      <input
                        type="text"
                        readOnly
                        value={lastNormalized}
                        className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-800"
                      />
                    </label>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      S-LOK
                    </h3>
                    <button
                      type="button"
                      onClick={() => openCatalogPopup(SLOK_CATALOG_URL, 'slok_catalog')}
                      className="self-start px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-800 text-xs sm:text-sm font-medium hover:bg-gray-50 whitespace-nowrap"
                    >
                      S-LOK 카탈로그
                    </button>
                  </div>
                  <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
                    <label className="block text-sm">
                      <span className="text-gray-600">제품명</span>
                      <input
                        type="text"
                        value={quickSlokName}
                        onChange={(e) => setQuickSlokName(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="제품명"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-gray-600">제품코드</span>
                      <input
                        type="text"
                        value={quickSlokCode}
                        onChange={(e) => setQuickSlokCode(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="S-LOK 품번"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                {!mappingRegistered && (
                  <button
                    type="button"
                    onClick={handleQuickSave}
                    disabled={quickBusy || !user?.uid || searching}
                    className={
                      searching
                        ? 'px-4 py-2 rounded-md border border-gray-200 bg-gray-100 text-gray-500 text-sm font-medium cursor-not-allowed'
                        : 'px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50'
                    }
                  >
                    {quickBusy ? '처리 중…' : searching ? '검색 중…' : '저장'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleQuickUpdate}
                  disabled={quickBusy || !user?.uid || !primaryMapping || searching}
                  className="px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={handleQuickDelete}
                  disabled={quickBusy || !user?.uid || !primaryMapping || searching}
                  className="px-4 py-2 rounded-md border border-red-200 bg-red-50 text-red-800 text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
              {!user?.uid && (
                <p className="text-xs text-amber-800">로그인한 계정으로만 저장할 수 있습니다.</p>
              )}
            </div>
          )}

          {results.length > 0 && !mappingRegistered && (
            <>
              <div className="mt-6 rounded-xl border-2 border-blue-200 bg-blue-50/90 px-4 py-4 shadow-sm">
                <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
                  S-LOK 대체 품번
                </p>
                <ul className="mt-3 space-y-3">
                  {results.map((m) => {
                    const code =
                      (m.normalized_code_to && m.normalized_code_to.trim()) ||
                      (m.code_to && m.code_to.trim()) ||
                      '—';
                    return (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-blue-100/80 pb-3 last:border-0 last:pb-0"
                      >
                        <span className="font-mono text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                          {code}
                        </span>
                        <StatusBadge status={m.status} />
                        {m.product_name_to ? (
                          <span className="text-sm text-gray-700">{m.product_name_to}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {results.some((r) => r.status !== MAPPING_STATUS.VERIFIED) && (
                  <p className="mt-3 text-xs text-blue-900/85 border-t border-blue-200/80 pt-3 leading-relaxed">
                    일부는 검증 전(후보·검토)일 수 있습니다. 발주 전 상태·출처·confidence를 확인하세요.
                  </p>
                )}
              </div>

              <div className="mt-4 overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 font-medium">Swagelok</th>
                    <th className="px-3 py-2 font-medium">S-LOK</th>
                    <th className="px-3 py-2 font-medium">confidence</th>
                    <th className="px-3 py-2 font-medium">출처</th>
                    <th className="px-3 py-2 font-medium w-[200px]">파서(보조)</th>
                    <th className="px-3 py-2 font-medium">비고</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((m) => {
                    const parse = parseTubeFittingCode(
                      m.normalized_code_from,
                      mastersReady ? masterMaps : null
                    );
                    return (
                      <tr key={m.id} className="hover:bg-gray-50/80">
                        <td className="px-3 py-2 align-top">
                          <StatusBadge status={m.status} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono text-gray-900">{m.normalized_code_from}</div>
                          {m.product_name_from && (
                            <div className="text-xs text-gray-500 mt-0.5">{m.product_name_from}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono text-gray-900">
                            {(m.normalized_code_to && m.normalized_code_to.trim()) ||
                              (m.code_to && m.code_to.trim()) ||
                              '—'}
                          </div>
                          {m.product_name_to && (
                            <div className="text-xs text-gray-500 mt-0.5">{m.product_name_to}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">{m.confidence}</td>
                        <td className="px-3 py-2 align-top text-xs text-gray-600">
                          <div>{m.source_type}</div>
                          {m.source_name && <div className="mt-0.5">{m.source_name}</div>}
                          {m.source_url && (
                            <a
                              href={m.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline break-all"
                            >
                              링크
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-gray-700">
                          <div className="mb-1">
                            <ParseBadge status={parse.parse_status} />
                          </div>
                          <p className="text-gray-600 leading-snug">{parse.line1}</p>
                          <p className="text-gray-500 mt-0.5 leading-snug">{parse.line2}</p>
                          {parse.parse_notes && (
                            <p className="text-amber-800 mt-0.5">{parse.parse_notes}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700 max-w-[160px]">
                          {m.source_note && <p>{m.source_note}</p>}
                          {m.remarks && <p className="mt-1">{m.remarks}</p>}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => openEdit(m)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => openHistory(m.id)}
                            className="text-gray-600 hover:underline text-xs"
                          >
                            이력
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </main>
      {!embedded && <Footer />}

      {editOpen && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">매핑 수정</h2>
            <p className="text-xs text-gray-500">
              Swagelok 측 품번·상태는 변경할 수 없습니다. S-LOK·이미지 URL·설명 필드를 저장할 수 있습니다.
            </p>
            <p className="text-xs font-mono bg-gray-50 px-2 py-1 rounded">{editing.normalized_code_from}</p>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">Swagelok 참고 이미지 URL (https 또는 /경로)</span>
              <input
                value={editForm.image_url_from}
                onChange={(e) => setEditForm((f) => ({ ...f, image_url_from: e.target.value }))}
                placeholder="https://... 또는 /swagelok-images/SS-400-1-4.png"
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">S-LOK 코드</span>
              <input
                value={editForm.code_to}
                onChange={(e) => setEditForm((f) => ({ ...f, code_to: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">제품명 From</span>
              <input
                value={editForm.product_name_from}
                onChange={(e) => setEditForm((f) => ({ ...f, product_name_from: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">제품명 To</span>
              <input
                value={editForm.product_name_to}
                onChange={(e) => setEditForm((f) => ({ ...f, product_name_to: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">confidence</span>
              <select
                value={editForm.confidence}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, confidence: Number(e.target.value) }))
                }
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value={CONFIDENCE.CATALOG_INFERENCE}>70</option>
                <option value={CONFIDENCE.PUBLIC_CROSS_REFERENCE}>85</option>
                <option value={CONFIDENCE.PUBLIC_AND_CATALOG}>95</option>
                <option value={CONFIDENCE.MANUAL_VERIFIED}>100</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">source_name</span>
              <input
                value={editForm.source_name}
                onChange={(e) => setEditForm((f) => ({ ...f, source_name: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">source_url</span>
              <input
                value={editForm.source_url}
                onChange={(e) => setEditForm((f) => ({ ...f, source_url: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">source_note</span>
              <textarea
                value={editForm.source_note}
                onChange={(e) => setEditForm((f) => ({ ...f, source_note: e.target.value }))}
                rows={2}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 text-xs">remarks</span>
              <textarea
                value={editForm.remarks}
                onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))}
                rows={2}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving || !user?.uid}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {histOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">변경 이력</h2>
              <button
                type="button"
                onClick={() => setHistOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                닫기
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2 font-mono break-all">{histId}</p>
            {histLoading ? (
              <p className="text-sm text-gray-500">불러오는 중…</p>
            ) : histRows.length === 0 ? (
              <p className="text-sm text-gray-500">이력이 없습니다.</p>
            ) : (
              <ul className="space-y-3 text-xs">
                {histRows.map((h, i) => (
                  <li key={i} className="border border-gray-100 rounded-md p-2 bg-gray-50/80">
                    <div className="font-medium text-gray-800">
                      {h.changed_fields?.join(', ')} · {h.changed_by}
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-gray-600 max-h-48 overflow-y-auto">
                      {JSON.stringify({ before: h.before, after: h.after }, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
