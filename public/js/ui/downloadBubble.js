// downloadBubble.js — Floating Download Bubble with Multi-Download Dropup Manager (Real-Time MB & Accurate Progress)
import { t } from "../i18n/index.js";
import { triggerHaptic } from "../utils/device.js";
import { probeContentLength } from "../downloader/storage.js";
import { buildDownloadHeaders } from "../downloader/headers.js";
import { setTikTokSource } from "../scrapers/index.js";

const escapeHtml = (s) =>
  String(s || "").replace(/[&<>"']/g, (m) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[m],
  );

const truncateTitle = (s, max = 22) => {
  const str = String(s || "").trim();
  if (str.length <= max) return str;
  return str.slice(0, max).trim() + "...";
};

export function formatBytesToMB(bytes) {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes < 0) return "0.0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1 && bytes > 0) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return `${kb} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatTransferStatus(loadedBytes, totalBytes, speedBps = 0) {
  const loadedStr = formatBytesToMB(loadedBytes);
  const speedStr =
    speedBps > 0 ? ` • ${formatBytesToMB(speedBps)}/s` : "";
  if (totalBytes && totalBytes > 0) {
    const totalStr = formatBytesToMB(totalBytes);
    return `${loadedStr} / ${totalStr}${speedStr}`;
  }
  return `${loadedStr}${speedStr}`;
}

function injectSwitcherStyles() {
  if (typeof document === "undefined" || document.getElementById("mori-switcher-styles")) return;
  const style = document.createElement("style");
  style.id = "mori-switcher-styles";
  style.textContent = `
    .mori-server-switcher {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      width: 100%;
    }
    .mori-server-switcher .server-pill {
      flex: 1;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1.5px solid var(--primary, #000000);
      background: var(--surface, #ffffff);
      color: var(--text-main, #000000);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      font-family: inherit;
      box-shadow: 2px 2px 0px var(--primary, #000000);
    }
    .mori-server-switcher .server-pill:active {
      transform: scale(0.96);
      box-shadow: 1px 1px 0px var(--primary, #000000);
    }
    .mori-server-switcher .server-pill.active {
      background: var(--primary, #000000);
      color: var(--on-primary, #ffffff);
    }
    .mori-server-switcher .server-pill.active .pill-name {
      color: var(--on-primary, #ffffff);
    }
    .mori-server-switcher .server-pill.active .pill-sub {
      color: var(--on-primary, #ffffff);
      opacity: 0.85;
    }
    .mori-server-switcher .pill-name {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-main, #000000);
      letter-spacing: -0.2px;
    }
    .mori-server-switcher .pill-sub {
      font-size: 0.68rem;
      opacity: 0.72;
      color: var(--text-secondary, #666666);
      margin-top: 2px;
    }
    .dl-opt-size {
      opacity: 0.75;
      font-size: 0.88em;
      font-weight: 500;
      margin-left: 5px;
    }
  `;
  document.head.appendChild(style);
}

