import { ComingSoon } from '@/components/coming-soon';
import { TabScene } from '@/components/floating-tab-bar';

export default function DcrTab() {
  return (
    <TabScene>
      <ComingSoon feature="dcr" />
    </TabScene>
  );
}
