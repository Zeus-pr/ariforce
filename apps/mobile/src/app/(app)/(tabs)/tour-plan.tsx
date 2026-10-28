import { ComingSoon } from '@/components/coming-soon';
import { TabScene } from '@/components/floating-tab-bar';

export default function TourPlanTab() {
  return (
    <TabScene>
      <ComingSoon feature="tour-plan" />
    </TabScene>
  );
}
