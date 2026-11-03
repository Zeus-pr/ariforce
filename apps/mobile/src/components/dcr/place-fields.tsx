import { StyleSheet, View } from 'react-native';
import { TextField } from '@/components/text-field';
import { spacing } from '@/theme';

type P = { fromPlace: string; toPlace: string };

/** From place / To place, side by side (Meeting and Admin work). */
export function PlaceFields<T extends P>({
  value,
  readOnly,
  onChange,
}: {
  value: T;
  readOnly: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <TextField
          label="From place"
          value={value.fromPlace}
          onChangeText={(fromPlace) => onChange({ ...value, fromPlace })}
          editable={!readOnly}
          maxLength={120}
        />
      </View>
      <View style={styles.cell}>
        <TextField
          label="To place"
          value={value.toPlace}
          onChangeText={(toPlace) => onChange({ ...value, toPlace })}
          editable={!readOnly}
          maxLength={120}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1 },
});
