import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
  type Firestore,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  MANUFACTURER,
  MAPPING_STATUS,
  type MappingStatus,
} from './constants';
import { expandAlternateSearchKeys } from './codeNormalize';
import { buildMappingDocumentId } from './mappingId';
import type {
  SubstituteMapping,
  SubstituteMappingDoc,
  SubstituteMappingHistoryEntry,
} from './types';

const TRACKED_FIELDS: (keyof SubstituteMapping)[] = [
  'manufacturer_from',
  'code_from',
  'normalized_code_from',
  'image_url_from',
  'product_name_from',
  'manufacturer_to',
  'code_to',
  'normalized_code_to',
  'product_name_to',
  'confidence',
  'source_type',
  'source_name',
  'source_url',
  'source_note',
  'remarks',
  'status',
];

function plainFieldValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    const t = v as { seconds: number };
    return new Date(t.seconds * 1000).toISOString();
  }
  return v;
}

function mappingToPlain(m: Partial<SubstituteMapping>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of TRACKED_FIELDS) {
    if (k in m) o[k] = plainFieldValue(m[k]);
  }
  return o;
}

function diffFields(
  before: Partial<SubstituteMapping>,
  after: Partial<SubstituteMapping>
): string[] {
  const changed: string[] = [];
  for (const k of TRACKED_FIELDS) {
    const b = JSON.stringify(plainFieldValue(before[k]));
    const a = JSON.stringify(plainFieldValue(after[k]));
    if (b !== a) changed.push(k);
  }
  return changed;
}

/**
 * Swagelok 정규화 코드로 S-LOK 대응 매핑 검색.
 * @param verifiedOnly true면 검증완료(verified)만 — false면 verified·검토(reviewed)·후보(candidate)까지 조회해 대체 코드를 빠짐없이 표시
 */
export async function searchMappingsBySwagelokCode(
  db: Firestore,
  normalizedCode: string,
  verifiedOnly: boolean
): Promise<SubstituteMappingDoc[]> {
  const statuses = verifiedOnly
    ? [MAPPING_STATUS.VERIFIED]
    : [MAPPING_STATUS.VERIFIED, MAPPING_STATUS.REVIEWED, MAPPING_STATUS.CANDIDATE];

  const keys = expandAlternateSearchKeys(normalizedCode);

  const q = query(
    collection(db, COLLECTIONS.MAPPINGS),
    where('manufacturer_from', '==', MANUFACTURER.SWAGELOK),
    where('normalized_code_from', 'in', keys),
    where('status', 'in', statuses)
  );

  const snap = await getDocs(q);
  const list: SubstituteMappingDoc[] = [];
  snap.forEach((d) => {
    list.push({ id: d.id, ...d.data() } as SubstituteMappingDoc);
  });

  const orderRank = (s: MappingStatus) =>
    s === MAPPING_STATUS.VERIFIED ? 0 : s === MAPPING_STATUS.REVIEWED ? 1 : 2;
  list.sort((a, b) => orderRank(a.status) - orderRank(b.status));

  return list;
}

/** 관리자: 동일 키로 exact 검색 (상태 필터 옵션) */
export async function adminSearchByNormalizedFrom(
  db: Firestore,
  normalizedCode: string,
  statusFilter: 'all' | MappingStatus
): Promise<SubstituteMappingDoc[]> {
  const keys = expandAlternateSearchKeys(normalizedCode);

  if (statusFilter === 'all') {
    const q = query(
      collection(db, COLLECTIONS.MAPPINGS),
      where('manufacturer_from', '==', MANUFACTURER.SWAGELOK),
      where('normalized_code_from', 'in', keys)
    );
    const snap = await getDocs(q);
    const list: SubstituteMappingDoc[] = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() } as SubstituteMappingDoc));
    return list;
  }
  const q = query(
    collection(db, COLLECTIONS.MAPPINGS),
    where('manufacturer_from', '==', MANUFACTURER.SWAGELOK),
    where('normalized_code_from', 'in', keys),
    where('status', '==', statusFilter)
  );
  const snap = await getDocs(q);
  const list: SubstituteMappingDoc[] = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() } as SubstituteMappingDoc));
  return list;
}

