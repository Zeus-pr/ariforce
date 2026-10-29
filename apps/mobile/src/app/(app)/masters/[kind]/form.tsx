import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { SelectSheet } from '@/components/masters/select-sheet';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { TextField } from '@/components/text-field';
import { Skeleton, SkeletonForm } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  APPROVAL_LABEL,
  duplicateCheck,
  isMasterKind,
  MASTERS,
  optionsFor,
  RULE_LABEL,
  saveErrorMessage,
  useLookups,
  useMasterRecord,
  useRemoveMaster,
  useSaveMaster,
  validate,
  valuesFrom,
  type DoctorDuplicate,
  type FieldDef,
  type MasterKind,
  type MasterRow,
  type Values,
} from '@/lib/masters';
import { canWriteMasters } from '@/lib/roles';
import { colors, fonts, layout, radius, spacing, touch, type } from '@/theme';

export default function MasterFormScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id?: string }>();
  const { user } = useAuth();
  if (!isMasterKind(kind)) return <Redirect href="/business" />;
  // Same guard as the website's write routes: read-only roles never see the form.
  if (!canWriteMasters(user?.roles ?? []))
    return <Redirect href={{ pathname: '/masters/[kind]', params: { kind } }} />;
  return <FormLoader kind={kind} id={typeof id === 'string' && id ? id : undefined} />;
}

function FormLoader({ kind, id }: { kind: MasterKind; id?: string }) {
  const rec = useMasterRecord(kind, id);
  const cfg = MASTERS[kind];
  if (id && rec.isPending)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: `Edit ${cfg.singular}` }} />
        <SkeletonForm count={cfg.fields.length} />
      </View>
    );
  if (id && !rec.data)
    return (
      <View style={[styles.flex, styles.centerFill]}>
        <Stack.Screen options={{ title: `Edit ${cfg.singular}` }} />
        <AppText variant="bodyMuted">{`This ${cfg.singular} isn’t in your list.`}</AppText>
      </View>
    );
  return <MasterForm key={rec.data?.id ?? 'new'} kind={kind} row={rec.data ?? null} />;
}

/**
 * Add / edit / remove one record (web masters/record-sheet.tsx): the contract's field rules
 * with the website's messages, PATCH with `version`, doctors' live duplicate check and 409
 * handling ("Add anyway" for a name + PIN match; a registration match can never be overridden).
 */
