import { Play, Pause, RefreshCw, SkipBack, SkipForward, ChevronUp, List } from "lucide-react";
import { useRef } from "react";
import { usePlayerStore } from "../../store/playerStore";
import { formatTime } from "../../lib/utils";
import LazyImage from "../ui/LazyImage";

interface MiniPlayerProps {
  onOpenNowPlaying?: () => void;
  onToggleQueue?: () => void;
}

export default function MiniPlayer({ onOpenNowPlaying, onToggleQueue }: MiniPlayerProps) {
  const {
    currentTrack, isPlaying, currentTime, duration,
    setIsPlaying, playNext, playPrevious,
    audioLoading, audioError, retryAudio,
  } = usePlayerStore();
  const progressRef = useRef<HTMLDivElement>(null);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    window.dispatchEvent(new CustomEvent("seek-to", { detail: { time: pct * duration } }));
  };

  return (
    <div
      className="mini-player"
      onClick={onOpenNowPlaying}
    >
      {/* Progress bar at top */}
      <div className="mini-progress" ref={progressRef} onClick={handleProgressClick}>
        <div className="mini-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Content */}
      <div className="mini-player-inner">
        {/* Thumbnail */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <LazyImage
            className="mini-player-thumb"
            src={currentTrack.thumbnail}
            alt={currentTrack.title}
            fallback={`https://img.youtube.com/vi/${currentTrack.id}/default.jpg`}
          />
        </div>

        {/* Track Info */}
        <div className="mini-player-info">
          <div className="mini-player-title">{currentTrack.title}</div>
          <div className="mini-player-artist">{currentTrack.artist}</div>
        </div>

        {/* Controls */}
        <div className="mini-player-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="mini-skip-btn"
            onClick={() => playPrevious()}
            aria-label="Previous track"
            title="Previous track"
          >
            <SkipBack size={16} />
          </button>

          <button
            className="mini-play-btn"
            onClick={() => {
              if (audioError) {
                retryAudio();
              } else {
                setIsPlaying(!isPlaying);
              }
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {audioError ? (
              <RefreshCw size={16} />
            ) : audioLoading ? (
              <div className="mini-spinner" />
            ) : isPlaying ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" style={{ marginLeft: 1 }} />
            )}
          </button>

          <button
            className="mini-skip-btn"
            onClick={() => playNext()}
            aria-label="Next track"
            title="Next track"
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Time */}
        <span className="mini-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Queue */}
        <button
          className="mini-skip-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggleQueue?.();
          }}
          aria-label="Toggle queue"
          title="Queue (Q)"
        >
          <List size={16} />
        </button>

        {/* Expand */}
        <button
          className="mini-expand-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenNowPlaying?.();
          }}
          aria-label="Open now playing"
        >
          <ChevronUp size={18} />
        </button>
      </div>
    </div>
  );
}
