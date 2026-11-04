"use client";

import React, { useState } from 'react';

const SYSTEM_MODULES = [
  '대시보드 · 공지사항',
  '생산관리 (요청·현황·승인·차수별·UHP 세정/EP·생산 이슈, PDF/엑셀)',
  '성적서관리 (요청·목록·Inspection·PDF)',
  '재고관리 (제품·입출고·ERP 현황·UHP 재고·바코드 스캔)',
  '대체품코드 (검색·목록)',
  '관리자 (회원·문의·알림·메뉴 권한)',
] as const;

const SYSTEM_STACK = [
  { label: '서비스', value: 'SG-LOK Work Flow' },
  { label: '프레임워크', value: 'Next.js 15 (App Router)' },
  { label: '언어', value: 'TypeScript' },
  { label: 'UI', value: 'React 19' },
  { label: '스타일링', value: 'Tailwind CSS 4' },
  { label: '백엔드', value: 'Firebase (Firestore, Authentication, Storage, Hosting)' },
  { label: 'API', value: 'Next.js Route Handlers (서버 API)' },
  { label: '상태 관리', value: 'Zustand' },
  { label: 'PDF', value: 'jsPDF · pdf-lib' },
  { label: '엑셀', value: 'SheetJS (xlsx)' },
  { label: '이메일', value: 'Nodemailer' },
  { label: 'UI 유틸', value: '@dnd-kit (드래그 정렬), clsx' },
  { label: '개발 도구', value: 'Cursor (AI IDE)' },
  { label: '배포', value: 'Firebase Hosting (Next.js 빌드)' },
  { label: '버전 관리', value: 'Git / GitHub' },
] as const;

export default function Footer() {
  const [isSystemModalOpen, setIsSystemModalOpen] = useState(false);

  return (
    <>
      <footer className="bg-gray-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col items-center gap-2 text-sm text-gray-400">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <p className="text-center">문의 : sglok@sglok.com</p>
              <span className="text-gray-600">|</span>
              <button
                type="button"
                onClick={() => setIsSystemModalOpen(true)}
                className="font-normal text-inherit hover:text-gray-300"
              >
                시스템 구조
              </button>
            </div>
            <p className="text-center">&copy; 2026 SG-LOK. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {isSystemModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="system-info-title"
        >
          <div className="w-full max-w-2xl max-h-[min(90vh,40rem)] flex flex-col rounded-xl bg-white shadow-2xl">
            <div className="shrink-0 border-b border-gray-200 px-5 py-4">
              <h3 id="system-info-title" className="text-lg font-semibold text-gray-900">
                시스템 안내
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                SG-LOK Work Flow 서비스의 주요 기능 구성과 기술 스택입니다.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  주요 기능
                </h4>
                <ul className="space-y-1.5 text-sm text-gray-700 list-disc list-inside">
                  {SYSTEM_MODULES.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  기술 스택
                </h4>
                <ul className="space-y-2 text-sm text-gray-700">
                  {SYSTEM_STACK.map(({ label, value }) => (
                    <li key={label}>
                      <span className="font-medium text-gray-900">{label}:</span> {value}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="shrink-0 flex justify-end border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setIsSystemModalOpen(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
