"use client";

import React, { useState, useEffect } from 'react';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function MyPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    businessNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 초기 데이터 설정
  useEffect(() => {
    if (userProfile) {
      setFormData({
        name: userProfile.name || '',
        email: userProfile.email || '',
        company: userProfile.company || '',
        phone: userProfile.phone || '',
        businessNumber: userProfile.businessNumber || '',
      });
    }
  }, [userProfile]);

  // 인증 확인 및 리다이렉트
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !userProfile) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let formattedValue = value;

    // 사업자 등록번호 자동 하이픈 추가
    if (name === 'businessNumber') {
      const cleaned = value.replace(/[^0-9]/g, '');
      if (cleaned.length > 3 && cleaned.length <= 5) {
        formattedValue = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
      } else if (cleaned.length > 5) {
        formattedValue = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 10)}`;
      } else {
        formattedValue = cleaned;
      }
    }

    // 핸드폰 번호 자동 하이픈 추가
    if (name === 'phone') {
      const cleaned = value.replace(/[^0-9]/g, '');
      if (cleaned.length > 3 && cleaned.length <= 7) {
        formattedValue = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
      } else if (cleaned.length > 7) {
        formattedValue = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
      } else {
        formattedValue = cleaned;
      }
    }

    setFormData({
      ...formData,
      [name]: formattedValue
    });
    if (error) setError('');
    if (success) setSuccess('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateDoc(doc(db, 'users', userProfile.id), {
        name: formData.name.trim(),
        company: formData.company.trim(),
        phone: formData.phone.trim(),
        businessNumber: formData.businessNumber.replace(/-/g, ''),
        updatedAt: new Date(),
      });

      setSuccess('회원정보가 성공적으로 수정되었습니다.');
      setIsEditing(false);
    } catch (error) {
      console.error('회원정보 수정 오류:', error);
      setError('회원정보 수정에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: userProfile.name || '',
      email: userProfile.email || '',
      company: userProfile.company || '',
      phone: userProfile.phone || '',
      businessNumber: userProfile.businessNumber || '',
    });
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">회원정보 관리</h1>

          {error && (
            <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md mb-6">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="font-semibold">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border-2 border-green-400 text-green-800 px-6 py-4 rounded-lg shadow-md mb-6">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="font-semibold">{success}</p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">기본 정보</h2>
              {!isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  수정하기
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <Input
                id="name"
                name="name"
                type="text"
                label="이름"
                value={formData.name}
                onChange={handleChange}
                disabled={!isEditing}
                required
              />
              <Input
                id="email"
                name="email"
                type="email"
                label="이메일"
                value={formData.email}
                disabled={true}
                helperText="이메일은 변경할 수 없습니다."
              />
              <Input
                id="company"
                name="company"
                type="text"
                label="회사명"
                value={formData.company}
                onChange={handleChange}
                disabled={!isEditing}
                required
              />
              <Input
                id="businessNumber"
                name="businessNumber"
                type="text"
                label="사업자 등록번호"
                value={formData.businessNumber ? formData.businessNumber.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3') : ''}
                onChange={handleChange}
                disabled={!isEditing}
                placeholder="사업자 등록번호를 입력하세요 (예: 111-11-11111)"
              />
              <Input
                id="phone"
                name="phone"
                type="tel"
                label="핸드폰 번호"
                value={formData.phone}
                onChange={handleChange}
                disabled={!isEditing}
                placeholder="핸드폰 번호를 입력하세요 (예: 010-1234-5678)"
              />
            </div>

            {isEditing && (
              <div className="flex justify-end gap-3 mt-6 pt-6 border-t">
                <Button
                  variant="outline"
                  size="md"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  취소
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleSave}
                  loading={saving}
                >
                  저장하기
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

