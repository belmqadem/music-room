import { z } from "zod";

// Validation of everything the app sends for events (docs/api-contract.md, "Events").
// strictObject everywhere: an unknown field is a 400, which is what stops a client
// from sneaking in `ownerId`, `id` or `createdAt`.

// The ranges below are also CHECK constraints in the database (migration create-events):
// the app gives a clear 400, the database is the last line of defence.
const isoInstant = z.iso.datetime({ offset: true });

const locationTimeLicenseSchema = z
  .strictObject({
    type: z.literal("location_time"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(1).max(100_000),
    startsAt: isoInstant,
    endsAt: isoInstant,
  })
  .refine((rule) => Date.parse(rule.startsAt) < Date.parse(rule.endsAt), {
    path: ["endsAt"],
    message: "endsAt must be after startsAt",
  });

export const voteLicenseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("everyone") }),
  z.strictObject({ type: z.literal("invited_only") }),
  locationTimeLicenseSchema,
]);

const nameSchema = z.string().trim().min(1).max(100);
const visibilitySchema = z.enum(["public", "private"]);

export const createEventSchema = z.strictObject({
  name: nameSchema,
  visibility: visibilitySchema.optional(),
  voteLicense: voteLicenseSchema.optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .strictObject({
    name: nameSchema.optional(),
    visibility: visibilitySchema.optional(),
    voteLicense: voteLicenseSchema.optional(),
  })
  .refine((update) => Object.keys(update).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const eventIdSchema = z.uuid();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// Invitations: the body names the user to invite. strict, like every body.
export const inviteSchema = z.strictObject({ userId: z.uuid() });
export type InviteInput = z.infer<typeof inviteSchema>;

export const userIdSchema = z.uuid();

// ---- Suggesting and voting -------------------------------------------------

// The position the phone reports, sent with a vote or suggestion (used only when the
// event's license is location_time; the server computes the distance itself).
const geoPointSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(1_000_000).optional(),
});

// The client sends only the catalog's track id. Title, artist and cover come from the
// catalog, never from the client. Ids are validated again by the catalog adapter.
export const suggestTrackSchema = z.strictObject({
  providerTrackId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  location: geoPointSchema.optional(),
});
export type SuggestTrackInput = z.infer<typeof suggestTrackSchema>;

export const voteBodySchema = z.strictObject({ location: geoPointSchema.optional() });
export type VoteBodyInput = z.infer<typeof voteBodySchema>;

export const trackIdSchema = z.uuid();

// Advancing the queue (owner only). The client says which track it BELIEVES is playing
// (null when none); the server alone decides which track comes next.
export const advanceQueueSchema = z.strictObject({ currentTrackId: z.uuid().nullable() });
export type AdvanceQueueInput = z.infer<typeof advanceQueueSchema>;
