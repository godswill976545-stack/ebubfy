const en = {
  // Sidebar & Navigation
  sidebar: {
    home: "Home",
    browse: "Browse",
    yourLibrary: "Your Library",
    settings: "Settings",
    darkMode: "Dark Mode",
    midnightMode: "Midnight Mode",
    lightMode: "Light Mode",
    logOut: "Log Out",
  },

  // Navigation
  nav: {
    home: "Home",
    search: "Search",
    library: "Library",
    settings: "Settings",
    nowPlaying: "Now Playing",
  },

  // Home
  home: {
    greeting: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
    },
    welcome: "Welcome to Ebubefy",
    welcomeDesc: "Search for music to get started. Your favorites will appear here.",
    quickPicks: "Quick picks",
    recentlyPlayed: "Recently played",
    likedSongs: "Liked Songs",
    songs_one: "song",
    songs_other: "songs",
    moreLike: "More like {{artist}}",
  },

  // Search
  search: {
    placeholder: "What do you want to listen to?",
    browse: "Browse",
    browseAll: "Browse all",
    topResult: "Top result",
    songs: "Songs",
    artists: "Artists",
    albums: "Albums",
    artist: "Artist",
    noResults: "No results found",
    noResultsDesc: "Try different keywords",
    addToPlaylist: "Add to playlist",
    noPlaylists: "No playlists yet",
  },

  // Library
  library: {
    title: "Your Library",
    likedSongs: "Liked Songs",
    playlists: "Playlists",
    createPlaylist: "Create Playlist",
    filterAll: "All",
    filterPlaylists: "Playlists",
    filterLiked: "Liked",
    playlistLabel: "Playlist",
    emptyTitle: "Your library is empty",
    emptyDesc: "Create a playlist or like some songs",
  },

  // Playlist
  playlist: {
    create: "Create Playlist",
    playlistName: "Playlist name",
    cancel: "Cancel",
    delete: "Delete playlist",
    play: "Play",
    playNow: "Play now",
    shuffle: "Shuffle",
    empty: "This playlist is empty",
    labelPlaylist: "PLAYLIST",
    labelFavorites: "FAVORITES",
    noTracks: "No tracks yet",
    noTracksDesc: "Add songs from search",
    noLikedSongs: "No liked songs yet",
    noLikedSongsDesc: "Like songs from the player",
  },

  // Settings
  settings: {
    title: "Settings",
    language: "Language",
    languageDesc: "Choose your preferred language",
    english: "English",
    french: "Français",
    appearance: "Appearance",
    theme: "Theme",
    themeDesc: "Customize the look of the app",
    about: "About",
    appName: "Ebubefy",
    version: "v1.0.0",
    appDesc:
      "A modern music player that searches YouTube for songs and displays synchronized lyrics. Your data is stored locally on this machine.",
    audio: "Audio",
    audioDesc: "Equalizer, crossfade, and quality",
    equalizer: "Equalizer",
    equalizerDesc: "10-band parametric EQ with presets",
    equalizerPreset: "Preset",
    equalizerReset: "Reset all bands",
    crossfade: "Crossfade",
    crossfadeDesc: "Smoothly fade between tracks",
    crossfadeOff: "Off",
    crossfadeSeconds: "{{n}} seconds",
    sleepTimer: "Sleep Timer",
    sleepTimerDesc: "Pause playback after a set time",
    sleepTimerOff: "Off",
    dataSources: "Data sources",
    dataSourcesDesc: "Status of external services",
    dataSourcesCheck: "Check now",
    dataSourcesChecking: "Checking...",
    dataSourcesOk: "Operational",
    dataSourcesError: "Unavailable",
    features: {
      youtube: "🎵 YouTube Search",
      lyrics: "📝 Synced Lyrics",
      local: "💾 Local Playlists",
    },
  },

  // Now Playing
  nowPlaying: {
    nowPlaying: "Now playing",
    queue: "Queue",
    addToPlaylist: "Add to playlist",
    noTrack: "No track selected",
    noTrackDesc: "Choose a song to play",
    noLyrics: "No lyrics found",
    lyrics: "Lyrics",
    showLyrics: "Show lyrics",
    hideLyrics: "Hide lyrics",
  },

  // Common
  common: {
    loading: "Loading...",
    error: "Something went wrong",
    retry: "Retry",
  },
} as const;

// DeepStringify converts literal string types to `string` so French translations work
type DeepStringify<T> = T extends string
  ? string
  : T extends object
    ? { [K in keyof T]: DeepStringify<T[K]> }
    : T;

export type Translations = DeepStringify<typeof en>;

export default en;
