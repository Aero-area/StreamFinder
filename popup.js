const pageTitleEl  = document.getElementById("pageTitle");
const statusEl     = document.getElementById("status");
const listEl       = document.getElementById("mediaList");
const refreshBtn   = document.getElementById("refreshBtn");
const searchInput  = document.getElementById("searchInput");
const statTotalEl  = document.getElementById("statTotal");
const statDirectEl = document.getElementById("statDirect");
const statStreamEl = document.getElementById("statStream");

const state = {
  tabUrl: "",
  pageTitle: "",
  items: [],
  query: ""
};

/* ─── Status ──────────────────────────────────────────────── */
function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = "status-bar";
  if (tone) statusEl.classList.add(tone);
}

/* ─── Helpers ─────────────────────────────────────────────── */
function hostOf(url) {
  try { return new URL(url).hostname; }
  catch { return "unknown host"; }
}

function shorten(text, max) {
  const raw = String(text || "");
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

/**
 * Returns a compact, user-friendly format label.
 * e.g. "M3U8" → "HLS Stream", "MPD" → "MPEG-DASH", etc.
 */
function friendlyFormat(item) {
  const ext = String(item.ext || "").toLowerCase();
  if (ext === "m3u8") return "HLS Stream";
  if (ext === "mpd")  return "MPEG-DASH";
  if (ext === "mp4")  return "MP4";
  if (ext === "webm") return "WebM";
  if (ext === "mov")  return "MOV";
  if (ext === "mp3")  return "MP3";
  if (ext === "m4a")  return "M4A";
  if (ext === "aac")  return "AAC";
  if (ext === "wav")  return "WAV";
  if (ext === "ogg")  return "OGG";
  if (ext === "opus") return "Opus";
  if (ext === "flac") return "FLAC";
  if (item.mime) {
    const piece = item.mime.split("/").pop() || "media";
    return piece.toUpperCase();
  }
  return "Media";
}

/**
 * Returns the media category for a type badge: "Video", "Audio", or "Stream".
 */
function mediaCategory(item) {
  const ext = String(item.ext || "").toLowerCase();
  if (item.isStream || ext === "m3u8" || ext === "mpd") return "Stream";
  const audioExts = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"]);
  if (audioExts.has(ext)) return "Audio";
  if (item.mime) {
    if (item.mime.startsWith("audio/")) return "Audio";
    if (item.mime.startsWith("video/")) return "Video";
  }
  return "Video";
}

/**
 * Maps internal source keys to user-friendly labels.
 */
function friendlySource(source) {
  const map = {
    "video-tag":    "HTML Element",
    "video-source": "Source Tag",
    "audio-tag":    "HTML Element",
    "network":      "Network",
    "performance":  "Performance",
    "dom-link":     "DOM Link",
    "script":       "Script",
    "page":         "Page"
  };
  return map[source] || source || "Unknown";
}

function isDirect(item) { return !item.isStream; }

function isAudioHls(item) {
  if (item.ext !== "m3u8" && !item.isStream) return false;
  const lower = String(item.url || "").toLowerCase();
  return (lower.includes(".m3u8") || lower.includes("m3u8") || item.ext === "m3u8") &&
    !lower.includes("screen");
}

function isRecommended(item) {
  if (!isAudioHls(item)) return false;
  const lower = String(item.url || "").toLowerCase();
  return !lower.includes("video");
}

function matchesQuery(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [item.title, item.url, item.mime, hostOf(item.url)].some((v) =>
    String(v || "").toLowerCase().includes(q)
  );
}

/* ─── Stats ───────────────────────────────────────────────── */
function updateStats(visibleItems) {
  const total  = visibleItems.length;
  const direct = visibleItems.filter(isDirect).length;
  const stream = visibleItems.filter((i) => i.isStream).length;

  statTotalEl.textContent  = `${total} result${total !== 1 ? "s" : ""}`;
  statDirectEl.textContent = `${direct} direct`;
  statStreamEl.textContent = `${stream} stream${stream !== 1 ? "s" : ""}`;
}

/* ─── Thumb ───────────────────────────────────────────────── */
function createThumb(item) {
  const thumb = document.createElement("div");
  const cat = mediaCategory(item);
  const rec = isRecommended(item);

  if (rec) {
    thumb.className = "thumb thumb-recommended";
  } else if (cat === "Audio") {
    thumb.className = "thumb thumb-audio";
  } else if (cat === "Stream") {
    thumb.className = "thumb thumb-stream";
  } else {
    thumb.className = "thumb";
  }

  if (item.preview) {
    const img = document.createElement("img");
    img.src = item.preview;
    img.alt = "Preview";
    img.loading = "lazy";
    thumb.appendChild(img);
    return thumb;
  }

  // Icon SVG based on category
  if (cat === "Audio") {
    thumb.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.75"/>
      <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.75"/>
    </svg>`;
  } else if (cat === "Stream") {
    thumb.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3l14 9-14 9V3z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      <path d="M19 12h2M3 12H1" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </svg>`;
  } else {
    thumb.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 10l4.553-2.277A1 1 0 0121 8.649v6.702a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  return thumb;
}

/* ─── Clipboard ───────────────────────────────────────────── */
async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    setStatus("URL copied to clipboard.", "ok");
  } catch {
    setStatus("Could not copy URL.", "warn");
  }
}

