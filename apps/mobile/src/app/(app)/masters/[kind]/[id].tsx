import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ScrollView } from '@/components/scroll';
import { TintedIcon } from '@/components/tinted-icon';
import { SkeletonDetail } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { FEATURES } from '@/lib/features';
import {
  APPROVAL_LABEL,
  isMasterKind,
  isPlaceholderName,
  MASTERS,
  useLookups,
  useMasterRecord,
  type MasterKind,
} from '@/lib/masters';
import { canWriteMasters } from '@/lib/roles';
import { colors, layout, radius, spacing, touch } from '@/theme';

export default function MasterDetailScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  if (!isMasterKind(kind) || typeof id !== 'string') return <Redirect href="/business" />;
  return <MasterDetail kind={kind} id={id} />;
}

const LOOKUP_TYPES = ['territory', 'specialty', 'category'];

/**
 * One record (web doctors-view.tsx Doctor360 header + record-sheet.tsx ReadOnlyDetails):
 * name, category and approval status, rejection note, every field. Edit for RBM and above.
 */
function MasterDetail({ kind, id }: { kind: MasterKind; id: string }) {
  const cfg = MASTERS[kind];
  const router = useRouter();
  const bottom = useBottomSpace();
  const { user } = useAuth();
  const canWrite = canWriteMasters(user?.roles ?? []);
  const lk = useLookups();
  const rec = useMasterRecord(kind, id);
  const row = rec.data;
  const title = `${cfg.singular[0]!.toUpperCase()}${cfg.singular.slice(1)}`;

  if (rec.isPending)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title }} />
        <SkeletonDetail fields={cfg.fields.length} />
      </View>
    );
  if (!row)
    return (
      <View style={[styles.flex, styles.centerFill]}>
        <Stack.Screen options={{ title }} />
        <AppText variant="bodyMuted" style={styles.centerText}>
          {`This ${cfg.singular} isn’t in your list.`}
        </AppText>
      </View>
    );

  const values = row as unknown as Record<string, string | null>;
  const doctor = kind === 'doctors' && 'approvalStatus' in row ? row : null;
  const category = doctor?.categoryId
    ? lk.categories.find((c) => c.id === doctor.categoryId)
    : null;
  const rejection = doctor?.approvalStatus === 'rejected' && doctor.rejectionReason ? doctor : null;
  const summary = doctor
    ? [
        doctor.qualification,
        doctor.specialtyId && lk.byId.get(doctor.specialtyId),
        doctor.registrationNo && `Reg. ${doctor.registrationNo}`,
      ]
    : ['gstin' in row && row.gstin && `GSTIN ${row.gstin}`];
  const place = [row.addressLine, row.city, lk.byId.get(row.territoryId)]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={rec.isRefetching}
            onRefresh={() => void rec.refetch()}
            tintColor={colors.navy}
            colors={[colors.navy]}
          />
        }
      >
        <Card style={styles.hero}>
          <TintedIcon name={FEATURES[kind].icon} tone={FEATURES[kind].tone} large />
          <AppText variant="name" accessibilityRole="header">
            {row.name}
          </AppText>
          <View style={styles.chips}>
            {category ? <Chip label={category.name} tone="teal" /> : null}
            {doctor && doctor.approvalStatus !== 'approved' ? (
              <Chip
                label={APPROVAL_LABEL[doctor.approvalStatus] ?? doctor.approvalStatus}
                tone={doctor.approvalStatus === 'rejected' ? 'red' : 'orange'}
              />
            ) : null}
            {doctor && isPlaceholderName(row.name) ? (
              <Chip label="Placeholder" tone="neutral" />
            ) : null}
          </View>
          {summary.some(Boolean) ? (
            <AppText variant="subhead">{summary.filter(Boolean).join(' · ')}</AppText>
          ) : null}
          {place ? (
            <View style={styles.line}>
              <Icon name="map-marker-outline" size={18} color={colors.muted} />
              <AppText variant="subhead" style={styles.flexText}>
                {place}
              </AppText>
            </View>
          ) : null}
          {row.phone ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:${row.phone}`)}
              accessibilityRole="link"
              accessibilityLabel={`Call ${row.phone}`}
              style={[styles.line, styles.call]}
            >
              <Icon name="phone-outline" size={18} color={colors.tealDeep} />
              <AppText variant="label" style={styles.callText}>
                {row.phone}
              </AppText>
            </Pressable>
          ) : null}
        </Card>

        {rejection ? (
          <View style={styles.rejection}>
            <AppText variant="label" style={styles.rejectionTitle}>
              Rejected{rejection.rejectedBy?.name ? ` by ${rejection.rejectedBy.name}` : ''}
            </AppText>
            <AppText variant="body">{rejection.rejectionReason}</AppText>
          </View>
        ) : null}

        <Card>
          {cfg.fields.map((f, i) => {
            const raw = values[f.key];
            const v = raw && LOOKUP_TYPES.includes(f.type) ? (lk.byId.get(raw) ?? raw) : raw;
            return (
              <View
                key={f.key}
                style={[styles.field, i < cfg.fields.length - 1 && styles.divider]}
                accessible
                accessibilityLabel={`${f.label}: ${v || 'none'}`}
              >
                <AppText variant="small">{f.label}</AppText>
                <AppText variant="body">{v || '—'}</AppText>
              </View>
            );
          })}
        </Card>

        {canWrite ? (
          <Button
            label={`Edit ${cfg.singular}`}
            onPress={() =>
              router.push({ pathname: '/masters/[kind]/form', params: { kind, id: row.id } })
            }
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  flexText: { flex: 1 },
  centerFill: { alignItems: 'center', justifyContent: 'center', padding: layout.gutter },
  centerText: { textAlign: 'center' },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: layout.inner },
  hero: { padding: spacing.lg, gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  call: { minHeight: touch.min, alignSelf: 'flex-start' },
  callText: { color: colors.tealDeep },
  rejection: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.dangerWash,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  rejectionTitle: { color: colors.danger },
  field: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
});
