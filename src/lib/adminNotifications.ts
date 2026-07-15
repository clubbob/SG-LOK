export type AdminNotificationType = 'production_request' | 'certificate_request';

export type AdminNotification = {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  refId?: string;
  createdAt: Date;
  read: boolean;
};

export const ADMIN_NOTIFICATIONS_COLLECTION = 'adminNotifications';
export const ADMIN_NOTIF_CHECK_KEY = 'admin_pending_notif_check';

export function buildProductionRequestNotification(params: {
  userName: string;
  productName: string;
  quantity: number;
  customerName?: string;
  refId?: string;
}): Omit<AdminNotification, 'id' | 'createdAt' | 'read'> {
  const customer = params.customerName?.trim() ? ` / 고객사 ${params.customerName.trim()}` : '';
  return {
    type: 'production_request',
    title: '신규 생산요청',
    message: `${params.userName}님이 ${params.productName} (요청수량 ${params.quantity.toLocaleString()})${customer} 생산요청을 등록했습니다.`,
    refId: params.refId,
  };
}

export function buildCertificateRequestNotification(params: {
  userName: string;
  customerName?: string;
  productName?: string;
  refId?: string;
}): Omit<AdminNotification, 'id' | 'createdAt' | 'read'> {
  const customer = params.customerName?.trim() || '-';
  const product = params.productName?.trim() ? ` / 제품 ${params.productName.trim()}` : '';
  return {
    type: 'certificate_request',
    title: '신규 성적서요청',
    message: `${params.userName}님이 고객사 ${customer}${product} 성적서 요청을 등록했습니다.`,
    refId: params.refId,
  };
}

export async function postAdminNotification(
  payload: Omit<AdminNotification, 'id' | 'createdAt' | 'read'>
): Promise<void> {
  try {
    await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('관리자 알림 등록 실패:', error);
  }
}
