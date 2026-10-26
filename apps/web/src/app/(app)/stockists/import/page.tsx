import { ImportWizard } from '@/components/masters/import-wizard';

export const metadata = { title: 'Import stockists' };

export default function Page() {
  return <ImportWizard kind="stockists" />;
}
