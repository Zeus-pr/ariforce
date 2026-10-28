import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { useAuth } from '@/lib/auth-context';
import { colors, radius, shadows, spacing, touch } from '@/theme';

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar} accessible accessibilityLabel={`Signed in as ${name}`}>
      <AppText variant="avatar">{initials(name)}</AppText>
    </View>
  );
}

export default function HomeScreen() {
  const { user, signOut, refresh } = useAuth();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Keep the greeting right if the app stays open across noon / 5 pm.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const name = user?.name?.trim() || user?.email || 'there';
  const first = name.split(/\s+/)[0] ?? name;

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setNow(new Date());
    setRefreshing(false);
  }

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <Avatar name={name} /> }} />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.navy}
            colors={[colors.navy]}
          />
        }
      >
        <View style={styles.hello}>
          <AppText variant="greeting">{greeting(now)},</AppText>
          <AppText variant="name" accessibilityRole="header" numberOfLines={2}>
            {first}
          </AppText>
          <AppText variant="caption" style={styles.date}>
            {dateFmt.format(now)}
          </AppText>
        </View>

        <View style={styles.group}>
          <AppText variant="headline" style={styles.groupTitle}>
            Your account
          </AppText>
          <Row label="Name" value={user?.name ?? '—'} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Company" value={user?.companyName ?? '—'} last />
        </View>

        <View style={styles.note}>
          <AppText variant="headline">Field work is coming to mobile</AppText>
          <AppText variant="caption" style={styles.noteBody}>
            DCR, tour plans, leave and expenses will appear here. Use the website for them today.
          </AppText>
        </View>

        <View style={styles.spacer} />

        <Button
          label="Sign out"
          loadingLabel="Signing out…"
          variant="secondary"
          loading={signingOut}
          onPress={onSignOut}
        />
      </ScrollView>
    </>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="label" style={styles.rowValue} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hello: { paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  date: { marginTop: spacing.xs },
  // One grouped surface with hairline rows (not a card per row).
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    boxShadow: shadows.card,
  },
  groupTitle: { marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: touch.min,
    gap: spacing.lg,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  // Plain tinted note, no shadow: information, not a control.
  note: {
    marginTop: spacing.xl,
    backgroundColor: colors.tealWash,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noteBody: { color: colors.tealInk },
  spacer: { flexGrow: 1, minHeight: spacing.xxl },
});
