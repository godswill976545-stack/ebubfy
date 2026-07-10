import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";

/**
 * Integrate with the OS media session (lock-screen / keyboard media keys).
 */
export function useMediaSession() {
  const { currentTrack, isPlaying, playNext, playPrevious, setIsPlaying } = usePlayerStore();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    const mediaSession = navigator.mediaSession;

    mediaSession.setActionHandler("play", () => setIsPlaying(true));
    mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    mediaSession.setActionHandler("previoustrack", () => playPrevious());
    mediaSession.setActionHandler("nexttrack", () => playNext());

    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
      mediaSession.setActionHandler("previoustrack", null);
      mediaSession.setActionHandler("nexttrack", null);
    };
  }, [setIsPlaying, playNext, playPrevious]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    const mediaSession = navigator.mediaSession;

    if (currentTrack) {
      mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || "Unknown Artist",
        album: currentTrack.album || "",
        artwork: currentTrack.thumbnail
          ? [
              { src: currentTrack.thumbnail, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
      mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } else {
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
    }
  }, [currentTrack, isPlaying]);
}
