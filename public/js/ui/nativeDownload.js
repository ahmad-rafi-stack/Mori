// nativeDownload.js — native download orchestrator with real-time MB & accurate percentage progress
import { translations, t } from "../i18n/index.js";
import {
  showToast,
  Filesystem,
  requestWakeLock,
  releaseWakeLock,
  checkWifiOnlyGuard,
} from "../utils/index.js";
import { currentLang } from "../modules/core.js";
import {
  resolveExtension,
  sanitizeTitle,
  generateFileName,
  detectPlatformFolder,
  resolveUniqueFileName,
} from "../downloader/filename.js";
import { cleanDownloadUrl, buildDownloadHeaders } from "../downloader/headers.js";
import { needsAsyncResolving, resolveDownloadUrl } from "../downloader/resolver.js";
import { saveToStorage } from "../downloader/storage.js";
import { handlePostDownload } from "../downloader/postProcess.js";
import {
  downloadBubble,
  formatBytesToMB,
  formatTransferStatus,
} from "./downloadBubble.js";

export function cancelCurrentDownload() {
  window._moriDownloadCancelled = true;
  // Dispatch event so history spinner can be cleared
  window.dispatchEvent(new CustomEvent("mori_download_cancelled"));
}

// Expose globally so cancellation can be called from anywhere
window._moriCancelDownload = cancelCurrentDownload;

function handleCancelCleanup(btn, originalContent, progressContainer) {
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
  if (progressContainer) progressContainer.classList.add("hidden");
}

