import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search as SearchIcon,
  X,
  ListPlus,
  Play,
  Music,
  Clock,
  Trash2,
  History,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  searchYouTubeEnriched,
  getSearchHistory,
  removeHistoryEntry,
  clearSearchHistory,
  suggestQueries,
  cacheSearchResults,
} from "../../lib/api";
import { usePlaylistStore } from "../../store/playlistStore";
import { useLanguageStore } from "../../store/languageStore";
import { useToastStore } from "../../store/toastStore";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { VideoResult } from "../../types";
import type { HistoryEntry } from "../../lib/api";

interface SearchPageProps {
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
  initialQuery?: string;
  onOpenAlbum?: (albumId: string, albumName?: string, albumArtist?: string, albumThumbnail?: string) => void;
  onOpenArtist?: (artistId: string, artistName?: string, artistThumbnail?: string) => void;
}

interface ArtistGroup {
  name: string;
  thumbnail: string;
  tracks: VideoResult[];
}

interface AlbumGroup {
  name: string;
  artist: string;
  year: number | null;
  thumbnail: string;
  tracks: VideoResult[];
}

interface SearchEnrichedPatch {
  key: string;
  artist: string;
  title: string;
  album?: string;
  year?: number;
  album_cover_small?: string;
  album_cover_medium?: string;
  album_cover_large?: string;
  label?: string;
  genre?: string;
}

interface VideoResultWithArtistThumb extends VideoResult {
  artist_thumbnail?: string;
}

interface SearchEnrichedEvent {
  query: string;
  patches: SearchEnrichedPatch[];
}

// ─── Image fallback helper ────────────────────────────────────────────────

function imgOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).src =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect fill='%2316161e' width='200' height='200'/%3E%3Ccircle fill='%2330303e' cx='100' cy='100' r='40'/%3E%3C/svg%3E";
}

interface TopResult {
  type: "song" | "album" | "artist";
  name: string;
  thumbnail: string;
  tracks: VideoResult[];
}

