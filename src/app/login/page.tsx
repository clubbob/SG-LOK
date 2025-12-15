"use client";

import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Button, Input } from '@/components/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';

const SAVED_EMAIL_KEY = 'sglok_saved_email';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [rememberEmail, setRememberEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

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

    // 이메일이 "admin"이면 관리자 로그인 페이지로 리다이렉트
    if (formData.email.trim().toLowerCase() === 'admin') {
      router.push('/admin/login');
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, formData.email, formData.password);

      // 관리자 승인 여부 확인
      try {
        const userDoc = await getDoc(doc(db, 'users', credential.user.uid));
        const data = userDoc.exists() ? userDoc.data() as { approved?: boolean } : null;

        if (!data || data.approved === false) {
          await auth.signOut();
          setLoading(false);
          setError('회원가입 신청이 접수되었습니다. 관리자가 승인을 완료한 후에 로그인할 수 있습니다.');
          return;
        }
      } catch (profileError) {
        console.error('승인 여부 확인 중 오류:', profileError);
        await auth.signOut();
        setLoading(false);
        setError('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.');
        return;
      }

      // 이메일 저장 옵션이 체크되어 있으면 localStorage에 저장
      if (rememberEmail) {
        localStorage.setItem(SAVED_EMAIL_KEY, formData.email);
      } else {
        // 체크 해제 시 저장된 이메일 삭제
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
      
      router.push('/');
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

