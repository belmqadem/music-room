import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  createEventSchema,
  eventIdSchema,
  listQuerySchema,
  updateEventSchema,
} from "./schema.js";
import type { EventService } from "./service.js";

// HTTP layer: validate, call the service, shape the response.
// Express 5 forwards errors from async handlers to the error middleware.
export function createEventController(service: EventService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  // Responses depend on who asks (myPermissions, visibility), so caches must not keep them.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");
  const eventId = (req: Request) => eventIdSchema.parse(req.params["eventId"]);

  return {
    async create(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const event = await service.create(userId, createEventSchema.parse(req.body));
      noStore(res).status(201).json(event);
    },

    async list(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.list(userId, listQuerySchema.parse(req.query)));
    },

    async get(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.get(userId, eventId(req)));
    },

    async update(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const event = await service.update(
        userId,
        eventId(req),
        updateEventSchema.parse(req.body),
      );
      noStore(res).status(200).json(event);
    },

    async remove(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      await service.remove(userId, eventId(req));
      res.status(204).end();
    },
  };
}
