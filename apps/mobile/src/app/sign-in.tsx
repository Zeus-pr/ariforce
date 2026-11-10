import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInputInstance } from 'react-native';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { LogoLockup } from '@/components/logo-lockup';
import { OtpCode } from '@/components/otp-code';
import { TextField } from '@/components/text-field';
import { AuthError, type OtpChallenge } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth-context';
import { useMarkObserveInteractive } from '@/lib/observe';
import { colors, fonts, radius, spacing } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TITLES: Partial<Record<AuthError['kind'], string>> = {
  network: 'No connection',
  'rate-limited': 'Too many attempts',
  account: 'Can’t sign in with this account',
  'no-role': 'No access',
  'otp-expired': 'Sign-in expired',
  origin: 'Sign-in blocked',
};

export default function SignInScreen() {
  useMarkObserveInteractive();
  const { signIn, completeOtp, resendOtp, notice, clearNotice } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function restart(message?: string) {
    setChallenge(null);
    setCode('');
    setCodeError(undefined);
    setPassword('');
    if (message) setFormError({ title: TITLES['otp-expired'] ?? 'Sign-in expired', body: message });
  }

  async function submitCode(next = code) {
    if (busy || submitting.current || !challenge) return;
    if (!/^\d{6}$/.test(next)) {
      setCodeError('Enter the 6-digit code from your email.');
      return;
    }
    setCodeError(undefined);
    submitting.current = true;
    setBusy(true);
    try {
      await completeOtp(challenge, next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const kind = err instanceof AuthError ? err.kind : 'server';
      const message = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      if (kind === 'otp-expired') restart(message);
      else {
        setCodeError(message);
        setCode('');
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge || cooldown > 0) return;
    setCooldown(45);
    try {
      await resendOtp(challenge);
      setCodeError(undefined);
    } catch (err) {
      if (err instanceof AuthError && err.kind === 'otp-expired') restart(err.message);
      else setCodeError(err instanceof Error ? err.message : 'Could not resend the code.');
    }
  }

  // A session the app ended on its own (role without access, account state) explains itself here.
  const banner = formError ?? (notice ? { title: 'Signed out', body: notice } : null);

  async function submit() {
    if (busy) return;
    const e = email.trim().toLowerCase();
    const errs: typeof fieldErrors = {};
    if (!e) errs.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(e)) errs.email = 'That doesn’t look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    setFormError(null);
    clearNotice();
    if (errs.email || errs.password) return;

    setBusy(true);
    try {
      const next = await signIn(e, password);
      if (next) {
        setChallenge(next);
        setCooldown(45);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The auth guard in app/_layout.tsx moves us to home.
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const kind = err instanceof AuthError ? err.kind : 'server';
      const message =
        err instanceof AuthError ? err.message : 'Something went wrong. Try again in a moment.';
      if (kind === 'credentials') {
        setFieldErrors({ password: message });
        setPassword('');
        passwordRef.current?.focus();
      } else {
        setFormError({ title: TITLES[kind] ?? 'Sign-in failed', body: message });
      }
    } finally {
      setBusy(false);
    }
  }

  if (challenge)
    return (
      <KeyboardAwareScrollView
        style={styles.flex}
        bottomOffset={spacing.xl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <LogoLockup />
        <View style={styles.heading}>
          <AppText variant="title" accessibilityRole="header">
            Check your email
          </AppText>
          <AppText variant="subhead">
            We sent a 6-digit code to {challenge.email}. It expires in 5 minutes.
          </AppText>
        </View>
        <View style={styles.form}>
          <OtpCode
            value={code}
            onChange={(next) => {
              setCode(next);
              if (codeError) setCodeError(undefined);
            }}
            onComplete={(next) => void submitCode(next)}
            error={codeError}
            editable={!busy}
          />
          <Button
            label="Verify and sign in"
            loadingLabel="Verifying…"
            loading={busy}
            onPress={() => void submitCode()}
          />
          <Pressable
            onPress={resend}
            disabled={busy || cooldown > 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || cooldown > 0 }}
            style={styles.linkHit}
          >
            <AppText
              variant="label"
              style={[styles.link, (busy || cooldown > 0) && styles.linkOff]}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => restart()}
            disabled={busy}
            accessibilityRole="button"
            style={styles.linkHit}
          >
            <AppText variant="caption" style={styles.switchAccount}>
              Use a different account
            </AppText>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    );

  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      bottomOffset={spacing.xl}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <LogoLockup />

      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Sign in
        </AppText>
        <AppText variant="subhead">
          Use the email and password you use on the AriForce website.
        </AppText>
      </View>

      <View style={styles.form}>
        <TextField
          label="Work email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
          }}
          placeholder="name@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          enterKeyHint="next"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
          error={fieldErrors.email}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          secret
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          placeholder="Your password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          enterKeyHint="go"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          error={fieldErrors.password}
        />

        {banner && (
          <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <AppText variant="headline" style={styles.alertText}>
              {banner.title}
            </AppText>
            <AppText variant="caption" style={styles.alertText}>
              {banner.body}
            </AppText>
          </View>
        )}

        <Button label="Sign in" loadingLabel="Signing in…" loading={busy} onPress={submit} />
      </View>

      <AppText variant="caption" style={styles.help}>
        Forgot your password? Reset it on the AriForce website, or ask your administrator.
      </AppText>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl },
  heading: { marginTop: spacing.xxxl, marginBottom: spacing.xl, gap: spacing.sm },
  form: { gap: spacing.lg + spacing.xs },
  alert: {
    backgroundColor: colors.dangerWash,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    padding: spacing.md,
    gap: spacing.xs,
  },
  alertText: { color: colors.danger },
  help: { marginTop: spacing.xl, textAlign: 'center' },
  linkHit: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  link: { color: colors.canopyDeep, fontFamily: fonts.medium, textAlign: 'center' },
  linkOff: { color: colors.subtle },
  switchAccount: { textAlign: 'center' },
});
