import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { SelectSheet } from '@/components/masters/select-sheet';
import { TextField } from '@/components/text-field';
import { apiFetch } from '@/lib/api';
import { saveMessage, thrownMessage } from '@/lib/dcr/errors';
import { colors, spacing } from '@/theme';

type LeaveReq = {
  id: string;
  typeCode: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  half: 'am' | 'pm' | null;
  days: number;
  reason: string | null;
  status: string;
};
type LeaveType = { code: string; name: string; active?: boolean };

const HALF_LABEL = { am: 'First half', pm: 'Second half' } as const;

/** Leave covering the date, or apply for one (web LeaveFields). */
export function LeaveFields({
  date,
  value,
  onChange,
  readOnly,
  error,
}: {
  date: string;
  value: string;
  onChange: (id: string) => void;
  readOnly: boolean;
  error?: string;
}) {
  const [reqs, setReqs] = useState<LeaveReq[] | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [form, setForm] = useState({ typeCode: '', half: '' as '' | 'am' | 'pm', reason: '' });
  const [pickReq, setPickReq] = useState(false);
  const [pickType, setPickType] = useState(false);
  const [pickHalf, setPickHalf] = useState(false);

  useEffect(() => {
    let live = true;
    setReqs(null);
    setLoadError(null);
    void (async () => {
      try {
        const [r, t] = await Promise.all([
          apiFetch<{ items: LeaveReq[] }>('/v1/leave/requests', { query: { mine: 'true' } }),
          apiFetch<{ items: LeaveType[] }>('/v1/leave/types', {}),
        ]);
        if (!live) return;
        const items = r.items.filter(
          (l) =>
            ['pending', 'approved'].includes(l.status) &&
            l.fromDate <= date &&
            l.toDate >= date,
        );
        setReqs(items);
        setTypes((t.items ?? []).filter((x) => x.active !== false));
        if (!value && items.length === 1 && !readOnly) onChange(items[0]!.id);
      } catch (e) {
        if (live) setLoadError(thrownMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [date, tick]);

  async function apply() {
    setBusy(true);
    setApplyError(null);
    try {
      const created = await apiFetch<LeaveReq>('/v1/leave/requests', {
        method: 'POST',
        body: {
          typeCode: form.typeCode,
          fromDate: date,
          toDate: date,
          half: form.half || null,
          reason: form.reason.trim() || null,
        },
      });
      setReqs((x) => [...(x ?? []), created]);
      onChange(created.id);
      setApplying(false);
    } catch (e) {
      setApplyError(saveMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <View style={styles.box}>
        <AppText variant="caption" style={styles.err}>
          {loadError}
        </AppText>
        <Button label="Retry" variant="secondary" compact onPress={() => setTick((n) => n + 1)} />
      </View>
    );
  if (!reqs) return <ActivityIndicator color={colors.navy} />;

  const selected = reqs.find((r) => r.id === value);

  return (
    <View style={styles.gap}>
      {reqs.length > 0 ? (
        <View style={styles.gapSm}>
          <AppText variant="label">Leave covering this date</AppText>
          <Pressable
            disabled={readOnly}
            onPress={() => setPickReq(true)}
            style={styles.select}
            accessibilityRole="button"
          >
            <AppText variant="body" style={!selected ? styles.ph : undefined}>
              {selected
                ? `${selected.typeName} · ${selected.half ? HALF_LABEL[selected.half] : 'Full day'}`
                : 'Choose the leave for this day'}
            </AppText>
          </Pressable>
        </View>
      ) : !applying ? (
        <AppText variant="bodyMuted">No leave request covers this date yet.</AppText>
      ) : null}
      {error ? (
        <AppText variant="caption" style={styles.err}>
          {error}
        </AppText>
      ) : null}
      {!readOnly && !applying ? (
        <Button
          label="Apply for leave on this date"
          variant="secondary"
          compact
          onPress={() => setApplying(true)}
        />
      ) : null}
      {applying ? (
        <View style={styles.apply}>
          <Pressable onPress={() => setPickType(true)} style={styles.select}>
            <AppText variant="body" style={!form.typeCode ? styles.ph : undefined}>
              {types.find((t) => t.code === form.typeCode)?.name ?? 'Leave type'}
            </AppText>
          </Pressable>
          <Pressable onPress={() => setPickHalf(true)} style={styles.select}>
            <AppText variant="body">
              {form.half === 'am'
                ? 'First half'
                : form.half === 'pm'
                  ? 'Second half'
                  : 'Full day'}
            </AppText>
          </Pressable>
          <TextField
            label="Reason (optional)"
            value={form.reason}
            onChangeText={(reason) => setForm((f) => ({ ...f, reason }))}
            maxLength={1000}
          />
          {applyError ? (
            <AppText variant="caption" style={styles.err}>
              {applyError}
            </AppText>
          ) : null}
          <Button
            label={busy ? 'Applying…' : 'Apply for leave'}
            loading={busy}
            disabled={busy || !form.typeCode}
            onPress={() => void apply()}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setApplying(false)} />
        </View>
      ) : null}

      <SelectSheet
        visible={pickReq}
        title="Leave"
        options={reqs.map((l) => ({
          value: l.id,
          label: `${l.typeName} · ${l.half ? HALF_LABEL[l.half] : 'Full day'}`,
          hint: l.status === 'approved' ? 'Approved' : 'Awaiting approval',
        }))}
        value={value || null}
        onPick={(v) => v && onChange(v)}
        onClose={() => setPickReq(false)}
      />
      <SelectSheet
        visible={pickType}
        title="Leave type"
        options={types.map((t) => ({ value: t.code, label: t.name, hint: t.code }))}
        value={form.typeCode || null}
        onPick={(v) => v && setForm((f) => ({ ...f, typeCode: v }))}
        onClose={() => setPickType(false)}
      />
      <SelectSheet
        visible={pickHalf}
        title="Duration"
        options={[
          { value: 'full', label: 'Full day' },
          { value: 'am', label: 'First half' },
          { value: 'pm', label: 'Second half' },
        ]}
        value={form.half || 'full'}
        onPick={(v) => setForm((f) => ({ ...f, half: !v || v === 'full' ? '' : (v as 'am' | 'pm') }))}
        onClose={() => setPickHalf(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  gapSm: { gap: spacing.sm },
  box: { gap: spacing.sm },
  apply: { gap: spacing.md },
  select: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  ph: { color: colors.subtle },
  err: { color: colors.danger },
});
