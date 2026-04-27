"use client";

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
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

  const getItemCode = (row: Record<string, string>) =>
    String(row['품목코드'] ?? row['제품코드'] ?? row['itemCode'] ?? row['code'] ?? '').trim();

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
      const existingSnap = await getDoc(inventoryRef);
      const existingRowsRaw = existingSnap.exists()
        ? ((existingSnap.data()?.rows as Array<Record<string, unknown>> | undefined) ?? [])
        : [];
      const existingRows: ExcelRow[] = existingRowsRaw.map((row) =>
        Object.fromEntries(
          Object.entries(row ?? {}).map(([k, v]) => [String(k), String(v ?? '').trim()])
        )
      );

      const existingByCode = new Map<string, ExcelRow>();
      existingRows.forEach((row) => {
        const code = getItemCode(row);
        if (!code) return;
        existingByCode.set(code, row);
      });

      const uploadedByCode = new Map<string, ExcelRow>();
      const codeLessRows: ExcelRow[] = [];
      normalizedRows.forEach((row) => {
        const code = getItemCode(row);
        if (!code) {
          codeLessRows.push(row);
          return;
        }
        uploadedByCode.set(code, row);
      });

      const mergedRows: ExcelRow[] = [];
      let updatedCount = 0;
      let addedCount = 0;

      uploadedByCode.forEach((uploadedRow, code) => {
        const existingRow = existingByCode.get(code);
        if (existingRow) {
          mergedRows.push({ ...existingRow, ...uploadedRow });
          updatedCount += 1;
        } else {
          mergedRows.push(uploadedRow);
          addedCount += 1;
        }
      });

      existingRows.forEach((row) => {
        const code = getItemCode(row);
        if (!code) return;
        if (!uploadedByCode.has(code)) {
          mergedRows.push(row);
        }
      });

      mergedRows.push(...codeLessRows);

      const mergedHeaderSet = new Set<string>();
      mergedRows.forEach((row) => {
        Object.keys(row).forEach((key) => mergedHeaderSet.add(key));
      });

      await setDoc(
        inventoryRef,
        {
          source: 'erp_excel',
          sheetName: firstSheetName,
          fileName: selectedFile.name,
          headers: Array.from(mergedHeaderSet.size > 0 ? mergedHeaderSet : headerSet),
          rows: mergedRows,
          rowCount: mergedRows.length,
          uploadedRowCount: normalizedRows.length,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setExcelSuccess(
        `ERP 업로드 ${normalizedRows.length}건 처리 완료 (품목코드 기준 갱신 ${updatedCount}건, 신규 ${addedCount}건).`
      );
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
        <h1 className="text-2xl font-bold text-gray-900">제품 등록</h1>
        <p className="text-sm text-gray-600 mt-2">
          제품을 등록하는 페이지 입니다.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
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

    </div>
  );
}