function TopResultCard({
  result,
  onPlayTrack,
  onOpenAlbum,
  onOpenArtist,
}: {
  result: TopResult;
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
  onOpenAlbum?: (albumId: string, albumName?: string, albumArtist?: string, albumThumbnail?: string) => void;
  onOpenArtist?: (artistId: string, artistName?: string, artistThumbnail?: string) => void;
}) {
  const handlePlay = () => {
    if (result.tracks.length > 0) {
      onPlayTrack(result.tracks[0], result.tracks);
    }
  };

  const handleOpen = () => {
    if (result.type === "artist") {
      onOpenArtist?.(
        result.name.toLowerCase().replace(/\s+/g, "-"),
        result.name,
        result.thumbnail
      );
    } else if (result.type === "album") {
      onOpenAlbum?.(
        result.name.toLowerCase().replace(/\s+/g, "-"),
        result.name,
        result.tracks[0]?.artist,
        result.thumbnail
      );
    } else {
      handlePlay();
    }
  };

  const meta =
    result.type === "song"
      ? result.tracks[0]?.artist || "Song"
      : result.type === "album"
      ? `${result.tracks[0]?.artist || "Unknown Artist"} · ${result.tracks.length} ${result.tracks.length === 1 ? "song" : "songs"}`
      : `${result.tracks.length} ${result.tracks.length === 1 ? "song" : "songs"}`;

  return (
    <div className="top-result-card-v2" onClick={handleOpen}>
      <div
        className="top-result-bg"
        style={{
          backgroundImage: `url(${result.thumbnail})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="top-result-bg-overlay" />

      <div className="top-result-content">
        <div className="top-result-badge">Top result</div>
        <div
          className="top-result-img-wrapper"
          onClick={(e) => {
            e.stopPropagation();
            handleOpen();
          }}
        >
          <img
            className="top-result-img-v2"
            src={result.thumbnail}
            alt={result.name}
            onError={imgOnError}
          />
        </div>
        <div className="top-result-info-v2">
          <div className="top-result-name-v2">{result.name}</div>
          <div className="top-result-meta-v2">
            <span className="top-result-type">
              {result.type === "song" ? "Song" : result.type === "album" ? "Album" : "Artist"}
            </span>
            <span className="top-result-dot">·</span>
            {meta}
          </div>
        </div>
        <button
          className="top-result-play-v2"
          onClick={(e) => {
            e.stopPropagation();
            handlePlay();
          }}
          aria-label="Play"
        >
          <Play size={22} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}

// ─── Playlist Dropdown (with click-outside) ───────────────────────────────

interface PlaylistDropdownProps {
  track: VideoResult;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function PlaylistDropdown({ track, isOpen, onToggle, onClose }: PlaylistDropdownProps) {
  const { playlists, addToPlaylist } = usePlaylistStore();
  const addToast = useToastStore((s) => s.addToast);
  const ref = useClickOutside<HTMLDivElement>(onClose, isOpen);

  const handleAdd = async (playlistId: number) => {
    try {
      const playlist = playlists.find((p) => p.id === playlistId);
      await addToPlaylist(playlistId, {
        id: 0,
        playlist_id: playlistId,
        video_id: track.id,
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        position: 0,
      });
      addToast(`Added to ${playlist?.name || "playlist"}`);
    } catch {
      addToast("Failed to add to playlist");
    }
    onClose();
  };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="track-more search-track-more"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="Add to playlist"
      >
        <ListPlus size={16} />
      </button>
      {isOpen && (
        <div className="playlist-dropdown" onClick={(e) => e.stopPropagation()}>
          {playlists.length === 0 ? (
            <div className="playlist-dropdown-empty">No playlists yet</div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                className="playlist-dropdown-item"
                onClick={() => handleAdd(pl.id)}
              >
                {pl.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton component ──────────────────────────────────────────────────

function SearchSkeleton() {
  return (
    <div className="animate-fade-in" style={{ padding: "8px 0" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "var(--text-muted)",
        fontSize: 14,
        marginBottom: 16,
      }}>
        <Clock size={16} />
        <span>Searching YouTube... (this can take a few seconds)</span>
      </div>
      <div className="skeleton search-skeleton-top" />
      <div className="search-results-grid">
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton search-skeleton-track" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton search-skeleton-track" style={{ animationDelay: `${i * 60 + 30}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

export default function SearchPage({ onPlayTrack, initialQuery, onOpenAlbum, onOpenArtist }: SearchPageProps) {
  useLanguageStore();
  const [query, setQuery] = useState(initialQuery || "");
  const [songs, setSongs] = useState<VideoResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { loadPlaylists } = usePlaylistStore();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Track current search to avoid stale enrichment events
  const activeQueryRef = useRef("");
  const initialSearchDoneRef = useRef(false);
  const searchAbortRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History + suggestions (powered by SQLite FTS5 on the backend).
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Load history on mount and after each completed search.
  const refreshHistory = useCallback(async () => {
    try {
      const entries = await getSearchHistory();
      setHistory(entries);
    } catch (err) {
      console.warn("[search] Failed to load history:", err);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Live autocomplete: debounce-suggest against cached queries.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await suggestQueries(q);
        // Filter out the current query itself.
        setSuggestions(results.filter((s) => s.toLowerCase() !== q.toLowerCase()).slice(0, 6));
      } catch {
        // ignore
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  const handleClearHistory = useCallback(async () => {
    try {
      await clearSearchHistory();
      setHistory([]);
    } catch (err) {
      console.warn("[search] Failed to clear history:", err);
    }
  }, []);

  const handleRemoveHistory = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeHistoryEntry(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      console.warn("[search] Failed to remove history entry:", err);
    }
  }, []);

  const handlePickHistory = useCallback((q: string) => {
    setQuery(q);
    setShowHistory(false);
    runSearch(q);
  }, []);

  // ─── Listen for Deezer enrichment events ────────────────────────────

  useEffect(() => {
    // Deezer batch enrichment — patches songs with album, year, hi-res cover,
    // label, and genre. Replaces the old YouTube-thumbnail with the real
    // album art when available.
    const unlistenEnr = listen<SearchEnrichedEvent>("search-enriched", (event) => {
      const { query: eventQuery, patches } = event.payload;
      if (eventQuery !== activeQueryRef.current) return;
      if (!patches || patches.length === 0) return;

      setSongs((prev) =>
        prev.map((song) => {
          const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
          const patch = patches.find((p) => p.key === key);
          if (!patch) return song;
          // Prefer the high-res Deezer cover; fall back through sizes.
          const hiRes =
            patch.album_cover_large ||
            patch.album_cover_medium ||
            patch.album_cover_small;
          return {
            ...song,
            album: song.album || patch.album || undefined,
            release_year: song.release_year || patch.year || undefined,
            thumbnail: hiRes || song.thumbnail,
          } as VideoResultWithArtistThumb;
        })
      );
    });

    return () => {
      unlistenEnr.then((fn) => fn());
    };
  }, []);

  // Persist successful search results to the local cache so the same query
  // is instant next time. Done after the search completes (not after every
  // keystroke) so we only cache meaningful results.
  useEffect(() => {
    if (!hasSearched || isLoading || songs.length === 0 || searchError) return;
    const q = activeQueryRef.current;
    if (!q) return;
    // Debounce so we don't thrash on rapid re-renders.
    const timer = setTimeout(() => {
      cacheSearchResults(q, songs).catch(() => { /* ignore */ });
    }, 400);
    return () => clearTimeout(timer);
  }, [songs, isLoading, hasSearched, searchError]);

  // ─── Derived data ──────────────────────────────────────────────────────

  const songList = songs.slice(0, 10);

  const artistGroups = (() => {
    const artistMap = new Map<string, VideoResult[]>();
    for (const track of songs) {
      const artist = track.artist || "Unknown Artist";
      if (!artistMap.has(artist)) artistMap.set(artist, []);
      artistMap.get(artist)!.push(track);
    }
    return [...artistMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([name, tracks]) => ({
        name,
        thumbnail: (tracks[0] as VideoResultWithArtistThumb).artist_thumbnail || tracks[0].thumbnail,
        tracks,
      }));
  })();

  const albumGroups = (() => {
    const seen = new Set<string>();
    const result: AlbumGroup[] = [];

    // Derive albums from song data (TheAudioDB enrichment sets album per song)
    for (const s of songs) {
      if (!s.album) continue;
      const key = `${s.album}::${s.artist}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        name: s.album,
        artist: s.artist,
        year: s.release_year ?? null,
        thumbnail: s.thumbnail,
        tracks: songs.filter(
          (t) => t.album === s.album && t.artist === s.artist
        ),
      });
    }

    return result.slice(0, 10);
  })();

  const topResult = (() => {
    if (songs.length === 0) return null;

    const q = query.trim().toLowerCase();

    // 1. Exact / close song title match -> top result is a song
    const exactSong = songs.find(
      (s) => q && s.title.toLowerCase().includes(q)
    );
    if (exactSong) {
      return {
        type: "song" as const,
        name: exactSong.title,
        thumbnail: exactSong.thumbnail,
        tracks: [exactSong],
      };
    }

    // 2. Album match -> top result is an album
    const albumMatch = albumGroups.find(
      (a) => q && a.name.toLowerCase().includes(q)
    );
    if (albumMatch) {
      return {
        type: "album" as const,
        name: albumMatch.name,
        thumbnail: albumMatch.thumbnail,
        tracks: albumMatch.tracks,
      };
    }

    // 3. Fallback: artist with the most tracks
    const artistCount = new Map<string, VideoResult[]>();
    for (const s of songs) {
      const a = s.artist || "Unknown Artist";
      if (!artistCount.has(a)) artistCount.set(a, []);
      artistCount.get(a)!.push(s);
    }
    const sorted = [...artistCount.entries()].sort((a, b) => b[1].length - a[1].length);
    if (sorted.length === 0) return null;
    const [name, tracks] = sorted[0];
    return {
      type: "artist" as const,
      name,
      thumbnail: (tracks[0] as VideoResultWithArtistThumb).artist_thumbnail || tracks[0].thumbnail,
      tracks,
    };
  })();

  // ─── Search handler ────────────────────────────────────────────────────

  const runSearch = useCallback(async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    // Cancel any in-flight search
    searchAbortRef.current?.();
    let aborted = false;
    searchAbortRef.current = () => {
      aborted = true;
    };

    // Track this query to ignore stale enrichment events
    activeQueryRef.current = q;
    setShowHistory(false);

    setIsLoading(true);
    setHasSearched(true);
    setSearchError(null);

    try {
      const songResult = await searchYouTubeEnriched(q, 15);
      if (aborted) return;
      setSongs(songResult);
      // Refresh history in the background (don't block the UI).
      refreshHistory();
    } catch (err) {
      if (aborted) return;
      console.error("Search error:", err);
      setSearchError(String(err));
      setSongs([]);
    } finally {
      if (!aborted) setIsLoading(false);
    }
  }, [refreshHistory]);

  const scheduleSearch = useCallback((q: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!q.trim()) return;
    debounceTimerRef.current = setTimeout(() => {
      runSearch(q);
    }, 350);
  }, [runSearch]);

  // Auto-search from mood chips / external navigation
  useEffect(() => {
    if (initialQuery && !initialSearchDoneRef.current) {
      initialSearchDoneRef.current = true;
      setQuery(initialQuery);
      runSearch(initialQuery);
    }
  }, [initialQuery, runSearch]);

  // Clean up pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      searchAbortRef.current?.();
    };
  }, []);

  const handlePlayArtist = (artist: ArtistGroup) => {
    if (artist.tracks.length > 0) {
      onPlayTrack(artist.tracks[0], artist.tracks);
    }
    // Navigate to artist page if handler is available
    if (onOpenArtist) {
      onOpenArtist(
        artist.name.toLowerCase().replace(/\s+/g, "-"),
        artist.name,
        artist.thumbnail
      );
    }
  };

  const handlePlayAlbumSongs = (album: AlbumGroup) => {
    if (album.tracks.length > 0) {
      onPlayTrack(album.tracks[0], album.tracks);
    }
    // Navigate to album page if handler is available
    if (onOpenAlbum) {
      const albumId = album.name.toLowerCase().replace(/\s+/g, "-");
      onOpenAlbum(albumId, album.name, album.artist, album.thumbnail);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="search-page animate-fade-in">
      <h1
        className="library-header"
        style={{
          color: "var(--text-primary)",
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        Search
      </h1>

      {/* ── Search Input ── */}
      <div className="search-input-wrapper" style={{ marginBottom: 16, position: "relative" }}>
        <SearchIcon className="search-icon" size={20} />
          <input
            className="search-input"
            placeholder="What do you want to listen to?"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              setShowHistory(false);
              scheduleSearch(value);
            }}
            onFocus={() => {
              if (!query.trim()) setShowHistory(true);
            }}
            onBlur={() => {
              // delay so click on a history item registers first
              setTimeout(() => setShowHistory(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                const q = query.trim();
                if (q) runSearch(q);
              } else if (e.key === "Escape") {
                setShowHistory(false);
                searchInputRef.current?.blur();
              }
            }}
            ref={searchInputRef}
            autoFocus
          />
          {query && (
          <button
            className="search-clear"
            onClick={() => {
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              searchAbortRef.current?.();
              setQuery("");
              setSongs([]);
              setHasSearched(false);
              setSearchError(null);
              setShowHistory(true);
              searchInputRef.current?.focus();
            }}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "none",
              background: "var(--surface-container-high)",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        )}

        {/* ── History + suggestions dropdown ── */}
        {showHistory && (history.length > 0 || suggestions.length > 0) && (
          <div
            className="search-history-dropdown animate-fade-in"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              background: "var(--surface-container)",
              border: "1px solid var(--glass-border)",
              borderRadius: 12,
              padding: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              zIndex: 50,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {suggestions.length > 0 && (
              <>
                <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Suggestions
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={`sug-${i}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePickHistory(s)}
                    className="search-history-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      background: "transparent",
                      border: "none",
                      borderRadius: 8,
                      color: "var(--text-primary)",
                      fontSize: 14,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-active)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <SearchIcon size={14} color="var(--text-muted)" />
                    <span>{s}</span>
                  </button>
                ))}
              </>
            )}
            {history.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", marginTop: suggestions.length > 0 ? 4 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Recent searches
                  </div>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleClearHistory}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      fontSize: 11,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                  >
                    <Trash2 size={11} /> Clear
                  </button>
                </div>
                {history.slice(0, 10).map((h) => (
                  <div
                    key={h.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePickHistory(h.query)}
                    className="search-history-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      color: "var(--text-primary)",
                      fontSize: 14,
                      cursor: "pointer",
                      background: "transparent",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-active)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <History size={14} color="var(--text-muted)" />
                    <span style={{ flex: 1 }}>{h.query}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{h.result_count} tracks</span>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => handleRemoveHistory(h.id, e)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        padding: 2,
                      }}
                      aria-label="Remove from history"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Initial: Browse prompt ── */}
      {!hasSearched && !isLoading && (
        <div className="animate-fade-in" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}>
          <SearchIcon size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
            What do you want to listen to?
          </div>
          <div style={{ fontSize: 14 }}>
            Search for songs, artists, or albums
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && <SearchSkeleton />}

      {/* ── Error ── */}
      {!isLoading && hasSearched && searchError && (
        <div className="empty-state animate-fade-in">
          <SearchIcon className="empty-state-icon" size={48} />
          <div className="empty-state-title">Search failed</div>
          <div className="empty-state-desc" style={{ fontSize: 13, maxWidth: 400 }}>
            {searchError}
          </div>
          <button
            className="search-retry-btn"
            onClick={() => runSearch(query)}
            style={{
              marginTop: 16,
              padding: "10px 24px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Empty results ── */}
      {!isLoading && hasSearched && !searchError && songs.length === 0 && (
        <div className="empty-state animate-fade-in">
          <Music size={48} className="empty-state-icon" />
          <div className="empty-state-title">No results found</div>
          <div className="empty-state-desc">Try different keywords</div>
        </div>
      )}

      {/* ── Results ── */}
      {!isLoading && hasSearched && songs.length > 0 && (
        <div className="search-results animate-fade-in">
          {/* ── Top Result ── */}
          {topResult && (
            <div className="search-top-result animate-slide-up">
              <TopResultCard
                result={topResult}
                onPlayTrack={onPlayTrack}
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
              />
            </div>
          )}

          {/* ── Songs ── */}
          {songList.length > 0 && (
            <div className="search-songs-section animate-slide-up animate-delay-1">
              <div className="section-header">
                <div className="section-title" style={{ fontSize: 20 }}>
                  Songs
                </div>
              </div>
              <div className="track-list search-track-list">
                {songList.map((track, index) => (
                  <div
                    key={track.id}
                    className={`track-item search-track-item ripple animate-slide-up animate-delay-${Math.min(index + 1, 5)}`}
                    onClick={() => onPlayTrack(track, songList)}
                  >
                    <img
                      className="track-thumb search-track-thumb"
                      src={track.thumbnail}
                      alt={track.title}
                      onError={imgOnError}
                      loading="lazy"
                    />
                    <div className="track-info">
                      <div className="track-title search-track-title">
                        {track.title}
                      </div>
                      <div className="track-artist search-track-artist">
                        {track.artist}
                        {track.album && (
                          <>
                            <span className="track-sep">·</span>
                            <span className="track-album-name">{track.album}</span>
                          </>
                        )}
                        {track.release_year && (
                          <>
                            <span className="track-sep">·</span>
                            <span className="track-year">{track.release_year}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="track-duration search-track-duration">
                      {track.duration || ""}
                    </span>
                    <PlaylistDropdown
                      track={track}
                      isOpen={menuOpen === track.id}
                      onToggle={() => {
                        loadPlaylists();
                        setMenuOpen(menuOpen === track.id ? null : track.id);
                      }}
                      onClose={() => setMenuOpen(null)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Albums ── */}
          {albumGroups.length > 0 && (
            <div className="search-albums-section animate-slide-up animate-delay-2">
              <div className="section-header">
                <div className="section-title" style={{ fontSize: 20 }}>
                  Albums
                </div>
              </div>
              <div className="search-album-scroll">
                {albumGroups.map((album, index) => (
                  <div
                    key={`${album.name}-${album.artist}`}
                    className={`search-album-card animate-scale-in animate-delay-${Math.min(index + 1, 5)}`}
                    onClick={() => handlePlayAlbumSongs(album)}
                  >
                    <div className="search-album-art-wrapper">
                      <img
                        className="search-album-art"
                        src={album.thumbnail}
                        alt={album.name}
                        onError={imgOnError}
                        loading="lazy"
                      />
                      <button
                        className="search-album-play"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbumSongs(album);
                        }}
                        aria-label="Play album"
                      >
                        <Play size={16} fill="currentColor" />
                      </button>
                      {album.year && (
                        <span className="search-album-year">{album.year}</span>
                      )}
                    </div>
                    <div className="search-album-info">
                      <div className="search-album-name">{album.name}</div>
                      <div className="search-album-artist">{album.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Artists ── */}
          {artistGroups.length > 0 && (
            <div className="search-artists-section animate-slide-up animate-delay-3">
              <div className="section-header">
                <div className="section-title" style={{ fontSize: 20 }}>
                  Artists
                </div>
              </div>
              <div className="artist-scroll">
                {artistGroups.map((artist, index) => (
                  <div
                    key={artist.name}
                    className={`artist-card animate-scale-in animate-delay-${Math.min(index + 1, 5)}`}
                    onClick={() => handlePlayArtist(artist)}
                  >
                    <div className="artist-avatar-wrapper">
                      <img
                        className="artist-avatar"
                        src={artist.thumbnail}
                        alt={artist.name}
                        onError={imgOnError}
                        loading="lazy"
                      />
                      <button
                        className="artist-play-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayArtist(artist);
                        }}
                        aria-label="Play artist"
                      >
                        <Play size={16} fill="currentColor" />
                      </button>
                    </div>
                    <div className="artist-name">{artist.name}</div>
                    <div className="artist-meta">Artist</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
