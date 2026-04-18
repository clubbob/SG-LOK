"use client";

import React, { useState } from 'react';

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">시스템 안내</h3>
              <p className="mt-1 text-sm text-gray-600">
                SG-LOK Work Flow 서비스의 주요 기술 구성입니다.
              </p>
            </div>
            <div className="px-5 py-4">
              <ul className="space-y-2 text-sm text-gray-700">
                <li>프레임워크: Next.js (App Router)</li>
                <li>언어: TypeScript</li>
                <li>UI 라이브러리: React</li>
                <li>스타일링: Tailwind CSS</li>
                <li>백엔드: Firebase (Firestore, Authentication, Storage)</li>
                <li>상태 관리: Zustand</li>
                <li>이메일: Nodemailer</li>
                <li>개발 도구: Cursor (AI IDE)</li>
                <li>배포: Vercel</li>
                <li>버전 관리: GitHub</li>
              </ul>
            </div>
            <div className="flex justify-end border-t border-gray-200 px-5 py-4">
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