export async function fetchAllMappings(db: Firestore): Promise<SubstituteMappingDoc[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.MAPPINGS));
  const list: SubstituteMappingDoc[] = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() } as SubstituteMappingDoc));
  return list;
}

export async function fetchMappingHistory(
  db: Firestore,
  mappingId: string,
  max = 40
): Promise<SubstituteMappingHistoryEntry[]> {
  const q = query(
    collection(db, COLLECTIONS.MAPPING_HISTORY),
    where('mapping_id', '==', mappingId),
    limit(max * 2)
  );
  const snap = await getDocs(q);
  const list: SubstituteMappingHistoryEntry[] = [];
  snap.forEach((d) => list.push(d.data() as SubstituteMappingHistoryEntry));
  const ts = (e: SubstituteMappingHistoryEntry) => {
    const c = e.changed_at as { seconds?: number } | null;
    return c?.seconds ?? 0;
  };
  list.sort((a, b) => ts(b) - ts(a));
  return list.slice(0, max);
}

export type MappingWritePayload = Omit<
  SubstituteMapping,
  'updated_at' | 'created_at'
> & { updated_by: string; created_by: string };

export async function createMapping(
  db: Firestore,
  payload: MappingWritePayload
): Promise<string> {
  const id = buildMappingDocumentId(payload.manufacturer_from, payload.normalized_code_from);
  const ref = doc(db, COLLECTIONS.MAPPINGS, id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error('동일 매핑 문서가 이미 있습니다. 수정을 이용하세요.');
  }
  const now = serverTimestamp();
  await setDoc(ref, {
    ...payload,
    created_at: now,
    updated_at: now,
  });
  await addDoc(collection(db, COLLECTIONS.MAPPING_HISTORY), {
    mapping_id: id,
    before: {},
    after: mappingToPlain(payload),
    changed_fields: ['__create__'],
    changed_at: now,
    changed_by: payload.created_by,
  });
  return id;
}

function omitUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

export async function deleteMapping(
  db: Firestore,
  mappingId: string,
  changedBy: string
): Promise<void> {
  const ref = doc(db, COLLECTIONS.MAPPINGS, mappingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('매핑을 찾을 수 없습니다.');
  const before = snap.data() as SubstituteMapping;
  const now = serverTimestamp();
  await addDoc(collection(db, COLLECTIONS.MAPPING_HISTORY), {
    mapping_id: mappingId,
    before: mappingToPlain(before),
    after: {},
    changed_fields: ['__delete__'],
    changed_at: now,
    changed_by: changedBy,
  });
  await deleteDoc(ref);
}

export async function updateMapping(
  db: Firestore,
  mappingId: string,
  payload: Partial<MappingWritePayload>,
  changedBy: string
): Promise<void> {
  const ref = doc(db, COLLECTIONS.MAPPINGS, mappingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('매핑을 찾을 수 없습니다.');
  const before = snap.data() as SubstituteMapping;
  const merged = omitUndefined(payload as Record<string, unknown>);
  const after = { ...before, ...merged } as SubstituteMapping;
  const changed = diffFields(before, after);
  if (changed.length === 0) return;
  const now = serverTimestamp();
  await updateDoc(ref, {
    ...merged,
    updated_at: now,
    updated_by: changedBy,
  });
  await addDoc(collection(db, COLLECTIONS.MAPPING_HISTORY), {
    mapping_id: mappingId,
    before: mappingToPlain(before),
    after: mappingToPlain(after),
    changed_fields: changed,
    changed_at: now,
    changed_by: changedBy,
  });
}

export async function upsertSeedMapping(
  db: Firestore,
  row: Record<string, unknown>,
  actor: string
): Promise<'inserted' | 'skipped'> {
  const payload = row as unknown as MappingWritePayload;
  const id = buildMappingDocumentId(payload.manufacturer_from, payload.normalized_code_from);
  const ref = doc(db, COLLECTIONS.MAPPINGS, id);
  const existing = await getDoc(ref);
  if (existing.exists()) return 'skipped';
  const now = serverTimestamp();
  await setDoc(ref, {
    ...payload,
    created_at: now,
    updated_at: now,
    created_by: actor,
    updated_by: actor,
  });
  return 'inserted';
}
