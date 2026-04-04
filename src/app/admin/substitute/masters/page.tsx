"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/substitute/constants';
import { seedTubeFittingMasters } from '@/lib/substitute/firestoreMasters';

export default function AdminSubstituteMastersPage() {
  const [counts, setCounts] = useState({ mat: 0, fam: 0, sz: 0, opt: 0 });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [a, b, c, d] = await Promise.all([
        getDocs(collection(db, COLLECTIONS.CODE_MATERIAL_MASTER)),
        getDocs(collection(db, COLLECTIONS.CODE_FAMILY_MASTER)),
        getDocs(collection(db, COLLECTIONS.CODE_SIZE_MASTER)),
        getDocs(collection(db, COLLECTIONS.CODE_OPTION_MASTER)),
      ]);
      setCounts({ mat: a.size, fam: b.size, sz: c.size, opt: d.size });
    } catch (e) {
      console.error(e);
      setErr('마스터 조회 실패. Firestore 규칙을 확인하세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runSeed = async () => {
    setSeeding(true);
    setMsg(null);
    setErr(null);
    try {
      const { inserted, skipped } = await seedTubeFittingMasters(db);
      setMsg(`시드 완료: 신규 ${inserted}건, 스킵(기존) ${skipped}건`);
      await refresh();
    } catch (e) {
      console.error(e);
      setErr('시드 실패');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">대체품 코드 마스터</h1>
      <p className="text-gray-600 mt-2 text-sm">
        Tube Fitting 1차 파서용 사전입니다. 검색 로직에는 사용하지 않으며, 화면 비고·분해 표시 보조에만
        쓰입니다.
      </p>

      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
        <p className="font-semibold text-blue-900">Swagelok 제품 893건이 필요하신가요?</p>
        <p className="mt-1 text-blue-900/90 leading-relaxed">
          이 화면의 시드는 재질·패밀리·사이즈 같은 <strong>코드 마스터만</strong> 넣습니다(합쳐서 수십 건 수준).
          카탈로그에서 뽑은 <strong>주문번호·제품명</strong> 수백 건은 다른 컬렉션(
          <code className="text-xs bg-white/80 px-1 rounded border border-blue-200">
            swagelok_catalog_parts
          </code>
          )이며,{' '}
          <Link
            href="/admin/substitute/code-db"
            className="font-medium underline underline-offset-2 hover:text-blue-700"
          >
            Code Find → 코드 DB
          </Link>
          에서 자동/수동 시드됩니다.
        </p>
      </div>

      <div className="mt-6 bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : (
          <ul className="text-sm text-gray-800 space-y-1">
            <li>
              <code className="text-xs bg-gray-100 px-1 rounded">code_material_master</code>:{' '}
              {counts.mat}건
            </li>
            <li>
              <code className="text-xs bg-gray-100 px-1 rounded">code_family_master</code>:{' '}
              {counts.fam}건
            </li>
            <li>
              <code className="text-xs bg-gray-100 px-1 rounded">code_size_master</code>: {counts.sz}건
            </li>
            <li>
              <code className="text-xs bg-gray-100 px-1 rounded">code_option_master</code>:{' '}
              {counts.opt}건
            </li>
          </ul>
        )}
        <button
          type="button"
          onClick={runSeed}
          disabled={seeding}
          className="px-4 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {seeding ? '시드 중…' : '번들 마스터 시드 (없는 문서만 생성)'}
        </button>
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        상세 CRUD는 추후 확장 가능합니다. 지금은 레포 시드 JSON 기준으로 초기값만 넣습니다.
      </p>
    </div>
  );
}