/* ─── Download ────────────────────────────────────────────── */
async function downloadItem(item, index) {
  const prettyTitle = String(item.title || "").trim() || state.pageTitle || `media-${index + 1}`;
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_MEDIA",
    url: item.url,
    title: prettyTitle,
    ext: item.ext,
    mime: item.mime,
    tabUrl: state.tabUrl
  });
  if (response?.ok) {
    setStatus(`Download started: ${shorten(prettyTitle, 60)}`, "ok");
  } else {
    setStatus(response?.error || "Download failed.", "error");
  }
}

/* ─── Links.txt export ────────────────────────────────────── */
async function exportStreamLinks(item, index) {
  const prettyTitle = String(item.title || "").trim() || state.pageTitle || `stream-${index + 1}`;
  setStatus("Extracting links from stream…");
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_STREAM_LINKS",
    url: item.url,
    title: prettyTitle,
    ext: item.ext,
    mime: item.mime,
    tabUrl: state.tabUrl
  });
  if (response?.ok) {
    const suffix  = response.truncated ? " (truncated)" : "";
    const warnTxt = response.warnings ? `, ${response.warnings} warnings` : "";
    setStatus(`Saved ${response.count} links to .txt${suffix}${warnTxt}.`, response.warnings ? "warn" : "ok");
  } else {
    setStatus(response?.error || "Could not export links.", "error");
  }
}

/* ─── Save audio HLS ──────────────────────────────────────── */
async function saveAudioHlsToConvert(item, index) {
  const prettyTitle = String(item.title || "").trim() || state.pageTitle || `audio-${index + 1}`;
  setStatus("Saving audio URL to to_convert…");
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_AUDIO_HLS_TO_CONVERT",
    url: item.url,
    title: prettyTitle,
    tabUrl: state.tabUrl
  });
  if (response?.ok) {
    setStatus(`✓ Saved to to_convert: ${response.filename}`, "ok");
  } else {
    setStatus(response?.error || "Could not save file.", "error");
  }
}

/* ─── Badge factory ───────────────────────────────────────── */
function makeBadge(text, className) {
  const el = document.createElement("span");
  el.className = `badge ${className}`;
  el.textContent = text;
  return el;
}

/* ─── Button factory ──────────────────────────────────────── */
function makeBtn(text, className, onClick) {
  const el = document.createElement("button");
  el.className = `btn ${className}`;
  el.type = "button";
  el.textContent = text;
  el.addEventListener("click", onClick);
  return el;
}

