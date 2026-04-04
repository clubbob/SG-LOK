"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 예전 메뉴 경로 호환: 대체품관리로 이동 */
export default function AdminSubstituteMenuRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/substitute/manage');
  }, [router]);
  return (
    <div className="p-8 text-center text-gray-500 text-sm">
      대체품관리 화면으로 이동 중…
    </div>
  );
}
