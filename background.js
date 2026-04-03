const tabMediaCache = new Map();
const BLOCKED_HOST_PATTERNS = [/youtube\.com$/i, /youtu\.be$/i, /googlevideo\.com$/i];

const MEDIA_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "m3u8",
  "mpd",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "opus",
  "flac"
]);

const SOURCE_SCORE = {
  "video-tag": 120,
  "video-source": 110,
  "audio-tag": 105,
  network: 95,
  performance: 88,
  "dom-link": 70,
  script: 30,
  page: 20
};

const MIME_TO_EXTENSION = {
  "application/vnd.apple.mpegurl": "m3u8",
  "application/x-mpegurl": "m3u8",
  "application/mpegurl": "m3u8",
  "application/dash+xml": "mpd",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov"
};

function isBlockedHost(url) {
  try {
    const host = new URL(url).hostname;
    return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,6})$/i);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function extensionFromUrlHints(url) {
  const raw = String(url || "");
  if (!raw) return "";
  const lower = raw.toLowerCase();

  if (/vnd\.apple\.mpegurl|x-mpegurl|mpegurl/.test(lower)) return "m3u8";
  if (/dash\+xml/.test(lower)) return "mpd";

  const directMatch = lower.match(
    /(?:^|[\/_.=?&-])(m3u8|mpd|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mp3|m4a|aac|wav|ogg|opus|flac)(?=$|[/?#&._=-])/i
  );
  if (directMatch) return directMatch[1].toLowerCase();

  try {
    const params = new URL(raw).searchParams;
    const hinted = ["format", "type", "mime", "file", "filename", "ext", "content-type", "response-content-type"]
      .map((key) => params.get(key) || "")
      .join(" ")
      .toLowerCase();
    const hintedMatch = hinted.match(
      /(m3u8|mpd|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mp3|m4a|aac|wav|ogg|opus|flac|mpegurl|dash\+xml)/i
    );
    if (!hintedMatch) return "";
    if (hintedMatch[1] === "mpegurl") return "m3u8";
    if (hintedMatch[1] === "dash+xml") return "mpd";
    return hintedMatch[1].toLowerCase();
  } catch {
    return "";
  }
}

function hasMediaUrlHint(url) {
  const lower = String(url || "").toLowerCase();
  if (!lower) return false;
  return Boolean(extensionFromUrlHints(lower));
}

function isStreamExtension(ext) {
  return ext === "m3u8" || ext === "mpd";
}

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return "";
  const hit = headers.find((h) => h?.name?.toLowerCase() === name.toLowerCase());
  return String(hit?.value || "").trim();
}

function mimeWithoutCharset(mime) {
  return String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionFromMime(mime) {
  const clean = mimeWithoutCharset(mime);
  if (MIME_TO_EXTENSION[clean]) return MIME_TO_EXTENSION[clean];

  if (clean.startsWith("video/")) return "mp4";
  if (clean.startsWith("audio/")) return "m4a";
  return "";
}

function createSafeFilename(title, ext) {
  const safeTitle = String(title || "media")
    .replace(/\.[a-z0-9]{2,6}$/i, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 170) || "media";

  const safeExt = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return safeExt ? `${safeTitle}.${safeExt}` : safeTitle;
}

function absoluteUrl(url, baseUrl) {
  try {
    return new URL(String(url || "").trim(), baseUrl).href;
  } catch {
    return "";
  }
}

function parseM3u8Links(text, baseUrl) {
  const links = [];
  const seen = new Set();
  const add = (raw) => {
    const absolute = absoluteUrl(raw, baseUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    links.push(absolute);
  };

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      if (line.startsWith("#")) {
        const uriPattern = /\bURI="([^"]+)"/gi;
        let match;
        while ((match = uriPattern.exec(line))) {
          add(match[1]);
        }
        return;
      }

      add(line);
    });

  return links;
}

