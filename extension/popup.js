const streamList = document.getElementById("stream-list");
const COOKIE_PREF_KEY = "useBrowserCookies";
const RENAME_PREF_KEY = "promptFilename";
const DOWNLOAD_DIR_KEY = "downloadDir";
const NODE_PATH_KEY = "nodePath";
const SORT_PREF_KEY = "popupSort";
const SORT_DIR_PREF_KEY = "popupSortDir";
const RESOLUTION_FILTER_PREF_KEY = "popupResolutionFilter";
const cookieToggle = document.getElementById("use-cookies");
const renameToggle = document.getElementById("ask-filename");
let useBrowserCookies = false;
let promptFilename = false;
let downloadDir = "";
let nodePath = "";
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalInput = document.getElementById("modal-input");
const modalActions = document.getElementById("modal-actions");
const youtubeActions = document.getElementById("youtube-actions");
const youtubeVideoBtn = document.getElementById("youtube-video");
const youtubeAudioBtn = document.getElementById("youtube-audio");
const youtubeWarning = document.getElementById("youtube-warning");
const youtubeResolution = document.getElementById("youtube-resolution");
const playlistOptions = document.getElementById("youtube-playlist-options");
const playlistToggle = document.getElementById("youtube-playlist-toggle");
const playlistMaxInput = document.getElementById("youtube-playlist-max");
const settingsBtn = document.getElementById("open-settings");
const sortBar = document.getElementById("sort-bar");
const resolutionFilterBar = document.getElementById("resolution-filter-bar");
let refreshTimer = null;
let activeTab = null;
let youtubeActive = false;
let preflightChecked = false;
let preflightState = null;
let nodePromptShown = false;
let youtubeMaxHeight = 1080;
let playlistDetected = false;
let lastStreams = [];
let currentSort = "default";
let sortDir = "asc";
let resolutionFilter = "all";

async function syncCookiePreference() {
  if (!cookieToggle) {
    return;
  }
  const { [COOKIE_PREF_KEY]: storedValue = false } =
    (await browser.storage.local.get(COOKIE_PREF_KEY)) || {};
  useBrowserCookies = !!storedValue;
  cookieToggle.checked = useBrowserCookies;
}

if (cookieToggle) {
  cookieToggle.addEventListener("change", (event) => {
    useBrowserCookies = event.target.checked;
    browser.storage.local.set({ [COOKIE_PREF_KEY]: event.target.checked });
  });
}

async function syncRenamePreference() {
  if (!renameToggle) {
    return;
  }
  const { [RENAME_PREF_KEY]: storedValue = false } =
    (await browser.storage.local.get(RENAME_PREF_KEY)) || {};
  promptFilename = !!storedValue;
  renameToggle.checked = promptFilename;
}

if (renameToggle) {
  renameToggle.addEventListener("change", (event) => {
    promptFilename = event.target.checked;
    browser.storage.local.set({ [RENAME_PREF_KEY]: event.target.checked });
  });
}

async function syncDownloadSettings() {
  const settings = await browser.storage.local.get([DOWNLOAD_DIR_KEY, NODE_PATH_KEY]);
  downloadDir = settings[DOWNLOAD_DIR_KEY] || "";
  nodePath = settings[NODE_PATH_KEY] || "";
}

async function syncViewPreferences() {
  const settings = await browser.storage.local.get([
    SORT_PREF_KEY,
    SORT_DIR_PREF_KEY,
    RESOLUTION_FILTER_PREF_KEY
  ]);
  currentSort = settings[SORT_PREF_KEY] || "default";
  sortDir = settings[SORT_DIR_PREF_KEY] || "asc";
  resolutionFilter = settings[RESOLUTION_FILTER_PREF_KEY] || "all";
}

function persistViewPreferences() {
  browser.storage.local.set({
    [SORT_PREF_KEY]: currentSort,
    [SORT_DIR_PREF_KEY]: sortDir,
    [RESOLUTION_FILTER_PREF_KEY]: resolutionFilter
  });
}

