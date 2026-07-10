import { useState } from "react";
import { Music } from "lucide-react";

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
  fallback?: string;
}

export default function LazyImage({ src, alt = "", className = "", fallback }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-container-high)",
          color: "var(--text-muted)",
          overflow: "hidden",
        }}
        aria-label={alt}
      >
        {fallback ? (
          <img src={fallback} alt={alt} className={className} />
        ) : (
          <Music size={24} />
        )}
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div
          className={`${className} skeleton`}
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
      )}
      <img
        src={src}
        alt={alt}
        className={className}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.25s ease" }}
      />
    </>
  );
}
