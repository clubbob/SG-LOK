// jspdf/dist/jspdf.umd.min.js 는 jsPDF 패키지의 타입 정의에 경로별 선언이 없어
// Next.js(타입 체크)에서 모듈을 찾지 못하는 문제가 발생합니다.
// 해당 경로를 위한 타입 선언을 프로젝트에 추가합니다.

declare module 'jspdf/dist/jspdf.umd.min.js' {
  export const jsPDF: typeof import('jspdf').jsPDF;
  const _default: typeof import('jspdf').jsPDF;
  export default _default;
}

