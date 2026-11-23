// storage.js — file system downloading, retries, and persistence
import { Filesystem, CapacitorHttp } from "../utils/index.js";
import { translations } from "../i18n/index.js";
import { currentLang } from "../modules/core.js";

/**
 * Removes temporary .tmp files across all search directories
 */
export async function cleanupTempFiles(fullPath, targetName, directoriesToTry) {
  if (!Filesystem || !targetName) return;
  const tempName = targetName.endsWith(".tmp") ? targetName : `${targetName}.tmp`;
  for (const dir of directoriesToTry) {
    await Filesystem.deleteFile({
      path: fullPath + "/" + tempName,
      directory: dir,
    }).catch(() => {});
  }
}

/**
 * Deletes saved file across directories (e.g. after cancellation)
 */
export async function deleteSavedFile(savedFile, directoriesToTry) {
  if (!Filesystem || !savedFile?.path) return;
  for (const dir of directoriesToTry) {
    await Filesystem.deleteFile({
      path: savedFile.path,
      directory: dir,
    }).catch(() => {});
  }
}

const MIN_VALID_MEDIA_BYTES = 4096;

function getHeaderCaseInsensitive(headersObj, name) {
  if (!headersObj || typeof headersObj !== "object") return "";
  const target = name.toLowerCase();
  for (const key of Object.keys(headersObj)) {
    if (key.toLowerCase() === target) {
      return headersObj[key] ?? "";
    }
  }
  return "";
}

/**
 * Probes Content-Length header if not yet reported by native stream.
 * Never buffers full bodies via CapacitorHttp GET to prevent OOM / data waste.
 */
export async function probeContentLength(url, headers = {}) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return 0;

  const isInvalidContentType = (ct) => {
    const s = String(ct || "").toLowerCase();
    return (
      s.includes("text/html") ||
      s.includes("text/plain") ||
      s.includes("application/json") ||
      s.includes("application/problem+json") ||
      s.includes("application/xml") ||
      s.includes("text/xml")
    );
  };

  let nativeHeadStatus = 0;

  // 1. HEAD request via CapacitorHttp (safe: no response body)
  try {
    if (CapacitorHttp?.request) {
      const headRes = await CapacitorHttp.request({
        method: "HEAD",
        url,
        headers,
        connectTimeout: 6000,
        readTimeout: 6000,
      });
      nativeHeadStatus = headRes?.status || 0;
      if (nativeHeadStatus === 403 || nativeHeadStatus === 404 || nativeHeadStatus === 410) {
        return 0;
      }
      if (nativeHeadStatus >= 200 && nativeHeadStatus < 400) {
        const h = headRes?.headers || {};
        const ct = getHeaderCaseInsensitive(h, "content-type");
        if (!isInvalidContentType(ct)) {
          const parsed = parseInt(getHeaderCaseInsensitive(h, "content-length") || "0", 10);
          if (parsed >= MIN_VALID_MEDIA_BYTES) return parsed;
        }
      }
    }
  } catch (_) {}

  // 2. HEAD request via fetch (only if CapacitorHttp was unavailable or errored)
  if (nativeHeadStatus === 0) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers,
        signal: ctrl.signal,
      });
      if (res.status === 403 || res.status === 404 || res.status === 410) {
        return 0;
      }
      if (res.status >= 200 && res.status < 400) {
        const ct = res.headers.get("content-type") || "";
        if (!isInvalidContentType(ct)) {
          const parsed = parseInt(res.headers.get("content-length") || "0", 10);
          if (parsed >= MIN_VALID_MEDIA_BYTES) return parsed;
        }
      }
    } catch (_) {
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. Fallback Range GET (bytes=0-0) via fetch ONLY when CapacitorHttp did not already respond
  // (in Capacitor WebView, fetch strips Referer/User-Agent and fails CORS on most media CDNs)
  if (nativeHeadStatus > 0) return 0;

  const rangeCtrl = new AbortController();
  const rangeTimer = setTimeout(() => rangeCtrl.abort(), 5000);
  let rangeRes = null;
  try {
    rangeRes = await fetch(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      signal: rangeCtrl.signal,
    });
    if (rangeRes.status >= 200 && rangeRes.status < 400) {
      const ct = rangeRes.headers.get("content-type") || "";
      if (!isInvalidContentType(ct)) {
        const cr = rangeRes.headers.get("content-range") || "";
        const match = cr.match(/\/(\d+)$/);
        if (match && match[1]) {
          const total = parseInt(match[1], 10);
          if (total >= MIN_VALID_MEDIA_BYTES) return total;
        }
        // Only trust Content-Length when server returned full 200 OK (not 206 which reports 1 byte)
        if (rangeRes.status === 200) {
          const parsed = parseInt(rangeRes.headers.get("content-length") || "0", 10);
          if (parsed >= MIN_VALID_MEDIA_BYTES) return parsed;
        }
      }
    }
  } catch (_) {
  } finally {
    clearTimeout(rangeTimer);
    try {
      rangeRes?.body?.cancel?.().catch(() => {});
    } catch (_) {}
    rangeCtrl.abort();
  }

  return 0;
}

