// storage.js — download paths, storage calculation, cache clearing, and data management
import {
  Filesystem,
  showToast,
  pickNativeFolder,
  normalizePathInput,
  normalizeSavedPath,
} from "../../utils/index.js";
import { translations } from "../../i18n/index.js";
import { showConfirm } from "../modals.js";
import { renderHistory } from "../../ui.js";
import { onHistoryItemClick, onHistoryDeleteClick, safeSetHistory } from "../history.js";
import { invalidateGalleryCache } from "../gallery.js";
import {
  currentLang,
  pathVal,
  changePathBtn,
  musicPathVal,
  changeMusicPathBtn,
  okConfirmBtn,
  clearCacheBtn,
  wipeDataBtn,
} from "../core.js";

export function formatPathDisplay(pathStr) {
  if (!pathStr) return "/";
  if (pathStr.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(pathStr)) {
    return pathStr;
  }
  return `/${pathStr}`;
}

export let customPath = (() => {
  const p = localStorage.getItem("mori_download_path");
  if (!p || p === "Mori") return "Download/Mori";
  return normalizeSavedPath(p);
})();

export let customMusicPath = (() => {
  const p = localStorage.getItem("mori_music_path");
  if (!p || p === "Mori/Music" || p === "Music/Mori") {
    const isAndroid = window.Capacitor?.getPlatform?.() === "android";
    if (isAndroid) return "Download/Mori/Music";
    return p || "Music/Mori";
  }
  return normalizeSavedPath(p);
})();

export function updateDlStatsDisplay() {
  const el = document.getElementById("historyDlStatsVal");
  const historyEl = document.getElementById("historyItemsCountVal");
  const history = JSON.parse(localStorage.getItem("mori_history") || "[]");
  const storedCount = parseInt(
    localStorage.getItem("mori_dl_count") || "0",
    10,
  );
  const count = Math.max(storedCount, history.length);
  if (el) el.textContent = count.toLocaleString();
  if (historyEl) historyEl.textContent = history.length.toLocaleString();
}

