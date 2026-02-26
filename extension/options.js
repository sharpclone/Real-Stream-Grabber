const COOKIE_PREF_KEY = "useBrowserCookies";
const RENAME_PREF_KEY = "promptFilename";
const DOWNLOAD_DIR_KEY = "downloadDir";
const NODE_PATH_KEY = "nodePath";

const useCookiesEl = document.getElementById("use-cookies");
const askFilenameEl = document.getElementById("ask-filename");
const downloadDirEl = document.getElementById("download-dir");
const nodePathEl = document.getElementById("node-path");
const detectNodeBtn = document.getElementById("detect-node");
const browseDirBtn = document.getElementById("browse-dir");
const nodeStatusEl = document.getElementById("node-status");
const saveBtn = document.getElementById("save");
const saveStatusEl = document.getElementById("save-status");

async function loadSettings() {
  const settings = await browser.storage.local.get([
    COOKIE_PREF_KEY,
    RENAME_PREF_KEY,
    DOWNLOAD_DIR_KEY,
    NODE_PATH_KEY
  ]);
  useCookiesEl.checked = !!settings[COOKIE_PREF_KEY];
  askFilenameEl.checked = !!settings[RENAME_PREF_KEY];
  downloadDirEl.value = settings[DOWNLOAD_DIR_KEY] || "";
  nodePathEl.value = settings[NODE_PATH_KEY] || "";
  const isWindows = navigator.platform?.toLowerCase().includes("win");
  let needsDetect = !downloadDirEl.value;
  if (isWindows && downloadDirEl.value.startsWith("/")) {
    downloadDirEl.value = "";
    needsDetect = true;
  }
  if (isWindows && nodePathEl.value.startsWith("/")) {
    nodePathEl.value = "";
  }
  if (needsDetect) {
    await detectDefaults();
  }
}

async function saveSettings() {
  await browser.storage.local.set({
    [COOKIE_PREF_KEY]: useCookiesEl.checked,
    [RENAME_PREF_KEY]: askFilenameEl.checked,
    [DOWNLOAD_DIR_KEY]: downloadDirEl.value.trim(),
    [NODE_PATH_KEY]: nodePathEl.value.trim()
  });
  saveStatusEl.textContent = "Saved.";
  setTimeout(() => {
    saveStatusEl.textContent = "";
  }, 1500);
}

async function detectNode() {
  nodeStatusEl.textContent = "Checking...";
  try {
    const background = await browser.runtime.getBackgroundPage();
    const result = await background.requestPreflight?.();
    if (result?.nodeOk && result?.nodePath) {
      nodePathEl.value = result.nodePath;
      nodeStatusEl.textContent = `Detected: ${result.nodePath}`;
    } else if (result?.nodeOk) {
      nodeStatusEl.textContent = "Node.js found, path unknown.";
    } else if (nodePathEl.value) {
      nodeStatusEl.textContent = "Using saved Node.js path.";
    } else {
      nodeStatusEl.textContent = "Node.js not found.";
    }
  } catch (error) {
    nodeStatusEl.textContent = "Failed to detect Node.js.";
  }
}

async function detectDefaults() {
  try {
    const background = await browser.runtime.getBackgroundPage();
    const result = await background.requestPreflight?.();
    if (result?.defaultDownloadDir && !downloadDirEl.value) {
      downloadDirEl.value = result.defaultDownloadDir;
    }
    if (result?.nodeOk && result?.nodePath && !nodePathEl.value) {
      nodePathEl.value = result.nodePath;
      nodeStatusEl.textContent = `Detected: ${result.nodePath}`;
    } else if (result && !result.nodeOk) {
      nodeStatusEl.textContent = "Node.js not found.";
    }
  } catch (error) {
    // ignore
  }
}

async function browseDirectory() {
  try {
    const background = await browser.runtime.getBackgroundPage();
    const result = await background.requestPickFolder?.();
    if (result?.ok && result?.path) {
      downloadDirEl.value = result.path;
    }
  } catch (error) {
    // ignore
  }
}

saveBtn.addEventListener("click", saveSettings);
detectNodeBtn.addEventListener("click", detectNode);
browseDirBtn.addEventListener("click", browseDirectory);

document.addEventListener("DOMContentLoaded", loadSettings);
