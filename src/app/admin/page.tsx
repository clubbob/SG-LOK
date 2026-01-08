"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // 항상 로그인 페이지로 리다이렉트
    router.replace('/admin/login/');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">리다이렉트 중...</p>
      </div>
    </div>
  );
}

