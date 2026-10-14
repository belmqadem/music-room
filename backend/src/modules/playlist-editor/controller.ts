import type { Request, Response } from "express";
import { HttpError } from "../../http-error.js";
import {
  createPlaylistSchema,
  inviteSchema,
  listQuerySchema,
  playlistIdSchema,
  updatePlaylistSchema,
  userIdSchema,
} from "./schema.js";
import type { PlaylistService } from "./service.js";

// HTTP layer: validate, call the service, shape the response.
// Express 5 forwards errors from async handlers to the error middleware.
export function createPlaylistController(service: PlaylistService) {
  const requireUserId = (req: Request): string => {
    if (!req.auth) {
      // Only reachable if the route was wired without the authenticate middleware.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return req.auth.userId;
  };
  // Responses depend on who asks (myPermissions, visibility), so caches must not keep them.
  const noStore = (res: Response) => res.set("Cache-Control", "no-store");
  const playlistId = (req: Request) => playlistIdSchema.parse(req.params["playlistId"]);

  return {
    async create(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const playlist = await service.create(userId, createPlaylistSchema.parse(req.body));
      noStore(res).status(201).json(playlist);
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
        .json(await service.get(userId, playlistId(req)));
    },

    async update(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const playlist = await service.update(
        userId,
        playlistId(req),
        updatePlaylistSchema.parse(req.body),
      );
      noStore(res).status(200).json(playlist);
    },

    async remove(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      await service.remove(userId, playlistId(req));
      res.status(204).end();
    },

    async listInvitations(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const page = await service.listInvitations(
        userId,
        playlistId(req),
        listQuerySchema.parse(req.query),
      );
      noStore(res).status(200).json(page);
    },

    async invite(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      const invitation = await service.invite(
        userId,
        playlistId(req),
        inviteSchema.parse(req.body),
      );
      noStore(res).status(201).json(invitation);
    },

    async removeInvitation(req: Request, res: Response): Promise<void> {
      const userId = requireUserId(req);
      await service.removeInvitation(
        userId,
        playlistId(req),
        userIdSchema.parse(req.params["userId"]),
      );
      res.status(204).end();
    },
  };
}