export function checkAutoClearDays() {
  const daysVal = localStorage.getItem("mori_auto_clear_days") || "off";
  if (daysVal === "off") return;
  const days = parseInt(daysVal, 10);
  if (isNaN(days) || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let history = JSON.parse(localStorage.getItem("mori_history") || "[]");
  const initialCount = history.length;
  const filtered = history.filter((item) => {
    const time =
      item.timestamp || (item.date ? new Date(item.date).getTime() : 0);
    return time === 0 || time >= cutoff;
  });
  if (filtered.length !== initialCount) {
    safeSetHistory(filtered);
  }
}

export async function getFolderSize(path, directory) {
  let size = 0;
  try {
    const readdir = await Filesystem.readdir({ path, directory });
    for (const file of readdir.files) {
      const filePath = path ? `${path}/${file.name}` : file.name;
      if (file.type === "file") {
        const stats = await Filesystem.stat({ path: filePath, directory });
        size += stats.size;
      } else if (file.type === "directory") {
        size += await getFolderSize(filePath, directory);
      }
    }
  } catch (_) {}
  return size;
}

export async function updateStorageInfo() {
  const storageVal = document.getElementById("storageSizeVal");
  if (!storageVal) return;

  try {
    let totalSize = 0;

    if (Filesystem) {
      totalSize += await getFolderSize("", "CACHE");
      const vPath = customPath || "Download/Mori";
      const mPath = customMusicPath || "Music/Mori";
      const primaryV = await getFolderSize(vPath, "EXTERNAL_STORAGE");
      const legacyV = await getFolderSize(vPath, "EXTERNAL");
      totalSize += Math.max(primaryV, legacyV);
      if (mPath !== vPath) {
        const primaryM = await getFolderSize(mPath, "EXTERNAL_STORAGE");
        const legacyM = await getFolderSize(mPath, "EXTERNAL");
        totalSize += Math.max(primaryM, legacyM);
      }
    }

    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    storageVal.textContent = `${sizeInMB} MB`;
  } catch (e) {
    console.error("Storage size error:", e);
    storageVal.textContent = "0.00 MB";
  }
}

export async function clearCacheSilently() {
  invalidateGalleryCache();
  if (!Filesystem) return;
  try {
    const history = JSON.parse(localStorage.getItem("mori_history") || "[]");
    const activeThumbs = new Set(
      history
        .map((item) => item.thumbnail)
        .filter((t) => t && t.startsWith("thumb_")),
    );
    history.forEach((item) => {
      if (item.localThumbnail && item.localThumbnail.startsWith("thumb_")) {
        activeThumbs.add(item.localThumbnail);
      }
    });

    const cacheSize = await getFolderSize("", "CACHE");
    const sizeInMB = cacheSize / (1024 * 1024);

    // Only clear if cache is more than 50MB
    if (sizeInMB > 50) {
      const files = await Filesystem.readdir({ path: "", directory: "CACHE" });
      let clearedCount = 0;
      for (const file of files.files) {
        const isThumb = file.name.startsWith("thumb_");
        // Delete if it's an orphaned thumbnail OR if it's not a thumbnail at all
        if (!isThumb || !activeThumbs.has(file.name)) {
          try {
            if (file.type === "directory") {
              await Filesystem.rmdir({
                path: file.name,
                directory: "CACHE",
                recursive: true,
              });
            } else {
              await Filesystem.deleteFile({
                path: file.name,
                directory: "CACHE",
              });
            }
            clearedCount++;
          } catch (_) {}
        }
      }
      if (clearedCount > 0) {
        updateStorageInfo();
        console.log(`Auto-cleared ${clearedCount} items from cache.`);
      }
    }
  } catch (e) {
    console.error("Silent cache clear failed:", e);
  }
}

/**
 * Initializes download path pickers, storage event listeners, cache logic, and wipe dialogs
 */

const BACKUP_I18N = {
  en: {
    exportLabel: "Export Backup (.json)",
    importLabel: "Import Backup (.json)",
    exportBtn: "EXPORT",
    importBtn: "IMPORT",
    exportSuccess: "Backup exported successfully",
    exportSavedTo: "Backup saved to",
    exportError: "Failed to export backup",
    importSuccess: "Backup restored successfully",
    importError: "Invalid or corrupted backup file",
  },
  id: {
    exportLabel: "Ekspor Backup (.json)",
    importLabel: "Impor Backup (.json)",
    exportBtn: "EKSPOR",
    importBtn: "IMPOR",
    exportSuccess: "Backup berhasil diekspor",
    exportSavedTo: "Backup disimpan ke",
    exportError: "Gagal mengekspor backup",
    importSuccess: "Backup berhasil dipulihkan",
    importError: "File backup tidak valid atau rusak",
  },
  ja: {
    exportLabel: "バックアップを書き出す (.json)",
    importLabel: "バックアップを読み込む (.json)",
    exportBtn: "書き出し",
    importBtn: "読み込み",
    exportSuccess: "バックアップを書き出しました",
    exportSavedTo: "保存先:",
    exportError: "バックアップの書き出しに失敗しました",
    importSuccess: "バックアップを復元しました",
    importError: "無効なバックアップファイルです",
  },
  ko: {
    exportLabel: "백업 내보내기 (.json)",
    importLabel: "백업 가져오기 (.json)",
    exportBtn: "내보내기",
    importBtn: "가져오기",
    exportSuccess: "백업을 성공적으로 내보냈습니다",
    exportSavedTo: "백업 저장 위치:",
    exportError: "백업 내보내기 실패",
    importSuccess: "백업이 복원되었습니다",
    importError: "유효하지 않은 백업 파일입니다",
  },
  zh: {
    exportLabel: "导出备份 (.json)",
    importLabel: "导入备份 (.json)",
    exportBtn: "导出",
    importBtn: "导入",
    exportSuccess: "备份导出成功",
    exportSavedTo: "备份已保存至",
    exportError: "导出备份失败",
    importSuccess: "备份恢复成功",
    importError: "备份文件无效或已损坏",
  },
  ar: {
    exportLabel: "تصدير النسخة الاحتياطية (.json)",
    importLabel: "استيراد النسخة الاحتياطية (.json)",
    exportBtn: "تصدير",
    importBtn: "استيراد",
    exportSuccess: "تم تصدير النسخة الاحتياطية بنجاح",
    exportSavedTo: "تم حفظ النسخة في",
    exportError: "فشل تصدير النسخة الاحتياطية",
    importSuccess: "تم استعادة النسخة الاحتياطية بنجاح",
    importError: "ملف النسخة الاحتياطية غير صالح",
  },
  ru: {
    exportLabel: "Экспорт резервной копии (.json)",
    importLabel: "Импорт резервной копии (.json)",
    exportBtn: "ЭКСПОРТ",
    importBtn: "ИМПОРТ",
    exportSuccess: "Резервная копия экспортирована",
    exportSavedTo: "Сохранено в",
    exportError: "Ошибка экспорта резервной копии",
    importSuccess: "Резервная копия успешно восстановлена",
    importError: "Неверный файл резервной копии",
  },
  tl: {
    exportLabel: "I-export ang Backup (.json)",
    importLabel: "I-import ang Backup (.json)",
    exportBtn: "I-EXPORT",
    importBtn: "I-IMPORT",
    exportSuccess: "Matagumpay na na-export ang backup",
    exportSavedTo: "Na-save ang backup sa",
    exportError: "Nabigong i-export ang backup",
    importSuccess: "Matagumpay na naibalik ang backup",
    importError: "Hindi valid ang backup file",
  },
  hi: {
    exportLabel: "बैकअप निर्यात करें (.json)",
    importLabel: "बैकअप आयात करें (.json)",
    exportBtn: "निर्यात",
    importBtn: "आयात",
    exportSuccess: "बैकअप सफलतापूर्वक निर्यात किया गया",
    exportSavedTo: "बैकअप यहाँ सहेजा गया:",
    exportError: "बैकअप निर्यात करने में विफल",
    importSuccess: "बैकअप सफलतापूर्वक पुनर्स्थापित किया गया",
    importError: "अमान्य बैकअप फ़ाइल",
  },
};

function getBackupText(key) {
  const dict = BACKUP_I18N[currentLang] || BACKUP_I18N.en;
  return dict[key] || BACKUP_I18N.en[key] || key;
}

export async function exportMoriBackup() {
  try {
    const settingsData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("mori_") && k !== "mori_gallery_thumbs") {
        settingsData[k] = localStorage.getItem(k);
      }
    }

    let historyList = [];
    try {
      historyList = JSON.parse(localStorage.getItem("mori_history") || "[]");
    } catch (_) {}

    const payload = {
      app: "Mori",
      backupFormatVersion: 1,
      exportedAt: new Date().toISOString(),
      historyCount: Array.isArray(historyList) ? historyList.length : 0,
      data: settingsData,
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const dateStamp = new Date().toISOString().split("T")[0];
    const fileName = `Mori_Backup_${dateStamp}.json`;

    if (Filesystem && window.Capacitor?.isNativePlatform?.()) {
      const folder = customPath || "Download/Mori";
      const targetPath = `${folder}/${fileName}`;
      const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
      let saved = false;

      for (const dir of ["EXTERNAL_STORAGE", "DOCUMENTS", "EXTERNAL"]) {
        try {
          await Filesystem.mkdir({
            path: folder,
            directory: dir,
            recursive: true,
          }).catch(() => {});
          await Filesystem.writeFile({
            path: targetPath,
            data: base64Data,
            directory: dir,
          });
          saved = true;
          showToast(`${getBackupText("exportSavedTo")} /${targetPath}`);
          break;
        } catch (_) {}
      }
      if (saved) return true;
    }

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(getBackupText("exportSuccess"));
    return true;
  } catch (err) {
    console.error("Export backup failed:", err);
    showToast(getBackupText("exportError"));
    return false;
  }
}

