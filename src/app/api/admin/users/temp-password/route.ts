import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';
import { hasEffectiveAdminAccess } from '@/lib/auth/adminBootstrap';

function createTempPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminDb();
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ message: '인증 토큰이 필요합니다.' }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const decoded = await adminAuth.verifyIdToken(idToken);
    const requesterUid = decoded.uid;

    const requesterDoc = await adminDb.collection('users').doc(requesterUid).get();
    const requesterData = requesterDoc.exists ? requesterDoc.data() : undefined;
    const firestoreIsAdmin =
      requesterData && typeof requesterData.isAdmin === 'boolean' ? requesterData.isAdmin : undefined;
    const hasAdminAccess = hasEffectiveAdminAccess({
      firestoreIsAdmin,
      email: decoded.email,
    });

    if (!hasAdminAccess) {
      return NextResponse.json({ message: '관리자 권한이 없습니다.' }, { status: 403 });
    }

    const { targetUserId } = (await request.json()) as { targetUserId?: string };
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ message: '대상 사용자 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const tempPassword = createTempPassword();
    await adminAuth.updateUser(targetUserId, { password: tempPassword });

    await adminDb.collection('users').doc(targetUserId).set(
      {
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({ tempPassword });
  } catch (error) {
    console.error('[temp-password] 발급 오류:', error);
    return NextResponse.json({ message: '임시 비밀번호 발급 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

