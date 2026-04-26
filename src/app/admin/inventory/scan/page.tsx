"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  InventoryScannerView,
  type ScannerMode,
} from "@/components/inventory/InventoryScannerView";

function AdminInventoryScanInner() {
  const sp = useSearchParams();
  const m = sp.get("mode");
  const initial: ScannerMode | undefined =
    m === "in"
      ? "in"
      : m === "out"
        ? "out"
      : m === "production" || m === "prod"
        ? "production"
        : undefined;
  return <InventoryScannerView initialMode={initial} />;
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
