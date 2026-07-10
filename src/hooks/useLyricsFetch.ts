import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import {
  searchLyrics,
  saveLyricsFile,
  loadLyricsFile,
  getVideoCaptions,
} from "../lib/api";
import type { LyricsResult } from "../lib/api";
import type { LyricLine } from "../store/playerStore";

/**
 * Parse LRC format synced lyrics into structured LyricLine[].
 * Supports [MM:SS], [MM:SS.xx] (centiseconds), and [MM:SS.xxx] (ms),
 * as well as lines with multiple timestamps like [00:12.34][00:15.00]text.
 */
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  // Matches [mm:ss] or [mm:ss.xxx] — also tolerates extra whitespace.
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;

  for (const raw of lrc.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const timeMatches = [...trimmed.matchAll(timeRegex)];
    if (timeMatches.length === 0) continue;

    // Remove all timestamps, keep the text.
    const text = trimmed.replace(timeRegex, "").trim();
    if (!text) continue;

    for (const match of timeMatches) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const frac = match[3];
      let time = min * 60 + sec;
      if (frac) {
        // Scale by the number of fractional digits.
        // 1 digit → tenths, 2 → hundredths, 3 → milliseconds, etc.
        const denominator = Math.pow(10, frac.length);
        time += parseInt(frac, 10) / denominator;
      }
      lines.push({ time, text });
    }
  }

  // Sort and de-duplicate by time.
  const seen = new Set<number>();
  return lines
    .filter((line) => {
      if (seen.has(line.time)) return false;
      seen.add(line.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

/** Strip LRC timestamps from a string, leaving just the text. */
function stripLrcTimestamps(lrc: string): string {
  return lrc
    .replace(/\[\d+:\d+(?:\.\d+)?\]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * Rehydrate a cached lyrics file into a LyricsResult.
 * Detects LRC by scanning *any* line for a timestamp tag (not just the
 * first line — some cached files have metadata headers like [ar:...]).
 */
function parseCachedLyrics(content: string): LyricsResult | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const hasLrcTimestamps = /\[\d+:\d+(?:\.\d+)?\]/.test(trimmed);
  if (hasLrcTimestamps) {
    return {
      body: stripLrcTimestamps(trimmed),
      synced_lyrics: trimmed,
      source: "cached",
      provider: "cached",
      is_synced: true,
      confidence: 1,
    };
  }

  return {
    body: trimmed,
    source: "cached",
    provider: "cached",
    is_synced: false,
    confidence: 1,
  };
}

/**
 * Distribute plain-text lyrics evenly across the track duration.
 * Strips any stray LRC timestamps first so we don't show "[00:12.34]text".
 */
function distributeLyrics(body: string, duration: number): LyricLine[] {
  const cleaned = stripLrcTimestamps(body);
  const rawLines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  const dur = duration > 0 ? duration : 240; // fallback 4 min
  const gap = dur / (rawLines.length + 1);

  return rawLines.map((text, i) => ({
    time: gap * (i + 1),
    text: text.trim(),
  }));
}

/**
 * useLyricsFetch -- always-active hook that pre-fetches lyrics
 * whenever the current track changes. Runs regardless of whether
 * the lyrics panel is open, so lyrics are ready instantly on toggle.
 */
export function useLyricsFetch() {
  const { currentTrack, duration, setLyricsLines, setLyricsResult, setLyricsLoading } =
    usePlayerStore();
  const fetchedTrackRef = useRef<string | null>(null);

  // ─── Fetch lyrics IMMEDIATELY on track change ──────────────
  useEffect(() => {
    if (!currentTrack) {
      fetchedTrackRef.current = null;
      setLyricsLines([]);
      setLyricsResult(null);
      return;
    }

    // Skip if already fetched for this track
    if (fetchedTrackRef.current === currentTrack.id) return;
    fetchedTrackRef.current = currentTrack.id;

    // Clear stale lyrics from the previous track immediately so the
    // re-distribute effect (below) can't redistribute them with the
    // new track's duration while we're fetching.
    setLyricsLines([]);
    setLyricsResult(null);

    let cancelled = false;
    const trackId = currentTrack.id;

    const applyResult = (result: LyricsResult | null) => {
      // Guard: if the user has already moved on to another track, ignore.
      if (usePlayerStore.getState().currentTrack?.id !== trackId) return;

      if (!result) {
        setLyricsLines([]);
        setLyricsResult(null);
        return;
      }

      // Stamp the track ID so the re-distribute effect can verify these
      // lyrics belong to the currently-playing track.
      setLyricsResult({ ...result, track_id: trackId });

      let lines: LyricLine[];
      if (result.synced_lyrics) {
        lines = parseLrc(result.synced_lyrics);
        if (lines.length === 0) {
          // parseLrc failed — strip timestamps from the body and distribute
          // evenly so the user still sees *something* readable.
          console.warn(
            `[Lyrics] parseLrc returned 0 lines for "${currentTrack.title}" — falling back to distributed display. First 200 chars: ${result.synced_lyrics.slice(0, 200)}`
          );
          const dur = duration > 0 ? duration : 240;
          lines = distributeLyrics(result.body || result.synced_lyrics, dur);
        }
      } else if (result.body) {
        const dur = duration > 0 ? duration : 240;
        lines = distributeLyrics(result.body, dur);
      } else {
        lines = [];
      }

      console.log(
        `[Lyrics] Applied ${lines.length} lines for: ${currentTrack.title} (synced=${result.is_synced})`
      );
      setLyricsLines(lines);
    };

    const fetchLyrics = async () => {
      setLyricsLoading(true);

      try {
        // 1. Try cached lyrics file first (instant, works offline)
        const cached = await loadLyricsFile(trackId);
        if (cached && !cancelled) {
          const parsed = parseCachedLyrics(cached);
          if (parsed) {
            applyResult(parsed);
            return;
          }
        }

        // 2. Build a clean query for the API
        let query: string;
        if (
          currentTrack.artist &&
          currentTrack.artist !== "Unknown Artist" &&
          !currentTrack.title.toLowerCase().startsWith(currentTrack.artist.toLowerCase())
        ) {
          query = `${currentTrack.artist} - ${currentTrack.title}`;
        } else {
          query = currentTrack.title;
        }

        const trackDuration = currentTrack.duration_seconds || duration || undefined;
        const result = await searchLyrics(query, trackDuration);
        if (cancelled) return;

        if (result && result.synced_lyrics) {
          applyResult(result);
          // Persist to disk so lyrics load instantly next time.
          saveLyricsFile(trackId, result.synced_lyrics).catch(() => {});
          return;
        }

        // 3. Fallback: YouTube auto-captions are synced to the audio.
        try {
          const captions = await getVideoCaptions(trackId, "en");
          if (!cancelled && captions && captions.length > 0) {
            const captionLrc = captions
              .map((line) => {
                const min = Math.floor(line.time / 60);
                const sec = Math.floor(line.time % 60);
                const cs = Math.round((line.time % 1) * 100);
                const stamp = `[${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
                return `${stamp}${line.text}`;
              })
              .join("\n");

            const captionResult: LyricsResult = {
              body: captionLrc,
              synced_lyrics: captionLrc,
              source: "youtube_captions",
              provider: "youtube_captions",
              is_synced: true,
              confidence: 0.8,
            };
            applyResult(captionResult);
            saveLyricsFile(trackId, captionLrc).catch(() => {});
            return;
          }
        } catch (captionErr) {
          console.log("[Lyrics] YouTube captions unavailable:", captionErr);
        }

        if (result) {
          // Plain lyrics from lyrics.ovh / LRCLIB: use them, but they won't sync.
          applyResult(result);
          const lrcContent = result.body || "";
          if (lrcContent) {
            saveLyricsFile(trackId, lrcContent).catch(() => {});
          }
        } else {
          setLyricsLines([]);
          setLyricsResult(null);
        }
      } catch (e) {
        console.error("[Lyrics] Failed to fetch lyrics:", e);
        if (!cancelled) {
          setLyricsLines([]);
          setLyricsResult(null);
        }
      } finally {
        // Always clear the loading spinner, regardless of which path
        // (cached, LRCLIB, YouTube captions, plain, none) we took.
        if (!cancelled) setLyricsLoading(false);
      }
    };

    fetchLyrics();

    return () => {
      // Only cancel the fetch if the *track* actually changed. The effect
      // also re-runs when `duration` changes (audio loaded), and we don't
      // want to cancel a successful fetch just because duration updated.
      if (usePlayerStore.getState().currentTrack?.id !== currentTrack.id) {
        cancelled = true;
      }
    };
  }, [currentTrack, duration, setLyricsLines, setLyricsLoading, setLyricsResult]);

  // ─── Re-distribute plain-text lyrics when duration becomes available
  //     (synced lyrics already have correct timestamps, so skip them).
  //     Only re-distributes if the current lyrics are for the current
  //     track and are plain (no synced_lyrics). ──────────────
  useEffect(() => {
    if (!currentTrack || duration <= 0) return;

    const { lyricsResult } = usePlayerStore.getState();
    if (!lyricsResult) return;

    // Only redistribute if lyrics are plain text — synced lyrics are
    // already correctly timestamped.
    if (lyricsResult.synced_lyrics) return;

    // Only redistribute if these lyrics are for the current track.
    // Without this check, a stale plain-lyrics result from the previous
    // track gets redistributed with the new track's duration.
    const state = usePlayerStore.getState();
    const activeTrackId = state.currentTrack?.id;
    const cachedTrackId = (lyricsResult as { track_id?: string }).track_id;
    if (cachedTrackId && activeTrackId && cachedTrackId !== activeTrackId) return;

    if (lyricsResult.body) {
      const redistributed = distributeLyrics(lyricsResult.body, duration);
      setLyricsLines(redistributed);
    }
  }, [currentTrack, duration, setLyricsLines]);
}
