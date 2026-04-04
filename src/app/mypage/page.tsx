"use client";

import React, { useState, useEffect } from 'react';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';

export default function MyPage() {
  const { user, isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [passwordData, setPasswordData] = useState({
    current: '',
    new: '',
    confirm: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // 초기 데이터 설정
  useEffect(() => {
    if (userProfile) {
      setFormData({
        name: userProfile.name || '',
        email: userProfile.email || '',
        company: userProfile.company || '',
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
    setFormData({
      ...formData,
      [name]: value
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
    });
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  const handlePasswordFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const cleaned = value.replace(/\s/g, '');
    setPasswordData((prev) => ({ ...prev, [name]: cleaned }));
    if (passwordError) setPasswordError('');
    if (passwordSuccess) setPasswordSuccess('');
  };

  const validateNewPassword = (pwd: string): string | null => {
    if (pwd.length < 6) return '새 비밀번호는 최소 6자 이상이어야 합니다.';
    if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(pwd)) {
      return '새 비밀번호는 영문과 숫자를 포함해야 합니다.';
    }
    return null;
  };

  const handlePasswordSubmit = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordData.current) {
      setPasswordError('현재 비밀번호를 입력해주세요.');
      return;
    }
    const newPwdErr = validateNewPassword(passwordData.new);
    if (newPwdErr) {
      setPasswordError(newPwdErr);
      return;
    }
    if (passwordData.new !== passwordData.confirm) {
      setPasswordError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (passwordData.current === passwordData.new) {
      setPasswordError('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
      return;
    }

    const authUser = auth.currentUser;
    const email = authUser?.email ?? user?.email;
    if (!authUser || !email) {
      setPasswordError('이 계정에서는 비밀번호 변경을 사용할 수 없습니다.');
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(email, passwordData.current);
      await reauthenticateWithCredential(authUser, credential);
      await updatePassword(authUser, passwordData.new);
      setPasswordData({ current: '', new: '', confirm: '' });
      setPasswordSuccess('비밀번호가 변경되었습니다.');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPasswordError('현재 비밀번호가 올바르지 않습니다.');
      } else if (code === 'auth/weak-password') {
        setPasswordError('새 비밀번호가 너무 약합니다. 더 길고 복잡하게 설정해주세요.');
      } else if (code === 'auth/too-many-requests') {
        setPasswordError('시도 횟수가 많습니다. 잠시 후 다시 시도해주세요.');
      } else {
        console.error('비밀번호 변경 오류:', err);
        setPasswordError('비밀번호 변경에 실패했습니다. 다시 시도해주세요.');
      }
    } finally {
      setPasswordSaving(false);
    }
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

          <div className="bg-white rounded-lg shadow-sm p-6 mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">비밀번호 변경</h2>
            <p className="text-sm text-gray-600 mb-6">
              보안을 위해 현재 비밀번호 확인 후 새 비밀번호로 변경합니다. (회원가입과 동일: 6자 이상, 영문·숫자 포함)
            </p>

            {passwordError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4 text-sm font-medium">
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4 text-sm font-medium">
                {passwordSuccess}
              </div>
            )}

            <div className="space-y-4 max-w-lg">
              <Input
                id="password-current"
                name="current"
                type="password"
                label="현재 비밀번호"
                value={passwordData.current}
                onChange={handlePasswordFieldChange}
                autoComplete="current-password"
                placeholder="현재 비밀번호"
              />
              <Input
                id="password-new"
                name="new"
                type="password"
                label="새 비밀번호"
                value={passwordData.new}
                onChange={handlePasswordFieldChange}
                autoComplete="new-password"
                placeholder="새 비밀번호"
                helperText="최소 6자 이상, 영문과 숫자 포함"
              />
              <Input
                id="password-confirm"
                name="confirm"
                type="password"
                label="새 비밀번호 확인"
                value={passwordData.confirm}
                onChange={handlePasswordFieldChange}
                autoComplete="new-password"
                placeholder="새 비밀번호 다시 입력"
              />
              <div className="pt-2">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handlePasswordSubmit}
                  loading={passwordSaving}
                >
                  비밀번호 변경
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

