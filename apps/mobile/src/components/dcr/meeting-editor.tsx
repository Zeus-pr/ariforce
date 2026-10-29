import { useState } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/app-text';
import { SelectSheet } from '@/components/masters/select-sheet';
import { TextField } from '@/components/text-field';
import type { FlowState } from '@/lib/dcr/model';
import { dcrStyles, Field } from './field';
import { TimeField } from './time-field';

const MEETING_TYPES = [
  'Cycle meeting',
  'Area review',
  'Regional review',
  'Conference or CME',
  'Team meeting',
];
const TRAINING_TYPES = [
  'Product training',
  'Induction',
  'Field skills workshop',
  'Compliance training',
  'Refresher training',
];

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 3);

/** Meeting or training details (web dcr-sections MeetingSection). */
export function MeetingEditor({
  kind,
  value,
  readOnly,
  errors,
  onChange,
}: {
  kind: 'meeting' | 'training';
  value: FlowState['meeting'];
  readOnly: boolean;
  errors: Record<string, string[]>;
  onChange: (v: FlowState['meeting']) => void;
}) {
  const [pick, setPick] = useState(false);
  const presets = kind === 'meeting' ? MEETING_TYPES : TRAINING_TYPES;
  return (
    <View style={dcrStyles.section}>
      <AppText variant="label">{kind === 'meeting' ? 'Meeting' : 'Training'}</AppText>
      <Field
        label="Type"
        value={value.title || undefined}
        placeholder="Choose type"
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.title?.[0]}
      />
      <Field
        label="Mode"
        value={value.mode === 'online' ? 'Online' : 'In person'}
        onPress={
          readOnly
            ? undefined
            : () => onChange({ ...value, mode: value.mode === 'online' ? 'in_person' : 'online' })
        }
      />
      <TextField
        label={value.mode === 'online' ? 'Link or platform' : 'Location'}
        value={value.location}
        onChangeText={(location) => onChange({ ...value, location })}
        editable={!readOnly}
        error={errors.location?.[0]}
        maxLength={200}
      />
      <TimeField
        label="Start time"
        value={value.startTime}
        onChange={(startTime) => onChange({ ...value, startTime })}
        editable={!readOnly}
        error={errors.startTime?.[0]}
      />
      <TextField
        label="Duration (minutes)"
        value={value.durationMin}
        onChangeText={(d) => onChange({ ...value, durationMin: digits(d) })}
        editable={!readOnly}
        keyboardType="number-pad"
        error={errors.durationMin?.[0]}
      />
      {kind === 'training' ? (
        <TextField
          label="Trainer"
          value={value.trainer}
          onChangeText={(trainer) => onChange({ ...value, trainer })}
          editable={!readOnly}
          maxLength={120}
        />
      ) : (
        <TextField
          label="Attendees"
          value={value.attendees}
          onChangeText={(attendees) => onChange({ ...value, attendees })}
          editable={!readOnly}
          maxLength={500}
        />
      )}
      <TextField
        label="Remarks"
        value={value.remarks}
        onChangeText={(remarks) => onChange({ ...value, remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <SelectSheet
        visible={pick}
        title="Type"
        options={[
          ...presets.map((p) => ({ value: p, label: p })),
          { value: '__other', label: 'Other…' },
        ]}
        value={presets.includes(value.title) ? value.title : value.title ? '__other' : null}
        onPick={(v) => {
          if (v === '__other') onChange({ ...value, title: '' });
          else if (v) onChange({ ...value, title: v });
        }}
        onClose={() => setPick(false)}
      />
    </View>
  );
}
