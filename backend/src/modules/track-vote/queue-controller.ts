import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  eventIdSchema,
  suggestTrackSchema,
  trackIdSchema,
  voteBodySchema,
} from "./schema.js";
import type { QueueService } from "./queue-service.js";

// HTTP layer for the queue: validate, call the service, shape the response.
export function createQueueController(service: QueueService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  // Answers depend on who asks (votedByMe, visibility), so caches must not keep them.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");
  const eventId = (req: Request) => eventIdSchema.parse(req.params["eventId"]);
  const trackId = (req: Request) => trackIdSchema.parse(req.params["trackId"]);

  return {
    async getQueue(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.getQueue(userId, eventId(req)));
    },

    async suggest(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const track = await service.suggest(
        userId,
        eventId(req),
        suggestTrackSchema.parse(req.body),
      );
      noStore(res).status(201).json(track);
    },

    async vote(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      // The body is optional: it only carries the location for location_time events.
      const body = voteBodySchema.parse(req.body ?? {});
      noStore(res)
        .status(200)
        .json(await service.vote(userId, eventId(req), trackId(req), body));
    },

    async withdrawVote(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.withdrawVote(userId, eventId(req), trackId(req)));
    },
  };
}
