import type { Profile } from "@music-room/shared";
import type pg from "pg";
import { HttpError } from "../../http-error.js";
import { areFriends } from "../friends/repository.js";
import { findProfileRecord, upsertProfile } from "./repository.js";
import type { UpdateProfileInput } from "./schema.js";
import { shapeProfile, type Relation } from "./visibility.js";

export interface ProfileService {
  getOwn(callerId: string): Promise<Profile>;
  update(callerId: string, input: UpdateProfileInput): Promise<Profile>;
  /** The profile of `ownerId` as `callerId` may see it. 404 USER_NOT_FOUND for an unknown id. */
  getOf(callerId: string, ownerId: string): Promise<Profile>;
}

export function createProfileService(deps: { pool: pg.Pool }): ProfileService {
  async function load(callerId: string, ownerId: string): Promise<Profile> {
    const record = await findProfileRecord(deps.pool, ownerId);
    if (!record) throw new HttpError(404, "USER_NOT_FOUND", "That user does not exist.");
    let relation: Relation = "stranger";
    if (callerId === ownerId) relation = "self";
    else if (await areFriends(deps.pool, callerId, ownerId)) relation = "friend";
    return shapeProfile(record, relation);
  }

  return {
    getOwn: (callerId) => load(callerId, callerId),
    async update(callerId, input) {
      await upsertProfile(deps.pool, callerId, input);
      return load(callerId, callerId);
    },
    getOf: load,
  };
}
