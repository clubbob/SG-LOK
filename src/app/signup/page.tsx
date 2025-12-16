"use client";

import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Button, Input } from '@/components/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    // 로그인 정보
    email: '',
    password: '',
    confirmPassword: '',
    // 회사 정보
    name: '',
    company: '',
    businessNumber: '',
    phone: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // 사업자 등록번호 자동 포맷팅 (하이픈 추가)
    if (name === 'businessNumber') {
      const cleaned = value.replace(/[^0-9]/g, '');
      let formatted = cleaned;
      if (cleaned.length > 3) {
        formatted = cleaned.slice(0, 3) + '-' + cleaned.slice(3);
      }
      if (cleaned.length > 5) {
        formatted = cleaned.slice(0, 3) + '-' + cleaned.slice(3, 5) + '-' + cleaned.slice(5, 10);
      }
      setFormData({
        ...formData,
        [name]: formatted
      });
    }
    // 핸드폰 번호 자동 포맷팅 (하이픈 추가)
    else if (name === 'phone') {
      const cleaned = value.replace(/[^0-9]/g, '');
      let formatted = cleaned;
      if (cleaned.length > 3) {
        formatted = cleaned.slice(0, 3) + '-' + cleaned.slice(3);
      }
      if (cleaned.length > 7) {
        formatted = cleaned.slice(0, 3) + '-' + cleaned.slice(3, 7) + '-' + cleaned.slice(7, 11);
      }
      setFormData({
        ...formData,
        [name]: formatted
      });
    }
    // 비밀번호 필드는 공백 제거
    else if (name === 'password' || name === 'confirmPassword') {
      // 비밀번호 필드에서 공백 제거 (붙여넣기 시 공백이 포함될 수 있음)
      const cleanedValue = value.replace(/\s/g, '');
      setFormData({
        ...formData,
        [name]: cleanedValue
      });
    }
    // 일반 필드
    else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
    
    // 필드별 에러 초기화
    if (fieldErrors[name]) {
      setFieldErrors({
        ...fieldErrors,
        [name]: ''
      });
    }
    if (error) setError('');
  };

  // 비밀번호 확인 필드에 붙여넣기 핸들러 추가
  const handlePasswordConfirmPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const pastedText = e.clipboardData.getData('text/plain') || e.clipboardData.getData('text');
    // 공백 및 특수 문자 제거 후 붙여넣기
    const cleanedText = pastedText.replace(/\s/g, '').trim();
    if (cleanedText) {
      setFormData({
        ...formData,
        confirmPassword: cleanedText
      });
      // 에러 초기화
      if (fieldErrors.confirmPassword) {
        setFieldErrors({
          ...fieldErrors,
          confirmPassword: ''
        });
      }
    }
  };

  // 실시간 검증 (onBlur)
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const errors = { ...fieldErrors };

    switch (name) {
      case 'email':
        if (!value.trim()) {
          errors.email = '이메일을 입력해주세요.';
        } else if (!validateEmail(value)) {
          errors.email = '유효한 이메일 형식을 입력해주세요.';
        } else {
          delete errors.email;
        }
        break;
      
      case 'password':
        if (!value) {
          errors.password = '비밀번호를 입력해주세요.';
        } else if (value.length < 6) {
          errors.password = '비밀번호는 최소 6자 이상이어야 합니다.';
        } else if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(value)) {
          errors.password = '비밀번호는 영문과 숫자를 포함해야 합니다.';
        } else {
          delete errors.password;
        }
        break;
      
      case 'confirmPassword':
        if (!value) {
          errors.confirmPassword = '비밀번호 확인을 입력해주세요.';
        } else if (formData.password !== value) {
          errors.confirmPassword = '비밀번호가 일치하지 않습니다.';
        } else {
          delete errors.confirmPassword;
        }
        break;
      
      case 'name':
        if (!value.trim()) {
          errors.name = '이름을 입력해주세요.';
        } else if (value.trim().length < 2) {
          errors.name = '이름은 최소 2자 이상이어야 합니다.';
        } else if (value.trim().length > 20) {
          errors.name = '이름은 20자 이하여야 합니다.';
        } else {
          delete errors.name;
        }
        break;
      
      case 'company':
        if (!value.trim()) {
          errors.company = '회사명을 입력해주세요.';
        } else if (value.trim().length < 2) {
          errors.company = '회사명은 최소 2자 이상이어야 합니다.';
        } else if (value.trim().length > 50) {
          errors.company = '회사명은 50자 이하여야 합니다.';
        } else {
          delete errors.company;
        }
        break;
      
      case 'businessNumber':
        if (!value.trim()) {
          errors.businessNumber = '사업자 등록번호를 입력해주세요.';
        } else if (!validateBusinessNumber(value)) {
          errors.businessNumber = '사업자 등록번호는 10자리 숫자여야 합니다.';
        } else {
          delete errors.businessNumber;
        }
        break;
      
      case 'phone':
        if (!value.trim()) {
          errors.phone = '핸드폰 번호를 입력해주세요.';
        } else if (!validatePhone(value)) {
          errors.phone = '유효한 핸드폰 번호 형식을 입력해주세요.';
        } else {
          delete errors.phone;
        }
        break;
    }

    setFieldErrors(errors);
  };

  // 이메일 형식 검증
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // 사업자 등록번호 검증 (10자리 숫자)
  const validateBusinessNumber = (businessNumber: string): boolean => {
    const cleaned = businessNumber.replace(/-/g, '');
    return /^\d{10}$/.test(cleaned);
  };

  // 핸드폰 번호 검증
  const validatePhone = (phone: string): boolean => {
    const cleaned = phone.replace(/[-\s]/g, '');
    return /^01[0-9]\d{7,8}$|^0\d{1,2}\d{3,4}\d{4}$/.test(cleaned);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const errors: Record<string, string> = {};

    // 필수 필드 검증
    if (!formData.email.trim()) {
      errors.email = '이메일을 입력해주세요.';
    } else if (!validateEmail(formData.email)) {
      errors.email = '유효한 이메일 형식을 입력해주세요.';
    }

    if (!formData.password) {
      errors.password = '비밀번호를 입력해주세요.';
    } else if (formData.password.length < 6) {
      errors.password = '비밀번호는 최소 6자 이상이어야 합니다.';
    } else if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(formData.password)) {
      errors.password = '비밀번호는 영문과 숫자를 포함해야 합니다.';
    }

    if (!formData.confirmPassword) {
      errors.confirmPassword = '비밀번호 확인을 입력해주세요.';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = '비밀번호가 일치하지 않습니다.';
    }

    if (!formData.name.trim()) {
      errors.name = '이름을 입력해주세요.';
    } else if (formData.name.trim().length < 2) {
      errors.name = '이름은 최소 2자 이상이어야 합니다.';
    } else if (formData.name.trim().length > 20) {
      errors.name = '이름은 20자 이하여야 합니다.';
    }

    if (!formData.company.trim()) {
      errors.company = '회사명을 입력해주세요.';
    } else if (formData.company.trim().length < 2) {
      errors.company = '회사명은 최소 2자 이상이어야 합니다.';
    } else if (formData.company.trim().length > 50) {
      errors.company = '회사명은 50자 이하여야 합니다.';
    }

    if (!formData.businessNumber.trim()) {
      errors.businessNumber = '사업자 등록번호를 입력해주세요.';
    } else if (!validateBusinessNumber(formData.businessNumber)) {
      errors.businessNumber = '사업자 등록번호는 10자리 숫자여야 합니다.';
    }

    if (!formData.phone.trim()) {
      errors.phone = '핸드폰 번호를 입력해주세요.';
    } else if (!validatePhone(formData.phone)) {
      errors.phone = '유효한 핸드폰 번호 형식을 입력해주세요.';
    }

    // 에러가 있으면 중단
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    try {
      console.log('회원가입 시작:', formData.email);
      
      // Firebase Auth로 사용자 생성
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      console.log('Firebase Auth 사용자 생성 완료:', userCredential.user.uid);

      // Firestore에 사용자 정보 저장 (타임아웃 포함)
      const saveUserData = async () => {
        try {
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            id: userCredential.user.uid,
            name: formData.name.trim(),
            email: formData.email.trim(),
            company: formData.company.trim(),
            businessNumber: formData.businessNumber.replace(/-/g, ''),
            phone: formData.phone.trim(),
            userTypes: [],
            approved: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          console.log('Firestore 사용자 정보 저장 완료');
        } catch (firestoreError) {
          console.error('Firestore 저장 오류:', firestoreError);
          console.warn('사용자 정보 저장 중 오류가 발생했지만 계정은 생성되었습니다.');
        }
      };

      // Firestore 저장을 백그라운드에서 실행하고 즉시 리다이렉트
      saveUserData().catch(err => {
        console.error('Firestore 저장 백그라운드 오류:', err);
      });

      console.log('회원가입 성공, 리다이렉트 시작');
      // 로딩 상태 즉시 해제
      setLoading(false);
      // 즉시 리다이렉트 (window.location 사용하여 확실하게)
      window.location.href = '/signup/success';
    } catch (error) {
      console.error('회원가입 오류:', error);
      
      let firebaseError = error as { code?: string; message?: string };

      // 이미 존재하는 이메일인 경우: 삭제되었거나 기존 계정을 재사용하는 흐름 지원
      if (firebaseError.code === 'auth/email-already-in-use') {
        try {
          // 동일 이메일과 비밀번호로 로그인 시도
          const existingCredential = await signInWithEmailAndPassword(
            auth,
            formData.email.trim(),
            formData.password
          );

          const existingUser = existingCredential.user;

          // 기존/삭제된 계정을 재활성화하거나 정보 갱신
          await setDoc(doc(db, 'users', existingUser.uid), {
            id: existingUser.uid,
            name: formData.name.trim(),
            email: formData.email.trim(),
            company: formData.company.trim(),
            businessNumber: formData.businessNumber.replace(/-/g, ''),
            phone: formData.phone.trim(),
            userTypes: [],
            approved: false,
            deleted: false,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }, { merge: true });

          console.log('기존 계정 재가입/재활성화 완료');
          setLoading(false);
          window.location.href = '/signup/success';
          return;
        } catch (reactivateError) {
          console.error('기존 계정 재가입 실패:', reactivateError);
          firebaseError = reactivateError as { code?: string; message?: string };
        }
      }

      setLoading(false); // 에러 발생 시 로딩 해제
      
      let errorMessage = '';
      
      if (firebaseError.code === 'auth/email-already-in-use') {
        errorMessage = '이미 사용 중인 이메일입니다. 로그인 페이지로 이동하시겠습니까?';
      } else if (firebaseError.code === 'auth/invalid-email') {
        errorMessage = '유효하지 않은 이메일 형식입니다.';
      } else if (firebaseError.code === 'auth/weak-password') {
        errorMessage = '비밀번호가 너무 약합니다. 최소 6자 이상 입력해주세요.';
      } else if (firebaseError.code === 'auth/configuration-not-found') {
        errorMessage = 'Firebase 설정 오류입니다. 관리자에게 문의하세요.';
        console.error('Firebase 설정 확인 필요:', {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? '설정됨' : '설정되지 않음',
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        });
      } else {
        errorMessage = `회원가입에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`;
      }
      
      setError(errorMessage);
      
      // 에러 메시지로 스크롤 이동
      setTimeout(() => {
        const errorElement = document.querySelector('.bg-red-50');
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl w-full space-y-8">
        <div>
          <div className="flex justify-between items-center mb-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                ← 홈으로
              </Button>
            </Link>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            회원가입
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
              로그인
            </Link>
          </p>
        </div>
        <form className="mt-8 space-y-8" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <div className="flex items-start justify-between gap-4">
                <p className="flex-1">{error}</p>
                {error.includes('이미 사용 중인 이메일') && (
                  <Link href="/login" className="text-blue-600 hover:text-blue-800 underline whitespace-nowrap font-medium">
                    로그인하기 →
                  </Link>
                )}
              </div>
            </div>
          )}
          
          {/* 로그인 정보 섹션 */}
          <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
              로그인 정보
            </h3>
            <Input
              id="email"
              name="email"
              type="email"
              label="이메일"
              required
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="개인 이메일을 입력하세요"
              helperText="공용 이메일 입력시 다른 직원이 회원가입이 안됩니다"
              warning={true}
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
              onBlur={handleBlur}
              placeholder="비밀번호를 입력하세요"
              helperText="최소 6자 이상, 영문과 숫자 포함"
              error={fieldErrors.password}
            />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  비밀번호 확인
                </label>
                {formData.password && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({
                        ...formData,
                        confirmPassword: formData.password
                      });
                      if (fieldErrors.confirmPassword) {
                        setFieldErrors({
                          ...fieldErrors,
                          confirmPassword: ''
                        });
                      }
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    비밀번호 복사
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  label=""
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  onPaste={handlePasswordConfirmPaste}
                  onBlur={handleBlur}
                  placeholder="비밀번호를 다시 입력하세요"
                  error={fieldErrors.confirmPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  title={showConfirmPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 회사 정보 섹션 */}
          <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
              회사 정보
            </h3>
            <Input
              id="name"
              name="name"
              type="text"
              label="이름"
              required
              value={formData.name}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="이름을 입력하세요"
              error={fieldErrors.name}
            />
            <Input
              id="company"
              name="company"
              type="text"
              label="회사명"
              required
              value={formData.company}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="회사명을 입력하세요"
              error={fieldErrors.company}
            />
            <Input
              id="businessNumber"
              name="businessNumber"
              type="text"
              label="사업자 등록번호"
              required
              value={formData.businessNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="사업자 등록번호를 입력하세요 (예: 111-11-11111)"
              error={fieldErrors.businessNumber}
            />
            <Input
              id="phone"
              name="phone"
              type="tel"
              label="핸드폰 번호"
              required
              value={formData.phone}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="핸드폰 번호를 입력하세요 (예: 010-1234-5678)"
              error={fieldErrors.phone}
            />
          </div>

          <div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full"
            >
              회원가입
            </Button>
          </div>
        </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}

