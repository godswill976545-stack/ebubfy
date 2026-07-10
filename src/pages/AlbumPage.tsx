import { useEffect, useState } from "react";
import { ArrowLeft, Play, Music, Shuffle } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { getAlbumData } from "../lib/api";
import type { Album, VideoResult } from "../types";

interface AlbumPageProps {
  albumId: string;
  albumName?: string;
  albumArtist?: string;
  albumThumbnail?: string;
  onBack: () => void;
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
}

export default function AlbumPage({ albumId, albumName, albumArtist, albumThumbnail, onBack, onPlayTrack }: AlbumPageProps) {
  const { currentTrack, isPlaying } = usePlayerStore();
  
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<VideoResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  
  const displayName = albumName || albumId.replace(/-/g, ' ');
  const displayArtist = albumArtist || "Unknown Artist";

  // Fetch album data from API
  useEffect(() => {
    const fetchAlbumData = async () => {
      try {
        const albumData = await getAlbumData(displayName, displayArtist);
        setAlbum(albumData);
        setTracks(albumData.tracks || []);
      } catch (error) {
        console.error("Failed to fetch album data:", error);
        // Build a sensible fallback using the tracks we already know about
        // (passed via search context) if the backend doesn't have this album.
        setAlbum({
          id: albumId,
          name: displayName,
          artist: displayArtist,
          thumbnail: albumThumbnail || "",
          release_year: undefined,
          total_tracks: 0,
          tracks: [],
          genres: [],
          label: undefined,
          copyrights: []
        });
      } finally {
        setLoaded(true);
      }
    };
    
    fetchAlbumData();
  }, [albumId, displayName, displayArtist, albumThumbnail]);
  
  const handlePlayAlbum = () => {
    if (tracks.length > 0) {
      onPlayTrack(tracks[0], tracks);
    }
  };
  
  const handlePlayTrack = (track: VideoResult) => {
    onPlayTrack(track, tracks);
  };
  
  const handleShuffle = () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    onPlayTrack(shuffled[0], shuffled);
  };
  
  // Loading state
  if (!loaded) {
    return (
      <div className="album-page animate-fade-in">
        <button className="album-back" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        
        <div className="album-header">
          <div className="album-art" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-active)"
          }}>
            <Music size={48} style={{ color: "var(--text-muted)" }} />
          </div>
          
        <div className="album-info">
          <div className="album-type">ALBUM</div>
          <h1 className="album-title" style={{ fontSize: 32 }}>{displayName}</h1>
          <div className="album-meta">
            <span>{displayArtist}</span>
          </div>
            <div className="album-actions">
              <button className="album-play" disabled>
                <Play size={20} fill="currentColor" />
              </button>
              <button className="album-shuffle" disabled>
                <Shuffle size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Error / not found state
  if (!album) {
    return (
      <div className="album-page animate-fade-in">
        <button className="album-back" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        
        <div className="album-header">
          <div className="album-art" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-active)"
          }}>
            <Music size={48} style={{ color: "var(--text-muted)" }} />
          </div>
          
          <div className="album-info">
            <div className="album-type">ALBUM</div>
            <h1 className="album-title" style={{ fontSize: 32 }}>{displayName}</h1>
            <div className="album-meta">
              <span>{displayArtist}</span>
            </div>
            <div className="album-actions">
              <button className="album-play" disabled>
                <Play size={20} fill="currentColor" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="album-page animate-fade-in">
      <button className="album-back" onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      
      {/* Header with art + info */}
      <div className="album-header">
        <img 
          className="album-art"
          src={album.thumbnail || albumThumbnail || "https://img.youtube.com/vi/default.jpg"}
          alt={album.name} 
          onError={(e) => {
            (e.target as HTMLImageElement).src = "https://img.youtube.com/vi/default.jpg";
          }} 
        />
        
        <div className="album-info">
          <div className="album-type">ALBUM</div>
          <h1 className="album-title">{album.name}</h1>
          <div className="album-meta">
            <span>{album.artist}</span>
            <span className="album-meta-dot">·</span>
            <span>{album.release_year || "Unknown year"}</span>
          </div>
          
          {album.genres && album.genres.length > 0 && (
            <div className="album-meta" style={{ marginTop: 4 }}>
              <span>{album.genres.join(" · ")}</span>
            </div>
          )}
          
          <div className="album-actions">
            <button className="album-play" onClick={handlePlayAlbum}>
              <Play size={22} fill="currentColor" />
            </button>
            <button className="album-shuffle" onClick={handleShuffle}>
              <Shuffle size={20} />
            </button>
          </div>
          
          {album.label && (
            <div className="album-info-section" style={{ marginTop: "var(--space-md)" }}>
              <div className="album-info-label">Label</div>
              <div className="album-info-text">{album.label}</div>
            </div>
          )}
          
          {album.copyrights && album.copyrights.length > 0 && (
            <div className="album-info-section">
              <div className="album-info-text">{album.copyrights[0]}</div>
            </div>
          )}
        </div>
      </div>
      
      {/* Track list */}
      <div className="album-tracks">
        <div className="album-track-list">
          {tracks.map((track, index) => {
            const isCurrentTrack = currentTrack?.id === track.id && isPlaying;
            return (
              <div 
                key={track.id} 
                className={`album-track-item ${isCurrentTrack ? "playing" : ""}`} 
                onClick={() => handlePlayTrack(track)}
              >
                <div className="album-track-num">
                  {isCurrentTrack ? (
                    <span style={{ color: "var(--primary)" }}>♪</span>
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                
                <div className="album-track-info">
                  <div className={`album-track-title ${isCurrentTrack ? "playing" : ""}`}>
                    {track.title}
                  </div>
                  <div className="album-track-artist">{track.artist}</div>
                </div>
                
                <div className="album-track-duration">
                  {track.duration}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
