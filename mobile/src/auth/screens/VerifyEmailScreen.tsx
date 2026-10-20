import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { auth } from "@/auth";
import {
  fieldErrors,
  formErrorsFrom,
  type FieldName,
  type FormErrors,
} from "@/auth/forms/error-messages";
import { handOff, readHandoff } from "@/auth/forms/handoff";
import { useSecondsUntilResend } from "@/auth/forms/use-seconds-left";
import { codeError, emailError, normalizeEmail } from "@/auth/forms/validation";
import { Button, Input, Screen } from "@/components";
import { FormMessage, ScreenTitle } from "./parts";

const NO_ERRORS: FormErrors = { form: null, fields: {} };

// The 6-digit code from the email (ADR-022). The email comes from the previous screen; if there is
// none (the app was reopened, or the user came here directly) it is asked for.
export default function VerifyEmailScreen() {
  const handoff = readHandoff();
  const [email, setEmail] = useState(handoff.email ?? "");
  const [askEmail, setAskEmail] = useState(handoff.email === null);
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState(handoff.codeSentAt);
  const [info, setInfo] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const secondsLeft = useSecondsUntilResend(sentAt);

  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => ({
      form: null,
      fields: { ...current.fields, [field]: undefined },
    }));
  };

  async function submit() {
    const fields = fieldErrors({
      email: askEmail ? emailError(email) : null,
      code: codeError(code),
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ form: null, fields });
      return;
    }
    setErrors(NO_ERRORS);
    setSubmitting(true);
    try {
      await auth.verifyEmail({ email: normalizeEmail(email), code: code.trim() });
      handOff({
        email: normalizeEmail(email),
        codeSentAt: null,
        notice: "Email confirmed. Sign in to continue.",
      });
      router.replace("/sign-in");
    } catch (error) {
      setErrors(formErrorsFrom(error, "verify"));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    const problem = emailError(email);
    if (problem) {
      setAskEmail(true);
      setErrors({ form: null, fields: { email: problem } });
      return;
    }
    setErrors(NO_ERRORS);
    setResending(true);
    try {
      await auth.resendVerification({ email: normalizeEmail(email) });
      const now = Date.now();
      setSentAt(now);
      handOff({ email: normalizeEmail(email), codeSentAt: now });
      // The backend answers the same whether or not the address has an account, and so do we.
      setInfo("If this email needs confirming, a new code is on its way.");
    } catch (error) {
      setErrors(formErrorsFrom(error, "resend"));
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen scroll>
      <View className="gap-6">
        <ScreenTitle
          title="Check your email"
          subtitle={
            askEmail
              ? "Enter your email and the 6-digit code we sent to it."
              : `We sent a 6-digit code to ${normalizeEmail(email)}. It expires after 10 minutes.`
          }
        />
        <View className="gap-4">
          {askEmail ? (
            <Input
              label="Email"
              value={email}
              onChangeText={edit("email", setEmail)}
              error={errors.fields.email}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />
          ) : null}
          <Input
            label="Code"
            value={code}
            onChangeText={edit("code", (value) => setCode(value.replace(/\D/g, "")))}
            error={errors.fields.code}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>
        {errors.form ? <FormMessage tone="error">{errors.form}</FormMessage> : null}
        {info && !errors.form ? <FormMessage tone="secondary">{info}</FormMessage> : null}
        <Button title="Confirm email" fullWidth loading={submitting} onPress={submit} />
        <View className="gap-1">
          <Button
            title={
              secondsLeft > 0 ? `Send a new code in ${secondsLeft} s` : "Send a new code"
            }
            variant="ghost"
            disabled={secondsLeft > 0}
            loading={resending}
            onPress={resend}
            fullWidth
          />
          {askEmail ? null : (
            <Button
              title="Use a different email"
              variant="ghost"
              onPress={() => setAskEmail(true)}
              fullWidth
            />
          )}
        </View>
      </View>
    </Screen>
  );
}
