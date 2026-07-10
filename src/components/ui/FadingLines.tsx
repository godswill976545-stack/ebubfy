import { useEffect, useRef } from "react";

interface FadingLinesProps {
  lines?: number;
  className?: string;
}

export default function FadingLines({ lines = 5, className = "" }: FadingLinesProps) {
  const rafRef = useRef<number>(0);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const tick = (now - start) / 1000;
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const phase = tick * 3 + (i / lines) * Math.PI * 2;
        const scaleX = 0.4 + Math.sin(phase) * 0.3 + 0.3; // ranges 0.4 to 1.0
        const opacity = 0.3 + Math.sin(phase + 0.5) * 0.35 + 0.35; // ranges 0.3 to 1.0
        bar.style.opacity = String(opacity);
        bar.style.transform = `scaleX(${scaleX})`;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lines]);

  return (
    <div className={`fading-lines ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barRefs.current[i] = el; }}
          className="fading-lines-bar"
          style={{
            width: `${60 + Math.sin((i / lines) * Math.PI) * 35}px`,
          }}
        />
      ))}
    </div>
  );
}
