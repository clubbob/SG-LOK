import { NextRequest, NextResponse } from 'next/server';
import { getAdminStorage } from '@/lib/firebaseAdmin';

function normalizeStoragePath(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';

  // Handle Firebase download URL format
  const marker = '/o/';
  const markerIdx = raw.indexOf(marker);
  if (markerIdx >= 0) {
    const encoded = raw.slice(markerIdx + marker.length).split('?')[0] || '';
    try {
      return decodeURIComponent(encoded).replace(/^\/+/, '');
    } catch {
      return encoded.replace(/^\/+/, '');
    }
  }

  // Handle gs://bucket/path format
  if (raw.startsWith('gs://')) {
    const withoutScheme = raw.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx >= 0) {
      return withoutScheme.slice(slashIdx + 1).replace(/^\/+/, '');
    }
    return '';
  }

  try {
    return decodeURIComponent(raw).replace(/^\/+/, '');
  } catch {
    return raw.replace(/^\/+/, '');
  }
}

export async function GET(request: NextRequest) {
  try {
    // Keep this route active for fresh redeploys.
    const requestedPath = request.nextUrl.searchParams.get('path') || '';
    const storagePath = normalizeStoragePath(requestedPath);
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
