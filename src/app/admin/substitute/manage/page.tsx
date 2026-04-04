"use client";

import React, { useCallback, useState } from 'react';
import substituteMappingsSeed from '@/data/substituteMappingsSeed.json';
import { db } from '@/lib/firebase';
import { normalizeInstrumentCode } from '@/lib/substitute/codeNormalize';
import {
  CONFIDENCE,
  MANUFACTURER,
  MAPPING_STATUS,
  SOURCE_TYPE,
  type MappingStatus,
  type ManufacturerId,
} from '@/lib/substitute/constants';
import { downloadMappingsAsXlsx } from '@/lib/substitute/exportXlsx';
import {
  adminSearchByNormalizedFrom,
  createMapping,
  fetchAllMappings,
  updateMapping,
  upsertSeedMapping,
  type MappingWritePayload,
} from '@/lib/substitute/firestoreMapping';
import type { SubstituteMappingDoc } from '@/lib/substitute/types';

const ACTOR = 'admin';

function formatMappingUpdatedAt(ts: SubstituteMappingDoc['updated_at']): string {
  if (!ts) return '—';
  try {
    const d =
      typeof (ts as { toDate?: () => Date }).toDate === 'function'
        ? (ts as { toDate: () => Date }).toDate()
        : new Date(
            ((ts as { seconds?: number }).seconds ?? 0) * 1000 +
              Math.floor(((ts as { nanoseconds?: number }).nanoseconds ?? 0) / 1e6)
          );
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

const emptyForm: MappingWritePayload = {
  manufacturer_from: MANUFACTURER.SWAGELOK,
  code_from: '',
  normalized_code_from: '',
  image_url_from: '',
  product_name_from: '',
  manufacturer_to: MANUFACTURER.SLOK,
  code_to: '',
  normalized_code_to: '',
  product_name_to: '',
  confidence: CONFIDENCE.PUBLIC_CROSS_REFERENCE,
  source_type: SOURCE_TYPE.PUBLIC_CROSS_REFERENCE,
  source_name: '',
  source_url: '',
  source_note: '',
  remarks: '',
  status: MAPPING_STATUS.CANDIDATE,
  updated_by: ACTOR,
  created_by: ACTOR,
};

export default function AdminSubstituteManagePage() {
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SubstituteMappingDoc[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MappingWritePayload>(emptyForm);

  const runSearch = useCallback(async () => {
    setError(null);
    setMessage(null);
    const norm = normalizeInstrumentCode(searchInput.trim());
    if (!norm) {
      setError('검색할 Swagelok 코드를 입력하세요.');
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await adminSearchByNormalizedFrom(db, norm, 'all');
      setRows(list);
    } catch (e) {
      console.error(e);
      setError('조회 실패. Firestore 인덱스·규칙을 확인하세요.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [searchInput]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, created_by: ACTOR, updated_by: ACTOR });
    setModalOpen(true);
    setError(null);
  };

  const openEdit = (m: SubstituteMappingDoc) => {
    setEditingId(m.id);
    setForm({
      manufacturer_from: m.manufacturer_from as ManufacturerId,
      code_from: m.code_from,
      normalized_code_from: m.normalized_code_from,
      image_url_from: m.image_url_from ?? '',
      product_name_from: m.product_name_from ?? '',
      manufacturer_to: m.manufacturer_to as ManufacturerId,
      code_to: m.code_to,
      normalized_code_to: m.normalized_code_to,
      product_name_to: m.product_name_to ?? '',
      confidence: m.confidence,
      source_type: m.source_type,
      source_name: m.source_name ?? '',
      source_url: m.source_url ?? '',
      source_note: m.source_note ?? '',
      remarks: m.remarks ?? '',
      status: m.status as MappingStatus,
      created_by: m.created_by ?? ACTOR,
      updated_by: ACTOR,
    });
    setModalOpen(true);
    setError(null);
  };

  const saveModal = async () => {
    setError(null);
    setMessage(null);
    try {
      if (!form.code_from.trim() || !form.code_to.trim()) {
        setError('From/To 코드를 입력하세요.');
        return;
      }
      const payload = {
        ...form,
        normalized_code_from: normalizeInstrumentCode(form.code_from),
        normalized_code_to: normalizeInstrumentCode(form.code_to),
        updated_by: ACTOR,
      };
      if (editingId) {
        await updateMapping(db, editingId, payload, ACTOR);
        setMessage('저장되었습니다.');
      } else {
        await createMapping(db, { ...payload, created_by: ACTOR });
        setMessage('등록되었습니다.');
      }
      setModalOpen(false);
      await runSearch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '저장 실패';
      setError(msg);
    }
  };

  const exportAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAllMappings(db);
      downloadMappingsAsXlsx(all, `substitute-admin-all-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setMessage(`Excel 저장 (${all.length}건)`);
    } catch (e) {
      console.error(e);
      setError('보내기 실패');
    } finally {
      setLoading(false);
    }
  };

  const runSeed = async () => {
    setLoading(true);
    setError(null);
    let ins = 0;
    let skip = 0;
    try {
      for (const row of substituteMappingsSeed as Record<string, unknown>[]) {
        const r = await upsertSeedMapping(db, row, ACTOR);
        if (r === 'inserted') ins++;
        else skip++;
      }
      setMessage(`시드 완료: 신규 ${ins}건, 스킵(기존) ${skip}건`);
      if (searchInput.trim()) await runSearch();
    } catch (e) {
      console.error(e);
      setError('시드 중 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">대체품관리</h1>
          <p className="text-gray-600 mt-1 text-sm">Swagelok 대체품 코드입니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            신규 등록
          </button>
          <button
            type="button"
            onClick={exportAll}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            전체 Excel
          </button>
          <button
            type="button"
            onClick={runSeed}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            번들 시드 넣기
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Swagelok 코드</label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="예: SS-400-1-4"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? '처리 중…' : '검색'}
          </button>
        </div>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">SWAGELOK 제품명</th>
              <th className="px-3 py-2 font-medium">SWAGELOK 제품코드</th>
              <th className="px-3 py-2 font-medium">S-LOK 제품명</th>
              <th className="px-3 py-2 font-medium">S-LOK 제품코드</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">최근 수정일</th>
              <th className="px-3 py-2 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50/80">
                  <td className="px-3 py-2 text-sm text-gray-800 max-w-[200px]">
                    {m.product_name_from?.trim() ? m.product_name_from : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm">{m.normalized_code_from}</td>
                  <td className="px-3 py-2 text-sm text-gray-800 max-w-[200px]">
                    {m.product_name_to?.trim() ? m.product_name_to : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm">{m.normalized_code_to}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">
                    {formatMappingUpdatedAt(m.updated_at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(m)}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {editingId ? '매핑 수정' : '매핑 등록'}
            </h2>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <label className="block">
                <span className="text-gray-600 text-xs font-medium">SWAGELOK 제품명</span>
                <input
                  value={form.product_name_from}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, product_name_from: e.target.value.toUpperCase() }))
                  }
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs font-medium">SWAGELOK 제품코드</span>
                <input
                  value={form.code_from}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code_from: e.target.value.toUpperCase() }))
                  }
                  disabled={!!editingId}
                  placeholder="예: SS-400-1-4"
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm disabled:bg-gray-100"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs font-medium">S-LOK 제품명</span>
                <input
                  value={form.product_name_to}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, product_name_to: e.target.value.toUpperCase() }))
                  }
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs font-medium">S-LOK 제품코드</span>
                <input
                  value={form.code_to}
                  onChange={(e) => setForm((f) => ({ ...f, code_to: e.target.value.toUpperCase() }))}
                  placeholder="S-LOK 품번"
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs font-medium">비고</span>
                <textarea
                  value={form.remarks}
                  onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                  rows={3}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveModal}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