export function importMoriBackupFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const raw = String(e.target?.result || "");
      const parsed = JSON.parse(raw);
      const dataObj =
        parsed && typeof parsed.data === "object" && parsed.data !== null
          ? parsed.data
          : parsed;

      if (!dataObj || typeof dataObj !== "object") {
        throw new Error("Invalid backup structure");
      }

      const moriKeys = Object.keys(dataObj).filter((k) => k.startsWith("mori_"));
      if (moriKeys.length === 0 && !Array.isArray(parsed.history)) {
        throw new Error("No Mori keys found in backup");
      }

      // Merge history records without losing existing items
      let incomingHistory = [];
      if (typeof dataObj.mori_history === "string") {
        try {
          incomingHistory = JSON.parse(dataObj.mori_history);
        } catch (_) {}
      } else if (Array.isArray(dataObj.mori_history)) {
        incomingHistory = dataObj.mori_history;
      } else if (Array.isArray(parsed.history)) {
        incomingHistory = parsed.history;
      }

      if (Array.isArray(incomingHistory) && incomingHistory.length > 0) {
        let currentHistory = [];
        try {
          currentHistory = JSON.parse(localStorage.getItem("mori_history") || "[]");
        } catch (_) {}
        const seenUrls = new Set(
          currentHistory.map((item) => item?.url).filter(Boolean),
        );
        const merged = [...currentHistory];
        for (const item of incomingHistory) {
          if (item && typeof item === "object") {
            if (!item.url || !seenUrls.has(item.url)) {
              if (item.url) seenUrls.add(item.url);
              merged.push(item);
            }
          }
        }
        merged.sort((a, b) => {
          if (a?.favorite && !b?.favorite) return -1;
          if (!a?.favorite && b?.favorite) return 1;
          if (a?.favorite && b?.favorite) {
            return (
              (b.favTimestamp || b.timestamp || 0) -
              (a.favTimestamp || a.timestamp || 0)
            );
          }
          return (b?.timestamp || 0) - (a?.timestamp || 0);
        });
        safeSetHistory(merged);
      }

      // Restore other mori_* settings
      for (const k of moriKeys) {
        if (k === "mori_history" || k === "mori_gallery_thumbs") continue;
        const val = dataObj[k];
        if (val !== undefined && val !== null) {
          localStorage.setItem(k, String(val));
        }
      }

      invalidateGalleryCache();
      updateDlStatsDisplay();
      renderHistory(onHistoryItemClick, onHistoryDeleteClick);
      window.dispatchEvent(new CustomEvent("mori_history_updated"));
      showToast(getBackupText("importSuccess"));
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      console.error("Import backup error:", err);
      showToast(getBackupText("importError"));
    }
  };
  reader.readAsText(file);
}

function mountBackupRestoreItems() {
  if (!clearCacheBtn || !clearCacheBtn.parentNode) return;
  if (document.getElementById("exportBackupBtn")) return;

  const exportItem = document.createElement("div");
  exportItem.className = "settings-item action-item";
  exportItem.id = "exportBackupBtn";
  exportItem.innerHTML = `
    <div class="item-label">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span id="exportBackupLabel">${getBackupText("exportLabel")}</span>
    </div>
    <div class="item-action">
      <span class="action-label" id="exportBackupAction">${getBackupText("exportBtn")}</span>
    </div>
  `;

  const importItem = document.createElement("div");
  importItem.className = "settings-item action-item";
  importItem.id = "importBackupBtn";
  importItem.innerHTML = `
    <div class="item-label">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
      </svg>
      <span id="importBackupLabel">${getBackupText("importLabel")}</span>
    </div>
    <div class="item-action">
      <span class="action-label" id="importBackupAction">${getBackupText("importBtn")}</span>
    </div>
  `;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.style.display = "none";
  fileInput.id = "moriBackupFileInput";

  clearCacheBtn.parentNode.insertBefore(exportItem, clearCacheBtn);
  clearCacheBtn.parentNode.insertBefore(importItem, clearCacheBtn);
  document.body.appendChild(fileInput);

  exportItem.addEventListener("click", () => {
    exportMoriBackup();
  });

  importItem.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importMoriBackupFromFile(file);
    }
  });

  window.addEventListener("mori_language_changed", () => {
    const expLbl = document.getElementById("exportBackupLabel");
    const expAct = document.getElementById("exportBackupAction");
    const impLbl = document.getElementById("importBackupLabel");
    const impAct = document.getElementById("importBackupAction");
    if (expLbl) expLbl.textContent = getBackupText("exportLabel");
    if (expAct) expAct.textContent = getBackupText("exportBtn");
    if (impLbl) impLbl.textContent = getBackupText("importLabel");
    if (impAct) impAct.textContent = getBackupText("importBtn");
  });
}


