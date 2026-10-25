import { router } from "expo-router";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { auth } from "@/auth";
import {
  fieldErrors,
  formErrorsFrom,
  type FieldName,
  type FormErrors,
} from "@/auth/forms/error-messages";
import { handOff } from "@/auth/forms/handoff";
import {
  displayNameError,
  emailError,
  newPasswordError,
  normalizeEmail,
  PASSWORD_POLICY_HINT,
} from "@/auth/forms/validation";
import { Button, Input, Screen } from "@/components";
import { FormMessage, ScreenTitle } from "./parts";
import { SocialSignIn } from "./SocialSignIn";

const NO_ERRORS: FormErrors = { form: null, fields: {} };

// Display name, email and password. Registering gives no session: the email is confirmed first with
// the 6-digit code it receives (ADR-022), so the next screen is the code screen.
export default function SignUpScreen() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => ({
      form: null,
      fields: { ...current.fields, [field]: undefined },
    }));
  };

  async function submit() {
    const fields = fieldErrors({
      displayName: displayNameError(displayName),
      email: emailError(email),
      password: newPasswordError(password),
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ form: null, fields });
      return;
    }
    setErrors(NO_ERRORS);
    setSubmitting(true);
    try {
      const result = await auth.register({
        displayName: displayName.trim(),
        email: normalizeEmail(email),
        password,
      });
      handOff({ email: result.email, codeSentAt: Date.now() });
      router.push("/verify-email");
    } catch (error) {
      setErrors(formErrorsFrom(error, "signUp"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <View className="gap-6">
        <ScreenTitle
          title="Create your account"
          subtitle="We'll email you a 6-digit code to confirm it's you."
        />
        <View className="gap-4">
          <Input
            label="Display name"
            value={displayName}
            onChangeText={edit("displayName", setDisplayName)}
            error={errors.fields.displayName}
            helper="Shown to the people in your rooms."
            maxLength={50}
            autoComplete="nickname"
            textContentType="nickname"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <Input
            ref={emailRef}
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
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Input
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={edit("password", setPassword)}
            error={errors.fields.password}
            helper={PASSWORD_POLICY_HINT}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>
        {errors.form ? <FormMessage tone="error">{errors.form}</FormMessage> : null}
        <Button title="Create account" fullWidth loading={submitting} onPress={submit} />
        <SocialSignIn />
        <Button
          title="I already have an account"
          variant="ghost"
          fullWidth
          onPress={() => router.replace("/sign-in")}
        />
      </View>
    </Screen>
  );
}
