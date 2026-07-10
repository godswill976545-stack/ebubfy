<div align="center">

# Ebubfy

A modern, cross-platform desktop music player built with **React 19**, **TypeScript**, **Vite**, and **Tauri 2**. Search and stream music from YouTube, browse enriched metadata from Deezer / MusicBrainz / TheAudioDB, manage local playlists in SQLite, follow along with synchronized lyrics, and enjoy a polished, themeable, keyboard-driven UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#-getting-started)

> Drop a screenshot into `docs/screenshot.png` and it will render above.

</div>

---

## ✨ Features

- 🎵 **YouTube-powered search & streaming** — direct stream URLs via bundled `yt-dlp`, no third-party player required
- 🎤 **Enriched metadata** — Deezer, MusicBrainz, and TheAudioDB integration for albums, artists, top tracks, and artwork
- 📝 **Synchronized lyrics** — fetched from LRCLIB and lyrics.ovh with karaoke-style highlighting
- 💾 **Local-first storage** — playlists, favorites, search history, and recently played in a local SQLite database
- 🎨 **Three themes** — Dark, Light, and Midnight, with no-flash theme application on launch
- ⌨️ **Full keyboard control** — playback, seeking, volume, queue, search, and the shortcuts panel
- 🔊 **OS media session** — lock-screen and hardware media-key integration where the platform supports it
- 📱 **Responsive layout** — comfortable at 1280px, gracefully adapts to narrower windows
- 🌍 **Internationalized** — English and French translations
- 🖼️ **Drag & drop queue** — reorder the upcoming queue with `@dnd-kit`
- 🛡️ **Sandboxed desktop runtime** — Tauri 2 with explicit capabilities, no embedded browser

## 🧱 Tech Stack

| Layer            | Technology                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| UI               | React 19, TypeScript, Vite                                              |
| Styling          | Tailwind CSS 4 with custom CSS design tokens                            |
| State            | Zustand (`player`, `playlists`, `theme`, `language`, `audio`, `toast`)  |
| Drag & drop      | `@dnd-kit/core` + `@dnd-kit/sortable`                                   |
| Icons            | `lucide-react`                                                          |
| Desktop shell    | Tauri 2 (Rust)                                                           |
| Audio            | HTML5 `<audio>` consuming `yt-dlp` stream URLs                          |
| Database         | SQLite via `rusqlite` (Tauri side)                                      |
| Lyrics           | LRCLIB, lyrics.ovh                                                      |
| Metadata sources | Deezer, MusicBrainz, TheAudioDB                                        |

## 🏗️ Architecture

```
┌──────────────────────────── Browser (React) ────────────────────────────┐
│                                                                          │
│  Pages ──► Components ──► Hooks (audio, keyboard, media session, …)      │
│                 │                                                         │
│                 ▼                                                         │
│           Zustand stores (player, playlists, theme, …)                    │
│                 │                                                         │
│                 ▼                                                         │
│            src/lib/api.ts ──► @tauri-apps/api invoke() ──┐                │
│                                                          │                │
└──────────────────────────────────────────────────────────┼────────────────┘
                                                           │ IPC
┌────────────────────────────── Rust (Tauri) ──────────────┼────────────────┐
│                                                          │                │
│   commands/  ─►  youtube / ytdlp  (resolve & stream)    ◄┘                │
│   commands/  ─►  deezer / musicbrainz / theaudiodb                       │
│   commands/  ─►  lyrics (LRCLIB / lyrics.ovh)                            │
│   commands/  ─►  database (playlists, search cache, history)              │
│   commands/  ─►  audio (process control for yt-dlp)                      │
│                                                                          │
│   db/        ─►  SQLite schema & migrations                              │
│   utils/     ─►  HTTP, parsing, filesystem                               │
└──────────────────────────────────────────────────────────────────────────┘
```