/**
 * Executes file download using Capacitor Filesystem or CapacitorHttp fallback
 */
export async function saveToStorage({
  actualDownloadUrl,
  fileName,
  fullPath,
  targetFolder,
  downloadHeaders,
  directoriesToTry,
  checkCancelled,
}) {
  let savedFile = null;
  let successfulDir = "EXTERNAL_STORAGE";
  let attempts = 0;

  const isAutoRetry = localStorage.getItem("mori_auto_retry") !== "false";
  const customMaxRetry = parseInt(
    localStorage.getItem("mori_max_retry") || "3",
    10,
  );
  const maxAttempts = isAutoRetry ? customMaxRetry : 1;

  // 1. Mobile / Capacitor Filesystem Download
  const tempFileName = `${fileName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`;

  if (!savedFile && Filesystem) {
    for (const dir of directoriesToTry) {
      if (savedFile) break;
      attempts = 0;
      while (attempts < maxAttempts && !savedFile) {
        if (checkCancelled()) {
          await cleanupTempFiles(fullPath, tempFileName, directoriesToTry);
          return { savedFile: null, successfulDir, cancelled: true };
        }
        attempts++;
        try {
          if (attempts > 1) {
            await new Promise((r) => setTimeout(r, 1000));
          }
          const isBypassSsl =
            localStorage.getItem("mori_bypass_ssl") === "true";
          const isForceIpv4 =
            localStorage.getItem("mori_force_ipv4") === "true";

          const dlOpts = {
            url: actualDownloadUrl,
            path: fullPath + "/" + tempFileName,
            directory: dir,
            progress: true,
            headers: downloadHeaders,
          };
          if (isBypassSsl) dlOpts.disableSSLValidation = true;
          if (isForceIpv4) dlOpts.ipv4Only = true;

          const tempSaved = await Filesystem.downloadFile(dlOpts);
          if (tempSaved) {
            // Rename .tmp to actual file name atomically on completion
            try {
              await Filesystem.rename({
                from: fullPath + "/" + tempFileName,
                to: fullPath + "/" + fileName,
                directory: dir,
              });
              savedFile = { path: fullPath + "/" + fileName };
            } catch (_) {
              // Fallback copy if rename unsupported
              await Filesystem.copy({
                from: fullPath + "/" + tempFileName,
                to: fullPath + "/" + fileName,
                directory: dir,
              });
              await Filesystem.deleteFile({
                path: fullPath + "/" + tempFileName,
                directory: dir,
              }).catch(() => {});
              savedFile = { path: fullPath + "/" + fileName };
            }
            successfulDir = dir;
          }
        } catch (dlErr) {
          console.warn(
            `Download attempt ${attempts} on ${dir} failed:`,
            dlErr,
          );
          // Clean up leftover .tmp file on error
          await Filesystem.deleteFile({
            path: fullPath + "/" + tempFileName,
            directory: dir,
          }).catch(() => {});

          // Fallback to CapacitorHttp blob download if retries exhausted
          if (attempts >= maxAttempts && CapacitorHttp) {
            try {
              const httpRes = await CapacitorHttp.get({
                url: actualDownloadUrl,
                responseType: "blob",
                headers: downloadHeaders,
                connectTimeout: 20000,
                readTimeout: 30000,
              });
              if (
                httpRes &&
                httpRes.status === 200 &&
                httpRes.data &&
                typeof httpRes.data === "string"
              ) {
                await Filesystem.writeFile({
                  path: fullPath + "/" + fileName,
                  data: httpRes.data,
                  directory: dir,
                });
                savedFile = { path: fullPath + "/" + fileName };
                successfulDir = dir;
              }
            } catch (fallbackErr) {
              console.warn(
                `Http blob fallback on ${dir} failed:`,
                fallbackErr,
              );
            }
          }
        }
      }
    }
  }

  if (!savedFile) {
    if (checkCancelled()) {
      await cleanupTempFiles(fullPath, tempFileName, directoriesToTry);
      return { savedFile: null, successfulDir, cancelled: true };
    }
    await cleanupTempFiles(fullPath, tempFileName, directoriesToTry);
    throw new Error(
      translations[currentLang]?.["toast-download-failed"] || "Download failed",
    );
  }

  if (checkCancelled()) {
    await deleteSavedFile(savedFile, directoriesToTry);
    return { savedFile: null, successfulDir, cancelled: true };
  }

  return { savedFile, successfulDir, cancelled: false };
}
