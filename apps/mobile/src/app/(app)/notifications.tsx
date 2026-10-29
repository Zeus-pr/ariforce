import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { List } from '@/components/scroll';
import { SkeletonList, SkeletonRow } from '@/components/skeleton';
import { TintedIcon } from '@/components/tinted-icon';
import { saveMessage } from '@/lib/dcr/errors';
import { savedLabel } from '@/lib/dcr/dates';
import {
  notificationHref,
  notificationIcon,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
  type Notif,
} from '@/lib/notifications';
import { colors, layout, spacing } from '@/theme';

/** All my notifications, newest first; tap opens the related item and marks it read. */
export default function NotificationsScreen() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const q = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  const open = (n: Notif) => {
    if (!n.readAt) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {q.isPending ? (
        <View style={styles.content}>
          <SkeletonList count={6} />
        </View>
      ) : (
        <PullToRefresh onRefresh={() => Promise.all([q.refetch(), unread.refetch()])}>
          <List
            data={items}
            keyExtractor={(n) => n.id}
            contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
            }}
            ListHeaderComponent={
              <View style={styles.head}>
                <AppText variant="small" style={styles.flex}>
                  {unread.data ? `${unread.data} unread` : 'All caught up'}
                </AppText>
                {unread.data ? (
                  <Button
                    label="Mark all read"
                    variant="secondary"
                    compact
                    loading={markAll.isPending}
                    loadingLabel="Marking…"
                    onPress={() => markAll.mutate()}
                  />
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">
                  {q.isError ? saveMessage(q.error) : 'No notifications yet.'}
                </AppText>
              </Card>
            }
            ListFooterComponent={q.isFetchingNextPage ? <SkeletonRow /> : undefined}
            ItemSeparatorComponent={() => <View style={styles.gap} />}
            renderItem={({ item: n }) => {
              const unreadItem = !n.readAt;
              return (
                <Pressable
                  onPress={() => open(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${unreadItem ? 'Unread. ' : ''}${n.title}. ${n.body}`}
                  style={({ pressed }) => [
                    styles.card,
                    unreadItem && styles.unread,
                    pressed && styles.pressed,
                  ]}
                >
                  <TintedIcon name={notificationIcon(n)} tone={unreadItem ? 'blue' : 'neutral'} />
                  <View style={styles.flex}>
                    <AppText variant={unreadItem ? 'label' : 'body'} numberOfLines={2}>
                      {n.title}
                    </AppText>
                    <AppText variant="bodyMuted" numberOfLines={3}>
                      {n.body}
                    </AppText>
                    <AppText variant="small">{savedLabel(n.createdAt)}</AppText>
                  </View>
                  <View style={styles.side}>
                    {unreadItem ? <View style={styles.dot} /> : null}
                    {unreadItem ? (
                      <Pressable
                        onPress={() => markRead.mutate(n.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Mark as read"
                        hitSlop={8}
                      >
                        <Icon name="check" color={colors.subtle} size={20} />
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        </PullToRefresh>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, minHeight: 40 },
  pad: { padding: spacing.lg },
  gap: { height: spacing.sm },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  unread: { backgroundColor: colors.infoWash },
  pressed: { opacity: 0.85 },
  side: { alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
});
