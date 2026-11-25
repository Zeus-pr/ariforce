import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { ScrollView } from '@/components/scroll';
import { TextField } from '@/components/text-field';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors, layout, spacing } from '@/theme';

/** Director and system admin. One notification for every other active person. */
export default function CompanyMessageScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const allowed = !!user?.roles.some((r) => r === 'director' || r === 'system_admin');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSend() {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const r = await apiFetch<{ recipients: number }>('/v1/notifications/company', {
        method: 'POST',
        body: { title: title.trim(), body: body.trim() },
      });
      setSent(r.recipients);
      setTitle('');
      setBody('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Company message' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        {allowed ? (
          <>
            <AppText variant="small">
              Reaches every active person except you. It shows in their notifications and on the
              phone once this build is installed.
            </AppText>
            <TextField label="Title" value={title} onChangeText={setTitle} maxLength={120} />
            <TextField
              label="Message"
              value={body}
              onChangeText={setBody}
              maxLength={500}
              multiline
            />
            {error ? <AppText variant="small">{error}</AppText> : null}
            {sent !== null ? (
              <AppText variant="small">
                Sent to {sent} {sent === 1 ? 'person' : 'people'}.
              </AppText>
            ) : null}
            <Button
              label="Send to the company"
              loadingLabel="Sending…"
              loading={busy}
              disabled={!title.trim() || !body.trim()}
              onPress={() => void onSend()}
            />
          </>
        ) : (
          <AppText variant="body">
            Only a director or system admin can send a company message.
          </AppText>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.lg },
});
