console.log("background ready");
const HOST_NAME = "com.realstreamgrabber.mediagrabber";
const MEDIA_REGEX = /\.(m3u8|mp4|mp3|mkv|vtt)(?:[?#].*)?$/i;
const WEBREQUEST_FILTERS = [
  "*://*/*.m3u8*",
  "*://*/*.mp4*",
  "*://*/*.mp3*",
  "*://*/*.mkv*",
  "*://*/*.vtt*"
];

const streamRecords = [];
const requestEntryMap = new Map();
const tabTitles = new Map();
const tabUrls = new Map();
const activeTabByWindow = new Map();
const COOKIE_PREF_KEY = "useBrowserCookies";
const RENAME_PREF_KEY = "promptFilename";
const DOWNLOAD_DIR_KEY = "downloadDir";
const NODE_PATH_KEY = "nodePath";
let activeTabId = null;
let nativePort = null;
let streamIdCounter = 0;
const downloadNotifyState = new Map();
const pendingRequests = new Map();
const seenManifests = new Set();
const sizeProbeQueue = [];
const activeSizeProbes = new Set();
const MAX_SIZE_PROBES = 2;
const hlsSizeQueue = [];
const activeHlsProbes = new Set();
const MAX_HLS_PROBES = 1;
let streamsUpdateTimer = null;

window.getStreamRecords = () => streamRecords;

function cleanupDownloadNotifyState() {
  const now = Date.now();
  for (const [downloadId, state] of downloadNotifyState.entries()) {
    const entry = streamRecords.find((item) => item.download?.id === downloadId);
    if (!entry) {
      downloadNotifyState.delete(downloadId);
      continue;
    }
    const lastSeen = state?.lastSeen || state?.lastNotify || 0;
    if (lastSeen && now - lastSeen > 30 * 60 * 1000) {
      downloadNotifyState.delete(downloadId);
    }
  }
}

setInterval(cleanupDownloadNotifyState, 10 * 60 * 1000);

browser.runtime.onInstalled.addListener(async (details) => {
  if (details?.reason !== "install") {
    return;
  }
  try {
    const existing = await browser.storage.local.get([
      COOKIE_PREF_KEY,
      RENAME_PREF_KEY,
      DOWNLOAD_DIR_KEY,
      NODE_PATH_KEY
    ]);
    const updates = {};
    if (typeof existing[COOKIE_PREF_KEY] === "undefined") {
      updates[COOKIE_PREF_KEY] = true;
    }
    if (typeof existing[RENAME_PREF_KEY] === "undefined") {
      updates[RENAME_PREF_KEY] = true;
    }
    if (!existing[DOWNLOAD_DIR_KEY]) {
      try {
        const preflight = await window.requestPreflight?.();
        if (preflight?.defaultDownloadDir) {
          updates[DOWNLOAD_DIR_KEY] = preflight.defaultDownloadDir;
        }
        if (!existing[NODE_PATH_KEY]) {
          if (preflight?.nodePath) {
            updates[NODE_PATH_KEY] = preflight.nodePath;
          } else if (preflight?.nodeOk === false) {
            if (navigator.platform?.toLowerCase().includes("win")) {
              updates[NODE_PATH_KEY] =
                "C:\\Program Files\\RealStreamGrabber\\bin\\node\\node.exe";
            }
          }
        }
      } catch {
        // ignore
      }
    }
    if (Object.keys(updates).length) {
      await browser.storage.local.set(updates);
    }
  } catch {
    // ignore
  }
  try {
    await browser.runtime.openOptionsPage();
  } catch {
    // ignore
  }
});

function scheduleStreamsUpdate() {
  if (streamsUpdateTimer) {
    return;
  }
  streamsUpdateTimer = setTimeout(() => {
    streamsUpdateTimer = null;
    browser.runtime.sendMessage({ action: "streamsUpdated" }).catch(() => {});
  }, 200);
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function queueSizeProbe(entry) {
  if (!entry || entry.sizeEstimate || entry.sizeProbed) {
    return;
  }
  if (entry.type === "hls" || /\.m3u8(?:[?#].*)?$/i.test(entry.url)) {
    return;
  }
  entry.sizeProbed = true;
  sizeProbeQueue.push(entry);
  processSizeQueue();
}

function processSizeQueue() {
  while (activeSizeProbes.size < MAX_SIZE_PROBES && sizeProbeQueue.length) {
    const entry = sizeProbeQueue.shift();
    if (!entry || activeSizeProbes.has(entry.url)) {
      continue;
    }
    activeSizeProbes.add(entry.url);
    fetch(entry.url, { method: "HEAD" })
      .then((response) => {
        const lengthHeader = response.headers.get("content-length");
        if (lengthHeader) {
          const parsed = Number(lengthHeader);
          entry.sizeEstimate = Number.isNaN(parsed)
            ? `${lengthHeader}`
            : formatBytes(parsed);
          scheduleStreamsUpdate();
          return true;
        }
        return false;
      })
      .then((hasSize) => {
        if (hasSize) {
          return;
        }
        return fetch(entry.url, {
          method: "GET",
          headers: { Range: "bytes=0-0" }
        })
          .then((response) => {
            const contentRange = response.headers.get("content-range");
            if (!contentRange) {
              return;
            }
            const match = contentRange.match(/\/(\d+)/);
            if (match) {
              const total = Number(match[1]);
              entry.sizeEstimate = formatBytes(total);
              scheduleStreamsUpdate();
            }
          })
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        activeSizeProbes.delete(entry.url);
        processSizeQueue();
      });
  }
}

function queueHlsSize(entry) {
  if (!entry || entry.hlsSizeQueued || !entry.url) {
    return;
  }
  if (!/\.m3u8(?:[?#].*)?$/i.test(entry.url)) {
    return;
  }
  entry.hlsSizeQueued = true;
  hlsSizeQueue.push(entry);
  processHlsQueue();
}

function processHlsQueue() {
  while (activeHlsProbes.size < MAX_HLS_PROBES && hlsSizeQueue.length) {
    const entry = hlsSizeQueue.shift();
    if (!entry || activeHlsProbes.has(entry.url)) {
      continue;
    }
    activeHlsProbes.add(entry.url);
    fetch(entry.url)
      .then((response) => {
        if (!response.ok) {
          return null;
        }
        return response.text();
      })
      .then((text) => {
        if (!text || !/#EXT-X-ENDLIST/i.test(text)) {
          return;
        }
        const totalSeconds = text
          .split("\n")
          .filter((line) => line.startsWith("#EXTINF:"))
          .reduce((sum, line) => {
            const match = line.match(/#EXTINF:([\d.]+)/);
            return match ? sum + parseFloat(match[1]) : sum;
          }, 0);
        if (!Number.isNaN(totalSeconds) && totalSeconds > 0) {
          entry.duration = entry.duration || formatDuration(totalSeconds);
          if (entry.bandwidth) {
            const estimatedBytes = (entry.bandwidth / 8) * totalSeconds;
            entry.sizeEstimate = entry.sizeEstimate || formatBytes(estimatedBytes);
          }
          scheduleStreamsUpdate();
        }
      })
      .catch(() => {})
      .finally(() => {
        activeHlsProbes.delete(entry.url);
        processHlsQueue();
      });
  }
}

browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  const tab = tabs?.[0];
  if (tab?.id != null) {
    activeTabId = tab.id;
    if (tab.title) {
      tabTitles.set(tab.id, tab.title);
    }
    if (tab.url) {
      tabUrls.set(tab.id, tab.url);
    }
  }
});

function ensureNativePort() {
  if (nativePort) {
    return nativePort;
  }
  nativePort = browser.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener((message) => {
    handleNativeMessage(message);
  });
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    for (const [, resolver] of pendingRequests.entries()) {
      resolver({ event: "error", message: "Native host disconnected" });
    }
    pendingRequests.clear();
  });
  return nativePort;
}

function handleNativeMessage(message) {
  if (!message) {
    return;
  }
  if (message.event === "checkFileResult" || message.event === "probeResult" || message.event === "preflightResult" || message.event === "pickFolderResult") {
    if (message.requestId && pendingRequests.has(message.requestId)) {
      const resolver = pendingRequests.get(message.requestId);
      pendingRequests.delete(message.requestId);
      resolver(message);
    }
    return;
  }
  if (!message.downloadId) {
    return;
  }
  const entry = streamRecords.find((item) => item.download?.id === message.downloadId);
  if (!entry) {
    return;
  }
  const now = Date.now();
  const notifyState = downloadNotifyState.get(message.downloadId) || {
    lastNotify: 0,
    lastPercent: 0,
    lastSeen: 0
  };
  notifyState.lastSeen = now;
  if (message.event === "progress") {
    const percent = Number(message.percent);
    if (Number.isNaN(percent)) {
      return;
    }
    const percentDelta = Math.abs(percent - notifyState.lastPercent);
    if (now - notifyState.lastNotify < 150 && percentDelta < 0.5) {
      return;
    }
    notifyState.lastNotify = now;
    notifyState.lastPercent = percent;
    downloadNotifyState.set(message.downloadId, notifyState);
    entry.download = {
      ...entry.download,
      status: entry.download?.playlist
        ? `item ${entry.download.playlist.item}/${entry.download.playlist.total}`
        : "downloading",
      percent
    };
  } else if (message.event === "playlist") {
    downloadNotifyState.set(message.downloadId, notifyState);
    entry.download = {
      ...entry.download,
      playlist: {
        item: message.item,
        total: message.total
      },
      status: `item ${message.item}/${message.total}`
    };
  } else if (message.event === "phase") {
    downloadNotifyState.set(message.downloadId, notifyState);
    entry.download = {
      ...entry.download,
      status: entry.download?.playlist
        ? `item ${entry.download.playlist.item}/${entry.download.playlist.total}`
        : message.phase || entry.download?.status || "downloading"
    };
  } else if (message.event === "completed") {
    entry.download = {
      ...entry.download,
      status: "completed",
      percent: 100
    };
    downloadNotifyState.delete(message.downloadId);
  } else if (message.event === "cancelled") {
    entry.download = {
      ...entry.download,
      status: "cancelled"
    };
    downloadNotifyState.delete(message.downloadId);
  } else if (message.event === "error") {
    let friendlyError = message.message;
    if (friendlyError && typeof friendlyError === "string") {
      const drmPattern = /(drm|widevine|encrypted|content protected|license)/i;
      if (drmPattern.test(friendlyError)) {
        friendlyError = "Content protected (DRM).";
      }
    }
    entry.download = {
      ...entry.download,
      status: "error",
      error: friendlyError
    };
    downloadNotifyState.delete(message.downloadId);
  } else if (message.event === "warning") {
    entry.download = {
      ...entry.download,
      warning: message.message || "Download folder not found. Using Downloads."
    };
    downloadNotifyState.set(message.downloadId, notifyState);
  }
  scheduleStreamsUpdate();
}

function detectMediaType(url) {
  if (/\.m3u8(?:[?#].*)?$/i.test(url)) {
    return "hls";
  }
  if (/\.(mp3|m4a|wav)(?:[?#].*)?$/i.test(url)) {
    return "audio";
  }
  return "video";
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

function deriveTitle(tabId, fallbackUrl) {
  if (tabTitles.has(tabId)) {
    return tabTitles.get(tabId);
  }
  try {
    const parsed = new URL(fallbackUrl);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return fallbackUrl;
  }
}

function normalizeFilename(name, url) {
  if (typeof name === "string" && name.trim().length > 0 && !name.startsWith("http")) {
    return name.trim();
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return "download";
  }
}

function estimateSize(bandwidth) {
  if (!bandwidth) {
    return null;
  }
  const bytesPerSecond = parseInt(bandwidth, 10) / 8;
  if (Number.isNaN(bytesPerSecond) || bytesPerSecond <= 0) {
    return null;
  }
  if (bytesPerSecond > 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond > 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${bytesPerSecond.toFixed(1)} B/s`;
}

function addStream(entry) {
  if (!entry.id) {
    streamIdCounter += 1;
    entry.id = `stream-${Date.now()}-${streamIdCounter}`;
  }
  const existsById = streamRecords.some((record) => record.id === entry.id);
  if (existsById) {
    return;
  }
  if (!entry.isPage) {
    const exists = streamRecords.some(
      (record) => record.url === entry.url && record.formatId === entry.formatId
    );
    if (exists) {
      return;
    }
  }
  streamRecords.unshift(entry);
  if (streamRecords.length > 100) {
    streamRecords.pop();
  }
  scheduleStreamsUpdate();
  queueSizeProbe(entry);
}

function updateStreamSize(requestId, lengthHeader) {
  const entry = requestEntryMap.get(requestId);
  if (!entry) {
    return;
  }
  const parsed = Number(lengthHeader);
  if (!Number.isNaN(parsed)) {
    entry.sizeEstimate = formatBytes(parsed);
  } else {
    entry.sizeEstimate = `${lengthHeader}`;
  }
  scheduleStreamsUpdate();
}

async function handleHlsManifest(url, tabId, title) {
  try {
    if (seenManifests.has(url)) {
      return;
    }
    seenManifests.add(url);
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    const hasAudioTrack = /#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO/i.test(text);
    const streamRegex = /#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^\r\n]+)/gi;
    let match;
    let variantIndex = 0;
    while ((match = streamRegex.exec(text))) {
      const attributes = parseAttributes(match[1]);
      const candidateUri = match[2].trim();
      const variantUrl = new URL(candidateUri, url).href;
      const resolution = attributes.RESOLUTION || "unknown";
      const bandwidth = attributes.BANDWIDTH;
      const audioGroup = attributes.AUDIO || attributes["AUDIO"] || null;
      const hasSeparateAudio = !!audioGroup && hasAudioTrack;
      const formatId = attributes.NAME || attributes["VIDEO"] || null;
      const bitrateLabel = estimateSize(bandwidth);
      addStream({
        url: variantUrl,
        title,
        filename: normalizeFilename(title, url),
        type: "video",
        resolution,
        sizeEstimate: null,
        bitrateLabel,
        tag: hasSeparateAudio ? "No Audio" : null,
        merge_flag: hasSeparateAudio,
        formatId,
        bandwidth: bandwidth ? Number(bandwidth) : null,
        source: url,
        variantId: `hls-${variantIndex}`,
        firstSeen: Date.now(),
        hasAudio: !hasSeparateAudio,
        tabId,
        duration: null
      });
      const entry = streamRecords.find((record) => record.url === variantUrl);
      if (entry) {
        queueHlsSize(entry);
      }
      // Duration probing can be expensive; keep it opt-in for now.
      variantIndex += 1;
    }
  } catch (error) {
    console.error("Failed to parse manifest", error);
  }
}

async function fetchVariantDuration(variantUrl, entry) {
  try {
    const response = await fetch(variantUrl);
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    if (!/#EXT-X-ENDLIST/i.test(text)) {
      return;
    }
    const totalSeconds = text
      .split("\n")
      .filter((line) => line.startsWith("#EXTINF:"))
      .reduce((sum, line) => {
        const match = line.match(/#EXTINF:([\d.]+)/);
        return match ? sum + parseFloat(match[1]) : sum;
      }, 0);
    if (!Number.isNaN(totalSeconds) && totalSeconds > 0) {
      entry.duration = formatDuration(totalSeconds);
      scheduleStreamsUpdate();
    }
  } catch (error) {
    console.error("Failed to read variant duration", error);
  }
}

function formatDuration(totalSeconds) {
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function parseAttributes(attributeLine) {
  const attrs = {};
  attributeLine.split(",").forEach((segment) => {
    const [key, value] = segment.split("=");
    if (!key || !value) {
      return;
    }
    attrs[key.trim()] = value.trim().replace(/^"|"$/g, "");
  });
  return attrs;
}

async function registerStream(details) {
  const { url, tabId, requestId } = details;
  if (isYouTubeUrl(tabUrls.get(tabId))) {
    return;
  }
  if (!MEDIA_REGEX.test(url)) {
    return;
  }
  const title = await deriveTitle(tabId, url);
  const type = detectMediaType(url);
  if (type === "hls") {
    await handleHlsManifest(url, tabId, title);
    return;
  }
  const entry = {
    url,
    title,
    filename: normalizeFilename(title, url),
    type,
    resolution: details.type === "media" ? "unknown" : "n/a",
    sizeEstimate: null,
    tag: type === "video" ? null : "Audio",
    merge_flag: false,
    formatId: null,
    source: url,
    firstSeen: Date.now(),
    hasAudio: type === "audio",
    tabId,
    duration: null
  };
  const exists = streamRecords.some((record) => record.url === entry.url);
  if (exists) {
    requestEntryMap.set(requestId, entry);
    return;
  }
  streamRecords.unshift(entry);
  requestEntryMap.set(requestId, entry);
  if (streamRecords.length > 100) {
    streamRecords.pop();
  }
  scheduleStreamsUpdate();
  queueSizeProbe(entry);
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (activeTabId != null && details.tabId !== activeTabId) {
      return;
    }
    if (!MEDIA_REGEX.test(details.url)) {
      return;
    }
    registerStream(details);
  },
  { urls: WEBREQUEST_FILTERS }
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (activeTabId != null && details.tabId !== activeTabId) {
      return;
    }
    const lengthHeader = details.responseHeaders?.find(
      (header) => header.name.toLowerCase() === "content-length"
    );
    if (lengthHeader) {
    updateStreamSize(details.requestId, lengthHeader.value);
    }
  },
  { urls: WEBREQUEST_FILTERS },
  ["responseHeaders"]
);

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title) {
    tabTitles.set(tabId, changeInfo.title);
  }
  if (changeInfo.url || tab?.url) {
    tabUrls.set(tabId, changeInfo.url || tab.url);
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabByWindow.set(activeInfo.windowId, activeInfo.tabId);
  activeTabId = activeInfo.tabId;
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    if (tab?.title) {
      tabTitles.set(activeInfo.tabId, tab.title);
    }
    if (tab?.url) {
      tabUrls.set(activeInfo.tabId, tab.url);
    }
  } catch {
    // Ignore lookup failures.
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabTitles.delete(tabId);
  tabUrls.delete(tabId);
  if (activeTabId === tabId) {
    activeTabId = null;
  }
  for (const [windowId, activeTabId] of activeTabByWindow.entries()) {
    if (activeTabId === tabId) {
      activeTabByWindow.delete(windowId);
    }
  }
});

async function requestNativeDownload(payload) {
  try {
    const port = ensureNativePort();
    port.postMessage({ action: "download", payload });
    return { status: "queued" };
  } catch (error) {
    console.error("Native download failed", error);
    throw error;
  }
}

window.requestDownload = (payload) => {
  const entry = streamRecords.find((item) => item.id === payload.streamId);
  if (entry) {
    entry.download = {
      id: payload.downloadId,
      status: "queued",
      percent: 0
    };
    scheduleStreamsUpdate();
  }
  return requestNativeDownload(payload);
};

window.checkFile = (payload) => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const port = ensureNativePort();
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    port.postMessage({
      action: "checkFile",
      payload: {
        requestId,
        filename: payload.filename,
        downloadDir: payload.downloadDir
      }
    });
  });
};

window.getActiveTabInfo = async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      if (tab.title) {
        tabTitles.set(tab.id, tab.title);
      }
      if (tab.url) {
        tabUrls.set(tab.id, tab.url);
      }
      return {
        id: tab.id,
        title: tab.title || tabTitles.get(tab.id) || "",
        url: tab.url || tabUrls.get(tab.id) || ""
      };
    }
  } catch {
    // ignore
  }
  return null;
};

window.requestPreflight = () => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const port = ensureNativePort();
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    port.postMessage({
      action: "preflight",
      payload: { requestId }
    });
  });
};

window.requestPickFolder = () => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const port = ensureNativePort();
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    port.postMessage({
      action: "pickFolder",
      payload: { requestId }
    });
  });
};

window.requestProbeFormats = (payload) => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const port = ensureNativePort();
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    port.postMessage({
      action: "probeFormats",
      payload: {
        requestId,
        url: payload.url,
        useCookies: payload.useCookies,
        nodePath: payload.nodePath
      }
    });
  });
};

window.requestPageDownload = (payload) => {
  const baseId = payload.streamId || `page-${payload.kind || "video"}`;
  const isPlaylist = !!payload.playlistEnabled;
  let entry = streamRecords.find((item) => item.id === baseId);
  const hasActiveDownload =
    entry?.download && entry.download.status && entry.download.status !== "completed" && entry.download.status !== "error";
  if (!isPlaylist && hasActiveDownload && !payload.streamId) {
    entry = null;
  }
  const entryId = entry ? entry.id : (isPlaylist ? baseId : `${baseId}-${payload.downloadId || Date.now()}`);
  if (!entry) {
    entry = null;
  }
  if (!entry) {
    const title = payload.title || payload.url;
    const displayTitle = payload.displayTitle || title;
    entry = {
      id: entryId,
      url: payload.url,
      title: displayTitle,
      filename: payload.filename || "download",
      type: payload.kind === "audio" ? "audio" : "video",
      resolution: payload.kind === "audio" ? "audio" : "≤1080p",
      sizeEstimate: null,
      tag: null,
      merge_flag: payload.kind !== "audio",
      formatId: null,
      source: payload.url,
      firstSeen: Date.now(),
      hasAudio: payload.kind === "audio",
      tabId: payload.tabId || null,
      duration: null,
      isPage: true
    };
    addStream(entry);
  } else if (payload.kind) {
    entry.type = payload.kind === "audio" ? "audio" : "video";
    entry.resolution = payload.resolution || (payload.kind === "audio" ? "audio" : "≤1080p");
    entry.merge_flag = payload.kind !== "audio";
    entry.hasAudio = payload.kind === "audio";
    entry.isPage = true;
    if (payload.displayTitle || payload.title) {
      entry.title = payload.displayTitle || payload.title;
    }
    if (payload.filename) {
      entry.filename = payload.filename;
    }
  }
  entry.download = {
    id: payload.downloadId,
    status: "queued",
    percent: 0
  };
  scheduleStreamsUpdate();
  return requestNativeDownload(payload);
};

window.requestCancelDownload = (payload) => {
  const port = ensureNativePort();
  port.postMessage({
    action: "cancel",
    payload: {
      downloadId: payload.downloadId
    }
  });
};

window.ensurePageEntry = (payload) => {
  const baseId = payload.streamId || `page-${payload.kind || "video"}`;
  const isPlaylist = !!payload.playlistEnabled;
  let entry = streamRecords.find((item) => item.id === baseId);
  const hasActiveDownload =
    entry?.download && entry.download.status && entry.download.status !== "completed" && entry.download.status !== "error";
  if (!isPlaylist && hasActiveDownload) {
    entry = null;
  }
  const entryId = entry ? entry.id : (isPlaylist ? baseId : `${baseId}-${payload.download?.id || Date.now()}`);
  if (!entry) {
    const title = payload.title || payload.url;
    const displayTitle = payload.displayTitle || title;
    entry = {
      id: entryId,
      url: payload.url,
      title: displayTitle,
      filename: payload.filename || "download",
      type: payload.kind === "audio" ? "audio" : "video",
      resolution: payload.kind === "audio" ? "audio" : "≤1080p",
      sizeEstimate: null,
      tag: null,
      merge_flag: payload.kind !== "audio",
      formatId: null,
      source: payload.url,
      firstSeen: Date.now(),
      hasAudio: payload.kind === "audio",
      tabId: payload.tabId || null,
      duration: null,
      isPage: true
    };
    addStream(entry);
  }
  if (payload.download) {
    entry.download = { ...payload.download };
  }
  scheduleStreamsUpdate();
  return { id: entry.id };
};

window.updateDownloadStatus = (payload) => {
  const entry = streamRecords.find((item) => item.id === payload.streamId);
  if (!entry) {
    return;
  }
  entry.download = {
    ...(entry.download || {}),
    ...payload.download
  };
  scheduleStreamsUpdate();
};

window.removeStreamEntry = (payload) => {
  const id = payload?.streamId;
  if (!id) {
    return;
  }
  const index = streamRecords.findIndex((item) => item.id === id);
  if (index >= 0) {
    streamRecords.splice(index, 1);
    scheduleStreamsUpdate();
  }
};
