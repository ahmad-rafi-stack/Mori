// Filename, extension, and subfolder resolution utilities
import { t } from "../i18n/index.js";

export function resolveExtension(type, url) {
  const isAudio = /mp3|audio|128k|48k|m4a|wav|flac/i.test(type);
  const isImage =
    /image|photo|jpg|jpeg|png|webp/i.test(type) ||
    /\.(jpg|jpeg|png|webp)/i.test(url) ||
    /[?&]format=(jpg|jpeg|png|webp)\b/i.test(url);
  let ext = isAudio ? "mp3" : isImage ? "jpg" : "mp4";
  const typeStr = (type || "").toLowerCase();
  const urlLower = (url || "").toLowerCase();
  const formatParam = urlLower.match(/[?&]format=(jpg|jpeg|png|webp)\b/i);

  if (
    /\.png(\?|$)/i.test(urlLower) ||
    typeStr.includes("png") ||
    formatParam?.[1] === "png"
  )
    ext = "png";
  else if (
    /\.webp(\?|$)/i.test(urlLower) ||
    typeStr.includes("webp") ||
    formatParam?.[1] === "webp"
  )
    ext = "webp";
  else if (/\.m4a(\?|$)/i.test(urlLower) || typeStr.includes("m4a")) ext = "m4a";
  else if (/\.mp3(\?|$)/i.test(urlLower) || typeStr.includes("mp3")) ext = "mp3";
  else if (
    /\.jpe?g(\?|$)/i.test(urlLower) ||
    typeStr.includes("jpg") ||
    typeStr.includes("jpeg") ||
    formatParam?.[1] === "jpg" ||
    formatParam?.[1] === "jpeg"
  )
    ext = "jpg";
  else if (
    /\.mp4(\?|$)/i.test(urlLower) ||
    typeStr.includes("video") ||
    typeStr.includes("mp4") ||
    /\d+p/i.test(typeStr)
  )
    ext = "mp4";

  const knownExt = (typeStr || urlLower).match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (knownExt) {
    const c = knownExt[1].toLowerCase();
    if (
      !["html", "htm", "php", "asp", "aspx", "jsp", "com", "net", "org"].includes(
        c,
      )
    ) {
      ext = c;
    }
  }

  return ext.toLowerCase();
}

const GENERIC_AUTHOR_PLACEHOLDERS = new Set([
  "unknown",
  "tiktok user",
  "douyin user",
  "rednote creator",
  "bilibili creator",
  "facebook media",
  "creator",
  "user",
]);

