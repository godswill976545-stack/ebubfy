import { useEffect, useState } from "react";
import {
  Settings,
  Globe,
  Palette,
  Music,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Volume2,
  Clock,
  Activity,
  RotateCcw,
} from "lucide-react";
import { useLanguageStore } from "../store/languageStore";
import { useThemeStore } from "../store/themeStore";
import {
  useAudioSettings,
  EQ_PRESET_LABELS,
  EQ_BAND_LABELS,
  type EqualizerPreset,
  type SleepTimerOption,
} from "../store/audioSettings";
import type { Locale } from "../store/languageStore";
import type { Theme } from "../types";
import { healthCheck, type HealthReport } from "../lib/api";

const EQ_PRESET_ORDER: EqualizerPreset[] = [
  "flat", "bass_boost", "treble_boost", "vocal", "electronic",
  "rock", "acoustic", "classical", "hip_hop", "loudness",
];

const CROSSFADE_OPTIONS: number[] = [0, 1, 2, 3, 5, 7, 10, 12];
const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [0, 5, 15, 30, 45, 60];

export default function SettingsPage() {
  const { translations: t, locale, setLocale } = useLanguageStore();
  const { theme, setTheme } = useThemeStore();
  const {
    equalizerEnabled,
    equalizerPreset,
    equalizerGains,
    setEqualizerEnabled,
    setEqualizerPreset,
    setEqualizerGain,
    resetEqualizer,
    crossfadeSeconds,
    setCrossfadeSeconds,
    sleepTimerMinutes,
    sleepTimerEndAt,
    setSleepTimer,
  } = useAudioSettings();

  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const runHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const r = await healthCheck();
      setHealth(r);
    } catch (err) {
      console.warn("[settings] health check failed:", err);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
  }, []);

  const remainingSeconds = sleepTimerEndAt
    ? Math.max(0, Math.floor((sleepTimerEndAt - Date.now()) / 1000))
    : 0;

  return (
    <div className="settings-page animate-fade-in">
      <h1 className="page-title" style={{ marginBottom: 32 }}>
        <Settings size={24} style={{ marginRight: 12 }} />
        {t.settings.title}
      </h1>

      {/* Language */}
      <div className="settings-card animate-slide-up">
        <div className="settings-card-header">
          <div className="settings-card-icon">
            <Globe size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.language}</div>
            <div className="settings-card-desc">{t.settings.languageDesc}</div>
          </div>
        </div>

        <div className="settings-card-options">
          {(["en", "fr"] as Locale[]).map((lang) => (
            <button
              key={lang}
              className={`m3-chip ${locale === lang ? "active" : ""}`}
              onClick={() => setLocale(lang)}
            >
              {lang === "en" ? t.settings.english : t.settings.french}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div className="settings-card animate-slide-up animate-delay-1">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)" }}>
            <Palette size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.theme}</div>
            <div className="settings-card-desc">{t.settings.themeDesc}</div>
          </div>
        </div>
        <div className="settings-card-options">
          {(["light", "dark", "midnight"] as Theme[]).map((th) => (
            <button
              key={th}
              className={`m3-chip ${theme === th ? "active" : ""}`}
              onClick={() => setTheme(th)}
            >
              {th === "light" ? (
                <><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#e5e7eb", border: "1px solid #d1d5db", marginRight: 4 }} /> Light</>
              ) : th === "dark" ? (
                <><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#1a1a2e", marginRight: 4 }} /> Dark</>
              ) : (
                <><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#0a0a12", border: "1px solid #333", marginRight: 4 }} /> Midnight</>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Audio: Equalizer */}
      <div className="settings-card animate-slide-up animate-delay-2">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}>
            <Volume2 size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.equalizer}</div>
            <div className="settings-card-desc">{t.settings.equalizerDesc}</div>
          </div>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={equalizerEnabled}
              onChange={(e) => setEqualizerEnabled(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--accent-primary)" }}
            />
          </label>
        </div>

        {/* Preset chips */}
        <div className="settings-card-options" style={{ flexWrap: "wrap" }}>
          {EQ_PRESET_ORDER.map((p) => (
            <button
              key={p}
              className={`m3-chip ${equalizerPreset === p ? "active" : ""}`}
              onClick={() => setEqualizerPreset(p)}
            >
              {EQ_PRESET_LABELS[p]}
            </button>
          ))}
          {equalizerPreset === "custom" && (
            <button
              className="m3-chip active"
              onClick={() => setEqualizerPreset("flat")}
              title={t.settings.equalizerReset}
            >
              {EQ_PRESET_LABELS.custom}
            </button>
          )}
        </div>

        {/* 10-band sliders */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)",
            gap: 6,
            marginTop: 16,
            padding: "12px 4px",
            opacity: equalizerEnabled ? 1 : 0.4,
            pointerEvents: equalizerEnabled ? "auto" : "none",
          }}
        >
          {equalizerGains.map((gain, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 32, textAlign: "center" }}>
                {gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}
              </span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={gain}
                onChange={(e) => setEqualizerGain(i, parseFloat(e.target.value))}
                style={{
                  writingMode: "vertical-rl",
                  WebkitAppearance: "slider-vertical" as const,
                  width: 20,
                  height: 80,
                  accentColor: "var(--accent-primary)",
                }}
              />
              <span style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center" }}>{EQ_BAND_LABELS[i]}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            className="m3-chip"
            onClick={resetEqualizer}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <RotateCcw size={12} /> {t.settings.equalizerReset}
          </button>
        </div>
      </div>

      {/* Crossfade */}
      <div className="settings-card animate-slide-up animate-delay-3">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}>
            <Activity size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.crossfade}</div>
            <div className="settings-card-desc">{t.settings.crossfadeDesc}</div>
          </div>
        </div>
        <div className="settings-card-options" style={{ flexWrap: "wrap" }}>
          {CROSSFADE_OPTIONS.map((s) => (
            <button
              key={s}
              className={`m3-chip ${crossfadeSeconds === s ? "active" : ""}`}
              onClick={() => setCrossfadeSeconds(s)}
            >
              {s === 0 ? t.settings.crossfadeOff : t.settings.crossfadeSeconds.replace("{{n}}", String(s))}
            </button>
          ))}
        </div>
      </div>

      {/* Sleep timer */}
      <div className="settings-card animate-slide-up animate-delay-4">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
            <Clock size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">
              {t.settings.sleepTimer}
              {sleepTimerEndAt && remainingSeconds > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--accent-primary)", fontFamily: "var(--font-mono, monospace)" }}>
                  {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
                </span>
              )}
            </div>
            <div className="settings-card-desc">{t.settings.sleepTimerDesc}</div>
          </div>
        </div>
        <div className="settings-card-options" style={{ flexWrap: "wrap" }}>
          {SLEEP_TIMER_OPTIONS.map((m) => (
            <button
              key={m}
              className={`m3-chip ${sleepTimerMinutes === m ? "active" : ""}`}
              onClick={() => setSleepTimer(m)}
            >
              {m === 0 ? t.settings.sleepTimerOff : `${m} min`}
            </button>
          ))}
        </div>
      </div>

      {/* Data sources */}
      <div className="settings-card animate-slide-up animate-delay-5">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, #10b981, #14b8a6)" }}>
            <Music size={20} />
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.dataSources}</div>
            <div className="settings-card-desc">{t.settings.dataSourcesDesc}</div>
          </div>
          <button
            onClick={runHealthCheck}
            disabled={healthLoading}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              background: "var(--surface-container-high)",
              border: "1px solid var(--glass-border)",
              borderRadius: 16,
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={12} className={healthLoading ? "spin" : ""} />
            {healthLoading ? t.settings.dataSourcesChecking : t.settings.dataSourcesCheck}
          </button>
        </div>

        {health && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <HealthRow
              label="yt-dlp"
              ok={health.yt_dlp_ok}
              detail={health.yt_dlp_version || health.yt_dlp_error || ""}
              t={t}
            />
            <HealthRow
              label="Deezer"
              ok={health.deezer_ok}
              detail={health.deezer_error || ""}
              t={t}
            />
            <HealthRow
              label="LRCLIB"
              ok={health.lrclib_ok}
              detail={health.lrclib_error || ""}
              t={t}
            />
            <HealthRow
              label="YouTube captions"
              ok={true}
              detail="yt-dlp fallback"
              t={t}
            />
          </div>
        )}

        <div className="settings-card-tags" style={{ marginTop: 12 }}>
          <span className="settings-tag">YouTube Search</span>
          <span className="settings-tag">Deezer Metadata</span>
          <span className="settings-tag">LRCLIB Lyrics</span>
        </div>
      </div>

      {/* About */}
      <div className="settings-card animate-slide-up animate-delay-6">
        <div className="settings-card-header">
          <div className="settings-card-icon" style={{ background: "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-deep) 100%)" }}>
            <span style={{ fontWeight: 700, fontSize: 18 }}>E</span>
          </div>
          <div className="settings-card-title-group">
            <div className="settings-card-title">{t.settings.appName}</div>
            <div className="settings-card-desc">{t.settings.version}</div>
          </div>
        </div>

        <p className="settings-card-body">{t.settings.appDesc}</p>

        <div className="settings-card-tags">
          <span className="settings-tag">{t.settings.features.youtube}</span>
          <span className="settings-tag">{t.settings.features.lyrics}</span>
          <span className="settings-tag">{t.settings.features.local}</span>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, ok, detail, t }: { label: string; ok: boolean; detail: string; t: ReturnType<typeof useLanguageStore.getState>["translations"] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "var(--surface-container-high)",
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      {ok ? (
        <CheckCircle2 size={14} color="var(--ytmusic-green, #1db954)" />
      ) : (
        <XCircle size={14} color="var(--error, #ef4444)" />
      )}
      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
      <span style={{ color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ok ? t.settings.dataSourcesOk : detail || t.settings.dataSourcesError}
      </span>
    </div>
  );
}
