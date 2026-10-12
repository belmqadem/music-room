import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import { searchQuerySchema } from "./schema.js";
import type { UserService } from "./service.js";

export function createUserController(service: UserService) {
  return {
    async search(req: Request, res: Response): Promise<void> {
      if (!req.auth) {
        // Only reachable if the route was wired without the authenticate middleware.
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      }
      const page = await service.search(
        req.auth.userId,
        searchQuerySchema.parse(req.query),
      );
      res.set("Cache-Control", "no-store").status(200).json(page);
    },
  };
}
