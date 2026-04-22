import { NextRequest, NextResponse } from 'next/server';
import { getAdminStorage } from '@/lib/firebaseAdmin';

export async function GET(request: NextRequest) {
  try {
    const storagePath = request.nextUrl.searchParams.get('path') || '';
    if (!storagePath || !storagePath.startsWith('certificates/')) {
      return NextResponse.json({ error: '유효하지 않은 path 입니다.' }, { status: 400 });
    }

    const bucket = getAdminStorage().bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ error: '파일이 존재하지 않습니다.' }, { status: 404 });
    }

    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';

    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `storage proxy 실패: ${message}` }, { status: 500 });
  }
}
