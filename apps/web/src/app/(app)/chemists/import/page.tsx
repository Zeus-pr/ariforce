import { ImportWizard } from '@/components/masters/import-wizard';

export const metadata = { title: 'Import chemists' };

export default function Page() {
  return <ImportWizard kind="chemists" />;
}
