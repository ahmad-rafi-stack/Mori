// Mori Scraper Engine Runtime Loader
// GNU General Public License v3.0 — (C) 2026 coflyn.

import * as utils from "../utils/index.js";
import * as urlUtils from "../utils/urlUtils.js";
import * as core from "../modules/core.js";
import { scraperFetch } from "./httpHelper.js";

export * from "./httpHelper.js";

// Expose deps to the bundled IIFE core
window.__moriDeps = { utils, urlUtils, core };

let _corePromise = null;
let _selectedTwitterSource = null;

// Short-lived in-memory cache for FxTwitter API lookups (avoids double requests)
const _fxTwitterCache = new Map();
const FX_CACHE_TTL_MS = 30000;

const GENERIC_AUTHORS = new Set([
  "unknown",
  "tiktok user",
  "douyin user",
  "rednote creator",
  "bilibili creator",
  "facebook media",
  "creator",
  "user",
]);

function isGenericAuthor(val) {
  const clean = String(val || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  return !clean || GENERIC_AUTHORS.has(clean);
}

function extractAuthorFromUrl(url, platform) {
  if (!url || typeof url !== "string") return "";
  if (platform === "twitter") {
    const m = url.match(
      /(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com)\/([a-z0-9_]{1,30})\/status/i,
    );
    if (m?.[1] && !["i", "web", "intent"].includes(m[1].toLowerCase())) {
      return `@${m[1]}`;
    }
  } else if (platform === "tiktok") {
    const m = url.match(/tiktok\.com\/@([a-z0-9._-]+)/i);
    if (m?.[1]) return `@${m[1]}`;
  } else if (platform === "instagram") {
    const m = url.match(
      /instagram\.com\/([a-z0-9._]{1,40})\/(?:p|reel|reels|tv)\//i,
    );
    if (
      m?.[1] &&
      ![
        "p",
        "reel",
        "reels",
        "tv",
        "stories",
        "share",
        "explore",
        "accounts",
      ].includes(m[1].toLowerCase())
    ) {
      return `@${m[1]}`;
    }
  } else if (platform === "threads") {
    const m = url.match(/threads\.(?:net|com)\/@([a-z0-9._]+)/i);
    if (m?.[1]) return `@${m[1]}`;
  } else if (platform === "facebook") {
    const m = url.match(
      /facebook\.com\/([a-z0-9.]{2,50})\/(?:posts|videos|reel|photos)\//i,
    );
    if (
      m?.[1] &&
      ![
        "share",
        "watch",
        "reel",
        "reels",
        "groups",
        "events",
        "story.php",
        "permalink.php",
        "profile.php",
        "photo.php",
      ].includes(m[1].toLowerCase())
    ) {
      return m[1];
    }
  } else if (platform === "reddit") {
    const m = url.match(/reddit\.com\/(r|u|user)\/([a-z0-9_-]+)/i);
    if (m?.[1] && m?.[2]) {
      const prefix = m[1].toLowerCase() === "r" ? "r" : "u";
      return `${prefix}/${m[2]}`;
    }
  }
  return "";
}

async function fetchYouTubeOEmbedAuthor(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const oeRes = await scraperFetch(
      {
        url: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        rawResponse: true,
      },
      "YouTube oEmbed",
    );
    let oeData = oeRes?.data ?? oeRes;
    if (typeof oeData === "string") {
      try {
        oeData = JSON.parse(oeData);
      } catch (_) {
        oeData = null;
      }
    }
    if (oeData && typeof oeData === "object") {
      const handleMatch = String(oeData.author_url || "").match(
        /\/@([^/?#]+)/,
      );
      if (handleMatch?.[1]) return `@${handleMatch[1]}`;
      if (oeData.author_name) return String(oeData.author_name).trim();
    }
  } catch (_) {}
  return "";
}

async function enrichScrapeAuthor(res, url, platform) {
  if (!res?.status || !res?.result) return res;
  if (!isGenericAuthor(res.result.author)) return res;

  let derived = extractAuthorFromUrl(res.result.sourceUrl || url, platform);

  if (
    !derived &&
    (platform === "spotify" ||
      platform === "applemusic" ||
      platform === "bandcamp")
  ) {
    const title = String(res.result.title || "");
    const sepIdx = title.indexOf(" - ");
    if (sepIdx > 0) {
      const candidate = title.slice(0, sepIdx).trim();
      if (candidate && !isGenericAuthor(candidate)) {
        derived = candidate;
      }
    }
  }

  if (!derived && platform === "youtube") {
    derived = await fetchYouTubeOEmbedAuthor(res.result.sourceUrl || url);
  }

  if (derived && !isGenericAuthor(derived)) {
    res.result.author = derived;
  }
  return res;
}

function rememberScrapeResult(res) {
  if (res?.status && res?.result && typeof window !== "undefined") {
    window.__moriLastScrapeResult = res.result;
  }
  return res;
}

export function extractTweetId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/status(?:es)?\/(\d+)/i);
  return match ? match[1] : null;
}

