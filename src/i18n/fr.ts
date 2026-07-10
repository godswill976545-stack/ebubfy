import type { Translations } from "./en";

const fr: Translations = {
  // Sidebar & Navigation
  sidebar: {
    home: "Accueil",
    browse: "Parcourir",
    yourLibrary: "Bibliothèque",
    settings: "Paramètres",
    darkMode: "Mode Sombre",
    midnightMode: "Mode Nuit",
    lightMode: "Mode Clair",
    logOut: "Déconnexion",
  },

  // Navigation
  nav: {
    home: "Accueil",
    search: "Rechercher",
    library: "Bibliothèque",
    settings: "Paramètres",
    nowPlaying: "En cours",
  },

  // Home
  home: {
    greeting: {
      morning: "Bonjour",
      afternoon: "Bon après-midi",
      evening: "Bonsoir",
    },
    welcome: "Bienvenue sur Ebubefy",
    welcomeDesc: "Recherchez de la musique pour commencer. Vos favoris apparaîtront ici.",
    quickPicks: "Sélections rapides",
    recentlyPlayed: "Récemment écoutés",
    likedSongs: "Titres likés",
    songs_one: "titre",
    songs_other: "titres",
    moreLike: "Plus comme {{artist}}",
  },

  // Search
  search: {
    placeholder: "Que voulez-vous écouter ?",
    browse: "Parcourir",
    browseAll: "Tout parcourir",
    topResult: "Meilleur résultat",
    songs: "Titres",
    artists: "Artistes",
    albums: "Albums",
    artist: "Artiste",
    noResults: "Aucun résultat trouvé",
    noResultsDesc: "Essayez différents mots-clés",
    addToPlaylist: "Ajouter à la playlist",
    noPlaylists: "Aucune playlist",
  },

  // Library
  library: {
    title: "Votre bibliothèque",
    likedSongs: "Titres likés",
    playlists: "Playlists",
    createPlaylist: "Créer une playlist",
    filterAll: "Tout",
    filterPlaylists: "Playlists",
    filterLiked: "Likés",
    playlistLabel: "Playlist",
    emptyTitle: "Votre bibliothèque est vide",
    emptyDesc: "Créez une playlist ou likez des chansons",
  },

  // Playlist
  playlist: {
    playlistName: "Nom de la playlist",
    cancel: "Annuler",
    create: "Créer",
    delete: "Supprimer la playlist",
    play: "Lire",
    playNow: "Lire maintenant",
    shuffle: "Aléatoire",
    empty: "Cette playlist est vide",
    labelPlaylist: "PLAYLIST",
    labelFavorites: "FAVORIS",
    noTracks: "Aucun titre",
    noTracksDesc: "Ajoutez des chansons depuis la recherche",
    noLikedSongs: "Aucun titre liké",
    noLikedSongsDesc: "Likez des chansons depuis le lecteur",
  },

  // Settings
  settings: {
    title: "Paramètres",
    language: "Langue",
    languageDesc: "Choisissez votre langue préférée",
    english: "English",
    french: "Français",
    appearance: "Apparence",
    theme: "Thème",
    themeDesc: "Personnalisez l'apparence de l'application",
    about: "À propos",
    appName: "Ebubefy",
    version: "v1.0.0",
    appDesc:
      "Un lecteur de musique moderne qui recherche des chansons sur YouTube et affiche les paroles synchronisées. Vos données sont stockées localement sur cette machine.",
    audio: "Audio",
    audioDesc: "Égaliseur, fondu enchaîné et qualité",
    equalizer: "Égaliseur",
    equalizerDesc: "Égaliseur paramétrique 10 bandes avec préréglages",
    equalizerPreset: "Préréglage",
    equalizerReset: "Réinitialiser",
    crossfade: "Fondu enchaîné",
    crossfadeDesc: "Fondu entre les pistes",
    crossfadeOff: "Désactivé",
    crossfadeSeconds: "{{n}} secondes",
    sleepTimer: "Minuterie de sommeil",
    sleepTimerDesc: "Mettre en pause après un certain temps",
    sleepTimerOff: "Désactivé",
    dataSources: "Sources de données",
    dataSourcesDesc: "État des services externes",
    dataSourcesCheck: "Vérifier",
    dataSourcesChecking: "Vérification...",
    dataSourcesOk: "Opérationnel",
    dataSourcesError: "Indisponible",
    features: {
      youtube: "🎵 Recherche YouTube",
      lyrics: "📝 Paroles synchronisées",
      local: "💾 Playlists locales",
    },
  },

  // Now Playing
  nowPlaying: {
    nowPlaying: "En cours de lecture",
    queue: "File d'attente",
    addToPlaylist: "Ajouter à la playlist",
    noTrack: "Aucun titre sélectionné",
    noTrackDesc: "Choisissez une chanson à lire",
    noLyrics: "Aucun texte trouvé",
    lyrics: "Paroles",
    showLyrics: "Afficher les paroles",
    hideLyrics: "Masquer les paroles",
  },

  // Common
  common: {
    loading: "Chargement...",
    error: "Une erreur est survenue",
    retry: "Réessayer",
  },
} as const;

export default fr;