function enhanceDownloadOptions() {
  if (typeof document === "undefined") return;
  const downloadList = document.getElementById("downloadList");
  if (!downloadList) return;

  const urlInput = document.getElementById("urlInput");
  const rawUrl = (urlInput?.value?.trim() || window._moriActiveDownloadUrl || "").toLowerCase();
  const isTikTok = rawUrl.includes("tiktok.com") || rawUrl.includes("douyin.com") || rawUrl.includes("tt.site");

  // 1. TikTok 2-Server Selector
  let switcher = document.getElementById("moriServerSwitcher");
  if (isTikTok) {
    if (!switcher) {
      switcher = document.createElement("div");
      switcher.id = "moriServerSwitcher";
      switcher.className = "mori-server-switcher";
      downloadList.parentNode.insertBefore(switcher, downloadList);
    }
    const currentSrv = localStorage.getItem("mori_prefer_server_tiktok") || "tiktokio";
    switcher.innerHTML = `
      <button type="button" class="server-pill ${currentSrv === "tiktokio" ? "active" : ""}" id="moriSrv1">
        <div class="pill-name">Server 1</div>
        <div class="pill-sub">TikTokIO (HD)</div>
      </button>
      <button type="button" class="server-pill ${currentSrv === "tikdownloader" ? "active" : ""}" id="moriSrv2">
        <div class="pill-name">Server 2</div>
        <div class="pill-sub">TikDownloader (1080p)</div>
      </button>
    `;
    const srv1 = switcher.querySelector("#moriSrv1");
    const srv2 = switcher.querySelector("#moriSrv2");
    srv1?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (localStorage.getItem("mori_prefer_server_tiktok") === "tiktokio") return;
      localStorage.setItem("mori_prefer_server_tiktok", "tiktokio");
      localStorage.setItem("mori_server_tiktok", "server1");
      setTikTokSource("tiktokio");
      srv1.classList.add("active");
      srv2?.classList.remove("active");
      const dlBtn = document.getElementById("downloadBtn");
      dlBtn?.click();
    });
    srv2?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (localStorage.getItem("mori_prefer_server_tiktok") === "tikdownloader") return;
      localStorage.setItem("mori_prefer_server_tiktok", "tikdownloader");
      localStorage.setItem("mori_server_tiktok", "server2");
      setTikTokSource("tikdownloader");
      srv2.classList.add("active");
      srv1?.classList.remove("active");
      const dlBtn = document.getElementById("downloadBtn");
      dlBtn?.click();
    });
  } else if (switcher) {
    switcher.remove();
  }

  // 2. Add file size display next to resolution on each download button
  const btns = downloadList.querySelectorAll(".dl-item:not(.dl-all-btn)");
  if (btns.length === 0) return;

  let historyList = [];
  try {
    historyList = JSON.parse(localStorage.getItem("mori_history") || "[]");
  } catch (_) {}
  const latestItem = historyList[0] || null;
  const downloads = latestItem?.downloads || [];

  btns.forEach((btn, idx) => {
    if (btn.dataset.sizeEnhanced === "true") return;
    btn.dataset.sizeEnhanced = "true";

    const dl = downloads[idx];
    const textSpan = btn.querySelector("span:not(.dl-all-title):not(.dl-badge)");
    if (!textSpan) return;

    let szSpan = textSpan.querySelector(".dl-opt-size");
    if (!szSpan) {
      szSpan = document.createElement("span");
      szSpan.className = "dl-opt-size";
      textSpan.appendChild(szSpan);
    }

    if (dl?.size) {
      const formatted = typeof dl.size === "number" ? formatBytesToMB(dl.size) : dl.size;
      szSpan.textContent = ` (${formatted})`;
    } else if (dl?.url) {
      const headers = buildDownloadHeaders(dl.url, latestItem?.url || rawUrl, dl.url);
      probeContentLength(dl.url, headers).then((sz) => {
        if (sz > 0 && btn.contains(szSpan)) {
          szSpan.textContent = ` (${formatBytesToMB(sz)})`;
        }
      }).catch(() => {});
    }
  });
}

class DownloadBubbleManager {
  constructor() {
    this.activeDownloads = new Map();
    this.container = null;
    this.bubbleBtn = null;
    this.badgeEl = null;
    this.countBadgeEl = null;
    this.progressRing = null;
    this.dropupEl = null;
    this.listEl = null;
    this.emptyStateEl = null;
    this.iconWrap = null;
    this.isOpen = false;
  }

  isShareOverlay() {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname || "";
    const href = window.location.href || "";
    return (
      path.endsWith("share.html") ||
      href.includes("share.html") ||
      !!document.getElementById("platformBadge")
    );
  }

