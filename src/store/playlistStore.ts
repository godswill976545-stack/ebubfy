import { create } from "zustand";
import type { Playlist, PlaylistSong } from "../types";
import * as api from "../lib/api";

interface PlaylistState {
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  playlistSongs: PlaylistSong[];
  favorites: PlaylistSong[];
  recentlyPlayed: PlaylistSong[];
  isLoading: boolean;

  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  selectPlaylist: (playlist: Playlist) => Promise<void>;
  addToPlaylist: (playlistId: number, song: PlaylistSong) => Promise<void>;
  removeFromPlaylist: (playlistId: number, videoId: string) => Promise<void>;
  reorderPlaylistSongs: (playlistId: number, videoIds: string[]) => Promise<void>;
  loadPlaylistTracks: (playlistId: number) => Promise<PlaylistSong[]>;
  loadFavorites: () => Promise<void>;
  isFavorite: (videoId: string) => boolean;
  toggleFavorite: (song: PlaylistSong) => Promise<void>;
  loadRecentlyPlayed: () => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  playlistSongs: [],
  favorites: [],
  recentlyPlayed: [],
  isLoading: false,

  loadPlaylists: async () => {
    set({ isLoading: true });
    try {
      const playlists = await api.getPlaylists();
      set({ playlists, isLoading: false });
    } catch (e) {
      console.error("Failed to load playlists:", e);
      set({ isLoading: false });
    }
  },

  createPlaylist: async (name) => {
    try {
      await api.createPlaylist(name);
      await get().loadPlaylists();
    } catch (e) {
      console.error("Failed to create playlist:", e);
    }
  },

  deletePlaylist: async (id) => {
    try {
      await api.deletePlaylist(id);
      set({ currentPlaylist: null, playlistSongs: [] });
      await get().loadPlaylists();
    } catch (e) {
      console.error("Failed to delete playlist:", e);
    }
  },

  selectPlaylist: async (playlist) => {
    set({ currentPlaylist: playlist, isLoading: true });
    try {
      const songs = await api.getPlaylistSongs(playlist.id);
      set({ playlistSongs: songs, isLoading: false });
    } catch (e) {
      console.error("Failed to load playlist songs:", e);
      set({ isLoading: false });
    }
  },

  addToPlaylist: async (playlistId, song) => {
    try {
      await api.addToPlaylist(playlistId, {
        videoId: song.video_id,
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
      });
      const { currentPlaylist } = get();
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        const songs = await api.getPlaylistSongs(playlistId);
        set({ playlistSongs: songs });
      }
    } catch (e) {
      console.error("Failed to add to playlist:", e);
    }
  },

  reorderPlaylistSongs: async (playlistId, videoIds) => {
    try {
      await api.reorderPlaylistSongs(playlistId, videoIds);
      const { currentPlaylist } = get();
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        const songs = await api.getPlaylistSongs(playlistId);
        set({ playlistSongs: songs });
      }
    } catch (e) {
      console.error("Failed to reorder playlist songs:", e);
    }
  },

  removeFromPlaylist: async (playlistId, videoId) => {
    try {
      await api.removeFromPlaylist(playlistId, videoId);
      const { currentPlaylist } = get();
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        const songs = await api.getPlaylistSongs(playlistId);
        set({ playlistSongs: songs });
      }
    } catch (e) {
      console.error("Failed to remove from playlist:", e);
    }
  },

  loadFavorites: async () => {
    try {
      const favorites = await api.getFavorites();
      set({ favorites });
    } catch (e) {
      console.error("Failed to load favorites:", e);
    }
  },

  loadPlaylistTracks: async (playlistId) => {
    try {
      const songs = await api.getPlaylistSongs(playlistId);
      return songs;
    } catch (e) {
      console.error("Failed to load playlist tracks:", e);
      return [];
    }
  },

  isFavorite: (videoId) => {
    const { favorites } = get();
    return favorites.some((f) => f.video_id === videoId);
  },

  toggleFavorite: async (song) => {
    try {
      await api.toggleFavorite({
        videoId: song.video_id,
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
      });
      await get().loadFavorites();
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  },

  loadRecentlyPlayed: async () => {
    try {
      const items = await api.getRecentlyPlayed();
      set({
        recentlyPlayed: items.map((item) => ({
          id: 0,
          playlist_id: 0,
          video_id: item.video_id,
          title: item.title,
          artist: item.artist,
          thumbnail: item.thumbnail,
          position: 0,
        })),
      });
    } catch (e) {
      console.error("Failed to load recently played:", e);
    }
  },
}));
