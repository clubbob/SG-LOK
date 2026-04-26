"use client";

import { Suspense } from "react";
import { InventoryScannerView } from "@/components/inventory/InventoryScannerView";

function AdminInventoryScanInner() {
  return <InventoryScannerView />;
}

export default function AdminInventoryScanPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-center text-sm text-gray-600">스캐너 화면을 불러오는 중…</div>
      }
    >
      <AdminInventoryScanInner />
    </Suspense>
  );
}
