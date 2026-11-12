import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Card } from './card';
import { Chip } from './chip';
import { Icon } from './icon';
import { PressableScale } from './pressable-scale';
import { SkeletonList } from './skeleton';
import { ApiError } from '@/lib/api';
import {
  OUTLET_LOCK_LABELS,
  fieldErrorMessage,
  getDoctorLockCap,
  googleMapsUrl,
  listOutletLocations,
  outletLockLabelText,
  patchOutletLocation,
  setDoctorLockCap,
  type OutletKind,
  type OutletLocation,
} from '@/lib/field';
import { canManageOutletLocks } from '@/lib/roles';
import { colors, fonts, radius, spacing, touch } from '@/theme';

function fmtWhen(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/**
 * Active GPS locks for one doctor / chemist / stockist.
 * Managers (ABM+) can change the label or deactivate a wrong first lock so the next
 * mobile Check in locks again. Matches web OutletLocksCard.
 */
export function OutletLocksCard({
  outletKind,
  outletId,
  roles,
}: {
  outletKind: OutletKind;
  outletId: string;
  roles: readonly string[];
}) {
  const canManage = canManageOutletLocks(roles);
  const [items, setItems] = useState<OutletLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [capBusy, setCapBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listOutletLocations(outletKind, outletId));
      if (outletKind === 'doctor') setCap(await getDoctorLockCap(outletId));
    } catch (e) {
      setItems([]);
      if (e instanceof ApiError && e.status === 403) {
        setError('You do not have permission to view locked locations.');
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setError(null);
        return;
      }
      setError(fieldErrorMessage(e));
    }
  }, [outletKind, outletId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function patch(loc: OutletLocation, body: { label?: string; active?: boolean }) {
    setBusyId(loc.id);
    try {
      await patchOutletLocation(loc.id, { version: loc.version, ...body });
      await load();
    } catch (e) {
      Alert.alert('Couldn’t update lock', fieldErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  function confirmDeactivate(loc: OutletLocation) {
    Alert.alert(
      'Deactivate this lock?',
      'The pin is removed from check-in. The next Check in on mobile will lock a new location at the rep’s GPS. History keeps the old coordinates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => void patch(loc, { active: false }),
        },
      ],
    );
  }

  async function saveCap(next: number) {
    setCapBusy(true);
    try {
      setCap(await setDoctorLockCap(outletId, next));
    } catch (e) {
      Alert.alert('Couldn’t update the pin cap', fieldErrorMessage(e));
    } finally {
      setCapBusy(false);
    }
  }

  function cycleLabel(loc: OutletLocation) {
    const opts = OUTLET_LOCK_LABELS[outletKind];
    const i = opts.findIndex((o) => o.value === loc.label);
    const next = opts[(i + 1) % opts.length]!;
    void patch(loc, { label: next.value });
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Icon name="map-marker-radius-outline" size={22} color={colors.canopyDeep} />
        </View>
        <View style={styles.headText}>
          <AppText variant="label">Locked locations</AppText>
          <AppText variant="small" style={styles.desc}>
            GPS pins for check-in and Presentation.
            {outletKind === 'doctor' && cap != null
              ? cap === 1
                ? ' This doctor can have 1 active pin. A check-in away from it is refused.'
                : ` This doctor can have ${cap} active pins. Checking in away from these can lock another chamber until that cap.`
              : ''}
            {canManage
              ? ' Deactivate a wrong pin so the next Check in locks again.'
              : ' Ask your ABM or admin to fix a wrong pin.'}
          </AppText>
        </View>
      </View>

      {outletKind === 'doctor' && canManage && cap != null ? (
        <View style={styles.capRow}>
          <AppText variant="small" style={styles.desc}>
            Active pins allowed
          </AppText>
          <View style={styles.capChoices}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = n === cap;
              return (
                <PressableScale
                  key={n}
                  onPress={() => void saveCap(n)}
                  disabled={capBusy || on}
                  accessibilityLabel={`Allow ${n} active pins`}
                  accessibilityState={{ selected: on }}
                  scaleTo={0.96}
                  style={[styles.capChoice, on && styles.capChoiceOn]}
                >
                  <AppText
                    variant="label"
                    style={on ? styles.capChoiceOnText : styles.capChoiceText}
                  >
                    {n}
                  </AppText>
                </PressableScale>
              );
            })}
          </View>
        </View>
      ) : null}

      {items === null ? (
        <SkeletonList count={1} />
      ) : error ? (
        <AppText variant="small" style={styles.err}>
          {error}
        </AppText>
      ) : !items.length ? (
        <AppText variant="bodyMuted" style={styles.empty}>
          No lock yet. The first Check in on mobile will set the GPS pin
          {outletKind === 'doctor' ? ' (clinic by default)' : ''}.
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((loc, i) => {
            const busy = busyId === loc.id;
            const { lat, lng } = loc.location;
            return (
              <View
                key={loc.id}
                style={[styles.row, i < items.length - 1 && styles.divider, busy && styles.busy]}
              >
                <View style={styles.rowBody}>
                  <View style={styles.chips}>
                    <Chip label={outletLockLabelText(outletKind, loc.label)} tone="teal" />
                    {loc.accuracyM != null ? (
                      <AppText variant="small" style={styles.meta}>
                        ±{Math.round(loc.accuracyM)} m
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="small" style={styles.coords}>
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </AppText>
                  <AppText variant="small" style={styles.meta}>
                    Locked {fmtWhen(loc.lockedAt)}
                    {loc.lockedByName ? ` · ${loc.lockedByName}` : ''}
                  </AppText>
                  <Pressable
                    onPress={() => Linking.openURL(googleMapsUrl(lat, lng)).catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel="Open in Google Maps"
                    style={styles.mapLink}
                  >
                    <Icon name="map-marker-outline" size={16} color={colors.tealDeep} />
                    <AppText variant="label" style={styles.mapText}>
                      Open map
                    </AppText>
                  </Pressable>
                </View>
                {canManage ? (
                  <View style={styles.actions}>
                    <PressableScale
                      onPress={() => cycleLabel(loc)}
                      disabled={busy}
                      accessibilityLabel={`Change label, currently ${outletLockLabelText(outletKind, loc.label)}`}
                      scaleTo={0.96}
                      style={styles.actionBtn}
                      pressedStyle={styles.actionPressed}
                    >
                      <Icon name="tag-outline" size={18} color={colors.ink} />
                      <AppText variant="chip" style={styles.actionLabel}>
                        Relabel
                      </AppText>
                    </PressableScale>
                    <PressableScale
                      onPress={() => confirmDeactivate(loc)}
                      disabled={busy}
                      accessibilityLabel="Deactivate this lock"
                      scaleTo={0.96}
                      style={styles.actionDanger}
                      pressedStyle={styles.actionDangerPressed}
                    >
                      <Icon name="trash-can-outline" size={18} color={colors.danger} />
                      <AppText variant="chip" style={styles.dangerLabel}>
                        Deactivate
                      </AppText>
                    </PressableScale>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.tealWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, gap: 2 },
  desc: { color: colors.muted },
  capRow: { gap: spacing.sm },
  capChoices: { flexDirection: 'row', gap: spacing.sm },
  capChoice: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  capChoiceOn: { backgroundColor: colors.canopyDeep },
  capChoiceText: { color: colors.ink },
  capChoiceOnText: { color: colors.surface },
  err: { color: colors.danger },
  empty: { paddingVertical: spacing.xs },
  list: { gap: 0 },
  row: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  busy: { opacity: 0.6 },
  rowBody: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  coords: { fontFamily: fonts.medium, color: colors.muted, letterSpacing: 0.2 },
  meta: { color: colors.subtle },
  mapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    alignSelf: 'flex-start',
  },
  mapText: { color: colors.tealDeep },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.ground,
    minHeight: touch.min,
  },
  actionPressed: { backgroundColor: colors.separator },
  actionLabel: { color: colors.ink, fontFamily: fonts.semibold },
  actionDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.dangerWash,
    minHeight: touch.min,
  },
  actionDangerPressed: { backgroundColor: colors.dangerBorder },
  dangerLabel: { color: colors.danger, fontFamily: fonts.semibold },
});