function isM3u8Like(url, mime = "", ext = "") {
  const resolved = String(ext || getExtension(url) || extensionFromUrlHints(url) || extensionFromMime(mime)).toLowerCase();
  return resolved === "m3u8";
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function collectM3u8Links(rootUrl, options = {}) {
  const maxPlaylists = Math.max(1, Math.min(Number(options.maxPlaylists) || 10, 30));
  const maxLinks = Math.max(1, Math.min(Number(options.maxLinks) || 6000, 30000));
  const timeoutMs = Math.max(2000, Math.min(Number(options.timeoutMs) || 12000, 30000));

  const queue = [rootUrl];
  const visitedPlaylists = new Set();
  const seenLinks = new Set();
  const links = [];
  const warnings = [];

  const addLink = (candidate) => {
    if (!candidate || seenLinks.has(candidate) || seenLinks.size >= maxLinks) return;
    seenLinks.add(candidate);
    links.push(candidate);
  };

  while (queue.length && visitedPlaylists.size < maxPlaylists && seenLinks.size < maxLinks) {
    const playlistUrl = queue.shift();
    if (!playlistUrl || visitedPlaylists.has(playlistUrl)) continue;

    visitedPlaylists.add(playlistUrl);
    addLink(playlistUrl);

    try {
      const text = await fetchTextWithTimeout(playlistUrl, timeoutMs);
      const found = parseM3u8Links(text, playlistUrl);
      found.forEach((link) => {
        addLink(link);
        if (isM3u8Like(link) && !visitedPlaylists.has(link) && queue.length < maxPlaylists * 4) queue.push(link);
      });
    } catch (err) {
      warnings.push(`${playlistUrl}: ${err?.message || "Fetch failed"}`);
    }
  }

  return {
    links,
    warnings,
    playlistCount: visitedPlaylists.size,
    truncated: seenLinks.size >= maxLinks
  };
}

function isLikelyMedia(url, mime, type) {
  const ext = getExtension(url);
  const cleanMime = mimeWithoutCharset(mime);

  if (MEDIA_EXTENSIONS.has(ext)) return true;
  if (hasMediaUrlHint(url)) return true;
  if (type === "media") return true;
  if (cleanMime.startsWith("video/") || cleanMime.startsWith("audio/")) return true;
  if (/mpegurl|dash\+xml/i.test(cleanMime)) return true;

  return false;
}

function isLikelySegmentNoise(url) {
  const ext = getExtension(url);
  if (ext === "ts" || ext === "m4s") return true;

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\/(segment|segments|chunk|chunks|frag|fragments)\//.test(pathname)) return true;
    if (/\/[0-9]{4,}\.(ts|m4s)$/.test(pathname)) return true;
  } catch {
    // ignore
  }

  return false;
}