The Rust backend is intentionally narrow: it resolves metadata, runs `yt-dlp` to produce a stream URL, owns the SQLite store, and exposes everything to the React layer as typed Tauri commands.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (LTS recommended)
- **Rust** & Cargo — [rustup.rs](https://rustup.rs)
- Platform build deps for Tauri — see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- `yt-dlp` is **bundled** in `src-tauri/resources/yt-dlp.exe` (Windows). For macOS / Linux it is auto-downloaded on first launch if missing.

### Install

```bash
npm install
```

### Run the desktop app in development

```bash
npm run tauri dev
```

This boots Vite (port `15173`) and launches the native window. The first build will compile the Rust crate and take a few minutes; subsequent runs are fast.

### Build a production desktop bundle

```bash
npm run tauri build
```

Installers / `.app` / `.AppImage` artifacts are emitted to `src-tauri/target/release/bundle/`.

### Build the web frontend only (no desktop shell)

```bash
npm run build      # type-check + vite build → dist/
npm run preview    # serve the built bundle locally
```

### Lint

```bash
npm run lint
```

## ⌨️ Keyboard Shortcuts

| Action                       | Keys                                  |
| ---------------------------- | ------------------------------------- |
| Play / Pause                 | `Space`                               |
| Next track                   | `L` · `Shift + →`                     |
| Previous track               | `J` · `Shift + ←`                     |
| Seek forward / backward      | `→` / `←`                             |
| Volume up / down             | `↑` / `↓`                             |
| Mute / unmute                | `M`                                   |
| Open Now Playing             | `K` · `Enter`                         |
| Toggle queue                 | `Q`                                   |
| Focus search                 | `S` · `Ctrl + F`                      |
| Show shortcuts panel         | `Shift + /` · `?`                     |

## 📁 Project Structure

```
ebubfy/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config (inline via @tailwindcss/vite)
├── public/                       # static assets shipped as-is
│   ├── favicon.png / favicon.svg
│   ├── logo.png
│   └── icons.svg
└── src/
    ├── main.tsx                  # React entry, theme bootstrap
    ├── App.tsx                   # Router + global layout
    ├── App.css / index.css       # Design tokens, Tailwind layers
    ├── components/
    │   ├── layout/               # Sidebar, top bar, window chrome
    │   ├── player/               # Controls, progress, volume
    │   ├── queue/                # Up-next list, drag & drop
    │   ├── lyrics/               # Synced line renderer
    │   ├── playlist/             # Playlist cards & rows
    │   ├── search/               # Search box, results, filters
    │   └── ui/                   # Primitives (button, dialog, toast, …)
    ├── hooks/                    # useAudio, useKeyboard, useLyricsFetch,
    │                             # useMediaSession, useClickOutside
    ├── i18n/                     # en.ts, fr.ts
    ├── lib/                      # api.ts (invoke wrappers), utils, constants
    ├── pages/                    # Home, Search, Browse, Library,
    │                             # Album, Artist, Playlist, NowPlaying, Settings
    ├── store/                    # Zustand stores
    └── types/                    # Shared TypeScript types
└── src-tauri/                    # Rust backend
    ├── tauri.conf.json
    ├── Cargo.toml
    ├── capabilities/             # Explicit Tauri permissions
    ├── icons/                    # App icons
    ├── resources/                # Bundled yt-dlp.exe
    └── src/
        ├── main.rs / lib.rs
        ├── commands/             # youtube, ytdlp, audio, deezer,
        │                         # musicbrainz, theaudiodb, lyrics,
        │                         # database, search_cache, …
        ├── db/                   # SQLite layer
        └── utils/                # HTTP, parsing, fs helpers
```

## 🔌 Data Sources

| Source                                                     | Used for                                        |
| ---------------------------------------------------------- | ----------------------------------------------- |
| [YouTube](https://www.youtube.com) + [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Search, stream URL resolution                   |
| [Deezer](https://www.deezer.com)                           | Albums, artists, top tracks, artwork            |
| [MusicBrainz](https://musicbrainz.org)                     | Canonical metadata, relationships              |
| [TheAudioDB](https://www.theaudiodb.com)                   | Artist bios, moods, supplementary artwork       |
| [LRCLIB](https://lrclib.net)                               | Time-synced lyrics                              |
| [lyrics.ovh](https://lyrics.ovh)                           | Plain-text lyrics fallback                      |

## 🛣️ Roadmap

- [ ] Scrobbling (Last.fm / ListenBrainz)
- [ ] Smart playlists
- [ ] Equalizer & audio effects
- [ ] Discord / WebNowPlaying rich presence
- [ ] Plugin system for additional metadata providers
- [ ] Cloud sync of playlists (opt-in)

## 🤝 Contributing

1. Fork the repo & create a feature branch (`git checkout -b feat/awesome`)
2. `npm install` and `npm run tauri dev` to confirm a clean build
3. Make your changes; keep `npm run lint` and `npm run build` green
4. Open a Pull Request with a clear description and screenshots if UI changes

## 🩹 Troubleshooting

- **`yt-dlp` not found on macOS / Linux** — it is auto-downloaded on first launch to the Tauri app-data directory. Check the dev console if it fails.
- **Rust build errors after pulling** — run `cargo clean` inside `src-tauri/` and try again.
- **Window appears blank in dev** — confirm Vite is serving on `15173` (see `vite.config.ts`).
- **Lock-screen controls not showing** — only available on platforms where the OS media session is supported.

## 📄 License

[MIT](./LICENSE) — © Ebubfy contributors
