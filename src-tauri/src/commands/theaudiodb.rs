// TheAudioDB enrichment was removed in favor of Deezer (which doesn't
// require a key, has 1000x more data, and doesn't rate-limit the free tier).
// This module is kept as a stub so existing references compile. The real
// enrichment pipeline now lives in `enriched_search.rs` and uses
// `super::deezer`.
