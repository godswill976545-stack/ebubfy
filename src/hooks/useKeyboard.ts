import { useEffect, useState, useCallback } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useToastStore } from "../store/toastStore";

export type ShortcutAction = {
  label: string;
  keys: string[];
  description: string;
};

export const SHORTCUTS: ShortcutAction[] = [
  { label: "Play/Pause", keys: ["Space"], description: "Toggle playback" },
  { label: "Next Track", keys: ["L", "Shift+→"], description: "Skip to next song in queue" },
  { label: "Previous Track", keys: ["J", "Shift+←"], description: "Go back to previous song" },
  { label: "Seek Forward", keys: ["→"], description: "Skip ahead 5 seconds" },
  { label: "Seek Backward", keys: ["←"], description: "Go back 5 seconds" },
  { label: "Volume Up", keys: ["↑"], description: "Increase volume by 5%" },
  { label: "Volume Down", keys: ["↓"], description: "Decrease volume by 5%" },
  { label: "Mute", keys: ["M"], description: "Toggle mute" },
  { label: "Now Playing", keys: ["K", "Enter"], description: "Open full Now Playing screen" },
  { label: "Queue", keys: ["Q"], description: "Toggle queue panel" },
  { label: "Search", keys: ["S", "Ctrl+F"], description: "Focus search bar" },
  { label: "Help", keys: ["?", "Shift+/"], description: "Show this help overlay" },
];

// ─── Hook ────────────────────────────────────────────────

export default function useKeyboardShortcuts(
  onOpenNowPlaying?: () => void,
  onToggleHelp?: () => void
) {
  const {
    isPlaying, setIsPlaying, playNext, playPrevious,
    setVolume, isMuted, setIsMuted,
    setCurrentTime,
  } = usePlayerStore();

  const [showHelp, setShowHelp] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => {
      const next = !prev;
      if (next) onToggleHelp?.();
      return next;
    });
  }, [onToggleHelp]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        // Allow Escape to blur inputs
        if (e.code === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      const code = e.code;
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;

      switch (code) {
        // ─── Play/Pause ────────────────────────────
        case "Space":
          e.preventDefault();
          setIsPlaying(!isPlaying);
          addToast(isPlaying ? "Paused" : "Playing");
          break;

        // ─── Next / Previous (J/K/L) ───────────────
        case "KeyL":
          if (!shift) {
            e.preventDefault();
            playNext();
            addToast("Next track");
          }
          break;

        case "KeyJ":
          if (!shift) {
            e.preventDefault();
            playPrevious();
            addToast("Previous track");
          }
          break;

        case "KeyK":
          // Open Now Playing
          if (!ctrl) {
            e.preventDefault();
            onOpenNowPlaying?.();
            addToast("Now Playing");
          }
          break;

        // ─── Seek (Arrows) ─────────────────────────
        case "ArrowRight":
          e.preventDefault();
          if (shift) {
            playNext();
            addToast("Next track");
          } else {
            const { currentTime, duration } = usePlayerStore.getState();
            const newTime = Math.min(duration || 0, currentTime + 5);
            setCurrentTime(newTime);
            window.dispatchEvent(
              new CustomEvent("seek-to", { detail: { time: newTime } })
            );
            addToast("+5s");
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (shift) {
            playPrevious();
            addToast("Previous track");
          } else {
            const { currentTime } = usePlayerStore.getState();
            const newTime = Math.max(0, currentTime - 5);
            setCurrentTime(newTime);
            window.dispatchEvent(
              new CustomEvent("seek-to", { detail: { time: newTime } })
            );
            addToast("-5s");
          }
          break;

        // ─── Volume (Arrows) ────────────────────────
        case "ArrowUp":
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.min(1, prev + 0.05);
            addToast(`Volume ${Math.round(next * 100)}%`);
            return next;
          });
          break;

        case "ArrowDown":
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, prev - 0.05);
            addToast(`Volume ${Math.round(next * 100)}%`);
            return next;
          });
          break;

        // ─── Mute (M) ──────────────────────────────
        case "KeyM":
          setIsMuted(!isMuted);
          addToast(isMuted ? "Unmuted" : "Muted");
          break;

        // ─── Queue (Q) ─────────────────────────────
        case "KeyQ":
          // Dispatch custom event so App.tsx can listen
          window.dispatchEvent(new CustomEvent("toggle-queue"));
          addToast("Queue");
          break;

        // ─── Search (S) ────────────────────────────
        case "KeyS":
          if (!ctrl) {
            // Dispatch custom event to focus search
            window.dispatchEvent(new CustomEvent("focus-search"));
            addToast("Search");
          }
          break;

        // ─── Help (?) ──────────────────────────────
        case "Slash":
          if (shift) {
            e.preventDefault();
            toggleHelp();
          }
          break;

        case "Escape":
          if (showHelp) {
            setShowHelp(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isPlaying, isMuted, showHelp,
    playNext, playPrevious, setIsPlaying, setVolume, setIsMuted, setCurrentTime,
    onOpenNowPlaying, addToast, toggleHelp,
  ]);

  return { showHelp, setShowHelp, addToast };
}
