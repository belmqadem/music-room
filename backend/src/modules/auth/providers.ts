import type { Logger } from "pino";
import type { Config } from "../../config/env.js";
import { createFacebookVerifier } from "./facebook-verifier.js";
import { createGoogleVerifier } from "./google-verifier.js";
import { unconfiguredVerifier, type ProviderVerifiers } from "./provider-verifier.js";

/** Builds the real verifiers from the environment; a provider without settings is disabled. */
export function createProviderVerifiers(
  config: Pick<Config, "GOOGLE_CLIENT_IDS" | "FACEBOOK_APP_ID" | "FACEBOOK_APP_SECRET">,
  logger: Logger,
): ProviderVerifiers {
  const googleEnabled = config.GOOGLE_CLIENT_IDS.length > 0;
  const facebookEnabled = config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET;
  if (!googleEnabled)
    logger.warn("GOOGLE_CLIENT_IDS is not set: Google sign-in is disabled");
  if (!facebookEnabled)
    logger.warn("FACEBOOK_APP_ID/SECRET are not set: Facebook sign-in is disabled");
  return {
    google: googleEnabled
      ? createGoogleVerifier({ clientIds: config.GOOGLE_CLIENT_IDS })
      : unconfiguredVerifier,
    facebook:
      config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET
        ? createFacebookVerifier({
            appId: config.FACEBOOK_APP_ID,
            appSecret: config.FACEBOOK_APP_SECRET,
          })
        : unconfiguredVerifier,
  };
}
