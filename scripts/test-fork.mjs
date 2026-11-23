import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveExtension,
  sanitizeTitle,
  detectPlatformFolder,
} from "../public/js/downloader/filename.js";

const root = process.cwd();

test("filename.js: resolveExtension handles Twitter ?format=png/webp and GIF (MP4)", () => {
  assert.equal(
    resolveExtension("PHOTO", "https://pbs.twimg.com/media/abc?format=png&name=orig"),
    "png",
  );
  assert.equal(
    resolveExtension("PHOTO", "https://pbs.twimg.com/media/abc?format=webp&name=orig"),
    "webp",
  );
  assert.equal(
    resolveExtension("PHOTO", "https://pbs.twimg.com/media/abc?format=jpg&name=orig"),
    "jpg",
  );
  assert.equal(
    resolveExtension("GIF (MP4)", "https://video.twimg.com/tweet_video/abc.mp4"),
    "mp4",
  );
});

test("filename.js: sanitizeTitle preserves slide suffix and avoids duplicate author case-insensitively", () => {
  assert.equal(
    sanitizeTitle("Cool photo #viral_1", "PHOTO", "UserOne"),
    "Cool photo_1 (@UserOne)",
  );
  assert.equal(
    sanitizeTitle("Cool photo_2", "PHOTO", "UserOne"),
    "Cool photo_2 (@UserOne)",
  );
  assert.equal(
    sanitizeTitle("Post (@userone)_3", "PHOTO", "UserOne"),
    "Post (@userone)_3",
  );
  assert.equal(
    sanitizeTitle("Clip", "1080p", "TikTok User"),
    "Clip",
  );
});

test("filename.js: detectPlatformFolder recognizes Twitter mirror domains", () => {
  assert.equal(detectPlatformFolder("https://fxtwitter.com/a/status/123", ""), "Twitter");
  assert.equal(detectPlatformFolder("https://vxtwitter.com/a/status/123", ""), "Twitter");
  assert.equal(detectPlatformFolder("https://fixupx.com/a/status/123", ""), "Twitter");
});

test("storage.js: backup blocks PIN/lock keys, allows internal resolver URIs, and mounts history filter on #historyPage", () => {
  const src = fs.readFileSync(
    path.join(root, "public/js/modules/settings/storage.js"),
    "utf8",
  );
  for (const key of ["mori_pin", "mori_privacy_lock", "mori_lock_type"]) {
    assert.ok(src.includes(`"${key}"`), `Expected ${key} in BACKUP_BLOCKED_KEYS`);
  }
  for (const scheme of [
    "spotidown_resolve:",
    "soundloaders_resolve:",
    "youtube_resolve:",
    "applemusic_resolve:",
  ]) {
    assert.ok(src.includes(`"${scheme}"`), `Expected ${scheme} in isValidBackupUrl`);
  }
  assert.ok(
    src.includes('document.getElementById("historyPage")'),
    "Expected mountHistorySearchAndFilter to target #historyPage",
  );
  assert.ok(
    src.includes("obs.observe(historyPage, { childList: true })"),
    "Expected MutationObserver on historyPage",
  );
});

test("result.js: cleanPath is defined in renderMediaSlides and video URLs take precedence over GIF image check", () => {
  const src = fs.readFileSync(path.join(root, "public/js/ui/result.js"), "utf8");
  assert.ok(
    src.includes("let cleanPath = dl.rawUri || dl.rawPath || dl.url"),
    "Expected cleanPath definition before audio.onerror fallback",
  );
  assert.ok(
    src.includes("const isVideoUrl ="),
    "Expected isVideoUrl check before isImage",
  );
  assert.ok(
    src.includes("const targetIndices ="),
    "Expected targetIndices filtering for Download All",
  );
});

test("bundle.js: oEmbed author fallback handles direct JSON object response", () => {
  const src = fs.readFileSync(
    path.join(root, "public/js/scrapers/bundle.js"),
    "utf8",
  );
  assert.ok(
    !src.includes('let oeData=typeof oeRes?.data=="string"?JSON.parse(oeRes.data):oeRes?.data;'),
    "Stale oeRes?.data-only parsing should be removed",
  );
  assert.ok(
    !src.includes('let rData=typeof rOe?.data=="string"?JSON.parse(rOe.data):rOe?.data;'),
    "Stale rOe?.data-only parsing should be removed",
  );
});
