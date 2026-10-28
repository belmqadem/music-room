import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  addTrackSchema,
  entryIdSchema,
  moveTrackSchema,
  playlistIdSchema,
} from "./schema.js";
import type { EntryService } from "./entry-service.js";

// HTTP layer for the tracks of a playlist: validate, call the service, shape the response.
export function createEntryController(service: EntryService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");
  const playlistId = (req: Request) => playlistIdSchema.parse(req.params["playlistId"]);
  const entryId = (req: Request) => entryIdSchema.parse(req.params["entryId"]);

  return {
    async getSnapshot(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.getSnapshot(userId, playlistId(req)));
    },

    async add(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const snapshot = await service.add(
        userId,
        playlistId(req),
        addTrackSchema.parse(req.body),
      );
      noStore(res).status(201).json(snapshot);
    },

    async move(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const snapshot = await service.move(
        userId,
        playlistId(req),
        entryId(req),
        moveTrackSchema.parse(req.body),
      );
      noStore(res).status(200).json(snapshot);
    },

    async remove(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      noStore(res)
        .status(200)
        .json(await service.remove(userId, playlistId(req), entryId(req)));
    },
  };
}
