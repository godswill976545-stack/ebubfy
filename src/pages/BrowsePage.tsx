import type { Page } from "../types";

const GENRES = [
  { name: "Pop", icon: "🎸", color: "#E11D48" },
  { name: "Hip-Hop", icon: "🎤", color: "#EA580C" },
  { name: "Rock", icon: "🎸", color: "#DC2626" },
  { name: "Electronic", icon: "🎹", color: "#9333EA" },
  { name: "R&B", icon: "🎵", color: "#7C3AED" },
  { name: "Jazz", icon: "🎷", color: "#2563EB" },
  { name: "Classical", icon: "🎻", color: "#92400E" },
  { name: "K-Pop", icon: "⭐", color: "#0891B2" },
  { name: "Afrobeats", icon: "🥁", color: "#EA580C" },
  { name: "Country", icon: "🤠", color: "#65A30D" },
  { name: "Latin", icon: "💃", color: "#E11D48" },
  { name: "Metal", icon: "🤘", color: "#1F2937" },
  { name: "Indie", icon: "🎧", color: "#059669" },
  { name: "Folk", icon: "🪕", color: "#A16207" },
  { name: "Reggae", icon: "🌴", color: "#16A34A" },
  { name: "Podcast", icon: "🎙️", color: "#7C3AED" },
];

interface BrowsePageProps {
  onNavigate: (page: Page) => void;
  onSearchGenre: (genre: string) => void;
}

export default function BrowsePage({ onSearchGenre }: BrowsePageProps) {
  return (
    <div className="browse-page animate-fade-in">
      <h1 className="browse-title">
        Browse
      </h1>

      <div className="genre-grid">
        {GENRES.map((genre, index) => (
          <div
            key={genre.name}
            className="genre-tile animate-scale-in"
            style={{
              background: genre.color,
              animationDelay: `${Math.min(index + 1, 5) * 50}ms`,
            }}
            onClick={() => onSearchGenre(genre.name)}
          >
            <span className="genre-tile-emoji">{genre.icon}</span>
            <span className="genre-tile-name">
              {genre.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