  init() {
    if (this.isShareOverlay()) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.ensureMounted();
        this.initListObserver();
      });
    } else {
      this.ensureMounted();
      this.initListObserver();
    }
    window.addEventListener("mori_language_changed", () => {
      this.refreshTranslations();
    });
  }

  initListObserver() {
    injectSwitcherStyles();
    const attachObserver = () => {
      const downloadList = document.getElementById("downloadList");
      if (downloadList) {
        enhanceDownloadOptions();
        const observer = new MutationObserver(() => {
          enhanceDownloadOptions();
        });
        observer.observe(downloadList, { childList: true, subtree: true });
      } else {
        setTimeout(attachObserver, 250);
      }
    };
    attachObserver();
  }

  refreshTranslations() {
    if (!this.container) return;
    const titleEl = this.container.querySelector("#dbdTitle");
    const emptyTitleEl = this.container.querySelector("#dbdEmptyTitle");
    const emptyDescEl = this.container.querySelector("#dbdEmptyDesc");
    const closeBtn = this.container.querySelector("#dbdCloseBtn");

    if (titleEl) titleEl.textContent = t("bubble-title");
    if (emptyTitleEl) emptyTitleEl.textContent = t("bubble-empty-title");
    if (emptyDescEl) emptyDescEl.textContent = t("bubble-empty-desc");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("btn-close"));
    if (this.bubbleBtn) {
      this.bubbleBtn.setAttribute("aria-label", t("bubble-manager"));
      this.bubbleBtn.setAttribute("title", t("bubble-title"));
    }
    this.updateUI();
  }

  ensureMounted() {
    if (this.isShareOverlay()) return;
    if (this.container && document.body.contains(this.container)) return;

    this.container = document.createElement("div");
    this.container.id = "downloadBubbleContainer";
    this.container.className = "download-bubble-container visible";
    this.container.innerHTML = `
      <div id="downloadBubbleDropup" class="download-bubble-dropup">
        <div class="dbd-header">
          <div class="dbd-title-group">
            <svg class="dbd-title-icon" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
            <span class="dbd-title" id="dbdTitle">${t("bubble-title")}</span>
            <span class="dbd-count-badge" id="dbdCountBadge">${t("bubble-idle")}</span>
          </div>
          <button class="dbd-close-btn" id="dbdCloseBtn" aria-label="${t("btn-close")}">✕</button>
        </div>
        <div class="dbd-body">
          <div class="dbd-empty" id="dbdEmpty">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <p class="dbd-empty-text" id="dbdEmptyTitle">${t("bubble-empty-title")}</p>
            <span class="dbd-empty-sub" id="dbdEmptyDesc">${t("bubble-empty-desc")}</span>
          </div>
          <div class="dbd-list" id="downloadBubbleList"></div>
        </div>
      </div>

      <button id="downloadBubbleBtn" class="download-bubble-btn" aria-label="${t("bubble-manager")}" title="${t("bubble-title")}">
        <svg class="db-ring-svg" viewBox="0 0 44 44">
          <circle class="db-ring-bg" cx="22" cy="22" r="19" />
          <circle class="db-ring-fill" id="dbRingFill" cx="22" cy="22" r="19" />
        </svg>
        <div class="db-icon-wrap" id="dbIconWrap">
          <svg class="db-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
        </div>
        <span class="db-badge hidden" id="dbBadge">0</span>
      </button>
    `;

    document.body.appendChild(this.container);

    this.bubbleBtn = this.container.querySelector("#downloadBubbleBtn");
    this.badgeEl = this.container.querySelector("#dbBadge");
    this.countBadgeEl = this.container.querySelector("#dbdCountBadge");
    this.progressRing = this.container.querySelector("#dbRingFill");
    this.dropupEl = this.container.querySelector("#downloadBubbleDropup");
    this.listEl = this.container.querySelector("#downloadBubbleList");
    this.emptyStateEl = this.container.querySelector("#dbdEmpty");
    this.iconWrap = this.container.querySelector("#dbIconWrap");

    this.bubbleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleDropup();
    });

    const closeBtn = this.container.querySelector("#dbdCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeDropup();
      });
    }

    document.addEventListener("click", (e) => {
      if (this.isOpen && !this.container.contains(e.target)) {
        this.closeDropup();
      }
    });

    this.updateUI();
  }

  toggleDropup() {
    if (this.isOpen) {
      this.closeDropup();
    } else {
      this.openDropup();
    }
  }

  openDropup() {
    this.isOpen = true;
    this.dropupEl?.classList.add("open");
    triggerHaptic?.("light");
  }

  closeDropup() {
    this.isOpen = false;
    this.dropupEl?.classList.remove("open");
  }

  addDownload({ id, title, platform, type, onCancel }) {
    this.ensureMounted();

    const cleanTitle = (title || "Media").replace(/[<>]/g, "").trim();
    const cleanType = (type || "")
      .replace(/\s*\[(MP3|MP4|JPG|PNG|WEBP)\]/gi, "")
      .trim();

    const dl = {
      id,
      title: cleanTitle,
      displayTitle: truncateTitle(cleanTitle, 22),
      platform: platform || "Media",
      type: cleanType,
      progress: 0,
      loadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      status: t("status-downloading"),
      onCancel: onCancel || null,
      element: null,
    };

    this.activeDownloads.set(id, dl);
    this.renderItem(dl);
    this.updateUI();
    return id;
  }

  renderItem(dl) {
    const itemEl = document.createElement("div");
    itemEl.className = "dbd-item";
    itemEl.id = `dbd-item-${dl.id}`;
    itemEl.innerHTML = `
      <div class="dbd-item-header">
        <div class="dbd-item-info">
          <span class="dbd-item-pill">${escapeHtml(dl.platform)}${dl.type ? " · " + escapeHtml(dl.type) : ""}</span>
          <span class="dbd-item-name" title="${escapeHtml(dl.title)}">${escapeHtml(dl.displayTitle)}</span>
        </div>
        <button class="dbd-item-cancel" aria-label="${t("btn-cancel")}" title="${t("btn-cancel")}">✕</button>
      </div>
      <div class="dbd-item-track">
        <div class="dbd-item-bar" style="width: 0%;"></div>
      </div>
      <div class="dbd-item-footer">
        <span class="dbd-item-status">${escapeHtml(dl.status)}</span>
        <span class="dbd-item-percent">0%</span>
      </div>
    `;

    const cancelBtn = itemEl.querySelector(".dbd-item-cancel");
    cancelBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof dl.onCancel === "function") {
        dl.onCancel();
      }
      this.cancelDownload(dl.id);
    });

    dl.element = itemEl;
    this.listEl.prepend(itemEl);
  }

  updateProgress(id, pct, statusText, meta = null) {
    const dl = this.activeDownloads.get(id);
    if (!dl) return;

    dl.progress = Math.min(100, Math.max(0, Math.round(pct)));
    if (statusText) dl.status = statusText;
    if (meta) {
      if (typeof meta.loadedBytes === "number") dl.loadedBytes = meta.loadedBytes;
      if (typeof meta.totalBytes === "number") dl.totalBytes = meta.totalBytes;
      if (typeof meta.speedBps === "number") dl.speedBps = meta.speedBps;
    }

    if (dl.element) {
      const bar = dl.element.querySelector(".dbd-item-bar");
      const pctEl = dl.element.querySelector(".dbd-item-percent");
      const statusEl = dl.element.querySelector(".dbd-item-status");
      if (bar) bar.style.width = `${dl.progress}%`;
      if (pctEl) pctEl.textContent = `${dl.progress}%`;
      if (statusEl && statusText) statusEl.textContent = statusText;
    }

    this.updateOverallProgress();
  }

  completeDownload(id, message = null) {
    const dl = this.activeDownloads.get(id);
    if (!dl) return;

    const displayMsg = message || t("status-saved");
    dl.progress = 100;
    dl.status = displayMsg;

    if (dl.element) {
      dl.element.classList.add("completed");
      const bar = dl.element.querySelector(".dbd-item-bar");
      const pctEl = dl.element.querySelector(".dbd-item-percent");
      const statusEl = dl.element.querySelector(".dbd-item-status");
      const cancelBtn = dl.element.querySelector(".dbd-item-cancel");
      if (bar) bar.style.width = "100%";
      if (pctEl) pctEl.textContent = "✓";
      if (statusEl) statusEl.textContent = displayMsg;
      if (cancelBtn) cancelBtn.style.display = "none";
    }

    triggerHaptic?.("light");

    setTimeout(() => {
      this.removeItem(id);
    }, 1800);
  }

  failDownload(id, errorText = null) {
    const dl = this.activeDownloads.get(id);
    if (!dl) return;

    const displayErr = errorText || t("status-failed");
    dl.status = displayErr;

    if (dl.element) {
      dl.element.classList.add("failed");
      const pctEl = dl.element.querySelector(".dbd-item-percent");
      const statusEl = dl.element.querySelector(".dbd-item-status");
      const cancelBtn = dl.element.querySelector(".dbd-item-cancel");
      if (pctEl) pctEl.textContent = "✕";
      if (statusEl) statusEl.textContent = displayErr;
      if (cancelBtn) cancelBtn.style.display = "none";
    }

    setTimeout(() => {
      this.removeItem(id);
    }, 2500);
  }

  cancelDownload(id) {
    const dl = this.activeDownloads.get(id);
    if (!dl) return;

    const cancelMsg = t("status-cancelled");
    dl.status = cancelMsg;

    if (dl.element) {
      dl.element.classList.add("cancelled");
      const statusEl = dl.element.querySelector(".dbd-item-status");
      const pctEl = dl.element.querySelector(".dbd-item-percent");
      const cancelBtn = dl.element.querySelector(".dbd-item-cancel");
      if (statusEl) statusEl.textContent = cancelMsg;
      if (pctEl) pctEl.textContent = "—";
      if (cancelBtn) cancelBtn.style.display = "none";
    }

    setTimeout(() => {
      this.removeItem(id);
    }, 1200);
  }

  removeItem(id) {
    const dl = this.activeDownloads.get(id);
    if (dl?.element) {
      dl.element.classList.add("removing");
      setTimeout(() => {
        dl.element.remove();
      }, 250);
    }
    this.activeDownloads.delete(id);
    this.updateUI();
  }

  updateUI() {
    const count = this.activeDownloads.size;
    if (this.badgeEl) {
      if (count > 0) {
        this.badgeEl.textContent = count > 9 ? "9+" : count.toString();
        this.badgeEl.classList.remove("hidden");
      } else {
        this.badgeEl.classList.add("hidden");
      }
    }

    if (this.countBadgeEl) {
      this.countBadgeEl.textContent =
        count > 0 ? t("bubble-active-count", { count }) : t("bubble-idle");
    }

    if (this.emptyStateEl) {
      this.emptyStateEl.style.display = count === 0 ? "flex" : "none";
    }

    if (this.iconWrap) {
      if (count > 0) {
        this.iconWrap.classList.add("downloading");
      } else {
        this.iconWrap.classList.remove("downloading");
      }
    }

    this.updateOverallProgress();
  }

  updateOverallProgress() {
    if (!this.progressRing) return;
    const total = this.activeDownloads.size;
    const circumference = 119.38;
    if (total === 0) {
      this.progressRing.style.strokeDashoffset = circumference.toString();
      return;
    }

    let sum = 0;
    this.activeDownloads.forEach((dl) => {
      sum += dl.progress;
    });
    const avg = sum / total;
    const offset = circumference - (avg / 100) * circumference;
    this.progressRing.style.strokeDashoffset = offset.toString();
  }
}

export const downloadBubble = new DownloadBubbleManager();
downloadBubble.init();
