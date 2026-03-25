"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Notice, NoticeAttachment } from '@/types';

const MAX_ATTACHMENTS = 3;

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
};

const toNoticeAttachment = (att: unknown): NoticeAttachment | null => {
  if (!att || typeof att !== 'object') return null;
  const a = att as Partial<NoticeAttachment> & Record<string, unknown>;
  if (typeof a.name !== 'string' || typeof a.url !== 'string' || typeof a.size !== 'number' || typeof a.type !== 'string') return null;
  return {
    name: a.name,
    url: a.url,
    storagePath: typeof a.storagePath === 'string' ? a.storagePath : null,
    size: a.size,
    type: a.type,
    uploadedAt: toDate(a.uploadedAt),
    uploadedBy: typeof a.uploadedBy === 'string' ? a.uploadedBy : 'admin',
  };
};

export default function NoticesPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!loading && !isAuthenticated) router.push('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoadingNotices(true);
        const noticesRef = collection(db, 'notices');
        const q = query(noticesRef, orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        if (!mounted) return;

        const items: Notice[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
          const attachments = attachmentsRaw
            .map((x) => toNoticeAttachment(x))
            .filter((x): x is NoticeAttachment => x !== null);

          const pinned = typeof data.pinned === 'boolean' ? data.pinned : false;
          const published = typeof data.published === 'boolean' ? data.published : true;

          items.push({
            id: docSnap.id,
            title: typeof data.title === 'string' ? data.title : '',
            content: typeof data.content === 'string' ? data.content : '',
            attachments,
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt ?? data.createdAt),
            createdBy: typeof data.createdBy === 'string' ? data.createdBy : 'admin',
            updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
            pinned,
            published,
          });
        });
        setNotices(items);
      } catch (e) {
        console.error('공지사항 로드 오류:', e);
        if (mounted) setNotices([]);
      } finally {
        if (mounted) setLoadingNotices(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredNotices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notices
      .filter((n) => n.published !== false)
      .filter((n) => {
        if (!q) return true;
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const pinA = a.pinned ? 1 : 0;
        const pinB = b.pinned ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }, [notices, searchQuery]);

  if (loadingNotices) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 bg-gray-50 flex items-center justify-center py-12">로딩 중...</main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">공지사항</h1>
            <p className="text-gray-600 mt-2 text-sm sm:text-base">중요 공지 및 안내사항을 확인하세요.</p>
          </div>

          <div className="mb-4">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="공지 검색 (제목/내용)"
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          {filteredNotices.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
              {searchQuery.trim() ? '검색 결과가 없습니다.' : '등록된 공지사항이 없습니다.'}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">번호</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">등록자</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제목</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">등록일</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">첨부</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredNotices.map((n, idx) => (
                      <tr key={n.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{idx + 1}</td>
                        <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{n.createdBy}</td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {n.pinned && (
                              <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">
                                고정
                              </span>
                            )}
                            <Link
                              href={`/notices/${n.id}`}
                              className="font-medium text-blue-700 hover:text-blue-800 truncate max-w-[260px] inline-block"
                            >
                              {n.title}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{n.createdAt.toISOString().slice(0, 10)}</td>
                        <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{n.attachments.length}/{MAX_ATTACHMENTS}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

