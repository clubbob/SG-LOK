export const MENU_ACCESS_KEYS = [
  'dashboard',
  'production',
  'certificate',
  'inventory',
  'dealer',
  'substitute',
  'notices',
  'inquiry',
  'mypage',
] as const;

export type MenuAccessKey = (typeof MENU_ACCESS_KEYS)[number];

export const MENU_ACCESS_LABELS: Record<MenuAccessKey, string> = {
  dashboard: '대시보드',
  production: '생산관리',
  certificate: '성적서관리',
  inventory: '재고관리',
  dealer: '대리점관리',
  substitute: '대체품코드',
  notices: '공지사항',
  inquiry: '문의하기',
  mypage: '회원정보 관리',
};

const MENU_PATH_PREFIXES: Record<MenuAccessKey, string[]> = {
  dashboard: ['/dashboard', '/'],
  production: ['/production'],
  certificate: ['/certificate'],
  inventory: ['/inventory'],
  dealer: ['/dealer-customers'],
  substitute: ['/substitute'],
  notices: ['/notices'],
  inquiry: ['/inquiry'],
  mypage: ['/mypage'],
};

const EXCLUDED_PATH_PREFIXES = ['/login', '/signup', '/admin'];

export function normalizeAllowedMenus(value: unknown): MenuAccessKey[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<MenuAccessKey>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if ((MENU_ACCESS_KEYS as readonly string[]).includes(entry)) {
      set.add(entry as MenuAccessKey);
    }
  }
  return [...set];
}

export function getAllowedMenusOrDefault(value: unknown): MenuAccessKey[] {
  const normalized = normalizeAllowedMenus(value);
  return normalized.length > 0 ? normalized : [...MENU_ACCESS_KEYS];
}

export function resolveMenuKeyByPath(pathname: string): MenuAccessKey | null {
  if (!pathname) return null;
  if (pathname === '/') return 'dashboard';
  for (const key of MENU_ACCESS_KEYS) {
    const prefixes = MENU_PATH_PREFIXES[key];
    if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return key;
    }
  }
  return null;
}

export function isPathGuardExcluded(pathname: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function resolveFallbackPath(allowedMenus: MenuAccessKey[]): string {
  const primary = allowedMenus[0] ?? 'dashboard';
  switch (primary) {
    case 'dashboard':
      return '/';
    case 'production':
      return '/production';
    case 'certificate':
      return '/certificate';
    case 'inventory':
      return '/inventory';
    case 'dealer':
      return '/dealer-customers';
    case 'substitute':
      return '/substitute/menu';
    case 'notices':
      return '/notices';
    case 'inquiry':
      return '/inquiry';
    case 'mypage':
      return '/mypage';
    default:
      return '/';
  }
}