async function refreshStreams() {
  try {
    const background = await browser.runtime.getBackgroundPage();
    const streams =
      typeof background?.getStreamRecords === "function" ? background.getStreamRecords() : [];
    const tabInfo =
      typeof background?.getActiveTabInfo === "function" ? await background.getActiveTabInfo() : null;
    activeTab = tabInfo || null;
    const nextYouTubeActive = !!(activeTab && isYouTubeUrl(activeTab.url));
    if (nextYouTubeActive !== youtubeActive) {
      youtubeActive = nextYouTubeActive;
      updateYouTubeActions();
    }
    updatePlaylistOptions();
    const filtered =
      activeTab && activeTab.id != null
        ? streams.filter((stream) => stream.tabId === activeTab.id)
        : streams;
    lastStreams = filtered;
    renderStreams(applySort(applyFilters(filtered)));
  } catch (error) {
    setEmptyState("Unable to access the background script.");
  }
}

function setEmptyState(message) {
  streamList.textContent = "";
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  streamList.appendChild(empty);
}

function renderStreams(streams) {
  if (!streams.length) {
    const message = youtubeActive
      ? "Use the YouTube buttons above to download this page."
      : "Listening for media on the current tab…";
    setEmptyState(message);
    return;
  }
  streamList.textContent = "";
  for (const stream of streams) {
    const card = document.createElement("article");
    card.className = "stream-card";

    const body = document.createElement("div");
    body.className = "stream-card__body";

    const icon = document.createElement("span");
    icon.className = "stream-icon";
    icon.textContent = stream.type === "audio" ? "♪" : "🎬";

    const details = document.createElement("div");
    details.className = "stream-details";

    const title = document.createElement("p");
    title.className = "stream-title";
    title.textContent = stream.title || stream.filename || stream.url;

    const meta = document.createElement("p");
    meta.className = "stream-meta";
    const metaParts = [];
    if (stream.resolution) {
      metaParts.push(stream.resolution);
    }
    if (stream.sizeEstimate) {
      metaParts.push(stream.sizeEstimate);
    }
    if (stream.bitrateLabel) {
      metaParts.push(stream.bitrateLabel);
    }
    if (stream.duration) {
      metaParts.push(stream.duration);
    }
    meta.textContent = metaParts.join("  ·  ");

    details.appendChild(title);
    details.appendChild(meta);
    body.appendChild(icon);
    body.appendChild(details);

    if (stream.tag) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = stream.tag;
      body.appendChild(badge);
    }

    const footer = document.createElement("div");
    footer.className = "stream-card__footer";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "download-btn";
    const downloadStatus = stream.download?.status;
    downloadBtn.textContent = downloadStatus === "completed" ? "Download again" : "Download";
    downloadBtn.addEventListener("click", () => handleDownload(stream, downloadBtn));

    const actions = document.createElement("div");
    actions.className = "stream-card__actions";

    if (stream.type === "video" && !stream.isPage && stream.hasAudio !== false) {
      const audioBtn = document.createElement("button");
      audioBtn.className = "download-btn secondary";
      audioBtn.textContent = "Audio";
      audioBtn.addEventListener("click", () => handleAudioDownload(stream, audioBtn));
      actions.appendChild(audioBtn);
    }

    const status = document.createElement("div");
    status.className = "download-status";

    if (stream.download?.status) {
      const label = document.createElement("span");
      label.className = "download-label";
      label.textContent =
        stream.download.status === "prefetching"
          ? "Preparing download…"
          : stream.download.status;
      status.appendChild(label);

      if (stream.download.warning) {
        const warning = document.createElement("span");
        warning.className = "download-warning";
        warning.textContent = stream.download.warning;
        status.appendChild(warning);
      }

      const progress = document.createElement("div");
      progress.className = "progress";
      if (stream.download.status === "prefetching") {
        progress.classList.add("prefetching");
      }
      const bar = document.createElement("div");
      bar.className = "progress-bar";
      if (typeof stream.download.percent === "number") {
        bar.style.width = `${Math.min(100, Math.max(0, stream.download.percent))}%`;
      } else {
        bar.classList.add("indeterminate");
      }
      progress.appendChild(bar);
      status.appendChild(progress);
    }

    actions.appendChild(status);

    const cancellableStatuses = new Set([
      "queued",
      "prefetching",
      "downloading",
      "downloading video",
      "downloading audio",
      "merging"
    ]);
    if (cancellableStatuses.has(downloadStatus)) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "download-btn secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => handleCancel(stream));
      actions.appendChild(cancelBtn);
    }
    footer.appendChild(actions);
    if (!stream.download || downloadStatus === "error" || downloadStatus === "completed") {
      footer.appendChild(downloadBtn);
    }
    card.appendChild(body);
    card.appendChild(footer);
    streamList.appendChild(card);
  }
}

