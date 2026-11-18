import { HrmsShell } from '@/components/hrms/hrms-shell';

export default function HrLayout({ children }: { children: React.ReactNode }) {
  return <HrmsShell>{children}</HrmsShell>;
}
