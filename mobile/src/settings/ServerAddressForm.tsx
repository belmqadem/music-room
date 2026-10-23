import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Input, Text } from "@/components";
import {
  defaultBackendUrl,
  getBackendUrl,
  resetBackendUrl,
  setBackendUrl,
} from "./backend-url";
import { checkServer, normalizeBackendUrl, SERVER_MESSAGES } from "./server-address";

type Notice = { tone: "error" | "success" | "secondary"; text: string };

/**
 * The backend address (the subject requires it to be changeable in the app). Editable only while
 * signed out: the session's refresh token belongs to one server, and changing the address while
 * signed in would send it to another one at the next refresh.
 */
export function ServerAddressForm({ editable }: { editable: boolean }) {
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void getBackendUrl().then(setAddress);
  }, []);

  /** The address as typed, normalized; or null (and a message) when it is not an http(s) URL. */
  function validAddress(): string | null {
    try {
      return normalizeBackendUrl(address);
    } catch {
      setNotice({ tone: "error", text: SERVER_MESSAGES.invalid });
      return null;
    }
  }

  async function check(): Promise<void> {
    const target = validAddress();
    if (!target) return;
    setChecking(true);
    setNotice(null);
    const result = await checkServer(target, fetch);
    setChecking(false);
    setNotice({
      tone: result === "reachable" ? "success" : "error",
      text: SERVER_MESSAGES[result],
    });
  }

  async function save(): Promise<void> {
    const target = validAddress();
    if (!target) return;
    try {
      await setBackendUrl(target);
      setAddress(target);
      setNotice({ tone: "success", text: SERVER_MESSAGES.saved });
    } catch (error) {
      console.warn("Could not save the server address:", error);
      setNotice({
        tone: "error",
        text: "Could not save the address on this phone. Try again.",
      });
    }
  }

  async function restoreDefault(): Promise<void> {
    try {
      await resetBackendUrl();
      setAddress(defaultBackendUrl());
      setNotice({ tone: "secondary", text: "Back to this build's default server." });
    } catch (error) {
      console.warn("Could not reset the server address:", error);
      setNotice({
        tone: "error",
        text: "Could not reset the address on this phone. Try again.",
      });
    }
  }

  return (
    <View className="gap-4">
      <Input
        label="Server address"
        placeholder="http://192.168.1.20:3000"
        value={address}
        onChangeText={(value) => {
          setAddress(value);
          setNotice(null);
        }}
        editable={editable}
        helper={
          editable
            ? "The computer running the Music Room backend, as http://address:port."
            : "Sign out to change it: your session belongs to this server."
        }
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {notice ? (
        <Text
          tone={notice.tone}
          accessibilityRole={notice.tone === "error" ? "alert" : undefined}
          accessibilityLiveRegion="polite"
        >
          {notice.text}
        </Text>
      ) : null}
      <Button
        title="Check connection"
        variant="secondary"
        fullWidth
        loading={checking}
        onPress={() => void check()}
      />
      {editable ? (
        <>
          <Button title="Save" fullWidth onPress={() => void save()} />
          <Button
            title="Use the default"
            variant="ghost"
            fullWidth
            onPress={() => void restoreDefault()}
          />
        </>
      ) : null}
    </View>
  );
}
