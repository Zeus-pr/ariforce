import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import type { CustomerScope } from '@/lib/dcr/api';
import { KIND_LABEL, type CallDraft } from '@/lib/dcr/model';
import { colors, radius, spacing, touch } from '@/theme';
import { CustomerSheet } from './customer-sheet';
import { Field } from './field';
import { TimeField } from './time-field';

/** One doctor / chemist / stockist call (web dcr-sections CallCard). */
export function CallEditor({
  call,
  index,
  readOnly,
  errors,
  products,
  scopes,
  names,
  onChange,
  onRemove,
}: {
  call: CallDraft;
  index: number;
  readOnly: boolean;
  errors: string[];
  products: { id: string; label: string }[];
  scopes: CustomerScope[];
  names: Map<string, string>;
  onChange: (p: Partial<CallDraft>) => void;
  onRemove: () => void;
}) {
  const [pick, setPick] = useState(false);
  const label = KIND_LABEL[call.kind];
  return (
    <View style={styles.call}>
      <View style={styles.head}>
        <AppText variant="body">
          {label} #{index + 1}
        </AppText>
        {!readOnly ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove call ${index + 1}`}
            style={styles.remove}
          >
            <Icon name="trash-can-outline" color={colors.danger} size={20} />
          </Pressable>
        ) : null}
      </View>
      <Field
        label={label}
        value={call.outletName || undefined}
        placeholder={`Choose ${label.toLowerCase()}`}
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.find((e) => !e.toLowerCase().includes('time'))}
      />
      <TimeField
        label="Visit time"
        value={call.time}
        onChange={(time) => onChange({ time })}
        editable={!readOnly}
        error={errors.find((e) => e.toLowerCase().includes('time'))}
      />
      {call.kind === 'doctor' ? (
        <AppText variant="small">
          Products:{' '}
          {call.productIds.length
            ? call.productIds.map((id) => products.find((p) => p.id === id)?.label ?? id).join(', ')
            : 'None'}
        </AppText>
      ) : null}
      <TextField
        label="Remarks"
        value={call.remarks}
        onChangeText={(remarks) => onChange({ remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <CustomerSheet
        visible={pick}
        kind={call.kind}
        scopes={scopes}
        names={names}
        value={call.outletId || null}
        onPick={(c) => onChange({ outletId: c.id, outletName: c.name, hqId: c.hqId })}
        onClose={() => setPick(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  call: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remove: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
});