function MasterForm({ kind, row }: { kind: MasterKind; row: MasterRow | null }) {
  const cfg = MASTERS[kind];
  const router = useRouter();
  const bottom = useBottomSpace();
  const lk = useLookups();
  const [values, setValues] = useState<Values>(() => valuesFrom(kind, row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [picking, setPicking] = useState<FieldDef | null>(null);
  const save = useSaveMaster(kind, row);
  const remove = useRemoveMaster(kind);
  const busy = save.isPending || remove.isPending;

  // Doctors add form only: live duplicate check and the 409 outcome of the last save.
  const [matches, setMatches] = useState<DoctorDuplicate[]>([]);
  const [conflict, setConflict] = useState<'hard' | 'soft' | null>(null);
  const dupCheck = kind === 'doctors' && !row;
  const dupName = String(values.name ?? '').trim();
  const dupPin = values.pincode ?? null;
  const dupReg = String(values.registrationNo ?? '').trim();
  useEffect(() => {
    setConflict(null);
    if (!dupCheck || dupName.length < 3) {
      setMatches([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      duplicateCheck(dupName, dupPin, dupReg)
        .then((m) => live && setMatches(m))
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dupCheck, dupName, dupPin, dupReg]);

  const set = (key: string, v: string | null) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  function submit(allowPossibleDuplicate = false) {
    setFormError(null);
    const errs = validate(kind, values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Check the fields marked in red.');
      return;
    }
    save.mutate(
      { values, allowPossibleDuplicate },
      {
        onSuccess: (saved) => {
          const pending =
            (saved as { approvalStatus?: string } | undefined)?.approvalStatus === 'pending';
          if (!row && pending) Alert.alert(`Added ${String(values.name)}`, 'Awaiting approval.');
          if (row || !saved?.id) router.back();
          else router.replace({ pathname: '/masters/[kind]/[id]', params: { kind, id: saved.id } });
        },
        onError: (err) => {
          if (
            err instanceof ApiError &&
            (err.code === 'DOCTOR_DUPLICATE' || err.code === 'DOCTOR_POSSIBLE_DUPLICATE')
          ) {
            const m = (err.details as { matches?: DoctorDuplicate[] } | undefined)?.matches;
            if (m) setMatches(m);
            setConflict(err.code === 'DOCTOR_DUPLICATE' ? 'hard' : 'soft');
            return;
          }
          setFormError(saveErrorMessage(err));
        },
      },
    );
  }

  function confirmRemove() {
    if (!row) return;
    Alert.alert(
      `Remove ${row.name}?`,
      "It disappears from lists and reps' phones. History (calls, samples) keeps the record.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            remove.mutate(row.id, {
              onSuccess: () => router.dismissTo({ pathname: '/masters/[kind]', params: { kind } }),
              onError: (err) => setFormError(saveErrorMessage(err)),
            }),
        },
      ],
    );
  }

  const hardMatch = matches.some((m) => m.rule === 'registration_no');

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: row ? `Edit ${cfg.singular}` : `Add ${cfg.singular}` }} />
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl}
      >
        <AppText variant="small">{row ? row.name : 'Fields marked * are required.'}</AppText>
        {cfg.fields.map((f) => {
          const label = `${f.label}${f.required ? ' *' : ''}`;
          const options = optionsFor(f.type, lk);
          if (options) {
            const v = values[f.key] ?? null;
            const text = v
              ? (options.find((o) => o.value === v)?.label ?? lk.byId.get(v) ?? v)
              : null;
            return (
              <View key={f.key} style={styles.wrap}>
                <AppText variant="label">{label}</AppText>
                <Pressable
                  onPress={() => setPicking(f)}
                  disabled={!lk.ready}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.label}: ${text ?? 'not chosen'}`}
                  accessibilityHint={errors[f.key]}
                  style={({ pressed }) => [
                    styles.select,
                    !!errors[f.key] && styles.selectError,
                    pressed && styles.selectPressed,
                  ]}
                >
                  {lk.ready || text ? (
                    <AppText
                      variant="body"
                      numberOfLines={1}
                      style={[styles.selectText, !text && styles.placeholder]}
                    >
                      {text ?? `Choose ${f.label.toLowerCase()}`}
                    </AppText>
                  ) : (
                    <Skeleton width="55%" height={16} style={styles.selectText} />
                  )}
                  <Icon name="chevron-down" color={colors.subtle} />
                </Pressable>
                {errors[f.key] ? (
                  <AppText variant="caption" style={styles.error}>
                    {errors[f.key]}
                  </AppText>
                ) : null}
              </View>
            );
          }
          return (
            <TextField
              key={f.key}
              label={label}
              value={values[f.key] ?? ''}
              onChangeText={(t) => set(f.key, t === '' && !f.required ? null : t)}
              error={errors[f.key]}
              placeholder={f.placeholder}
              keyboardType={
                f.type === 'tel' ? 'phone-pad' : f.type === 'pincode' ? 'number-pad' : 'default'
              }
              autoCapitalize={
                f.key === 'gstin' || f.key === 'drugLicenseNo'
                  ? 'characters'
                  : f.type === 'text'
                    ? 'words'
                    : 'none'
              }
              autoCorrect={false}
              maxLength={f.type === 'pincode' ? 6 : f.max}
              returnKeyType="next"
              style={styles.input}
            />
          );
        })}

        {dupCheck && matches.length > 0 ? (
          <View style={styles.dup}>
            <AppText variant="label">
              {conflict === 'hard'
                ? 'This registration number is already used. The doctor cannot be added again.'
                : conflict === 'soft'
                  ? 'A doctor with the same name and PIN code exists. Add anyway?'
                  : hardMatch
                    ? 'A doctor with this registration number already exists.'
                    : 'Possible duplicates'}
            </AppText>
            {matches.map((m) => (
              <View key={m.id} style={styles.dupRow}>
                <AppText variant="body">{m.name}</AppText>
                <AppText variant="small">{m.territoryName}</AppText>
                <View style={styles.chips}>
                  <Chip label={RULE_LABEL[m.rule]} tone="neutral" />
                  {m.approvalStatus !== 'approved' ? (
                    <Chip
                      label={APPROVAL_LABEL[m.approvalStatus] ?? m.approvalStatus}
                      tone="orange"
                    />
                  ) : null}
                </View>
              </View>
            ))}
            {conflict === 'soft' ? (
              <Button
                label="Add anyway"
                variant="secondary"
                compact
                disabled={busy}
                onPress={() => submit(true)}
              />
            ) : null}
          </View>
        ) : null}

        {formError ? (
          <AppText variant="caption" style={styles.error} accessibilityLiveRegion="polite">
            {formError}
          </AppText>
        ) : null}

        <Button
          label={row ? 'Save' : 'Add'}
          loading={save.isPending}
          loadingLabel={row ? 'Saving…' : 'Adding…'}
          disabled={busy}
          onPress={() => submit(false)}
        />
        {row ? (
          <Pressable
            onPress={confirmRemove}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${row.name}`}
            style={({ pressed }) => [styles.remove, pressed && styles.selectPressed]}
          >
            <Icon name="trash-can-outline" color={colors.danger} />
            <AppText variant="button" style={styles.error}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </AppText>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>

      <SelectSheet
        visible={!!picking}
        title={picking?.label ?? ''}
        options={picking ? (optionsFor(picking.type, lk) ?? []) : []}
        value={picking ? (values[picking.key] ?? null) : null}
        noneLabel={picking && !picking.required ? 'None' : undefined}
        onPick={(v) => picking && set(picking.key, v)}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  centerFill: { alignItems: 'center', justifyContent: 'center', padding: layout.gutter },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  wrap: { gap: spacing.sm },
  input: {},
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.control,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  selectError: { borderColor: colors.danger },
  selectPressed: { opacity: 0.7 },
  selectText: { flex: 1, fontFamily: fonts.regular, fontSize: type.body.fontSize },
  placeholder: { color: colors.subtle },
  error: { color: colors.danger },
  dup: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.warnWash,
  },
  dupRow: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touch.control,
  },
});
