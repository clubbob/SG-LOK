import type { TubeFittingMasterMaps } from './masterTypes';

export type TubeParseStatus = 'parsed' | 'partially_parsed' | 'unknown';

export interface TubeFittingParseResult {
  parse_status: TubeParseStatus;
  /** 원시 세그먼트 요약 */
  line1: string;
  /** 사전 기반 해석 한 줄 */
  line2: string;
  parse_notes: string;
}

/**
 * 검색/저장 로직에는 사용하지 않음. 비고·표시 보조 전용.
 * 하이픈 분리 + material/family/end 사전 조회.
 */
export function parseTubeFittingCode(
  normalizedCode: string,
  maps: TubeFittingMasterMaps | null
): TubeFittingParseResult {
  if (!maps || !normalizedCode.trim()) {
    return {
      parse_status: 'unknown',
      line1: normalizedCode || '—',
      line2: '마스터 미로드',
      parse_notes: '',
    };
  }

  const parts = normalizedCode.split('-').filter(Boolean);
  if (parts.length < 2) {
    return {
      parse_status: 'unknown',
      line1: normalizedCode,
      line2: '세그먼트 부족 (Tube Fitting 패턴 아님)',
      parse_notes: 'MVP는 하이픈 기준 분해만 지원',
    };
  }

  const matCode = parts[0];
  const famCode = parts[1];
  const end1Code = parts[2];
  const end2Code = parts[3];
  const optionParts = parts.slice(4);

  const matName = maps.materials.get(matCode);
  const famName = maps.families.get(famCode);
  const end1Name = end1Code ? maps.sizes.get(end1Code) : undefined;
  const end2Name = end2Code ? maps.sizes.get(end2Code) : undefined;

  const seg: string[] = [`Material=${matCode}`, `Family=${famCode}`];
  if (end1Code) seg.push(`End1=${end1Code}`);
  if (end2Code) seg.push(`End2=${end2Code}`);
  if (optionParts.length) seg.push(`Options=${optionParts.join('/')}`);

  const line1 = `Parsed: ${seg.join(', ')}`;

  const matOk = !!matName;
  const famOk = !!famName;
  const partsInterp: string[] = [];
  if (matOk) partsInterp.push(`${matCode} = ${matName}`);
  else partsInterp.push(`${matCode} = Unknown`);
  if (famOk) partsInterp.push(`${famCode} = ${famName}`);
  else partsInterp.push(`${famCode} = Unknown`);
  if (end1Code) {
    partsInterp.push(
      `${end1Code} = ${end1Name ?? `${end1Code} (사전 없음)`}`
    );
  }
  if (end2Code) {
    partsInterp.push(
      `${end2Code} = ${end2Name ?? `${end2Code} (사전 없음)`}`
    );
  }
  if (optionParts.length) {
    partsInterp.push(
      `옵션: ${optionParts.map((o) => maps.options.get(o) ?? o).join(', ')}`
    );
  }

  const line2 = `Interpreted: ${partsInterp.join(' / ')}`;

  let parse_status: TubeParseStatus = 'parsed';
  const notes: string[] = [];
  if (!matOk) {
    parse_status = 'partially_parsed';
    notes.push('material 사전 없음');
  }
  if (!famOk) {
    parse_status = 'partially_parsed';
    notes.push('family 사전 없음');
  }
  if (end1Code && !end1Name) {
    parse_status = 'partially_parsed';
    notes.push('end1 size 사전 없음');
  }
  if (end2Code && !end2Name) {
    parse_status = 'partially_parsed';
    notes.push('end2 size 사전 없음');
  }
  if (optionParts.some((o) => !maps.options.has(o))) {
    parse_status = 'partially_parsed';
    notes.push('일부 옵션 사전 없음');
  }

  return {
    parse_status,
    line1,
    line2,
    parse_notes: notes.join('; '),
  };
}
