import { useState } from "react";
import { View } from "react-native";
import { Badge, Button, Card, Input, Screen, Text } from "@/components";
import { typography, type TypographyVariant } from "@/theme";

// TEMP: remove before release. Every shared component in every variant and state, to check the
// design system on a real screen.
const VARIANTS = Object.keys(typography) as TypographyVariant[];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 pb-8">
      <Text variant="badge" tone="secondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function ComponentGallery() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Screen scroll>
      <Section title="Type scale">
        {VARIANTS.map((variant) => (
          <Text key={variant} variant={variant}>
            {variant === "code" ? "ROOM-742" : `${variant} The room decides`}
          </Text>
        ))}
      </Section>
      <Section title="Text tones">
        <Text tone="primary">primary</Text>
        <Text tone="secondary">secondary</Text>
        <Text tone="tertiary">tertiary (inactive only)</Text>
        <Text tone="error">error</Text>
        <Text tone="success">success</Text>
        <Text tone="warning">warning</Text>
      </Section>
      <Section title="Buttons">
        <Button title="Primary (one per screen)" onPress={() => undefined} />
        <Button title="Secondary" variant="secondary" onPress={() => undefined} />
        <Button title="Ghost" variant="ghost" onPress={() => undefined} />
        <Button title="Primary disabled" disabled onPress={() => undefined} />
        <Button
          title="Secondary disabled"
          variant="secondary"
          disabled
          onPress={() => undefined}
        />
        <Button
          title={loading ? "Working" : "Tap to load for 2 s"}
          loading={loading}
          fullWidth
          onPress={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 2000);
          }}
        />
      </Section>
      <Section title="Inputs">
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          helper="We send a 6-digit code."
        />
        <Input
          label="Password"
          placeholder="At least 8 characters"
          secureTextEntry
          value=""
          onChangeText={() => undefined}
        />
        <Input
          label="With an error"
          value="nope"
          onChangeText={() => undefined}
          error="That code is invalid or has expired."
        />
      </Section>
      <Section title="Badges">
        <View className="flex-row flex-wrap gap-2">
          <Badge label="Public" />
          <Badge label="Owner" tone="accent" />
          <Badge label="Live" tone="live" />
          <Badge label="Queued" tone="success" />
          <Badge label="Expiring" tone="warning" />
          <Badge label="Offline" tone="error" />
        </View>
      </Section>
      <Section title="Cards (surface tiers, no shadows)">
        <Card>
          <Text variant="h3">Low: cards and list rows</Text>
          <Text tone="secondary">Metadata in secondary text</Text>
        </Card>
        <Card tone="elevated">
          <Text variant="h3">Elevated: modals and track lists</Text>
        </Card>
        <Card tone="selected">
          <Text variant="h3">Selected</Text>
        </Card>
      </Section>
    </Screen>
  );
}
