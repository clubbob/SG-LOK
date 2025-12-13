"use client";

import React, { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Button, Input } from '@/components/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
      // Firebase Auth로 사용자 생성
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      // Firestore에 사용자 정보 저장 (사업자 등록번호는 하이픈 제거 후 저장)
      await setDoc(doc(db, 'users', userCredential.user.uid), {
        id: userCredential.user.uid,
        name: formData.name.trim(),
        email: formData.email.trim(),
        company: formData.company.trim(),
        businessNumber: formData.businessNumber.replace(/-/g, ''),
        phone: formData.phone.trim(),
        userTypes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      router.push('/');
    } catch (error) {
      console.error('회원가입 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      if (firebaseError.code === 'auth/email-already-in-use') {
        setError('이미 사용 중인 이메일입니다.');
      } else if (firebaseError.code === 'auth/invalid-email') {
        setError('유효하지 않은 이메일 형식입니다.');
      } else if (firebaseError.code === 'auth/weak-password') {
        setError('비밀번호가 너무 약합니다.');
      } else {
        setError('회원가입에 실패했습니다. 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl w-full space-y-8">
        <div>
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
              {error}
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
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              label="비밀번호 확인"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="비밀번호를 다시 입력하세요"
              error={fieldErrors.confirmPassword}
            />
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
    </div>
  );
}

