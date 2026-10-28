import type { MailMessage, Mailer } from "../../src/modules/auth/mailer.js";

/** Keeps what would have been sent, and can read the 6-digit code out of the last message to an address. */
export function createMemoryMailer(): Mailer & {
  sent: MailMessage[];
  lastCodeFor(email: string): string;
} {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
    lastCodeFor(email) {
      const message = [...sent].reverse().find((m) => m.to === email);
      const code = message ? /\b(\d{6})\b/.exec(message.text)?.[1] : undefined;
      if (!code) throw new Error(`no email with a code was sent to ${email}`);
      return code;
    },
  };
}
