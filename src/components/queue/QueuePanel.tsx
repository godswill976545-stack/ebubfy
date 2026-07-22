import { useState, useCallback, useRef, memo } from "react";
import { GripVertical, X, Play, Music, Trash2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlayerStore } from "../../store/playerStore";
import type { VideoResult } from "../../types";

interface QueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Swipe-to-remove hook ─────────────────────────────────

const SWIPE_THRESHOLD = 80;

function useSwipeToRemove(onRemove: () => void) {
  const swipeRef = useRef({ startX: 0, currentX: 0, isDragging: false });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [showDelete, setShowDelete] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't start swipe when interacting with the drag handle
    if ((e.target as HTMLElement).closest('.queue-drag-handle')) return;
    swipeRef.current = { startX: e.clientX, currentX: e.clientX, isDragging: true };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!swipeRef.current.isDragging) return;
    swipeRef.current.currentX = e.clientX;
    const diff = e.clientX - swipeRef.current.startX;
    if (diff < 0) {
      setSwipeOffset(diff);
      setShowDelete(Math.abs(diff) > SWIPE_THRESHOLD);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    if (!swipeRef.current.isDragging) return;
    swipeRef.current.isDragging = false;
    if (Math.abs(swipeOffset) > SWIPE_THRESHOLD) {
      onRemove();
    }
    setSwipeOffset(0);
    setShowDelete(false);
  }, [swipeOffset, onRemove]);

  return { swipeOffset, showDelete, onPointerDown, onPointerMove, onPointerUp };
}

// ─── Sortable Queue Item ──────────────────────────────────

interface QueueItemProps {
  track: VideoResult;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

function QueueItem({ track, isPlaying, onPlay, onRemove }: QueueItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id });

  const { swipeOffset, showDelete, onPointerDown, onPointerMove, onPointerUp } =
    useSwipeToRemove(onRemove);

  const style: React.CSSProperties = {
    transform: swipeOffset
      ? `translateX(${swipeOffset}px)`
      : CSS.Transform.toString(transform),
    transition: swipeOffset ? "none" : transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`queue-item ${isPlaying ? "queue-item-playing" : ""} ${isDragging ? "queue-item-dragging" : ""} ${showDelete ? "queue-item-swiping" : ""}`}
      onClick={onPlay}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Swipe-delete indicator */}
      {showDelete && (
        <div className="queue-swipe-indicator">
          <Trash2 size={16} />
        </div>
      )}

      {/* Drag handle */}
      <button
        className="queue-drag-handle"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>

      {/* Mini album art */}
      <div className="queue-art-wrapper">
        <img
          className="queue-art"
          src={track.thumbnail}
          alt={track.title}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${track.id}/default.jpg`;
          }}
        />
        {isPlaying && <div className="queue-art-eq"><span /><span /><span /></div>}
      </div>

      {/* Track info */}
      <div className="queue-info">
        <div className="queue-info-title">{track.title}</div>
        <div className="queue-info-artist">{track.artist}</div>
      </div>

      {/* Remove button */}
      <button
        className="queue-remove-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove from queue"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Queue Panel Component ────────────────────────────────

export default memo(function QueuePanel({ isOpen, onClose }: QueuePanelProps) {
  const queue = usePlayerStore((s) => s.queue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handlePlayFromQueue = useCallback(
    (index: number) => {
      const track = queue[index];
      if (track) {
        setCurrentTrack(track);
        setIsPlaying(true);
      }
    },
    [queue, setCurrentTrack, setIsPlaying]
  );

  const handleRemoveFromQueue = useCallback(
    (index: number) => {
      removeFromQueue(index);
    },
    [removeFromQueue]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = queue.findIndex((t) => t.id === active.id);
      const newIndex = queue.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderQueue(oldIndex, newIndex);
    },
    [queue, reorderQueue]
  );

  if (!isOpen) return null;

  return (
    <div className="queue-overlay" onClick={onClose}>
      <div className="queue-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="queue-header">
          <div className="queue-header-left">
            <Music size={18} style={{ color: "var(--accent-primary)" }} />
            <span className="queue-title">Queue</span>
            {queue.length > 0 && (
              <span className="queue-count">{queue.length}</span>
            )}
          </div>
          <button className="queue-close-btn" onClick={onClose} aria-label="Close queue">
            <X size={18} />
          </button>
        </div>

        <div className="queue-scroll">
          {/* Now Playing */}
          {currentTrack && (
            <div className="queue-section">
              <div className="queue-section-label">
                <Play size={12} fill="currentColor" />
                Now Playing
              </div>
              <div className="queue-nowplaying">
                <div className="queue-nowplaying-art">
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${currentTrack.id}/default.jpg`;
                    }}
                  />
                  {isPlaying && <div className="queue-nowplaying-eq"><span /><span /><span /></div>}
                </div>
                <div className="queue-nowplaying-info">
                  <div className="queue-nowplaying-title">{currentTrack.title}</div>
                  <div className="queue-nowplaying-artist">{currentTrack.artist}</div>
                </div>
              </div>
            </div>
          )}

          {/* Queue List */}
          {queue.length > 0 && (
            <div className="queue-section">
              <div className="queue-section-label">
                <Music size={12} />
                Next in Queue
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={queue.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="queue-list">
                    {queue.map((track, index) => (
                      <QueueItem
                        key={track.id}
                        track={track}
                        isPlaying={currentTrack?.id === track.id}
                        onPlay={() => handlePlayFromQueue(index)}
                        onRemove={() => handleRemoveFromQueue(index)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Empty State */}
          {queue.length === 0 && !currentTrack && (
            <div className="queue-empty">
              <Music size={40} style={{ color: "var(--text-tertiary)", marginBottom: 16 }} />
              <div className="queue-empty-title">Queue is empty</div>
              <div className="queue-empty-desc">
                Play some music to add tracks here
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
