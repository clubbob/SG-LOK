'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { useProductionMachines } from '@/hooks/useProductionMachines';
import { getAdminApiAuthHeader } from '@/lib/production/fetchProductionMachines';
import { readResponseJsonSafe } from '@/lib/utils';
import {
  formatProductionMachineName,
  PRODUCTION_MACHINE_KINDS,
  PRODUCTION_MACHINE_LOCATIONS,
  PRODUCTION_MACHINE_UNIT_MAX,
  PRODUCTION_MACHINE_UNIT_MIN,
  productionMachineKey,
  productionMachineSelectClassName,
  type ProductionMachine,
  type ProductionMachineKind,
  type ProductionMachineLocation,
} from '@/lib/production/productionMachines';

const ADMIN_SESSION_KEY = 'admin_session';

const EMPTY_FORM = {
  location: '' as '' | ProductionMachineLocation,
  kind: '' as '' | ProductionMachineKind,
  unit: '',
};

function checkAdminAuth(): boolean {
  if (typeof window === 'undefined') return false;

  const sessionData = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionData?.trim()) return false;

  try {
    const session = JSON.parse(sessionData);
    const now = new Date().getTime();
    if (now > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return session.authenticated === true;
  } catch {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    return false;
  }
}

const unitOptions = Array.from(
  { length: PRODUCTION_MACHINE_UNIT_MAX - PRODUCTION_MACHINE_UNIT_MIN + 1 },
  (_, i) => PRODUCTION_MACHINE_UNIT_MIN + i
);

export default function AdminProductionMachinesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const { machines, loading, error: listError, refetch } = useProductionMachines(ready);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!checkAdminAuth()) {
      router.replace('/admin/login');
      return;
    }
    setReady(true);
  }, [router]);

  const previewName = useMemo(() => {
    if (!form.location || !form.kind || !form.unit) return '';
    const unitNum = Number(form.unit);
    if (!Number.isInteger(unitNum)) return '';
    return formatProductionMachineName(form.location, form.kind, unitNum);
  }, [form]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
  };

  const startEdit = (machine: ProductionMachine) => {
    setEditingId(machine.id);
    setForm({
      location: machine.location,
      kind: machine.kind,
      unit: String(machine.unit),
    });
    setError('');
    setSuccess('');
  };

  const validateForm = (): { location: ProductionMachineLocation; kind: ProductionMachineKind; unit: number } | null => {
    if (!form.location || !form.kind || !form.unit) {
      setError('위치, 종류, 호기를 모두 선택해 주세요.');
      return null;
    }
    const unit = Number(form.unit);
    if (!Number.isInteger(unit) || unit < PRODUCTION_MACHINE_UNIT_MIN || unit > PRODUCTION_MACHINE_UNIT_MAX) {
      setError('호기는 1~100 사이 정수여야 합니다.');
      return null;
    }
    const key = productionMachineKey(form.location, form.kind, unit);
    const duplicate = machines.find((m) => productionMachineKey(m.location, m.kind, m.unit) === key && m.id !== editingId);
    if (duplicate) {
      setError('동일한 위치·종류·호기 조합이 이미 등록되어 있습니다.');
      return null;
    }
    return { location: form.location, kind: form.kind, unit };
  };

  const handleSave = async () => {
    setSuccess('');
    const parsed = validateForm();
    if (!parsed) return;

    setSaving(true);
    setError('');
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAdminApiAuthHeader()),
      };
      const payload = {
        location: parsed.location,
        kind: parsed.kind,
        unit: parsed.unit,
        ...(editingId ? { id: editingId } : {}),
      };
      const res = await fetch('/api/admin/production/machines', {
        method: editingId ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await readResponseJsonSafe<{ message?: string }>(res);
      if (!res.ok) {
        setError(data?.message || (editingId ? '수정에 실패했습니다.' : '등록에 실패했습니다.'));
        return;
      }
      setSuccess(editingId ? '기계 정보를 수정했습니다.' : '기계를 등록했습니다.');
      resetForm();
      refetch();
    } catch (e) {
      console.error(e);
      setError(editingId ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (machine: ProductionMachine) => {
    if (!window.confirm(`「${machine.machineName}」 기계를 삭제할까요?`)) return;
    setError('');
    setSuccess('');
    try {
      const headers = await getAdminApiAuthHeader();
      const res = await fetch(
        `/api/admin/production/machines?id=${encodeURIComponent(machine.id)}`,
        { method: 'DELETE', headers }
      );
      const data = await readResponseJsonSafe<{ message?: string }>(res);
      if (!res.ok) {
        setError(data?.message || '삭제에 실패했습니다.');
        return;
      }
      if (editingId === machine.id) resetForm();
      setSuccess('기계를 삭제했습니다.');
      refetch();
    } catch (e) {
      console.error(e);
      setError('삭제에 실패했습니다.');
    }
  };

  if (!ready) {
    return (
      <div className="p-4 sm:p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-gray-600">로딩 중...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">기계 관리</h1>
        <p className="text-gray-600 mt-2 text-sm sm:text-base">
          생산요청 승인·수정 시 선택할 기계를 등록합니다. 기계명은 위치·종류 코드·호기로 자동 생성됩니다. (예: AC1, CB1)
        </p>
      </div>

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}
      {listError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {listError}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">{editingId ? '기계 수정' : '기계 등록'}</h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="machine-location" className="block text-sm font-medium text-gray-700 mb-2">
                위치
              </label>
              <select
                id="machine-location"
                value={form.location}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value as ProductionMachineLocation | '' }))}
                className={productionMachineSelectClassName}
              >
                <option value="">선택</option>
                {PRODUCTION_MACHINE_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="machine-kind" className="block text-sm font-medium text-gray-700 mb-2">
                종류
              </label>
              <select
                id="machine-kind"
                value={form.kind}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ProductionMachineKind | '' }))}
                className={productionMachineSelectClassName}
              >
                <option value="">선택</option>
                {PRODUCTION_MACHINE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="machine-unit" className="block text-sm font-medium text-gray-700 mb-2">
                호기
              </label>
              <select
                id="machine-unit"
                value={form.unit}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className={productionMachineSelectClassName}
              >
                <option value="">선택</option>
                {unitOptions.map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">기계명</label>
              <div
                className="flex min-h-[38px] items-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900"
                aria-live="polite"
              >
                {previewName || <span className="text-gray-400">선택 후 표시</span>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 lg:pb-0.5">
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {editingId ? '수정 저장' : '등록'}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                취소
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">등록된 기계 ({machines.length})</h2>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-gray-500">목록을 불러오는 중…</p>
        ) : machines.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">등록된 기계가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">위치</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">종류</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">호기</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">기계명</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {machines.map((machine) => (
                  <tr key={machine.id} className={editingId === machine.id ? 'bg-blue-50' : undefined}>
                    <td className="px-4 py-3 text-gray-900">{machine.location}</td>
                    <td className="px-4 py-3 text-gray-900">{machine.kind}</td>
                    <td className="px-4 py-3 text-gray-900">{machine.unit}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{machine.machineName}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button type="button" variant="outline" size="sm" className="mr-2" onClick={() => startEdit(machine)}>
                        수정
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleDelete(machine)}>
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
