import { auth } from '@/lib/firebase';
import type { ProductionMachine } from '@/lib/production/productionMachines';

type MachineApiRow = {
  id: string;
  location: ProductionMachine['location'];
  kind: ProductionMachine['kind'];
  unit: number;
  machineName: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export async function fetchProductionMachinesFromApi(): Promise<ProductionMachine[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const idToken = await user.getIdToken();
  const res = await fetch('/api/production/machines', {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || '기계 목록을 불러오지 못했습니다.');
  }

  const data = (await res.json()) as { machines?: MachineApiRow[] };
  const rows = Array.isArray(data.machines) ? data.machines : [];

  return rows.map((row) => ({
    id: row.id,
    location: row.location,
    kind: row.kind,
    unit: row.unit,
    machineName: row.machineName,
    createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
  }));
}

export async function getAdminApiAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const idToken = await user.getIdToken();
  return { Authorization: `Bearer ${idToken}` };
}
