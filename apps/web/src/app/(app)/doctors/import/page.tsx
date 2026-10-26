import { ImportWizard } from '@/components/masters/import-wizard';

export const metadata = { title: 'Import doctors' };

export default function Page() {
  return <ImportWizard kind="doctors" />;
}
