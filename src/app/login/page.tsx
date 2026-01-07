"use client";

import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp, Timestamp, getDoc } from 'firebase/firestore';
import { Button, Input } from '@/components/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';

const SAVED_EMAIL_KEY = 'sglok_saved_email';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading, userProfile } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [rememberEmail, setRememberEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [isRedirecting, setIsRedirecting] = useState(false);

  // 이미 로그인된 사용자는 메인 페이지로 리다이렉트 (window.location 사용하여 전체 리로드)
  useEffect(() => {
    if (!authLoading && isAuthenticated && !isRedirecting) {
      setIsRedirecting(true);
      window.location.href = '/';
    }
  }, [isAuthenticated, authLoading, isRedirecting]);

  // 페이지 로드 시 저장된 이메일 불러오기
  useEffect(() => {
    const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
    if (savedEmail) {
      setFormData(prev => ({ ...prev, email: savedEmail }));
      setRememberEmail(true);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    if (error) setError('');
    // 필드별 에러 초기화
    if (fieldErrors[e.target.name as keyof typeof fieldErrors]) {
      setFieldErrors({
        ...fieldErrors,
        [e.target.name]: undefined
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const credential = await signInWithEmailAndPassword(auth, formData.email, formData.password);

      // 관리자 승인 여부 및 세션 확인 (트랜잭션으로 원자적 처리)
      try {
        // 트랜잭션으로 세션 체크 및 업데이트를 원자적으로 처리
        const result = await runTransaction(db, async (transaction) => {
          const userRef = doc(db, 'users', credential.user.uid);
          const userDoc = await transaction.get(userRef);
          
          if (!userDoc.exists()) {
            throw new Error('USER_NOT_FOUND');
          }
          
          const data = userDoc.data() as { approved?: boolean; sessionId?: string; lastLoginAt?: Timestamp };
          
          // 관리자 승인 여부 확인
          if (!data || data.approved === false) {
            throw new Error('NOT_APPROVED');
          }
          
          // 새 세션 ID 생성 및 저장 (항상 새 세션으로 로그인 허용)
          const newSessionId = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
          
          // 트랜잭션으로 세션 정보 업데이트
          transaction.update(userRef, {
            sessionId: newSessionId,
            lastLoginAt: serverTimestamp(),
          });
          
          return newSessionId;
        });
        
        // localStorage에 세션 ID 저장 (트랜잭션 성공 후)
        localStorage.setItem(`session_${credential.user.uid}`, result);
        
      } catch (profileError: unknown) {
        await auth.signOut();
        setLoading(false);
        
        const errorMessage = profileError instanceof Error ? profileError.message : '';
        
        if (errorMessage === 'NOT_APPROVED') {
          setError('회원가입 신청이 접수되었습니다. 관리자가 승인을 완료한 후에 로그인할 수 있습니다.');
        } else if (errorMessage === 'USER_NOT_FOUND') {
          setError('사용자 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.');
        } else {
          console.error('승인 여부 확인 중 오류:', profileError);
          setError('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.');
        }
        return;
      }

      // 이메일 저장 옵션이 체크되어 있으면 localStorage에 저장
      if (rememberEmail) {
        localStorage.setItem(SAVED_EMAIL_KEY, formData.email);
      } else {
        // 체크 해제 시 저장된 이메일 삭제
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
      
      // 로그인 성공 - useAuth가 프로필을 로드할 시간을 주고 리다이렉트
      setLoading(false);
      
      // 프로필이 로드될 때까지 대기 (최대 3초)
      let retries = 30; // 100ms * 30 = 3초
      const checkProfileLoaded = setInterval(async () => {
        retries--;
        try {
          // Firestore에서 직접 프로필 확인
          const userDoc = await getDoc(doc(db, 'users', credential.user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData && userData.approved !== false) {
              clearInterval(checkProfileLoaded);
              if (!isRedirecting) {
                setIsRedirecting(true);
                window.location.href = '/';
              }
              return;
            }
          }
        } catch (error) {
          console.error('프로필 확인 중 오류:', error);
        }
        
        if (retries <= 0) {
          clearInterval(checkProfileLoaded);
          // 타임아웃 시에도 리다이렉트 (프로필은 나중에 로드될 수 있음)
          if (!isRedirecting) {
            setIsRedirecting(true);
            window.location.href = '/';
          }
        }
      }, 100);
    } catch (error) {
      // 콘솔 에러 출력하지 않음 (사용자에게만 친화적인 메시지 표시)
      setLoading(false); // 에러 발생 시 즉시 로딩 해제
      
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = '';
      
      let passwordError = false;
      
      if (firebaseError.code === 'auth/invalid-credential') {
        errorMessage = '이메일 또는 비밀번호가 올바르지 않습니다. 다시 확인해주세요.';
        setFieldErrors({ password: '비밀번호가 올바르지 않습니다.' });
        passwordError = true;
      } else if (firebaseError.code === 'auth/user-not-found') {
        errorMessage = '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.';
        setFieldErrors({ email: '등록되지 않은 이메일입니다.' });
      } else if (firebaseError.code === 'auth/wrong-password') {
        errorMessage = '비밀번호가 올바르지 않습니다.';
        setFieldErrors({ password: '비밀번호가 올바르지 않습니다.' });
        passwordError = true;
      } else if (firebaseError.code === 'auth/invalid-email') {
        errorMessage = '유효하지 않은 이메일 형식입니다.';
        setFieldErrors({ email: '유효하지 않은 이메일 형식입니다.' });
      } else if (firebaseError.code === 'auth/user-disabled') {
        errorMessage = '비활성화된 계정입니다. 관리자에게 문의하세요.';
        setFieldErrors({});
      } else if (firebaseError.code === 'auth/too-many-requests') {
        errorMessage = '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.';
        setFieldErrors({});
      } else {
        errorMessage = `로그인에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`;
        setFieldErrors({});
      }
      
      setError(errorMessage);
      
      // 에러 메시지로 스크롤 이동 및 포커스
      setTimeout(() => {
        const errorElement = document.querySelector('.bg-red-50');
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 비밀번호 필드에 포커스 (에러가 있는 경우)
          if (passwordError) {
            const passwordInput = document.getElementById('password') as HTMLInputElement;
            if (passwordInput) {
              passwordInput.focus();
              passwordInput.select();
            }
          }
        }
      }, 100);
    }
  };

  // 인증 로딩 중인 경우만 로딩 화면 표시
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 이미 로그인된 경우 리다이렉트만 수행 (로딩 화면 표시 안 함)
  if (isAuthenticated) {
    return null;
  }

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
            로그인
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            또는{' '}
            <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-500">
              회원가입
          </Link>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md animate-pulse">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="flex-1 font-semibold text-base">{error}</p>
              </div>
            </div>
          )}
          <div className="space-y-4">
            <Input
              id="email"
              name="email"
              type="email"
              label="이메일"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="이메일을 입력하세요"
              error={fieldErrors.email}
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
              error={fieldErrors.password}
            />
          </div>
          <div className="flex items-center">
            <input
              id="remember-email"
              name="remember-email"
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="remember-email" className="ml-2 block text-sm text-gray-900">
              이메일 저장
            </label>
          </div>
          <div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
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