export function toTwitterOrigImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  if (rawUrl.includes("pbs.twimg.com")) {
    try {
      const u = new URL(rawUrl);
      u.searchParams.set("name", "orig");
      return u.toString();
    } catch (_) {}
  }
  return rawUrl;
}

async function fetchFxTwitterTweet(tweetId) {
  if (!tweetId) return null;
  const now = Date.now();
  const cached = _fxTwitterCache.get(tweetId);
  if (cached && now - cached.ts < FX_CACHE_TTL_MS) {
    return cached.tweet;
  }
  try {
    const res = await scraperFetch(
      {
        url: `https://api.fxtwitter.com/status/${tweetId}`,
        rawResponse: true,
      },
      "FxTwitter Direct",
    );
    let data = res?.data ?? res;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = null;
      }
    }
    const tweet = data?.tweet || null;
    if (tweet) {
      if (_fxTwitterCache.size >= 20) {
        const oldestKey = _fxTwitterCache.keys().next().value;
        if (oldestKey) _fxTwitterCache.delete(oldestKey);
      }
      _fxTwitterCache.set(tweetId, { tweet, ts: now });
    }
    return tweet;
  } catch (err) {
    console.warn("[Mori] FxTwitter lookup warning:", err);
    return null;
  }
}

export function buildFxTwitterPayload(tweet, originalUrl, tweetId) {
  if (!tweet) return null;
  const mediaObj = tweet.media || tweet.quote?.media || null;
  const rawList =
    Array.isArray(mediaObj?.all) && mediaObj.all.length > 0
      ? mediaObj.all
      : [
          ...(Array.isArray(mediaObj?.photos) ? mediaObj.photos : []),
          ...(Array.isArray(mediaObj?.videos) ? mediaObj.videos : []),
        ];

  if (rawList.length === 0) return null;

  const downloads = [];
  const photoItems = [];
  const seenUrls = new Set();
  let photoCount = 0;
  let videoCount = 0;

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const itemType = String(item.type || "").toLowerCase();

    if (
      itemType === "photo" ||
      (!itemType && item.url && item.url.includes("pbs.twimg.com"))
    ) {
      if (!item.url) continue;
      const origUrl = toTwitterOrigImageUrl(item.url);
      if (seenUrls.has(origUrl)) continue;
      seenUrls.add(origUrl);
      const photoEntry = {
        type: "PHOTO",
        url: origUrl,
        thumbnail: item.url,
        isMirror: false,
      };
      downloads.push(photoEntry);
      photoItems.push(photoEntry);
      photoCount++;
    } else if (itemType === "video" || itemType === "gif") {
      videoCount++;
      const variants = Array.isArray(item.variants)
        ? item.variants
            .filter(
              (v) =>
                v &&
                v.url &&
                (!v.content_type || v.content_type.includes("video/mp4")),
            )
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        : [];

      if (variants.length > 0) {
        let addedForVideo = 0;
        for (const v of variants) {
          if (seenUrls.has(v.url)) continue;
          seenUrls.add(v.url);
          const resMatch = v.url.match(/\/vid\/(?:avc1\/)?(\d+x\d+)\//i);
          const label = resMatch
            ? resMatch[1].toLowerCase()
            : itemType === "gif"
              ? "GIF (MP4)"
              : addedForVideo === 0
                ? "HD"
                : "SD";
          downloads.push({
            type: label,
            url: v.url,
            thumbnail: item.thumbnail_url || null,
            isMirror: addedForVideo > 0,
          });
          addedForVideo++;
        }
      } else if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        downloads.push({
          type: itemType === "gif" ? "GIF (MP4)" : "MP4",
          url: item.url,
          thumbnail: item.thumbnail_url || null,
          isMirror: false,
        });
      }
    }
  }

  if (downloads.length === 0) return null;

  const cleanText = String(tweet.text || "")
    .replace(/https:\/\/t\.co\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const handle = tweet.author?.screen_name
    ? `@${tweet.author.screen_name}`
    : "";
  const authorName = tweet.author?.name || "";
  const rawTitle =
    cleanText ||
    (authorName && handle
      ? `${authorName} (${handle})`
      : handle
        ? `${handle} - Tweet`
        : `Tweet (${tweetId})`);
  const title =
    rawTitle.length > 90 ? rawTitle.substring(0, 87) + "..." : rawTitle;
  const thumbnail =
    downloads[0]?.thumbnail ||
    downloads[0]?.url ||
    tweet.media?.mosaic?.formats?.jpeg ||
    null;

  return {
    photoCount,
    videoCount,
    photoItems,
    author: handle || authorName,
    response: {
      status: true,
      result: {
        title,
        author: handle || authorName,
        thumbnail,
        downloads,
        sourceUrl: originalUrl,
      },
    },
  };
}