const HISTORY_FILTER_I18N = {
  en: {
    searchPlaceholder: "Search history title or platform...",
    all: "All",
    fav: "Favorites",
    video: "Video",
    audio: "Music",
    doc: "Comic / Image",
    emptyMatch: "No matching history items",
  },
  id: {
    searchPlaceholder: "Cari judul riwayat atau platform...",
    all: "Semua",
    fav: "Favorit",
    video: "Video",
    audio: "Musik",
    doc: "Komik / Gambar",
    emptyMatch: "Tidak ada riwayat yang cocok",
  },
  ja: {
    searchPlaceholder: "履歴のタイトルやサイトを検索...",
    all: "すべて",
    fav: "お気に入り",
    video: "動画",
    audio: "音楽",
    doc: "コミック / 画像",
    emptyMatch: "一致する履歴がありません",
  },
  ko: {
    searchPlaceholder: "기록 제목 또는 플랫폼 검색...",
    all: "전체",
    fav: "즐겨찾기",
    video: "동영상",
    audio: "음악",
    doc: "코믹 / 이미지",
    emptyMatch: "일치하는 기록이 없습니다",
  },
  zh: {
    searchPlaceholder: "搜索历史标题或平台...",
    all: "全部",
    fav: "收藏",
    video: "视频",
    audio: "音乐",
    doc: "漫画 / 图片",
    emptyMatch: "没有匹配的历史记录",
  },
  ar: {
    searchPlaceholder: "ابحث في السجل...",
    all: "الكل",
    fav: "المفضلة",
    video: "فيديو",
    audio: "موسيقى",
    doc: "مانغا / صور",
    emptyMatch: "لا توجد عناصر مطابقة",
  },
  ru: {
    searchPlaceholder: "Поиск по истории...",
    all: "Все",
    fav: "Избранное",
    video: "Видео",
    audio: "Музыка",
    doc: "Комиксы / Фото",
    emptyMatch: "Ничего не найдено",
  },
  tl: {
    searchPlaceholder: "Maghanap sa history...",
    all: "Lahat",
    fav: "Paborito",
    video: "Video",
    audio: "Musika",
    doc: "Komiks / Larawan",
    emptyMatch: "Walang nahanap sa history",
  },
  hi: {
    searchPlaceholder: "इतिहास में खोजें...",
    all: "सभी",
    fav: "पसंदीदा",
    video: "वीडियो",
    audio: "संगीत",
    doc: "कॉमिक / चित्र",
    emptyMatch: "कोई मिलान नहीं मिला",
  },
};

function getHistoryFilterText(key) {
  const dict = HISTORY_FILTER_I18N[currentLang] || HISTORY_FILTER_I18N.en;
  return dict[key] || HISTORY_FILTER_I18N.en[key];
}

function classifyHistoryRecord(rec, cardText = "") {
  if (!rec) return { fav: false, cat: "video" };
  const isFav = Boolean(rec.favorite);
  const files = Array.isArray(rec.localFiles) ? rec.localFiles : [];
  const urlStr = ((rec.url || "") + " " + (rec.sourceUrl || "") + " " + cardText).toLowerCase();

  for (const f of files) {
    const t = (f.type || "").toUpperCase();
    const p = (f.path || f.uri || "").toLowerCase();
    if (t === "AUDIO" || /\.(mp3|m4a|wav|flac|ogg)$/.test(p)) {
      return { fav: isFav, cat: "audio" };
    }
    if (t === "IMAGE" || t === "PDF" || /\.(pdf|jpe?g|png|webp|gif)$/.test(p)) {
      return { fav: isFav, cat: "doc" };
    }
  }
  if (/spotify|soundcloud|music\.apple|bandcamp|deezer/.test(urlStr)) {
    return { fav: isFav, cat: "audio" };
  }
  if (/komiku|mangadex|bacakomik|kiryu|shinigami|pixiv|pinterest|\.pdf/.test(urlStr)) {
    return { fav: isFav, cat: "doc" };
  }
  return { fav: isFav, cat: "video" };
}