export async function startNativeDownload(
  url,
  type,
  title,
  btn,
  sourceUrl = "",
  resetCancelFlag = true,
) {
  if (!url || typeof url !== "string" || !url.trim()) {
    showToast(
      (translations[currentLang]?.["label-error"] || "Error") +
        ": Invalid download link",
    );
    return { success: false, error: "Invalid download link" };
  }

  if (!(await checkWifiOnlyGuard())) {
    return { success: false, error: "Wifi only guard" };
  }

  if (
    url.startsWith("file://") ||
    url.includes("_capacitor_file_") ||
    url.startsWith("content://")
  ) {
    showToast("File is already stored locally");
    return { success: true, skipped: true };
  }

  const tauriInvoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.invoke;

  if (!window.Capacitor && !tauriInvoke) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = (title || "mori_media").replace(/[^a-zA-Z0-9_-]/g, "_");
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (_) {
      window.open(url, "_blank");
    }
    return { success: true };
  }

  if (resetCancelFlag) {
    window._moriDownloadCancelled = false;
  }
  if (window._moriDownloadCancelled) {
    return { success: false, error: "Cancelled" };
  }

  window._moriActiveDownloadUrl = sourceUrl || url;
  window.dispatchEvent(
    new CustomEvent("mori_download_started", {
      detail: { url: sourceUrl || url, title },
    }),
  );

  const originalContent = btn ? btn.innerHTML : "";
  const card = btn ? btn.closest(".result-card, .history-modal-box") : null;
  const progressContainer = card
    ? card.querySelector(".download-progress-container")
    : null;
  const progressBar = progressContainer
    ? progressContainer.querySelector(".download-progress-bar")
    : null;

  // Show floating progress bubble ONLY AFTER validation and permissions pass
  const platformLabel = (() => {
    const src = (sourceUrl || url || "").toLowerCase();
    if (src.includes("tiktok") || src.includes("douyin")) return "TikTok";
    if (src.includes("instagram") || src.includes("instagr.am"))
      return "Instagram";
    if (src.includes("youtube") || src.includes("youtu.be")) return "YouTube";
    if (src.includes("twitter") || src.includes("x.com")) return "X";
    if (src.includes("facebook") || src.includes("fb.")) return "Facebook";
    if (src.includes("pinterest") || src.includes("pin.it")) return "Pinterest";
    if (src.includes("spotify")) return "Spotify";
    if (src.includes("apple")) return "Apple Music";
    if (src.includes("threads")) return "Threads";
    if (src.includes("rednote") || src.includes("xiaohongshu"))
      return "RedNote";
    if (src.includes("bilibili") || src.includes("b23.tv")) return "Bilibili";
    if (src.includes("pixiv") || src.includes("pximg")) return "Pixiv";
    if (src.includes("bandcamp")) return "Bandcamp";
    if (src.includes("reddit") || src.includes("redd.it")) return "Reddit";
    if (src.includes("terabox") || src.includes("1024tera")) return "TeraBox";
    if (src.includes("snapchat")) return "Snapchat";
    return "Media";
  })();

  if (window._moriActiveSimInterval) {
    clearInterval(window._moriActiveSimInterval);
    window._moriActiveSimInterval = null;
  }

  window._moriActiveDownloadsCount =
    (window._moriActiveDownloadsCount || 0) + 1;

  const hideProgress = localStorage.getItem("mori_hide_progress") === "true";

  let effectiveTitle = title || "Mori Media";
  const dlId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let itemCancelled = false;

  downloadBubble.addDownload({
    id: dlId,
    title: effectiveTitle,
    platform: platformLabel,
    type: type,
    onCancel: () => {
      itemCancelled = true;
    },
  });

  let currentProgressVal = 0;
  let maxLoadedBytes = 0;
  let knownTotalBytes = 0;
  let lastSpeedSampleTime = Date.now();
  let lastSpeedSampleBytes = 0;
  let currentSpeedBps = 0;

  const updateProgress = (pct, statusText, meta = null) => {
    if (hideProgress) return;
    if (typeof pct === "number" && !isNaN(pct)) {
      currentProgressVal = Math.min(100, Math.max(0, Math.round(pct)));
    }
    if (progressBar) {
      progressBar.style.width = `${currentProgressVal}%`;
    }
    downloadBubble.updateProgress(dlId, currentProgressVal, statusText, meta);
  };

  const handleRealByteProgress = ({
    loadedBytes = 0,
    totalBytes = 0,
    isInitProbe = false,
  }) => {
    if (totalBytes > knownTotalBytes) {
      knownTotalBytes = totalBytes;
    }
    if (isInitProbe && maxLoadedBytes === 0) {
      updateProgress(0, `0.0 MB / ${formatBytesToMB(knownTotalBytes)}`, {
        loadedBytes: 0,
        totalBytes: knownTotalBytes,
        speedBps: 0,
      });
      return;
    }
    if (loadedBytes < maxLoadedBytes) return;
    maxLoadedBytes = loadedBytes;

    const now = Date.now();
    const elapsedSec = (now - lastSpeedSampleTime) / 1000;
    if (elapsedSec >= 0.4) {
      const deltaBytes = maxLoadedBytes - lastSpeedSampleBytes;
      if (deltaBytes >= 0) {
        currentSpeedBps = deltaBytes / elapsedSec;
      }
      lastSpeedSampleTime = now;
      lastSpeedSampleBytes = maxLoadedBytes;
    }

    let pct = currentProgressVal;
    if (knownTotalBytes > 0) {
      pct = Math.min(100, Math.round((maxLoadedBytes / knownTotalBytes) * 100));
    } else {
      pct = 0;
    }

    const statusStr = formatTransferStatus(
      maxLoadedBytes,
      knownTotalBytes,
      currentSpeedBps,
    );
    updateProgress(pct, statusStr, {
      loadedBytes: maxLoadedBytes,
      totalBytes: knownTotalBytes,
      speedBps: currentSpeedBps,
    });

    if (btn) {
      const b = btn.querySelector(".dl-badge");
      const badgeLabel =
        knownTotalBytes > 0
          ? `${pct}% (${formatBytesToMB(maxLoadedBytes)})`
          : formatBytesToMB(maxLoadedBytes);
      if (b) {
        b.textContent = badgeLabel;
      }
    }
  };

  let progressListener = null;

  try {
    if (btn) btn.disabled = true;
    if (progressContainer) progressContainer.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "0%";

    requestWakeLock();
    if (window.MoriMainBridge?.startDownloadService) {
      try {
        window.MoriMainBridge.startDownloadService(effectiveTitle);
      } catch (_) {}
    }

    if (btn) {
      const initialBadge = btn.querySelector(".dl-badge");
      if (initialBadge) {
        initialBadge.textContent = "0.0 MB";
      } else {
        btn.innerHTML =
          translations[currentLang]?.["btn-processing"] || "Processing...";
      }
    }
    console.log("Starting download for:", url);

    if (Filesystem?.addListener) {
      try {
        progressListener = await Filesystem.addListener(
          "progress",
          (progress) => {
            const bytes =
              progress?.bytes ??
              progress?.bytesWritten ??
              progress?.loaded ??
              0;
            const total =
              progress?.contentLength ?? progress?.total ?? knownTotalBytes ?? 0;
            handleRealByteProgress({
              loadedBytes: bytes,
              totalBytes: total,
            });
          },
        );
      } catch (e) {
        console.warn("Could not attach Filesystem progress listener:", e);
      }
    }

    const ext = resolveExtension(type, url);
    const cleanTypeLabel = (type || "")
      .replace(/\s*\[(MP3|MP4|JPG|PNG|WEBP)\]/gi, "")
      .trim();
    const isTrackType = /^\d+\.\s+/.test(cleanTypeLabel);
    if (isTrackType) {
      effectiveTitle =
        cleanTypeLabel.replace(/^\d+\.\s+/, "").trim() || cleanTypeLabel;
    }

    const sanitizedTitle = sanitizeTitle(title, type);
    let fileName = generateFileName(sanitizedTitle, ext, sourceUrl, url);

    const isAudio = /mp3|audio|128k|48k|m4a|wav|flac/i.test(type);
    const videoSubfolder =
      localStorage.getItem("mori_download_path") || "Mori";
    const musicSubfolder =
      localStorage.getItem("mori_music_path") || "Mori/Music";
    const targetFolder = isAudio ? musicSubfolder : videoSubfolder;
    let fullPath = targetFolder.startsWith("Download/")
      ? targetFolder
      : `Download/${targetFolder}`;

    // Auto-Categorize Subfolder per Platform
    if (localStorage.getItem("mori_auto_folder") !== "false") {
      const platformFolder = detectPlatformFolder(sourceUrl, url);
      fullPath = `${fullPath}/${platformFolder}`;
    }

    const directoriesToTry = ["EXTERNAL_STORAGE", "DOCUMENTS", "EXTERNAL"];

    if (Filesystem) {
      for (const dir of directoriesToTry) {
        await Filesystem.mkdir({
          path: fullPath,
          directory: dir,
          recursive: true,
        }).catch(() => {});
      }

      const uniqueRes = await resolveUniqueFileName(
        fullPath,
        fileName,
        ext,
        directoriesToTry,
        Filesystem,
        btn,
      );
      if (uniqueRes.skipped) {
        downloadBubble.completeDownload(dlId, "Saved");
        return {
          success: true,
          skipped: true,
          path: uniqueRes.path,
        };
      }
      fileName = uniqueRes.fileName;
    }

    const checkCancelled = () =>
      Boolean(window._moriDownloadCancelled || itemCancelled);

    if (checkCancelled()) {
      downloadBubble.cancelDownload(dlId);
      handleCancelCleanup(btn, originalContent, progressContainer);
      return { success: false, error: "Cancelled" };
    }

    let actualDownloadUrl = url;
    if (needsAsyncResolving(url)) {
      const resolveRes = await resolveDownloadUrl({
        url,
        btn,
        updateProgress,
        checkCancelled,
      });
      if (resolveRes.cancelled || checkCancelled()) {
        downloadBubble.cancelDownload(dlId);
        handleCancelCleanup(btn, originalContent, progressContainer);
        return { success: false, error: "Cancelled" };
      }
      actualDownloadUrl = resolveRes.url;
    }

    actualDownloadUrl = cleanDownloadUrl(actualDownloadUrl);
    const downloadHeaders = buildDownloadHeaders(
      actualDownloadUrl,
      sourceUrl,
      url,
    );

    // Reset progress bar to 0% before actual file transfer starts
    updateProgress(
      0,
      knownTotalBytes > 0
        ? `0.0 MB / ${formatBytesToMB(knownTotalBytes)}`
        : "0.0 MB",
      {
        loadedBytes: 0,
        totalBytes: knownTotalBytes,
        speedBps: 0,
      },
    );

    const { savedFile, successfulDir, cancelled } = await saveToStorage({
      actualDownloadUrl,
      fileName,
      fullPath,
      targetFolder,
      downloadHeaders,
      directoriesToTry,
      checkCancelled,
      onByteProgress: handleRealByteProgress,
    });

    if (cancelled || checkCancelled()) {
      downloadBubble.cancelDownload(dlId);
      handleCancelCleanup(btn, originalContent, progressContainer);
      return { success: false, error: "Cancelled" };
    }

    const completedStatus =
      maxLoadedBytes > 0
        ? `${formatBytesToMB(maxLoadedBytes)} / ${formatBytesToMB(knownTotalBytes || maxLoadedBytes)}`
        : "100%";
    updateProgress(100, completedStatus);

    if (btn) {
      const b = btn.querySelector(".dl-badge");
      if (b) {
        b.textContent = "SAVED ✓";
      } else {
        btn.innerHTML = "SAVED ✓";
      }
    }

    const postRes = await handlePostDownload({
      savedFile,
      successfulDir,
      sourceUrl,
      url,
      effectiveTitle,
      fileName,
      targetFolder,
      btn,
      originalContent,
      progressContainer,
    });
    downloadBubble.completeDownload(dlId, "Saved");
    return postRes;
  } catch (err) {
    console.error("Download failed", err);

    let errorMsg = err?.message || "Download failed";
    if (
      errorMsg.includes("Network") ||
      errorMsg.includes("timeout") ||
      errorMsg.includes("connection")
    ) {
      errorMsg =
        translations[currentLang]?.["toast-connection-lost"] ||
        "Network connection error";
    }

    downloadBubble.failDownload(dlId, errorMsg);

    // Trigger System Tray Notification when download fails
    if (
      !window._moriPlaylistDownloading &&
      window.MoriMainBridge?.showFailedNotification
    ) {
      try {
        window.MoriMainBridge.showFailedNotification(
          effectiveTitle || "Media",
          errorMsg,
        );
      } catch (_) {}
    }

    if (btn) {
      btn.disabled = false;
      const b = btn.querySelector(".dl-badge");
      if (b) {
        if (!window._moriPlaylistDownloading) {
          b.textContent = "RETRY";
          b.style.background = "#e74c3c";
          b.style.color = "#ffffff";
        } else {
          b.textContent =
            translations[currentLang]?.["label-download"] || "DOWNLOAD";
        }
      } else {
        btn.innerHTML = originalContent;
      }
    }
    if (progressContainer) progressContainer.classList.add("hidden");
    return {
      success: false,
      error: errorMsg,
    };
  } finally {
    window._moriActiveDownloadsCount = Math.max(
      0,
      (window._moriActiveDownloadsCount || 1) - 1,
    );
    window._moriActiveDownloadUrl = null;
    window.dispatchEvent(new CustomEvent("mori_download_ended"));
    if (!window._moriPlaylistDownloading) {
      releaseWakeLock();
      if (window.MoriMainBridge?.stopDownloadService) {
        try {
          window.MoriMainBridge.stopDownloadService();
        } catch (_) {}
      }
    }
    if (progressListener && typeof progressListener.remove === "function") {
      try {
        await progressListener.remove();
      } catch (_) {}
    }
  }
}