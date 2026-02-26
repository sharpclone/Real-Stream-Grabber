#!/usr/bin/env python3
import json
import logging
import os
import sys
import re
import struct
import threading
import subprocess
import sys
import time
from pathlib import Path
from shutil import which

BASE_DIR = Path(__file__).resolve().parent

def _resolve_log_path():
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP")
        if base:
            log_dir = Path(base) / "RealStreamGrabber"
            try:
                log_dir.mkdir(parents=True, exist_ok=True)
                return log_dir / "native-host.log"
            except Exception:
                pass
    return BASE_DIR / "native-host.log"


LOG_FILE = _resolve_log_path()

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(message)s",
    encoding="utf-8"
)

logging.info("Native host started")

SEND_LOCK = threading.Lock()
PROCESS_LOCK = threading.Lock()
ACTIVE_PROCESSES = {}
DOWNLOAD_SEMAPHORE = threading.Semaphore(3)
PROGRESS_PATTERN = re.compile(r"(\d{1,3}(?:[.,]\d+)?)%")
PLAYLIST_ITEM_PATTERN = re.compile(r"Downloading (?:item|video) (\d+) of (\d+)", re.IGNORECASE)
FRAGMENT_PATTERN = re.compile(r"frag\s*=?\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)
PHASE_PATTERNS = (
    (re.compile(r"Downloading video", re.IGNORECASE), "downloading video"),
    (re.compile(r"Downloading audio", re.IGNORECASE), "downloading audio"),
    (re.compile(r"Merging formats", re.IGNORECASE), "merging"),
)


def is_youtube_url(url):
    return "youtube.com" in (url or "") or "youtu.be" in (url or "")


def iter_process_output(stream):
    buffer = bytearray()
    while True:
        chunk = stream.read(4096)
        if not chunk:
            if buffer:
                yield buffer.decode("utf-8", errors="replace")
            break
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8", errors="replace")
        for byte in chunk:
            if byte in (10, 13):
                if buffer:
                    yield buffer.decode("utf-8", errors="replace")
                    buffer.clear()
                continue
            buffer.append(byte)


def read_native_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    message_length = struct.unpack("<I", raw_length)[0]
    message_bytes = sys.stdin.buffer.read(message_length)
    return json.loads(message_bytes.decode("utf-8"))


def send_native_message(message):
    encoded = json.dumps(message).encode("utf-8")
    with SEND_LOCK:
        sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()


def build_command(payload):
    yt_dlp_path = resolve_yt_dlp(payload)
    cmd = [yt_dlp_path] if yt_dlp_path else ["yt-dlp"]
    cmd.append("--no-colors")
    if sys.platform.startswith("win") and not payload.get("forceIpv6"):
        cmd.append("--force-ipv4")
    warning = None
    format_mode = payload.get("formatMode")
    format_id = payload.get("formatId")
    resolution = payload.get("resolution") or ""
    sort_height = None
    if isinstance(payload.get("maxHeight"), int):
        sort_height = payload.get("maxHeight")
    if not sort_height and isinstance(resolution, str):
        height_match = re.search(r"(\d{3,4})", resolution)
        if height_match:
            sort_height = int(height_match.group(1))
    if not sort_height and isinstance(format_mode, str):
        height_match = re.search(r"height<=\s*(\d+)", format_mode)
        if height_match:
            sort_height = int(height_match.group(1))
    if payload.get("audioOnly") and not payload.get("youtubeOriginalAudio"):
        cmd.extend(["--extract-audio", "--audio-format", "mp3"])
    if payload.get("overwrite"):
        cmd.append("--force-overwrites")
    if "playlistEnabled" in payload:
        if payload.get("playlistEnabled"):
            cmd.append("--yes-playlist")
            playlist_max = payload.get("playlistMax")
            if isinstance(playlist_max, int) and playlist_max > 0:
                cmd.extend(["--playlist-end", str(playlist_max)])
        else:
            cmd.append("--no-playlist")
    url = payload.get("url", "")
    is_youtube = is_youtube_url(url)
    if payload.get("audioOnly"):
        # Generic HLS feeds often reject forced selectors like bestaudio/format_id.
        # Let yt-dlp choose automatically there; only force on YouTube.
        if is_youtube:
            if payload.get("youtubeOriginalAudio"):
                cmd.extend(["-f", format_id or "bestaudio/best"])
            elif payload.get("youtubeAudioFallback"):
                cmd.extend(["-f", "bestvideo*+bestaudio/best"])
            else:
                cmd.extend(["-f", format_id or "bestaudio"])
    else:
        if format_id:
            cmd.extend(["-f", format_id])
        elif sort_height:
            cmd.extend(["-S", f"res:{sort_height}"])
    output_template = payload.get("filename") or "%(title)s.%(ext)s"
    download_dir = payload.get("downloadDir")
    output_path = Path(output_template)
    if download_dir and not output_path.is_absolute():
        target_dir = Path(download_dir)
        if not target_dir.exists():
            fallback_dir = Path(default_download_dir())
            warning = f"Download folder not found. Using {fallback_dir}"
            target_dir = fallback_dir
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            logging.exception("Failed to create download directory")
        output_template = str(target_dir / output_template)
    cmd.extend(["-o", output_template, payload["url"]])
    if payload.get("useCookies"):
        cmd.extend(["--cookies-from-browser", "firefox"])
    if payload.get("merge_flag"):
        cmd.extend(["--merge-output-format", "mp4"])
    ffmpeg_path = payload.get("ffmpegPath") or find_ffmpeg_path()
    if ffmpeg_path:
        cmd.extend(["--ffmpeg-location", ffmpeg_path])
    concurrent_fragments = payload.get("concurrentFragments")
    url_hint = payload.get("url", "")
    is_hls = ".m3u8" in url_hint.lower()
    if not isinstance(concurrent_fragments, int) and is_hls:
        concurrent_fragments = 8
    if isinstance(concurrent_fragments, int) and concurrent_fragments > 0:
        if is_hls:
            cmd.append("--hls-prefer-native")
        cmd.extend(["--concurrent-fragments", str(concurrent_fragments)])
    cmd.append("--newline")
    if is_youtube:
        node_path = payload.get("nodePath") or find_node_path()
        if node_path:
            cmd.extend(["--js-runtimes", f"node:{node_path}"])
    return cmd, warning


def resolve_yt_dlp(payload):
    if payload.get("ytDlpPath"):
        return payload.get("ytDlpPath")
    local_name = "yt-dlp.exe" if sys.platform.startswith("win") else "yt-dlp"
    local_path = BASE_DIR / local_name
    if local_path.exists():
        return str(local_path)
    bundled_path = BASE_DIR.parent / "bin" / local_name
    if bundled_path.exists():
        return str(bundled_path)
    return which("yt-dlp")


def find_node_path():
    local_candidate = BASE_DIR.parent / "bin" / "node" / "node.exe"
    if local_candidate.exists():
        return str(local_candidate)
    env_path = os.environ.get("NODE_PATH") or os.environ.get("NODEJS_PATH")
    if env_path and os.path.exists(env_path):
        return env_path
    node_path = which("node")
    if node_path:
        return node_path
    if sys.platform.startswith("win"):
        candidates = [
            os.path.join(os.environ.get("ProgramFiles", ""), "nodejs", "node.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", ""), "nodejs", "node.exe"),
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ]
        for candidate in candidates:
            if candidate and os.path.exists(candidate):
                return candidate
        # Registry fallback
        try:
            import winreg  # type: ignore

            reg_paths = [
                r"SOFTWARE\Node.js",
                r"SOFTWARE\WOW6432Node\Node.js",
            ]
            for reg_path in reg_paths:
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, reg_path) as key:
                        install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                        candidate = os.path.join(install_path, "node.exe")
                        if os.path.exists(candidate):
                            return candidate
                except FileNotFoundError:
                    continue
        except Exception:
            pass
    return None


