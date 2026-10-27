// storage.js — file system downloading, real-time byte progress probing, retries, and persistence
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

/**
 * Probes Content-Length header if not yet reported by native stream
 */
export async function probeContentLength(url, headers = {}) {
  try {
    if (CapacitorHttp?.request) {
      const headRes = await CapacitorHttp.request({
        method: "HEAD",
        url,
        headers,
        connectTimeout: 6000,
        readTimeout: 6000,
      });
      const h = headRes?.headers || {};
      const lenVal =
        h["content-length"] ||
        h["Content-Length"] ||
        h["Content-length"] ||
        0;
      const parsed = parseInt(lenVal, 10);
      if (parsed > 0) return parsed;
    }
  } catch (_) {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      headers,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const lenHeader = res.headers.get("content-length");
    const parsed = parseInt(lenHeader || "0", 10);
    if (parsed > 0) return parsed;
  } catch (_) {}
  return 0;
}

/**
 * Executes file download using Tauri, Capacitor Filesystem (with real-time byte progress), or streaming fallback
 */
export async function saveToStorage({
  actualDownloadUrl,
  fileName,
  fullPath,
  targetFolder,
  downloadHeaders,
  directoriesToTry,
  checkCancelled,
  onByteProgress,
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

  // Probe Content-Length asynchronously in background so total MB is known early
  let probedTotalBytes = 0;
  probeContentLength(actualDownloadUrl, downloadHeaders).then((len) => {
    if (len > 0) {
      probedTotalBytes = len;
      if (typeof onByteProgress === "function") {
        onByteProgress({ loadedBytes: 0, totalBytes: probedTotalBytes, isInitProbe: true });
      }
    }
  });

  const tauriInvoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.invoke;

  // 1. Desktop / Tauri Invocation (with event listener if Tauri emits progress)
  if (tauriInvoke) {
    let unlistenTauri = null;
    try {
      const tauriEvent = window.__TAURI__?.event;
      if (tauriEvent?.listen && typeof onByteProgress === "function") {
        unlistenTauri = await tauriEvent.listen("tauri_download_progress", (ev) => {
          const payload = ev?.payload || {};
          const loaded = payload.bytes ?? payload.bytesWritten ?? payload.loaded ?? 0;
          const total = payload.contentLength ?? payload.total ?? probedTotalBytes ?? 0;
          onByteProgress({ loadedBytes: loaded, totalBytes: total });
        });
      }
      const desktopRes = await tauriInvoke("tauri_download_file", {
        url: actualDownloadUrl,
        filename: fileName,
        folder: targetFolder || "",
        headers: downloadHeaders || {},
      });
      if (desktopRes && desktopRes.status) {
        savedFile = { path: desktopRes.path, uri: desktopRes.uri };
      }
    } catch (tErr) {
      console.warn("Tauri native download failed:", tErr);
      throw new Error(
        typeof tErr === "string"
          ? tErr
          : tErr?.message || JSON.stringify(tErr),
      );
    } finally {
      if (typeof unlistenTauri === "function") {
        try {
          unlistenTauri();
        } catch (_) {}
      }
    }
  }

  // 2. Mobile / Capacitor Filesystem Download with real-time .tmp stat & event progress
  if (!savedFile && Filesystem) {
    for (const dir of directoriesToTry) {
      if (savedFile) break;
      attempts = 0;
      while (attempts < maxAttempts && !savedFile) {
        if (checkCancelled()) {
          await cleanupTempFiles(fullPath, fileName, directoriesToTry);
          return { savedFile: null, successfulDir, cancelled: true };
        }
        attempts++;
        let statPoller = null;
        try {
          if (attempts > 1) {
            await new Promise((r) => setTimeout(r, 1000));
          }
          const isBypassSsl =
            localStorage.getItem("mori_bypass_ssl") === "true";
          const isForceIpv4 =
            localStorage.getItem("mori_force_ipv4") === "true";

          const tempFileName = `${fileName}.tmp`;
          const tempFilePath = fullPath + "/" + tempFileName;
          const dlOpts = {
            url: actualDownloadUrl,
            path: tempFilePath,
            directory: dir,
            progress: true,
            headers: downloadHeaders,
          };
          if (isBypassSsl) dlOpts.disableSSLValidation = true;
          if (isForceIpv4) dlOpts.ipv4Only = true;

          // Poll .tmp file size every 350ms as a reliable real-byte fallback
          // in case the native bridge omits progress events on chunked streams
          if (typeof onByteProgress === "function") {
            statPoller = setInterval(async () => {
              if (checkCancelled()) return;
              try {
                const st = await Filesystem.stat({
                  path: tempFilePath,
                  directory: dir,
                });
                if (st && typeof st.size === "number" && st.size > 0) {
                  onByteProgress({
                    loadedBytes: st.size,
                    totalBytes: probedTotalBytes,
                    fromStat: true,
                  });
                }
              } catch (_) {}
            }, 350);
          }

          const tempSaved = await Filesystem.downloadFile(dlOpts);
          if (statPoller) {
            clearInterval(statPoller);
            statPoller = null;
          }

          if (tempSaved) {
            try {
              const finalStat = await Filesystem.stat({
                path: tempFilePath,
                directory: dir,
              }).catch(() => null);
              if (finalStat?.size > 0 && typeof onByteProgress === "function") {
                onByteProgress({
                  loadedBytes: finalStat.size,
                  totalBytes: finalStat.size,
                });
              }
            } catch (_) {}

            // Rename .tmp to actual file name atomically on completion
            try {
              await Filesystem.rename({
                from: tempFilePath,
                to: fullPath + "/" + fileName,
                directory: dir,
              });
              savedFile = { path: fullPath + "/" + fileName };
            } catch (_) {
              // Fallback copy if rename unsupported
              await Filesystem.copy({
                from: tempFilePath,
                to: fullPath + "/" + fileName,
                directory: dir,
              });
              await Filesystem.deleteFile({
                path: tempFilePath,
                directory: dir,
              }).catch(() => {});
              savedFile = { path: fullPath + "/" + fileName };
            }
            successfulDir = dir;
          }
        } catch (dlErr) {
          if (statPoller) {
            clearInterval(statPoller);
            statPoller = null;
          }
          console.warn(
            `Download attempt ${attempts} on ${dir} failed:`,
            dlErr,
          );
          await Filesystem.deleteFile({
            path: fullPath + "/" + `${fileName}.tmp`,
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
      await cleanupTempFiles(fullPath, fileName, directoriesToTry);
      return { savedFile: null, successfulDir, cancelled: true };
    }
    await cleanupTempFiles(fullPath, fileName, directoriesToTry);
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