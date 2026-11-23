// historyFilter.js — pure history classification, filtering, and 10-language i18n helpers

export const HISTORY_FILTER_I18N = {
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
  es: {
    searchPlaceholder: "Buscar por título o plataforma...",
    all: "Todo",
    fav: "Favoritos",
    video: "Video",
    audio: "Música",
    doc: "Cómic / Imagen",
    emptyMatch: "No hay elementos coincidentes",
  },
};

export function getHistoryFilterText(key, lang = "en") {
  const dict = HISTORY_FILTER_I18N[lang] || HISTORY_FILTER_I18N.en;
  return dict[key] || HISTORY_FILTER_I18N.en[key] || key;
}

export function classifyHistoryRecord(rec) {
  if (!rec) return { fav: false, cat: "video" };
  const isFav = Boolean(rec.favorite);
  const files = Array.isArray(rec.localFiles) ? rec.localFiles : [];
  // Match platform domains against URLs only (never captions/titles) to avoid false categorization
  const urlOnlyStr = `${rec.url || ""} ${rec.sourceUrl || ""}`.toLowerCase();

  for (const f of files) {
    const t = (f?.type || "").toUpperCase();
    const p = (f?.path || f?.uri || "").toLowerCase();
    if (
      t === "AUDIO" ||
      t === "MP3" ||
      /\.(mp3|m4a|wav|flac|ogg|aac|opus)(\?|#|$)/.test(p)
    ) {
      return { fav: isFav, cat: "audio" };
    }
    if (
      t === "IMAGE" ||
      t === "PHOTO" ||
      t === "PDF" ||
      /\.(pdf|jpe?g|png|webp|gif)(\?|#|$)/.test(p)
    ) {
      return { fav: isFav, cat: "doc" };
    }
  }

  if (Array.isArray(rec.downloads) && rec.downloads.length > 0) {
    const allPhotos = rec.downloads.every((d) => {
      const dt = (d?.type || "").toUpperCase();
      return (
        dt === "PHOTO" ||
        dt === "IMAGE" ||
        dt === "PDF" ||
        dt.startsWith("PAGE ")
      );
    });
    if (allPhotos) return { fav: isFav, cat: "doc" };

    const allAudio = rec.downloads.every((d) => {
      const dt = (d?.type || "").toUpperCase();
      return (
        dt.includes("MP3") ||
        dt.includes("AUDIO") ||
        dt.includes("M4A") ||
        dt.includes("FLAC") ||
        dt.includes("WAV")
      );
    });
    if (allAudio) return { fav: isFav, cat: "audio" };
  }

  if (/spotify|soundcloud|music\.apple|bandcamp|deezer/.test(urlOnlyStr)) {
    return { fav: isFav, cat: "audio" };
  }
  if (
    /komiku|mangadex|bacakomik|kiryu|shinigami|pixiv|pinterest|\.pdf|mori-tool:\/\/pdf-gallery/.test(
      urlOnlyStr,
    )
  ) {
    return { fav: isFav, cat: "doc" };
  }
  return { fav: isFav, cat: "video" };
}

export function filterHistoryItems(history, { tab = "all", query = "" } = {}) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const activeTab = tab || "all";
  const q = String(query || "")
    .trim()
    .toLowerCase();

  return history.filter((rec) => {
    if (!rec) return false;
    const { fav, cat } = classifyHistoryRecord(rec);

    const matchesTab =
      activeTab === "all" ||
      (activeTab === "fav" && fav) ||
      activeTab === cat;
    if (!matchesTab) return false;

    if (!q) return true;
    const haystack =
      `${rec.title || ""} ${rec.author || ""} ${rec.url || ""} ${rec.sourceUrl || ""}`.toLowerCase();
    return haystack.includes(q);
  });
}
