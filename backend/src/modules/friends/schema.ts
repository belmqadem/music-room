import { z } from "zod";

// Everything the app sends for friends (docs/api-contract.md, "Friends").
// strictObject: an unknown field is a 400, so a client cannot sneak in `status`, `requesterId`...
export const friendRequestSchema = z.strictObject({ userId: z.uuid() });
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

export const idSchema = z.uuid();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const requestsQuerySchema = listQuerySchema.extend({
  direction: z.enum(["incoming", "outgoing"]),
});
export type RequestsQuery = z.infer<typeof requestsQuerySchema>;
