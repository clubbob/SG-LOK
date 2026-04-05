import { redirect } from 'next/navigation';

export default function AdminInventoryIndexPage() {
  redirect('/admin/inventory/status');
}
