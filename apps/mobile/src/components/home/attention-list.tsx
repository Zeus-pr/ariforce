import { Card } from '../card';
import { ListRow } from '../list-row';
import { SectionHeader } from '../section-header';
import type { FeatureKey } from '@/lib/features';
import type { AttentionItem } from '@/mocks/home';

/** Flags (missed DCR, punch-in, tour plan): the website's exception rules, shown only if any. */
export function AttentionList({
  items,
  onOpen,
}: {
  items: AttentionItem[];
  onOpen: (feature: FeatureKey) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionHeader title="Needs attention" meta={String(items.length)} />
      <Card>
        {items.map((item, i) => (
          <ListRow
            key={item.id}
            icon={item.severity === 'high' ? 'alert-circle-outline' : 'alert-outline'}
            tone={item.severity === 'high' ? 'red' : 'orange'}
            title={item.title}
            subtitle={item.detail}
            onPress={() => onOpen(item.feature)}
            divider={i < items.length - 1}
          />
        ))}
      </Card>
    </>
  );
}