def find_ffmpeg_path():
    local_dir = BASE_DIR.parent / "bin" / "ffmpeg"
    local_exe = local_dir / ("ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg")
    if local_exe.exists():
        return str(local_dir)
    local_flat = BASE_DIR.parent / ("ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg")
    if local_flat.exists():
        return str(local_flat)
    env_path = os.environ.get("FFMPEG_PATH")
    if env_path and os.path.exists(env_path):
        return env_path
    ffmpeg_path = which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path
    if sys.platform.startswith("win"):
        candidates = [
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                return candidate
    return None


def run_command(args, timeout=None):
    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            text=True,
            timeout=timeout
        )
        return {"code": result.returncode, "output": result.stdout.strip()}
    except subprocess.TimeoutExpired:
        return {"code": 124, "output": "Command timed out"}
    except Exception as exc:
        return {"code": 1, "output": str(exc)}


def default_download_dir():
    if sys.platform.startswith("win"):
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            downloads = Path(user_profile) / "Downloads"
            return str(downloads)
        home_drive = os.environ.get("HOMEDRIVE")
        home_path = os.environ.get("HOMEPATH")
        if home_drive and home_path:
            downloads = Path(home_drive + home_path) / "Downloads"
            return str(downloads)
    home = Path.home()
    downloads = home / "Downloads"
    return str(downloads if downloads.exists() else home)


