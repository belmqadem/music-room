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
