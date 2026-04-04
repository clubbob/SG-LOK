import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, TUBE_FITTING_CATEGORY } from './constants';
import type { SwagelokCatalogPartDoc } from './types';

export function buildSwagelokCatalogDocId(normalizedCode: string): string {
  const safe = normalizedCode.replace(/[/\\]/g, '_');
  return `SWAGELOK_CAT_${safe}`.slice(0, 1400);
}

export async function fetchSwagelokCatalogParts(db: Firestore): Promise<SwagelokCatalogPartDoc[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.SWAGELOK_CATALOG_PARTS));
  const list: SwagelokCatalogPartDoc[] = [];
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    list.push({
      id: d.id,
      manufacturer: String(data.manufacturer ?? 'SWAGELOK'),
      product_category: String(data.product_category ?? TUBE_FITTING_CATEGORY),
      product_name: String(
        data.product_name ?? data.category_path ?? data.normalized_code ?? ''
      ),
      product_code: String(data.product_code ?? data.code_raw ?? data.normalized_code ?? ''),
      normalized_code: String(data.normalized_code ?? ''),
      code_raw: data.code_raw != null ? String(data.code_raw) : undefined,
      category_path: data.category_path != null ? String(data.category_path) : undefined,
      ordering_token: data.ordering_token != null ? String(data.ordering_token) : undefined,
      material_assumed: data.material_assumed != null ? String(data.material_assumed) : undefined,
      catalog_import_profile:
        data.catalog_import_profile != null ? String(data.catalog_import_profile) : undefined,
      source: data.source != null ? String(data.source) : undefined,
      source_page_hint: data.source_page_hint != null ? String(data.source_page_hint) : undefined,
      created_at: data.created_at as SwagelokCatalogPartDoc['created_at'],
      updated_at: data.updated_at as SwagelokCatalogPartDoc['updated_at'],
    });
  });
  list.sort((a, b) => a.product_code.localeCompare(b.product_code, 'en'));
  return list;
}

export type SwagelokCatalogSeedRow = {
  id: string;
  manufacturer?: string;
  product_category?: string;
  product_name?: string;
  product_code?: string;
  normalized_code?: string;
  code_raw?: string;
  category_path?: string;
  ordering_token?: string;
  material_assumed?: string;
  catalog_import_profile?: string;
  source?: string;
  source_page_hint?: string;
};

const BATCH_MAX = 400;

/**
 * 시드 JSON 행을 Firestore에 merge 저장합니다. 관리자 화면에서 최초 적재·갱신용.
 */
export async function upsertSwagelokCatalogFromSeed(
  db: Firestore,
  rows: SwagelokCatalogSeedRow[]
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_MAX) {
    const batch = writeBatch(db);
    const chunk = rows.slice(i, i + BATCH_MAX);
    let ops = 0;
    for (const row of chunk) {
      const { id, ...rest } = row;
      if (!id || !rest.normalized_code) continue;
      const ref = doc(db, COLLECTIONS.SWAGELOK_CATALOG_PARTS, id);
      batch.set(
        ref,
        {
          ...rest,
          manufacturer: rest.manufacturer ?? 'SWAGELOK',
          product_category: rest.product_category ?? TUBE_FITTING_CATEGORY,
          product_name: rest.product_name ?? rest.category_path ?? rest.normalized_code,
          product_code: rest.product_code ?? rest.code_raw ?? rest.normalized_code,
          updated_at: serverTimestamp(),
        },
        { merge: true }
      );
      ops++;
      total++;
    }
    if (ops > 0) await batch.commit();
  }
  return total;
}
