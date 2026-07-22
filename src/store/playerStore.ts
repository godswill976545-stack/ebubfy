import { create } from "zustand";
import type { VideoResult, RepeatMode } from "../types";
import type { LyricsResult } from "../lib/api";

interface LyricLine {
  /** Normalised time in seconds (0-based). For synced lyrics = actual timestamp.
   *  For unsynced lyrics = evenly distributed across the track duration. */
  time: number;
  text: string;
}

interface PlayerState {
  // Current track
  currentTrack: VideoResult | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;

  // Audio engine state (singleton, updated by useAudio hook in App.tsx)
  audioLoading: boolean;
  audioError: string | null;
  retryAudio: () => void;

  // Queue
  queue: VideoResult[];
  queueIndex: number;
  history: VideoResult[];

  // Settings
  shuffle: boolean;
  repeat: RepeatMode;

  // Lyrics
  /** Unified lyric lines (synced from YouTube or time-distributed from MusixMatch). */
  lyricsLines: LyricLine[];
  /** Raw MusixMatch result (body, track_id, track_name, artist_name). */
  lyricsResult: LyricsResult | null;
  /** Whether the lyrics panel is open. */
  showLyrics: boolean;
  /** Whether lyrics are currently being fetched. */
  lyricsLoading: boolean;
  /** Index of the currently active/highlighted lyric line. -1 = none. */
  activeLyricLine: number;

  // Actions
  setCurrentTrack: (track: VideoResult) => void;
  enrichCurrentTrack: (enriched: Partial<VideoResult>) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number | ((prev: number) => number)) => void;
  setIsMuted: (muted: boolean) => void;
  setShuffle: (shuffle: boolean) => void;
  setRepeat: (repeat: RepeatMode) => void;
  setAudioLoading: (loading: boolean) => void;
  setAudioError: (error: string | null) => void;
  setRetryAudio: (fn: () => void) => void;

  // Lyrics actions
  setLyricsLines: (lines: LyricLine[]) => void;
  setLyricsResult: (result: LyricsResult | null) => void;
  setShowLyrics: (show: boolean) => void;
  setLyricsLoading: (loading: boolean) => void;
  setActiveLyricLine: (index: number) => void;
  clearLyrics: () => void;

  // Queue actions
  setQueue: (queue: VideoResult[]) => void;
  addToQueue: (track: VideoResult) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  playNext: () => void;
  playPrevious: () => void;
  playTrack: (track: VideoResult, queue?: VideoResult[]) => void;
  reorderQueue: (from: number, to: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,

  queue: [],
  queueIndex: -1,
  history: [],

  shuffle: false,
  repeat: "off",

  audioLoading: false,
  audioError: null,
  retryAudio: () => {},

  // Lyrics
  lyricsLines: [],
  lyricsResult: null,
  showLyrics: false,
  lyricsLoading: false,
  activeLyricLine: -1,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  enrichCurrentTrack: (enriched) =>
    set((state) => ({
      currentTrack: state.currentTrack ? { ...state.currentTrack, ...enriched } : null,
    })),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) =>
    set((state) => ({
      volume: typeof volume === "function" ? volume(state.volume) : volume,
    })),
  setIsMuted: (muted) => set({ isMuted: muted }),
  setShuffle: (shuffle) => set({ shuffle }),
  setRepeat: (repeat) => set({ repeat }),
  setAudioLoading: (loading) => set({ audioLoading: loading }),
  setAudioError: (error) => set({ audioError: error }),
  setRetryAudio: (fn) => set({ retryAudio: fn }),

  // Lyrics actions
  setLyricsLines: (lines) => set({ lyricsLines: lines }),
  setLyricsResult: (result) => set({ lyricsResult: result }),
  setShowLyrics: (show) => set({ showLyrics: show }),
  setLyricsLoading: (loading) => set({ lyricsLoading: loading }),
  setActiveLyricLine: (index) => set({ activeLyricLine: index }),
  clearLyrics: () =>
    set({
      lyricsLines: [],
      lyricsResult: null,
      lyricsLoading: false,
      activeLyricLine: -1,
    }),

  addToQueue: (track) =>
    set((state) => ({
      queue: [...state.queue, track],
    })),

  removeFromQueue: (index) =>
    set((state) => {
      const newQueue = [...state.queue];
      newQueue.splice(index, 1);
      const newIndex = index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
      return { queue: newQueue, queueIndex: newIndex };
    }),

  clearQueue: () => set({ queue: [], queueIndex: -1 }),
  setQueue: (queue) => set({ queue, queueIndex: queue.length > 0 ? 0 : -1 }),

  playNext: () => {
    const { queue, queueIndex, repeat, shuffle, currentTrack, history } = get();
    if (queue.length === 0) return;

    let nextIndex = queueIndex + 1;

    if (shuffle) {
      // Pick a random track that is NOT the current one
      if (queue.length <= 1) {
        nextIndex = queueIndex;
      } else {
        do {
          nextIndex = Math.floor(Math.random() * queue.length);
        } while (nextIndex === queueIndex && queue.length > 1);
      }
    } else if (nextIndex >= queue.length) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        return;
      }
    }

    const nextTrack = queue[nextIndex];
    if (nextTrack) {
      set({
        currentTrack: nextTrack,
        queueIndex: nextIndex,
        currentTime: 0,
        isPlaying: true,
        history: currentTrack ? [currentTrack, ...history].slice(0, 100) : history,
      });
    }
  },

  playPrevious: () => {
    const { queue, queueIndex, history } = get();
    if (queueIndex > 0) {
      const prevIndex = queueIndex - 1;
      set({
        currentTrack: queue[prevIndex],
        queueIndex: prevIndex,
        currentTime: 0,
        isPlaying: true,
      });
    } else if (history.length > 0) {
      const prevTrack = history[0];
      set({
        currentTrack: prevTrack,
        history: history.slice(1),
        currentTime: 0,
        isPlaying: true,
      });
    }
  },

  playTrack: (track, queue) => {
    if (queue) {
      const index = queue.findIndex((t) => t.id === track.id);
      set({
        currentTrack: track,
        queue,
        queueIndex: index >= 0 ? index : 0,
        currentTime: 0,
        isPlaying: true,
      });
    } else {
      const { currentTrack, history, queue: existingQueue } = get();
      const newQueue = [...existingQueue, track];
      set({
        currentTrack: track,
        queue: newQueue,
        queueIndex: newQueue.length - 1,
        currentTime: 0,
        isPlaying: true,
        history: currentTrack ? [currentTrack, ...history].slice(0, 100) : history,
      });
    }
  },

  reorderQueue: (from, to) =>
    set((state) => {
      if (from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length || from === to) {
        return state; // no-op
      }
      const newQueue = [...state.queue];
      const [moved] = newQueue.splice(from, 1);
      newQueue.splice(to, 0, moved);

      let newIndex = state.queueIndex;
      if (from === state.queueIndex) {
        newIndex = to;
      } else if (from < state.queueIndex && to >= state.queueIndex) {
        newIndex = state.queueIndex - 1;
      } else if (from > state.queueIndex && to <= state.queueIndex) {
        newIndex = state.queueIndex + 1;
      }

      return { queue: newQueue, queueIndex: newIndex };
    }),
}));

export type { LyricLine };
