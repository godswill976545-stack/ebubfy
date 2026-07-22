import { useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Mic, Info } from "lucide-react";
import { usePlayerStore } from "../../store/playerStore";
import { useLanguageStore } from "../../store/languageStore";
import type { LyricLine } from "../../store/playerStore";

/**
 * LyricsPanel -- overlay on the NowPlayingPage that displays
 * lyrics pre-fetched by useLyricsFetch hook in App.tsx.
 *
 * Features:
 * - Auto-scrolls to the active line as the song plays.
 * - Click a line to seek to that time.
 * - Gradient masks at top/bottom for a polished feel.
 * - Shows lyrics provider info like Spotify
 */
export default memo(function LyricsPanel() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const showLyrics = usePlayerStore((s) => s.showLyrics);
  const lyricsLines = usePlayerStore((s) => s.lyricsLines);
  const lyricsLoading = usePlayerStore((s) => s.lyricsLoading);
  const activeLyricLine = usePlayerStore((s) => s.activeLyricLine);
  const lyricsResult = usePlayerStore((s) => s.lyricsResult);
  const setActiveLyricLine = usePlayerStore((s) => s.setActiveLyricLine);
  const setShowLyrics = usePlayerStore((s) => s.setShowLyrics);
  const { translations: t } = useLanguageStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Find active lyric line ────────────────────────────────
  useEffect(() => {
    if (lyricsLines.length === 0) {
      setActiveLyricLine(-1);
      return;
    }
    let idx = -1;
    for (let i = lyricsLines.length - 1; i >= 0; i--) {
      if (currentTime >= lyricsLines[i].time) {
        idx = i;
        break;
      }
    }
    if (idx !== activeLyricLine) {
      setActiveLyricLine(idx);
    }
  }, [currentTime, lyricsLines, activeLyricLine, setActiveLyricLine]);

  // ─── Auto-scroll to active line ────────────────────────────
  useEffect(() => {
    if (userScrollingRef.current) return;
    if (activeLyricLine < 0) return;
    const el = lineRefs.current.get(activeLyricLine);
    if (el && containerRef.current) {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;
      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: "smooth",
      });
    }
  }, [activeLyricLine]);

  // ─── Detect user scrolling (pause auto-scroll for 5s) ──────
  const handleScroll = useCallback(() => {
    userScrollingRef.current = true;
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 5000);
  }, []);

  // ─── Seek when clicking a line ────────────────────────────
  const handleLineClick = useCallback(
    (line: LyricLine) => {
      window.dispatchEvent(
        new CustomEvent("seek-to", { detail: { time: line.time } })
      );
    },
    []
  );

  // ─── Close ─────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    setShowLyrics(false);
  }, [setShowLyrics]);

  // ─── Render ────────────────────────────────────────────────
  if (!showLyrics || !currentTrack) return null;

  const isActive = (i: number) => i === activeLyricLine;
  const isPast = (i: number) => activeLyricLine >= 0 && i < activeLyricLine;

  // Determine lyrics source for display
  const getLyricsSource = () => {
    if (!lyricsResult) return "";

    const provider = lyricsResult.provider || lyricsResult.source;

    const providerMap: Record<string, string> = {
      lrclib: "LRCLIB",
      netease: "NetEase Music",
      musixmatch: "Musixmatch",
      genius: "Genius",
      cached: "Saved locally",
      youtube_captions: "YouTube Captions",
    };

    return providerMap[provider] || provider;
  };

  // Display synced vs plain lyrics indication
  const isSynced = Boolean(lyricsResult?.is_synced);

  return (
    <div className="lyrics-overlay" onClick={handleClose}>
      <div className="lyrics-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lyrics-header">
          <div className="lyrics-header-icon">
            <Mic size={18} />
          </div>
          <div className="lyrics-header-info">
            <span className="lyrics-header-title">{currentTrack.title}</span>
            <span className="lyrics-header-artist">{currentTrack.artist}</span>
          </div>
          <button className="lyrics-close" onClick={handleClose} aria-label="Close lyrics">
            ✕
          </button>
        </div>

        {/* Scrollable lyrics body */}
        <div className="lyrics-body" ref={containerRef} onScroll={handleScroll}>
          <div className="lyrics-fade-top" />

          {lyricsLoading ? (
            <div className="lyrics-empty">
              <div className="lyrics-spinner" />
              <span>{t.common.loading}</span>
            </div>
          ) : lyricsLines.length === 0 ? (
            <div className="lyrics-empty">
              <Mic size={32} strokeWidth={1.5} />
              <span>{t.nowPlaying.noLyrics || "No lyrics found"}</span>
            </div>
          ) : (
            <div className="lyrics-lines">
              {lyricsLines.map((line, i) => (
                <div
                  key={i}
                  ref={(el) => { if (el) lineRefs.current.set(i, el); }}
                  className={`lyrics-line ${isActive(i) ? "lyrics-line-active" : ""} ${isPast(i) ? "lyrics-line-past" : ""}`}
                  onClick={() => handleLineClick(line)}
                >
                  {line.text}
                </div>
              ))}
              {/* Spacer so last line can scroll to center */}
              <div style={{ height: "40vh" }} />
            </div>
          )}

          {/* Lyrics source and type info - like Spotify's "Lyrics provided by..." */}
          {lyricsResult && lyricsLines.length > 0 && (
            <div className="lyrics-source-info">
              {isSynced ? "Synced" : "Plain"} lyrics · {getLyricsSource()}
            </div>
          )}

          {/* Plain lyrics notice */}
          {!lyricsLoading && lyricsResult && lyricsLines.length > 0 && !isSynced && (
            <div className="lyrics-plain-notice">
              <Info size={12} />
              <span>These lyrics aren't synced to the music.</span>
            </div>
          )}

          <div className="lyrics-fade-bottom" />
        </div>
      </div>
    </div>
  );
});