/* ─── Render ──────────────────────────────────────────────── */
function renderList(items) {
  listEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";

    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.75"/>
      <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </svg>`;

    const title = document.createElement("p");
    title.className = "empty-title";
    title.textContent = "No media found";

    const body = document.createElement("p");
    body.className = "empty-body";
    body.textContent = "Start playback for a few seconds, then click Scan to detect streams and media files.";

    empty.append(icon, title, body);
    listEl.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const recommended = isRecommended(item);
    const cat = mediaCategory(item);

    /* Card */
    const card = document.createElement("li");
    card.className = recommended ? "card card-recommended" : "card";

    /* ── Main row ── */
    const main = document.createElement("div");
    main.className = "card-main";

    const thumb = createThumb(item);

    /* Text column */
    const content = document.createElement("div");
    content.className = "card-content";

    const titleEl = document.createElement("p");
    titleEl.className = "card-title";
    titleEl.title = item.title || "";
    titleEl.textContent = shorten(item.title || `Media ${index + 1}`, 80);

    const hostEl = document.createElement("p");
    hostEl.className = "card-host";
    hostEl.textContent = hostOf(item.url);

    /* Badges */
    const badges = document.createElement("div");
    badges.className = "badges";

    // 1. Category badge (Video / Audio / Stream)
    const catClass = cat === "Audio" ? "badge-type-audio"
                   : cat === "Stream" ? "badge-type-stream"
                   : "badge-type-video";
    badges.appendChild(makeBadge(cat, catClass));

    // 2. Format badge (HLS Stream / MP4 / MP3 …)
    badges.appendChild(makeBadge(friendlyFormat(item), "badge-type-generic"));

    // 3. Access badge (Direct / Streaming)
    badges.appendChild(makeBadge(
      item.isStream ? "Streaming" : "Direct file",
      item.isStream ? "badge-stream" : "badge-direct"
    ));

    // 4. Source badge
    badges.appendChild(makeBadge(friendlySource(item.source), "badge-source"));

    // 5. Special badges
    if (recommended) {
      badges.appendChild(makeBadge("⭐ Recommended", "badge-recommended"));
    } else if (isAudioHls(item)) {
      badges.appendChild(makeBadge("🎵 Audio HLS", "badge-audio-hls"));
    }

    content.append(titleEl, hostEl, badges);
    main.append(thumb, content);

    /* ── Action buttons ── */
    const actions = document.createElement("div");
    actions.className = "card-actions";

    // Copy URL
    const copyBtn = makeBtn(
      recommended ? "📋 Copy URL" : "Copy URL",
      recommended ? "btn-copy btn-copy-recommended" : "btn-copy",
      async () => {
        await copyUrl(item.url);
        if (recommended) setStatus("✓ URL copied — run: python3 main.py", "ok");
      }
    );
    actions.appendChild(copyBtn);

    // Download
    const dlBtn = makeBtn("Download", "btn-download", async () => {
      dlBtn.disabled = true;
      dlBtn.textContent = "Starting…";
      await downloadItem(item, index);
      setTimeout(() => { dlBtn.disabled = false; dlBtn.textContent = "Download"; }, 800);
    });
    actions.appendChild(dlBtn);

    // m3u8-specific buttons
    if (item.ext === "m3u8") {
      const linksBtn = makeBtn("Export Links", "btn-links", async () => {
        linksBtn.disabled = true;
        linksBtn.textContent = "Exporting…";
        await exportStreamLinks(item, index);
        setTimeout(() => { linksBtn.disabled = false; linksBtn.textContent = "Export Links"; }, 900);
      });
      actions.appendChild(linksBtn);

      if (isAudioHls(item)) {
        const saveBtn = makeBtn("💾 Save to converter", "btn-audio-convert", async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          await saveAudioHlsToConvert(item, index);
          setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = "💾 Save to converter"; }, 1200);
        });
        saveBtn.title = "Save this audio HLS URL as a .txt file in the to_convert folder";
        actions.appendChild(saveBtn);
      }
    }

    content.appendChild(actions);

    /* ── URL row ── */
    const urlRow = document.createElement("p");
    urlRow.className = "card-url";
    urlRow.title = item.url;
    urlRow.textContent = item.url;

    card.append(main, urlRow);
    listEl.appendChild(card);
  });
}

/* ─── View ────────────────────────────────────────────────── */
function applyView() {
  const visible = state.items.filter((item) => matchesQuery(item, state.query));
  updateStats(visible);
  renderList(visible);

  if (!visible.length) {
    setStatus(state.query ? "No results match the current filter." : "No media found yet.", "warn");
  }
}

/* ─── Tab helpers ─────────────────────────────────────────── */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ─── Scan ────────────────────────────────────────────────── */
async function scan() {
  setStatus("Scanning current tab…");
  listEl.innerHTML = "";
  refreshBtn.disabled = true;

  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No active tab found.", "error");
    refreshBtn.disabled = false;
    return;
  }

  state.tabUrl = tab.url || "";

  const response = await chrome.runtime.sendMessage({
    type: "GET_MEDIA_FOR_TAB",
    tabId: tab.id,
    tabUrl: tab.url,
    tabTitle: tab.title
  });

  refreshBtn.disabled = false;

  if (response?.blocked) {
    pageTitleEl.textContent = "Blocked domain";
    state.items = [];
    applyView();
    setStatus("This domain is blocked by StreamFinder.", "error");
    return;
  }

  state.pageTitle = response?.pageTitle || tab.title || "Current tab";
  pageTitleEl.textContent = shorten(state.pageTitle, 70);

  state.items = Array.isArray(response?.items) ? response.items : [];
  applyView();

  if (state.items.length) {
    const direct = state.items.filter((i) => !i.isStream).length;
    const stream = state.items.length - direct;
    setStatus(
      `Found ${state.items.length} media URL${state.items.length !== 1 ? "s" : ""} — ${direct} direct, ${stream} stream${stream !== 1 ? "s" : ""}.`,
      "ok"
    );
  } else {
    setStatus("No media found. Try starting playback for a few seconds, then scan again.", "warn");
  }
}

/* ─── Events ──────────────────────────────────────────────── */
searchInput.addEventListener("input", (e) => {
  state.query = String(e.target.value || "").trim();
  applyView();
});

refreshBtn.addEventListener("click", scan);
scan();
