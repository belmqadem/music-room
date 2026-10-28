// Ramp-up load test (ADR-021). Run with `make loadtest` (needs `make loadtest-up` first).
//
// What it does: grows the number of simulated users in steps. Users sit in ROOMS of ROOM_SIZE.
// Each room has one event (Track Vote) and one playlist (Playlist Editor). Every user holds a
// Socket.io connection subscribed to both and acts at random: toggles votes, reads the queue,
// adds / moves / removes playlist entries. Per step it measures HTTP latency, errors, the time
// for a change to reach another user's socket, and then checks that the result is CORRECT.
//
// Every virtual user has its own X-Forwarded-For address, so the per-IP rate limits stay ON
// (the server runs with TRUST_PROXY=1). Users and tokens are created directly in the database.
import { execFile } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { promisify } from "node:util";
import type {
  EventQueueUpdate,
  EventTrack,
  PlaylistSnapshot,
  QueueSnapshot,
} from "@music-room/shared";
import pg from "pg";
import { io, type Socket } from "socket.io-client";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { Recorder } from "./stats.js";

const run = promisify(execFile);

// ---- settings (all overridable by environment variables) ----
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const BASE_URL =
  process.env["LOAD_BASE_URL"] ?? `http://127.0.0.1:${num("BACKEND_PORT", 3000)}`;
const STEPS = (process.env["LOAD_STEPS"] ?? "50,100,200,400,600,800,1000")
  .split(",")
  .map(Number);
const HOLD_SECONDS = num("LOAD_HOLD_SECONDS", 45);
const ROOM_SIZE = num("LOAD_ROOM_SIZE", 50);
const THINK_MS = num("LOAD_THINK_MS", 6000); // average pause between one user's actions
const TRACKS_PER_EVENT = 20;
const PLAYLIST_SEED = 10;
const MAX_PLAYLIST = 200; // stay far below the 500-entry limit
const PROBE_EVERY_MS = 2000;
const HTTP_TIMEOUT_MS = 10_000;
const BROADCAST_TIMEOUT_MS = 10_000;
// A step "fails" when more than this share of requests fail or the vote p95 passes the bound.
const MAX_ERROR_RATE = 0.05;
const MAX_VOTE_P95_MS = 2000;
const USER_PREFIX = "loadtest-";

