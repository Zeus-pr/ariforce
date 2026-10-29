import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { colors, spacing } from '@/theme';

/**
 * Approve / reject for one item. Reject needs a reason (min 3 chars) and a confirm dialog;
 * approve asks once too, so a stray tap never decides anything.
 */
export function DecisionBar({
  what,
  busy,
  error,
  onDecide,
}: {
  /** "Ravi's DCR for Wed, 28 Oct" — used in the dialogs. */
  what: string;
  busy: boolean;
  error?: string | null;
  onDecide: (decision: 'approve' | 'reject', reason: string | null) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);

  const approve = () =>
    Alert.alert('Approve?', `Approve ${what}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => onDecide('approve', null) },
    ]);

  const reject = () => {
    const r = reason.trim();
    if (r.length < 1) {
      setReasonErr('Give a reason. The rep sees it.');
      return;
    }
    setReasonErr(null);
    Alert.alert('Reject?', `Reject ${what}?\n\nReason: ${r}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => onDecide('reject', r) },
    ]);
  };

  return (
    <View style={styles.wrap}>
      {rejecting ? (
        <TextField
          label="Reason for rejecting (required)"
          value={reason}
          onChangeText={setReason}
          maxLength={500}
          multiline
          error={reasonErr}
        />
      ) : null}
      {error ? (
        <AppText variant="caption" style={styles.err}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <Button
          label={rejecting ? 'Confirm reject' : 'Reject'}
          variant="secondary"
          compact
          disabled={busy}
          onPress={rejecting ? reject : () => setRejecting(true)}
          style={styles.flex}
        />
        {rejecting ? (
          <Button
            label="Cancel"
            variant="tint"
            compact
            disabled={busy}
            onPress={() => {
              setRejecting(false);
              setReasonErr(null);
            }}
            style={styles.flex}
          />
        ) : (
          <Button
            label="Approve"
            compact
            loading={busy}
            loadingLabel="Saving…"
            onPress={approve}
            style={styles.flex}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  err: { color: colors.danger },
});
