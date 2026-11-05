import {
  PRODUCTION_PRODUCT_GROUP_OPTIONS,
  formatProductionProductGroupLabel,
} from '@/lib/products/requestProductLines';
import type { ProductionProductGroup } from '@/types';

export type ProductionProductGroupCardTheme = {
  headerRowClass: string;
  groupBadgeClass: string;
  productLineTextClass: string;
  pipeClass: string;
  /** 좌측 accent — border-2 외곽과 한 박스에서 모서리 연결 */
  cardLeftBorderClass: string;
};

const UNKNOWN_GROUP_LABEL = '미지정';

function normalizeProductGroupKey(raw?: string): ProductionProductGroup | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const option of PRODUCTION_PRODUCT_GROUP_OPTIONS) {
    if (option.toLowerCase() === lower) return option;
  }
  return null;
}

function resolveProductGroupKey(
  rawProductGroup?: string,
  displayLabel?: string
): ProductionProductGroup | null {
  const fromRaw = normalizeProductGroupKey(rawProductGroup);
  if (fromRaw) return fromRaw;

  const label = displayLabel?.trim().toUpperCase();
  if (!label || label === UNKNOWN_GROUP_LABEL) return null;

  for (const option of PRODUCTION_PRODUCT_GROUP_OPTIONS) {
    if (formatProductionProductGroupLabel(option) === label) return option;
  }
  return null;
}

const GROUP_THEMES: Record<ProductionProductGroup, ProductionProductGroupCardTheme> = {
  'Lok Fitting': {
    headerRowClass: 'bg-sky-50/95',
    groupBadgeClass: 'border-sky-600 bg-sky-200 text-sky-950',
    productLineTextClass: 'text-sky-950 font-semibold',
    pipeClass: 'text-sky-500',
    cardLeftBorderClass: 'border-l-4 border-l-sky-600',
  },
  'Pipe Fitting': {
    headerRowClass: 'bg-stone-50/95',
    groupBadgeClass: 'border-stone-600 bg-stone-300 text-stone-950',
    productLineTextClass: 'text-stone-900 font-semibold',
    pipeClass: 'text-stone-500',
    cardLeftBorderClass: 'border-l-4 border-l-stone-600',
  },
  'Lok Valve': {
    headerRowClass: 'bg-indigo-50/95',
    groupBadgeClass: 'border-indigo-700 bg-indigo-200 text-indigo-950',
    productLineTextClass: 'text-indigo-950 font-semibold',
    pipeClass: 'text-indigo-500',
    cardLeftBorderClass: 'border-l-4 border-l-indigo-700',
  },
  'UHP Fitting': {
    headerRowClass: 'bg-cyan-50/95',
    groupBadgeClass: 'border-cyan-700 bg-cyan-200 text-cyan-950',
    productLineTextClass: 'text-cyan-950 font-semibold',
    pipeClass: 'text-cyan-600',
    cardLeftBorderClass: 'border-l-4 border-l-cyan-700',
  },
  'UHP Valve': {
    headerRowClass: 'bg-teal-50/95',
    groupBadgeClass: 'border-teal-700 bg-teal-200 text-teal-950',
    productLineTextClass: 'text-teal-950 font-semibold',
    pipeClass: 'text-teal-600',
    cardLeftBorderClass: 'border-l-4 border-l-teal-700',
  },
  Others: {
    headerRowClass: 'bg-amber-50/95',
    groupBadgeClass: 'border-amber-700 bg-amber-200 text-amber-950',
    productLineTextClass: 'text-amber-950 font-semibold',
    pipeClass: 'text-amber-600',
    cardLeftBorderClass: 'border-l-4 border-l-amber-600',
  },
};

const DEFAULT_THEME: ProductionProductGroupCardTheme = {
  headerRowClass: 'bg-slate-50',
  groupBadgeClass: 'border-slate-500 bg-slate-200 text-slate-900',
  productLineTextClass: 'text-slate-900 font-semibold',
  pipeClass: 'text-slate-400',
  cardLeftBorderClass: 'border-l-4 border-l-slate-500',
};

export function getProductionProductGroupCardTheme(
  rawProductGroup?: string,
  displayLabel?: string
): ProductionProductGroupCardTheme {
  const key = resolveProductGroupKey(rawProductGroup, displayLabel);
  if (key) return GROUP_THEMES[key];
  return DEFAULT_THEME;
}

export function getProductionRequestLineProductGroupDisplay(rawProductGroup?: string): string {
  const key = normalizeProductGroupKey(rawProductGroup);
  if (key) return formatProductionProductGroupLabel(key);
  return UNKNOWN_GROUP_LABEL;
}
