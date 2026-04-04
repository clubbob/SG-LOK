import { redirect } from "next/navigation";

/** 예전 메뉴 경로 호환 */
export default function SwagelokCatalogLegacyRedirectPage() {
  redirect("/admin/substitute/code-db");
}
