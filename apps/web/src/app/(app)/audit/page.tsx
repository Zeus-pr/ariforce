import { AuditViewer } from '@/components/audit/audit-viewer';

export const metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <AuditViewer />
    </div>
  );
}
