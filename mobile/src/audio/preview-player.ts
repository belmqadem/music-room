// Track previews (ADR-053): one 30-second sample at a time, on this phone only. Pressing a
// track's cover plays it, pressing again pauses it, and another track's cover takes over. The
// link is asked for at every play (Deezer signs it and it expires within minutes), never kept.
// The phone's audio comes in as a dependency (preview.ts wires expo-audio), so every path is
// tested without a phone.

/** Why a preview could not play: no sample, no connection, or anything else. */
export type PreviewFailure = "unavailable" | "offline" | "unknown";

export type PreviewPhase = "idle" | "loading" | "playing" | "paused" | "failed";

export interface PreviewState {
  /** The track concerned; null when nothing is playing, paused or failing. */
  trackId: string | null;
  phase: PreviewPhase;
  failure: PreviewFailure | null;
}

/** What the audio library reports about the sample it holds. */
export interface OutputStatus {
  playing: boolean;
  didJustFinish: boolean;
  error: string | null;
}

/** The phone's audio, reduced to what previews need. */
export interface AudioOutput {
  /** Replaces whatever was loaded with this link. */
  load(url: string): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  onStatus(listener: (status: OutputStatus) => void): () => void;
}

export interface PreviewPlayerDeps {
  /** GET /tracks/{id}/preview: a fresh link to the sample. */
  fetchPreviewUrl(providerTrackId: string): Promise<string>;
  output: AudioOutput;
  /** Sorts a failed request: no sample, offline, or anything else. */
  classify(error: unknown): PreviewFailure;
}

const IDLE: PreviewState = { trackId: null, phase: "idle", failure: null };

export function createPreviewPlayer(deps: PreviewPlayerDeps) {
  let state: PreviewState = IDLE;
  // The sample ended: playing it again starts from the top.
  let atEnd = false;
  // Grows at every new request and at every stop, so a link that arrives after the person moved
  // on (another track, a pause during loading, leaving the screen) is dropped.
  let generation = 0;
  const listeners = new Set<() => void>();

  function set(next: PreviewState): void {
    state = next;
    listeners.forEach((listener) => listener());
  }

  deps.output.onStatus((status) => {
    if (state.trackId === null || state.phase === "failed") return;
    if (status.error !== null) {
      set({ trackId: state.trackId, phase: "failed", failure: "unknown" });
      return;
    }
    if (status.didJustFinish) {
      atEnd = true;
      set({ trackId: state.trackId, phase: "paused", failure: null });
      return;
    }
    if (status.playing && state.phase === "loading")
      set({ trackId: state.trackId, phase: "playing", failure: null });
  });

  async function start(trackId: string): Promise<void> {
    const mine = ++generation;
    deps.output.pause();
    atEnd = false;
    set({ trackId, phase: "loading", failure: null });
    let url: string;
    try {
      url = await deps.fetchPreviewUrl(trackId);
    } catch (error) {
      if (mine !== generation) return;
      set({ trackId, phase: "failed", failure: deps.classify(error) });
      return;
    }
    if (mine !== generation) return;
    deps.output.load(url);
    deps.output.play();
  }

  /** Play this track's sample, or pause / resume it if it is the one already chosen. */
  async function toggle(trackId: string): Promise<void> {
    if (state.trackId !== trackId || state.phase === "failed") return start(trackId);
    switch (state.phase) {
      case "loading":
        stop(); // pressed again before it started: the person changed their mind
        return;
      case "playing":
        deps.output.pause();
        set({ trackId, phase: "paused", failure: null });
        return;
      case "paused":
        if (atEnd) {
          atEnd = false;
          await deps.output.seekTo(0);
        }
        deps.output.play();
        set({ trackId, phase: "playing", failure: null });
        return;
      case "idle":
        return start(trackId);
    }
  }

  /**
   * Make this track's sample sound, whatever it was doing: start it, resume it, or leave it
   * playing. For the owner's Start playing / Next track, which asks for music, not a toggle.
   */
  async function play(trackId: string): Promise<void> {
    if (
      state.trackId === trackId &&
      (state.phase === "playing" || state.phase === "loading")
    )
      return;
    if (state.trackId === trackId && state.phase === "paused") return toggle(trackId);
    return start(trackId);
  }

  /** Silence: leaving the screen, closing the search, signing out. */
  function stop(): void {
    generation++;
    atEnd = false;
    deps.output.pause();
    if (state !== IDLE) set(IDLE);
  }

  return {
    toggle,
    play,
    stop,
    getState: (): PreviewState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type PreviewPlayer = ReturnType<typeof createPreviewPlayer>;

/** What one track's cover shows: its own phase, or idle when another track holds the player. */
export function phaseOf(state: PreviewState, trackId: string): PreviewPhase {
  return state.trackId === trackId ? state.phase : "idle";
}
