import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveExtension,
  sanitizeAuthor,
  sanitizeTitle,
  detectPlatform,
  detectPlatformFolder,
  generateFileName,
} from "../public/js/downloader/filename.js";
import {
  HISTORY_FILTER_I18N,
  classifyHistoryRecord,
  filterHistoryItems,
} from "../public/js/ui/historyFilter.js";
import { SUPPORTED_LANGS } from "../public/js/i18n/index.js";

const root = process.cwd();

function withMockLocalStorage(initial, fn) {
  const store = new Map(Object.entries(initial || {}));
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  try {
    return fn(store);
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
}

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

test("filename.js: sanitizeAuthor and sanitizeTitle preserve slide suffix and avoid duplicate author", () => {
  assert.equal(sanitizeAuthor("UserOne"), "@UserOne");
  assert.equal(sanitizeAuthor("@already"), "@already");
  assert.equal(sanitizeAuthor("TikTok User"), "");
  assert.equal(sanitizeAuthor("Creator"), "");

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
  assert.equal(sanitizeTitle("Clip", "1080p", "TikTok User"), "Clip");
});

test("filename.js: detectPlatform and detectPlatformFolder recognize Twitter mirror domains", () => {
  for (const url of [
    "https://fxtwitter.com/a/status/123",
    "https://vxtwitter.com/a/status/123",
    "https://fixupx.com/a/status/123",
  ]) {
    assert.equal(detectPlatform(url, ""), "Twitter");
    assert.equal(detectPlatformFolder(url, ""), "Twitter");
  }
});

test("filename.js: generateFileName supports {author} token without duplicating author and preserves upstream #21 presets", () => {
  withMockLocalStorage(
    { mori_filename: "custom", mori_filename_custom: "{author}_{title}" },
    () => {
      const sanitized = sanitizeTitle("Cool photo_2", "PHOTO", "UserOne");
      const name = generateFileName(
        sanitized,
        "jpg",
        "https://x.com/UserOne/status/123",
        "https://pbs.twimg.com/media/abc?format=jpg&name=orig",
        "PHOTO",
        "UserOne",
      );
      assert.equal(name, "@UserOne_Cool photo_2.jpg");
    },
  );

  withMockLocalStorage(
    { mori_filename: "custom", mori_filename_custom: "{platform}_{author}_{title}" },
    () => {
      const sanitized = sanitizeTitle("Clip", "1080p", "");
      const name = generateFileName(
        sanitized,
        "mp4",
        "https://tiktok.com/@x/video/1",
        "https://cdn.example/v.mp4",
        "1080p",
        "",
      );
      assert.equal(name, "TikTok_Clip.mp4");
    },
  );

  withMockLocalStorage({ mori_filename: "platform_quality_number" }, () => {
    const name = generateFileName(
      "Clip (@creator)",
      "mp4",
      "https://www.tiktok.com/@a/video/1",
      "https://cdn.example/v.mp4",
      "1080p",
      "creator",
    );
    assert.equal(name, "TikTok_1080p_001.mp4");
  });

  withMockLocalStorage({ mori_filename: "title" }, () => {
    const sanitized = sanitizeTitle("Sunset_1", "PHOTO", "@artist");
    const name = generateFileName(
      sanitized,
      "png",
      "https://fxtwitter.com/artist/status/99",
      "https://pbs.twimg.com/media/x?format=png&name=orig",
      "PHOTO",
      "@artist",
    );
    assert.equal(name, "Sunset_1 (@artist).png");
  });
});

test("historyFilter.js: classifies records accurately and filters full dataset across pagination boundaries", () => {
  assert.deepEqual(
    classifyHistoryRecord({
      title: "My spotify video review",
      url: "https://youtube.com/watch?v=1",
      favorite: true,
    }),
    { fav: true, cat: "video" },
  );
  assert.deepEqual(
    classifyHistoryRecord({
      title: "Track",
      url: "https://open.spotify.com/track/123",
    }),
    { fav: false, cat: "audio" },
  );
  assert.deepEqual(
    classifyHistoryRecord({
      title: "Gallery (PDF)",
      url: "mori-tool://pdf-gallery/123/doc.pdf",
      localFiles: [{ type: "PDF", path: "Download/Mori/doc.pdf" }],
    }),
    { fav: false, cat: "doc" },
  );

  // Build 60 items (> BATCH_SIZE=25) and verify search/chips find item at index 55
  const items = Array.from({ length: 60 }, (_, i) => ({
    title: i === 55 ? "Rare Pixiv Illustration" : `Video Item ${i}`,
    author: i === 55 ? "@rareartist" : "@user",
    url: i === 55 ? "https://www.pixiv.net/artworks/999" : `https://tiktok.com/@u/video/${i}`,
    favorite: i === 55 || i === 2,
    timestamp: Date.now() - i * 1000,
  }));

  const searchHits = filterHistoryItems(items, { tab: "all", query: "rareartist" });
  assert.equal(searchHits.length, 1);
  assert.equal(searchHits[0].title, "Rare Pixiv Illustration");

  const docHits = filterHistoryItems(items, { tab: "doc", query: "" });
  assert.equal(docHits.length, 1);
  assert.equal(docHits[0].title, "Rare Pixiv Illustration");

  const favHits = filterHistoryItems(items, { tab: "fav", query: "" });
  assert.equal(favHits.length, 2);

  for (const lang of SUPPORTED_LANGS) {
    assert.ok(HISTORY_FILTER_I18N[lang], `Expected HISTORY_FILTER_I18N to include locale '${lang}'`);
    assert.ok(HISTORY_FILTER_I18N[lang].searchPlaceholder);
  }
});

test("ui.js: filters history before pagination in renderHistory", () => {
  const src = fs.readFileSync(path.join(root, "public/js/ui.js"), "utf8");
  const filterPos = src.indexOf("const filteredHistory = filterHistoryItems(");
  const batchPos = src.indexOf("const renderBatch = () =>");
  assert.ok(filterPos > 0, "Expected filterHistoryItems call in ui.js");
  assert.ok(batchPos > filterPos, "Expected filtering to occur BEFORE renderBatch pagination");
  assert.ok(
    src.includes("Math.min(renderedIndex + BATCH_SIZE, filteredHistory.length)"),
    "Expected renderBatch to paginate filteredHistory",
  );
});

test("settings/storage.js: backup blocks PIN/lock keys, allows internal resolver URIs, and supports 10 locales incl. es", () => {
  const src = fs.readFileSync(
    path.join(root, "public/js/modules/settings/storage.js"),
    "utf8",
  );
  for (const key of [
    "mori_pin",
    "mori_privacy_lock",
    "mori_lock_type",
    "mori_gallery_thumbs",
    "mori_patched_scraper_bin",
    "mori_active_scraper_version",
  ]) {
    assert.ok(src.includes(`"${key}"`), `Expected ${key} in BACKUP_BLOCKED_KEYS`);
  }
  for (const scheme of [
    "spotidown_resolve:",
    "soundloaders_resolve:",
    "youtube_resolve:",
    "ytmp3gg_resolve:",
    "applemusic_resolve:",
    "mori-tool://",
  ]) {
    assert.ok(src.includes(`"${scheme}"`), `Expected ${scheme} in isValidBackupUrl`);
  }
  assert.ok(src.includes("es: {"), "Expected Spanish (es) translations in BACKUP_I18N");
});

test("downloader/storage.js & downloadBubble.js: size probe guard and bounded cache", () => {
  const dlStorage = fs.readFileSync(
    path.join(root, "public/js/downloader/storage.js"),
    "utf8",
  );
  assert.ok(
    dlStorage.includes("if (nativeHeadStatus > 0) return 0;"),
    "Expected nativeHeadStatus > 0 guard before fetch Range GET fallback",
  );

  const bubble = fs.readFileSync(
    path.join(root, "public/js/ui/downloadBubble.js"),
    "utf8",
  );
  assert.ok(
    bubble.includes("const MAX_PROBE_CACHE = 100;"),
    "Expected probedSizeCache cap of 100 entries",
  );
  assert.ok(
    bubble.includes("setProbedSizeCache("),
    "Expected setProbedSizeCache eviction helper",
  );
});

test("scrapers/index.js, result.js, share.js, batchManager.js, core.js: FxTwitter, XSS escape, and clean v4.6.1 base", () => {
  const scrapersIdx = fs.readFileSync(
    path.join(root, "public/js/scrapers/index.js"),
    "utf8",
  );
  assert.ok(
    scrapersIdx.includes("fx.photoCount > 0 && fx.videoCount === 0"),
    "Expected photo-only tweet short-circuit in scrapeTwitter",
  );
  assert.ok(scrapersIdx.includes('"GIF (MP4)"'), "Expected GIF (MP4) label");
  assert.ok(scrapersIdx.includes('"name", "orig"'), "Expected pbs.twimg.com name=orig upgrade");
  assert.ok(
    !scrapersIdx.includes("mori_patched_scraper_bin"),
    "OTA scraper patching must not be re-introduced on v4.6.1 base",
  );
  assert.ok(
    !fs.existsSync(path.join(root, "public/js/modules/updateScrapers.js")),
    "Legacy OTA updateScrapers.js must not exist",
  );

  const resultSrc = fs.readFileSync(path.join(root, "public/js/ui/result.js"), "utf8");
  assert.ok(
    resultSrc.includes("let cleanPath = dl.rawUri || dl.rawPath || dl.url"),
    "Expected cleanPath definition before audio.onerror fallback",
  );
  assert.ok(resultSrc.includes("const isVideoUrl ="), "Expected isVideoUrl check before isImage");
  assert.ok(resultSrc.includes("const targetIndices ="), "Expected targetIndices filtering for Download All");

  const shareSrc = fs.readFileSync(path.join(root, "public/js/share.js"), "utf8");
  assert.ok(shareSrc.includes("fxtwitter.com"));
  assert.ok(shareSrc.includes("vxtwitter.com"));
  assert.ok(shareSrc.includes("fixupx.com"));
  assert.ok(shareSrc.includes("const escapeHtml ="));

  const batchSrc = fs.readFileSync(path.join(root, "public/js/modules/batchManager.js"), "utf8");
  assert.ok(batchSrc.includes("fixupx.com"));

  const coreSrc = fs.readFileSync(path.join(root, "public/js/modules/core.js"), "utf8");
  assert.ok(coreSrc.includes('export const APP_VERSION = "4.6.1";'));
  assert.ok(coreSrc.includes('export const GITHUB_REPO = "ahmad-rafi-stack/Mori";'));
});