function isActiveDownload(stream) {
  const status = stream?.download?.status;
  return [
    "queued",
    "prefetching",
    "downloading",
    "downloading video",
    "downloading audio",
    "merging"
  ].includes(status);
}

function parseResolutionHeight(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const pMatch = text.match(/(\d{3,4})\s*p/i);
  if (pMatch) {
    return Number(pMatch[1]);
  }
  const dimMatch = text.match(/(\d{3,4})\s*x\s*(\d{3,4})/i);
  if (dimMatch) {
    return Number(dimMatch[2]);
  }
  const generic = text.match(/(\d{3,4})/);
  return generic ? Number(generic[1]) : null;
}

function applyFilters(streams) {
  if (!streams?.length || resolutionFilter === "all") {
    return streams;
  }
  const target = Number(resolutionFilter);
  if (Number.isNaN(target)) {
    return streams;
  }
  return streams.filter((stream) => parseResolutionHeight(stream.resolution) === target);
}

function compareStreams(a, b) {
  let left = 0;
  let right = 0;
  if (currentSort === "name") {
    left = (a.title || a.filename || a.url || "").toLowerCase();
    right = (b.title || b.filename || b.url || "").toLowerCase();
    if (left < right) return sortDir === "asc" ? -1 : 1;
    if (left > right) return sortDir === "asc" ? 1 : -1;
    return 0;
  }
  if (currentSort === "size") {
    left = parseSizeEstimate(a.sizeEstimate);
    right = parseSizeEstimate(b.sizeEstimate);
  } else if (currentSort === "duration") {
    left = parseDuration(a.duration);
    right = parseDuration(b.duration);
  } else {
    return (b.firstSeen || 0) - (a.firstSeen || 0);
  }
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left < right) return sortDir === "asc" ? -1 : 1;
  if (left > right) return sortDir === "asc" ? 1 : -1;
  return 0;
}

function applySort(streams) {
  if (!streams?.length) {
    return streams;
  }
  const active = [];
  const rest = [];
  for (const stream of streams) {
    if (isActiveDownload(stream)) {
      active.push(stream);
    } else {
      rest.push(stream);
    }
  }
  active.sort(compareStreams);
  rest.sort(compareStreams);
  return [...active, ...rest];
}

function parseSizeEstimate(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  if (Number.isNaN(number)) {
    return null;
  }
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return number * (multipliers[unit] || 1);
}

function parseDuration(value) {
  if (!value) {
    return null;
  }
  const parts = String(value).split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds || null;
}

