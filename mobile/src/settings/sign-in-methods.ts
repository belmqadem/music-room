import type {
  LinkProviderRequest,
  OAuthProvider,
  Reauth,
  UnlinkProviderRequest,
  User,
} from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { auth } from "@/auth";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// Linking and unlinking Google or Facebook (docs/api-contract.md, "Authentication"; ADR-025,
// ADR-044). SECURITY: both change who can get into the account, so each carries a proof of
// ownership the account already has (`reauth`): the password, or a fresh sign-in with a provider
// already linked. These rules only decide what the app OFFERS; the server checks the proof and
// refuses removing the last login method itself.

/** A login method per linked provider, plus one for a password: the server's count. */
export function loginMethodCount(
  user: Pick<User, "linkedProviders" | "hasPassword">,
): number {
  return user.linkedProviders.length + (user.hasPassword ? 1 : 0);
}

/** Unlinking is offered only for a linked provider that is not your last way to sign in. */
export function canUnlink(
  user: Pick<User, "linkedProviders" | "hasPassword">,
  provider: OAuthProvider,
): boolean {
  return user.linkedProviders.includes(provider) && loginMethodCount(user) > 1;
}

export interface ProofOptions {
  /** Only an account with a password can prove it with one. */
  password: boolean;
  /** Linked providers this build can sign in with again. */
  providers: OAuthProvider[];
}

/** The proofs that can work for this account in this build; none means it can't be confirmed here. */
export function proofOptions(
  user: Pick<User, "linkedProviders" | "hasPassword">,
  inThisBuild: OAuthProvider[],
): ProofOptions {
  return {
    password: user.hasPassword,
    providers: user.linkedProviders.filter((provider) => inThisBuild.includes(provider)),
  };
}

export const hasAnyProof = (options: ProofOptions) =>
  options.password || options.providers.length > 0;

export const accountsApi = {
  link: (provider: OAuthProvider, body: LinkProviderRequest) =>
    auth.request<User>("POST", `/users/me/providers/${provider}`, { body }),
  unlink: (provider: OAuthProvider, body: UnlinkProviderRequest) =>
    auth.request<User>("DELETE", `/users/me/providers/${provider}`, { body }),
};

/** What to say when a link or unlink fails, from the code; never the server's own message. */
export function signInMethodErrorMessage(
  error: unknown,
  provider: "Google" | "Facebook",
  proof: Reauth["method"],
): string {
  if (!isRequestError(error)) return copy.errors.unknown;
  const errors = copy.settings.signIn.errors;
  switch (error.code) {
    case "REAUTH_FAILED":
      return proof === "password" ? errors.wrongPassword : errors.proofNotLinked;
    case "PROVIDER_ACCOUNT_LINKED":
      return errors.alreadyLinked(provider);
    case "LAST_LOGIN_METHOD":
      return errors.lastMethod;
    case "NOT_FOUND":
      return errors.notLinked(provider);
    case "INVALID_PROVIDER_CREDENTIAL":
      return copy.auth.social.notConfirmed(provider);
    case "PROVIDER_UNAVAILABLE":
      return errors.providerDown(provider);
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    case "NETWORK_ERROR":
      return MESSAGES.network;
    default:
      return error.status >= 500 ? MESSAGES.server : copy.errors.unknown;
  }
}
