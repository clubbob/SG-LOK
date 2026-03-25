"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Notice, NoticeAttachment } from '@/types';

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

export default function AdminNoticeDetailPage() {
  const params = useParams<{ id: string }>();
  const noticeId = params?.id;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingNotice, setLoadingNotice] = useState(true);

  useEffect(() => {
    if (!noticeId) return;
    let mounted = true;
    const load = async () => {
      setLoadingNotice(true);
      try {
        const snap = await getDoc(doc(db, 'notices', noticeId));
        if (!mounted) return;
        if (!snap.exists()) {
          setNotice(null);
          return;
        }

        const data = snap.data() as Record<string, unknown>;
        const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
        const attachments = attachmentsRaw
          .map((x) => toNoticeAttachment(x))
          .filter((x): x is NoticeAttachment => x !== null);

        setNotice({
          id: snap.id,
          title: typeof data.title === 'string' ? data.title : '',
          content: typeof data.content === 'string' ? data.content : '',
          attachments,
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt ?? data.createdAt),
          createdBy: typeof data.createdBy === 'string' ? data.createdBy : 'admin',
          updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
          pinned: typeof data.pinned === 'boolean' ? data.pinned : false,
          published: typeof data.published === 'boolean' ? data.published : true,
        });
      } catch (e) {
        console.error('관리자 공지사항 상세 로드 오류:', e);
        if (mounted) setNotice(null);
      } finally {
        if (mounted) setLoadingNotice(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [noticeId]);

  const dateText = useMemo(() => {
    if (!notice) return '';
    return notice.createdAt.toISOString().slice(0, 10);
  }, [notice]);

  const updatedText = useMemo(() => {
    if (!notice) return '';
    if (notice.updatedAt.getTime() === notice.createdAt.getTime()) return '';
    return notice.updatedAt.toISOString().slice(0, 10);
  }, [notice]);

  if (loadingNotice) {
    return (
      <div className="p-6 sm:p-8">로딩 중...</div>
    );
  }

  if (!notice) {
    return (
      <div className="p-6 sm:p-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          공지사항을 찾을 수 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 bg-gray-50">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {notice.pinned && (
              <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-semibold">
                고정
              </span>
            )}
            {notice.published === false ? (
              <span className="inline-flex items-center rounded-full bg-gray-50 text-gray-700 px-2 py-0.5 text-xs font-semibold border border-gray-200">
                미게시
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-semibold border border-green-100">
                게시중
              </span>
            )}
            <h1 className="text-2xl font-bold text-gray-900 truncate">{notice.title}</h1>
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm text-gray-600 flex-wrap">
            <span className="whitespace-nowrap">{dateText}</span>
            {updatedText && (
              <>
                <span className="text-gray-300">|</span>
                <span className="whitespace-nowrap">수정 {updatedText}</span>
              </>
            )}
            <span className="text-gray-300">|</span>
            <span className="whitespace-nowrap">등록자: {notice.createdBy}</span>
          </div>
        </div>

        <Link
          href="/admin/notices"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          목록으로
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8">
        <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">{notice.content}</div>

        {notice.attachments.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">첨부파일</h2>
            <div className="space-y-2">
              {notice.attachments.map((att, idx) => (
                <a
                  key={`${att.url}-${idx}`}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-blue-700 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{att.name}</span>
                    <span className="flex-shrink-0 text-xs text-gray-500 whitespace-nowrap">
                      {(att.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

