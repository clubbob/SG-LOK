import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }
  return value;
}

function getAdminStorageBucket(): string {
  const explicit = process.env.FIREBASE_ADMIN_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;
  const publicBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (publicBucket) return publicBucket;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (projectId) return `${projectId}.firebasestorage.app`;
  throw new Error('Storage bucket 환경 변수가 설정되지 않았습니다. FIREBASE_ADMIN_STORAGE_BUCKET 또는 NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET을 설정해주세요.');
}

function getAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  return initializeApp({
    credential: cert({
      projectId: getRequiredEnv('FIREBASE_ADMIN_PROJECT_ID'),
      clientEmail: getRequiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
      privateKey: getRequiredEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
    storageBucket: getAdminStorageBucket(),
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminStorage() {
  return getStorage(getAdminApp());
}

