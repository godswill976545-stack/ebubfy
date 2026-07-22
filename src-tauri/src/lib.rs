mod commands;
mod db;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Find or auto-download yt-dlp for production builds.
            if let Ok(resource_dir) = app.path().resource_dir() {
                commands::ytdlp::ensure_ytdlp(&resource_dir);
            }

            db::init_database(&app_handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::youtube::search_youtube,
            commands::youtube::get_video_info,
            commands::youtube::search_artists,
            commands::youtube::get_artist_songs,
            commands::audio::get_stream_url,
            commands::audio::get_video_captions,
            commands::database::create_playlist,
            commands::database::delete_playlist,
            commands::database::get_playlists,
            commands::database::add_to_playlist,
            commands::database::remove_from_playlist,
            commands::database::get_playlist_songs,
            commands::database::toggle_favorite,
            commands::database::get_favorites,
            commands::database::add_recently_played,
            commands::database::get_recently_played,
            commands::database::save_preference,
            commands::database::get_preference,
            commands::database::reorder_playlist_songs,
            commands::audio::save_lyrics_file,
            commands::audio::load_lyrics_file,
            commands::lyrics::search_lyrics,
            commands::lyrics::get_lyrics_by_id,
            commands::lyrics::get_lyrics_translation,
            commands::enriched_search::search_youtube_enriched,
            commands::musicbrainz::musicbrainz_enrich,
            commands::musicbrainz::enrich_track_background,
            commands::album_artist::get_album_data,
            commands::album_artist::get_artist_data,
            commands::album_artist::get_artist_albums,
            commands::album_artist::get_track_metadata,
            commands::search_cache::cache_search,
            commands::search_cache::get_cached_search,
            commands::search_cache::get_search_history,
            commands::search_cache::clear_search_history,
            commands::search_cache::remove_history_entry,
            commands::search_cache::suggest_queries,
            commands::health::health_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ebubfy");
}
