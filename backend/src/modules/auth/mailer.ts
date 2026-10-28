import nodemailer from "nodemailer";
import type { Logger } from "pino";

// Outgoing email (ADR-022). The auth code only knows this interface, so tests and local
// development need no mail server.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development: prints the message in the server log instead of sending it. It logs the code
 * in clear, which is why config refuses this mailer in production.
 */
export function createConsoleMailer(logger: Logger): Mailer {
  return {
    send(message) {
      logger.info(
        { to: message.to, subject: message.subject },
        `email:\n${message.text}`,
      );
      return Promise.resolve();
    },
  };
}

/** Real delivery over SMTP, e.g. smtp://localhost:1025 (Mailpit) or smtps://user:pass@host:465. */
export function createSmtpMailer(options: { url: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(options.url);
  return {
    async send(message) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
