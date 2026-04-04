import { NextResponse } from 'next/server';

/** HTML이 바뀌어도 잡히도록 넓게 매칭 (?impolicy= 없을 수 있음) */
function extractProductImage(html: string): string | null {
  const isPlaceholder = (u: string) => /placeholder/i.test(u);

  const preload = html.match(
    /appendPreloadImages\(\s*["'](https?:\/\/(?:www\.)?swagelok\.com\/assets\/images\/product_images\/large\/[^"']+)["']\s*\)/i
  );
  if (preload?.[1] && !isPlaceholder(preload[1])) return preload[1];

  const dataSrc = html.match(
    /data-src=["'](https?:\/\/(?:www\.)?swagelok\.com\/assets\/images\/product_images\/large\/[^"']+)["']/i
  );
  if (dataSrc?.[1] && !isPlaceholder(dataSrc[1])) return dataSrc[1];

  return null;
}

export const dynamic = 'force-dynamic';

/**
 * Swagelok 공식 제품 페이지(en) HTML에서 대표 이미지 URL을 추출합니다.
 * (캐시로 예전 실패 응답이 며칠 붙는 일을 막기 위해 매 요청마다 가져옵니다.)
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code')?.trim();
  if (!code) {
    return NextResponse.json({ error: 'code 파라미터가 필요합니다.' }, { status: 400 });
  }
  if (!/^[A-Z0-9-]+$/i.test(code)) {
    return NextResponse.json({ error: '품번 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const upper = code.toUpperCase();
  const productPageUrl = `https://products.swagelok.com/en/p/${encodeURIComponent(upper)}`;

  try {
    const res = await fetch(productPageUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await res.text();
    const imageUrl = extractProductImage(html);
    return NextResponse.json({
      productPageUrl,
      imageUrl,
      pageOk: res.ok,
    });
  } catch {
    return NextResponse.json({
      productPageUrl,
      imageUrl: null,
      pageOk: false,
    });
  }
}
