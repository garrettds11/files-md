//! Read aloud: turn document text into an audio file, cached by MD5.
//!
//! - Local engine: Windows speech voices (WinRT `SpeechSynthesizer`), fully offline.
//! - Remote engine: any OpenAI-compatible `/audio/speech` endpoint, only when the
//!   user configures it. Document text is sent to that endpoint.
//!
//! Audio is cached in `%LOCALAPPDATA%\<app id>\tts-cache\<md5>.<wav|mp3>`.
//! The MD5 covers the spoken text plus the engine and voice settings, so an
//! edited file or a different voice produces a new cache entry.

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CACHE_DIR: &str = "tts-cache";
/// OpenAI's speech endpoint accepts up to 4096 characters per request.
const REMOTE_CHUNK: usize = 3800;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    pub text: String,
    /// "local" | "remote"
    pub engine: String,
    /// Local voice id ("" = Windows default voice).
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub remote_url: String,
    #[serde(default)]
    pub remote_key: String,
    #[serde(default)]
    pub remote_model: String,
    #[serde(default)]
    pub remote_voice: String,
}

#[derive(Serialize)]
pub struct TtsAudio {
    path: String,
    hash: String,
    cached: bool,
    bytes: u64,
}

#[derive(Serialize)]
pub struct Voice {
    id: String,
    name: String,
    language: String,
}

#[derive(Serialize)]
pub struct CacheInfo {
    dir: String,
    files: u64,
    bytes: u64,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No app data folder: {e}"))?
        .join(CACHE_DIR);
    Ok(dir)
}

fn cache_key(req: &TtsRequest) -> (String, &'static str) {
    let mut h = Md5::new();
    let (settings, ext) = if req.engine == "remote" {
        (
            format!("remote\n{}\n{}\n{}", req.remote_url.trim(), req.remote_model.trim(), req.remote_voice.trim()),
            "mp3",
        )
    } else {
        (format!("local\n{}", req.voice), "wav")
    };
    h.update(settings.as_bytes());
    h.update(b"\n--\n");
    h.update(req.text.as_bytes());
    (format!("{:x}", h.finalize()), ext)
}

fn cached_file(app: &AppHandle, req: &TtsRequest) -> Result<(PathBuf, String), String> {
    let (hash, ext) = cache_key(req);
    Ok((cache_dir(app)?.join(format!("{hash}.{ext}")), hash))
}

fn audio_result(path: PathBuf, hash: String, cached: bool) -> TtsAudio {
    let bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    TtsAudio { path: path.to_string_lossy().to_string(), hash, cached, bytes }
}

/// Is there already audio for this exact text + voice? Never generates anything.
#[tauri::command]
pub fn tts_lookup(app: AppHandle, req: TtsRequest) -> Result<Option<TtsAudio>, String> {
    let (path, hash) = cached_file(&app, &req)?;
    Ok(path.is_file().then(|| audio_result(path, hash, true)))
}

/// Return cached audio, or generate it (can take a while for long documents).
#[tauri::command]
pub async fn tts_generate(app: AppHandle, req: TtsRequest) -> Result<TtsAudio, String> {
    let (path, hash) = cached_file(&app, &req)?;
    if path.is_file() {
        return Ok(audio_result(path, hash, true));
    }
    if req.text.trim().is_empty() {
        return Err("This document has no text to read.".into());
    }
    let dir = path.parent().unwrap().to_path_buf();
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the audio cache folder {}: {e}", dir.display()))?;

    let job = req.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if job.engine == "remote" {
            synthesize_remote(&job)
        } else {
            synthesize_local(&job.text, &job.voice)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    // Write to a temp file first so a half-written file is never treated as cached.
    let tmp = path.with_extension("part");
    fs::write(&tmp, &bytes).map_err(|e| format!("Couldn't save audio: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Couldn't save audio: {e}"))?;
    Ok(audio_result(path, hash, false))
}

#[tauri::command]
pub fn tts_voices() -> Result<Vec<Voice>, String> {
    list_local_voices()
}

#[tauri::command]
pub fn tts_cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    let dir = cache_dir(&app)?;
    let (mut files, mut bytes) = (0, 0);
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    files += 1;
                    bytes += m.len();
                }
            }
        }
    }
    Ok(CacheInfo { dir: dir.to_string_lossy().to_string(), files, bytes })
}

#[tauri::command]
pub fn tts_cache_clear(app: AppHandle) -> Result<(), String> {
    let dir = cache_dir(&app)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't clear the audio cache: {e}"))?;
    }
    Ok(())
}

// ------------------------------------------------------------------ remote

/// Split text into chunks under `max` chars, preferring paragraph, then
/// sentence, then word boundaries.
fn chunk_text(text: &str, max: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut cur = String::new();
    let push = |cur: &mut String, chunks: &mut Vec<String>| {
        if !cur.trim().is_empty() {
            chunks.push(cur.trim().to_string());
        }
        cur.clear();
    };
    for piece in text.split_inclusive(|c| c == '\n' || c == '.' || c == '!' || c == '?') {
        if cur.chars().count() + piece.chars().count() > max {
            push(&mut cur, &mut chunks);
        }
        if piece.chars().count() > max {
            for word in piece.split_inclusive(' ') {
                if cur.chars().count() + word.chars().count() > max {
                    push(&mut cur, &mut chunks);
                }
                cur.push_str(word);
            }
        } else {
            cur.push_str(piece);
        }
    }
    push(&mut cur, &mut chunks);
    chunks
}

