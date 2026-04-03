# StreamFinder (Chrome Extension)

Find media URLs on the active website tab and download the original source URL.

## What it does
- Scans the current tab using:
  - media tags in the page (`video`, `audio`, `source`)
  - media-like links found in DOM/script text
  - network requests + response MIME headers
- Shows deduplicated results with title, host, type and source
- Lets you copy URL or download directly
- For `.m3u8` streams, can export all discovered playlist/segment URLs to a `*.txt` file

## Notes
- This extension downloads the source URL as-is.
- Stream manifests (`.m3u8` / `.mpd`) are detected and can be downloaded as manifest files.
- For `.m3u8` entries, use **Links.txt** to export URLs found inside the manifest(s).
- Conversion/transcoding to MP4/MP3 should be handled by your external converter workflow.
- YouTube domains are blocked.

## Install (unpacked)
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `/Users/anders/Desktop/mp4Downloader`

## Package for upload
Create zip from the project files at root level (no nested parent folder).
