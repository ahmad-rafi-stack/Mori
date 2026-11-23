// ui.js — history rendering + shared UI state + re-exports
import { truncate, triggerHaptic } from "./utils/index.js";
import {
  currentLang,
  isEditingHistory,
  setIsEditingHistory,
  setCurrentLang,
  setCurrentSlideIndex,
  setSlideData,
} from "./modules/core.js";
import {
  getHistoryFilterText,
  filterHistoryItems,
} from "./ui/historyFilter.js";

// Escape HTML to prevent XSS from scraped titles
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// State lives in core.js (shared across modules)

export function setUIState(state) {
  if (state.currentLang) setCurrentLang(state.currentLang);
  if (state.isEditingHistory !== undefined)
    setIsEditingHistory(state.isEditingHistory);
  if (state.currentSlideIndex !== undefined)
    setCurrentSlideIndex(state.currentSlideIndex);
  if (state.slideData !== undefined) setSlideData(state.slideData);
}

let historyObserver = null;
const BATCH_SIZE = 25;

function createHistoryCard(
  item,
  activeUrl,
  isEditingHistory,
  onItemClick,
  onDeleteClick,
) {
  const card = document.createElement("div");
  card.className = `history-item ${item.favorite ? "is-favorite" : ""}`;

  // Check if this item is currently being downloaded
  const isDownloading =
    activeUrl &&
    (item.url === activeUrl ||
      (item.sourceUrl && item.sourceUrl === activeUrl) ||
      activeUrl.includes(item.url) ||
      (item.url && activeUrl && item.url.includes(activeUrl)));

  const defaultPlaceholder =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23888'%3E%3Cpath d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E";
  const isDataSaver = localStorage.getItem("mori_data_saver") === "true";
  let thumbSrc = isDataSaver ? defaultPlaceholder : null;

  if (!isDataSaver) {
    const isValidThumb = (t) =>
      typeof t === "string" &&
      t.length > 0 &&
      (!t.startsWith("thumb_") || t.includes("/"));

    if (isValidThumb(item.localThumbnail)) {
      thumbSrc = item.localThumbnail;
    } else if (item.localFiles && item.localFiles.length > 0) {
      const first = item.localFiles[0];
      const isImg =
        first.type === "IMAGE" ||
        /\.(jpe?g|png|webp|gif|bmp)$/i.test(first.path || first.uri || "");
      if (isValidThumb(first.thumbnail)) {
        thumbSrc = first.thumbnail;
      } else if (isImg) {
        thumbSrc = first.uri || first.path;
      } else if (isValidThumb(item.thumbnail) && navigator.onLine) {
        thumbSrc = item.thumbnail;
      }
    } else if (item.localUri) {
      if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(item.localUri)) {
        thumbSrc = item.localUri;
      } else if (isValidThumb(item.thumbnail) && navigator.onLine) {
        thumbSrc = item.thumbnail;
      }
    } else if (isValidThumb(item.thumbnail)) {
      thumbSrc = item.thumbnail;
    }

    if (
      thumbSrc &&
      !thumbSrc.startsWith("http") &&
      !thumbSrc.startsWith("data:") &&
      !thumbSrc.startsWith("blob:") &&
      !thumbSrc.startsWith("capacitor:")
    ) {
      if (window.Capacitor?.convertFileSrc) {
        let raw = thumbSrc;
        if (raw.includes("_capacitor_file_")) {
          raw = raw.substring(raw.indexOf("_capacitor_file_") + 16);
        }
        if (!raw.startsWith("file://")) {
          if (
            !raw.startsWith("/") &&
            window.Capacitor.getPlatform?.() === "android"
          ) {
            raw = "/storage/emulated/0/" + raw;
          }
          raw = "file://" + (raw.startsWith("/") ? raw : "/" + raw);
        }
        thumbSrc = window.Capacitor.convertFileSrc(raw);
      }
    }
  }

  if (!thumbSrc) thumbSrc = defaultPlaceholder;

  const fallbackUrl = item.thumbnail || defaultPlaceholder;

  card.innerHTML = `
    <div class="history-thumb-container">
        <img src="${escapeHtml(thumbSrc)}" alt="" class="hist-img" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(fallbackUrl)}';">
        ${item.localFiles && item.localFiles.length > 1 ? `<div class="multi-indicator">${item.localFiles.length}</div>` : ""}
        ${isDownloading ? `<div class="hist-downloading-overlay"><div class="hist-dl-spinner"></div></div>` : ""}
    </div>
    <div class="history-info">
        <h3>${truncate(escapeHtml(item.title), 60)}</h3>
        <p>${new Date(item.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</p>
    </div>
    ${
      isEditingHistory
        ? `<button class="delete-item-btn" data-url="${escapeHtml(item.url)}">×</button>`
        : `<button class="hist-fav-btn ${item.favorite ? "active" : ""}" data-url="${escapeHtml(item.url)}" aria-label="Favorite" title="${item.favorite ? "Favorited" : "Favorite"}">
            <svg class="heart-icon" viewBox="0 0 24 24" width="18" height="18" fill="${item.favorite ? "#ff3b5c" : "none"}" stroke="${item.favorite ? "#ff3b5c" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>`
    }
  `;

  const favBtn = card.querySelector(".hist-fav-btn");
  if (favBtn) {
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (typeof window.toggleMoriFavorite === "function") {
        window.toggleMoriFavorite(item.url);
      }
    });
  }

  if (!isEditingHistory) {
    let pressTimer = null;
    let isLongPress = false;
    let startX = 0;
    let startY = 0;

    const startPress = (e) => {
      if (e.target.closest(".hist-fav-btn, .delete-item-btn")) return;
      isLongPress = false;
      try {
        window.getSelection()?.removeAllRanges();
      } catch (_) {}
      if (e.touches && e.touches[0]) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
      pressTimer = setTimeout(() => {
        isLongPress = true;
        try {
          window.getSelection()?.removeAllRanges();
        } catch (_) {}
        triggerHaptic();
        onDeleteClick(item.url);
      }, 500);
    };

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const movePress = (e) => {
      if (e.touches && e.touches[0]) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > 10 || dy > 10) {
          cancelPress();
        }
      }
    };

    card.addEventListener("touchstart", startPress, { passive: true });
    card.addEventListener("touchend", cancelPress);
    card.addEventListener("touchmove", movePress, { passive: true });
    card.addEventListener("touchcancel", cancelPress);

    card.addEventListener("mousedown", (e) => {
      if (e.button === 0) startPress(e);
    });
    card.addEventListener("mouseup", cancelPress);
    card.addEventListener("mouseleave", cancelPress);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest(".hist-fav-btn, .delete-item-btn")) return;
      if (isLongPress) {
        e.preventDefault();
        e.stopPropagation();
        isLongPress = false;
        return;
      }
      onItemClick(item);
    });
  } else {
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      onDeleteClick(item.url);
    });
    const delBtn = card.querySelector(".delete-item-btn");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onDeleteClick(item.url);
      });
    }
  }

  return card;
}

let activeHistoryFilter = { tab: "all", query: "" };
let lastHistoryCallbacks = null;
let historySearchDebounceTimer = null;
let historyFilterLangBound = false;

function updateHistoryFilterBarLabels(bar) {
  if (!bar) return;
  const searchInput = bar.querySelector("#moriHistorySearchInput");
  if (searchInput) {
    searchInput.placeholder = getHistoryFilterText(
      "searchPlaceholder",
      currentLang,
    );
  }
  bar.querySelectorAll(".mori-history-chip").forEach((chip) => {
    const tab = chip.getAttribute("data-tab");
    if (tab) chip.textContent = getHistoryFilterText(tab, currentLang);
  });
  const emptyEl = document.querySelector(
    "#historyPage .mori-history-filter-empty",
  );
  if (emptyEl) {
    emptyEl.textContent = getHistoryFilterText("emptyMatch", currentLang);
  }
}

function resetHistoryFilterState(bar) {
  activeHistoryFilter.tab = "all";
  activeHistoryFilter.query = "";
  if (!bar) return;
  const searchInput = bar.querySelector("#moriHistorySearchInput");
  if (searchInput) searchInput.value = "";
  bar.querySelectorAll(".mori-history-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-tab") === "all");
  });
}

function ensureHistoryFilterBar(historyPage) {
  if (!historyPage || typeof document === "undefined") return null;

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
        font-size: 13px;
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

  let bar = document.getElementById("moriHistoryFilterBar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "moriHistoryFilterBar";
  bar.className = "mori-history-filter-bar";
  bar.style.display = "none";
  bar.innerHTML = `
    <div class="mori-history-search-wrap">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="opacity:0.6;flex-shrink:0;">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input type="text" id="moriHistorySearchInput" placeholder="${escapeHtml(getHistoryFilterText("searchPlaceholder", currentLang))}" autocomplete="off" spellcheck="false" />
    </div>
    <div class="mori-history-chips">
      <button type="button" class="mori-history-chip active" data-tab="all">${escapeHtml(getHistoryFilterText("all", currentLang))}</button>
      <button type="button" class="mori-history-chip" data-tab="fav">${escapeHtml(getHistoryFilterText("fav", currentLang))}</button>
      <button type="button" class="mori-history-chip" data-tab="video">${escapeHtml(getHistoryFilterText("video", currentLang))}</button>
      <button type="button" class="mori-history-chip" data-tab="doc">${escapeHtml(getHistoryFilterText("doc", currentLang))}</button>
      <button type="button" class="mori-history-chip" data-tab="audio">${escapeHtml(getHistoryFilterText("audio", currentLang))}</button>
    </div>
  `;

  const anchor =
    historyPage.querySelector(".history-list") ||
    historyPage.querySelector(".empty-state");
  if (anchor) {
    historyPage.insertBefore(bar, anchor);
  } else {
    historyPage.appendChild(bar);
  }

  const triggerFilteredRender = () => {
    if (lastHistoryCallbacks) {
      renderHistory(
        lastHistoryCallbacks.onItemClick,
        lastHistoryCallbacks.onDeleteClick,
      );
    }
  };

  const searchInput = bar.querySelector("#moriHistorySearchInput");
  searchInput?.addEventListener("input", (e) => {
    activeHistoryFilter.query = e.target.value || "";
    clearTimeout(historySearchDebounceTimer);
    historySearchDebounceTimer = setTimeout(() => {
      triggerFilteredRender();
    }, 150);
  });

  bar.querySelectorAll(".mori-history-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      bar
        .querySelectorAll(".mori-history-chip")
        .forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeHistoryFilter.tab = chip.getAttribute("data-tab") || "all";
      triggerFilteredRender();
    });
  });

  if (!historyFilterLangBound) {
    historyFilterLangBound = true;
    window.addEventListener("mori_language_changed", () => {
      updateHistoryFilterBarLabels(
        document.getElementById("moriHistoryFilterBar"),
      );
    });
  }

  return bar;
}

export function renderHistory(onItemClick, onDeleteClick) {
  lastHistoryCallbacks = { onItemClick, onDeleteClick };
  if (typeof window.checkAndMergePendingHistorySync === "function") {
    window.checkAndMergePendingHistorySync();
  }
  const rawHistory = JSON.parse(localStorage.getItem("mori_history") || "[]");
  // Sort favorites to the top (most recently favorited first), then non-favorites
  const history = [...rawHistory].sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    if (a.favorite && b.favorite) {
      return (
        (b.favTimestamp || b.timestamp || 0) -
        (a.favTimestamp || a.timestamp || 0)
      );
    }
    return 0;
  });

  const historyPage = document.getElementById("historyPage");
  const editHistoryBtn = document.getElementById("editHistoryBtn");
  const historyActions = document.getElementById("historyActions");
  if (!historyPage) return;
  const activeUrl = window._moriActiveDownloadUrl || null;

  const dlStatsEl = document.getElementById("historyDlStatsVal");
  const historyStatsEl = document.getElementById("historyItemsCountVal");
  if (dlStatsEl) {
    const storedCount = parseInt(
      localStorage.getItem("mori_dl_count") || "0",
      10,
    );
    const count = Math.max(storedCount, history.length);
    dlStatsEl.textContent = count.toLocaleString();
  }
  if (historyStatsEl) {
    historyStatsEl.textContent = history.length.toLocaleString();
  }

  const filterBar = ensureHistoryFilterBar(historyPage);
  const emptyState = historyPage.querySelector(".empty-state");
  let list = historyPage.querySelector(".history-list");
  if (list) list.remove();

  if (historyObserver) {
    historyObserver.disconnect();
    historyObserver = null;
  }

  if (history.length === 0) {
    resetHistoryFilterState(filterBar);
    if (filterBar) filterBar.style.display = "none";
    setIsEditingHistory(false);
    emptyState?.classList.remove("hidden");
    editHistoryBtn?.classList.add("hidden");
    historyActions?.classList.add("hidden");
    return;
  }

  if (filterBar) {
    filterBar.style.display = "flex";
    updateHistoryFilterBarLabels(filterBar);
  }

  emptyState?.classList.add("hidden");
  if (isEditingHistory) {
    editHistoryBtn?.classList.add("hidden");
    historyActions?.classList.remove("hidden");
  } else {
    editHistoryBtn?.classList.remove("hidden");
    historyActions?.classList.add("hidden");
  }

  // Filter full sorted history dataset BEFORE pagination so search & chips work across all pages
  const filteredHistory = filterHistoryItems(history, activeHistoryFilter);

  list = document.createElement("div");
  list.className = "history-list";

  if (filteredHistory.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "mori-history-filter-empty";
    emptyEl.style.cssText =
      "text-align:center;padding:18px 10px;font-size:12px;opacity:0.65;";
    emptyEl.textContent = getHistoryFilterText("emptyMatch", currentLang);
    list.appendChild(emptyEl);
    historyPage.appendChild(list);
    return;
  }

  let renderedIndex = 0;
  let sentinel = null;

  const renderBatch = () => {
    const end = Math.min(renderedIndex + BATCH_SIZE, filteredHistory.length);
    for (let i = renderedIndex; i < end; i++) {
      list.appendChild(
        createHistoryCard(
          filteredHistory[i],
          activeUrl,
          isEditingHistory,
          onItemClick,
          onDeleteClick,
        ),
      );
    }
    renderedIndex = end;

    if (renderedIndex < filteredHistory.length) {
      if (!sentinel) {
        sentinel = document.createElement("div");
        sentinel.className = "history-sentinel";
        sentinel.style.height = "20px";
        if (typeof IntersectionObserver !== "undefined") {
          historyObserver = new IntersectionObserver(
            (entries) => {
              if (entries[0]?.isIntersecting) {
                renderBatch();
              }
            },
            { rootMargin: "300px" },
          );
          historyObserver.observe(sentinel);
        }
      }
      list.appendChild(sentinel);
    } else if (sentinel) {
      sentinel.remove();
      if (historyObserver) {
        historyObserver.disconnect();
        historyObserver = null;
      }
    }
  };

  renderBatch();
  historyPage.appendChild(list);
}

// Re-exports for backward compatibility with importers
export {
  setCurrentLang,
  setCurrentSlideIndex,
  setSlideData,
} from "./modules/core.js";
export {
  updateSliderUI,
  renderResult,
  renderMediaSlides,
} from "./ui/result.js";
export { showModal } from "./ui/resultModal.js";
export {
  startNativeDownload,
  cancelCurrentDownload,
} from "./ui/nativeDownload.js";
