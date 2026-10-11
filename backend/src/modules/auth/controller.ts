import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  loginSchema,
  oauthBodySchema,
  oauthProviderSchema,
  refreshTokenBodySchema,
  registerSchema,
} from "./schema.js";
import type { AuthService } from "./service.js";

// HTTP layer: validate the body, call the service, shape the response.
// Express 5 forwards errors from async handlers to the error middleware.
export function createAuthController(service: AuthService) {
  // Token responses must never be cached by browsers/proxies.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");

  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };

  return {
    async register(req: Request, res: Response): Promise<void> {
      const session = await service.register(registerSchema.parse(req.body));
      noStore(res).status(201).json(session);
    },

    async login(req: Request, res: Response): Promise<void> {
      const session = await service.login(loginSchema.parse(req.body));
      noStore(res).status(200).json(session);
    },

    async refresh(req: Request, res: Response): Promise<void> {
      const session = await service.refresh(refreshTokenBodySchema.parse(req.body));
      noStore(res).status(200).json(session);
    },

    async logout(req: Request, res: Response): Promise<void> {
      if (!req.auth) {
        // Only reachable if the route was wired without the authenticate middleware.
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      }
      await service.logout(req.auth.userId, refreshTokenBodySchema.parse(req.body));
      res.status(204).end();
    },

    async me(req: Request, res: Response): Promise<void> {
      if (!req.auth) {
        // Only reachable if the route was wired without the authenticate middleware.
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      }
      res.status(200).json(await service.getUser(req.auth.userId));
    },

    async oauthLogin(req: Request, res: Response): Promise<void> {
      const provider = oauthProviderSchema.parse(req.params["provider"]);
      const session = await service.oauthLogin(provider, oauthBodySchema.parse(req.body));
      noStore(res).status(200).json(session);
    },

    async linkProvider(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const provider = oauthProviderSchema.parse(req.params["provider"]);
      const user = await service.linkProvider(
        userId,
        provider,
        oauthBodySchema.parse(req.body),
      );
      res.status(200).json(user);
    },

    async unlinkProvider(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const provider = oauthProviderSchema.parse(req.params["provider"]);
      res.status(200).json(await service.unlinkProvider(userId, provider));
    },
  };
}