def pick_folder():
    try:
        import tkinter  # type: ignore
        from tkinter import filedialog  # type: ignore
    except Exception as exc:
        if sys.platform.startswith("win"):
            try:
                script = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "$f=New-Object System.Windows.Forms.FolderBrowserDialog;"
                    "if($f.ShowDialog() -eq 'OK'){[Console]::Write($f.SelectedPath)}"
                )
                result = subprocess.run(
                    ["powershell.exe", "-NoProfile", "-Command", script],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=False,
                )
                if result.returncode == 0 and result.stdout.strip():
                    return {"ok": True, "path": result.stdout.strip()}
                if result.stderr.strip():
                    return {"ok": False, "error": result.stderr.strip()}
                return {"ok": False, "error": "No folder selected"}
            except Exception as win_exc:
                return {"ok": False, "error": f"picker failed: {win_exc}"}
        return {"ok": False, "error": f"tkinter unavailable: {exc}"}

    try:
        root = tkinter.Tk()
        root.withdraw()
        path = filedialog.askdirectory()
        root.destroy()
        if not path:
            return {"ok": False, "error": "No folder selected"}
        return {"ok": True, "path": path}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def probe_formats(url, use_cookies, node_path=None, yt_dlp_path=None):
    cmd = [yt_dlp_path] if yt_dlp_path else ["yt-dlp"]
    cmd.extend(["-J", "--no-playlist", url])
    if use_cookies:
        cmd.extend(["--cookies-from-browser", "firefox"])
    if "youtube.com" in url or "youtu.be" in url:
        node_runtime = node_path or find_node_path()
        if node_runtime:
            cmd.extend(["--js-runtimes", f"node:{node_runtime}"])
    result = run_command(cmd, timeout=8)
    if result["code"] != 0:
        return {"ok": False, "error": result["output"]}
    try:
        data = json.loads(result["output"])
    except json.JSONDecodeError:
        return {"ok": False, "error": "Failed to parse yt-dlp output"}

    formats = data.get("formats", [])
    video_formats = [
        f
        for f in formats
        if f.get("vcodec") not in (None, "none")
        and isinstance(f.get("height"), int)
        and f.get("height") <= 1080
    ]
    audio_formats = [
        f
        for f in formats
        if f.get("acodec") not in (None, "none") and f.get("vcodec") == "none"
    ]

    video_formats.sort(key=lambda f: (f.get("height", 0), f.get("tbr", 0)), reverse=True)
    audio_formats.sort(key=lambda f: (f.get("abr", 0), f.get("tbr", 0)), reverse=True)

    best_video = video_formats[0]["format_id"] if video_formats else None
    best_audio = audio_formats[0]["format_id"] if audio_formats else None

    if best_video and best_audio:
        format_mode = f"{best_video}+{best_audio}/best[height<=1080]"
    elif best_video:
        format_mode = f"{best_video}/best[height<=1080]"
    elif best_audio:
        format_mode = f"{best_audio}/bestaudio/best"
    else:
        format_mode = "best[height<=1080]/best"

    return {"ok": True, "formatMode": format_mode}


def _split_filename(filename_template):
    template = filename_template or ""
    if "%(ext)s" in template:
        base = template.replace(".%(ext)s", "")
        return base, True
    return template, False


def _next_available_name(directory, base_name):
    counter = 1
    while True:
        candidate = f"{base_name} ({counter})"
        if not any(directory.glob(f"{candidate}.*")):
            return candidate
        counter += 1


def check_file_status(filename_template, download_dir=None):
    if not filename_template:
        return {"exists": False}
    base, has_template = _split_filename(filename_template)
    base_path = Path(base)
    if base_path.is_absolute():
        directory = base_path.parent
    else:
        directory = Path(download_dir) if download_dir else BASE_DIR
    stem = base_path.name
    exists = any(directory.glob(f"{stem}.*")) if has_template else (directory / stem).exists()
    suggested = None
    if exists:
        suggested = _next_available_name(directory, stem)
    return {"exists": exists, "suggested": suggested}