fn synthesize_remote(req: &TtsRequest) -> Result<Vec<u8>, String> {
    let url = req.remote_url.trim();
    if url.is_empty() {
        return Err("Set the remote speech endpoint URL in Preferences.".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(180))
        .build();
    let model = if req.remote_model.trim().is_empty() { "gpt-4o-mini-tts" } else { req.remote_model.trim() };
    let voice = if req.remote_voice.trim().is_empty() { "alloy" } else { req.remote_voice.trim() };

    // MP3 frames can be concatenated directly, so each chunk is appended.
    let mut out = Vec::new();
    for chunk in chunk_text(&req.text, REMOTE_CHUNK) {
        let mut call = agent.post(url);
        if !req.remote_key.trim().is_empty() {
            call = call.set("Authorization", &format!("Bearer {}", req.remote_key.trim()));
        }
        let resp = call
            .send_json(serde_json::json!({
                "model": model,
                "voice": voice,
                "input": chunk,
                "response_format": "mp3",
            }))
            .map_err(|e| match e {
                ureq::Error::Status(code, r) => {
                    let body = r.into_string().unwrap_or_default();
                    format!("Speech service returned {code}: {}", body.chars().take(300).collect::<String>())
                }
                other => format!("Couldn't reach the speech service: {other}"),
            })?;
        resp.into_reader()
            .read_to_end(&mut out)
            .map_err(|e| format!("Couldn't read audio from the speech service: {e}"))?;
    }
    Ok(out)
}

// ------------------------------------------------------------------ local (Windows)

#[cfg(windows)]
fn list_local_voices() -> Result<Vec<Voice>, String> {
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;
    let voices = SpeechSynthesizer::AllVoices().map_err(|e| e.to_string())?;
    Ok(voices
        .into_iter()
        .map(|v| Voice {
            id: v.Id().map(|s| s.to_string()).unwrap_or_default(),
            name: v.DisplayName().map(|s| s.to_string()).unwrap_or_default(),
            language: v.Language().map(|s| s.to_string()).unwrap_or_default(),
        })
        .collect())
}

#[cfg(windows)]
fn synthesize_local(text: &str, voice_id: &str) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;
    use windows::Storage::Streams::DataReader;

    let err = |e: windows::core::Error| format!("Windows speech failed: {}", e.message());
    let synth = SpeechSynthesizer::new().map_err(err)?;
    if !voice_id.is_empty() {
        if let Ok(voices) = SpeechSynthesizer::AllVoices() {
            if let Some(v) = voices.into_iter().find(|v| v.Id().map(|id| id.to_string() == voice_id).unwrap_or(false)) {
                synth.SetVoice(&v).map_err(err)?;
            }
        }
    }
    let stream = synth
        .SynthesizeTextToStreamAsync(&HSTRING::from(text))
        .map_err(err)?
        .get()
        .map_err(err)?;
    let size = stream.Size().map_err(err)? as u32;
    let input = stream.GetInputStreamAt(0).map_err(err)?;
    let reader = DataReader::CreateDataReader(&input).map_err(err)?;
    reader.LoadAsync(size).map_err(err)?.get().map_err(err)?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).map_err(err)?;
    Ok(bytes)
}

#[cfg(not(windows))]
fn list_local_voices() -> Result<Vec<Voice>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
fn synthesize_local(_text: &str, _voice_id: &str) -> Result<Vec<u8>, String> {
    Err("Built-in voices are only available on Windows. Use a remote speech service instead.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_stay_under_limit_and_keep_text() {
        let text = "First sentence. Second one!\n\nA paragraph that goes on. ".repeat(200);
        let chunks = chunk_text(&text, 500);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.chars().count() <= 500));
        let joined: String = chunks.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
        let orig: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        assert_eq!(joined, orig);
    }

    #[test]
    fn cache_key_changes_with_text_and_voice() {
        let base = TtsRequest {
            text: "hello".into(),
            engine: "local".into(),
            voice: "a".into(),
            remote_url: String::new(),
            remote_key: "secret".into(),
            remote_model: String::new(),
            remote_voice: String::new(),
        };
        let mut other_text = base.clone();
        other_text.text = "hello!".into();
        let mut other_voice = base.clone();
        other_voice.voice = "b".into();
        let mut other_key = base.clone();
        other_key.remote_key = "different".into();
        assert_ne!(cache_key(&base).0, cache_key(&other_text).0);
        assert_ne!(cache_key(&base).0, cache_key(&other_voice).0);
        // The API key must not affect (or leak into) the cache name.
        assert_eq!(cache_key(&base).0, cache_key(&other_key).0);
        assert_eq!(cache_key(&base).1, "wav");
    }
}
