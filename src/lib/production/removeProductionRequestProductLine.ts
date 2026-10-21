import { deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreSanitize';
import { buildProductionRequestPatchAfterProductsChange } from '@/lib/products/requestProductLines';
import type { ProductionRequestListRow } from '@/lib/production/productionRequestDisplay';

/** 다중 제품이면 해당 줄만 제거, 마지막 1개면 요청 전체 삭제 */
export async function removeProductionRequestProductLine(
  listRow: ProductionRequestListRow
): Promise<'line_removed' | 'request_deleted'> {
  const request = listRow.request;
  const products = request.products;

  if (products && products.length > 1) {
    const remaining = products.filter((_, index) => index !== listRow.productIndex);
    await updateDoc(
      doc(db, 'productionRequests', request.id),
      sanitizeForFirestore(buildProductionRequestPatchAfterProductsChange(request, remaining))
    );
    return 'line_removed';
  }

  await deleteDoc(doc(db, 'productionRequests', request.id));
  return 'request_deleted';
}