def execute_download(payload):
    def worker():
        DOWNLOAD_SEMAPHORE.acquire()
        try:
            download_id = payload.get("downloadId")
            attempts = [dict(payload)]
            if payload.get("audioOnly") and is_youtube_url(payload.get("url", "")):
                original_audio_attempt = dict(payload)
                original_audio_attempt["youtubeOriginalAudio"] = True
                fallback_attempt = dict(payload)
                fallback_attempt["youtubeAudioFallback"] = True
                attempts = [original_audio_attempt, fallback_attempt]

            final_error = None
            for index, attempt_payload in enumerate(attempts):
                if index == 1:
                    send_native_message(
                        {
                            "event": "phase",
                            "downloadId": download_id,
                            "phase": "fallback: extracting audio"
                        }
                    )
                    send_native_message(
                        {
                            "event": "warning",
                            "downloadId": download_id,
                            "message": "Original audio unavailable. Falling back to extraction."
                        }
                    )

                command, warning = build_command(attempt_payload)
                if warning:
                    send_native_message(
                        {
                            "event": "warning",
                            "downloadId": download_id,
                            "message": warning
                        }
                    )
                logging.info("Executing command: %s", " ".join(command))
                process = subprocess.Popen(
                    command,
                    cwd=str(BASE_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=False,
                    bufsize=0
                )
                if download_id:
                    with PROCESS_LOCK:
                        ACTIVE_PROCESSES[download_id] = process
                    send_native_message(
                        {
                            "event": "phase",
                            "downloadId": download_id,
                            "phase": "downloading"
                        }
                    )
                logging.info("yt-dlp started with pid %s", process.pid)
                output_lines = []
                last_progress_log = 0.0
                playlist_state = {"item": None, "total": None}
                if process.stdout:
                    for raw_line in iter_process_output(process.stdout):
                        line = raw_line.strip()
                        if line:
                            output_lines.append(line)
                            if len(output_lines) > 200:
                                output_lines.pop(0)
                        playlist_match = PLAYLIST_ITEM_PATTERN.search(line)
                        if playlist_match:
                            try:
                                playlist_state["item"] = int(playlist_match.group(1))
                                playlist_state["total"] = int(playlist_match.group(2))
                                send_native_message(
                                    {
                                        "event": "playlist",
                                        "downloadId": download_id,
                                        "item": playlist_state["item"],
                                        "total": playlist_state["total"]
                                    }
                                )
                            except Exception:
                                pass
                        for pattern, phase in PHASE_PATTERNS:
                            if pattern.search(line):
                                send_native_message(
                                    {
                                        "event": "phase",
                                        "downloadId": download_id,
                                        "phase": phase
                                    }
                                )
                                break
                        match = PROGRESS_PATTERN.search(line)
                        if match:
                            percent_text = match.group(1).replace(",", ".")
                            try:
                                percent_value = float(percent_text)
                            except ValueError:
                                percent_value = None
                            if percent_value is None:
                                continue
                            overall_percent = percent_value
                            if playlist_state["item"] and playlist_state["total"]:
                                overall_percent = (
                                    (playlist_state["item"] - 1 + percent_value / 100.0)
                                    / playlist_state["total"]
                                    * 100.0
                                )
                            send_native_message(
                                {
                                    "event": "progress",
                                    "downloadId": download_id,
                                    "percent": overall_percent
                                }
                            )
                            now = time.time()
                            if now - last_progress_log > 1.5:
                                logging.debug(
                                    "Progress %s%% (line=%s)",
                                    round(overall_percent, 2),
                                    line[:200]
                                )
                                last_progress_log = now
                            continue
                        frag_match = FRAGMENT_PATTERN.search(line)
                        if frag_match:
                            try:
                                frag_index = int(frag_match.group(1))
                                frag_total = int(frag_match.group(2))
                            except ValueError:
                                frag_index = None
                                frag_total = None
                            if frag_index and frag_total:
                                percent_value = frag_index / frag_total * 100.0
                                overall_percent = percent_value
                                if playlist_state["item"] and playlist_state["total"]:
                                    overall_percent = (
                                        (playlist_state["item"] - 1 + percent_value / 100.0)
                                        / playlist_state["total"]
                                        * 100.0
                                    )
                                send_native_message(
                                    {
                                        "event": "progress",
                                        "downloadId": download_id,
                                        "percent": overall_percent
                                    }
                                )
                                now = time.time()
                                if now - last_progress_log > 1.5:
                                    logging.debug(
                                        "Progress %s%% (frag line=%s)",
                                        round(overall_percent, 2),
                                        line[:200]
                                    )
                                    last_progress_log = now
                process.wait()
                logging.info("yt-dlp exited with %s", process.returncode)
                decoded = "\n".join(output_lines).strip()
                if process.returncode == 0:
                    send_native_message({"event": "completed", "downloadId": download_id})
                    final_error = None
                    break

                final_error = decoded[:1024] or "yt-dlp failed"
                logging.error("yt-dlp failed (exit %s): %s", process.returncode, final_error)

            if final_error:
                send_native_message(
                    {
                        "event": "error",
                        "downloadId": download_id,
                        "message": final_error
                    }
                )
        except Exception as exc:
            logging.exception("Failed to spawn yt-dlp")
            send_native_message({"status": "process_failed", "error": str(exc)})
        finally:
            download_id = payload.get("downloadId")
            if download_id:
                with PROCESS_LOCK:
                    ACTIVE_PROCESSES.pop(download_id, None)
            for handler in logging.getLogger().handlers:
                handler.flush()
            DOWNLOAD_SEMAPHORE.release()

    threading.Thread(target=worker, daemon=True).start()
    send_native_message({"status": "queued", "url": payload.get("url")})


def cancel_download(download_id):
    if not download_id:
        return {"ok": False, "error": "Missing downloadId"}
    with PROCESS_LOCK:
        process = ACTIVE_PROCESSES.get(download_id)
    if not process:
        return {"ok": False, "error": "Download not found"}
    try:
        if sys.platform.startswith("win"):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        else:
            process.terminate()
            process.wait(timeout=5)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass
    finally:
        with PROCESS_LOCK:
            ACTIVE_PROCESSES.pop(download_id, None)
    return {"ok": True}


def main():
    while True:
        try:
            message = read_native_message()
        except (KeyboardInterrupt, SystemExit):
            break
        except Exception as exc:
            send_native_message({"status": "error", "error": str(exc)})
            continue

        action = message.get("action")
        payload = message.get("payload", {})
        logging.info("Received message action=%s url=%s useCookies=%s", action, payload.get("url"), payload.get("useCookies"))
        if action == "download":
            url = payload.get("url")
            if not url:
                send_native_message({"status": "error", "error": "Missing URL"})
                continue
            execute_download(payload)
        elif action == "checkFile":
            status = check_file_status(payload.get("filename"), payload.get("downloadDir"))
            send_native_message(
                {
                    "event": "checkFileResult",
                    "requestId": payload.get("requestId"),
                    "exists": status["exists"],
                    "suggested": status.get("suggested")
                }
            )
        elif action == "preflight":
            yt_dlp_path = resolve_yt_dlp(payload)
            yt = run_command([yt_dlp_path or "yt-dlp", "--version"])
            node_path = find_node_path()
            node_ok = node_path is not None
            ffmpeg_path = find_ffmpeg_path()
            logging.info(
                "Preflight node_path=%s ffmpeg_path=%s default_download_dir=%s",
                node_path,
                ffmpeg_path,
                default_download_dir()
            )
            send_native_message(
                {
                    "event": "preflightResult",
                    "requestId": payload.get("requestId"),
                    "ytDlpVersion": yt["output"],
                    "ytDlpOk": yt["code"] == 0,
                    "nodeOk": node_ok,
                    "nodePath": node_path or "",
                    "ffmpegOk": ffmpeg_path is not None,
                    "ffmpegPath": ffmpeg_path or "",
                    "defaultDownloadDir": default_download_dir()
                }
            )
        elif action == "probeFormats":
            url = payload.get("url")
            if not url:
                send_native_message(
                    {
                        "event": "probeResult",
                        "requestId": payload.get("requestId"),
                        "ok": False,
                        "error": "Missing URL"
                    }
                )
                continue
            def _probe_worker():
                result = probe_formats(
                    url,
                    payload.get("useCookies"),
                    payload.get("nodePath"),
                    payload.get("ytDlpPath") or resolve_yt_dlp(payload)
                )
                send_native_message(
                    {
                        "event": "probeResult",
                        "requestId": payload.get("requestId"),
                        "ok": result.get("ok", False),
                        "formatMode": result.get("formatMode"),
                        "error": result.get("error")
                    }
                )

            threading.Thread(target=_probe_worker, daemon=True).start()
        elif action == "pickFolder":
            result = pick_folder()
            send_native_message(
                {
                    "event": "pickFolderResult",
                    "requestId": payload.get("requestId"),
                    "ok": result.get("ok", False),
                    "path": result.get("path", ""),
                    "error": result.get("error", "")
                }
            )
        elif action == "cancel":
            result = cancel_download(payload.get("downloadId"))
            if result.get("ok"):
                send_native_message(
                    {"event": "cancelled", "downloadId": payload.get("downloadId")}
                )
            else:
                send_native_message(
                    {
                        "event": "error",
                        "downloadId": payload.get("downloadId"),
                        "message": result.get("error", "Cancel failed")
                    }
                )
        else:
            send_native_message({"status": "ignored", "note": f"Unknown action {action}"})


if __name__ == "__main__":
    main()
