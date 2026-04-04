import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import tubeFittingMastersSeed from '@/data/tubeFittingMastersSeed.json';
import { COLLECTIONS } from './constants';
import type {
  CodeFamilyMaster,
  CodeMaterialMaster,
  CodeOptionMaster,
  CodeSizeMaster,
  TubeFittingMasterMaps,
} from './masterTypes';

function emptyMaps(): TubeFittingMasterMaps {
  return {
    materials: new Map(),
    families: new Map(),
    sizes: new Map(),
    options: new Map(),
  };
}

/** Firestore에서 Tube Fitting 마스터를 읽어 조회용 Map 으로 만든다. */
export async function loadTubeFittingMasterMaps(
  db: Firestore
): Promise<TubeFittingMasterMaps> {
  const maps = emptyMaps();
  const [matSnap, famSnap, szSnap, optSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.CODE_MATERIAL_MASTER)),
    getDocs(collection(db, COLLECTIONS.CODE_FAMILY_MASTER)),
    getDocs(collection(db, COLLECTIONS.CODE_SIZE_MASTER)),
    getDocs(collection(db, COLLECTIONS.CODE_OPTION_MASTER)),
  ]);

  matSnap.forEach((d) => {
    const x = d.data() as CodeMaterialMaster;
    if (x.is_active !== false && x.material_code) {
      maps.materials.set(x.material_code, x.material_name);
    }
  });
  famSnap.forEach((d) => {
    const x = d.data() as CodeFamilyMaster;
    if (x.is_active !== false && x.family_code) {
      maps.families.set(x.family_code, x.family_name);
    }
  });
  szSnap.forEach((d) => {
    const x = d.data() as CodeSizeMaster;
    if (x.is_active !== false && x.size_code) {
      maps.sizes.set(x.size_code, x.size_name);
    }
  });
  optSnap.forEach((d) => {
    const x = d.data() as CodeOptionMaster;
    if (x.is_active !== false && x.option_code) {
      maps.options.set(x.option_code, x.option_name);
    }
  });

  return maps;
}

type SeedRow = { id: string; [k: string]: unknown };

function withoutId(row: SeedRow): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...row };
  delete rest.id;
  return rest;
}

export async function seedTubeFittingMasters(
  db: Firestore
): Promise<{ inserted: number; skipped: number }> {
  const data = tubeFittingMastersSeed as {
    materials: SeedRow[];
    families: SeedRow[];
    sizes: SeedRow[];
    options: SeedRow[];
  };
  let inserted = 0;
  let skipped = 0;

  for (const m of data.materials) {
    const ref = doc(db, COLLECTIONS.CODE_MATERIAL_MASTER, m.id);
    const ex = await getDoc(ref);
    if (ex.exists()) {
      skipped++;
      continue;
    }
    await setDoc(ref, withoutId(m));
    inserted++;
  }
  for (const f of data.families) {
    const ref = doc(db, COLLECTIONS.CODE_FAMILY_MASTER, f.id);
    const ex = await getDoc(ref);
    if (ex.exists()) {
      skipped++;
      continue;
    }
    await setDoc(ref, withoutId(f));
    inserted++;
  }
  for (const s of data.sizes) {
    const ref = doc(db, COLLECTIONS.CODE_SIZE_MASTER, s.id);
    const ex = await getDoc(ref);
    if (ex.exists()) {
      skipped++;
      continue;
    }
    await setDoc(ref, withoutId(s));
    inserted++;
  }
  for (const o of data.options) {
    const ref = doc(db, COLLECTIONS.CODE_OPTION_MASTER, o.id);
    const ex = await getDoc(ref);
    if (ex.exists()) {
      skipped++;
      continue;
    }
    await setDoc(ref, withoutId(o));
    inserted++;
  }

  return { inserted, skipped };
}
