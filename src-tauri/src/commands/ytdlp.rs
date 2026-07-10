use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

/// Stores the path to a working yt-dlp binary (set after verification)
static YT_DLP_PATH: OnceLock<String> = OnceLock::new();

/// Stores where yt-dlp is being downloaded to (background download in progress)
static YT_DLP_DOWNLOAD_TARGET: OnceLock<String> = OnceLock::new();

/// Find or download yt-dlp. Called once during app setup.
pub fn ensure_ytdlp(resource_dir: &Path) {
    // ── Phase 1: Log resource dir contents (for debugging) ──
    println!("[ebubfy] Scanning for yt-dlp in: {:?}", resource_dir);
    if let Ok(entries) = std::fs::read_dir(resource_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            println!("[ebubfy]   {:?} ({} bytes)", path.file_name().unwrap_or_default(), size);
        }
    } else {
        println!("[ebubfy]   (cannot read dir)");
    }

    // ── Phase 2: Search resource dir at all possible locations ──
    let candidates = if cfg!(target_os = "windows") {
        vec![
            resource_dir.join("yt-dlp.exe"),                    // flat
            resource_dir.join("resources").join("yt-dlp.exe"),  // with prefix
            resource_dir.join("bin").join("yt-dlp.exe"),        // bin subdir
        ]
    } else {
        vec![
            resource_dir.join("yt-dlp"),
            resource_dir.join("resources").join("yt-dlp"),
        ]
    };

    for candidate in &candidates {
        if candidate.exists() {
            let path_str = candidate.to_string_lossy().to_string();
            println!("[ebubfy] Found yt-dlp at: {}, checking if it works...", path_str);
            if test_ytdlp(candidate) {
                println!("[ebubfy] ✅ yt-dlp ready: {}", path_str);
                let _ = YT_DLP_PATH.set(path_str);
                return;
            } else {
                println!("[ebubfy] ❌ Found but can't execute (missing DLLs?): {}", path_str);
            }
        }
    }

    // ── Phase 3: Check PATH ──
    for name in &["yt-dlp.exe", "yt-dlp"] {
        if test_ytdlp(Path::new(name)) {
            println!("[ebubfy] ✅ yt-dlp found in PATH: {}", name);
            let _ = YT_DLP_PATH.set(name.to_string());
            return;
        }
    }

    // ── Phase 4: Auto-download from GitHub ──
    let target = resource_dir.join("yt-dlp.exe");
    let target_str = target.to_string_lossy().to_string();
    println!("[ebubfy] ⏳ yt-dlp not found. Downloading to: {}", target_str);

    let _ = YT_DLP_DOWNLOAD_TARGET.set(target_str.clone());

    std::thread::spawn(move || {
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

        println!("[ebubfy] Downloading yt-dlp from {} ...", url);

        // Use PowerShell on Windows (built-in, no extra deps)
        let result = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; \
                     Invoke-WebRequest -Uri '{}' -OutFile '{}'",
                    url, target_str
                ),
            ])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                let size = std::fs::metadata(&target_str)
                    .map(|m| m.len())
                    .unwrap_or(0);
                println!("[ebubfy] ✅ yt-dlp downloaded! ({} bytes)", size);

                if test_ytdlp(Path::new(&target_str)) {
                    println!("[ebubfy] ✅ yt-dlp verified and ready");
                    let _ = YT_DLP_PATH.set(target_str);
                } else {
                    println!("[ebubfy] ❌ Downloaded yt-dlp can't run (VC++ runtime missing?)");
                }
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                println!("[ebubfy] ❌ Download failed. STDOUT: {}", stdout);
                println!("[ebubfy] ❌ Download failed. STDERR: {}", stderr);
            }
            Err(e) => {
                println!("[ebubfy] ❌ Download couldn't start: {}", e);
            }
        }
    });
}

/// Test whether yt-dlp at a path actually runs (--version succeeds)
fn test_ytdlp(path: &Path) -> bool {
    let mut cmd = silent_command(path);
    let result = cmd.arg("--version").output();
    match result {
        Ok(output) => output.status.success(),
        Err(e) => {
            println!("[ebubfy] yt-dlp test failed at {:?}: {}", path, e);
            false
        }
    }
}

/// Create a Command that won't show a console window on Windows
#[cfg(target_os = "windows")]
fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

/// Create a Command that won't show a console window on Windows
#[cfg(not(target_os = "windows"))]
fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    Command::new(program)
}

/// Creates a new yt-dlp command with the correct path, suppressing console windows.
///
/// Resolution order:
/// 1. Previously verified path (from `ensure_ytdlp` or a prior call)
/// 2. Completed download (check if download finished)
/// 3. Fallback to PATH
/// 4. Default "yt-dlp" (will fail with a clear error)
pub fn ytdlp_command() -> Command {
    // 1. Already found & verified
    if let Some(path) = YT_DLP_PATH.get() {
        return silent_command(path);
    }

    // 2. Download might have completed since we last checked
    if let Some(dl_path) = YT_DLP_DOWNLOAD_TARGET.get() {
        let p = Path::new(dl_path);
        if p.exists() && test_ytdlp(p) {
            println!("[ebubfy] ✅ Download completed, using: {}", dl_path);
            let _ = YT_DLP_PATH.set(dl_path.clone());
            return silent_command(dl_path);
        }
    }

    // 3. Try PATH as last resort
    for name in &["yt-dlp.exe", "yt-dlp"] {
        if test_ytdlp(Path::new(name)) {
            println!("[ebubfy] ✅ yt-dlp found on PATH: {}", name);
            let _ = YT_DLP_PATH.set(name.to_string());
            return silent_command(name);
        }
    }

    // 4. Default (will fail at .output() with a clear OS error)
    silent_command("yt-dlp")
}
