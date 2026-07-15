import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebaseAdmin';
import {
  ADMIN_NOTIFICATIONS_COLLECTION,
  type AdminNotificationType,
} from '@/lib/adminNotifications';

export async function GET(request: NextRequest) {
  try {
    const adminUid = request.nextUrl.searchParams.get('uid')?.trim() || '';
    if (!adminUid) {
      return NextResponse.json({ error: '관리자 uid가 필요합니다.' }, { status: 400 });
    }

    const db = getAdminDb();
    // 최근 알림을 가져온 뒤, 해당 관리자가 '더 이상 보지 않기' 한 건만 제외
    const snap = await db
      .collection(ADMIN_NOTIFICATIONS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const items = snap.docs
      .map((docSnap) => {
        const data = docSnap.data();
        const dismissedBy = Array.isArray(data.dismissedBy)
          ? data.dismissedBy.filter((v: unknown) => typeof v === 'string')
          : [];
        if (dismissedBy.includes(adminUid)) {
          return null;
        }
        const createdAt = data.createdAt?.toDate?.() || new Date(0);
        return {
          id: docSnap.id,
          type: data.type as AdminNotificationType,
          title: typeof data.title === 'string' ? data.title : '알림',
          message: typeof data.message === 'string' ? data.message : '',
          refId: typeof data.refId === 'string' ? data.refId : undefined,
          createdAt: createdAt.toISOString(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 30);

    return NextResponse.json({ items });
  } catch (error) {
    console.error('관리자 알림 조회 오류:', error);
    return NextResponse.json({ items: [], error: '알림을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type = body?.type;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const refId = typeof body?.refId === 'string' ? body.refId : undefined;

    if (type !== 'production_request' && type !== 'certificate_request') {
      return NextResponse.json({ error: '잘못된 알림 유형입니다.' }, { status: 400 });
    }
    if (!title || !message) {
      return NextResponse.json({ error: '제목과 내용이 필요합니다.' }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = await db.collection(ADMIN_NOTIFICATIONS_COLLECTION).add({
      type,
      title,
      message,
      refId: refId || null,
      dismissedBy: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id });
  } catch (error) {
    console.error('관리자 알림 등록 오류:', error);
    return NextResponse.json({ error: '알림 등록에 실패했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const adminUid = typeof body?.adminUid === 'string' ? body.adminUid.trim() : '';
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown) => typeof id === 'string' && id.length > 0)
      : [];

    if (!adminUid) {
      return NextResponse.json({ error: '관리자 uid가 필요합니다.' }, { status: 400 });
    }
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const db = getAdminDb();
    const batch = db.batch();
    for (const id of ids) {
      batch.update(db.collection(ADMIN_NOTIFICATIONS_COLLECTION).doc(id), {
        dismissedBy: FieldValue.arrayUnion(adminUid),
        dismissedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (error) {
    console.error('관리자 알림 숨김 처리 오류:', error);
    return NextResponse.json({ error: '알림 숨김 처리에 실패했습니다.' }, { status: 500 });
  }
}
