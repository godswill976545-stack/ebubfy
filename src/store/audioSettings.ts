import { create } from "zustand";

export type EqualizerPreset =
  | "flat"
  | "bass_boost"
  | "treble_boost"
  | "vocal"
  | "electronic"
  | "rock"
  | "acoustic"
  | "classical"
  | "hip_hop"
  | "loudness"
  | "custom";

export const EQUALIZER_PRESETS: Record<EqualizerPreset, number[]> = {
  // Each preset is 10 band gains in dB.
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass_boost: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  treble_boost: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
  electronic: [4, 3, 1, 0, -1, 1, 0, 2, 4, 5],
  rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4],
  acoustic: [3, 3, 2, 1, 0, 0, 1, 2, 2, 3],
  classical: [3, 2, 1, 0, 0, 0, -1, -1, -1, -2],
  hip_hop: [5, 4, 2, 2, -1, -1, 1, 0, 2, 3],
  loudness: [5, 3, 0, 0, 0, 0, 0, 1, 3, 5],
  custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const EQ_BAND_LABELS = [
  "31Hz", "62Hz", "125Hz", "250Hz", "500Hz",
  "1kHz", "2kHz", "4kHz", "8kHz", "16kHz",
];

export const EQ_PRESET_LABELS: Record<EqualizerPreset, string> = {
  flat: "Flat",
  bass_boost: "Bass Boost",
  treble_boost: "Treble Boost",
  vocal: "Vocal",
  electronic: "Electronic",
  rock: "Rock",
  acoustic: "Acoustic",
  classical: "Classical",
  hip_hop: "Hip-Hop",
  loudness: "Loudness",
  custom: "Custom",
};

export type SleepTimerOption = 0 | 5 | 15 | 30 | 45 | 60;

interface AudioSettingsState {
  // Equalizer
  equalizerEnabled: boolean;
  equalizerPreset: EqualizerPreset;
  equalizerGains: number[]; // 10 values, -12 to +12 dB
  setEqualizerEnabled: (enabled: boolean) => void;
  setEqualizerPreset: (preset: EqualizerPreset) => void;
  setEqualizerGain: (index: number, gain: number) => void;
  resetEqualizer: () => void;

  // Crossfade
  crossfadeSeconds: number; // 0 = off
  setCrossfadeSeconds: (seconds: number) => void;

  // Sleep timer
  sleepTimerMinutes: SleepTimerOption;
  sleepTimerEndAt: number | null; // ms epoch
  setSleepTimer: (minutes: SleepTimerOption) => void;
  clearSleepTimer: () => void;
}

export const useAudioSettings = create<AudioSettingsState>((set, get) => ({
  equalizerEnabled: false,
  equalizerPreset: "flat",
  equalizerGains: [...EQUALIZER_PRESETS.flat],

  setEqualizerEnabled: (enabled) => set({ equalizerEnabled: enabled }),
  setEqualizerPreset: (preset) =>
    set({
      equalizerPreset: preset,
      equalizerGains: [...EQUALIZER_PRESETS[preset]],
    }),
  setEqualizerGain: (index, gain) => {
    const gains = [...get().equalizerGains];
    if (index < 0 || index >= gains.length) return;
    gains[index] = Math.max(-12, Math.min(12, gain));
    set({ equalizerGains: gains, equalizerPreset: "custom" });
  },
  resetEqualizer: () =>
    set({
      equalizerPreset: "flat",
      equalizerGains: [...EQUALIZER_PRESETS.flat],
    }),

  crossfadeSeconds: 0,
  setCrossfadeSeconds: (seconds) => set({ crossfadeSeconds: Math.max(0, Math.min(12, seconds)) }),

  sleepTimerMinutes: 0,
  sleepTimerEndAt: null,
  setSleepTimer: (minutes) => {
    if (minutes === 0) {
      set({ sleepTimerMinutes: 0, sleepTimerEndAt: null });
    } else {
      set({
        sleepTimerMinutes: minutes,
        sleepTimerEndAt: Date.now() + minutes * 60 * 1000,
      });
    }
  },
  clearSleepTimer: () => set({ sleepTimerMinutes: 0, sleepTimerEndAt: null }),
}));
