import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { verifyApiIdToken } from '@/lib/auth/verifyApiIdToken';
import {
  compareProductionMachines,
  parseProductionMachine,
  PRODUCTION_MACHINES_COLLECTION,
  type ProductionMachine,
} from '@/lib/production/productionMachines';

function serializeMachine(m: ProductionMachine) {
  return {
    id: m.id,
    location: m.location,
    kind: m.kind,
    unit: m.unit,
    machineName: m.machineName,
    createdAt: m.createdAt?.toISOString() ?? null,
    updatedAt: m.updatedAt?.toISOString() ?? null,
  };
}

/** 로그인 사용자 — 생산요청 기계 선택용 목록 */
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyApiIdToken(request);
    if (!decoded) {
      return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
    }

    const snap = await getAdminDb().collection(PRODUCTION_MACHINES_COLLECTION).get();
    const machines: ProductionMachine[] = [];
    snap.forEach((docSnap) => {
      const parsed = parseProductionMachine(docSnap.id, docSnap.data());
      if (parsed) machines.push(parsed);
    });
    machines.sort(compareProductionMachines);

    return NextResponse.json({ machines: machines.map(serializeMachine) });
  } catch (error) {
    console.error('[production/machines] GET 오류:', error);
    return NextResponse.json({ message: '기계 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
