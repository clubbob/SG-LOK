import type { DecodedIdToken } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';
import { hasEffectiveAdminAccess } from '@/lib/auth/adminBootstrap';

export async function verifyApiIdToken(request: NextRequest): Promise<DecodedIdToken | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;
  try {
    return await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return null;
  }
}

export async function verifyApiAdmin(request: NextRequest): Promise<DecodedIdToken | null> {
  const decoded = await verifyApiIdToken(request);
  if (!decoded) return null;

  const requesterDoc = await getAdminDb().collection('users').doc(decoded.uid).get();
  const requesterData = requesterDoc.exists ? requesterDoc.data() : undefined;
  const firestoreIsAdmin =
    requesterData && typeof requesterData.isAdmin === 'boolean' ? requesterData.isAdmin : undefined;
  const allowed = hasEffectiveAdminAccess({
    firestoreIsAdmin,
    email: decoded.email,
  });
  return allowed ? decoded : null;
}