export function sanitizeAuthor(author = "") {
  const rawAuthor = String(author || "").trim();
  if (!rawAuthor) return "";
  let cleanAuthor = rawAuthor
    .replace(/[\\/:*?"<>|#%&{}\[\]$^+=~`';,!]/g, "")
    .replace(/[^\w\s\-().@\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/gi, "")
    .trim();

  const authorLower = cleanAuthor.replace(/^@+/, "").toLowerCase();
  if (!cleanAuthor || !authorLower || GENERIC_AUTHOR_PLACEHOLDERS.has(authorLower)) {
    return "";
  }
  if (!cleanAuthor.startsWith("@")) {
    cleanAuthor = `@${cleanAuthor}`;
  }
  return cleanAuthor;
}

export function sanitizeTitle(title, type, author = "") {
  const cleanTypeLabel = (type || "")
    .replace(/\s*\[(MP3|MP4|JPG|PNG|WEBP)\]/gi, "")
    .trim();
  const isTrackType = /^\d+\.\s+/.test(cleanTypeLabel);

  let effectiveTitle = title || "Mori Media";
  if (isTrackType) {
    effectiveTitle =
      cleanTypeLabel.replace(/^\d+\.\s+/, "").trim() || cleanTypeLabel;
  }

  // Preserve multi-photo slide index suffix (_1, _2, ...) before hashtag cleanup & truncation
  const slideSuffixMatch = effectiveTitle.match(/(_\d+)$/);
  const slideSuffix = slideSuffixMatch ? slideSuffixMatch[1] : "";
  if (slideSuffix) {
    effectiveTitle = effectiveTitle.slice(0, -slideSuffix.length);
  }

  // Strip hashtags from caption
  effectiveTitle = effectiveTitle.replace(/#[^\s#]+/g, "");

  let sanitized = effectiveTitle
    .replace(/[\\/:*?"<>|#%&{}\[\]$^+=~`';,!]/g, "")
    .replace(/[^\w\s\-().@\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/gi, "")
    .trim()
    .replace(/\s+/g, " ");

  const cleanAuthor = sanitizeAuthor(author);

  if (cleanAuthor) {
    const maxLen = slideSuffix ? 50 : 55;
    const trimmedCaption = sanitized.substring(0, maxLen).trim();
    if (!trimmedCaption.toLowerCase().includes(`(${cleanAuthor.toLowerCase()})`)) {
      sanitized = trimmedCaption
        ? `${trimmedCaption}${slideSuffix} (${cleanAuthor})`
        : `${cleanAuthor}${slideSuffix}`;
    } else {
      sanitized = `${trimmedCaption}${slideSuffix}`;
    }
  } else {
    const maxLen = slideSuffix ? 50 : 60;
    const trimmedCaption = sanitized.substring(0, maxLen).trim();
    sanitized = `${trimmedCaption}${slideSuffix}`;
  }

  return sanitized || "Mori_Media";
}

export function detectPlatform(sourceUrl, url) {
  const src = (sourceUrl || url || "").toLowerCase();
  if (
    src.includes("tiktok") ||
    src.includes("douyin") ||
    src.includes("iesdouyin")
  )
    return "TikTok";
  if (src.includes("instagram") || src.includes("instagr.am"))
    return "Instagram";
  if (src.includes("youtube") || src.includes("youtu.be")) return "YouTube";
  if (
    src.includes("twitter") ||
    /(?:^|[/.])x\.com(?:[/?#:]|$)/i.test(src) ||
    /(?:^|[/.])t\.co(?:[/?#:]|$)/i.test(src) ||
    src.includes("fxtwitter.com") ||
    src.includes("vxtwitter.com") ||
    src.includes("fixupx.com")
  )
    return "Twitter";
  if (
    src.includes("facebook") ||
    src.includes("fb.watch") ||
    src.includes("fb.com")
  )
    return "Facebook";
  if (src.includes("pinterest") || src.includes("pin.it")) return "Pinterest";
  if (src.includes("spotify") || src.includes("spoti.fi")) return "Spotify";
  if (src.includes("music.apple.com") || src.includes("apple.com"))
    return "AppleMusic";
  if (src.includes("threads.net") || src.includes("threads.com"))
    return "Threads";
  if (
    src.includes("rednote") ||
    src.includes("xiaohongshu") ||
    src.includes("xhslink")
  )
    return "RedNote";
  if (
    src.includes("bilibili") ||
    src.includes("b23.tv") ||
    src.includes("bili.im")
  )
    return "Bilibili";
  if (src.includes("pixiv") || src.includes("pximg") || src.includes("pixiv.me"))
    return "Pixiv";
  if (src.includes("bandcamp") || src.includes("bandcamp.com"))
    return "Bandcamp";
  if (src.includes("reddit") || src.includes("redd.it")) return "Reddit";
  if (
    src.includes("terabox") ||
    src.includes("1024tera") ||
    src.includes("nephobox") ||
    src.includes("4funbox") ||
    src.includes("mirrobox") ||
    src.includes("momerybox") ||
    src.includes("tibibox")
  )
    return "TeraBox";

  return "Media";
}

export function extractQuality(type, url) {
  const raw = `${type || ""} ${url || ""}`;
  const resMatch = raw.match(
    /(?:^|[^a-z0-9])(2160p|1440p|1080p|720p|480p|360p|240p|144p|8k|4k|2k|hd|sd)(?:[^a-z0-9]|$)/i,
  );
  if (resMatch) return resMatch[1].toLowerCase();

  const audioMatch = raw.match(
    /(?:^|[^a-z0-9])(\d{2,3}k(?:bps)?)(?:[^a-z0-9]|$)/i,
  );
  if (audioMatch) return audioMatch[1].toLowerCase();

  return "na";
}

export function getNextPlatformCounter(platform) {
  const p = (platform || "media").toLowerCase();
  const key = `mori_counter_${p}`;
  let count = 0;
  try {
    if (typeof localStorage !== "undefined") {
      count = parseInt(localStorage.getItem(key) || "0", 10);
    }
  } catch (_) {}
  if (isNaN(count) || count < 0) count = 0;
  count += 1;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(count));
    }
  } catch (_) {}
  return String(count).padStart(3, "0");
}

export const FILENAME_PRESETS = {
  title: "{title}",
  "title-platform": "{title}_{platform}",
  "title-date": "{title}_{date}",
  "title-timestamp": "{title}_{timestamp}",
  platform_date_number: "{platform}_{date}_{num}",
  platform_time_number: "{platform}_{time}_{num}",
  platform_quality_number: "{platform}_{quality}_{num}",
  platform_date_time_quality_number: "{platform}_{date}_{time}_{quality}_{num}",
};

export function generateFileName(
  sanitizedTitle,
  ext,
  sourceUrl,
  url,
  type,
  author = "",
) {
  let templateSetting = "title";
  let customTemplate = "";
  try {
    if (typeof localStorage !== "undefined") {
      templateSetting = localStorage.getItem("mori_filename") || "title";
      customTemplate = localStorage.getItem("mori_filename_custom") || "";
    }
  } catch (_) {}

  let template = FILENAME_PRESETS[templateSetting];

  if (!template) {
    if (templateSetting === "custom") {
      template = customTemplate || "{platform}_{date}_{num}";
    } else if (templateSetting.includes("{") && templateSetting.includes("}")) {
      template = templateSetting;
    } else {
      template = "{title}_{timestamp}";
    }
  }

  const cleanExt = (ext || "").toLowerCase().replace(/^\./, "") || "mp4";
  const cleanTitle = (sanitizedTitle || "Mori_Media")
    .toLowerCase()
    .endsWith("." + cleanExt)
    ? sanitizedTitle.slice(0, -(cleanExt.length + 1))
    : sanitizedTitle || "Mori_Media";

  const cleanAuthor = sanitizeAuthor(author);
  const hasAuthorToken = template.includes("{author}");

  // When template explicitly uses {author}, strip trailing " (@handle)" from {title}
  // to prevent duplicate author tags like "@UserOne_Caption (@UserOne).mp4"
  let titleForToken = cleanTitle;
  if (hasAuthorToken && cleanAuthor) {
    const escapedAuthor = cleanAuthor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    titleForToken = titleForToken
      .replace(new RegExp(`\\s*\\(${escapedAuthor}\\)$`, "i"), "")
      .trim();
    if (!titleForToken) titleForToken = "Mori_Media";
  }

  const platform = detectPlatform(sourceUrl, url);
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const timeStr = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  const quality = extractQuality(type, url);

  let numStr = "";
  if (template.includes("{num}")) {
    numStr = getNextPlatformCounter(platform);
  }

  let baseName = template
    .replace(/\{title\}/g, titleForToken)
    .replace(/\{author\}/g, cleanAuthor)
    .replace(/\{platform\}/g, platform)
    .replace(/\{date\}/g, dateStr)
    .replace(/\{time\}/g, timeStr)
    .replace(/\{quality\}/g, quality)
    .replace(/\{num\}/g, numStr)
    .replace(/\{timestamp\}/g, String(Date.now()));

  if (hasAuthorToken && !cleanAuthor) {
    baseName = baseName
      .replace(/_{2,}/g, "_")
      .replace(/\s*-\s*-\s*/g, "-")
      .replace(/^[_-\s]+|[_-\s]+$/g, "");
  }

  baseName = baseName
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!baseName) baseName = cleanTitle || "Mori_Media";

  return `${baseName}.${cleanExt}`;
}

export function detectPlatformFolder(sourceUrl, url) {
  const p = detectPlatform(sourceUrl, url);
  return p === "Media" ? "Other" : p;
}

export async function resolveUniqueFileName(
  fullPath,
  fileName,
  ext,
  directoriesToTry,
  Filesystem,
  btn,
) {
  const overwriteMode = localStorage.getItem("mori_overwrite") || "rename";

  try {
    let checkExist = null;
    for (const dir of directoriesToTry) {
      checkExist = await Filesystem.stat({
        path: fullPath + "/" + fileName,
        directory: dir,
      }).catch(() => null);
      if (checkExist) break;
    }

    if (checkExist) {
      if (overwriteMode === "skip") {
        if (btn) {
          const b = btn.querySelector(".dl-badge");
          if (b) b.textContent = t("status-saved");
        }
        return {
          skipped: true,
          fileName,
          path: fullPath + "/" + fileName,
        };
      } else if (overwriteMode === "overwrite") {
        // Overwrite: keep same filename
        return { skipped: false, fileName };
      } else {
        // rename (default): append _1, _2, etc.
        const dotIdx = fileName.lastIndexOf(".");
        const baseName =
          dotIdx !== -1 ? fileName.substring(0, dotIdx) : fileName;
        let counter = 1;
        let newFileName = `${baseName}_${counter}.${ext.toLowerCase()}`;
        while (true) {
          let exist = null;
          for (const dir of directoriesToTry) {
            exist = await Filesystem.stat({
              path: fullPath + "/" + newFileName,
              directory: dir,
            }).catch(() => null);
            if (exist) break;
          }
          if (!exist) {
            return { skipped: false, fileName: newFileName };
          }
          counter++;
          newFileName = `${baseName}_${counter}.${ext.toLowerCase()}`;
        }
      }
    }
  } catch (_) {}

  return { skipped: false, fileName };
}