async function fetchBundleText() {
  const urls = [
    "js/scrapers/bundle.js",
    "/js/scrapers/bundle.js",
    "./js/scrapers/bundle.js",
    "file:///android_asset/public/js/scrapers/bundle.js",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) return res.text();
    } catch (_) {}
  }
  // XHR fallback (Android WebView edge cases)
  if (typeof XMLHttpRequest !== "undefined") {
    for (const u of urls) {
      const text = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", u, true);
        xhr.onload = () => (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) ? resolve(xhr.responseText) : resolve(null);
        xhr.onerror = () => resolve(null);
        xhr.send();
      });
      if (text) return text;
    }
  }
  throw new Error("[Mori] Could not load scrapers/bundle.js");
}

async function loadCoreScrapers() {
  if (_corePromise) return _corePromise;
  _corePromise = (async () => {
    try {
      const scriptText = await fetchBundleText();
      const fn = new Function(
        scriptText +
          "\nreturn typeof __MoriCoreScrapers !== 'undefined' ? __MoriCoreScrapers : (typeof window !== 'undefined' ? window.__MoriCoreScrapers : null);"
      );
      const mod = fn();

      if (!mod) throw new Error("[Mori] Failed to instantiate core scraper modules.");

      window.__MoriCoreScrapers = mod;
      return mod;
    } catch (e) {
      console.error("[Mori] Fatal init error:", e);
      if (typeof window.showFatalErrorModal === "function") {
        window.showFatalErrorModal(e.message || String(e));
      }
      throw e;
    }
  })();
  return _corePromise;
}

export async function scrapeTikTok(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeTikTok(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "tiktok"));
}
export function setTikTokSource(...args) { loadCoreScrapers().then((m) => m.setTikTokSource(...args)); }

export async function scrapeYouTube(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeYouTube(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "youtube"));
}
export function setYouTubeSource(...args) { loadCoreScrapers().then((m) => m.setYouTubeSource(...args)); }

export async function scrapeInstagram(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeInstagram(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "instagram"));
}
export function setInstagramSource(...args) { loadCoreScrapers().then((m) => m.setInstagramSource(...args)); }

export function setTwitterSource(source, ...rest) {
  _selectedTwitterSource = source ?? null;
  loadCoreScrapers().then((m) => m.setTwitterSource(source, ...rest));
}

