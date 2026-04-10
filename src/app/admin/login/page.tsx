"use client";

import React, { useEffect, useState } from 'react';
import { Header, Footer } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// Firebase Auth는 Firestore 접근을 위해 필요
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { hasEffectiveAdminAccess } from '@/lib/auth/adminBootstrap';

const ADMIN_SESSION_KEY = 'admin_session';

// 환경 변수에서 관리자 정보 가져오기
const ADMIN_ID = process.env.NEXT_PUBLIC_ADMIN_ID || 'sglok';
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'ssgg3660';
const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@sglok.com';

export default function AdminLoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    id: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accessReady, setAccessReady] = useState(false);

  useEffect(() => {
    const checkAdminEligible = async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser || firebaseUser.isAnonymous) {
        setError('관리자 로그인을 위해선 먼저 사용자 로그인을 해야 합니다.');
        setAccessReady(false);
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
        const profile = userSnap.exists() ? userSnap.data() : null;
        const firestoreIsAdmin =
          profile && typeof profile.isAdmin === 'boolean' ? profile.isAdmin : undefined;
        const allowed = hasEffectiveAdminAccess({
          firestoreIsAdmin,
          email: firebaseUser.email,
        });
        if (!allowed) {
          setError('관리자 기능이 없는 계정입니다.');
          setAccessReady(false);
          return;
        }
        setAccessReady(true);
        setError('');
      } catch (e) {
        console.error('관리자 권한 확인 오류:', e);
        setError('관리자 권한 확인에 실패했습니다.');
        setAccessReady(false);
      }
    };
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      void checkAdminEligible(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!accessReady) {
        setError('관리자 기능이 부여된 사용자만 관리자 로그인을 사용할 수 있습니다.');
        return;
      }
      // 관리자 인증 확인 (아이디와 비밀번호만 확인)
      if (formData.id === ADMIN_ID && formData.password === ADMIN_PASSWORD) {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.isAnonymous) {
          setError('사용자 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.');
          return;
        }
        // 세션 저장 (24시간 유지)
        const sessionData = {
          authenticated: true,
          uid: currentUser.uid,
          timestamp: new Date().getTime(),
          expiresAt: new Date().getTime() + 24 * 60 * 60 * 1000, // 24시간
        };
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(sessionData));

        // 관리자 홈 페이지로 리다이렉트
        router.push('/admin/dashboard');
      } else {
        setError('아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    } catch (error) {
      console.error('로그인 오류:', error);
      setError('로그인에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="flex justify-between items-center mb-4">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  ← 홈으로
                </Button>
              </Link>
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              관리자 로그인
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              관리자 전용 로그인 페이지입니다
            </p>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-semibold">{error}</p>
                </div>
              </div>
            )}
            <div className="space-y-4">
              <Input
                id="id"
                name="id"
                type="text"
                label="아이디"
                required
                value={formData.id}
                onChange={handleChange}
                placeholder="아이디를 입력하세요"
              />
              <Input
                id="password"
                name="password"
                type="password"
                label="비밀번호"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="비밀번호를 입력하세요"
              />
            </div>
            <div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                disabled={!accessReady}
                className="w-full"
              >
                로그인
              </Button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}

