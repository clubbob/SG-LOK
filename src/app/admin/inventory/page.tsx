"use client";

import Link from 'next/link';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ChangeEvent, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';

type ExcelRow = Record<string, string>;

const ERP_INVENTORY_MASTER_DOC = 'erpInventoryProducts';

export default function AdminInventoryIndexPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedExcelName, setSelectedExcelName] = useState('');
  const [excelError, setExcelError] = useState('');
  const [excelSuccess, setExcelSuccess] = useState('');
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExcelFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setSelectedExcelName('');
      setExcelError('');
      setExcelSuccess('');
      return;
    }

    const isExcelFile = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!isExcelFile) {
      setSelectedFile(null);
      setSelectedExcelName('');
      setExcelError('엑셀 파일(xlsx, xls, csv)만 업로드할 수 있습니다.');
      setExcelSuccess('');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
    setSelectedExcelName(file.name);
    setExcelError('');
    setExcelSuccess('');
  };

  const handleResetExcel = () => {
    setSelectedFile(null);
    setSelectedExcelName('');
    setExcelError('');
    setExcelSuccess('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const normalizeExcelRows = (rows: Record<string, unknown>[]): ExcelRow[] => {
    return rows
      .map((row) => {
        const next: ExcelRow = {};
        Object.entries(row).forEach(([key, value]) => {
          const normalizedKey = String(key ?? '').trim();
          if (!normalizedKey) return;
          next[normalizedKey] = String(value ?? '').trim();
        });
        return next;
      })
      .filter((row) => Object.values(row).some((value) => value.length > 0));
  };

  const handleUploadErpProducts = async () => {
    if (!selectedFile) {
      setExcelError('업로드할 ERP 엑셀 파일을 먼저 선택해 주세요.');
      setExcelSuccess('');
      return;
    }

    setUploadingExcel(true);
    setExcelError('');
    setExcelSuccess('');
    try {
      const fileBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('엑셀 시트를 찾을 수 없습니다.');
      }

      const firstSheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
        raw: false,
      });
      const normalizedRows = normalizeExcelRows(jsonRows);
      if (normalizedRows.length === 0) {
        throw new Error('등록 가능한 행이 없습니다. ERP 엑셀 데이터 내용을 확인해 주세요.');
      }

      const headerSet = new Set<string>();
      normalizedRows.forEach((row) => {
        Object.keys(row).forEach((key) => headerSet.add(key));
      });

      const inventoryRef = doc(db, 'inventory', ERP_INVENTORY_MASTER_DOC);
      await setDoc(
        inventoryRef,
        {
          source: 'erp_excel',
          sheetName: firstSheetName,
          fileName: selectedFile.name,
          headers: Array.from(headerSet),
          rows: normalizedRows,
          rowCount: normalizedRows.length,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setExcelSuccess(`ERP 품목 ${normalizedRows.length}건 등록이 완료되었습니다.`);
    } catch (error) {
      console.error('ERP 제품등록 오류:', error);
      const message = error instanceof Error ? error.message : 'ERP 제품등록 처리 중 오류가 발생했습니다.';
      setExcelError(message);
    } finally {
      setUploadingExcel(false);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">재고관리</h1>
        <p className="text-sm text-gray-600 mt-2">
          전사 제품의 입고/출고/현재고를 통합 관리하는 페이지입니다.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-900">운영 목적</h2>
        <p className="mt-1 text-sm text-blue-800">
          제품군별 재고 흐름을 한 곳에서 확인하고, 품절/과재고를 예방하기 위한 기준 화면으로 사용합니다.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">전체 제품군</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">집계 예정</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">오늘 입고</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">집계 예정</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">오늘 출고</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">집계 예정</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">품절 위험 품목</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">집계 예정</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">스캐너 작업 모드</h2>
          <p className="text-sm text-gray-600 mt-1">
            작업자는 바코드/QR 스캔으로 입고, 출고, 생산 처리를 수행하고 수량은 실시간 반영합니다.
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              입고 스캔 시작
            </button>
            <button
              type="button"
              className="rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
            >
              출고 스캔 시작
            </button>
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 whitespace-nowrap"
            >
              생산 스캔 시작
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">현재고/생산계획 통합 현황</h2>
          <p className="text-sm text-gray-600 mt-1">
            제품군, 창고, 로트 기준으로 현재고를 집계하고 웹에서 입력한 생산계획을 함께 관리합니다.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/admin/inventory/erp-status"
              className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              재고 현황
            </Link>
            <Link
              href="/admin/production/request"
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
            >
              생산계획 등록
            </Link>
          </div>
          <ul className="mt-3 text-xs text-gray-600 space-y-1">
            <li>최근 스캔 처리 순서와 작업자 이력을 함께 기록</li>
            <li>입고/출고/생산 타입별 일일 처리량 집계</li>
            <li>생산계획 입력은 웹 화면에서 등록/수정 후 스캔 처리와 연동</li>
            <li>임계치 미만 품목 자동 표시(품절 위험)</li>
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">제품등록 (ERP 엑셀 업로드)</h2>
        <p className="text-sm text-gray-600 mt-1">
          ERP에서 내려받은 재고관리 대상 품목 엑셀 파일로 제품 마스터를 일괄 등록합니다.
          (지원 형식: .xlsx, .xls, .csv)
        </p>
        <p className="mt-2 text-xs text-gray-500">
          권장: ERP 원본 컬럼명을 유지한 파일을 그대로 업로드하세요. 컬럼 매핑 규칙은 등록 처리 단계에서 검증됩니다.
        </p>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelFileChange}
            className="block w-full lg:flex-1 text-sm text-gray-700 file:mr-4 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
          />
          <button
            type="button"
            onClick={handleResetExcel}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 whitespace-nowrap lg:shrink-0"
          >
            파일 초기화
          </button>
          <button
            type="button"
            disabled={!selectedExcelName || uploadingExcel}
            onClick={() => void handleUploadErpProducts()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 whitespace-nowrap lg:shrink-0"
          >
            {uploadingExcel ? '등록 중...' : 'ERP 제품등록 시작'}
          </button>
        </div>

        {selectedExcelName ? (
          <p className="mt-2 text-xs text-gray-600">선택된 파일: {selectedExcelName}</p>
        ) : null}
        {excelError ? <p className="mt-2 text-xs text-red-600">{excelError}</p> : null}
        {excelSuccess ? <p className="mt-2 text-xs text-emerald-700">{excelSuccess}</p> : null}
      </div>

      <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-white p-4">
        <p className="text-xs text-gray-600">
          이 페이지는 UHP 재고관리 화면과 분리되며, 스캐너 기반 입고/출고 처리와 웹 기반 생산계획 입력의 기준 화면입니다.
        </p>
      </div>
    </div>
  );
}