async function handleDownload(stream, button) {
  if (!preflightChecked) {
    await runPreflight();
  }
  if (preflightState && preflightState.ffmpegOk === false) {
    await showModalChoice(
      "FFmpeg required",
      "FFmpeg is missing. Please install it to enable video/audio downloads.",
      [{ label: "OK", value: "ok", primary: true }]
    );
    button.disabled = false;
    button.textContent = "Download";
    return;
  }
  button.disabled = true;
  button.textContent = "Queued";
  let filename = stream.filename || "download";
  let overwrite = false;
  if (promptFilename) {
    const response = await showModalPrompt("Filename", "Enter the output file name.", filename);
    if (!response) {
      button.disabled = false;
      button.textContent = "Download";
      return;
    }
    filename = response;
  }
  const existsResult = await checkFileExists(`${filename}.%(ext)s`);
  if (existsResult?.exists) {
    const choice = await showModalChoice(
      "File already exists",
      "Choose how to proceed.",
      [
        { label: "Overwrite", value: "overwrite", primary: true },
        { label: "Rename", value: "rename" },
        { label: "Auto-number", value: "auto" },
        { label: "Cancel", value: "cancel" }
      ]
    );
    if (choice === "cancel" || !choice) {
      button.disabled = false;
      button.textContent = "Download";
      return;
    }
    if (choice === "overwrite") {
      overwrite = true;
    }
    if (choice === "rename") {
      const response = await showModalPrompt(
        "Filename",
        "Enter a new name.",
        existsResult.suggested || filename
      );
      if (!response) {
        button.disabled = false;
        button.textContent = "Download";
        return;
      }
      filename = response;
    } else if (choice === "auto" && existsResult.suggested) {
      filename = existsResult.suggested;
    }
  }
  const downloadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const isHls = stream.type === "hls" || /\.m3u8(?:[?#].*)?$/i.test(stream.url || "");
  const displayTitle = filename;
  const payload = {
    url: stream.url,
    filename: `${filename}.%(ext)s`,
    displayTitle,
    merge_flag: !!stream.merge_flag,
    formatId: stream.formatId,
    useCookies: useBrowserCookies,
    downloadDir,
    nodePath,
    overwrite,
    audioOnly: false,
    streamId: stream.id,
    concurrentFragments: isHls ? 8 : undefined,
    downloadId
  };
  try {
    const background = await browser.runtime.getBackgroundPage();
    await background.ensurePageEntry?.({
      url: stream.url,
      title: stream.title,
      displayTitle,
      filename: `${filename}.%(ext)s`,
      kind: payload.audioOnly ? "audio" : "video",
      resolution: stream.resolution,
      streamId: stream.id,
      tabId: stream.tabId,
      download: { id: payload.downloadId, status: "queued", percent: 0 }
    });
    await background.updateDownloadStatus?.({
      streamId: stream.id,
      download: { status: "queued", percent: 0 }
    });
    await background.requestDownload?.(payload);
  } catch (error) {
    console.error("Download request failed", error);
    button.textContent = "Error";
    button.disabled = false;
  }
}

async function handleCancel(stream) {
  if (!stream?.download?.id) {
    return;
  }
  try {
    const background = await browser.runtime.getBackgroundPage();
    await background.requestCancelDownload?.({ downloadId: stream.download.id });
    await background.updateDownloadStatus?.({
      streamId: stream.id,
      download: { status: "cancelled" }
    });
  } catch {
    // ignore
  }
}

async function handleAudioDownload(stream, button) {
  if (!preflightChecked) {
    await runPreflight();
  }
  if (preflightState && preflightState.ffmpegOk === false) {
    await showModalChoice(
      "FFmpeg required",
      "FFmpeg is missing. Please install it to enable audio downloads.",
      [{ label: "OK", value: "ok", primary: true }]
    );
    button.disabled = false;
    button.textContent = "Audio";
    return;
  }
  button.disabled = true;
  button.textContent = "Queued";
  let filename = stream.filename || "download";
  let overwrite = false;
  if (promptFilename) {
    const response = await showModalPrompt("Filename", "Enter the output file name.", filename);
    if (!response) {
      button.disabled = false;
      button.textContent = "Audio";
      return;
    }
    filename = response;
  }
  const existsResult = await checkFileExists(`${filename}.%(ext)s`);
  if (existsResult?.exists) {
    const choice = await showModalChoice(
      "File already exists",
      "Choose how to proceed.",
      [
        { label: "Overwrite", value: "overwrite", primary: true },
        { label: "Rename", value: "rename" },
        { label: "Auto-number", value: "auto" },
        { label: "Cancel", value: "cancel" }
      ]
    );
    if (choice === "cancel" || !choice) {
      button.disabled = false;
      button.textContent = "Audio";
      return;
    }
    if (choice === "overwrite") {
      overwrite = true;
    }
    if (choice === "rename") {
      const response = await showModalPrompt(
        "Filename",
        "Enter a new name.",
        existsResult.suggested || filename
      );
      if (!response) {
        button.disabled = false;
        button.textContent = "Audio";
        return;
      }
      filename = response;
    } else if (choice === "auto" && existsResult.suggested) {
      filename = existsResult.suggested;
    }
  }
  const downloadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const isHls = stream.type === "hls" || /\.m3u8(?:[?#].*)?$/i.test(stream.url || "");
  const displayTitle = filename;
  const payload = {
    url: stream.url,
    filename: `${filename}.%(ext)s`,
    displayTitle,
    merge_flag: false,
    formatId: stream.formatId,
    useCookies: useBrowserCookies,
    downloadDir,
    nodePath,
    overwrite,
    audioOnly: true,
    streamId: stream.id,
    concurrentFragments: isHls ? 8 : undefined,
    downloadId
  };
  try {
    const background = await browser.runtime.getBackgroundPage();
    await background.ensurePageEntry?.({
      url: stream.url,
      title: stream.title,
      displayTitle,
      filename: `${filename}.%(ext)s`,
      kind: "audio",
      resolution: stream.resolution,
      streamId: stream.id,
      tabId: stream.tabId,
      download: { id: payload.downloadId, status: "queued", percent: 0 }
    });
    await background.updateDownloadStatus?.({
      streamId: stream.id,
      download: { status: "queued", percent: 0 }
    });
    await background.requestDownload?.(payload);
  } catch (error) {
    console.error("Audio download failed", error);
    button.textContent = "Error";
    button.disabled = false;
  }
}

function isYouTubeUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function updateYouTubeActions() {
  if (!youtubeActions) {
    return;
  }
  youtubeActions.classList.toggle("hidden", !youtubeActive);
  if (sortBar) {
    sortBar.classList.toggle("hidden", youtubeActive);
  }
  if (resolutionFilterBar) {
    resolutionFilterBar.classList.toggle("hidden", youtubeActive);
  }
  if (youtubeActive && !preflightChecked) {
    runPreflight();
  }
  updateYouTubeWarning();
}

function updatePlaylistOptions() {
  if (!playlistOptions) {
    return;
  }
  const show = !!(youtubeActive && activeTab?.url && isYouTubePlaylistUrl(activeTab.url));
  playlistDetected = show;
  playlistOptions.classList.toggle("hidden", !show);
  if (!show) {
    if (playlistToggle) {
      playlistToggle.checked = false;
    }
    if (playlistMaxInput) {
      playlistMaxInput.value = "";
      playlistMaxInput.disabled = true;
    }
  }
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function isYouTubePlaylistUrl(url) {
  if (!isYouTubeUrl(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const list = parsed.searchParams.get("list");
    if (!list) {
      return false;
    }
    const path = parsed.pathname;
    if (path === "/playlist") {
      return true;
    }
    if (path === "/watch") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function handleYouTubeDownload(kind, button) {
  if (!activeTab?.url) {
    return;
  }
  if (!preflightChecked) {
    await runPreflight();
  }
  if (preflightState && preflightState.ffmpegOk === false) {
    await showModalChoice(
      "FFmpeg required",
      "FFmpeg is missing. Please install it to enable YouTube downloads.",
      [{ label: "OK", value: "ok", primary: true }]
    );
    return;
  }
  if (preflightState && (!preflightState.ytDlpOk || !preflightState.nodeOk)) {
    await showModalChoice(
      "YouTube requires yt-dlp + Node.js",
      "Update yt-dlp and install Node.js to solve YouTube signatures.",
      [{ label: "OK", value: "ok", primary: true }]
    );
    return;
  }
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Queued";
  const playlistEnabled = !!(playlistToggle?.checked && playlistDetected);
  const effectiveKind = kind;
  const resolutionLabel =
    effectiveKind === "audio"
      ? "audio"
      : youtubeMaxHeight
        ? `≤${youtubeMaxHeight}p`
        : "Max";
  const downloadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let streamId = playlistEnabled
    ? `youtube-playlist-${activeTab.id || "tab"}-${downloadId}`
    : `youtube-${effectiveKind}-${activeTab.id || "tab"}`;
  let overwrite = false;
  try {
    const background = await browser.runtime.getBackgroundPage();
    const ensureResult = await background.ensurePageEntry?.({
      url: activeTab.url,
      title: activeTab.title,
      displayTitle: playlistEnabled ? filename : null,
      filename: "download",
      kind: effectiveKind,
      resolution: resolutionLabel,
      streamId,
      tabId: activeTab.id,
      playlistEnabled,
      download: { id: downloadId, status: "prefetching", percent: null }
    });
    if (ensureResult?.id) {
      streamId = ensureResult.id;
    }
    setTimeout(async () => {
      try {
        const entries = background.getStreamRecords?.() || [];
        const entry = entries.find((item) => item.id === streamId);
        if (entry?.download?.id === downloadId && entry.download.status === "prefetching") {
          await background.updateDownloadStatus?.({
            streamId,
            download: { status: "queued", percent: 0 }
          });
        }
      } catch {
        // ignore
      }
    }, 8000);
  } catch {
    // Ignore UI prep failures.
  }
  try {
    let filename = sanitizeFilename(activeTab.title || "youtube-download");
    if (!filename) {
      filename = "youtube-download";
    }
    if (promptFilename && !playlistEnabled) {
      const response = await showModalPrompt("Filename", "Enter the output file name.", filename);
      if (!response) {
        try {
          await background.removeStreamEntry?.({ streamId });
        } catch {
          // ignore
        }
        button.disabled = false;
        button.textContent = originalText;
        return;
      }
      filename = sanitizeFilename(response) || filename;
    }
    if (promptFilename && playlistEnabled) {
      const response = await showModalPrompt(
        "Playlist folder",
        "Enter a folder name for the playlist.",
        filename
      );
      if (!response) {
        try {
          await background.removeStreamEntry?.({ streamId });
        } catch {
          // ignore
        }
        button.disabled = false;
        button.textContent = originalText;
        return;
      }
      filename = sanitizeFilename(response) || filename;
    }
    let existsResult = null;
    if (!playlistEnabled) {
      try {
        const existsProbe = await withTimeout(checkFileExists(`${filename}.%(ext)s`), 4000);
        existsResult = existsProbe.timedOut ? null : existsProbe.value;
      } catch {
        existsResult = null;
      }
    }
    if (existsResult?.exists) {
      const choice = await showModalChoice(
        "File already exists",
        "Choose how to proceed.",
        [
          { label: "Overwrite", value: "overwrite", primary: true },
          { label: "Rename", value: "rename" },
          { label: "Auto-number", value: "auto" },
          { label: "Cancel", value: "cancel" }
        ]
      );
      if (choice === "cancel" || !choice) {
        button.disabled = false;
        button.textContent = originalText;
        await updateDownloadStatus(streamId, { status: "error", error: "Cancelled" });
        return;
      }
      if (choice === "overwrite") {
        overwrite = true;
      }
      if (choice === "rename") {
        const response = await showModalPrompt(
          "Filename",
          "Enter a new name.",
          existsResult.suggested || filename
        );
        if (!response) {
          button.disabled = false;
          button.textContent = originalText;
          await updateDownloadStatus(streamId, { status: "error", error: "Cancelled" });
          return;
        }
        filename = sanitizeFilename(response) || filename;
      } else if (choice === "auto" && existsResult.suggested) {
        filename = sanitizeFilename(existsResult.suggested) || filename;
      }
    }
    const heightLimit = effectiveKind === "audio" ? null : youtubeMaxHeight;
    const playlistMaxValue = playlistEnabled ? parseInt(playlistMaxInput?.value || "", 10) : null;
    const outputTemplate = playlistEnabled
      ? `${filename}/%(title)s.%(ext)s`
      : `${filename}.%(ext)s`;
    const payload = {
      url: activeTab.url,
      title: activeTab.title,
      displayTitle: playlistEnabled ? filename : null,
      filename: outputTemplate,
      merge_flag: effectiveKind !== "audio",
      useCookies: useBrowserCookies,
      downloadDir,
      nodePath,
      overwrite,
      kind: effectiveKind,
      audioOnly: effectiveKind === "audio",
      resolution: resolutionLabel,
      maxHeight: heightLimit || null,
      streamId,
      downloadId,
      tabId: activeTab.id,
      playlistEnabled,
      playlistMax: playlistMaxValue || null
    };
    const background = await browser.runtime.getBackgroundPage();
    await background.updateDownloadStatus?.({
      streamId,
      download: { status: "queued", percent: 0 }
    });
    await background.requestPageDownload?.(payload);
  } catch (error) {
    console.error("YouTube download failed", error);
    button.disabled = false;
    button.textContent = originalText;
    await updateDownloadStatus(streamId, { status: "error", error: "Failed to start" });
  }
}

async function updateDownloadStatus(streamId, download) {
  try {
    const background = await browser.runtime.getBackgroundPage();
    await background.updateDownloadStatus?.({ streamId, download });
  } catch {
    // ignore
  }
}

async function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const result = await Promise.race([
    promise.then((value) => ({ timedOut: false, value })),
    timeout
  ]);
  if (!result.timedOut && timeoutId) {
    clearTimeout(timeoutId);
  }
  return result;
}

async function probeYouTubeFormats(url) {
  try {
    const background = await browser.runtime.getBackgroundPage();
    const result = await background.requestProbeFormats?.({
      url,
      useCookies: useBrowserCookies,
      nodePath
    });
    if (!result?.ok) {
      return result;
    }
    return {
      ok: true,
      formatMode: result.formatMode,
      videoMode: result.formatMode,
      audioMode: "bestaudio/best"
    };
  } catch (error) {
    return { ok: false, error: error?.message || "Failed to list formats." };
  }
}

async function runPreflight() {
  preflightChecked = true;
  try {
    const background = await browser.runtime.getBackgroundPage();
    preflightState = await background.requestPreflight?.();
  } catch (error) {
    preflightState = { ytDlpOk: false, nodeOk: false };
  }
  updateYouTubeWarning();
}

function updateYouTubeWarning() {
  if (!youtubeWarning) {
    return;
  }
  if (!youtubeActive) {
    youtubeWarning.classList.add("hidden");
    return;
  }
  if (!preflightState) {
    youtubeWarning.classList.add("hidden");
    return;
  }
  const issues = [];
  if (!preflightState.ytDlpOk) {
    issues.push("yt-dlp not found");
  }
  if (!preflightState.nodeOk) {
    issues.push("Node.js missing");
  }
  if (issues.length) {
    youtubeWarning.textContent = `YouTube downloads may fail: ${issues.join(", ")}.`;
    youtubeWarning.classList.remove("hidden");
    const disableButtons = !preflightState.nodeOk || !preflightState.ytDlpOk;
    if (youtubeVideoBtn) {
      youtubeVideoBtn.disabled = disableButtons;
    }
    if (youtubeAudioBtn) {
      youtubeAudioBtn.disabled = disableButtons;
    }
    if (!preflightState.nodeOk && !nodePromptShown) {
      nodePromptShown = true;
      showModalChoice(
        "Install Node.js",
        "YouTube downloads require Node.js for signature solving. Install Node.js and retry.",
        [{ label: "OK", value: "ok", primary: true }]
      );
    }
  } else {
    youtubeWarning.classList.add("hidden");
    if (youtubeVideoBtn) {
      youtubeVideoBtn.disabled = false;
    }
    if (youtubeAudioBtn) {
      youtubeAudioBtn.disabled = false;
    }
  }
}

async function checkFileExists(filenameTemplate) {
  try {
    const background = await browser.runtime.getBackgroundPage();
    return await background.checkFile?.({ filename: filenameTemplate, downloadDir });
  } catch (error) {
    return { exists: false };
  }
}

function showModalPrompt(title, message, value) {
  return new Promise((resolve) => {
    if (!modalOverlay) {
      resolve(null);
      return;
    }
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalInput.value = value || "";
    modalInput.classList.remove("hidden");
    modalInput.style.display = "block";
    modalActions.innerHTML = "";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.className = "primary";

    const submit = () => closeModal(modalInput.value.trim() || value || null);
    const onKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeModal(null);
      }
    };

    cancelBtn.addEventListener("click", () => closeModal(null));
    okBtn.addEventListener("click", submit);
    modalInput.addEventListener("keydown", onKeyDown);

    modalActions.appendChild(cancelBtn);
    modalActions.appendChild(okBtn);

    openModal();

    function closeModal(result) {
      modalOverlay.classList.add("hidden");
      modalInput.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }
  });
}

function showModalChoice(title, message, choices) {
  return new Promise((resolve) => {
    if (!modalOverlay) {
      resolve(null);
      return;
    }
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalInput.style.display = "none";
    modalActions.innerHTML = "";

    for (const choice of choices) {
      const btn = document.createElement("button");
      btn.textContent = choice.label;
      if (choice.primary) {
        btn.className = "primary";
      }
      btn.addEventListener("click", () => closeModal(choice.value));
      modalActions.appendChild(btn);
    }

    openModal();

    function closeModal(result) {
      modalOverlay.classList.add("hidden");
      resolve(result);
    }
  });
}

function openModal() {
  modalOverlay.classList.remove("hidden");
  if (modalInput && modalInput.style.display !== "none") {
    setTimeout(() => modalInput.focus(), 0);
  }
}

function applySortButtonState() {
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    const matches = btn.getAttribute("data-sort") === currentSort;
    btn.classList.toggle("active", matches);
  });
}

function applyResolutionFilterButtonState() {
  const filterButtons = document.querySelectorAll(".resolution-filter-btn");
  filterButtons.forEach((btn) => {
    const matches = btn.getAttribute("data-resolution") === resolutionFilter;
    btn.classList.toggle("active", matches);
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.action === "streamsUpdated") {
    if (refreshTimer) {
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshStreams();
    }, 200);
  }
});

browser.tabs.onActivated.addListener(() => {
  refreshStreams();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!activeTab || tabId !== activeTab.id) {
    return;
  }
  if (changeInfo.url || changeInfo.status === "complete") {
    refreshStreams();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await syncCookiePreference();
  await syncRenamePreference();
  await syncDownloadSettings();
  await syncViewPreferences();
  applySortButtonState();
  applyResolutionFilterButtonState();
  refreshStreams();
  if (!preflightChecked) {
    runPreflight();
  }
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextSort = btn.getAttribute("data-sort") || "default";
      if (currentSort === nextSort) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        currentSort = nextSort;
        sortDir = "asc";
      }
      applySortButtonState();
      persistViewPreferences();
      renderStreams(applySort(applyFilters(lastStreams)));
    });
  });
  const resolutionButtons = document.querySelectorAll(".resolution-filter-btn");
  resolutionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextFilter = btn.getAttribute("data-resolution") || "all";
      if (nextFilter === resolutionFilter) {
        resolutionFilter = "all";
      } else {
        resolutionFilter = nextFilter;
      }
      applyResolutionFilterButtonState();
      persistViewPreferences();
      renderStreams(applySort(applyFilters(lastStreams)));
    });
  });
});