function mountHistorySearchAndFilter() {
  const historyList = document.querySelector(".history-list") || document.getElementById("historyList");
  if (!historyList || document.getElementById("moriHistoryFilterBar")) return;

  if (!document.getElementById("mori-history-filter-style")) {
    const st = document.createElement("style");
    st.id = "mori-history-filter-style";
    st.textContent = `
      .mori-history-filter-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 8px 0 12px 0;
      }
      .mori-history-search-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 11px;
        border-radius: 10px;
        background: rgba(128, 128, 128, 0.08);
        border: 1px solid rgba(128, 128, 128, 0.16);
      }
      .mori-history-search-wrap input {
        flex: 1;
        border: none;
        background: transparent;
        color: inherit;
        font-size: 12.5px;
        outline: none;
      }
      .mori-history-chips {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 2px;
        scrollbar-width: none;
      }
      .mori-history-chips::-webkit-scrollbar {
        display: none;
      }
      .mori-history-chip {
        border: 1px solid rgba(128, 128, 128, 0.22);
        background: transparent;
        color: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 999px;
        cursor: pointer;
        white-space: nowrap;
        opacity: 0.72;
        transition: all 0.15s ease;
      }
      .mori-history-chip.active {
        opacity: 1;
        background: var(--primary, #fff);
        color: var(--on-primary, #000);
        border-color: var(--primary, #fff);
      }
    `;
    document.head.appendChild(st);
  }

  let activeTab = "all";
  let searchQuery = "";

  const bar = document.createElement("div");
  bar.id = "moriHistoryFilterBar";
  bar.className = "mori-history-filter-bar";
  bar.innerHTML = `
    <div class="mori-history-search-wrap">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="opacity:0.6;flex-shrink:0;">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input type="text" id="moriHistorySearchInput" placeholder="${getHistoryFilterText("searchPlaceholder")}" autocomplete="off" spellcheck="false" />
    </div>
    <div class="mori-history-chips">
      <button type="button" class="mori-history-chip active" data-tab="all">${getHistoryFilterText("all")}</button>
      <button type="button" class="mori-history-chip" data-tab="fav">${getHistoryFilterText("fav")}</button>
      <button type="button" class="mori-history-chip" data-tab="video">${getHistoryFilterText("video")}</button>
      <button type="button" class="mori-history-chip" data-tab="doc">${getHistoryFilterText("doc")}</button>
      <button type="button" class="mori-history-chip" data-tab="audio">${getHistoryFilterText("audio")}</button>
    </div>
  `;

  historyList.parentElement?.insertBefore(bar, historyList);

  const applyFilter = () => {
    let rawHistory = [];
    try {
      rawHistory = JSON.parse(localStorage.getItem("mori_history") || "[]");
    } catch (_) {}

    const sortedHistory = Array.isArray(rawHistory)
      ? [...rawHistory].sort((a, b) => {
          if (a?.favorite && !b?.favorite) return -1;
          if (!a?.favorite && b?.favorite) return 1;
          if (a?.favorite && b?.favorite) {
            return (
              (b.favTimestamp || b.timestamp || 0) -
              (a.favTimestamp || a.timestamp || 0)
            );
          }
          return 0;
        })
      : [];

    const children = Array.from(historyList.children).filter(
      (el) => !el.classList.contains("mori-history-filter-empty"),
    );

    if (children.length === 0 || (children.length === 1 && children[0].classList.contains("empty-history"))) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";

    const q = searchQuery.trim().toLowerCase();
    let visibleCount = 0;

    children.forEach((card, idx) => {
      const cardUrl =
        card.querySelector("[data-url]")?.getAttribute("data-url") || "";
      const rec =
        (cardUrl &&
          sortedHistory.find((item) => item && item.url === cardUrl)) ||
        sortedHistory[idx] ||
        null;
      const text = (card.textContent || "") + " " + (rec?.title || "") + " " + (rec?.url || "");
      const { fav, cat } = classifyHistoryRecord(rec, text);

      const matchesSearch = !q || text.toLowerCase().includes(q);
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "fav" && (fav || card.querySelector(".hist-fav-btn.active"))) ||
        activeTab === cat;

      if (matchesSearch && matchesTab) {
        card.style.display = "";
        visibleCount++;
      } else {
        card.style.display = "none";
      }
    });

    let emptyEl = historyList.querySelector(".mori-history-filter-empty");
    if (visibleCount === 0 && children.length > 0) {
      if (!emptyEl) {
        emptyEl = document.createElement("div");
        emptyEl.className = "mori-history-filter-empty";
        emptyEl.style.cssText = "text-align:center;padding:18px 10px;font-size:12px;opacity:0.65;";
        historyList.appendChild(emptyEl);
      }
      emptyEl.textContent = getHistoryFilterText("emptyMatch");
      emptyEl.style.display = "block";
    } else if (emptyEl) {
      emptyEl.style.display = "none";
    }
  };

  const searchInput = bar.querySelector("#moriHistorySearchInput");
  searchInput?.addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    applyFilter();
  });

  bar.querySelectorAll(".mori-history-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      bar.querySelectorAll(".mori-history-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeTab = chip.getAttribute("data-tab") || "all";
      applyFilter();
    });
  });

  const obs = new MutationObserver(() => {
    applyFilter();
  });
  obs.observe(historyList, { childList: true });

  window.addEventListener("mori_language_changed", () => {
    if (searchInput) searchInput.placeholder = getHistoryFilterText("searchPlaceholder");
    bar.querySelectorAll(".mori-history-chip").forEach((chip) => {
      const tab = chip.getAttribute("data-tab");
      if (tab) chip.textContent = getHistoryFilterText(tab);
    });
    const emptyEl = historyList.querySelector(".mori-history-filter-empty");
    if (emptyEl) emptyEl.textContent = getHistoryFilterText("emptyMatch");
  });

  applyFilter();
}

