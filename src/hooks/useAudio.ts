import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useAudioSettings } from "../store/audioSettings";
import { getStreamUrl } from "../lib/api";
import {
  initAudioGraph,
  initSecondaryAudio,
  disposeAudioGraph,
  setEqualizerGains,
  setOutputGain,
  setChannelGain,
  ensureAudioContextResumed,
  isAudioGraphBuilt,
  swapActiveChannel,
  getActiveChannel,
} from "../lib/audioGraph";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const TIME_UPDATE_THROTTLE_MS = 250;
const PREBUFFER_THRESHOLD = 0.65;

const streamUrlCache = new Map<string, string>();
let prebufferInProgress = false;

function getNextTrack(): { id: string } | null {
  const { queue, queueIndex } = usePlayerStore.getState();
  if (queue.length === 0) return null;
  const nextIdx = queueIndex + 1;
  if (nextIdx >= queue.length) return null;
  return queue[nextIdx];
}

async function prebufferNextTrack(): Promise<void> {
  if (prebufferInProgress) return;
  const next = getNextTrack();
  if (!next) return;
  if (streamUrlCache.has(next.id)) return;

  prebufferInProgress = true;
  try {
    const url = await getStreamUrl(next.id);
    streamUrlCache.set(next.id, url);
  } catch {
    // Silently fail — will fetch on-demand later
  } finally {
    prebufferInProgress = false;
  }
}

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef2 = useRef<HTMLAudioElement | null>(null);
  const loadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const lastTimeUpdateRef = useRef(0);
  const prebufferTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const nextTrackIdRef = useRef<string | null>(null);
  // Crossfade state: when set, we're mid-crossfade and the next track is
  // playing on the second audio element.
  const crossfadeStateRef = useRef<{
    secondaryEl: HTMLAudioElement;
    secondaryUrl: string;
    secondaryTrackId: string;
    activeChannel: "a" | "b";
    startedAt: number;
    fadingOut: "a" | "b" | null;
  } | null>(null);
  const {
    currentTrack, isPlaying, volume, isMuted,
    setCurrentTime, setDuration, setIsPlaying, playNext,
  } = usePlayerStore();

  useLayoutEffect(() => {
    nextTrackIdRef.current = currentTrack?.id ?? null;
  }, [currentTrack]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create audio elements + wire the Web Audio graph (lazily, on first EQ enable)
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const audio2 = new Audio();
    audio2.preload = "auto";
    audioRef2.current = audio2;

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastTimeUpdateRef.current < TIME_UPDATE_THROTTLE_MS) return;
      lastTimeUpdateRef.current = now;
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onEnded = () => {
      const cf = crossfadeStateRef.current;
      if (cf) {
        // Crossfade is in progress. The secondary element is now the main.
        // Don't call playNext() — we'll handle the transition ourselves.
        return;
      }
      const { repeat } = usePlayerStore.getState();
      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch((err) => {
          console.warn("Autoplay blocked:", err);
        });
      } else {
        playNext();
      }
    };
    const onError = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      const mediaError = audioEl.error;
      const code = mediaError?.code ?? 0;
      if (code === 1) return;
      if (code === 2 && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        console.warn(`[Audio] Network error, retry ${retryCountRef.current}/${MAX_RETRIES}...`);
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.load();
          }
        }, RETRY_DELAY_MS * retryCountRef.current);
        return;
      }
      const errorMsg = mediaError
        ? `Audio error (${mediaError.code}): ${mediaError.message}`
        : "Unknown audio error";
      console.error(errorMsg, mediaError);
      setError(errorMsg);
      setIsPlaying(false);
      loadingRef.current = false;
      setIsLoading(false);
    };
    const onCanPlay = () => {
      loadingRef.current = false;
      setIsLoading(false);
      setError(null);
      retryCountRef.current = 0;
      if (usePlayerStore.getState().isPlaying) {
        audio.play().catch((err) => {
          console.warn("Autoplay blocked:", err);
        });
      }
    };
    const onWaiting = () => {
      setIsLoading(true);
    };
    const onPlaying = () => {
      setIsLoading(false);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.pause();
      audio.src = "";
      audio2.pause();
      audio2.src = "";
      audioRef.current = null;
      audioRef2.current = null;
      disposeAudioGraph();

      if (prebufferTimerRef.current) {
        clearInterval(prebufferTimerRef.current);
      }
    };
  }, [playNext, setCurrentTime, setDuration, setIsPlaying]);

  // Load new track when currentTrack changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      loadedTrackIdRef.current = null;
      return;
    }

    const trackId = currentTrack.id;
    if (loadedTrackIdRef.current === trackId) return;
    loadedTrackIdRef.current = trackId;

    // If a crossfade is in progress, the secondary element already has the
    // new track loaded. Swap active channels and use that.
    const cf = crossfadeStateRef.current;
    if (cf && cf.secondaryTrackId === trackId) {
      const secondary = audioRef2.current;
      if (secondary) {
        // Tear down the old main element (the one that's about to end)
        audio.pause();
        audio.removeAttribute("src");
        streamUrlCache.delete(cf.secondaryTrackId);
        // The secondary element is now the main. The old main becomes
        // the secondary for the next crossfade.
        audioRef.current = secondary;
        audioRef2.current = audio;
        swapActiveChannel();
        crossfadeStateRef.current = null;
        setCurrentTime(0);
        // Reset volume on the new main element
        const ch = getActiveChannel();
        setChannelGain(ch, 1, 0.05);
        // Pre-buffer the next-next track
        prebufferNextTrack();
        return;
      }
    }

    let cancelled = false;

    const loadTrack = async (isRetry = false) => {
      loadingRef.current = true;
      setIsLoading(true);
      setError(null);
      audio.pause();
      audio.removeAttribute("src");

      try {
        const cachedUrl = streamUrlCache.get(currentTrack.id);
        if (cachedUrl) {
          streamUrlCache.delete(currentTrack.id);
          console.log(`[Audio] Loading cached stream for: ${currentTrack.title}`);
          if (cancelled) return;
          audio.src = cachedUrl;
          audio.load();
        } else {
          console.log(`[Audio] Fetching stream URL for: ${currentTrack.title} (${currentTrack.id})`);
          const streamUrl = await getStreamUrl(currentTrack.id);
          if (cancelled) return;
          console.log(`[Audio] Got stream URL (${streamUrl.length} chars), loading...`);
          audio.src = streamUrl;
          audio.load();
        }
      } catch (err) {
        if (cancelled) return;

        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("Failed to load track:", errMsg);

        if (!isRetry && retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          console.log(`Retrying track load (${retryCountRef.current}/${MAX_RETRIES})...`);
          setTimeout(() => {
            if (!cancelled) {
              loadTrack(true);
            }
          }, RETRY_DELAY_MS * retryCountRef.current);
        } else {
          setError(`Failed to load: ${errMsg}`);
          setIsPlaying(false);
          loadingRef.current = false;
          setIsLoading(false);
          retryCountRef.current = 0;
        }
      }
    };

    retryCountRef.current = 0;
    loadTrack();

    prebufferNextTrack();

    return () => {
      if (nextTrackIdRef.current !== trackId) {
        cancelled = true;
        loadedTrackIdRef.current = null;
      }
    };
  }, [currentTrack, setIsPlaying]);

  // Monitor playback progress and pre-buffer next track when past threshold
  useEffect(() => {
    if (prebufferTimerRef.current) {
      clearInterval(prebufferTimerRef.current);
      prebufferTimerRef.current = null;
    }

    if (!currentTrack || !isPlaying) return;

    prebufferTimerRef.current = setInterval(() => {
      const { currentTime, duration } = usePlayerStore.getState();
      if (duration > 0 && currentTime / duration >= PREBUFFER_THRESHOLD) {
        prebufferNextTrack();
      }
    }, 1000);

    return () => {
      if (prebufferTimerRef.current) {
        clearInterval(prebufferTimerRef.current);
      }
    };
  }, [currentTrack, isPlaying]);

  // Sync play/pause state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      if (!loadingRef.current && audio.readyState >= 3) {
        audio.play().catch((err) => {
          console.warn("Autoplay blocked:", err);
        });
      }
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Sync volume
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, [setCurrentTime]);

  const togglePlayPause = useCallback(() => {
    void ensureAudioContextResumed();
    setIsPlaying(!usePlayerStore.getState().isPlaying);
  }, [setIsPlaying]);

  const retry = useCallback(() => {
    setError(null);
    retryCountRef.current = 0;
    const audio = audioRef.current;
    if (audio && currentTrack) {
      audio.load();
    }
  }, [currentTrack]);

  const { setAudioLoading, setAudioError, setRetryAudio } = usePlayerStore();
  useEffect(() => { setAudioLoading(isLoading); }, [isLoading, setAudioLoading]);
  useEffect(() => { setAudioError(error); }, [error, setAudioError]);
  useEffect(() => { setRetryAudio(() => retry); }, [retry, setRetryAudio]);

  useEffect(() => {
    const handleSeekTo = (e: Event) => {
      const time = (e as CustomEvent).detail?.time;
      const audio = audioRef.current;
      if (audio && typeof time === "number" && isFinite(time)) {
        audio.currentTime = time;
        setCurrentTime(time);
      }
    };
    window.addEventListener("seek-to", handleSeekTo);
    return () => window.removeEventListener("seek-to", handleSeekTo);
  }, [setCurrentTime]);

  // ─── Audio settings: equalizer, crossfade, sleep timer ─────────────
  const { equalizerEnabled, equalizerGains, crossfadeSeconds, sleepTimerEndAt, clearSleepTimer } =
    useAudioSettings();

  useEffect(() => {
    const onGesture = () => {
      void ensureAudioContextResumed();
    };
    window.addEventListener("pointerdown", onGesture, { capture: true });
    window.addEventListener("keydown", onGesture, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
    };
  }, []);

  // Lazy graph build: only attach the Web Audio graph when the user enables
  // the EQ. We need TWO audio elements in the graph (one for current track,
  // one for the crossfade target), so we wire both at this point.
  useEffect(() => {
    if (!equalizerEnabled) return;
    const a = audioRef.current;
    const b = audioRef2.current;
    if (!a || !b) return;
    if (isAudioGraphBuilt()) return;
    try {
      initAudioGraph(a);
      initSecondaryAudio(b);
      setEqualizerGains(equalizerGains);
    } catch (err) {
      console.warn("[Audio] Web Audio graph unavailable:", err);
    }
  }, [equalizerEnabled, equalizerGains]);

  useEffect(() => {
    if (!equalizerEnabled) {
      setEqualizerGains([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      return;
    }
    setEqualizerGains(equalizerGains);
  }, [equalizerEnabled, equalizerGains]);

  // Crossfade: when the current track gets within `crossfadeSeconds` of its
  // end, pre-fetch the next track's stream URL, play it on the secondary
  // element at 0 volume, and cross-fade. When the main element ends, the
  // track-change effect detects the crossfade state and swaps the elements.
  useEffect(() => {
    if (!crossfadeSeconds || crossfadeSeconds <= 0) return;
    const audio = audioRef.current;
    if (!audio) return;
    const graph = isAudioGraphBuilt();

    const handler = async () => {
      if (!isFinite(audio.duration)) return;
      const remaining = audio.duration - audio.currentTime;

      // If we're already mid-crossfade, just keep fading the main element.
      const cf = crossfadeStateRef.current;
      if (cf) {
        if (graph) {
          setChannelGain(cf.activeChannel, Math.max(0, Math.min(1, remaining / crossfadeSeconds)), 0.1);
        } else {
          audio.volume = (usePlayerStore.getState().isMuted ? 0 : 1) * Math.max(0, Math.min(1, remaining / crossfadeSeconds));
        }
        return;
      }

      // Enter the crossfade window.
      if (remaining > 0 && remaining <= crossfadeSeconds) {
        // Single-element (no graph) fade-out: just ramp the main volume.
        if (!graph) {
          audio.volume = (usePlayerStore.getState().isMuted ? 0 : 1) * Math.max(0, remaining / crossfadeSeconds);
          return;
        }

        // Graph-based crossfade: start the next track on the secondary element.
        const next = getNextTrack();
        if (!next) {
          // No next track in queue — just fade out the current one.
          setChannelGain(getActiveChannel(), Math.max(0, remaining / crossfadeSeconds), 0.1);
          return;
        }

        const secondaryEl = audioRef2.current;
        if (!secondaryEl) return;

        let url = streamUrlCache.get(next.id);
        if (!url) {
          try {
            url = await getStreamUrl(next.id);
            streamUrlCache.set(next.id, url);
          } catch {
            // Failed to get next URL — fall back to plain fade-out.
            setChannelGain(getActiveChannel(), Math.max(0, remaining / crossfadeSeconds), 0.1);
            return;
          }
        }

        // Start the next track on the secondary element at 0 volume.
        const activeCh = getActiveChannel();
        const secondaryCh: "a" | "b" = activeCh === "a" ? "b" : "a";
        secondaryEl.src = url;
        secondaryEl.volume = 0;
        try {
          await secondaryEl.play();
        } catch {
          // Autoplay blocked — fall back.
          setChannelGain(activeCh, Math.max(0, remaining / crossfadeSeconds), 0.1);
          return;
        }
        setChannelGain(secondaryCh, 1, crossfadeSeconds);
        setChannelGain(activeCh, 0, crossfadeSeconds);

        crossfadeStateRef.current = {
          secondaryEl,
          secondaryUrl: url,
          secondaryTrackId: next.id,
          activeChannel: activeCh,
          startedAt: Date.now(),
          fadingOut: activeCh,
        };
      } else {
        if (graph) setChannelGain(getActiveChannel(), 1, 0.1);
        else audio.volume = usePlayerStore.getState().isMuted ? 0 : 1;
      }
    };
    audio.addEventListener("timeupdate", handler);
    return () => {
      audio.removeEventListener("timeupdate", handler);
      if (graph) {
        setChannelGain(getActiveChannel(), 1, 0.05);
      } else {
        audio.volume = usePlayerStore.getState().isMuted ? 0 : 1;
      }
    };
  }, [crossfadeSeconds, currentTrack?.id]);

  // Sleep timer: fade out + pause when the deadline is reached.
  useEffect(() => {
    if (!sleepTimerEndAt) return;
    const graph = isAudioGraphBuilt();
    const tick = () => {
      if (!sleepTimerEndAt) {
        clearSleepTimer();
        return;
      }
      const remainingMs = sleepTimerEndAt - Date.now();
      const audio = audioRef.current;
      if (!audio) return;

      if (remainingMs <= 0) {
        const fadeOut = graph
          ? (v: number) => setChannelGain(getActiveChannel(), v, 1.0)
          : (v: number) => {
              audio.volume = v * (usePlayerStore.getState().isMuted ? 0 : 1);
            };
        fadeOut(0);
        setTimeout(() => {
          fadeOut(1);
          audio.pause();
          setIsPlaying(false);
          clearSleepTimer();
        }, 3000);
      } else if (remainingMs < 10_000) {
        const v = remainingMs / 10_000;
        if (graph) setChannelGain(getActiveChannel(), v, 0.5);
        else audio.volume = v * (usePlayerStore.getState().isMuted ? 0 : 1);
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepTimerEndAt, clearSleepTimer, setIsPlaying]);

  return { seek, togglePlayPause, audioRef, isLoading, error, retry };
}
