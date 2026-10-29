import { useRouter } from 'expo-router';
import { AppText } from '../app-text';
import { Card } from '../card';
import { ListRow } from '../list-row';
import { SectionHeader } from '../section-header';
import { SkeletonList } from '../skeleton';
import type { Attention } from '@/lib/home-attention';
import { spacing } from '@/theme';

/** "Needs attention": live items (lib/home-attention), each opens its screen. */
export function AttentionList({ items, pending }: { items: Attention[]; pending: boolean }) {
  const router = useRouter();
  return (
    <>
      <SectionHeader title="Needs attention" meta={pending ? undefined : String(items.length)} />
      {pending ? (
        <SkeletonList count={2} />
      ) : !items.length ? (
        <Card style={{ padding: spacing.lg }}>
          <AppText variant="bodyMuted">You’re all caught up.</AppText>
        </Card>
      ) : (
        <Card>
          {items.map((item, i) => (
            <ListRow
              key={item.id}
              icon={
                item.severity === 'high'
                  ? 'alert-circle-outline'
                  : item.severity === 'medium'
                    ? 'alert-outline'
                    : 'information-outline'
              }
              tone={
                item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'orange' : 'blue'
              }
              title={item.title}
              subtitle={item.detail}
              onPress={() => router.push(item.href)}
              divider={i < items.length - 1}
            />
          ))}
        </Card>
      )}
    </>
  );
}
