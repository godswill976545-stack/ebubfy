import { useState, useEffect, useCallback } from "react";
import { X, Keyboard } from "lucide-react";
import TitleBar from "./components/layout/TitleBar";
import MiniPlayer from "./components/layout/MiniPlayer";
import Sidebar from "./components/layout/Sidebar";
import BottomNav from "./components/layout/BottomNav";
import QueuePanel from "./components/queue/QueuePanel";
import SearchPage from "./components/search/SearchPage";
import NowPlayingPage from "./pages/NowPlayingPage";
import LibraryPage from "./pages/LibraryPage";
import PlaylistPage from "./pages/PlaylistPage";
import HomePage from "./pages/Home";
import SettingsPage from "./pages/SettingsPage";
import AlbumPage from "./pages/AlbumPage";
import ArtistPage from "./pages/ArtistPage";
import BrowsePage from "./pages/BrowsePage";

import { usePlayerStore } from "./store/playerStore";
import { usePlaylistStore } from "./store/playlistStore";
import { useThemeStore } from "./store/themeStore";
import { useToastStore } from "./store/toastStore";
import { useAudio } from "./hooks/useAudio";
import { useLyricsFetch } from "./hooks/useLyricsFetch";
import { useMediaSession } from "./hooks/useMediaSession";
import useKeyboardShortcuts, { SHORTCUTS } from "./hooks/useKeyboard";
import { addRecentlyPlayed } from "./lib/api";
import type { Page, VideoResult } from "./types";
import "./App.css";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [showQueue, setShowQueue] = useState(false);
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<number | null>(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAlbumPage, setShowAlbumPage] = useState(false);
  const [showArtistPage, setShowArtistPage] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>("");
  const [selectedAlbumName, setSelectedAlbumName] = useState<string>("");
  const [selectedAlbumArtist, setSelectedAlbumArtist] = useState<string>("");
  const [selectedAlbumThumbnail, setSelectedAlbumThumbnail] = useState<string>("");
  const [selectedArtistId, setSelectedArtistId] = useState<string>("");
  const [selectedArtistName, setSelectedArtistName] = useState<string>("");
  const [selectedArtistThumbnail, setSelectedArtistThumbnail] = useState<string>("");
  const { seek } = useAudio();
  useLyricsFetch(); // Pre-fetch lyrics on every track change
  useMediaSession(); // OS media session / lock screen controls
  // Initialize theme from store on mount
  const { theme } = useThemeStore();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ─── One-time onboarding tooltip ───
  const getOnboarded = () => {
    try { return localStorage.getItem("ebubfy-onboarded"); }
    catch { return null; }
  };
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !getOnboarded();
  });

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { localStorage.setItem("ebubfy-onboarded", "true"); }
    catch { /* storage blocked */ }
  }, []);

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!showOnboarding) return;
    const timer = setTimeout(dismissOnboarding, 6000);
    return () => clearTimeout(timer);
  }, [showOnboarding, dismissOnboarding]);

  // Keyboard shortcuts
  const { showHelp, setShowHelp } = useKeyboardShortcuts(
    () => { if (currentTrack) setShowNowPlaying(true); },
    () => { if (showOnboarding) dismissOnboarding(); }
  );
  const toasts = useToastStore((s) => s.toasts);



  // Listen for custom events from keyboard shortcuts
  useEffect(() => {
    const handleQueue = () => setShowQueue((prev) => !prev);
    const handleSearch = () => {
      setCurrentPage("search");
      // Focus the search input after page transition
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(".search-input");
        input?.focus();
      }, 100);
    };
    window.addEventListener("toggle-queue", handleQueue);
    window.addEventListener("focus-search", handleSearch);
    return () => {
      window.removeEventListener("toggle-queue", handleQueue);
      window.removeEventListener("focus-search", handleSearch);
    };
  }, []);

  // Close create-playlist modal with Escape
  useEffect(() => {
    if (!showCreatePlaylist) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCreatePlaylist(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreatePlaylist]);

  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    usePlaylistStore.getState().loadRecentlyPlayed();
  }, []);

  const handlePlayTrack = useCallback(async (track: VideoResult, queue?: VideoResult[]) => {
    // Use playTrack to correctly set queueIndex (setCurrentTrack + setQueue would reset it to 0)
    usePlayerStore.getState().playTrack(track, queue);
    try {
      await addRecentlyPlayed({ videoId: track.id, title: track.title, artist: track.artist, thumbnail: track.thumbnail });
      await usePlaylistStore.getState().loadRecentlyPlayed();
    } catch (err) {
      console.error("Failed to add to recently played:", err);
    }
  }, []);

  const renderPage = () => {
    if (showNowPlaying) {
      return <NowPlayingPage onBack={() => setShowNowPlaying(false)} onSeek={seek} onToggleQueue={() => setShowQueue(true)} />;
    }
    
    if (showAlbumPage && selectedAlbumId) {
      return (
        <AlbumPage
          albumId={selectedAlbumId}
          albumName={selectedAlbumName}
          albumArtist={selectedAlbumArtist}
          albumThumbnail={selectedAlbumThumbnail}
          onBack={() => { setShowAlbumPage(false); setSelectedAlbumId(""); setSelectedAlbumName(""); setSelectedAlbumArtist(""); setSelectedAlbumThumbnail(""); }}
          onPlayTrack={handlePlayTrack}
        />
      );
    }
    
    if (showArtistPage && selectedArtistId) {
      return (
        <ArtistPage
          artistId={selectedArtistId}
          artistName={selectedArtistName}
          artistThumbnail={selectedArtistThumbnail}
          onBack={() => { setShowArtistPage(false); setSelectedArtistId(""); setSelectedArtistName(""); setSelectedArtistThumbnail(""); }}
          onPlayTrack={handlePlayTrack}
        />
      );
    }
    
    switch (currentPage) {
      case "home":
        return <HomePage onPlayTrack={handlePlayTrack} onSearchGenre={(genre) => { setSearchQuery(genre); setCurrentPage("search"); }} onNavigateToSearch={() => setCurrentPage("search")} />;
      case "search":
        return (
          <SearchPage
            onPlayTrack={handlePlayTrack}
            initialQuery={searchQuery}
            onOpenAlbum={handleOpenAlbum}
            onOpenArtist={handleOpenArtist}
          />
        );
      case "browse":
        return (
          <BrowsePage
            onNavigate={(page) => setCurrentPage(page)}
            onSearchGenre={(genre) => { setSearchQuery(genre); setCurrentPage("search"); }}
          />
        );
      case "library":
        return (
          <LibraryPage
            onPlayTrack={handlePlayTrack}
            onSelectPlaylist={(playlist) => {
              setCurrentPlaylistId(playlist.id);
              setCurrentPage("playlist");
            }}
            onCreatePlaylist={() => setShowCreatePlaylist(true)}
            onOpenLikedPlaylist={() => {
              setCurrentPlaylistId(-1);
              setCurrentPage("playlist");
            }}
          />
        );
      case "playlist":
        if (currentPlaylistId === null) return <LibraryPage onPlayTrack={handlePlayTrack} onSelectPlaylist={() => {}} onCreatePlaylist={() => {}} />;
        return (
          <PlaylistPage
            playlistId={currentPlaylistId}
            onBack={() => setCurrentPage("library")}
            onPlayTrack={handlePlayTrack}
          />
        );
      case "settings":
        return <SettingsPage />;

      default:
        return <HomePage onPlayTrack={handlePlayTrack} onNavigateToSearch={() => setCurrentPage("search")} />;
    }
  };

  const handleNavigate = (page: Page) => {
    setShowNowPlaying(false);
    setShowAlbumPage(false);
    setShowArtistPage(false);
    setCurrentPage(page);
  };

  const handleOpenAlbum = (albumId: string, albumName?: string, albumArtist?: string, albumThumbnail?: string) => {
    setShowNowPlaying(false);
    setShowAlbumPage(true);
    setSelectedAlbumId(albumId);
    setSelectedAlbumName(albumName || "");
    setSelectedAlbumArtist(albumArtist || "");
    setSelectedAlbumThumbnail(albumThumbnail || "");
  };

  const handleOpenArtist = (artistId: string, artistName?: string, artistThumbnail?: string) => {
    setShowNowPlaying(false);
    setShowArtistPage(true);
    setSelectedArtistId(artistId);
    setSelectedArtistName(artistName || "");
    setSelectedArtistThumbnail(artistThumbnail || "");
  };

  return (
    <div className="app">
      <TitleBar />
      <div className="main-layout">
        <aside className="sidebar-container">
          <Sidebar currentPage={currentPage} onNavigate={handleNavigate} />
        </aside>
        <main className="main-content">
          <div className="page-transition">
            {renderPage()}
          </div>
        </main>
        <QueuePanel isOpen={showQueue} onClose={() => setShowQueue(false)} />
      </div>
      {currentTrack && !showNowPlaying && (
        <MiniPlayer onOpenNowPlaying={() => setShowNowPlaying(true)} onToggleQueue={() => setShowQueue(true)} />
      )}
      {!showNowPlaying && (
        <BottomNav currentPage={currentPage} onNavigate={handleNavigate} />
      )}
      {showCreatePlaylist && (
        <div className="modal-overlay" onClick={() => setShowCreatePlaylist(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Create Playlist</div>
            <input
              className="modal-input"
              placeholder="Playlist name"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPlaylistName.trim()) {
                  usePlaylistStore.getState().createPlaylist(newPlaylistName.trim());
                  setNewPlaylistName("");
                  setShowCreatePlaylist(false);
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreatePlaylist(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (newPlaylistName.trim()) {
                    usePlaylistStore.getState().createPlaylist(newPlaylistName.trim());
                    setNewPlaylistName("");
                    setShowCreatePlaylist(false);
                  }
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Shortcut Help Overlay ─── */}
      {showHelp && (
        <div className="shortcut-overlay" onClick={() => setShowHelp(false)}>
          <div className="shortcut-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-modal-header">
              <Keyboard size={18} />
              <span>Keyboard Shortcuts</span>
              <button className="shortcut-close" onClick={() => setShowHelp(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="shortcut-grid">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="shortcut-row">
                  <span className="shortcut-label">{s.label}</span>
                  <span className="shortcut-desc">{s.description}</span>
                  <span className="shortcut-keys">
                    {s.keys.map((k) => (
                      <kbd key={k} className="shortcut-kbd">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Onboarding Tooltip ─── */}
      {showOnboarding && (
        <div className="onboarding-tip" onClick={dismissOnboarding}>
          <div className="onboarding-tip-inner">
            <Keyboard size={14} />
            <span>Press <kbd className="shortcut-kbd">Shift+/</kbd> for keyboard shortcuts</span>
          </div>
        </div>
      )}

      {/* ─── Shortcut Toast Notifications ─── */}
      {toasts.length > 0 && (
        <div className="shortcut-toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="shortcut-toast">{t.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
