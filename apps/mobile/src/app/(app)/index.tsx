import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { LogoLockup } from '@/components/logo-lockup';
import { useAuth } from '@/lib/auth-context';
import { colors, fonts, radius, space } from '@/theme';

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  );
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

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
  const first = useMemo(() => name.split(/\s+/)[0] ?? name, [name]);

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
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />
      }
    >
      <View style={styles.topBar}>
        <LogoLockup size={28} />
        <View style={styles.avatar} accessibilityLabel={`Signed in as ${name}`}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
      </View>

      <View style={styles.hello}>
        <Text style={styles.greeting}>{greeting(now)},</Text>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={2}>
          {first}
        </Text>
        <Text style={styles.date}>{dateFmt.format(now)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your account</Text>
        <Row label="Name" value={user?.name ?? '—'} />
        <Row label="Email" value={user?.email ?? '—'} />
        <Row label="Company" value={user?.companyName ?? '—'} last />
      </View>

      <View style={styles.note}>
        <Text style={styles.noteTitle}>Field work is coming to mobile</Text>
        <Text style={styles.noteBody}>
          DCR, tour plans, leave and expenses will appear here. Use the website for them today.
        </Text>
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
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { flexGrow: 1, paddingHorizontal: space.xl - 4 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onNavy },
  hello: { marginTop: space.xl, marginBottom: space.xl },
  greeting: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26, color: colors.muted },
  name: {
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.7,
    color: colors.ink,
  },
  date: { marginTop: 6, fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    shadowColor: colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
    marginBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    gap: space.lg,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  rowValue: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'right',
  },
  note: {
    marginTop: space.lg,
    backgroundColor: '#E8F6F9',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
  },
  noteTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  noteBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: '#2E4A63' },
  spacer: { flexGrow: 1, minHeight: space.xxl },
});
