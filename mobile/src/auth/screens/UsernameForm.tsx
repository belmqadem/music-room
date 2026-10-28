import { useState } from "react";
import { View } from "react-native";
import { Button, Input } from "@/components";
import { copy } from "@/copy";
import {
  normalizeUsername,
  saveUsername,
  usernameError,
  usernameSaveErrorMessage,
} from "../username";
import { FormMessage } from "./parts";

/**
 * The username field and its save button, for the first choice after sign-up and for changing it
 * in Settings (ADR-046). The rules are checked as you type, once something is typed; whether the
 * name is taken only the server knows, so that comes back from Save.
 */
export function UsernameForm({
  initial = "",
  onSaved,
}: {
  initial?: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const ruleError = usernameError(name);

  async function save(): Promise<void> {
    setTouched(true);
    if (ruleError) return;
    setSaving(true);
    setServerError(null);
    try {
      await saveUsername(name);
      onSaved();
    } catch (failure) {
      setServerError(usernameSaveErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-4">
      <Input
        label={copy.username.label}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setServerError(null);
          if (value.trim() !== "") setTouched(true);
        }}
        error={touched ? ruleError : null}
        helper={copy.username.helper}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        maxLength={30}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
      <Button
        title={copy.username.save}
        fullWidth
        loading={saving}
        disabled={
          normalizeUsername(name) === normalizeUsername(initial) && initial !== ""
        }
        onPress={() => void save()}
      />
    </View>
  );
}
