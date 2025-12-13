"use client";

import React from 'react';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();

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

  if (!isAuthenticated) {
    router.push('/login');
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            대시보드
          </h1>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">사용자 정보</h2>
            <div className="space-y-2">
              <p><span className="font-medium">이름:</span> {userProfile?.name || '-'}</p>
              <p><span className="font-medium">이메일:</span> {userProfile?.email || '-'}</p>
              <p><span className="font-medium">회사:</span> {userProfile?.company || '-'}</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

