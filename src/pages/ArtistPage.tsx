import { useEffect, useState } from "react";
import { ArrowLeft, Play, Music, Shuffle } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { getArtistData, searchYouTubeEnriched } from "../lib/api";
import type { Artist, VideoResult } from "../types";

interface ArtistPageProps {
  artistId: string;
  artistName?: string;
  artistThumbnail?: string;
  onBack: () => void;
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
}

export default function ArtistPage({ artistId, artistName, artistThumbnail, onBack, onPlayTrack }: ArtistPageProps) {
  const { currentTrack, isPlaying } = usePlayerStore();
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [topTracks, setTopTracks] = useState<VideoResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const displayName = artistName || artistId.replace(/-/g, " ");
  
  useEffect(() => {
    const fetchArtistData = async () => {
      try {
        const artistData = await getArtistData(displayName);
        setArtist(artistData);
        
        let tracks = artistData.topTracks || [];
        
        // If TheAudioDB returned no tracks, search YouTube as fallback
        if (tracks.length === 0) {
          console.log(`[ArtistPage] No tracks from TheAudioDB, searching YouTube for: ${displayName}`);
          try {
            const ytResults = await searchYouTubeEnriched(`${displayName} music`, 15);
            tracks = ytResults.filter(t => 
              t.artist.toLowerCase().includes(displayName.toLowerCase()) ||
              displayName.toLowerCase().includes(t.artist.toLowerCase())
            );
            // If filtered results are too few, use all results
            if (tracks.length < 3) {
              tracks = ytResults;
            }
          } catch (ytErr) {
            console.error("[ArtistPage] YouTube fallback failed:", ytErr);
          }
        }
        
        setTopTracks(tracks);
      } catch (error) {
        console.error("Failed to fetch artist data:", error);
        // Fallback: try YouTube search directly
        try {
          const ytResults = await searchYouTubeEnriched(`${displayName} music`, 15);
          setTopTracks(ytResults);
        } catch {
          // Give up
        }
        setArtist({
          id: artistId,
          name: displayName,
          thumbnail: artistThumbnail || "",
          genres: [],
          topTracks: [],
          relatedArtists: []
        });
      } finally {
        setLoaded(true);
      }
    };
    
    fetchArtistData();
  }, [artistId, displayName, artistThumbnail]);
  
  const thumbnail = artist?.thumbnail || artistThumbnail || "";
  
  const handlePlayAll = () => {
    if (topTracks.length > 0) {
      onPlayTrack(topTracks[0], topTracks);
    }
  };
  
  const handleShuffle = () => {
    if (topTracks.length > 0) {
      const shuffled = [...topTracks].sort(() => Math.random() - 0.5);
      onPlayTrack(shuffled[0], shuffled);
    }
  };

  if (!loaded) {
    return (
      <div className="artist-page animate-fade-in">
        <button className="artist-back" onClick={onBack}>
          <ArrowLeft size={20} /> Back
        </button>
        <div className="artist-header">
          <div className="artist-avatar" style={{ background: "var(--surface-container-high)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Music size={48} color="var(--text-tertiary)" />
          </div>
          <div className="artist-header-info">
            <div className="artist-verified">ARTIST</div>
            <h1 className="artist-name">{displayName}</h1>
            <div className="artist-meta">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="artist-page animate-fade-in">
      <button className="artist-back" onClick={onBack}>
        <ArrowLeft size={20} /> Back
      </button>
      
      <div className="artist-header">
        <div className="artist-avatar">
          {thumbnail ? (
            <img 
              src={thumbnail} 
              alt={displayName}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", background: "var(--surface-container-high)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Music size={64} color="var(--text-tertiary)" />
            </div>
          )}
        </div>
        <div className="artist-header-info">
          <div className="artist-verified">ARTIST</div>
          <h1 className="artist-name">{displayName}</h1>
          <div className="artist-meta">
            {artist?.genres && artist.genres.length > 0 && (
              <span>{artist.genres.join(" · ")}</span>
            )}
            {topTracks.length > 0 && (
              <span>{topTracks.length} tracks</span>
            )}
          </div>
        </div>
      </div>
      
      <div className="artist-actions">
        <button className="artist-play" onClick={handlePlayAll} disabled={topTracks.length === 0}>
          <Play size={24} fill="currentColor" />
        </button>
        <button className="artist-follow" onClick={handleShuffle} disabled={topTracks.length === 0}>
          <Shuffle size={18} /> Shuffle
        </button>
      </div>
      
      {topTracks.length > 0 && (
        <div className="artist-section">
          <h2 className="artist-section-title">Popular tracks</h2>
          <div className="artist-top-tracks">
            {topTracks.slice(0, 10).map((track) => (
              <div 
                key={track.id}
                className={`artist-top-track ${currentTrack?.id === track.id && isPlaying ? "playing" : ""}`}
                onClick={() => onPlayTrack(track, topTracks)}
              >
                <div className="artist-track-thumb">
                  {track.thumbnail ? (
                    <img src={track.thumbnail} alt={track.title} />
                  ) : (
                    <Music size={20} color="var(--text-tertiary)" />
                  )}
                </div>
                <div className="artist-track-info">
                  <div className={`artist-track-title ${currentTrack?.id === track.id && isPlaying ? "playing" : ""}`}>
                    {track.title}
                  </div>
                  <div className="artist-track-album">{track.album || ""}</div>
                </div>
                <div className="artist-track-duration">{track.duration || ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {topTracks.length === 0 && (
        <div className="artist-section">
          <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-tertiary)" }}>
            <Music size={48} strokeWidth={1.5} style={{ marginBottom: 16 }} />
            <div>No tracks found for this artist</div>
          </div>
        </div>
      )}
    </div>
  );
}
