import { useState } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/app-text';
import { SelectSheet } from '@/components/masters/select-sheet';
import { TextField } from '@/components/text-field';
import type { FlowState } from '@/lib/dcr/model';
import { dcrStyles, Field } from './field';
import { PlaceFields } from './place-fields';
import { TimeRange } from './time-range';

const ADMIN_TASKS = [
  'Expense filing',
  'Stock reconciliation',
  'Reports and MIS',
  'Office visit',
  'Bank or courier work',
];

/** Admin work details (web dcr-sections OfficeSection). */
export function OfficeEditor({
  value,
  readOnly,
  errors,
  onChange,
}: {
  value: FlowState['office'];
  readOnly: boolean;
  errors: Record<string, string[]>;
  onChange: (v: FlowState['office']) => void;
}) {
  const [pick, setPick] = useState(false);
  return (
    <View style={dcrStyles.section}>
      <AppText variant="label">Admin work</AppText>
      <Field
        label="Task type"
        value={value.taskType || undefined}
        placeholder="Choose task type"
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.taskType?.[0]}
      />
      <TextField
        label="What you did"
        value={value.description}
        onChangeText={(description) => onChange({ ...value, description })}
        editable={!readOnly}
        multiline
        error={errors.description?.[0]}
        maxLength={1000}
      />
      <PlaceFields value={value} readOnly={readOnly} onChange={onChange} />
      <TimeRange
        value={value}
        readOnly={readOnly}
        errors={{ startTime: errors.startTime?.[0], endTime: errors.endTime?.[0] }}
        onChange={onChange}
      />
      <TextField
        label="Remarks"
        value={value.remarks}
        onChangeText={(remarks) => onChange({ ...value, remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <SelectSheet
        visible={pick}
        title="Task type"
        options={ADMIN_TASKS.map((p) => ({ value: p, label: p }))}
        value={value.taskType || null}
        onPick={(v) => v && onChange({ ...value, taskType: v })}
        onClose={() => setPick(false)}
      />
    </View>
  );
}