if (playlistToggle) {
  playlistToggle.addEventListener("change", (event) => {
    const enabled = event.target.checked;
    if (playlistMaxInput) {
      playlistMaxInput.disabled = !enabled;
      if (!enabled) {
        playlistMaxInput.value = "";
      }
    }
  });
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
}

if (youtubeVideoBtn) {
  youtubeVideoBtn.addEventListener("click", () =>
    handleYouTubeDownload("video", youtubeVideoBtn)
  );
}

if (youtubeAudioBtn) {
  youtubeAudioBtn.addEventListener("click", () =>
    handleYouTubeDownload("audio", youtubeAudioBtn)
  );
}

if (youtubeResolution) {
  youtubeResolution.addEventListener("change", (event) => {
    const value = event.target.value;
    youtubeMaxHeight = value === "max" ? null : Number(value) || 1080;
  });
  const initialValue = youtubeResolution.value;
  youtubeMaxHeight = initialValue === "max" ? null : Number(initialValue) || 1080;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[COOKIE_PREF_KEY]) {
    useBrowserCookies = !!changes[COOKIE_PREF_KEY].newValue;
    if (cookieToggle) {
      cookieToggle.checked = useBrowserCookies;
    }
  }
  if (changes[RENAME_PREF_KEY]) {
    promptFilename = !!changes[RENAME_PREF_KEY].newValue;
    if (renameToggle) {
      renameToggle.checked = promptFilename;
    }
  }
  if (changes[DOWNLOAD_DIR_KEY]) {
    downloadDir = changes[DOWNLOAD_DIR_KEY].newValue || "";
  }
  if (changes[NODE_PATH_KEY]) {
    nodePath = changes[NODE_PATH_KEY].newValue || "";
  }
  if (changes[SORT_PREF_KEY]) {
    currentSort = changes[SORT_PREF_KEY].newValue || "default";
    applySortButtonState();
  }
  if (changes[SORT_DIR_PREF_KEY]) {
    sortDir = changes[SORT_DIR_PREF_KEY].newValue || "asc";
  }
  if (changes[RESOLUTION_FILTER_PREF_KEY]) {
    resolutionFilter = changes[RESOLUTION_FILTER_PREF_KEY].newValue || "all";
    applyResolutionFilterButtonState();
  }
});