const DATABASE_URL = required("DATABASE_URL");
const SECRET = required("JWT_ACCESS_SECRET");
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run through "make loadtest").`);
  return value;
}

// ---- small utilities ----
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;
const think = () => THINK_MS * (0.5 + Math.random()); // 0.5x to 1.5x the average

/** An address in 10.0.0.0/8 that is unique per user, sent as X-Forwarded-For. */
function addressOf(index: number): string {
  return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
}

let recorder = new Recorder();
const HTTP_OPERATIONS = [
  "vote",
  "unvote",
  "read-queue",
  "playlist-add",
  "playlist-move",
  "playlist-remove",
  "read-playlist",
];

interface Pending {
  isDone: (snapshot: {
    version: number;
    tracks: Array<{ id: string; voteCount?: number }>;
  }) => boolean;
  sentAt: number;
  operation: string;
  timer: NodeJS.Timeout;
  resolve: () => void;
}

interface Room {
  index: number;
  eventId: string;
  playlistId: string;
  /** Event tracks the normal users vote on (the probe track is separate). */
  trackIds: string[];
  probeTrackId: string;
  /** Who voted for what, as the harness believes: the expected result. */
  ledger: Map<string, Set<string>>;
  users: VirtualUser[];
  pending: Pending[];
}

class VirtualUser {
  readonly address: string;
  token = "";
  socket!: Socket;
  room!: Room;
  voted = new Set<string>();
  eventSnapshot: QueueSnapshot | EventQueueUpdate | null = null;
  playlistSnapshot: PlaylistSnapshot | null = null;
  probeEntryId: string | null = null;
  probeVoted = true;
  active = false;
  /** Why the socket was closed, if it was (a healthy run has none). */
  droppedReason: string | null = null;
  private busy: Promise<void> = Promise.resolve();

  constructor(
    readonly index: number,
    readonly id: string,
  ) {
    this.address = addressOf(index);
  }

  headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "X-Forwarded-For": this.address,
      "X-Platform": "android",
      "X-Device": "loadtest",
      "X-App-Version": "0.0.0",
    };
  }

  /** One request. Returns the status and body; a network error or timeout is status 0. */
  async http(
    method: string,
    path: string,
    body?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON answers of our own server, read field by field
  ): Promise<{ status: number; json: any; ms: number }> {
    const start = performance.now();
    try {
      const response = await fetch(BASE_URL + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const text = await response.text();
      return {
        status: response.status,
        json: text ? JSON.parse(text) : null,
        ms: performance.now() - start,
      };
    } catch {
      return { status: 0, json: null, ms: performance.now() - start };
    }
  }

  /** Records the outcome. `conflicts` lists statuses that are a legitimate answer to a race. */
  async call(
    operation: string,
    method: string,
    path: string,
    ok: number,
    body?: unknown,
    conflicts: number[] = [],
  ) {
    const result = await this.http(method, path, body);
    const outcome =
      result.status === ok
        ? "ok"
        : conflicts.includes(result.status)
          ? "conflict"
          : "error";
    recorder.record(operation, result.ms, outcome);
    return { ...result, outcome } as const;
  }

  async connect(): Promise<void> {
    const start = performance.now();
    this.socket = io(`${BASE_URL}/live`, {
      auth: { token: this.token },
      extraHeaders: {
        "X-Forwarded-For": this.address,
        "X-Platform": "android",
        "X-Device": "loadtest",
        "X-App-Version": "0.0.0",
      },
      transports: ["websocket"],
      reconnection: false,
    });
    this.socket.on("disconnect", (reason) => {
      // Closing it ourselves at the end is not a drop.
      if (reason === "io client disconnect") return;
      this.droppedReason = reason;
      recorder.recordFailure("socket-disconnect");
    });
    this.socket.on("event:queue", (snapshot: QueueSnapshot) =>
      this.onEventSnapshot(snapshot),
    );
    this.socket.on("playlist:updated", (snapshot: PlaylistSnapshot) =>
      this.onPlaylistSnapshot(snapshot),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket connect timeout")), 10_000);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    recorder.record("socket-connect", performance.now() - start, "ok");
    const eventAck = await this.subscribe("event", this.room.eventId);
    this.eventSnapshot = eventAck;
    this.playlistSnapshot = await this.subscribe("playlist", this.room.playlistId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON answers of our own server, read field by field
  private async subscribe(resource: "event" | "playlist", id: string): Promise<any> {
    const start = performance.now();
    const ack = await this.socket
      .timeout(10_000)
      .emitWithAck("subscribe", { resource, id });
    recorder.record("subscribe", performance.now() - start, ack.ok ? "ok" : "error");
    if (!ack.ok) throw new Error(`subscribe ${resource} refused: ${ack.error?.code}`);
    return ack.snapshot;
  }

  // Keep the snapshot with the highest version (the contract: ignore older ones).
  private onEventSnapshot(snapshot: QueueSnapshot) {
    if (!this.eventSnapshot || snapshot.version > this.eventSnapshot.version)
      this.eventSnapshot = snapshot;
    else recorder.record("stale-event-snapshot", 0, "ok");
    this.resolvePending(snapshot);
  }
  private onPlaylistSnapshot(snapshot: PlaylistSnapshot) {
    if (!this.playlistSnapshot || snapshot.version > this.playlistSnapshot.version)
      this.playlistSnapshot = snapshot;
    else recorder.record("stale-playlist-snapshot", 0, "ok");
    this.resolvePending(snapshot);
  }
  /** Only the room's observer resolves the probes (they are measured from another user's socket). */
  private resolvePending(snapshot: {
    version: number;
    tracks: Array<{ id: string; voteCount?: number }>;
  }) {
    if (this.room.users[2] !== this) return;
    const now = performance.now();
    for (const pending of [...this.room.pending]) {
      if (!pending.isDone(snapshot)) continue;
      clearTimeout(pending.timer);
      this.room.pending.splice(this.room.pending.indexOf(pending), 1);
      recorder.record(pending.operation, now - pending.sentAt, "ok");
      pending.resolve();
    }
  }

  /** Runs one thing after the previous one, so a user never does two at once. */
  enqueue(task: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(task, task);
    return this.busy;
  }

  async loop(isRunning: () => boolean): Promise<void> {
    this.active = true;
    await sleep(Math.random() * THINK_MS); // spread the users out
    while (isRunning()) {
      await this.enqueue(() => this.act());
      await sleep(think());
    }
    this.active = false;
  }

  private async act(): Promise<void> {
    const dice = Math.random();
    if (dice < 0.6) return this.toggleVote();
    if (dice < 0.7)
      return void (await this.call(
        "read-queue",
        "GET",
        `/api/v1/events/${this.room.eventId}/tracks`,
        200,
      ));
    if (dice < 0.8)
      return void (await this.call(
        "read-playlist",
        "GET",
        `/api/v1/playlists/${this.room.playlistId}/tracks`,
        200,
      ));
    return this.editPlaylist();
  }

  private async toggleVote(): Promise<void> {
    const trackId = pick(this.room.trackIds);
    const base = `/api/v1/events/${this.room.eventId}/tracks/${trackId}/vote`;
    if (this.voted.has(trackId)) {
      const result = await this.call("unvote", "DELETE", base, 200);
      if (result.outcome === "ok") {
        this.voted.delete(trackId);
        this.room.ledger.get(trackId)?.delete(this.id);
      }
    } else {
      const result = await this.call("vote", "PUT", base, 200, {});
      if (result.outcome === "ok") {
        this.voted.add(trackId);
        this.room.ledger.get(trackId)?.add(this.id);
      }
    }
  }

  private async editPlaylist(): Promise<void> {
    const entries = this.playlistSnapshot?.tracks ?? [];
    const base = `/api/v1/playlists/${this.room.playlistId}/tracks`;
    const dice = Math.random();
    if (entries.length >= MAX_PLAYLIST || (dice >= 0.8 && entries.length > 0)) {
      await this.call("playlist-remove", "DELETE", `${base}/${pick(entries).id}`, 200);
    } else if (dice < 0.5 || entries.length < 2) {
      const anchor =
        entries.length > 0 && Math.random() < 0.5 ? pick(entries).id : undefined;
      await this.call(
        "playlist-add",
        "POST",
        base,
        201,
        {
          providerTrackId: String(2000 + Math.floor(Math.random() * 500)),
          afterEntryId: anchor,
        },
        [409],
      );
    } else {
      const entry = pick(entries);
      const anchor = Math.random() < 0.2 ? null : pick(entries).id;
      await this.call(
        "playlist-move",
        "POST",
        `${base}/${entry.id}/move`,
        200,
        { afterEntryId: anchor },
        [404, 409],
      );
    }
  }

  /** Probe: change something only this user touches, and time how long until the observer's socket shows it. */
  async probeEvent(): Promise<void> {
    const wantVoted = !this.probeVoted;
    const sentAt = performance.now();
    const path = `/api/v1/events/${this.room.eventId}/tracks/${this.room.probeTrackId}/vote`;
    const result = await this.call(
      wantVoted ? "vote" : "unvote",
      wantVoted ? "PUT" : "DELETE",
      path,
      200,
      wantVoted ? {} : undefined,
    );
    if (result.outcome !== "ok") return;
    this.probeVoted = wantVoted;
    const expected = wantVoted ? 1 : 0;
    await this.expectBroadcast("broadcast-vote", sentAt, (snapshot) =>
      snapshot.tracks.some(
        (t) => t.id === this.room.probeTrackId && t.voteCount === expected,
      ),
    );
  }

  async probePlaylist(): Promise<void> {
    const base = `/api/v1/playlists/${this.room.playlistId}/tracks`;
    const sentAt = performance.now();
    let version: number | undefined;
    if (this.probeEntryId === null) {
      const result = await this.call("playlist-add", "POST", base, 201, {
        providerTrackId: "3000",
      });
      if (result.outcome !== "ok") return;
      const snapshot = result.json as PlaylistSnapshot;
      this.probeEntryId = snapshot.tracks.at(-1)?.id ?? null;
      version = snapshot.version;
    } else {
      const result = await this.call(
        "playlist-remove",
        "DELETE",
        `${base}/${this.probeEntryId}`,
        200,
      );
      if (result.outcome !== "ok") return;
      this.probeEntryId = null;
      version = (result.json as PlaylistSnapshot).version;
    }
    const wanted = version;
    await this.expectBroadcast(
      "broadcast-playlist",
      sentAt,
      (snapshot) => snapshot.version >= wanted,
    );
  }

  private expectBroadcast(
    operation: string,
    sentAt: number,
    isDone: Pending["isDone"],
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const pending: Pending = {
        isDone,
        sentAt,
        operation,
        resolve,
        timer: setTimeout(() => {
          this.room.pending.splice(this.room.pending.indexOf(pending), 1);
          recorder.recordFailure(operation);
          resolve();
        }, BROADCAST_TIMEOUT_MS),
      };
      this.room.pending.push(pending);
    });
  }
}

// ---- setup ----
async function createUsers(db: pg.Pool, count: number): Promise<VirtualUser[]> {
  const names = Array.from({ length: count }, (_, i) => `${USER_PREFIX}${i}`);
  const { rows } = await db.query(
    `INSERT INTO users (display_name, email, email_verified_at)
     SELECT n, n || '@loadtest.invalid', now() FROM unnest($1::text[]) AS n
     RETURNING id, display_name`,
    [names],
  );
  const byName = new Map<string, string>(rows.map((r) => [r.display_name, r.id]));
  return names.map((name, i) => new VirtualUser(i, byName.get(name)!));
}

async function createRoom(index: number, members: VirtualUser[]): Promise<Room> {
  // Roles: [0] owns the room, [1] is the probe (changes things only it touches), [2] observes the probe.
  const [owner, prober] = members as [VirtualUser, VirtualUser];
  const room: Room = {
    index,
    eventId: "",
    playlistId: "",
    trackIds: [],
    probeTrackId: "",
    ledger: new Map(),
    users: members,
    pending: [],
  };
  for (const user of members) user.room = room;
  const created = await owner.http("POST", "/api/v1/events", {
    name: `loadtest event ${index}`,
  });
  const playlist = await owner.http("POST", "/api/v1/playlists", {
    name: `loadtest list ${index}`,
  });
  if (created.status !== 201 || playlist.status !== 201)
    throw new Error(
      `room ${index}: create failed (${created.status}, ${playlist.status})`,
    );
  room.eventId = created.json.id;
  room.playlistId = playlist.json.id;
  // The owner suggests the tracks (a suggestion is the suggester's vote); the prober suggests the probe track.
  for (let i = 0; i < TRACKS_PER_EVENT; i++) {
    const suggested = await owner.http("POST", `/api/v1/events/${room.eventId}/tracks`, {
      providerTrackId: String(1000 + index * 100 + i),
    });
    if (suggested.status !== 201)
      throw new Error(`room ${index}: suggest failed (${suggested.status})`);
    const track = suggested.json as EventTrack;
    room.trackIds.push(track.id);
    room.ledger.set(track.id, new Set([owner.id]));
    owner.voted.add(track.id);
  }
  const probe = await prober.http("POST", `/api/v1/events/${room.eventId}/tracks`, {
    providerTrackId: String(900_000 + index),
  });
  if (probe.status !== 201)
    throw new Error(`room ${index}: probe suggest failed (${probe.status})`);
  room.probeTrackId = (probe.json as EventTrack).id;
  for (let i = 0; i < PLAYLIST_SEED; i++) {
    const added = await owner.http(
      "POST",
      `/api/v1/playlists/${room.playlistId}/tracks`,
      {
        providerTrackId: String(5000 + i),
      },
    );
    if (added.status !== 201)
      throw new Error(`room ${index}: seed failed (${added.status})`);
  }
  return room;
}

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size)
    await Promise.all(items.slice(i, i + size).map(work));
}

// ---- verification ----
interface Correctness {
  rooms: number;
  voteCountMismatches: number;
  eventSocketsOutOfSync: number;
  playlistSocketsOutOfSync: number;
  checkedSockets: number;
  /** Sockets the server (or the network) closed during the run: always a failure. */
  droppedSockets: number;
}

/** With every user paused: the server's answer must equal what the users did, and every socket must have caught up. */
async function verify(rooms: Room[]): Promise<Correctness> {
  const result: Correctness = {
    rooms: rooms.length,
    voteCountMismatches: 0,
    eventSocketsOutOfSync: 0,
    playlistSocketsOutOfSync: 0,
    checkedSockets: 0,
    droppedSockets: 0,
  };
  for (const room of rooms) {
    const reader = room.users[0]!;
    const queue = (await reader.http("GET", `/api/v1/events/${room.eventId}/tracks`))
      .json as EventQueueUpdate;
    const playlist = (
      await reader.http("GET", `/api/v1/playlists/${room.playlistId}/tracks`)
    ).json as PlaylistSnapshot;
    const counts = new Map(queue.tracks.map((t) => [t.id, t.voteCount]));
    for (const [trackId, voters] of room.ledger) {
      if (counts.get(trackId) !== voters.size) result.voteCountMismatches++;
    }
    const queueKey = (tracks: Array<{ id: string; voteCount: number }>) =>
      tracks.map((t) => `${t.id}:${t.voteCount}`).join(",");
    const wantedQueue = queueKey(queue.tracks);
    const wantedPlaylist = playlist.tracks.map((t) => t.id).join(",");
    for (const user of room.users.filter((u) => u.socket)) {
      result.checkedSockets++;
      if (user.droppedReason !== null || !user.socket.connected) {
        result.droppedSockets++;
        continue;
      }
      const e = user.eventSnapshot;
      if (!e || e.version !== queue.version || queueKey(e.tracks) !== wantedQueue)
        result.eventSocketsOutOfSync++;
      const p = user.playlistSnapshot;
      if (
        !p ||
        p.version !== playlist.version ||
        p.tracks.map((t) => t.id).join(",") !== wantedPlaylist
      )
        result.playlistSocketsOutOfSync++;
    }
  }
  return result;
}

// ---- reporting ----
async function containerStats(): Promise<{ cpu: string; memory: string }> {
  try {
    const { stdout: id } = await run("docker", ["compose", "ps", "-q", "backend"]);
    const { stdout } = await run("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.CPUPerc}}|{{.MemUsage}}",
      id.trim(),
    ]);
    const [cpu = "?", memory = "?"] = stdout.trim().split("|");
    return { cpu, memory };
  } catch {
    return { cpu: "?", memory: "?" };
  }
}

const ms = (value: number) => `${Math.round(value)}`;

function printStep(step: StepResult) {
  const { users, rooms, seconds } = step;
  console.log(`\n=== ${users} users, ${rooms} rooms, ${seconds}s hold ===`);
  console.log(
    `requests ${step.requests} (${(step.requests / seconds).toFixed(0)}/s), errors ${step.errors} (${(step.errorRate * 100).toFixed(2)}%), ` +
      `server CPU ${step.server.cpu}, memory ${step.server.memory}`,
  );
  console.log(
    `harness: event-loop delay p99 ${step.harness.loopDelayP99Ms} ms, CPU ${step.harness.cpuPercent}% of one core`,
  );
  console.log(
    "operation                 count   p50   p95   p99   max  errors conflicts",
  );
  for (const op of step.operations) {
    console.log(
      `${op.name.padEnd(24)} ${String(op.count).padStart(6)} ${ms(op.p50).padStart(5)} ${ms(op.p95).padStart(5)} ${ms(op.p99).padStart(5)} ${ms(op.max).padStart(5)} ${String(op.errors).padStart(7)} ${String(op.conflicts).padStart(9)}`,
    );
  }
  const c = step.correctness;
  console.log(
    `correctness: dropped sockets ${c.droppedSockets}, vote-count mismatches ${c.voteCountMismatches}, event sockets out of sync ${c.eventSocketsOutOfSync}/${c.checkedSockets}, playlist sockets out of sync ${c.playlistSocketsOutOfSync}/${c.checkedSockets}`,
  );
  console.log(step.limitReached ? `LIMIT REACHED: ${step.limitReason}` : "step passed");
}

interface StepResult {
  users: number;
  rooms: number;
  seconds: number;
  requests: number;
  errors: number;
  errorRate: number;
  server: { cpu: string; memory: string };
  harness: { loopDelayP99Ms: number; cpuPercent: number };
  operations: Array<{
    name: string;
    count: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    errors: number;
    conflicts: number;
  }>;
  correctness: Correctness;
  limitReached: boolean;
  limitReason: string;
}

// ---- main ----
async function main() {
  console.log(
    `Target ${BASE_URL}; steps ${STEPS.join(", ")}; hold ${HOLD_SECONDS}s; rooms of ${ROOM_SIZE}`,
  );
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok)
    throw new Error(`Backend not reachable at ${BASE_URL}. Run "make loadtest-up".`);

  const db = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await db.query("DELETE FROM users WHERE display_name LIKE $1", [`${USER_PREFIX}%`]);
  const maxUsers = Math.max(...STEPS);
  const users = await createUsers(db, maxUsers);
  const rooms: Room[] = [];
  let running = true;
  let connected = 0;
  const results: StepResult[] = [];
  const probes: Array<Promise<void>> = [];

  try {
    for (const target of STEPS) {
      recorder = new Recorder();
      const fresh = users.slice(connected, target);
      // Tokens last 15 minutes: sign them again for every step.
      for (const user of users.slice(0, target))
        user.token = await signAccessToken(user.id, SECRET, { displayNameSet: true });
      // New rooms for new users (a room is created when its first ROOM_SIZE members are all in this step).
      for (let first = rooms.length * ROOM_SIZE; first < target; first += ROOM_SIZE) {
        const members = users.slice(first, Math.min(first + ROOM_SIZE, maxUsers));
        for (const user of members)
          user.token = await signAccessToken(user.id, SECRET, { displayNameSet: true });
        rooms.push(await createRoom(rooms.length, members));
      }
      let failedConnections = 0;
      await inBatches(fresh, 25, async (user) => {
        try {
          await user.connect();
        } catch (error) {
          failedConnections++;
          console.error(`user ${user.index}: ${(error as Error).message}`);
        }
      });
      connected = target;
      const setupErrors = failedConnections;

      // Hold: everyone acts; one probe per room measures how fast changes reach another socket.
      recorder = new Recorder();
      for (let i = 0; i < setupErrors; i++) recorder.recordFailure("socket-connect");
      const paused = { value: false };
      const delay = monitorEventLoopDelay();
      delay.enable();
      const cpuBefore = process.cpuUsage();
      const startedAt = performance.now();
      const loops = users
        .slice(0, target)
        .filter((u) => u.socket?.connected)
        .map((u) => u.loop(() => running && !paused.value));
      const probeLoops = rooms
        .filter(
          (room) => room.users[1]?.socket?.connected && room.users[2]?.socket?.connected,
        )
        .map(async (room) => {
          const probeUser = room.users[1]!;
          while (running && !paused.value) {
            await probeUser.enqueue(() => probeUser.probeEvent());
            await probeUser.enqueue(() => probeUser.probePlaylist());
            await sleep(PROBE_EVERY_MS);
          }
        });
      probes.push(...probeLoops);
      let serverStats = { cpu: "?", memory: "?" };
      setTimeout(
        async () => (serverStats = await containerStats()),
        (HOLD_SECONDS * 1000) / 2,
      );
      await sleep(HOLD_SECONDS * 1000);
      paused.value = true;
      const elapsedMs = performance.now() - startedAt;
      const cpu = process.cpuUsage(cpuBefore);
      delay.disable();
      await Promise.all([...loops, ...probeLoops]);
      await sleep(3000); // let the last broadcasts arrive before comparing
      const correctness = await verify(rooms.slice(0, Math.ceil(target / ROOM_SIZE)));

      const operations = recorder.operations().map((name) => ({
        name,
        ...recorder.summary(name),
        errors: recorder.errorCount(name),
        conflicts: recorder.conflictCount(name),
      }));
      const requests = recorder.totalCount(HTTP_OPERATIONS);
      const errors = recorder.totalErrors();
      const voteP95 = recorder.summary("vote").p95;
      const reasons: string[] = [];
      const errorRate = requests ? errors / requests : 0;
      if (errorRate > MAX_ERROR_RATE)
        reasons.push(
          `error rate ${(errorRate * 100).toFixed(1)}% > ${MAX_ERROR_RATE * 100}%`,
        );
      if (voteP95 > MAX_VOTE_P95_MS)
        reasons.push(`vote p95 ${ms(voteP95)} ms > ${MAX_VOTE_P95_MS} ms`);
      const wrong =
        correctness.droppedSockets +
        correctness.voteCountMismatches +
        correctness.eventSocketsOutOfSync +
        correctness.playlistSocketsOutOfSync;
      if (wrong > 0) reasons.push(`${wrong} correctness failures`);
      const step: StepResult = {
        users: target,
        rooms: rooms.length,
        seconds: Math.round(elapsedMs / 1000),
        requests,
        errors,
        errorRate,
        server: serverStats,
        harness: {
          loopDelayP99Ms: Math.round(delay.percentile(99) / 1e6),
          cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
        },
        operations,
        correctness,
        limitReached: reasons.length > 0,
        limitReason: reasons.join("; "),
      };
      results.push(step);
      printStep(step);
      if (step.limitReached && process.env["LOAD_STOP_ON_LIMIT"] !== "0") break;
      paused.value = false;
    }
  } finally {
    running = false;
    for (const user of users) user.socket?.close();
    await Promise.allSettled(probes);
    await db.query("DELETE FROM users WHERE display_name LIKE $1", [`${USER_PREFIX}%`]);
    await db.end();
  }
  const out = process.env["LOAD_OUT"];
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      out,
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          roomSize: ROOM_SIZE,
          thinkMs: THINK_MS,
          holdSeconds: HOLD_SECONDS,
          results,
        },
        null,
        2,
      ),
    );
    console.log(`\nResults written to ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