export async function scrapeTwitter(url, ...rest) {
  const tweetId = extractTweetId(url);
  const selectedSource = _selectedTwitterSource;

  // Detect photo-only tweets via FxTwitter directly so users don't get prompted to pick
  // between video-only TVD / SaveTWT servers or wait for them to fail in preset/batch/share modes.
  if (tweetId) {
    const tweet = await fetchFxTwitterTweet(tweetId);
    const fx = buildFxTwitterPayload(tweet, url, tweetId);
    if (fx && fx.photoCount > 0 && fx.videoCount === 0) {
      _selectedTwitterSource = null;
      return rememberScrapeResult(fx.response);
    }
  }

  const c = await loadCoreScrapers();
  if (selectedSource) {
    c.setTwitterSource(selectedSource);
    _selectedTwitterSource = null;
  } else {
    c.setTwitterSource(null);
  }

  let res = await c.scrapeTwitter(url, ...rest);

  // If caller still needs to prompt the user for video server selection, pass through
  if (res && res.requireSource) {
    return res;
  }

  if (
    res &&
    res.status &&
    Array.isArray(res.result?.downloads) &&
    res.result.downloads.length > 0
  ) {
    // Enrich mixed photo+video tweets (TVD/SaveTWT drop photos when video is present),
    // upgrade any low-res pbs.twimg.com photo URLs to name=orig, and ensure author handle is populated.
    if (tweetId) {
      const tweet = await fetchFxTwitterTweet(tweetId);
      const fx = buildFxTwitterPayload(tweet, url, tweetId);
      if (fx) {
        if (!res.result.author && fx.author) {
          res.result.author = fx.author;
        }
        if (fx.photoItems.length > 0) {
          const existingByBase = new Map();
          for (const d of res.result.downloads) {
            const base = String(d?.url || "").split("?")[0].toLowerCase();
            if (base && !existingByBase.has(base)) {
              existingByBase.set(base, d);
            }
          }
          for (const photo of fx.photoItems) {
            const base = photo.url.split("?")[0].toLowerCase();
            const existing = existingByBase.get(base);
            if (!existing) {
              existingByBase.set(base, photo);
              res.result.downloads.push(photo);
            } else if (
              typeof existing.url === "string" &&
              existing.url.includes("pbs.twimg.com") &&
              !/[?&]name=orig\b/i.test(existing.url)
            ) {
              existing.url = photo.url;
            }
          }
        }
      }
    }
    return rememberScrapeResult(await enrichScrapeAuthor(res, url, "twitter"));
  }

  // Fallback to FxTwitter Direct when TVD/SaveTWT fail on videos/GIFs.
  if (tweetId) {
    const tweet = await fetchFxTwitterTweet(tweetId);
    const fx = buildFxTwitterPayload(tweet, url, tweetId);
    if (fx?.response?.status) {
      return rememberScrapeResult(fx.response);
    }
  }

  return res;
}

export async function scrapeSpotify(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeSpotify(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "spotify"));
}
export function setSpotifySource(...args) { loadCoreScrapers().then((m) => m.setSpotifySource(...args)); }

export async function scrapeBilibili(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeBilibili(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "bilibili"));
}
export async function scrapePixiv(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapePixiv(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "pixiv"));
}
export async function scrapeRedNote(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeRedNote(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "rednote"));
}

export async function scrapeDouyin(url, ...rest) {
  const originalUrl = url;
  let targetUrl = url;

  if (typeof url === "string" && (url.includes("v.douyin.com") || url.includes("/share/slides/"))) {
    try {
      let resolvedUrl = url;
      if (url.includes("v.douyin.com")) {
        const fetchRes = await scraperFetch(
          {
            url,
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            rawResponse: true,
          },
          "Douyin Resolver"
        );
        if (fetchRes?.url) resolvedUrl = fetchRes.url;
      }
      const slidesMatch = resolvedUrl.match(new RegExp("share/slides/([0-9]{15,22})", "i"));
      if (slidesMatch?.[1]) {
        targetUrl = "https://www.iesdouyin.com/share/video/" + slidesMatch[1] + "/";
      } else if (resolvedUrl && resolvedUrl !== url) {
        targetUrl = resolvedUrl;
      }
    } catch (e) {
      console.warn("[Mori] Douyin resolver warning:", e);
    }
  }

  const c = await loadCoreScrapers();
  let res;
  try {
    res = await c.scrapeDouyin(targetUrl, ...rest);
    if (!res || !res.status) {
      await new Promise((r) => setTimeout(r, 400));
      res = await c.scrapeDouyin(targetUrl, ...rest);
    }
  } catch (err) {
    await new Promise((r) => setTimeout(r, 400));
    res = await c.scrapeDouyin(targetUrl, ...rest);
  }

  if (res) {
    if (res.result) res.result.sourceUrl = originalUrl;
    if (res.data) res.data.sourceUrl = originalUrl;
    res.sourceUrl = originalUrl;
  }
  return rememberScrapeResult(await enrichScrapeAuthor(res, originalUrl, "douyin"));
}

export async function scrapeThreads(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeThreads(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "threads"));
}
export async function scrapePinterest(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapePinterest(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "pinterest"));
}
export async function scrapeAppleMusic(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeAppleMusic(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "applemusic"));
}
export async function scrapeFacebook(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeFacebook(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "facebook"));
}
export async function scrapeBandcamp(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeBandcamp(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "bandcamp"));
}
export async function scrapeReddit(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeReddit(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "reddit"));
}
export async function scrapeTeraBox(url, ...rest) {
  const res = await (await loadCoreScrapers()).scrapeTeraBox(url, ...rest);
  return rememberScrapeResult(await enrichScrapeAuthor(res, url, "terabox"));
}
