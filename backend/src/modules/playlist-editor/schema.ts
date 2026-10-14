import { z } from "zod";

// Validation of everything the app sends for playlists (docs/api-contract.md, "Playlists").
// strictObject everywhere: an unknown field is a 400, which is what stops a client from
// sneaking in `ownerId`, `id` or `version`.
const editLicenseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("everyone") }),
  z.strictObject({ type: z.literal("invited_only") }),
]);

const nameSchema = z.string().trim().min(1).max(100);
const visibilitySchema = z.enum(["public", "private"]);

export const createPlaylistSchema = z.strictObject({
  name: nameSchema,
  visibility: visibilitySchema.optional(),
  editLicense: editLicenseSchema.optional(),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;

export const updatePlaylistSchema = z
  .strictObject({
    name: nameSchema.optional(),
    visibility: visibilitySchema.optional(),
    editLicense: editLicenseSchema.optional(),
  })
  .refine((update) => Object.keys(update).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;

export const playlistIdSchema = z.uuid();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// Invitations: the body names the user to invite. strict, like every body.
export const inviteSchema = z.strictObject({ userId: z.uuid() });
export type InviteInput = z.infer<typeof inviteSchema>;

export const userIdSchema = z.uuid();