function mediaKey(url, ext) {
  try {
    const u = new URL(url);
    if (isStreamExtension(ext)) {
      const folder = u.pathname.replace(/\/[^/]*$/, "/");
      return `${u.origin}${folder}manifest`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function titleFromUrl(url, fallback) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    const clean = base.replace(/\.[a-z0-9]{2,6}$/i, "").trim();
    if (clean && !/^(master|index|playlist)$/i.test(clean)) return clean;
  } catch {
    // ignore
  }
  return fallback || "Media";
}

function scoreItem(item) {
  const url = String(item.url || "").toLowerCase();
  const ext = String(item.ext || "").toLowerCase();
  let score = SOURCE_SCORE[item.source] || 0;

  if (ext === "mp4") score += 40;
  if (ext === "webm" || ext === "mov") score += 32;
  if (ext === "m4a" || ext === "mp3") score += 30;
  if (isStreamExtension(ext)) {
    score += 18;
    // Prefer audio/webcam HLS over screen-only streams
    const lower = String(item.url || "").toLowerCase();
    if (!lower.includes("screen")) score += 30;
  }
  if (item.mime && (/^video\//i.test(item.mime) || /^audio\//i.test(item.mime))) score += 15;
  if (item.preview) score += 6;
  if (item.title) score += 3;
  if (/token=|policy=|signature=|expires=/i.test(url)) score += 2;
  if (isLikelySegmentNoise(item.url)) score -= 200;

  return score;
}

function upsertTabMedia(tabId, candidate) {
  if (!tabMediaCache.has(tabId)) tabMediaCache.set(tabId, new Map());
  const bucket = tabMediaCache.get(tabId);

  const existing = bucket.get(candidate.url) || {};
  bucket.set(candidate.url, {
    url: candidate.url,
    source: candidate.source || existing.source || "network",
    title: candidate.title || existing.title || "",
    preview: candidate.preview || existing.preview || "",
    mime: candidate.mime || existing.mime || "",
    ext: candidate.ext || existing.ext || "",
    seenAt: Date.now()
  });
}

function normalizeItem(item, fallbackTitle) {
  const ext = String(
    item.ext || getExtension(item.url) || extensionFromMime(item.mime) || extensionFromUrlHints(item.url)
  ).toLowerCase();
  return {
    url: item.url,
    source: item.source || "unknown",
    title: String(item.title || "").trim() || titleFromUrl(item.url, fallbackTitle),
    preview: item.preview || "",
    mime: mimeWithoutCharset(item.mime),
    ext,
    isStream: isStreamExtension(ext)
  };
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) return;
    if (isBlockedHost(details.url)) return;

    const mime = headerValue(details.responseHeaders, "content-type");
    if (!isLikelyMedia(details.url, mime, details.type)) return;
    if (isLikelySegmentNoise(details.url)) return;

    upsertTabMedia(details.tabId, {
      url: details.url,
      source: "network",
      mime,
      ext: getExtension(details.url) || extensionFromMime(mime) || extensionFromUrlHints(details.url)
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) return;
    if (isBlockedHost(details.url)) return;
    if (!isLikelyMedia(details.url, "", details.type)) return;
    if (isLikelySegmentNoise(details.url)) return;

    upsertTabMedia(details.tabId, {
      url: details.url,
      source: "network",
      ext: getExtension(details.url) || extensionFromUrlHints(details.url)
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) tabMediaCache.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaCache.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_MEDIA_FOR_TAB") {
      const tabId = msg.tabId;
      const tabUrl = msg.tabUrl || "";
      const tabTitle = msg.tabTitle || "Media";

      if (isBlockedHost(tabUrl)) {
        sendResponse({ blocked: true, items: [] });
        return;
      }

      const networkItems = Array.from(tabMediaCache.get(tabId)?.values() || []);

      let pageItems = [];
      let pageTitle = tabTitle;
      try {
        const frameResults = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const candidates = new Map();

            const toAbsolute = (value) => {
              if (!value) return "";
              try {
                return new URL(value, location.href).href;
              } catch {
                return "";
              }
            };

            const captureFrame = (video) => {
              try {
                if (!video.videoWidth || !video.videoHeight) return "";
                const canvas = document.createElement("canvas");
                canvas.width = 160;
                canvas.height = 90;
                const ctx = canvas.getContext("2d");
                if (!ctx) return "";
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL("image/jpeg", 0.72);
              } catch {
                return "";
              }
            };

            const add = (url, source, meta = {}) => {
              const absolute = toAbsolute(url);
              if (!absolute || absolute.startsWith("blob:") || absolute.startsWith("data:")) return;

              const existing = candidates.get(absolute) || {
                url: absolute,
                source,
                title: "",
                preview: "",
                mime: "",
                ext: ""
              };

              if (!existing.title && meta.title) existing.title = meta.title;
              if (!existing.preview && meta.preview) existing.preview = meta.preview;
              if (!existing.mime && meta.mime) existing.mime = meta.mime;
              if (!existing.ext && meta.ext) existing.ext = meta.ext;
              if (existing.source === "script" && source !== "script") existing.source = source;

              candidates.set(absolute, existing);
            };

            const extFromUrl = (value) => {
              try {
                const path = new URL(value, location.href).pathname;
                const match = path.match(/\.([a-z0-9]{2,6})$/i);
                return match ? match[1].toLowerCase() : "";
              } catch {
                return "";
              }
            };

            document.querySelectorAll("video, audio").forEach((mediaEl, index) => {
              const tagName = mediaEl.tagName.toLowerCase();
              const sourceTag = tagName === "audio" ? "audio-tag" : "video-tag";
              const title =
                mediaEl.getAttribute("title") ||
                mediaEl.getAttribute("aria-label") ||
                document.title ||
                `${tagName} ${index + 1}`;

              const preview =
                tagName === "video"
                  ? toAbsolute(mediaEl.poster || "") || captureFrame(mediaEl)
                  : "";

              const meta = {
                title,
                preview,
                mime: mediaEl.currentSrc ? "" : mediaEl.getAttribute("type") || "",
                ext: extFromUrl(mediaEl.currentSrc || mediaEl.src || "")
              };

              if (mediaEl.currentSrc) add(mediaEl.currentSrc, sourceTag, meta);
              if (mediaEl.src) add(mediaEl.src, sourceTag, meta);

              mediaEl.querySelectorAll("source").forEach((sourceEl) => {
                add(sourceEl.src, "video-source", {
                  title,
                  preview,
                  mime: sourceEl.type || "",
                  ext: extFromUrl(sourceEl.src || "")
                });
              });
            });

            const mediaHrefHint = /(m3u8|mpd|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mp3|m4a|aac|wav|ogg|opus|flac|mpegurl|dash\+xml)/i;
            document.querySelectorAll("a[href], source[src], video[src], audio[src]").forEach((el) => {
              const raw = el.getAttribute("href") || el.getAttribute("src");
              const declaredType = el.getAttribute("type") || "";
              if (!raw) return;
              if (
                mediaHrefHint.test(raw) ||
                /^video\//i.test(declaredType) ||
                /^audio\//i.test(declaredType) ||
                /mpegurl|dash\+xml/i.test(declaredType)
              ) {
                add(raw, "dom-link", {
                  title: document.title || "Media",
                  mime: declaredType,
                  ext: extFromUrl(raw) || ""
                });
              }
            });

            const scriptText = Array.from(document.scripts)
              .map((scriptEl) => scriptEl.textContent || "")
              .join("\n");
            const urlCandidates = scriptText.match(/https?:\/\/[^\s"'`<>]+/g) || [];
            urlCandidates.slice(0, 3000).forEach((candidateUrl) => {
              if (mediaHrefHint.test(candidateUrl)) {
                add(candidateUrl, "script", {
                  title: document.title || "Media",
                  ext: extFromUrl(candidateUrl)
                });
              }
            });

            try {
              const perfEntries = performance.getEntriesByType("resource") || [];
              const likelyTypes = new Set(["media", "xmlhttprequest", "fetch", "other"]);
              perfEntries.slice(-4000).forEach((entry) => {
                const candidateUrl = String(entry?.name || "");
                const initiatorType = String(entry?.initiatorType || "").toLowerCase();
                if (!candidateUrl) return;
                const hintedExt = extFromUrl(candidateUrl);
                const explicitHint = mediaHrefHint.test(candidateUrl);
                if (!likelyTypes.has(initiatorType) && !explicitHint) return;
                if (!explicitHint && !hintedExt) return;
                add(candidateUrl, "performance", {
                  title: document.title || "Media",
                  ext: hintedExt
                });
              });
            } catch {
              // ignore
            }

            return {
              pageTitle: document.title || "Media",
              items: Array.from(candidates.values())
            };
          }
        });

        if (Array.isArray(frameResults)) {
          frameResults.forEach((entry) => {
            const result = entry?.result;
            if (!result || !Array.isArray(result.items)) return;
            pageItems.push(...result.items);
            if (!pageTitle && result.pageTitle) pageTitle = result.pageTitle;
          });
        }
      } catch {
        // ignore injection failures
      }

      const grouped = new Map();
      [...networkItems, ...pageItems]
        .filter((item) => item?.url && !isBlockedHost(item.url))
        .map((item) => normalizeItem(item, pageTitle || tabTitle || "Media"))
        .filter((item) => !isLikelySegmentNoise(item.url) && isLikelyMedia(item.url, item.mime, ""))
        .forEach((item) => {
          const key = mediaKey(item.url, item.ext);
          const existing = grouped.get(key);
          if (!existing || scoreItem(item) > scoreItem(existing)) grouped.set(key, item);
        });

      const items = Array.from(grouped.values()).sort((a, b) => scoreItem(b) - scoreItem(a));
      sendResponse({ blocked: false, items, pageTitle });
      return;
    }

    if (msg?.type === "DOWNLOAD_MEDIA") {
      const { url, title, tabUrl, ext, mime } = msg;
      if (!url || isBlockedHost(url) || isBlockedHost(tabUrl || "")) {
        sendResponse({ ok: false, error: "Blocked domain" });
        return;
      }

      if (url.startsWith("blob:") || url.startsWith("data:")) {
        sendResponse({ ok: false, error: "This media URL is not directly downloadable" });
        return;
      }

      const guessedExt = String(ext || getExtension(url) || extensionFromMime(mime) || extensionFromUrlHints(url)).toLowerCase();
      const safeFilename = createSafeFilename(title || "media", guessedExt);

      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: safeFilename,
          saveAs: true,
          conflictAction: "uniquify"
        });
        sendResponse({ ok: true, downloadId });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Download failed" });
      }
      return;
    }

    if (msg?.type === "DOWNLOAD_STREAM_LINKS") {
      const { url, title, tabUrl, ext, mime } = msg;
      if (!url || isBlockedHost(url) || isBlockedHost(tabUrl || "")) {
        sendResponse({ ok: false, error: "Blocked domain" });
        return;
      }

      if (!isM3u8Like(url, mime, ext)) {
        sendResponse({ ok: false, error: "Only m3u8 links can be exported right now" });
        return;
      }

      try {
        const result = await collectM3u8Links(url, {
          maxPlaylists: 10,
          maxLinks: 6000,
          timeoutMs: 12000
        });

        if (!result.links.length) {
          sendResponse({ ok: false, error: "No links found in this m3u8 playlist" });
          return;
        }

        const lines = [
          "# StreamFinder - m3u8 link export",
          `# Source: ${url}`,
          `# Generated: ${new Date().toISOString()}`,
          `# Playlists scanned: ${result.playlistCount}`,
          `# Total links: ${result.links.length}`,
          result.truncated ? "# NOTE: Link list was truncated at the safety limit." : ""
        ].filter(Boolean);

        if (result.warnings.length) {
          lines.push(`# Warnings: ${result.warnings.length}`);
          result.warnings.slice(0, 12).forEach((warning) => lines.push(`# - ${warning}`));
          if (result.warnings.length > 12) lines.push("# - ...more warnings omitted");
        }

        lines.push("", ...result.links);

        const safeFilename = createSafeFilename(`${title || "stream"} links`, "txt");
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;

        const downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename: safeFilename,
          saveAs: true,
          conflictAction: "uniquify"
        });

        sendResponse({
          ok: true,
          downloadId,
          count: result.links.length,
          warnings: result.warnings.length,
          truncated: result.truncated
        });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Could not export stream links" });
      }
      return;
    }

    if (msg?.type === "SAVE_AUDIO_HLS_TO_CONVERT") {
      const { url, title, tabUrl } = msg;
      if (!url || isBlockedHost(url) || isBlockedHost(tabUrl || "")) {
        sendResponse({ ok: false, error: "Blocked domain" });
        return;
      }

      if (!isM3u8Like(url)) {
        sendResponse({ ok: false, error: "Kun m3u8 audio-links kan gemmes" });
        return;
      }

      try {
        const safeTitle = String(title || "audio-stream")
          .replace(/[\\/:*?"<>|]/g, "")
          .replace(/\s+/g, "_")
          .trim()
          .slice(0, 120) || "audio-stream";

        const filename = `to_convert/${safeTitle}.txt`;
        const content = `# Audio HLS URL til konvertering\n# Kilde: ${tabUrl || ""}\n# Oprettet: ${new Date().toISOString()}\n\n${url}\n`;
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;

        const downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename,
          saveAs: false,
          conflictAction: "uniquify"
        });

        sendResponse({ ok: true, downloadId, filename: `${safeTitle}.txt` });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Kunne ikke gemme filen" });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();

  return true;
});
