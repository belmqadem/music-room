import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  friendRequestSchema,
  idSchema,
  listQuerySchema,
  requestsQuerySchema,
} from "./schema.js";
import type { FriendService } from "./service.js";

// HTTP layer: validate, call the service, shape the response.
// Express 5 forwards errors from async handlers to the error middleware.
export function createFriendController(service: FriendService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  // Every answer is about the caller's own relationships: caches must not keep them.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");

  return {
    async sendRequest(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const { friendship, created } = await service.sendRequest(
        userId,
        friendRequestSchema.parse(req.body),
      );
      // 201 for a new request; 200 when it only completed one the other person had sent.
      noStore(res)
        .status(created ? 201 : 200)
        .json(friendship);
    },

    async accept(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.accept(userId, idSchema.parse(req.params["requestId"])));
    },

    async removeRequest(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      await service.removeRequest(userId, idSchema.parse(req.params["requestId"]));
      res.status(204).end();
    },

    async listRequests(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.listRequests(userId, requestsQuerySchema.parse(req.query)));
    },

    async listFriends(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.listFriends(userId, listQuerySchema.parse(req.query)));
    },

    async unfriend(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      await service.unfriend(userId, idSchema.parse(req.params["userId"]));
      res.status(204).end();
    },
  };
}