export function initStorageSettings() {
  const isAndroid = window.Capacitor?.getPlatform?.() === "android";
  const isIos = window.Capacitor?.getPlatform?.() === "ios";

  // 1. Initial display
  if (pathVal) pathVal.textContent = formatPathDisplay(customPath);
  if (musicPathVal) musicPathVal.textContent = formatPathDisplay(customMusicPath);
  updateDlStatsDisplay();

  // All Files Access UI on Android (always visible on Android in compact single-row design)
  const updateAllFilesUI = () => {
    const item = document.getElementById("allFilesAccessItem");
    const chip = document.getElementById("allFilesStatusChip");
    if (!item || !isAndroid) return;

    item.style.display = "flex";
    const granted = window.MoriMainBridge?.hasAllFilesPermission
      ? window.MoriMainBridge.hasAllFilesPermission()
      : false;

    const lang = translations[currentLang] || translations.en;
    item.title = lang["desc-all-files-access"] || "Required to save & play media in any folder";
    if (chip) {
      chip.textContent = granted
        ? (lang["status-granted"] || "Granted")
        : (lang["status-not-granted"] || "Not Granted");
      chip.className = "mori-status-chip " + (granted ? "granted" : "warning");
    }

    // If permission is revoked / not granted, immediately fallback any outside path to Download/Mori
    if (!granted) {
      let changed = false;
      const currentVideo = (localStorage.getItem("mori_download_path") || customPath || "").trim();
      if (
        currentVideo &&
        !currentVideo.toLowerCase().startsWith("download") &&
        currentVideo !== "Mori"
      ) {
        customPath = "Download/Mori";
        localStorage.setItem("mori_download_path", "Download/Mori");
        if (pathVal) pathVal.textContent = formatPathDisplay("Download/Mori");
        changed = true;
      }

      const currentMusic = (localStorage.getItem("mori_music_path") || customMusicPath || "").trim();
      if (
        currentMusic &&
        !currentMusic.toLowerCase().startsWith("download") &&
        currentMusic !== "Mori/Music"
      ) {
        customMusicPath = "Download/Mori/Music";
        localStorage.setItem("mori_music_path", "Download/Mori/Music");
        if (musicPathVal) musicPathVal.textContent = formatPathDisplay("Download/Mori/Music");
        changed = true;
      }

      if (changed) {
        updateStorageInfo();
      }
    }
  };
  updateAllFilesUI();
  document.getElementById("allFilesAccessItem")?.addEventListener("click", () => {
    if (window.MoriMainBridge?.requestAllFilesPermission) {
      window.MoriMainBridge.requestAllFilesPermission();
    }
  });
  window.addEventListener("mori_app_resumed", updateAllFilesUI);

  // 2. Listen for saved files to update stats live
  window.addEventListener("mori_file_saved", () => {
    const history = JSON.parse(localStorage.getItem("mori_history") || "[]");
    const storedCount = parseInt(
      localStorage.getItem("mori_dl_count") || "0",
      10,
    );
    const newCount = Math.max(storedCount, history.length) + 1;
    localStorage.setItem("mori_dl_count", newCount);
    updateDlStatsDisplay();
  });

  // Helper for preset chips
  const getVideoPresets = () => {
    if (isAndroid) {
      return ["Download/Mori", "Movies/Mori", "DCIM/Mori", "Download"];
    }
    return ["Mori", "Videos"];
  };

  const getMusicPresets = () => {
    if (isAndroid) {
      return ["Download/Mori/Music", "Music/Mori", "Download/Mori"];
    }
    return ["Music", "Mori/Music"];
  };

  // 3. Video Download Path Picker
  changePathBtn?.addEventListener("click", () => {
    const lang = translations[currentLang] || translations.en;
    const presets = getVideoPresets();
    const canBrowse = isAndroid;
    const hasPerm = isAndroid && window.MoriMainBridge?.hasAllFilesPermission
      ? window.MoriMainBridge.hasAllFilesPermission()
      : true;

    const permBannerHtml = !hasPerm
      ? `<div id="pathPermBanner" class="path-permission-banner" style="display:flex;align-items:center;gap:8px;font-size:11px;padding:8px 10px;border-radius:8px;background:rgba(234,179,8,0.12);color:#eab308;margin-bottom:12px;cursor:pointer;">
           <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
           <span>${lang["desc-all-files-access"] || "Tip: Grant All Files Access to save & play in any directory."}</span>
         </div>`
      : "";

    const browseBtnHtml = canBrowse
      ? `<button type="button" id="browseFolderBtn" class="path-preset-chip browse-chip" style="display:inline-flex;align-items:center;gap:5px;">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
           <span>${lang["btn-browse-folder"] || "Browse Folder"}</span>
         </button>`
      : "";

    showConfirm(
      lang["label-path-video"] || "Video Download Path",
      `<div class="path-picker-ui">
         ${permBannerHtml}
         <div class="path-input-wrapper">
           <span class="path-label-sm">${lang["label-custom-directory"] || "Target Directory"}</span>
           <div class="mori-input-with-icon">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
             <input type="text" id="customPathInput" class="mori-input-noborder" value="${customPath}" placeholder="e.g. Movies/Mori" spellcheck="false" autocomplete="off">
           </div>
         </div>
         <span class="path-label-sm">${lang["label-path-presets"] || "Presets"}</span>
         <div class="path-presets-container">
           ${browseBtnHtml}
           ${presets.map((p) => `<button type="button" class="path-preset-chip" data-path="${p}">${p}</button>`).join("")}
         </div>
         <button id="resetPathBtn" class="reset-path-btn">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
           <span>${lang["btn-reset-default"] || "Reset to Default"}</span>
         </button>
       </div>`,
      () => {
        const input = document.getElementById("customPathInput");
        if (input && input.value.trim()) {
          const newPath = normalizePathInput(input.value);
          const hasPerm = isAndroid && window.MoriMainBridge?.hasAllFilesPermission
            ? window.MoriMainBridge.hasAllFilesPermission()
            : true;

          if (isAndroid && !hasPerm && !newPath.toLowerCase().startsWith("download")) {
            showToast(lang["desc-all-files-access"] || "All Files Access required. Reverted to Download/Mori.");
            customPath = "Download/Mori";
            localStorage.setItem("mori_download_path", "Download/Mori");
            if (pathVal) pathVal.textContent = formatPathDisplay("Download/Mori");
          } else {
            customPath = newPath;
            localStorage.setItem("mori_download_path", newPath);
            if (pathVal) pathVal.textContent = formatPathDisplay(newPath);
            showToast(lang["toast-path-updated"] || "Path updated");
          }
          updateStorageInfo();
          updateAllFilesUI();
        }
      },
    );
    setTimeout(() => {
      const input = document.getElementById("customPathInput");
      const chips = document.querySelectorAll(
        ".path-presets-container .path-preset-chip:not(.browse-chip)",
      );
      const updateActiveChips = () => {
        const current = input ? normalizePathInput(input.value) : "";
        chips.forEach((c) => {
          if (c.getAttribute("data-path") === current) {
            c.classList.add("active");
          } else {
            c.classList.remove("active");
          }
        });
      };
      updateActiveChips();
      input?.addEventListener("input", updateActiveChips);

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          if (input) {
            input.value = chip.getAttribute("data-path");
            updateActiveChips();
            input.focus();
          }
        });
      });

      document.getElementById("browseFolderBtn")?.addEventListener("click", async () => {
        const chosen = await pickNativeFolder();
        if (chosen && input) {
          input.value = chosen;
          updateActiveChips();
          input.focus();
        }
      });

      document.getElementById("pathPermBanner")?.addEventListener("click", () => {
        if (window.MoriMainBridge?.requestAllFilesPermission) {
          window.MoriMainBridge.requestAllFilesPermission();
        }
      });

      document.getElementById("resetPathBtn")?.addEventListener("click", () => {
        if (input) {
          input.value = isAndroid ? "Download/Mori" : "Movies/Mori";
          updateActiveChips();
          input.focus();
        }
      });
    }, 100);
    if (okConfirmBtn) {
      okConfirmBtn.textContent = "SAVE";
      okConfirmBtn.classList.add("neutral-btn");
    }
  });

  // 4. Music Download Path Picker
  changeMusicPathBtn?.addEventListener("click", () => {
    const lang = translations[currentLang] || translations.en;
    const presets = getMusicPresets();
    const canBrowse = isAndroid;
    const hasPerm = isAndroid && window.MoriMainBridge?.hasAllFilesPermission
      ? window.MoriMainBridge.hasAllFilesPermission()
      : true;

    const permBannerHtml = !hasPerm
      ? `<div id="musicPathPermBanner" class="path-permission-banner" style="display:flex;align-items:center;gap:8px;font-size:11px;padding:8px 10px;border-radius:8px;background:rgba(234,179,8,0.12);color:#eab308;margin-bottom:12px;cursor:pointer;">
           <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
           <span>${lang["desc-all-files-access"] || "Tip: Grant All Files Access to save & play in any directory."}</span>
         </div>`
      : "";

    const browseBtnHtml = canBrowse
      ? `<button type="button" id="browseMusicFolderBtn" class="path-preset-chip browse-chip" style="display:inline-flex;align-items:center;gap:5px;">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
           <span>${lang["btn-browse-folder"] || "Browse Folder"}</span>
         </button>`
      : "";

    showConfirm(
      lang["label-path-music"] || "Music Download Path",
      `<div class="path-picker-ui">
         ${permBannerHtml}
         <div class="path-input-wrapper">
           <span class="path-label-sm">${lang["label-custom-directory"] || "Target Directory"}</span>
           <div class="mori-input-with-icon">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
             <input type="text" id="customMusicPathInput" class="mori-input-noborder" value="${customMusicPath}" placeholder="e.g. Music/Mori" spellcheck="false" autocomplete="off">
           </div>
         </div>
         <span class="path-label-sm">${lang["label-path-presets"] || "Presets"}</span>
         <div class="path-presets-container">
           ${browseBtnHtml}
           ${presets.map((p) => `<button type="button" class="path-preset-chip" data-path="${p}">${p}</button>`).join("")}
         </div>
         <button id="resetMusicPathBtn" class="reset-path-btn">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
           <span>${lang["btn-reset-default"] || "Reset to Default"}</span>
         </button>
       </div>`,
      () => {
        const input = document.getElementById("customMusicPathInput");
        if (input && input.value.trim()) {
          const newPath = normalizePathInput(input.value);
          const hasPerm = isAndroid && window.MoriMainBridge?.hasAllFilesPermission
            ? window.MoriMainBridge.hasAllFilesPermission()
            : true;

          if (isAndroid && !hasPerm && !newPath.toLowerCase().startsWith("download")) {
            showToast(lang["desc-all-files-access"] || "All Files Access required. Reverted to Download/Mori.");
            customMusicPath = "Download/Mori/Music";
            localStorage.setItem("mori_music_path", "Download/Mori/Music");
            if (musicPathVal) musicPathVal.textContent = formatPathDisplay("Download/Mori/Music");
          } else {
            customMusicPath = newPath;
            localStorage.setItem("mori_music_path", newPath);
            if (musicPathVal) musicPathVal.textContent = formatPathDisplay(newPath);
            showToast(lang["toast-path-updated"] || "Path updated");
          }
          updateStorageInfo();
          updateAllFilesUI();
        }
      },
    );
    setTimeout(() => {
      const input = document.getElementById("customMusicPathInput");
      const chips = document.querySelectorAll(
        ".path-presets-container .path-preset-chip:not(.browse-chip)",
      );
      const updateActiveChips = () => {
        const current = input ? normalizePathInput(input.value) : "";
        chips.forEach((c) => {
          if (c.getAttribute("data-path") === current) {
            c.classList.add("active");
          } else {
            c.classList.remove("active");
          }
        });
      };
      updateActiveChips();
      input?.addEventListener("input", updateActiveChips);

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          if (input) {
            input.value = chip.getAttribute("data-path");
            updateActiveChips();
            input.focus();
          }
        });
      });

      document.getElementById("browseMusicFolderBtn")?.addEventListener("click", async () => {
        const chosen = await pickNativeFolder();
        if (chosen && input) {
          input.value = chosen;
          updateActiveChips();
          input.focus();
        }
      });

      document.getElementById("musicPathPermBanner")?.addEventListener("click", () => {
        if (window.MoriMainBridge?.requestAllFilesPermission) {
          window.MoriMainBridge.requestAllFilesPermission();
        }
      });

      document.getElementById("resetMusicPathBtn")?.addEventListener("click", () => {
        if (input) {
          input.value = "Music/Mori";
          updateActiveChips();
          input.focus();
        }
      });
    }, 100);
    if (okConfirmBtn) {
      okConfirmBtn.textContent = "SAVE";
      okConfirmBtn.classList.add("neutral-btn");
    }
  });

  // 4b. Mount Backup & Restore (.json) Buttons
  mountBackupRestoreItems();
  mountHistorySearchAndFilter();

  // 5. Manual Clear Cache Button
  clearCacheBtn?.addEventListener("click", () => {
    const lang = translations[currentLang] || translations.en;
    showConfirm(
      lang["label-clearcache"] || "Clear Cache",
      lang["desc-clearcache"] || "Are you sure you want to clear the app cache?",
      async () => {
        try {
          if (Filesystem) {
            try {
              const files = await Filesystem.readdir({
                path: "",
                directory: "CACHE",
              });
              for (const file of files.files) {
                if (file.type === "directory") {
                  await Filesystem.rmdir({
                    path: file.name,
                    directory: "CACHE",
                    recursive: true,
                  });
                } else {
                  await Filesystem.deleteFile({
                    path: file.name,
                    directory: "CACHE",
                  });
                }
              }
            } catch (_) {}
          }
          invalidateGalleryCache();
          await updateStorageInfo();
          showToast(lang["label-cache-cleared"] || "Cache cleared");
        } catch (_) {
          showToast(lang["toast-cache-error"] || "Failed to clear cache");
        }
      },
    );
  });

  // 7. Wipe All Data Button
  wipeDataBtn?.addEventListener("click", () => {
    const lang = translations[currentLang] || translations.en;
    showConfirm(
      lang["label-wipedata"] || "Wipe Data",
      lang["desc-wipedata"] || "This will reset all data and history. Proceed?",
      async () => {
        try {
          const langPref = localStorage.getItem("mori_lang");
          const theme = localStorage.getItem("mori_theme");
          const vPath = localStorage.getItem("mori_download_path");
          const mPath = localStorage.getItem("mori_music_path");

          localStorage.clear();

          if (langPref) localStorage.setItem("mori_lang", langPref);
          if (theme) localStorage.setItem("mori_theme", theme);
          if (vPath) localStorage.setItem("mori_download_path", vPath);
          if (mPath) localStorage.setItem("mori_music_path", mPath);

          if (Filesystem) {
            try {
              const cacheFiles = await Filesystem.readdir({
                path: "",
                directory: "CACHE",
              });
              for (const file of cacheFiles.files) {
                await Filesystem.deleteFile({
                  path: file.name,
                  directory: "CACHE",
                });
              }
            } catch (_) {}
          }
          invalidateGalleryCache();
          await updateStorageInfo();
          renderHistory(onHistoryItemClick, onHistoryDeleteClick);
          showToast(lang["label-data-wiped"] || "All data wiped");
          setTimeout(() => location.reload(), 1500);
        } catch (_) {
          localStorage.clear();
          location.reload();
        }
      },
    );
  });
}
