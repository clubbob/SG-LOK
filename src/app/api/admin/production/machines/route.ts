import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { verifyApiAdmin } from '@/lib/auth/verifyApiIdToken';
import {
  formatProductionMachineName,
  PRODUCTION_MACHINE_KINDS,
  PRODUCTION_MACHINE_LOCATIONS,
  PRODUCTION_MACHINE_UNIT_MAX,
  PRODUCTION_MACHINE_UNIT_MIN,
  PRODUCTION_MACHINES_COLLECTION,
  productionMachineKey,
  type ProductionMachineKind,
  type ProductionMachineLocation,
} from '@/lib/production/productionMachines';

function parseMachineFields(body: Record<string, unknown>): {
  location: ProductionMachineLocation;
  kind: ProductionMachineKind;
  unit: number;
} | { error: string } {
  const location = body.location;
  const kind = body.kind;
  const unitRaw = body.unit;

  if (
    typeof location !== 'string' ||
    !PRODUCTION_MACHINE_LOCATIONS.includes(location as ProductionMachineLocation)
  ) {
    return { error: '위치를 선택해 주세요.' };
  }
  if (typeof kind !== 'string' || !PRODUCTION_MACHINE_KINDS.includes(kind as ProductionMachineKind)) {
    return { error: '종류를 선택해 주세요.' };
  }
  const unit =
    typeof unitRaw === 'number'
      ? unitRaw
      : typeof unitRaw === 'string'
        ? Number.parseInt(unitRaw, 10)
        : NaN;
  if (!Number.isInteger(unit) || unit < PRODUCTION_MACHINE_UNIT_MIN || unit > PRODUCTION_MACHINE_UNIT_MAX) {
    return { error: '호기는 1~100 사이 정수여야 합니다.' };
  }

  return {
    location: location as ProductionMachineLocation,
    kind: kind as ProductionMachineKind,
    unit,
  };
}

async function assertNoDuplicate(
  location: ProductionMachineLocation,
  kind: ProductionMachineKind,
  unit: number,
  excludeId?: string
): Promise<string | null> {
  const key = productionMachineKey(location, kind, unit);
  const snap = await getAdminDb().collection(PRODUCTION_MACHINES_COLLECTION).get();
  for (const docSnap of snap.docs) {
    if (excludeId && docSnap.id === excludeId) continue;
    const data = docSnap.data();
    if (
      data.location === location &&
      data.kind === kind &&
      data.unit === unit &&
      productionMachineKey(
        data.location as ProductionMachineLocation,
        data.kind as ProductionMachineKind,
        data.unit as number
      ) === key
    ) {
      return '동일한 위치·종류·호기 조합이 이미 등록되어 있습니다.';
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await verifyApiAdmin(request);
    if (!admin) {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseMachineFields(body);
    if ('error' in parsed) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }

    const dup = await assertNoDuplicate(parsed.location, parsed.kind, parsed.unit);
    if (dup) {
      return NextResponse.json({ message: dup }, { status: 409 });
    }

    const machineName = formatProductionMachineName(parsed.location, parsed.kind, parsed.unit);
    const docRef = await getAdminDb().collection(PRODUCTION_MACHINES_COLLECTION).add({
      location: parsed.location,
      kind: parsed.kind,
      unit: parsed.unit,
      machineName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id, machineName });
  } catch (error) {
    console.error('[admin/production/machines] POST 오류:', error);
    return NextResponse.json({ message: '기계 등록에 실패했습니다.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await verifyApiAdmin(request);
    if (!admin) {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ message: '기계 ID가 필요합니다.' }, { status: 400 });
    }

    const parsed = parseMachineFields(body);
    if ('error' in parsed) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }

    const dup = await assertNoDuplicate(parsed.location, parsed.kind, parsed.unit, id);
    if (dup) {
      return NextResponse.json({ message: dup }, { status: 409 });
    }

    const machineName = formatProductionMachineName(parsed.location, parsed.kind, parsed.unit);
    const ref = getAdminDb().collection(PRODUCTION_MACHINES_COLLECTION).doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ message: '기계를 찾을 수 없습니다.' }, { status: 404 });
    }

    await ref.update({
      location: parsed.location,
      kind: parsed.kind,
      unit: parsed.unit,
      machineName,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id, machineName });
  } catch (error) {
    console.error('[admin/production/machines] PUT 오류:', error);
    return NextResponse.json({ message: '기계 수정에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifyApiAdmin(request);
    if (!admin) {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const id = request.nextUrl.searchParams.get('id')?.trim() || '';
    if (!id) {
      return NextResponse.json({ message: '기계 ID가 필요합니다.' }, { status: 400 });
    }

    const ref = getAdminDb().collection(PRODUCTION_MACHINES_COLLECTION).doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ message: '기계를 찾을 수 없습니다.' }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[admin/production/machines] DELETE 오류:', error);
    return NextResponse.json({ message: '기계 삭제에 실패했습니다.' }, { status: 500 });
  }
}
