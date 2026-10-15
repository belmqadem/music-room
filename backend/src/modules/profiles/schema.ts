import { z } from "zod";

// Everything the app sends for profiles (docs/api-contract.md, "Profiles").
// strictObject everywhere: an unknown field is a 400, so a client cannot sneak in `userId`...

/** Trimmed text of at most `max` characters; blank becomes null (the same as clearing it). */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

// Digits with the usual separators, optional leading +. Not a full E.164 check on purpose.
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]{3,30}$/, "Not a valid phone number.")
  .nullable();

const MIN_BIRTH_YEAR = 1900;
const birthDate = z.iso
  .date()
  .refine((value) => Number(value.slice(0, 4)) >= MIN_BIRTH_YEAR, "Too far in the past.")
  .refine((value) => value <= new Date().toISOString().slice(0, 10), "In the future.")
  .nullable();

// Lowercased and trimmed so "Rock" and " rock " are one tag; duplicates collapse, order is kept.
const genre = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'+\-/.]*$/u, "Not a valid genre.");
export const MAX_GENRES = 10;
const genres = z
  .array(genre)
  .max(MAX_GENRES)
  .transform((tags) => [...new Set(tags)]);

export const updateProfileSchema = z.strictObject({
  publicInfo: z.strictObject({ bio: text(280).optional() }).optional(),
  friendsInfo: z
    .strictObject({ fullName: text(80).optional(), city: text(80).optional() })
    .optional(),
  privateInfo: z
    .strictObject({ phone: phone.optional(), birthDate: birthDate.optional() })
    .optional(),
  musicPreferences: z.strictObject({ genres: genres.optional() }).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const userIdSchema = z.uuid();
