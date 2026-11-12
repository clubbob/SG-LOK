export const PRODUCTION_MACHINES_COLLECTION = 'productionMachines';

export const PRODUCTION_MACHINE_LOCATIONS = ['A', 'B', 'C', 'D'] as const;
export type ProductionMachineLocation = (typeof PRODUCTION_MACHINE_LOCATIONS)[number];

export const PRODUCTION_MACHINE_KINDS = ['CNC', 'MCT', '복합기'] as const;
export type ProductionMachineKind = (typeof PRODUCTION_MACHINE_KINDS)[number];

export const PRODUCTION_MACHINE_UNIT_MIN = 1;
export const PRODUCTION_MACHINE_UNIT_MAX = 100;

export type ProductionMachine = {
  id: string;
  location: ProductionMachineLocation;
  kind: ProductionMachineKind;
  unit: number;
  machineName: string;
  createdAt?: Date;
  updatedAt?: Date;
};

const PRODUCTION_MACHINE_KIND_CODE: Record<ProductionMachineKind, string> = {
  CNC: 'C',
  MCT: 'M',
  복합기: 'B',
};

/** 기계명: 위치 + 종류 코드 + 호기 (예: A,CNC,1 → AC1 / C,복합기,1 → CB1) */
export function formatProductionMachineName(
  location: ProductionMachineLocation,
  kind: ProductionMachineKind,
  unit: number
): string {
  const kindCode = PRODUCTION_MACHINE_KIND_CODE[kind];
  return `${location.charAt(0)}${kindCode}${unit}`;
}

export function productionMachineKey(
  location: ProductionMachineLocation,
  kind: ProductionMachineKind,
  unit: number
): string {
  return `${location}|${kind}|${unit}`;
}

export function parseProductionMachine(id: string, data: Record<string, unknown>): ProductionMachine | null {
  const location = data.location;
  const kind = data.kind;
  const unit = data.unit;
  if (
    typeof location !== 'string' ||
    !PRODUCTION_MACHINE_LOCATIONS.includes(location as ProductionMachineLocation)
  ) {
    return null;
  }
  if (typeof kind !== 'string' || !PRODUCTION_MACHINE_KINDS.includes(kind as ProductionMachineKind)) {
    return null;
  }
  if (typeof unit !== 'number' || !Number.isInteger(unit) || unit < PRODUCTION_MACHINE_UNIT_MIN || unit > PRODUCTION_MACHINE_UNIT_MAX) {
    return null;
  }
  const machineName =
    typeof data.machineName === 'string' && data.machineName.trim()
      ? data.machineName.trim()
      : formatProductionMachineName(location as ProductionMachineLocation, kind as ProductionMachineKind, unit);

  const createdAt = firestoreDate(data.createdAt);
  const updatedAt = firestoreDate(data.updatedAt);

  return {
    id,
    location: location as ProductionMachineLocation,
    kind: kind as ProductionMachineKind,
    unit,
    machineName,
    createdAt,
    updatedAt,
  };
}

function firestoreDate(value: unknown): Date | undefined {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return undefined;
}

export function compareProductionMachines(a: ProductionMachine, b: ProductionMachine): number {
  const loc = a.location.localeCompare(b.location, 'ko');
  if (loc !== 0) return loc;
  const ki = PRODUCTION_MACHINE_KINDS.indexOf(a.kind) - PRODUCTION_MACHINE_KINDS.indexOf(b.kind);
  if (ki !== 0) return ki;
  return a.unit - b.unit;
}

export const productionMachineSelectClassName =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';
