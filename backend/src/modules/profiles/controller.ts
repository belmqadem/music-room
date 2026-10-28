import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import { updateProfileSchema, userIdSchema } from "./schema.js";
import type { ProfileService } from "./service.js";

// HTTP layer: validate, call the service, shape the response.
export function createProfileController(service: ProfileService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  // What a profile shows depends on who asks: caches must not keep it.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");

  return {
    async getOwn(req: Request, res: Response): Promise<void> {
      noStore(res)
        .status(200)
        .json(await service.getOwn(requireUserId(req)));
    },

    async update(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.update(userId, updateProfileSchema.parse(req.body)));
    },

    async getOf(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.getOf(userId, userIdSchema.parse(req.params["userId"])));
    },
  };
}
