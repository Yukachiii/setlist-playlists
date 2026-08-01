(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PublicSetlistApp = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", api.start);
    else api.start();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SERIES = {
    muse: { label: "μ's", color: "#f05a8a" },
    aqours: { label: "Aqours", color: "#2ba6e9" },
    nijigasaki: { label: "虹ヶ咲", color: "#ef8a33" },
    liella: { label: "Liella!", color: "#9556c9" },
    hasunosora: { label: "蓮ノ空", color: "#4f9d75" },
    "school-idol-musical": { label: "スクールアイドルミュージカル", color: "#ca4f63" },
    yohane: { label: "幻日のヨハネ", color: "#596bb7" },
    ikizulive: { label: "イキヅライブ！", color: "#ef596f" }
  };

  const state = {
    events: [],
    query: "",
    series: "all",
    numberedOnly: false,
    selectedEvent: null,
    performanceIndex: 0,
    creatingPlaylist: false,
    creatingTransfer: false
  };
  const spotifyArtworkRequests = new Map();

  const $ = (selector) => document.querySelector(selector);

  function text(value) {
    return String(value ?? "");
  }

  function normalizeSearch(value) {
    return text(value).normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, " ").trim();
  }

  function seriesInfo(id) {
    return SERIES[id] || { label: id || "その他", color: "#596579" };
  }

  function eventSeries(event) {
    return Array.isArray(event?.series) ? event.series.filter(Boolean) : [];
  }

  function isNumberedLive(event) {
    return event?.isNumberedLive === true;
  }

  function eventPerformances(event) {
    return Array.isArray(event?.performances) ? event.performances : [];
  }

  function songs(performance) {
    return (Array.isArray(performance?.setlist) ? performance.setlist : []).filter(
      (item) => !item?.type || item.type === "song"
    );
  }

  function isSpotifyUnavailable(item) {
    return item?.spotifyMatchPolicy === "unavailable" ||
      item?.spotify?.status === "unavailable" ||
      item?.spotify?.status === "skipped";
  }

  function validSpotifyUri(item) {
    return !isSpotifyUnavailable(item) &&
      /^spotify:track:[A-Za-z0-9]{22}$/.test(text(item?.spotify?.uri));
  }

  function spotifyAvailabilityLabel(item) {
    if (isSpotifyUnavailable(item)) return "未配信";
    return validSpotifyUri(item) ? "Spotify" : "未登録";
  }

  function spotifyTrackId(item) {
    const trackId = text(item?.spotify?.trackId).trim();
    if (/^[A-Za-z0-9]{22}$/.test(trackId)) return trackId;
    const uriMatch = text(item?.spotify?.uri).match(/^spotify:track:([A-Za-z0-9]{22})$/);
    return uriMatch?.[1] || "";
  }

  function spotifyArtworkUrl(item) {
    const artworkUrl = text(item?.spotify?.artworkUrl).trim();
    return /^https:\/\//.test(artworkUrl) ? artworkUrl : "";
  }

  async function fetchSpotifyArtwork(trackId) {
    if (!/^[A-Za-z0-9]{22}$/.test(text(trackId))) return "";
    if (spotifyArtworkRequests.has(trackId)) return spotifyArtworkRequests.get(trackId);

    const request = fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${trackId}`)}`
    )
      .then(async (response) => {
        if (!response.ok) return "";
        const body = await response.json().catch(() => ({}));
        const thumbnailUrl = text(body.thumbnail_url).trim();
        return /^https:\/\//.test(thumbnailUrl) ? thumbnailUrl : "";
      })
      .catch(() => "");
    spotifyArtworkRequests.set(trackId, request);
    return request;
  }

  function applySetlistArtwork(container, imageUrl, title) {
    if (!container?.isConnected || !imageUrl) return;
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${title || "楽曲"}のジャケット`;
    image.loading = "lazy";
    image.decoding = "async";
    container.replaceChildren(image);
    container.classList.remove("loading", "placeholder");
    container.removeAttribute("aria-hidden");
  }

  function createSetlistArtwork(item, title, pendingLoads) {
    const artwork = createElement("span", "setlist-artwork placeholder", "♪");
    artwork.setAttribute("aria-hidden", "true");
    if (!validSpotifyUri(item)) return artwork;

    const savedArtwork = spotifyArtworkUrl(item);
    if (savedArtwork) {
      pendingLoads.push({ artwork, imageUrl: savedArtwork, title });
      return artwork;
    }

    const trackId = spotifyTrackId(item);
    if (!trackId) return artwork;
    artwork.classList.add("loading");
    artwork.dataset.spotifyTrackId = trackId;
    pendingLoads.push({ artwork, trackId, title });
    return artwork;
  }

  async function hydrateSetlistArtwork(pendingLoads) {
    const queue = [...pendingLoads];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const task = queue.shift();
        if (!task?.artwork?.isConnected) continue;
        const imageUrl = task.imageUrl || await fetchSpotifyArtwork(task.trackId);
        if (task.trackId && task.artwork.dataset.spotifyTrackId !== task.trackId) continue;
        task.artwork.classList.remove("loading");
        applySetlistArtwork(task.artwork, imageUrl, task.title);
      }
    });
    await Promise.all(workers);
  }

  function formatDate(value) {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || "日程未登録";
    const date = new Date(`${value}T00:00:00`);
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
    return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])} (${weekday})`;
  }

  function eventDateRange(event) {
    const dates = eventPerformances(event).map((item) => item?.date).filter(Boolean).sort();
    if (!dates.length) return "日程未登録";
    if (dates[0] === dates[dates.length - 1]) return formatDate(dates[0]);
    return `${formatDate(dates[0])} — ${formatDate(dates[dates.length - 1])}`;
  }

  function latestDate(event) {
    return eventPerformances(event).map((item) => item?.date || "").sort().at(-1) || "";
  }

  function eventSongCount(event) {
    return eventPerformances(event).reduce((total, performance) => total + songs(performance).length, 0);
  }

  function performanceLabel(performance, index) {
    return performance?.label || (performance?.day ? `Day ${performance.day}` : `公演 ${index + 1}`);
  }

  function createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = text(content);
    return element;
  }

  function showToast(message, kind = "") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast visible${kind ? ` ${kind}` : ""}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.className = "toast"; }, 4200);
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} を読み込めませんでした（${response.status}）`);
    return response.json();
  }

  function normalizeLoadedEvents(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.events) && value.events.every((item) => typeof item === "object")) {
      return value.events;
    }
    return value?.id ? [value] : [];
  }

  function localAdminEvents() {
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return [];
    try {
      const database = JSON.parse(localStorage.getItem("setlist_admin_database_v03") || "null");
      return Array.isArray(database?.events) ? database.events : [];
    } catch (_error) {
      return [];
    }
  }

  async function loadEvents() {
    const manifest = await fetchJson("./data/index.json");
    const entries = Array.isArray(manifest?.events) ? manifest.events : [];
    const loaded = await Promise.all(
      entries.map(async (entry) => {
        if (typeof entry === "object") return normalizeLoadedEvents(entry);
        const file = text(entry).replace(/^\.\//, "");
        return normalizeLoadedEvents(await fetchJson(`./data/${file}`)).map((event) => ({
          ...event,
          __dataPath: file
        }));
      })
    );
    const merged = new Map();
    loaded.flat().forEach((event) => {
      if (event?.id && event?.title) merged.set(event.id, event);
    });
    localAdminEvents().forEach((event) => {
      if (!event?.id || !event?.title) return;
      const published = merged.get(event.id);
      merged.set(event.id, { ...event, __dataPath: published?.__dataPath || "" });
    });
    state.events = [...merged.values()];
    state.events.sort((a, b) => latestDate(b).localeCompare(latestDate(a), "ja"));
    renderStats();
    renderFilters();
    renderCatalog();
    renderRoute();
  }

  function renderStats() {
    $("#event-count").textContent = String(state.events.length);
    $("#performance-count").textContent = String(
      state.events.reduce((total, event) => total + eventPerformances(event).length, 0)
    );
  }

  function availableSeries() {
    return [...new Set(state.events.flatMap(eventSeries))].sort((a, b) => {
      const knownOrder = Object.keys(SERIES);
      const aIndex = knownOrder.indexOf(a);
      const bIndex = knownOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, "ja");
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  function renderFilters() {
    const container = $("#series-filters");
    container.replaceChildren();
    const filters = [{ id: "all", label: "すべて" }, ...availableSeries().map((id) => ({ id, label: seriesInfo(id).label }))];
    filters.forEach((filter) => {
      const button = createElement("button", `filter-chip${state.series === filter.id ? " active" : ""}`, filter.label);
      button.type = "button";
      button.dataset.series = filter.id;
      button.setAttribute("aria-pressed", String(state.series === filter.id));
      button.addEventListener("click", () => {
        state.series = filter.id;
        renderFilters();
        renderCatalog();
      });
      container.append(button);
    });
  }

  function filteredEvents() {
    const query = normalizeSearch(state.query);
    return state.events.filter((event) => {
      if (state.series !== "all" && !eventSeries(event).includes(state.series)) return false;
      if (state.numberedOnly && !isNumberedLive(event)) return false;
      if (!query) return true;
      const searchable = normalizeSearch([
        event.title,
        ...eventSeries(event).map((id) => seriesInfo(id).label),
        ...eventPerformances(event).flatMap((performance) => [performance?.label, performance?.venue?.name, performance?.venue?.city])
      ].join(" "));
      return searchable.includes(query);
    });
  }

  function eventCard(event) {
    const card = createElement("article", "event-card");
    const primarySeries = seriesInfo(eventSeries(event)[0]);
    card.style.setProperty("--card-accent", primarySeries.color);
    const link = createElement("a");
    link.href = `#/event/${encodeURIComponent(event.id)}`;
    link.setAttribute("aria-label", `${event.title}のセットリストを見る`);

    const series = createElement("p", "event-card-series", eventSeries(event).map((id) => seriesInfo(id).label).join(" / ") || "OTHER");
    const titleElement = createElement("h3", "", event.title);
    const meta = createElement("div", "event-card-meta");
    const date = createElement("span");
    date.append(createElement("b", "", "DATE"), document.createTextNode(eventDateRange(event)));
    const venues = [...new Set(eventPerformances(event).map((item) => item?.venue?.name).filter(Boolean))];
    const venue = createElement("span");
    venue.append(createElement("b", "", "VENUE"), document.createTextNode(venues.join(" / ") || "会場未登録"));
    meta.append(date, venue);

    const bottom = createElement("div", "event-card-bottom");
    const performances = eventPerformances(event).length;
    bottom.append(
      createElement("strong", "", `${performances}公演・全${eventSongCount(event)}曲`),
      createElement("i", "", "→")
    );
    link.append(series, titleElement, meta, bottom);
    card.append(link);
    return card;
  }

  function renderCatalog() {
    const events = filteredEvents();
    const grid = $("#event-grid");
    grid.replaceChildren(...events.map(eventCard));
    $("#result-summary").textContent = `${events.length}件の公演`;
    $("#event-empty").classList.toggle("hidden", events.length > 0);
  }

  function routeParts() {
    const hash = location.hash || "#/";
    if (!hash.startsWith("#/")) return { view: "catalog", anchor: hash.slice(1) };
    const parts = hash.slice(2).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] === "event" && parts[1]) return { view: "event", id: parts[1] };
    return { view: "catalog", anchor: "" };
  }

  function renderRoute() {
    const route = routeParts();
    if (route.view === "event") {
      const event = state.events.find((item) => item.id === route.id);
      if (!event) {
        if (state.events.length) showToast("指定された公演が見つかりません。", "error");
        showCatalog();
        return;
      }
      const eventChanged = state.selectedEvent?.id !== event.id;
      state.selectedEvent = event;
      state.performanceIndex = eventChanged
        ? 0
        : Math.min(state.performanceIndex, Math.max(0, eventPerformances(event).length - 1));
      renderDetail();
      showDetail();
      return;
    }
    showCatalog();
    if (route.anchor) requestAnimationFrame(() => document.getElementById(route.anchor)?.scrollIntoView());
  }

  function showCatalog() {
    $("#catalog-view").classList.remove("hidden");
    $("#detail-view").classList.add("hidden");
    state.selectedEvent = null;
    document.title = "Setlist Playlists";
  }

  function showDetail() {
    $("#catalog-view").classList.add("hidden");
    $("#detail-view").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderDetail() {
    const event = state.selectedEvent;
    const performances = eventPerformances(event);
    const performance = performances[state.performanceIndex];
    const primarySeries = eventSeries(event).map((id) => seriesInfo(id).label).join(" / ");
    $("#detail-series").textContent = primarySeries || "OTHER";
    $("#detail-title").textContent = event.title;
    $("#detail-total-count").textContent = String(eventSongCount(event));
    document.title = `${event.title} | Setlist Playlists`;

    const source = Array.isArray(event.sources) ? event.sources.find((item) => item?.url) : null;
    const sourceLink = $("#detail-source");
    sourceLink.classList.toggle("hidden", !source);
    if (source) {
      sourceLink.href = source.url;
      sourceLink.textContent = `${source.name || "情報元"}を見る ↗`;
    }

    renderPerformanceTabs(performances);
    renderPerformance(performance);
  }

  function renderPerformanceTabs(performances) {
    const tabs = $("#performance-tabs");
    const select = $("#performance-select");
    tabs.replaceChildren();
    select.replaceChildren();
    performances.forEach((performance, index) => {
      const label = performanceLabel(performance, index);
      const tab = createElement("button", "performance-tab", label);
      tab.type = "button";
      tab.role = "tab";
      tab.setAttribute("aria-selected", String(index === state.performanceIndex));
      tab.addEventListener("click", () => {
        state.performanceIndex = index;
        renderDetail();
      });
      tabs.append(tab);

      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = label;
      option.selected = index === state.performanceIndex;
      select.append(option);
    });
    syncPerformanceTabsHeight();
  }

  function syncPerformanceTabsHeight() {
    window.requestAnimationFrame(() => {
      const tabs = $("#performance-tabs");
      const shouldOffsetPlaylist = window.matchMedia("(min-width: 961px)").matches &&
        window.getComputedStyle(tabs).display !== "none";
      const height = shouldOffsetPlaylist ? Math.ceil(tabs.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty("--performance-tabs-height", `${height}px`);
    });
  }

  function renderPerformance(performance) {
    const setlist = songs(performance);
    $("#performance-date").textContent = formatDate(performance?.date);
    $("#performance-venue").textContent = [performance?.venue?.name, performance?.venue?.city].filter(Boolean).join(" / ") || "会場未登録";
    $("#track-count").textContent = `${setlist.length}曲`;

    const list = $("#setlist-body");
    const pendingArtworkLoads = [];
    list.replaceChildren(...setlist.map((item, index) => {
      const row = createElement("li", "setlist-item");
      const marker = createElement("span", "setlist-marker", item?.marker || `M${String(index + 1).padStart(2, "0")}`);
      const titleWrap = createElement("div", "setlist-title");
      const recording = item?.recording || {};
      const title = recording.displayTitle || recording.baseTitle || item?.title || "曲名未登録";
      titleWrap.append(createElement("strong", "", title));
      if (item?.artistHint) titleWrap.append(createElement("span", "", item.artistHint));
      const artwork = createSetlistArtwork(item, title, pendingArtworkLoads);
      const available = validSpotifyUri(item);
      const match = createElement(
        "span",
        `spotify-match${available ? "" : " unavailable"}`,
        spotifyAvailabilityLabel(item)
      );
      row.append(marker, artwork, titleWrap, match);
      return row;
    }));
    hydrateSetlistArtwork(pendingArtworkLoads);
    renderPlaylistPanel(performance);
  }

  function renderPlaylistPanel(performance) {
    const setlist = songs(performance);
    const available = setlist.filter(validSpotifyUri);
    const unavailable = setlist.filter(isSpotifyUnavailable);
    const unregistered = setlist.length - available.length - unavailable.length;
    $("#playlist-available-count").textContent = `${available.length} / ${setlist.length}曲`;

    const note = $("#playlist-note");
    if (!available.length) {
      if (unavailable.length && !unregistered) {
        note.textContent = "この公演の曲はSpotifyで未配信です。";
      } else {
        note.textContent = "この公演にはSpotifyへ追加できる曲がまだ登録されていません。";
      }
    } else if (unavailable.length || unregistered) {
      const excluded = [
        unavailable.length ? `未配信の${unavailable.length}曲` : "",
        unregistered ? `未登録の${unregistered}曲` : ""
      ].filter(Boolean).join("と");
      note.textContent = `${available.length}曲を曲順どおり追加します。${excluded}は除外されます。`;
    } else {
      note.textContent = `全${available.length}曲をセットリストの曲順どおり追加します。`;
    }

    const button = $("#create-playlist-button");
    const transferButton = $("#soundiiz-transfer-button");
    const published = Boolean(state.selectedEvent?.__dataPath && performance?.id);
    const apiConfigured = Boolean(window.PublicPlaylistClient?.isConfigured?.());
    button.disabled = !available.length || !published || !apiConfigured || state.creatingPlaylist || state.creatingTransfer;
    button.textContent = state.creatingPlaylist
      ? "作成しています…"
      : (!published
        ? "GitHub公開後に作成できます"
        : (!apiConfigured ? "プレイリスト作成機能は準備中" : "Spotifyで作成して開く"));
    transferButton.disabled = !available.length || !published || !apiConfigured || state.creatingPlaylist || state.creatingTransfer;
    transferButton.textContent = state.creatingTransfer
      ? "準備しています…"
      : "Apple Music / Amazon Musicで作成して開く";
    $("#playlist-result").classList.add("hidden");
  }

  async function createPlaylist() {
    const event = state.selectedEvent;
    const performance = eventPerformances(event)[state.performanceIndex];
    const setlist = songs(performance);
    const uris = setlist.filter(validSpotifyUri).map((item) => item.spotify.uri);
    if (!uris.length || state.creatingPlaylist || state.creatingTransfer) return;

    state.creatingPlaylist = true;
    renderPlaylistPanel(performance);
    try {
      if (!window.PublicPlaylistClient) throw new Error("プレイリスト作成機能を読み込めませんでした。");
      const playlist = await window.PublicPlaylistClient.requestPlaylist({
        eventPath: event.__dataPath,
        performanceId: performance.id
      });
      const result = $("#playlist-result");
      const action = playlist.created ? "作成しました" : "用意されています";
      result.replaceChildren(document.createTextNode(`${playlist.trackCount || uris.length}曲のプレイリストが${action}。 `));
      const link = createElement("a", "", "Spotifyで開く ↗");
      link.href = playlist.playlistUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      result.append(link);
      result.classList.remove("hidden");
      showToast(playlist.created ? "共有プレイリストを作成しました。" : "作成済みのプレイリストを開けます。");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      state.creatingPlaylist = false;
      const button = $("#create-playlist-button");
      button.disabled = false;
      button.textContent = "Spotifyで作成して開く";
    }
  }

  async function openSoundiizTransfer() {
    const event = state.selectedEvent;
    const performance = eventPerformances(event)[state.performanceIndex];
    const available = songs(performance).filter(validSpotifyUri);
    if (!available.length || !event?.__dataPath || !performance?.id ||
        state.creatingPlaylist || state.creatingTransfer) return;

    const button = $("#soundiiz-transfer-button");
    state.creatingTransfer = true;
    button.disabled = true;
    button.textContent = "準備しています…";
    try {
      if (!window.PublicPlaylistClient) throw new Error("移行機能を読み込めませんでした。");
      const transfer = await window.PublicPlaylistClient.requestSoundiizTransfer({
        eventPath: event.__dataPath,
        performanceId: performance.id
      });
      showToast(`${transfer.trackCount || available.length}曲のプレイリストを準備しました。`);
      window.location.assign(transfer.shareUrl);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      state.creatingTransfer = false;
      button.disabled = false;
      button.textContent = "Apple Music / Amazon Musicで作成して開く";
    }
  }

  function bindEvents() {
    $("#event-search").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderCatalog();
    });
    $("#numbered-live-only").addEventListener("change", (event) => {
      state.numberedOnly = event.target.checked;
      renderCatalog();
    });
    $("#create-playlist-button").addEventListener("click", () => {
      createPlaylist().catch((error) => showToast(error.message, "error"));
    });
    $("#soundiiz-transfer-button").addEventListener("click", () => {
      openSoundiizTransfer().catch((error) => showToast(error.message, "error"));
    });
    $("#performance-select").addEventListener("change", (event) => {
      const index = Number.parseInt(event.target.value, 10);
      const performances = eventPerformances(state.selectedEvent);
      if (!Number.isInteger(index) || !performances[index] || index === state.performanceIndex) return;
      state.performanceIndex = index;
      renderDetail();
    });
    window.addEventListener("resize", syncPerformanceTabsHeight);
    window.addEventListener("hashchange", renderRoute);
  }

  async function start() {
    bindEvents();
    try {
      await loadEvents();
    } catch (error) {
      $("#result-summary").textContent = "公演データを読み込めませんでした";
      $("#event-empty").classList.remove("hidden");
      $("#event-empty h3").textContent = "公演データの読込に失敗しました";
      $("#event-empty p").textContent = error.message;
      showToast(error.message, "error");
    }
  }

  return {
    start,
    formatDate,
    eventDateRange,
    normalizeSearch,
    isNumberedLive,
    isSpotifyUnavailable,
    validSpotifyUri,
    spotifyAvailabilityLabel,
    spotifyTrackId,
    spotifyArtworkUrl,
    fetchSpotifyArtwork,
    normalizeLoadedEvents
  };
});
