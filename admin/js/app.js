
(() => {
  "use strict";

  // Admin application state and editors.

  const STORAGE_KEY = "setlist_admin_database_v03";
  const SELECTED_KEY = "setlist_admin_selected_event_v03";
  const CONFIRMED_SPOTIFY_KEY = "setlist_confirmed_spotify_mappings_v01";

  const state = {
    database: { schemaVersion: "0.3", events: [] },
    selectedEventId: null,
    editingPerformanceIndex: null,
    draftSetlist: [],
    importDraft: null,
    importPerformanceIndex: 0,
    spotifyManualRow: null,
    spotifyManualContext: null,
    spotifyReviewActive: false,
    spotifyReviewQueue: [],
    spotifyReviewPosition: -1,
    spotifySearchRequestId: 0,
    llfansSyncCatalog: [],
    llfansSyncSelectedIds: new Set(),
    llfansSyncQueue: [],
    llfansSyncPosition: -1,
    llfansSyncActive: false,
    llfansSyncResults: [],
    githubPublishStatus: null,
    githubPublishing: false,
    dirty: false
  };

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    saveState: $("#save-state"),
    eventList: $("#event-list"),
    emptyState: $("#empty-state"),
    editor: $("#editor"),
    eventId: $("#event-id"),
    eventTitle: $("#event-title"),
    eventSeries: $("#event-series"),
    sourceName: $("#source-name"),
    sourceUrl: $("#source-url"),
    eventErrors: $("#event-errors"),
    performanceSummary: $("#performance-summary"),
    performanceList: $("#performance-list"),
    importFile: $("#import-file"),
    llfansSyncDialog: $("#llfans-sync-dialog"),
    llfansSyncSearch: $("#llfans-sync-search"),
    llfansSyncSeries: $("#llfans-sync-series"),
    llfansSyncSummary: $("#llfans-sync-summary"),
    llfansSyncList: $("#llfans-sync-list"),
    llfansSyncProgress: $("#llfans-sync-progress"),
    llfansSyncErrors: $("#llfans-sync-errors"),
    startLlFansSyncButton: $("#start-llfans-sync-button"),
    refreshLlFansSyncButton: $("#refresh-llfans-sync-button"),
    toggleLlFansSyncVisibleButton: $("#toggle-llfans-sync-visible-button"),
    pageImportDialog: $("#page-import-dialog"),
    pageImportUrl: $("#page-import-url"),
    pageImportText: $("#page-import-text"),
    pageImportPreview: $("#page-import-preview"),
    pageImportSummary: $("#page-import-summary"),
    pageImportDestination: $("#page-import-destination"),
    pageImportDestinationHelp: $("#page-import-destination-help"),
    pageImportEventFields: $("#page-import-event-fields"),
    pageImportPerformanceSwitcher: $("#page-import-performance-switcher"),
    pageImportPerformanceSelector: $("#page-import-performance-selector"),
    pageImportPerformanceCounter: $("#page-import-performance-counter"),
    pageImportEventId: $("#page-import-event-id"),
    pageImportEventTitle: $("#page-import-event-title"),
    pageImportSeries: $("#page-import-series"),
    pageImportSourceName: $("#page-import-source-name"),
    pageImportSourceUrl: $("#page-import-source-url"),
    pageImportPerformanceId: $("#page-import-performance-id"),
    pageImportPerformanceLabel: $("#page-import-performance-label"),
    pageImportPerformanceDay: $("#page-import-performance-day"),
    pageImportPerformanceSession: $("#page-import-performance-session"),
    pageImportPerformanceDate: $("#page-import-performance-date"),
    pageImportVenueCountry: $("#page-import-venue-country"),
    pageImportVenueName: $("#page-import-venue-name"),
    pageImportVenueCity: $("#page-import-venue-city"),
    pageImportSetlistRows: $("#page-import-setlist-rows"),
    pageImportWarnings: $("#page-import-warnings"),
    pageImportErrors: $("#page-import-errors"),
    savePageImportButton: $("#save-page-import-button"),
    parsePageImportUrlButton: $("#parse-page-import-url-button"),
    parsePageImportButton: $("#parse-page-import-button"),
    spotifyAccount: $("#spotify-account"),
    spotifyConnectButton: $("#spotify-connect-button"),
    spotifyEnrichButton: $("#spotify-enrich-button"),
    spotifyMatchSummary: $("#spotify-match-summary"),
    spotifyCandidateDialog: $("#spotify-candidate-dialog"),
    spotifyCandidateDialogTitle: $("#spotify-candidate-dialog-title"),
    spotifyCandidateSong: $("#spotify-candidate-song"),
    spotifyCandidateSummary: $("#spotify-candidate-summary"),
    spotifyCandidateList: $("#spotify-candidate-list"),
    spotifyManualQuery: $("#spotify-manual-query"),
    spotifyManualSearchButton: $("#spotify-manual-search-button"),
    spotifyReviewProgress: $("#spotify-review-progress"),
    spotifyUnavailableButton: $("#mark-unavailable-spotify-candidate-button"),
    spotifyCancelCandidateButton: $("#cancel-spotify-candidate-button"),
    spotifyResearchAllButton: $("#spotify-research-all-button"),
    editorSpotifySummary: $("#editor-spotify-summary"),
    githubPublishState: $("#github-publish-state"),
    publishGithubButton: $("#publish-github-button"),
    performanceDialog: $("#performance-dialog"),
    performanceDialogTitle: $("#performance-dialog-title"),
    performanceId: $("#performance-id"),
    performanceLabel: $("#performance-label"),
    performanceDay: $("#performance-day"),
    performanceSession: $("#performance-session"),
    performanceDate: $("#performance-date"),
    venueCountry: $("#venue-country"),
    venueName: $("#venue-name"),
    venueCity: $("#venue-city"),
    setlistPaste: $("#setlist-paste"),
    replaceSetlist: $("#replace-setlist"),
    setlistRows: $("#setlist-rows"),
    setlistEmpty: $("#setlist-empty"),
    performanceErrors: $("#performance-errors")
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readConfirmedSpotifyMappings() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIRMED_SPOTIFY_KEY) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (_error) {
      return {};
    }
  }

  function mappingTrack(mapping) {
    if (!mapping?.trackId && !mapping?.uri) return null;
    const artworkUrl = String(mapping.artworkUrl || "").trim();
    const albumName = String(mapping.albumName || "").trim();
    return {
      id: mapping.trackId || null,
      uri: mapping.uri || null,
      name: mapping.matchedTitle || mapping.title || "",
      artists: mapping.matchedArtist ? [{ name: mapping.matchedArtist }] : [],
      album: artworkUrl || albumName
        ? {
            name: albumName,
            images: artworkUrl ? [{ url: artworkUrl }] : []
          }
        : null
    };
  }

  function rememberConfirmedSpotifyMapping(title, version, track) {
    const normalizedTitle = window.KnownSongCache.normalizeComparable(title);
    if (!normalizedTitle || (!track?.id && !track?.uri)) return;
    const mappings = readConfirmedSpotifyMappings();
    const key = window.KnownSongCache.songKey(title, version);
    mappings[key] = {
      title: String(title || "").trim(),
      version: String(version || "").trim(),
      normalizedTitle,
      trackId: track.id || null,
      uri: track.uri || null,
      matchedTitle: track.name || String(title || "").trim(),
      matchedArtist: spotifyTrackArtist(track),
      artworkUrl: spotifyTrackArtwork(track),
      albumName: track.album?.name || "",
      confirmedAt: new Date().toISOString()
    };
    localStorage.setItem(CONFIRMED_SPOTIFY_KEY, JSON.stringify(mappings));
  }

  function findConfirmedSpotifyMapping(title, version) {
    const mappings = readConfirmedSpotifyMappings();
    const exact = mappings[window.KnownSongCache.songKey(title, version)];
    if (mappingTrack(exact)) {
      return { track: mappingTrack(exact), exact: true };
    }

    const normalizedTitle = window.KnownSongCache.normalizeComparable(title);
    const sameTitle = Object.values(mappings).filter(
      (mapping) => mapping?.normalizedTitle === normalizedTitle && mappingTrack(mapping)
    );
    const identities = new Set(
      sameTitle.map((mapping) => mapping.trackId || mapping.uri).filter(Boolean)
    );
    if (sameTitle.length && identities.size === 1) {
      return { track: mappingTrack(sameTitle[0]), exact: false };
    }
    return null;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function asciiSlug(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function stableSlug(value, prefix = "item") {
    return asciiSlug(value) || `${prefix}-${hashString(value)}`;
  }

  function versionCode(label) {
    const source = String(label ?? "").trim();
    if (!source) return "original";
    const compact = source.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    const known = [
      [/104期newver\.?/i, "104ki-new"],
      [/104期ver\.?/i, "104ki"],
      [/105期newver\.?/i, "105ki-new"],
      [/105期ver\.?/i, "105ki"],
      [/106期newver\.?/i, "106ki-new"],
      [/106期ver\.?/i, "106ki"],
      [/dollchestraver\.?/i, "dollchestra"],
      [/スリーズブーケver\.?/i, "cerise-bouquet"],
      [/みらくらぱーく！?ver\.?/i, "mira-cra-park"],
      [/12人ver\.?/i, "12-member"],
      [/tvsize/i, "tv-size"],
      [/b\.?g\.?p\.?ver\.?/i, "bgp"]
    ];
    for (const [pattern, code] of known) {
      if (pattern.test(compact)) return code;
    }
    return asciiSlug(source) || `custom-${hashString(source)}`;
  }

  function recordingFromFields(title, version) {
    const baseTitle = String(title ?? "").trim();
    const versionLabel = String(version ?? "").trim() || null;
    const code = versionCode(versionLabel);
    return {
      baseTitle,
      versionLabel,
      versionCode: code,
      recordingId: `${stableSlug(baseTitle, "track")}__${code}`,
      displayTitle: versionLabel ? `${baseTitle}（${versionLabel}）` : baseTitle
    };
  }

  function matchPolicyForVersion(version) {
    const normalizedVersion = String(version ?? "").normalize("NFKC").trim();
    return normalizedVersion && !/^\d{3}期(?:new)?\s*ver/i.test(normalizedVersion)
      ? "original_fallback"
      : "exact";
  }

  function blankEvent() {
    const suffix = Date.now().toString(36);
    return {
      schemaVersion: "0.3",
      id: `new-event-${suffix}`,
      title: "新しいイベント",
      series: [],
      sources: [],
      performances: []
    };
  }

  function blankSong(index = 0) {
    return {
      order: index + 1,
      marker: `M${String(index + 1).padStart(2, "0")}`,
      type: "song",
      recording: recordingFromFields("", ""),
      artistHint: "",
      spotifyMatchPolicy: "exact",
      spotify: {
        status: "unmatched",
        trackId: null,
        uri: null,
        matchedTitle: null,
        matchedArtist: null
      }
    };
  }

  function blankPerformance() {
    const suffix = Date.now().toString(36);
    return {
      id: `performance-${suffix}`,
      label: "",
      day: null,
      session: null,
      date: "",
      venue: {
        name: "",
        city: "",
        countryCode: "JP"
      },
      setlist: [],
      spotifyPlaylist: {
        status: "not_created",
        playlistId: null,
        url: null
      }
    };
  }

  function normalizeEvent(raw) {
    const event = deepClone(raw);
    event.schemaVersion = "0.3";
    event.id = String(event.id || `event-${Date.now().toString(36)}`);
    event.title = String(event.title || "名称未設定");
    event.series = Array.isArray(event.series) ? event.series : [];
    event.sources = Array.isArray(event.sources) ? event.sources : [];
    event.performances = Array.isArray(event.performances) ? event.performances : [];

    event.performances = event.performances.map((performance, performanceIndex) => {
      const normalized = {
        id: String(performance.id || `performance-${performanceIndex + 1}`),
        label: String(performance.label || `公演 ${performanceIndex + 1}`),
        day: Number.isInteger(performance.day) ? performance.day : null,
        session: performance.session || null,
        date: performance.date || "",
        venue: {
          name: performance.venue?.name || "",
          city: performance.venue?.city || "",
          countryCode: performance.venue?.countryCode || "JP"
        },
        setlist: Array.isArray(performance.setlist) ? performance.setlist : [],
        spotifyPlaylist: performance.spotifyPlaylist || {
          status: "not_created",
          playlistId: null,
          url: null
        }
      };

      normalized.setlist = normalized.setlist.map((item, itemIndex) => {
        const baseTitle = item.recording?.baseTitle || item.title || "";
        const versionLabel = item.recording?.versionLabel || item.version || "";
        return {
          order: itemIndex + 1,
          marker: item.marker || `M${String(itemIndex + 1).padStart(2, "0")}`,
          type: "song",
          recording: {
            ...recordingFromFields(baseTitle, versionLabel),
            ...(item.recording || {})
          },
          artistHint: item.artistHint || "",
          spotifyMatchPolicy: item.spotifyMatchPolicy || "exact",
          spotify: item.spotify || {
            status: "unmatched",
            trackId: null,
            uri: null,
            matchedTitle: null,
            matchedArtist: null
          }
        };
      });
      return normalized;
    });
    return event;
  }

  async function load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        state.database = {
          schemaVersion: "0.3",
          events: (parsed.events || []).map(normalizeEvent)
        };
      } catch (error) {
        console.error("Saved data is invalid", error);
      }
    }

    const preferred = localStorage.getItem(SELECTED_KEY);
    state.selectedEventId = state.database.events.some((event) => event.id === preferred)
      ? preferred
      : state.database.events[0]?.id ?? null;

    render();
    setSaveState("saved");
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.database));
    if (state.selectedEventId) localStorage.setItem(SELECTED_KEY, state.selectedEventId);
    state.dirty = false;
    setSaveState("saved");
  }

  function setDirty() {
    state.dirty = true;
    if (state.githubPublishStatus) {
      state.githubPublishStatus.publishedEventId = "";
      state.githubPublishStatus.publishedRevision = "";
    }
    setSaveState("dirty");
    updateGitHubPublishUi();
  }

  function setSaveState(mode) {
    elements.saveState.classList.remove("dirty", "saved");
    if (mode === "dirty") {
      elements.saveState.textContent = "未保存の変更あり";
      elements.saveState.classList.add("dirty");
    } else if (mode === "saved") {
      elements.saveState.textContent = "ブラウザに保存済み";
      elements.saveState.classList.add("saved");
    } else {
      elements.saveState.textContent = mode;
    }
  }

  function selectedEvent() {
    return state.database.events.find((event) => event.id === state.selectedEventId) || null;
  }

  function render() {
    renderEventList();
    renderEditor();
    updateGitHubPublishUi();
  }

  function renderEventList() {
    elements.eventList.replaceChildren();
    for (const event of state.database.events) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `event-item${event.id === state.selectedEventId ? " active" : ""}`;
      const count = event.performances.length;
      button.innerHTML = `
        <span class="event-item-title">${escapeHtml(event.title)}</span>
        <span class="event-item-meta">${escapeHtml(event.id)} / ${count}公演</span>
      `;
      button.addEventListener("click", () => {
        readEventFormIntoState(false);
        state.selectedEventId = event.id;
        localStorage.setItem(SELECTED_KEY, event.id);
        render();
      });
      elements.eventList.append(button);
    }
  }

  function renderEditor() {
    const event = selectedEvent();
    elements.emptyState.classList.toggle("hidden", Boolean(event));
    elements.editor.classList.toggle("hidden", !event);
    if (!event) return;

    elements.eventId.value = event.id;
    elements.eventTitle.value = event.title;
    elements.eventSeries.value = event.series.join(", ");
    elements.sourceName.value = event.sources[0]?.name || "";
    elements.sourceUrl.value = event.sources[0]?.url || "";
    hideValidation(elements.eventErrors);
    renderPerformanceList(event);
  }

  function renderPerformanceList(event) {
    elements.performanceSummary.textContent =
      `${event.performances.length}公演 / ${event.performances.reduce((sum, p) => sum + p.setlist.length, 0)}曲`;
    elements.performanceList.replaceChildren();

    if (!event.performances.length) {
      const empty = document.createElement("div");
      empty.className = "table-empty";
      empty.textContent = "公演がまだありません。右上の「公演を追加」から登録します。";
      elements.performanceList.append(empty);
      return;
    }

    const template = $("#performance-card-template");
    event.performances.forEach((performance, index) => {
      const fragment = template.content.cloneNode(true);
      fragment.querySelector(".performance-label").textContent = performance.label;
      const date = performance.date || "日付未設定";
      const venue = performance.venue.name || "会場未設定";
      fragment.querySelector(".performance-meta").textContent = `${date} / ${venue}`;
      fragment.querySelector(".performance-tracks").textContent =
        `${performance.setlist.length}曲 / ID: ${performance.id}`;

      fragment.querySelector(".edit-performance").addEventListener("click", () => openPerformance(index));
      fragment.querySelector(".duplicate-performance").addEventListener("click", () => duplicatePerformance(index));
      fragment.querySelector(".delete-performance").addEventListener("click", () => deletePerformance(index));
      elements.performanceList.append(fragment);
    });
  }

  function readEventFormIntoState(markDirty = true) {
    const event = selectedEvent();
    if (!event) return;
    event.id = elements.eventId.value.trim();
    event.title = elements.eventTitle.value.trim();
    event.series = elements.eventSeries.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const sourceName = elements.sourceName.value.trim();
    const sourceUrl = elements.sourceUrl.value.trim();
    const referenceSources = (event.sources || []).filter(
      (source) => source?.priority === "reference"
    );
    const primarySources = sourceName || sourceUrl
      ? [{
          type: sourceUrl.includes("x.com") ? "x" : "web",
          name: sourceName || "Source",
          url: sourceUrl,
          priority: "primary"
        }]
      : [];
    event.sources = [
      ...primarySources,
      ...referenceSources.filter(
        (source) => source.url && source.url !== sourceUrl
      )
    ];
    if (markDirty) setDirty();
  }

  function validateEvent(event) {
    const errors = [];
    if (!event.id) errors.push("イベントIDは必須です。");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(event.id)) {
      errors.push("イベントIDは半角英小文字・数字・ハイフン・アンダースコアで入力してください。");
    }
    if (!event.title) errors.push("正式公演名は必須です。");
    const duplicate = state.database.events.find(
      (candidate) => candidate !== event && candidate.id === event.id
    );
    if (duplicate) errors.push(`イベントID「${event.id}」は既に使われています。`);
    return errors;
  }

  function saveEvent() {
    readEventFormIntoState(false);
    const event = selectedEvent();
    const errors = validateEvent(event);
    if (errors.length) {
      showValidation(elements.eventErrors, errors);
      return;
    }
    hideValidation(elements.eventErrors);
    state.selectedEventId = event.id;
    persist();
    render();
  }

  function newEvent() {
    readEventFormIntoState(false);
    const event = blankEvent();
    state.database.events.push(event);
    state.selectedEventId = event.id;
    setDirty();
    render();
    elements.eventTitle.focus();
  }

  function duplicateEvent() {
    readEventFormIntoState(false);
    const event = selectedEvent();
    if (!event) return;
    const copy = deepClone(event);
    copy.id = `${event.id}-copy-${Date.now().toString(36)}`;
    copy.title = `${event.title} コピー`;
    copy.performances.forEach((performance, index) => {
      performance.id = `${performance.id}-copy-${index + 1}`;
    });
    state.database.events.push(copy);
    state.selectedEventId = copy.id;
    setDirty();
    render();
  }

  function deleteEvent() {
    const event = selectedEvent();
    if (!event) return;
    if (!confirm(`「${event.title}」を削除しますか？`)) return;
    const index = state.database.events.indexOf(event);
    state.database.events.splice(index, 1);
    state.selectedEventId = state.database.events[Math.max(0, index - 1)]?.id || null;
    persist();
    render();
  }

  function uniqueId(baseValue, usedIds) {
    const base = String(baseValue || "item").trim();
    if (!usedIds.has(base)) return base;
    let suffix = 2;
    while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  function normalizeImportDraft(parsed) {
    const rawPerformances = Array.isArray(parsed?.performances)
      ? parsed.performances
      : parsed?.performance
        ? [{ ...parsed.performance, setlist: parsed.setlist || [] }]
        : [];
    return {
      event: parsed?.event || { idSuggestion: "", title: "", series: [], source: null },
      performances: rawPerformances.map((performance) => ({
        id: performance.id || performance.idSuggestion || "",
        idSuggestion: performance.idSuggestion || performance.id || "",
        label: performance.label || "",
        day: performance.day ?? null,
        session: performance.session ?? null,
        date: performance.date || "",
        venue: {
          name: performance.venue?.name || "",
          city: performance.venue?.city || "",
          countryCode: performance.venue?.countryCode || "JP"
        },
        setlist: (performance.setlist || []).map((item) => ({
          marker: item.marker || "",
          title: item.title || "",
          version: item.version || "",
          artistHint: item.artistHint || "",
          spotifyUiStatus: item.spotifyUiStatus || "idle",
          spotifyStatusLabel: item.spotifyStatusLabel || "未検索",
          spotifySource: item.spotifySource || "",
          spotifyTrack: item.spotifyTrack || null,
          spotifyResults: item.spotifyResults || [],
          artistAutoFilled: item.artistAutoFilled || ""
        }))
      })),
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
      sourcePage: parsed?.sourcePage || ""
    };
  }

  function activeImportPerformance() {
    return state.importDraft?.performances?.[state.importPerformanceIndex] || null;
  }

  function importSongCount() {
    return (state.importDraft?.performances || []).reduce(
      (sum, performance) => sum + performance.setlist.length,
      0
    );
  }

  function populatePageImportPerformanceSelector() {
    const performances = state.importDraft?.performances || [];
    elements.pageImportPerformanceSelector.replaceChildren();
    performances.forEach((performance, index) => {
      elements.pageImportPerformanceSelector.append(
        new Option(
          `${index + 1}. ${performance.label || "表示名未取得"}（${performance.setlist.length}曲）`,
          String(index)
        )
      );
    });
    elements.pageImportPerformanceSelector.value = String(state.importPerformanceIndex);
    elements.pageImportPerformanceSwitcher.classList.toggle("hidden", performances.length <= 1);
    elements.pageImportPerformanceCounter.textContent = performances.length
      ? `${state.importPerformanceIndex + 1}/${performances.length}公演を確認中`
      : "";
  }

  function syncActiveImportPerformance() {
    const performance = activeImportPerformance();
    if (!performance) return;
    performance.id = elements.pageImportPerformanceId.value.trim();
    performance.label = elements.pageImportPerformanceLabel.value.trim();
    const dayValue = elements.pageImportPerformanceDay.value.trim();
    performance.day = dayValue ? Number(dayValue) : null;
    performance.session = elements.pageImportPerformanceSession.value || null;
    performance.date = elements.pageImportPerformanceDate.value;
    performance.venue = {
      name: elements.pageImportVenueName.value.trim(),
      city: elements.pageImportVenueCity.value.trim(),
      countryCode: elements.pageImportVenueCountry.value.trim().toUpperCase() || "JP"
    };
    performance.setlist = importSetlistDraftFromRows();
  }

  function renderActiveImportPerformance({ applyKnownSongs = true } = {}) {
    const performance = activeImportPerformance();
    if (!performance) return { tracks: 0, artists: 0, conflicts: 0 };

    elements.pageImportPerformanceId.value = performance.id || performance.idSuggestion || "";
    elements.pageImportPerformanceLabel.value = performance.label;
    elements.pageImportPerformanceDay.value = performance.day ?? "";
    elements.pageImportPerformanceSession.value = performance.session ?? "";
    elements.pageImportPerformanceDate.value = performance.date;
    elements.pageImportVenueCountry.value = performance.venue.countryCode || "JP";
    elements.pageImportVenueName.value = performance.venue.name;
    elements.pageImportVenueCity.value = performance.venue.city;
    populatePageImportPerformanceSelector();
    renderPageImportSetlist();
    const knownCounts = applyKnownSongs
      ? applyKnownSongsFromDatabase()
      : { tracks: 0, artists: 0, conflicts: 0 };
    syncActiveImportPerformance();
    return knownCounts;
  }

  function selectImportPerformance(index, { syncCurrent = true, applyKnownSongs = true } = {}) {
    if (syncCurrent) syncActiveImportPerformance();
    const performances = state.importDraft?.performances || [];
    state.importPerformanceIndex = Math.max(0, Math.min(Number(index) || 0, performances.length - 1));
    return renderActiveImportPerformance({ applyKnownSongs });
  }

  function populatePageImportDestinations() {
    elements.pageImportDestination.replaceChildren();
    elements.pageImportDestination.append(new Option("新しいイベントとして追加", "__new__"));
    for (const event of state.database.events) {
      elements.pageImportDestination.append(
        new Option(`既存: ${event.title}`, event.id)
      );
    }
  }

  function normalizedEventTitle(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function llFansSourceId(event) {
    for (const source of event?.sources || []) {
      const match = String(source?.url || "").match(
        /^https:\/\/(?:www\.)?ll-fans\.jp\/data\/event\/(\d+)\/?$/
      );
      if (match) return match[1];
    }
    return "";
  }

  function matchingRegisteredEvent(item) {
    const titleKey = normalizedEventTitle(item.title);
    return state.database.events.find((event) => (
      llFansSourceId(event) === String(item.sourceId) ||
      event.id === item.idSuggestion ||
      normalizedEventTitle(event.title) === titleKey
    )) || null;
  }

  function filteredLlFansSyncEvents() {
    const query = normalizedEventTitle(elements.llfansSyncSearch.value);
    const series = elements.llfansSyncSeries.value;
    return state.llfansSyncCatalog.filter((item) => (
      !matchingRegisteredEvent(item) &&
      (!query || normalizedEventTitle(item.title).includes(query)) &&
      (!series || (item.series || []).includes(series))
    ));
  }

  function updateLlFansSyncSelectionUi() {
    const selectedCount = state.llfansSyncSelectedIds.size;
    elements.startLlFansSyncButton.disabled = selectedCount === 0 || state.llfansSyncActive;
    elements.startLlFansSyncButton.textContent = selectedCount
      ? `${selectedCount}公演を取り込む`
      : "選択した公演を取り込む";
    const visible = filteredLlFansSyncEvents();
    const allVisibleSelected = visible.length > 0 && visible.every(
      (item) => state.llfansSyncSelectedIds.has(String(item.sourceId))
    );
    elements.toggleLlFansSyncVisibleButton.textContent = allVisibleSelected
      ? "表示中の選択を解除"
      : "表示中を全選択";
  }

  function renderLlFansSyncCatalog() {
    const missing = state.llfansSyncCatalog.filter(
      (item) => !matchingRegisteredEvent(item)
    );
    const visible = filteredLlFansSyncEvents();
    elements.llfansSyncList.replaceChildren();
    elements.llfansSyncSummary.textContent =
      `取得 ${state.llfansSyncCatalog.length}件 / 未登録 ${missing.length}件 / 表示 ${visible.length}件`;

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "llfans-sync-empty";
      empty.textContent = missing.length
        ? "絞り込み条件に一致する未登録公演はありません。"
        : "未登録の公演はありません。";
      elements.llfansSyncList.append(empty);
      updateLlFansSyncSelectionUi();
      return;
    }

    for (const item of visible) {
      const label = document.createElement("label");
      label.className = "llfans-sync-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(item.sourceId);
      checkbox.checked = state.llfansSyncSelectedIds.has(checkbox.value);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.llfansSyncSelectedIds.add(checkbox.value);
        } else {
          state.llfansSyncSelectedIds.delete(checkbox.value);
        }
        updateLlFansSyncSelectionUi();
      });

      const copy = document.createElement("span");
      copy.className = "llfans-sync-copy";
      const title = document.createElement("span");
      title.className = "llfans-sync-title";
      title.textContent = item.title;
      const meta = document.createElement("span");
      meta.className = "llfans-sync-meta";
      const dateRange = [item.startsOn, item.endsOn]
        .filter(Boolean)
        .filter((value, index, values) => index === 0 || value !== values[0])
        .join(" 〜 ");
      meta.textContent = `${dateRange || "日程未設定"} / LL-Fans ID ${item.sourceId}`;
      copy.append(title, meta);

      const series = document.createElement("span");
      series.className = "llfans-sync-series";
      series.textContent = (item.series || []).join(", ") || "series不明";
      label.append(checkbox, copy, series);
      elements.llfansSyncList.append(label);
    }
    updateLlFansSyncSelectionUi();
  }

  function populateLlFansSyncSeries() {
    const current = elements.llfansSyncSeries.value;
    const values = [...new Set(
      state.llfansSyncCatalog.flatMap((item) => item.series || [])
    )].sort();
    elements.llfansSyncSeries.replaceChildren(new Option("すべて", ""));
    for (const value of values) {
      elements.llfansSyncSeries.append(new Option(value, value));
    }
    elements.llfansSyncSeries.value = values.includes(current) ? current : "";
  }

  async function loadLlFansSyncCatalog(force = false) {
    hideValidation(elements.llfansSyncErrors);
    elements.refreshLlFansSyncButton.disabled = true;
    elements.startLlFansSyncButton.disabled = true;
    elements.llfansSyncSummary.textContent = "LL-Fansから公演一覧を取得しています…";
    try {
      const suffix = force ? "?refresh=1" : "";
      const response = await fetch(`/api/llfans-events${suffix}`, {
        headers: { Accept: "application/json" }
      });
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("一括同期APIが動いていません。server.pyを再起動してください。");
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `公演一覧を取得できませんでした（${response.status}）`);
      }
      state.llfansSyncCatalog = Array.isArray(body.events) ? body.events : [];
      const validIds = new Set(state.llfansSyncCatalog.map((item) => String(item.sourceId)));
      state.llfansSyncSelectedIds = new Set(
        [...state.llfansSyncSelectedIds].filter((id) => validIds.has(id))
      );
      populateLlFansSyncSeries();
      renderLlFansSyncCatalog();
    } catch (error) {
      state.llfansSyncCatalog = [];
      elements.llfansSyncList.replaceChildren();
      elements.llfansSyncSummary.textContent = "公演一覧を取得できませんでした。";
      showValidation(elements.llfansSyncErrors, [error.message]);
    } finally {
      elements.refreshLlFansSyncButton.disabled = false;
      updateLlFansSyncSelectionUi();
    }
  }

  async function openLlFansSync() {
    if (state.llfansSyncActive) {
      alert("公演の一括取込が進行中です。現在の公演を完了するか、取込を中止してください。");
      return;
    }
    state.llfansSyncSelectedIds.clear();
    elements.llfansSyncSearch.value = "";
    elements.llfansSyncSeries.value = "";
    elements.llfansSyncProgress.classList.add("hidden");
    hideValidation(elements.llfansSyncErrors);
    elements.llfansSyncDialog.showModal();
    await loadLlFansSyncCatalog(false);
  }

  function closeLlFansSync() {
    if (elements.llfansSyncDialog.open) elements.llfansSyncDialog.close();
  }

  function toggleVisibleLlFansSyncEvents() {
    const visible = filteredLlFansSyncEvents();
    const allSelected = visible.length > 0 && visible.every(
      (item) => state.llfansSyncSelectedIds.has(String(item.sourceId))
    );
    for (const item of visible) {
      const id = String(item.sourceId);
      if (allSelected) {
        state.llfansSyncSelectedIds.delete(id);
      } else {
        state.llfansSyncSelectedIds.add(id);
      }
    }
    renderLlFansSyncCatalog();
  }

  function llFansSyncCurrentItem() {
    return state.llfansSyncQueue[state.llfansSyncPosition] || null;
  }

  function recordLlFansSyncResult(status, message = "") {
    const item = llFansSyncCurrentItem();
    if (!item) return;
    state.llfansSyncResults.push({
      status,
      message,
      sourceId: item.sourceId,
      title: item.title
    });
  }

  function stopLlFansSync() {
    state.llfansSyncActive = false;
    state.llfansSyncQueue = [];
    state.llfansSyncPosition = -1;
  }

  function finishLlFansSync() {
    const added = state.llfansSyncResults.filter((item) => item.status === "added").length;
    const skipped = state.llfansSyncResults.filter((item) => item.status === "skipped").length;
    const failed = state.llfansSyncResults.filter((item) => item.status === "failed");
    stopLlFansSync();
    const lines = [
      `一括取込が完了しました。追加 ${added}公演 / スキップ ${skipped}公演 / 失敗 ${failed.length}公演`,
      "GitHubへの公開は、内容を確認してから手動で行ってください。"
    ];
    if (failed.length) {
      lines.push("", "失敗した公演:");
      for (const item of failed) lines.push(`・${item.title}: ${item.message}`);
    }
    alert(lines.join("\n"));
  }

  function scheduleNextLlFansSyncItem() {
    window.setTimeout(() => {
      advanceLlFansSyncQueue();
    }, 450);
  }

  async function advanceLlFansSyncQueue() {
    if (!state.llfansSyncActive) return;
    state.llfansSyncPosition += 1;
    if (state.llfansSyncPosition >= state.llfansSyncQueue.length) {
      finishLlFansSync();
      return;
    }

    const item = llFansSyncCurrentItem();
    openPageImport();
    elements.pageImportUrl.value = item.sourceUrl;
    elements.pageImportText.value = "";
    elements.pageImportSummary.textContent =
      `一括取込 ${state.llfansSyncPosition + 1}/${state.llfansSyncQueue.length}: ${item.title}`;
    elements.parsePageImportUrlButton.disabled = true;
    elements.parsePageImportUrlButton.textContent = "公演を取得中…";
    try {
      const response = await fetch(
        `/api/llfans-event?url=${encodeURIComponent(item.sourceUrl)}`,
        { headers: { Accept: "application/json" } }
      );
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("公演取込APIが動いていません。server.pyを再起動してください。");
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `公演を取得できませんでした（${response.status}）`);
      }
      await initializePageImport(body);
      if (!importSongCount()) {
        recordLlFansSyncResult("skipped", "セットリストが空です");
        closePageImport(false);
        scheduleNextLlFansSyncItem();
        return;
      }
      elements.pageImportSummary.textContent +=
        ` / 一括取込 ${state.llfansSyncPosition + 1}/${state.llfansSyncQueue.length}`;
      savePageImportWithOptions({ preventDefault() {} });
    } catch (error) {
      recordLlFansSyncResult("failed", error.message);
      closePageImport(false);
      scheduleNextLlFansSyncItem();
    } finally {
      elements.parsePageImportUrlButton.disabled = false;
      elements.parsePageImportUrlButton.textContent = "全公演を取得";
    }
  }

  function startLlFansSync() {
    const queue = state.llfansSyncCatalog.filter(
      (item) => (
        state.llfansSyncSelectedIds.has(String(item.sourceId)) &&
        !matchingRegisteredEvent(item)
      )
    );
    if (!queue.length) return;
    if (!window.SpotifyClient.isConnected()) {
      alert("曲の自動照合にSpotify接続が必要です。先に「Spotifyに接続」を押してください。");
      return;
    }
    if (!confirm(
      `${queue.length}公演を順番に取り込みます。\n` +
      "判断できない曲だけ確認画面を表示します。開始してよろしいですか？"
    )) return;

    state.llfansSyncQueue = queue;
    state.llfansSyncPosition = -1;
    state.llfansSyncResults = [];
    state.llfansSyncActive = true;
    closeLlFansSync();
    advanceLlFansSyncQueue();
  }

  function openPageImport() {
    populatePageImportDestinations();
    elements.pageImportDestination.value = "__new__";
    elements.pageImportUrl.value = "";
    elements.pageImportText.value = "";
    elements.pageImportPreview.classList.add("hidden");
    elements.pageImportSetlistRows.replaceChildren();
    elements.savePageImportButton.disabled = true;
    elements.savePageImportButton.textContent = "JSON化して登録";
    elements.pageImportPerformanceSwitcher.classList.add("hidden");
    elements.pageImportPerformanceSelector.replaceChildren();
    elements.spotifyMatchSummary.textContent = "登録前に番号・曲名・バージョンを修正できます。";
    hideValidation(elements.pageImportWarnings);
    hideValidation(elements.pageImportErrors);
    state.importDraft = null;
    state.importPerformanceIndex = 0;
    updatePageImportDestination();
    updateSpotifyUi();
    elements.pageImportDialog.showModal();
    elements.pageImportText.focus();
  }

  function closePageImport(cancelSync = true) {
    if (cancelSync && state.llfansSyncActive) {
      if (!confirm("進行中の一括取込を中止しますか？")) return;
      stopLlFansSync();
    }
    if (elements.spotifyCandidateDialog.open) closeSpotifyCandidateDialog();
    if (elements.pageImportDialog.open) elements.pageImportDialog.close();
    state.importDraft = null;
    state.importPerformanceIndex = 0;
  }

  function updatePageImportDestination() {
    const isNewEvent = elements.pageImportDestination.value === "__new__";
    elements.pageImportEventFields.disabled = !isNewEvent;
    elements.pageImportDestinationHelp.textContent = isNewEvent
      ? "抽出したイベント情報と公演を、新しいイベントとして登録します。"
      : "選択した既存イベントには公演だけを追加し、イベント情報は変更しません。";

    if (!state.importDraft || isNewEvent) return;
    const target = state.database.events.find(
      (event) => event.id === elements.pageImportDestination.value
    );
    if (!target) return;
    syncActiveImportPerformance();
    const usedIds = new Set(target.performances.map((performance) => performance.id));
    for (const performance of state.importDraft.performances) {
      performance.id = uniqueId(performance.id || performance.idSuggestion, usedIds);
      usedIds.add(performance.id);
    }
    renderActiveImportPerformance({ applyKnownSongs: false });
  }

  function renderPageImportSetlist() {
    elements.pageImportSetlistRows.replaceChildren();
    const setlist = activeImportPerformance()?.setlist || [];

    setlist.forEach((item, index) => {
      const row = document.createElement("tr");
      row.dataset.spotifyStatus = "unmatched";
      row.dataset.spotifyUiStatus = "idle";
      row.dataset.spotifySource = "";
      row.dataset.artistAutoFilled = "";
      row._spotifyResults = [];
      const orderCell = document.createElement("td");
      orderCell.className = "song-order";
      orderCell.textContent = String(index + 1);
      row.append(orderCell);

      const fields = [
        ["import-song-marker", item.marker, "M01"],
        ["import-song-title", item.title, "曲名"],
        ["import-song-version", item.version, "104期 Ver."],
        ["import-song-artist", item.artistHint, "アーティスト"]
      ];
      for (const [className, value, placeholder] of fields) {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.className = `${className} table-input`;
        input.value = value || "";
        input.placeholder = placeholder;
        input.autocomplete = "off";
        cell.append(input);
        row.append(cell);
      }

      row.querySelectorAll(".import-song-title, .import-song-version").forEach((input) => {
        input.addEventListener("input", () => {
          clearAutoFilledArtist(row, true);
          clearSpotifyRowMatch(row);
        });
      });
      row.querySelector(".import-song-artist").addEventListener("input", () => {
        clearAutoFilledArtist(row, false);
        clearSpotifyRowMatch(row);
      });

      const spotifyCell = document.createElement("td");
      const spotifyStatus = document.createElement("div");
      spotifyStatus.className = "spotify-row-status";
      const spotifyBadge = document.createElement("span");
      spotifyBadge.className = "spotify-match-badge idle";
      spotifyBadge.textContent = "未検索";
      const candidatesButton = document.createElement("button");
      candidatesButton.className = "spotify-candidates-button hidden";
      candidatesButton.type = "button";
      candidatesButton.textContent = "候補を見る";
      candidatesButton.addEventListener("click", () => openSpotifyCandidateDialog(row));
      spotifyStatus.append(spotifyBadge, candidatesButton);
      spotifyCell.append(spotifyStatus);
      row.append(spotifyCell);
      elements.pageImportSetlistRows.append(row);

      const savedStatus = item.spotifyUiStatus === "skipped"
        ? "unavailable"
        : item.spotifyUiStatus || "idle";
      setSpotifyRowStatus(
        row,
        savedStatus,
        item.spotifyStatusLabel || (
          savedStatus === "idle"
            ? "未検索"
            : savedStatus === "unavailable"
              ? "未配信"
              : "要確認"
        ),
        item.spotifyTrack || null,
        item.spotifyResults || []
      );
      row.dataset.spotifySource = item.spotifySource || "";
      row.dataset.artistAutoFilled = item.artistAutoFilled || "";
      if (item.artistAutoFilled === "database" && !item.spotifyTrack && item.artistHint) {
        const note = document.createElement("span");
        note.className = "known-song-note";
        note.textContent = "登録済み曲から補完";
        row.querySelector(".import-song-artist").parentElement.append(note);
      }
    });
  }

  function setSpotifyRowStatus(row, status, label, track = null, results = []) {
    row.dataset.spotifyStatus = status === "matched" ? "matched" : "unmatched";
    row.dataset.spotifyUiStatus = status;
    row.dataset.spotifySource = "";
    row.dataset.spotifyTrackId = track?.id || "";
    row.dataset.spotifyUri = track?.uri || "";
    row.dataset.spotifyMatchedTitle = track?.name || "";
    row.dataset.spotifyMatchedArtist = (track?.artists || [])
      .map((artist) => artist.name)
      .filter(Boolean)
      .join(", ");
    row.dataset.spotifyArtworkUrl = spotifyTrackArtwork(track);
    row.dataset.spotifyAlbumName = track?.album?.name || "";
    row._spotifyResults = results;
    const badge = row.querySelector(".spotify-match-badge");
    badge.className = `spotify-match-badge ${status}`;
    badge.textContent = label;
    const candidatesButton = row.querySelector(".spotify-candidates-button");
    const canChooseManually =
      status === "matched" || status === "ambiguous" || status === "manual" || status === "unmatched";
    candidatesButton.classList.toggle("hidden", !canChooseManually);
    candidatesButton.textContent = status === "matched"
      ? "Spotifyで再検索"
      : results.length
        ? `候補を見る（${results.length}件）`
        : "手動検索";
  }

  function clearSpotifyRowMatch(row) {
    setSpotifyRowStatus(row, "idle", "未検索");
    elements.spotifyMatchSummary.textContent = "曲情報を変更したため、Spotify検索をやり直してください。";
  }

  function clearAutoFilledArtist(row, clearValue) {
    if (clearValue && row.dataset.artistAutoFilled) {
      row.querySelector(".import-song-artist").value = "";
    }
    row.dataset.artistAutoFilled = "";
    row.querySelector(".known-song-note")?.remove();
  }

  function setAutoFilledArtist(row, artist, source, showNote = false) {
    clearAutoFilledArtist(row, false);
    row.querySelector(".import-song-artist").value = artist || "";
    row.dataset.artistAutoFilled = source;
    if (!showNote || !artist) return;
    const note = document.createElement("span");
    note.className = "known-song-note";
    note.textContent = "登録済み曲から補完";
    row.querySelector(".import-song-artist").parentElement.append(note);
  }

  function applyKnownSongsFromDatabase() {
    const index = window.KnownSongCache.buildKnownSongIndex(state.database.events);
    const counts = { tracks: 0, artists: 0, conflicts: 0 };
    const rows = [...elements.pageImportSetlistRows.querySelectorAll("tr")];

    for (const row of rows) {
      if (row.dataset.spotifyStatus === "matched") continue;
      const title = row.querySelector(".import-song-title").value.trim();
      const version = row.querySelector(".import-song-version").value.trim();
      if (!title) continue;
      const confirmed = findConfirmedSpotifyMapping(title, version);
      if (confirmed?.track) {
        const artist = spotifyTrackArtist(confirmed.track);
        setAutoFilledArtist(row, artist, "confirmed");
        setSpotifyRowStatus(
          row,
          "matched",
          confirmed.exact ? "手動設定を自動反映" : "同名曲の手動設定を反映",
          confirmed.track
        );
        row.dataset.spotifySource = "confirmed";
        counts.tracks += 1;
        continue;
      }

      let known = window.KnownSongCache.findKnownSong(index, title, version);
      let usedOriginalFallback = false;
      let usedTitleFallback = false;
      if (!known.track && matchPolicyForVersion(version) === "original_fallback") {
        const original = window.KnownSongCache.findKnownSong(index, title, "");
        if (original.track && !original.trackConflict) {
          known = original;
          usedOriginalFallback = true;
        }
      }
      if (!known.track) {
        const sameTitle = window.KnownSongCache.findKnownSongByTitle(index, title);
        if (sameTitle.track && !sameTitle.trackConflict) {
          known = sameTitle;
          usedTitleFallback = true;
        }
      }
      if (!known.found) continue;

      if (known.track) {
        setAutoFilledArtist(row, known.artist, "database");
        setSpotifyRowStatus(
          row,
          "matched",
          usedOriginalFallback
            ? "登録済み原曲で補完"
            : usedTitleFallback
              ? "登録済み同名曲から補完"
              : "登録済みから補完",
          known.track
        );
        row.dataset.spotifySource = "database";
        counts.tracks += 1;
      } else if (known.artist && !row.querySelector(".import-song-artist").value.trim()) {
        setAutoFilledArtist(row, known.artist, "database", true);
        counts.artists += 1;
      }
      if (known.trackConflict || known.artistConflict) counts.conflicts += 1;
    }
    return counts;
  }

  function spotifyTrackArtist(track) {
    return (track?.artists || [])
      .map((artist) => artist.name)
      .filter(Boolean)
      .join(", ");
  }

  function spotifyTrackArtwork(track) {
    return (track?.album?.images || []).find((image) => image?.url)?.url || "";
  }

  function renderSpotifyCandidateResults(results) {
    elements.spotifyCandidateList.replaceChildren();
    elements.spotifyCandidateSummary.textContent = results.length
      ? state.spotifyReviewActive
        ? `${results.length}件の検索結果があります。使用する曲を選ぶと次へ進みます。`
        : `${results.length}件の検索結果から使用する曲を選んでください。`
      : state.spotifyReviewActive
        ? "検索結果がありません。再検索するか、この曲を未配信として登録してください。"
        : "検索結果がありません。検索語を変更して再検索してください。";

    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "spotify-candidate-empty";
      empty.textContent = "候補がありません。曲名やアーティスト名を変えて検索できます。";
      elements.spotifyCandidateList.append(empty);
      return;
    }

    results.forEach((track) => {
      const button = document.createElement("button");
      button.className = "spotify-candidate-item";
      button.type = "button";

      const artwork = document.createElement("span");
      artwork.className = "spotify-candidate-artwork";
      const imageUrl = (track.album?.images || []).find((image) => image?.url)?.url;
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = track.album?.name
          ? `${track.album.name}のジャケット`
          : "アルバムジャケット";
        image.loading = "lazy";
        artwork.append(image);
      } else {
        artwork.textContent = "♪";
        artwork.setAttribute("aria-hidden", "true");
      }

      const copy = document.createElement("span");
      copy.className = "spotify-candidate-copy";
      const title = document.createElement("span");
      title.className = "spotify-candidate-title";
      title.textContent = track.name || "曲名不明";
      const artist = document.createElement("span");
      artist.className = "spotify-candidate-artist";
      artist.textContent = spotifyTrackArtist(track) || "アーティスト不明";
      const album = document.createElement("span");
      album.className = "spotify-candidate-album";
      album.textContent = track.album?.name ? `収録: ${track.album.name}` : "";

      copy.append(title, artist, album);
      button.append(artwork, copy);
      button.addEventListener("click", () => applyManualSpotifyTrack(track));
      elements.spotifyCandidateList.append(button);
    });
  }

  function openSpotifyCandidateDialog(row) {
    if (!window.SpotifyClient.isConnected()) {
      alert("先に画面上部の「Spotifyに接続」を押してください。");
      return;
    }
    resetSpotifyReviewUi();
    elements.spotifyCandidateDialogTitle.textContent = "Spotify曲を手動で選択";
    state.spotifyManualRow = row;
    state.spotifyManualContext = "import";
    const marker = row.querySelector(".import-song-marker").value.trim();
    const title = row.querySelector(".import-song-title").value.trim();
    elements.spotifyCandidateSong.textContent = `${marker || "曲"}: ${title || "曲名未入力"}`;
    elements.spotifyManualQuery.value = title;
    renderSpotifyCandidateResults(row._spotifyResults || []);
    elements.spotifyCandidateDialog.showModal();
    if (row.dataset.spotifyUiStatus === "matched") {
      searchSpotifyManually();
    } else if (!(row._spotifyResults || []).length) {
      elements.spotifyManualQuery.focus();
    }
  }

  function resetSpotifyReviewUi() {
    elements.spotifyReviewProgress.classList.add("hidden");
    elements.spotifyReviewProgress.textContent = "";
    elements.spotifyUnavailableButton.classList.add("hidden");
    elements.spotifyCancelCandidateButton.textContent = "キャンセル";
    elements.spotifyManualSearchButton.disabled = false;
    elements.spotifyManualSearchButton.textContent = "Spotifyを再検索";
  }

  function closeSpotifyCandidateDialog() {
    if (state.spotifyReviewActive) {
      cancelSpotifyReview();
      return;
    }
    state.spotifySearchRequestId += 1;
    if (elements.spotifyCandidateDialog.open) elements.spotifyCandidateDialog.close();
    state.spotifyManualRow = null;
    state.spotifyManualContext = null;
    resetSpotifyReviewUi();
  }

  function collectUnresolvedSpotifySongs() {
    syncActiveImportPerformance();
    const queue = [];
    const seen = new Set();
    for (let performanceIndex = 0; performanceIndex < (state.importDraft?.performances || []).length; performanceIndex += 1) {
      const performance = state.importDraft.performances[performanceIndex];
      for (let songIndex = 0; songIndex < performance.setlist.length; songIndex += 1) {
        const item = performance.setlist[songIndex];
        if (
          item.spotifyUiStatus === "matched" ||
          item.spotifyUiStatus === "unavailable" ||
          item.spotifyUiStatus === "skipped"
        ) continue;
        const key = window.KnownSongCache.songKey(item.title, item.version);
        if (!item.title || seen.has(key)) continue;
        seen.add(key);
        queue.push({ performanceIndex, songIndex, key });
      }
    }
    return queue;
  }

  function startSpotifyReview(queue) {
    state.spotifyReviewActive = true;
    state.spotifyReviewQueue = queue;
    state.spotifyReviewPosition = -1;
    elements.savePageImportButton.disabled = true;
    elements.spotifyCandidateDialogTitle.textContent = "未登録曲を設定";
    elements.spotifyReviewProgress.classList.remove("hidden");
    elements.spotifyUnavailableButton.classList.remove("hidden");
    elements.spotifyCancelCandidateButton.textContent = "確認を中止";
    advanceSpotifyReview();
  }

  function advanceSpotifyReview() {
    state.spotifySearchRequestId += 1;
    state.spotifyReviewPosition += 1;
    while (state.spotifyReviewPosition < state.spotifyReviewQueue.length) {
      const current = state.spotifyReviewQueue[state.spotifyReviewPosition];
      const item = state.importDraft?.performances?.[current.performanceIndex]?.setlist?.[current.songIndex];
      if (
        !item ||
        item.spotifyUiStatus === "matched" ||
        item.spotifyUiStatus === "unavailable" ||
        item.spotifyUiStatus === "skipped"
      ) {
        state.spotifyReviewPosition += 1;
        continue;
      }

      selectImportPerformance(current.performanceIndex, {
        syncCurrent: false,
        applyKnownSongs: false
      });
      const row = elements.pageImportSetlistRows.querySelectorAll("tr")[current.songIndex];
      if (!row) {
        state.spotifyReviewPosition += 1;
        continue;
      }

      state.spotifyManualRow = row;
      state.spotifyManualContext = "import";
      const marker = row.querySelector(".import-song-marker").value.trim();
      const title = row.querySelector(".import-song-title").value.trim();
      const performance = state.importDraft.performances[current.performanceIndex];
      elements.spotifyReviewProgress.textContent =
        `${state.spotifyReviewPosition + 1}/${state.spotifyReviewQueue.length}曲目 ・ ${performance.label || `公演 ${current.performanceIndex + 1}`}`;
      elements.spotifyCandidateSong.textContent = `${marker || "曲"}: ${title || "曲名未入力"}`;
      elements.spotifyManualQuery.value = title;
      elements.spotifyManualSearchButton.textContent = "Spotifyを再検索";
      const results = row._spotifyResults || [];
      renderSpotifyCandidateResults(results);
      if (!window.SpotifyClient.isConnected() && !results.length) {
        elements.spotifyCandidateSummary.textContent =
          "Spotify未接続のため検索できません。この曲を未配信として登録するか、確認を中止してSpotifyへ接続してください。";
        elements.spotifyManualSearchButton.disabled = true;
      } else {
        elements.spotifyManualSearchButton.disabled = false;
      }
      if (!elements.spotifyCandidateDialog.open) elements.spotifyCandidateDialog.showModal();
      if (!results.length && window.SpotifyClient.isConnected()) searchSpotifyManually();
      return;
    }
    finishSpotifyReview();
  }

  function markCurrentSpotifyReviewSongUnavailable() {
    if (!state.spotifyReviewActive) return;
    const current = state.spotifyReviewQueue[state.spotifyReviewPosition];
    if (!current) return;
    if (state.spotifyManualRow) {
      setSpotifyRowStatus(state.spotifyManualRow, "unavailable", "未配信");
      state.spotifyManualRow.dataset.spotifySource = "unavailable";
      syncActiveImportPerformance();
    }
    for (const performance of state.importDraft?.performances || []) {
      for (const item of performance.setlist) {
        if (window.KnownSongCache.songKey(item.title, item.version) !== current.key) continue;
        if (item.spotifyUiStatus === "matched") continue;
        item.spotifyUiStatus = "unavailable";
        item.spotifyStatusLabel = "未配信";
        item.spotifySource = "unavailable";
        item.spotifyMatchPolicy = "unavailable";
        item.spotifyTrack = null;
      }
    }
    advanceSpotifyReview();
  }

  function finishSpotifyReview() {
    state.spotifyReviewActive = false;
    state.spotifyReviewQueue = [];
    state.spotifyReviewPosition = -1;
    state.spotifyManualRow = null;
    state.spotifyManualContext = null;
    resetSpotifyReviewUi();
    elements.savePageImportButton.disabled = false;
    if (elements.spotifyCandidateDialog.open) elements.spotifyCandidateDialog.close();
    savePageImportWithOptions({ preventDefault() {} }, { skipSpotifyReview: true });
  }

  function cancelSpotifyReview() {
    state.spotifySearchRequestId += 1;
    state.spotifyReviewActive = false;
    state.spotifyReviewQueue = [];
    state.spotifyReviewPosition = -1;
    state.spotifyManualRow = null;
    state.spotifyManualContext = null;
    resetSpotifyReviewUi();
    elements.savePageImportButton.disabled = false;
    if (elements.spotifyCandidateDialog.open) elements.spotifyCandidateDialog.close();
    elements.spotifyMatchSummary.textContent =
      "未登録曲の確認を中止しました。Spotify設定済み・未配信設定済みの内容は保持されています。";
  }

  function updateManualSelectionSummary() {
    syncActiveImportPerformance();
    const items = (state.importDraft?.performances || []).flatMap(
      (performance) => performance.setlist
    );
    const matched = items.filter((item) => item.spotifyUiStatus === "matched").length;
    const needsReview = items.filter((item) =>
      item.spotifyUiStatus === "ambiguous" ||
      item.spotifyUiStatus === "manual" ||
      item.spotifyUiStatus === "unmatched"
    ).length;
    const unavailable = items.filter(
      (item) => item.spotifyUiStatus === "unavailable" || item.spotifyUiStatus === "skipped"
    ).length;
    elements.spotifyMatchSummary.textContent =
      `Spotify選択済み ${matched}/${items.length}曲 / 要確認 ${needsReview}曲 / 未配信 ${unavailable}曲`;
  }

  function applyManualSpotifyTrack(track) {
    const row = state.spotifyManualRow;
    if (!row) return;
    if (state.spotifyManualContext === "editor") {
      const index = Number(row.dataset.index);
      const title = row.querySelector(".song-title").value.trim();
      const version = row.querySelector(".song-version").value.trim();
      const artist = spotifyTrackArtist(track);
      rememberConfirmedSpotifyMapping(title, version, track);
      syncSetlistFromRows();
      const item = state.draftSetlist[index];
      if (!item) return;
      item.artistHint = artist;
      item.spotifyMatchPolicy = "exact";
      item.spotify = {
        status: "matched",
        trackId: track.id || null,
        uri: track.uri || null,
        matchedTitle: track.name || null,
        matchedArtist: artist || null,
        artworkUrl: spotifyTrackArtwork(track) || null,
        albumName: track.album?.name || null
      };
      closeSpotifyCandidateDialog();
      renderSetlistRows();
      return;
    }
    const title = row.querySelector(".import-song-title").value.trim();
    const version = row.querySelector(".import-song-version").value.trim();
    const artist = spotifyTrackArtist(track);
    rememberConfirmedSpotifyMapping(title, version, track);
    setAutoFilledArtist(row, artist, "manual");
    setSpotifyRowStatus(row, "matched", "手動選択", track);
    row.dataset.spotifySource = "manual";
    const continueReview = state.spotifyReviewActive;
    if (!continueReview) closeSpotifyCandidateDialog();
    syncActiveImportPerformance();

    const normalizedTitle = window.KnownSongCache.normalizeComparable(title);
    for (const performance of state.importDraft?.performances || []) {
      for (const item of performance.setlist) {
        if (window.KnownSongCache.normalizeComparable(item.title) !== normalizedTitle) continue;
        const confirmed = findConfirmedSpotifyMapping(item.title, item.version);
        if (!confirmed?.track) continue;
        const confirmedArtist = spotifyTrackArtist(confirmed.track);
        item.artistHint = confirmedArtist;
        item.spotifyUiStatus = "matched";
        item.spotifyStatusLabel = confirmed.exact ? "手動選択" : "手動設定を自動反映";
        item.spotifySource = confirmed.exact ? "manual" : "confirmed";
        item.spotifyTrack = deepClone(confirmed.track);
        item.artistAutoFilled = confirmed.exact ? "manual" : "confirmed";
      }
    }
    renderActiveImportPerformance({ applyKnownSongs: false });
    updateManualSelectionSummary();
    if (continueReview) advanceSpotifyReview();
  }

  async function searchSpotifyManually() {
    const row = state.spotifyManualRow;
    const query = elements.spotifyManualQuery.value.trim();
    if (!row || !query) {
      elements.spotifyCandidateSummary.textContent = "検索語を入力してください。";
      return;
    }

    elements.spotifyManualSearchButton.disabled = true;
    elements.spotifyManualSearchButton.textContent = "検索中…";
    elements.spotifyCandidateSummary.textContent = "Spotifyを検索しています…";
    elements.spotifyCandidateList.replaceChildren();
    const requestId = ++state.spotifySearchRequestId;
    try {
      const results = await window.SpotifyClient.searchTracks(query);
      if (requestId !== state.spotifySearchRequestId) return;
      if (state.spotifyManualContext === "editor") {
        row._spotifyResults = results;
        row.dataset.spotifySearched = "true";
        renderSpotifyCandidateResults(results);
        return;
      }
      const currentStatus = row.dataset.spotifyUiStatus || "unmatched";
      const currentLabel = row.querySelector(".spotify-match-badge").textContent;
      const currentSource = row.dataset.spotifySource || "";
      const currentTrack = currentStatus === "matched"
        ? {
            id: row.dataset.spotifyTrackId || null,
            uri: row.dataset.spotifyUri || null,
            name: row.dataset.spotifyMatchedTitle || null,
            artists: row.dataset.spotifyMatchedArtist
              ? [{ name: row.dataset.spotifyMatchedArtist }]
              : [],
            album: row.dataset.spotifyArtworkUrl || row.dataset.spotifyAlbumName
              ? {
                  name: row.dataset.spotifyAlbumName || "",
                  images: row.dataset.spotifyArtworkUrl
                    ? [{ url: row.dataset.spotifyArtworkUrl }]
                    : []
                }
              : null
          }
        : null;
      setSpotifyRowStatus(row, currentStatus, currentLabel, currentTrack, results);
      row.dataset.spotifySource = currentSource;
      renderSpotifyCandidateResults(results);
    } catch (error) {
      if (requestId !== state.spotifySearchRequestId) return;
      elements.spotifyCandidateSummary.textContent = `検索に失敗しました: ${error.message}`;
    } finally {
      if (requestId !== state.spotifySearchRequestId) return;
      elements.spotifyManualSearchButton.disabled = false;
      elements.spotifyManualSearchButton.textContent = "Spotifyを再検索";
    }
  }

  function updateSpotifyUi() {
    const connected = Boolean(window.SpotifyClient?.isConnected());
    const profile = connected ? window.SpotifyClient.profile() : null;
    const accountName = profile?.display_name || profile?.id || "接続済み";

    elements.spotifyAccount.textContent = connected
      ? `Spotify: ${accountName}`
      : "Spotify未接続";
    elements.spotifyAccount.classList.toggle("connected", connected);
    elements.spotifyConnectButton.textContent = connected ? "接続解除" : "Spotifyに接続";
    elements.spotifyEnrichButton.disabled = !connected || !importSongCount();
    elements.spotifyResearchAllButton.disabled = !connected || !state.draftSetlist.length;
    if (!elements.spotifyEnrichButton.textContent.includes("検索中")) {
      elements.spotifyEnrichButton.textContent = (state.importDraft?.performances?.length || 0) > 1
        ? "Spotifyで全公演を補完"
        : "Spotifyでアーティスト補完";
    }
  }

  async function handleSpotifyConnection() {
    if (window.SpotifyClient.isConnected()) {
      if (!confirm("Spotify接続を解除しますか？")) return;
      window.SpotifyClient.disconnect();
      updateSpotifyUi();
      return;
    }
    elements.spotifyConnectButton.disabled = true;
    elements.spotifyConnectButton.textContent = "Spotifyを開いています…";
    try {
      await window.SpotifyClient.connect();
    } catch (error) {
      elements.spotifyConnectButton.disabled = false;
      updateSpotifyUi();
      alert(`Spotify接続を開始できませんでした。\n${error.message}`);
    }
  }

  async function enrichArtistsFromSpotify() {
    if (!window.SpotifyClient.isConnected()) {
      alert("先に画面上部の「Spotifyに接続」を押してください。");
      return;
    }

    syncActiveImportPerformance();
    const performances = state.importDraft?.performances || [];
    const totalSongs = importSongCount();
    if (!totalSongs) return;
    const originalIndex = state.importPerformanceIndex;
    elements.spotifyEnrichButton.disabled = true;
    elements.spotifyEnrichButton.textContent = "Spotifyを検索中…";

    const cache = new Map();
    const counts = { reused: 0, matched: 0, fallback: 0, ambiguous: 0, unmatched: 0 };
    let processed = 0;
    try {
      for (let performanceIndex = 0; performanceIndex < performances.length; performanceIndex += 1) {
        selectImportPerformance(performanceIndex, {
          syncCurrent: false,
          applyKnownSongs: true
        });
        const rows = [...elements.pageImportSetlistRows.querySelectorAll("tr")];

        for (const row of rows) {
          const title = row.querySelector(".import-song-title").value.trim();
          const version = row.querySelector(".import-song-version").value.trim();
          const matchPolicy = matchPolicyForVersion(version);
          processed += 1;
          elements.spotifyMatchSummary.textContent =
            `${processed}/${totalSongs}曲を検索中…（${performanceIndex + 1}/${performances.length}公演）`;

          if (
            row.dataset.spotifyStatus === "matched" &&
            ["database", "confirmed", "manual"].includes(row.dataset.spotifySource)
          ) {
            counts.reused += 1;
            continue;
          }

          if (!title) {
            setSpotifyRowStatus(row, "unmatched", "曲名なし");
            counts.unmatched += 1;
            continue;
          }

          setSpotifyRowStatus(row, "searching", "検索中");
          const cacheKey = `${window.KnownSongCache.songKey(title, version)}::${matchPolicy}`;
          let result = cache.get(cacheKey);
          if (!result) {
            result = await window.SpotifyClient.searchBestTrack({
              title,
              version,
              matchPolicy
            });
            cache.set(cacheKey, result);
          }

          if (result.status === "matched") {
            const artist = spotifyTrackArtist(result.track);
            const statusLabel = result.matchKind === "original_fallback"
              ? "原曲で補完"
              : result.matchKind === "version"
                ? "バージョン一致"
                : "曲名一致";
            setAutoFilledArtist(row, artist, "spotify");
            setSpotifyRowStatus(row, "matched", statusLabel, result.track);
            row.dataset.spotifySource = "spotify";
            if (result.matchKind === "original_fallback") counts.fallback += 1;
            else counts.matched += 1;
          } else if (result.status === "ambiguous" || result.status === "manual") {
            const statusLabel = result.status === "ambiguous" ? "候補複数" : "要確認";
            const candidates = result.candidates?.length
              ? result.candidates
              : result.results || [];
            setSpotifyRowStatus(row, result.status, statusLabel, null, candidates);
            counts.ambiguous += 1;
          } else {
            setSpotifyRowStatus(row, "unmatched", "見つからず", null, result.results || []);
            counts.unmatched += 1;
          }
        }
        syncActiveImportPerformance();
      }

      selectImportPerformance(originalIndex, {
        syncCurrent: false,
        applyKnownSongs: false
      });
      elements.spotifyMatchSummary.textContent =
        `Spotify検索: 登録済みから補完 ${counts.reused}曲 / 一致 ${counts.matched}曲 / 原曲で補完 ${counts.fallback}曲 / 要手動選択 ${counts.ambiguous}曲 / 見つからず ${counts.unmatched}曲`;
    } catch (error) {
      syncActiveImportPerformance();
      selectImportPerformance(originalIndex, {
        syncCurrent: false,
        applyKnownSongs: false
      });
      elements.spotifyMatchSummary.textContent = `Spotify検索を中断しました: ${error.message}`;
      alert(`Spotify検索に失敗しました。\n${error.message}`);
    } finally {
      elements.spotifyEnrichButton.textContent = performances.length > 1
        ? "Spotifyで全公演を補完"
        : "Spotifyでアーティスト補完";
      updateSpotifyUi();
    }
  }

  async function initializePageImport(parsed) {
    state.importDraft = normalizeImportDraft(parsed);
    state.importPerformanceIndex = 0;
    const draft = state.importDraft;
    if (!draft.performances.length) throw new Error("公演を取得できませんでした。");

    const matchingEvent = state.database.events.find(
      (event) => event.title.normalize("NFKC") === draft.event.title.normalize("NFKC")
    );
    elements.pageImportDestination.value = matchingEvent?.id || "__new__";

    const usedEventIds = new Set(state.database.events.map((event) => event.id));
    const suggestedEventId = draft.event.idSuggestion || stableSlug(draft.event.title, "event");
    elements.pageImportEventId.value = matchingEvent
      ? matchingEvent.id
      : uniqueId(suggestedEventId, usedEventIds);
    elements.pageImportEventTitle.value = draft.event.title;
    elements.pageImportSeries.value = (draft.event.series || []).join(", ");
    elements.pageImportSourceName.value = draft.event.source?.name || "";
    elements.pageImportSourceUrl.value = draft.event.source?.url || "";

    const target = matchingEvent || { performances: [] };
    const usedPerformanceIds = new Set(
      target.performances.map((performance) => performance.id)
    );
    for (const performance of draft.performances) {
      const suggestion = performance.idSuggestion ||
        stableSlug(`${suggestedEventId}-${performance.label}`, "performance");
      performance.id = uniqueId(suggestion, usedPerformanceIds);
      usedPerformanceIds.add(performance.id);
    }

    const performanceCount = draft.performances.length;
    const songCount = importSongCount();
    elements.pageImportSummary.textContent =
      `${draft.event.title || "イベント名未取得"} / ${performanceCount}公演 / ${songCount}曲`;
    elements.savePageImportButton.textContent = performanceCount > 1
      ? `${performanceCount}公演をJSON化して登録`
      : "JSON化して登録";
    elements.pageImportPreview.classList.remove("hidden");

    const knownCounts = { tracks: 0, artists: 0, conflicts: 0 };
    for (let index = 0; index < performanceCount; index += 1) {
      const currentCounts = selectImportPerformance(index, {
        syncCurrent: false,
        applyKnownSongs: true
      });
      knownCounts.tracks += currentCounts.tracks;
      knownCounts.artists += currentCounts.artists;
      knownCounts.conflicts += currentCounts.conflicts;
    }
    selectImportPerformance(0, { syncCurrent: false, applyKnownSongs: false });

    elements.spotifyMatchSummary.textContent = knownCounts.tracks || knownCounts.artists
      ? `登録済みデータからSpotify曲 ${knownCounts.tracks}曲、アーティスト ${knownCounts.artists}曲を補完しました。`
      : "曲名だけでSpotifyを検索します。一意の完全一致だけ自動適用します。";
    elements.savePageImportButton.disabled = songCount === 0;
    updatePageImportDestination();
    updateSpotifyUi();

    if (draft.warnings.length) {
      showValidation(elements.pageImportWarnings, draft.warnings);
    } else {
      hideValidation(elements.pageImportWarnings);
    }

    if (window.SpotifyClient.isConnected()) {
      await enrichArtistsFromSpotify();
    } else {
      elements.spotifyMatchSummary.textContent +=
        " Spotify未接続のため曲検索は開始していません。";
    }
  }

  async function parsePageImportUrl() {
    hideValidation(elements.pageImportErrors);
    const pageUrl = elements.pageImportUrl.value.trim();
    if (!pageUrl) {
      showValidation(elements.pageImportErrors, ["LL-FansのイベントURLを入力してください。"]);
      return;
    }

    elements.parsePageImportUrlButton.disabled = true;
    elements.parsePageImportUrlButton.textContent = "全公演を取得中…";
    try {
      const response = await fetch(`/api/llfans-event?url=${encodeURIComponent(pageUrl)}`, {
        headers: { Accept: "application/json" }
      });
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("URL一括取り込み用サーバーが動いていません。python server.py で起動してください。");
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `取得に失敗しました（${response.status}）`);
      await initializePageImport(body);
    } catch (error) {
      state.importDraft = null;
      elements.pageImportPreview.classList.add("hidden");
      elements.savePageImportButton.disabled = true;
      showValidation(elements.pageImportErrors, [`URLから取得できませんでした: ${error.message}`]);
    } finally {
      elements.parsePageImportUrlButton.disabled = false;
      elements.parsePageImportUrlButton.textContent = "全公演を取得";
    }
  }

  async function parsePageImportText() {
    hideValidation(elements.pageImportErrors);
    const rawText = elements.pageImportText.value.trim();
    if (!rawText) {
      showValidation(elements.pageImportErrors, ["ページ本文を貼り付けてください。"]);
      return;
    }

    elements.parsePageImportButton.disabled = true;
    elements.parsePageImportButton.textContent = "本文を解析中…";
    try {
      const parsed = window.SetlistPageParser.parseLlFansPage(rawText);
      await initializePageImport(parsed);
    } catch (error) {
      state.importDraft = null;
      elements.pageImportPreview.classList.add("hidden");
      elements.savePageImportButton.disabled = true;
      showValidation(elements.pageImportErrors, [`本文を解析できませんでした: ${error.message}`]);
    } finally {
      elements.parsePageImportButton.disabled = false;
      elements.parsePageImportButton.textContent = "本文を解析";
    }
  }

  function importSetlistDraftFromRows() {
    return [...elements.pageImportSetlistRows.querySelectorAll("tr")].map((row) => {
      const title = row.querySelector(".import-song-title").value.trim();
      const version = row.querySelector(".import-song-version").value.trim();
      const spotifyMatched = row.dataset.spotifyStatus === "matched";
      return {
        marker: row.querySelector(".import-song-marker").value.trim(),
        title,
        version,
        artistHint: row.querySelector(".import-song-artist").value.trim(),
        spotifyUiStatus: row.dataset.spotifyUiStatus || "idle",
        spotifyStatusLabel: row.querySelector(".spotify-match-badge")?.textContent || "未検索",
        spotifySource: row.dataset.spotifySource || "",
        spotifyTrack: spotifyMatched
          ? {
              id: row.dataset.spotifyTrackId || null,
              uri: row.dataset.spotifyUri || null,
              name: row.dataset.spotifyMatchedTitle || title,
              artists: row.dataset.spotifyMatchedArtist
                ? [{ name: row.dataset.spotifyMatchedArtist }]
                : [],
              album: row.dataset.spotifyArtworkUrl || row.dataset.spotifyAlbumName
                ? {
                    name: row.dataset.spotifyAlbumName || "",
                    images: row.dataset.spotifyArtworkUrl
                      ? [{ url: row.dataset.spotifyArtworkUrl }]
                      : []
                  }
                : null
            }
          : null,
        spotifyResults: deepClone(row._spotifyResults || []),
        artistAutoFilled: row.dataset.artistAutoFilled || ""
      };
    });
  }

  function schemaSetlistFromDraft(setlist) {
    return (setlist || []).map((item, index) => {
      const spotifyUnavailable =
        item.spotifyUiStatus === "unavailable" ||
        item.spotifyUiStatus === "skipped" ||
        item.spotifyMatchPolicy === "unavailable";
      const spotifyMatched =
        !spotifyUnavailable && item.spotifyUiStatus === "matched" && item.spotifyTrack;
      return {
        order: index + 1,
        marker: item.marker,
        type: "song",
        recording: recordingFromFields(item.title, item.version),
        artistHint: item.artistHint,
        spotifyMatchPolicy: spotifyUnavailable ? "unavailable" : matchPolicyForVersion(item.version),
        spotify: {
          status: spotifyMatched ? "matched" : "unmatched",
          trackId: spotifyMatched ? item.spotifyTrack.id : null,
          uri: spotifyMatched ? item.spotifyTrack.uri : null,
          matchedTitle: spotifyMatched ? item.spotifyTrack.name : null,
          matchedArtist: spotifyMatched ? spotifyTrackArtist(item.spotifyTrack) : null,
          artworkUrl: spotifyMatched ? spotifyTrackArtwork(item.spotifyTrack) : null,
          albumName: spotifyMatched ? item.spotifyTrack.album?.name || null : null
        }
      };
    });
  }

  function eventFromPageImport() {
    const sourceName = elements.pageImportSourceName.value.trim();
    const sourceUrl = elements.pageImportSourceUrl.value.trim();
    const referenceSource = state.importDraft?.event?.llFansSource;
    const sources = sourceName || sourceUrl
      ? [{
          type: sourceUrl.includes("x.com") ? "x" : "web",
          name: sourceName || "Source",
          url: sourceUrl,
          priority: "primary"
        }]
      : [];
    if (referenceSource?.url && referenceSource.url !== sourceUrl) {
      sources.push(deepClone(referenceSource));
    }
    return {
      schemaVersion: "0.3",
      id: elements.pageImportEventId.value.trim(),
      title: elements.pageImportEventTitle.value.trim(),
      series: elements.pageImportSeries.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      sources,
      performances: []
    };
  }

  function performanceFromImportDraft(performance) {
    return {
      id: performance.id,
      label: performance.label,
      day: performance.day ?? null,
      session: performance.session || null,
      date: performance.date,
      venue: {
        name: performance.venue.name,
        city: performance.venue.city,
        countryCode: performance.venue.countryCode || "JP"
      },
      setlist: schemaSetlistFromDraft(performance.setlist),
      spotifyPlaylist: {
        status: "not_created",
        playlistId: null,
        url: null
      }
    };
  }

  function performancesFromPageImport() {
    syncActiveImportPerformance();
    return (state.importDraft?.performances || []).map(performanceFromImportDraft);
  }

  function savePageImport(event) {
    return savePageImportWithOptions(event);
  }

  function savePageImportWithOptions(event, { skipSpotifyReview = false } = {}) {
    event.preventDefault();
    if (!state.importDraft) return;

    const isNewEvent = elements.pageImportDestination.value === "__new__";
    const targetEvent = isNewEvent
      ? eventFromPageImport()
      : state.database.events.find(
          (candidate) => candidate.id === elements.pageImportDestination.value
        );
    if (!targetEvent) {
      showValidation(elements.pageImportErrors, ["登録先のイベントが見つかりません。"]);
      return;
    }

    const performances = performancesFromPageImport();
    const errors = [...(isNewEvent ? validateEvent(targetEvent) : [])];
    const validationOwner = {
      performances: [...targetEvent.performances]
    };
    for (const performance of performances) {
      errors.push(...validatePerformance(performance, validationOwner, null));
      validationOwner.performances.push(performance);
    }
    if (errors.length) {
      showValidation(elements.pageImportErrors, [...new Set(errors)]);
      return;
    }

    if (!skipSpotifyReview) {
      const unresolved = collectUnresolvedSpotifySongs();
      if (unresolved.length) {
        hideValidation(elements.pageImportErrors);
        startSpotifyReview(unresolved);
        return;
      }
    }

    if (isNewEvent) {
      state.database.events.push(targetEvent);
    } else {
      const referenceSource = state.importDraft?.event?.llFansSource;
      const hasReference = targetEvent.sources.some(
        (source) => source?.url === referenceSource?.url
      );
      if (referenceSource?.url && !hasReference) {
        targetEvent.sources.push(deepClone(referenceSource));
      }
    }
    targetEvent.performances.push(...performances);
    state.selectedEventId = targetEvent.id;
    persist();
    if (state.llfansSyncActive) recordLlFansSyncResult("added");
    closePageImport(false);
    render();
    const songCount = performances.reduce((sum, performance) => sum + performance.setlist.length, 0);
    if (state.llfansSyncActive) scheduleNextLlFansSyncItem();
    setSaveState(`${performances.length}公演・${songCount}曲を登録しました`);
  }

  function openPerformance(index = null) {
    readEventFormIntoState(false);
    const event = selectedEvent();
    if (!event) return;
    state.editingPerformanceIndex = index;

    const performance = index === null
      ? blankPerformance()
      : deepClone(event.performances[index]);

    elements.performanceDialogTitle.textContent =
      index === null ? "公演を追加" : "公演を編集";
    elements.performanceId.value = performance.id;
    elements.performanceLabel.value = performance.label;
    elements.performanceDay.value = performance.day ?? "";
    elements.performanceSession.value = performance.session ?? "";
    elements.performanceDate.value = performance.date ?? "";
    elements.venueCountry.value = performance.venue?.countryCode ?? "JP";
    elements.venueName.value = performance.venue?.name ?? "";
    elements.venueCity.value = performance.venue?.city ?? "";
    elements.setlistPaste.value = "";
    elements.replaceSetlist.checked = false;
    elements.editorSpotifySummary.textContent =
      "登録済みの曲も含めて、曲名だけでSpotifyを一括再検索できます。";
    state.draftSetlist = deepClone(performance.setlist || []);
    renumberSetlist();
    hideValidation(elements.performanceErrors);
    renderSetlistRows();
    elements.performanceDialog.showModal();
  }

  function closePerformance() {
    elements.performanceDialog.close();
    state.editingPerformanceIndex = null;
    state.draftSetlist = [];
  }

  function performanceFromForm() {
    syncSetlistFromRows();
    const dayValue = elements.performanceDay.value.trim();
    return {
      id: elements.performanceId.value.trim(),
      label: elements.performanceLabel.value.trim(),
      day: dayValue ? Number(dayValue) : null,
      session: elements.performanceSession.value || null,
      date: elements.performanceDate.value,
      venue: {
        name: elements.venueName.value.trim(),
        city: elements.venueCity.value.trim(),
        countryCode: elements.venueCountry.value.trim().toUpperCase() || "JP"
      },
      setlist: deepClone(state.draftSetlist),
      spotifyPlaylist: {
        status: "not_created",
        playlistId: null,
        url: null
      }
    };
  }

  function validatePerformance(
    performance,
    ownerEvent = selectedEvent(),
    editingIndex = state.editingPerformanceIndex
  ) {
    const errors = [];
    if (!performance.id) errors.push("公演IDは必須です。");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(performance.id)) {
      errors.push("公演IDは半角英小文字・数字・ハイフン・アンダースコアで入力してください。");
    }
    if (!performance.label) errors.push("表示名は必須です。");
    if (!performance.date) errors.push("開催日は必須です。");
    if (!performance.venue.name) errors.push("会場は必須です。");

    const duplicate = ownerEvent?.performances.find(
      (candidate, index) =>
        index !== editingIndex &&
        candidate.id === performance.id
    );
    if (duplicate) errors.push(`公演ID「${performance.id}」は既に使われています。`);

    const markers = new Set();
    performance.setlist.forEach((item, index) => {
      if (!item.marker) errors.push(`${index + 1}曲目の番号が空です。`);
      if (!item.recording.baseTitle) errors.push(`${index + 1}曲目の曲名が空です。`);
      if (markers.has(item.marker)) errors.push(`番号「${item.marker}」が重複しています。`);
      markers.add(item.marker);
    });
    return [...new Set(errors)];
  }

  function savePerformance(event) {
    event.preventDefault();
    const performance = performanceFromForm();
    const errors = validatePerformance(performance);
    if (errors.length) {
      showValidation(elements.performanceErrors, errors);
      return;
    }

    const selected = selectedEvent();
    if (state.editingPerformanceIndex === null) {
      selected.performances.push(performance);
    } else {
      selected.performances[state.editingPerformanceIndex] = performance;
    }
    persist();
    closePerformance();
    render();
  }

  function duplicatePerformance(index) {
    const event = selectedEvent();
    const source = event.performances[index];
    const copy = deepClone(source);
    copy.id = `${source.id}-copy-${Date.now().toString(36)}`;
    copy.label = `${source.label} コピー`;
    event.performances.splice(index + 1, 0, copy);
    persist();
    render();
  }

  function deletePerformance(index) {
    const event = selectedEvent();
    const performance = event.performances[index];
    if (!confirm(`「${performance.label}」を削除しますか？`)) return;
    event.performances.splice(index, 1);
    persist();
    render();
  }

  function renderSetlistRows() {
    elements.setlistRows.replaceChildren();
    elements.setlistEmpty.classList.toggle("hidden", state.draftSetlist.length > 0);
    const template = $("#song-row-template");

    state.draftSetlist.forEach((item, index) => {
      const fragment = template.content.cloneNode(true);
      const row = fragment.querySelector("tr");
      row.dataset.index = String(index);
      row.dataset.spotifyDirty = "false";
      row.dataset.spotifySearched = "false";
      row._spotifyResults = [];
      fragment.querySelector(".song-order").textContent = String(index + 1);
      fragment.querySelector(".song-marker").value = item.marker || "";
      fragment.querySelector(".song-title").value = item.recording?.baseTitle || "";
      fragment.querySelector(".song-version").value = item.recording?.versionLabel || "";
      fragment.querySelector(".song-artist").value = item.artistHint || "";
      const policySelect = fragment.querySelector(".song-policy");
      policySelect.value = item.spotifyMatchPolicy || "exact";
      const spotifyUnavailable =
        item.spotifyMatchPolicy === "unavailable" ||
        item.spotify?.status === "unavailable" ||
        item.spotify?.status === "skipped";
      const spotifyMatched =
        !spotifyUnavailable && item.spotify?.status === "matched" && item.spotify?.trackId;
      const spotifyBadge = fragment.querySelector(".editor-spotify-badge");
      spotifyBadge.className =
        `editor-spotify-badge spotify-match-badge ${
          spotifyMatched ? "matched" : spotifyUnavailable ? "unavailable" : "idle"
        }`;
      spotifyBadge.textContent = spotifyMatched ? "登録済み" : spotifyUnavailable ? "未配信" : "未登録";
      spotifyBadge.title = spotifyMatched
        ? [item.spotify.matchedTitle, item.spotify.matchedArtist].filter(Boolean).join(" / ")
        : "";
      const researchButton = fragment.querySelector(".research-song");
      researchButton.textContent = spotifyMatched ? "Spotifyで再検索" : "Spotify検索";
      researchButton.addEventListener("click", () => openEditorSpotifyCandidateDialog(row));
      fragment.querySelectorAll(".song-title, .song-version").forEach((input) => {
        input.addEventListener("input", () => {
          row.dataset.spotifyDirty = "true";
          spotifyBadge.className = "editor-spotify-badge spotify-match-badge idle";
          spotifyBadge.textContent = "要再検索";
          spotifyBadge.title = "";
          researchButton.textContent = "Spotify検索";
          row.dataset.spotifySearched = "false";
          row._spotifyResults = [];
        });
      });
      policySelect.addEventListener("change", () => {
        row.dataset.spotifyDirty = "true";
        const unavailable = policySelect.value === "unavailable";
        spotifyBadge.className =
          `editor-spotify-badge spotify-match-badge ${unavailable ? "unavailable" : "idle"}`;
        spotifyBadge.textContent = unavailable ? "未配信" : "要再検索";
        spotifyBadge.title = "";
        researchButton.textContent = "Spotify検索";
        row.dataset.spotifySearched = "false";
        row._spotifyResults = [];
      });

      fragment.querySelector(".move-up").disabled = index === 0;
      fragment.querySelector(".move-down").disabled = index === state.draftSetlist.length - 1;
      fragment.querySelector(".move-up").addEventListener("click", () => moveSong(index, -1));
      fragment.querySelector(".move-down").addEventListener("click", () => moveSong(index, 1));
      fragment.querySelector(".remove-song").addEventListener("click", () => removeSong(index));
      elements.setlistRows.append(fragment);
    });
    elements.spotifyResearchAllButton.disabled =
      !window.SpotifyClient?.isConnected() || !state.draftSetlist.length;
  }

  function syncSetlistFromRows() {
    const rows = [...elements.setlistRows.querySelectorAll("tr")];
    state.draftSetlist = rows.map((row, index) => {
      const title = row.querySelector(".song-title").value.trim();
      const version = row.querySelector(".song-version").value.trim();
      const previous = state.draftSetlist[index] || blankSong(index);
      const spotifyMatchPolicy = row.querySelector(".song-policy").value;
      const spotifyUnavailable = spotifyMatchPolicy === "unavailable";
      return {
        ...previous,
        order: index + 1,
        marker: row.querySelector(".song-marker").value.trim(),
        type: "song",
        recording: recordingFromFields(title, version),
        artistHint: row.querySelector(".song-artist").value.trim(),
        spotifyMatchPolicy,
        spotify: spotifyUnavailable || row.dataset.spotifyDirty === "true"
          ? {
              status: "unmatched",
              trackId: null,
              uri: null,
              matchedTitle: null,
              matchedArtist: null
            }
          : previous.spotify || {
              status: "unmatched",
              trackId: null,
              uri: null,
              matchedTitle: null,
              matchedArtist: null
            }
      };
    });
  }

  function openEditorSpotifyCandidateDialog(row) {
    if (!window.SpotifyClient.isConnected()) {
      alert("先に画面上部の「Spotifyに接続」を押してください。");
      return;
    }
    resetSpotifyReviewUi();
    elements.spotifyCandidateDialogTitle.textContent = "Spotify曲を手動で選択";
    state.spotifyManualRow = row;
    state.spotifyManualContext = "editor";
    const marker = row.querySelector(".song-marker").value.trim();
    const title = row.querySelector(".song-title").value.trim();
    elements.spotifyCandidateSong.textContent = `${marker || "曲"}: ${title || "曲名未入力"}`;
    elements.spotifyManualQuery.value = title;
    const results = row._spotifyResults || [];
    renderSpotifyCandidateResults(results);
    elements.spotifyCandidateDialog.showModal();
    if (title && row.dataset.spotifySearched !== "true") searchSpotifyManually();
    else elements.spotifyManualQuery.focus();
  }

  async function researchDraftSetlistFromSpotify() {
    if (!window.SpotifyClient.isConnected()) {
      alert("先に画面上部の「Spotifyに接続」を押してください。");
      return;
    }

    syncSetlistFromRows();
    const rows = [...elements.setlistRows.querySelectorAll("tr")];
    if (!rows.length) return;

    const originalLabel = "Spotifyで全曲再検索";
    const cache = new Map();
    const counts = { matched: 0, fallback: 0, review: 0, unmatched: 0, unavailable: 0 };
    elements.spotifyResearchAllButton.disabled = true;

    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const title = row.querySelector(".song-title").value.trim();
        const version = row.querySelector(".song-version").value.trim();
        const matchPolicy = row.querySelector(".song-policy").value || "exact";
        const badge = row.querySelector(".editor-spotify-badge");
        const researchButton = row.querySelector(".research-song");
        elements.spotifyResearchAllButton.textContent = `${index + 1}/${rows.length}曲を検索中…`;
        elements.editorSpotifySummary.textContent =
          `${index + 1}/${rows.length}曲をSpotifyで再検索しています…`;
        badge.className = "editor-spotify-badge spotify-match-badge searching";
        badge.textContent = "検索中";
        researchButton.disabled = true;

        if (!title) {
          badge.className = "editor-spotify-badge spotify-match-badge unmatched";
          badge.textContent = "曲名なし";
          researchButton.textContent = "手動検索";
          row.dataset.spotifySearched = "true";
          counts.unmatched += 1;
          researchButton.disabled = false;
          continue;
        }

        if (matchPolicy === "unavailable") {
          badge.className = "editor-spotify-badge spotify-match-badge unavailable";
          badge.textContent = "未配信";
          researchButton.textContent = "Spotify検索";
          row.dataset.spotifySearched = "false";
          counts.unavailable += 1;
          researchButton.disabled = false;
          continue;
        }

        const cacheKey = `${window.KnownSongCache.songKey(title, version)}::${matchPolicy}`;
        let result = cache.get(cacheKey);
        if (!result) {
          result = await window.SpotifyClient.searchBestTrack({
            title,
            version,
            matchPolicy
          });
          cache.set(cacheKey, result);
        }

        if (result.status === "matched") {
          const track = result.track;
          const artist = spotifyTrackArtist(track);
          const item = state.draftSetlist[index];
          item.artistHint = artist;
          item.spotify = {
            status: "matched",
            trackId: track.id || null,
            uri: track.uri || null,
            matchedTitle: track.name || null,
            matchedArtist: artist || null,
            artworkUrl: spotifyTrackArtwork(track) || null,
            albumName: track.album?.name || null
          };
          row.querySelector(".song-artist").value = artist;
          row.dataset.spotifyDirty = "false";
          row.dataset.spotifySearched = "false";
          row._spotifyResults = [];
          badge.className = "editor-spotify-badge spotify-match-badge matched";
          badge.textContent = result.matchKind === "original_fallback"
            ? "原曲で補完"
            : result.matchKind === "version"
              ? "バージョン一致"
              : "曲名一致";
          badge.title = [track.name, artist].filter(Boolean).join(" / ");
          researchButton.textContent = "Spotifyで再検索";
          if (result.matchKind === "original_fallback") counts.fallback += 1;
          else counts.matched += 1;
        } else {
          const results = result.candidates?.length
            ? result.candidates
            : result.results || [];
          const needsReview = result.status === "ambiguous" || result.status === "manual";
          row._spotifyResults = results;
          row.dataset.spotifySearched = "true";
          badge.className =
            `editor-spotify-badge spotify-match-badge ${needsReview ? "ambiguous" : "unmatched"}`;
          badge.textContent = needsReview ? "候補複数" : "見つからず";
          badge.title = "現在登録されているSpotify情報は保持されています。";
          researchButton.textContent = results.length
            ? `候補を見る（${results.length}件）`
            : "手動検索";
          if (needsReview) counts.review += 1;
          else counts.unmatched += 1;
        }
        researchButton.disabled = false;
      }

      elements.editorSpotifySummary.textContent =
        `一括再検索: 一致 ${counts.matched}曲 / 原曲で補完 ${counts.fallback}曲 / 要確認 ${counts.review}曲 / 見つからず ${counts.unmatched}曲 / 未配信 ${counts.unavailable}曲。` +
        " 要確認・見つからずの曲は現在の登録を保持しています。最後に「公演を保存」を押してください。";
    } catch (error) {
      elements.editorSpotifySummary.textContent = `Spotify一括再検索を中断しました: ${error.message}`;
      alert(`Spotify一括再検索に失敗しました。\n${error.message}`);
    } finally {
      elements.spotifyResearchAllButton.textContent = originalLabel;
      elements.spotifyResearchAllButton.disabled =
        !window.SpotifyClient.isConnected() || !state.draftSetlist.length;
      rows.forEach((row) => {
        row.querySelector(".research-song").disabled = false;
      });
    }
  }

  function addSong() {
    syncSetlistFromRows();
    state.draftSetlist.push(blankSong(state.draftSetlist.length));
    renderSetlistRows();
    const lastRow = elements.setlistRows.lastElementChild;
    lastRow?.querySelector(".song-title")?.focus();
  }

  function moveSong(index, offset) {
    syncSetlistFromRows();
    const destination = index + offset;
    if (destination < 0 || destination >= state.draftSetlist.length) return;
    [state.draftSetlist[index], state.draftSetlist[destination]] =
      [state.draftSetlist[destination], state.draftSetlist[index]];
    renumberSetlist();
    renderSetlistRows();
  }

  function removeSong(index) {
    syncSetlistFromRows();
    state.draftSetlist.splice(index, 1);
    renumberSetlist();
    renderSetlistRows();
  }

  function renumberSetlist() {
    state.draftSetlist.forEach((item, index) => {
      item.order = index + 1;
    });
  }

  function parseSetlistLine(line, index) {
    const clean = line.trim();
    if (!clean) return null;

    const markerMatch = clean.match(
      /^(M\d+(?:-\d+)?|EN\d*|WEN\d*|アンコール\d*)\s*[.．:：\-]?\s*(.+)$/i
    );
    const marker = markerMatch
      ? markerMatch[1].toUpperCase()
      : `M${String(index + 1).padStart(2, "0")}`;
    let titlePart = markerMatch ? markerMatch[2].trim() : clean;

    let version = "";
    const versionMatch = titlePart.match(/[（(]([^）)]+)[）)]\s*$/);
    if (versionMatch) {
      const candidate = versionMatch[1].trim();
      if (/ver|version|期|size|人|b\.?\s*g\.?\s*p/i.test(candidate)) {
        version = candidate;
        titlePart = titlePart.slice(0, versionMatch.index).trim();
      }
    }

    const song = blankSong(index);
    song.marker = marker;
    song.recording = recordingFromFields(titlePart, version);
    song.spotifyMatchPolicy = matchPolicyForVersion(version);
    return song;
  }

  function parsePastedSetlist() {
    syncSetlistFromRows();
    const lines = elements.setlistPaste.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsed = lines
      .map((line, index) => parseSetlistLine(line, index))
      .filter(Boolean);

    if (!parsed.length) {
      alert("取り込める曲がありませんでした。");
      return;
    }

    if (elements.replaceSetlist.checked) {
      state.draftSetlist = parsed;
    } else {
      state.draftSetlist.push(...parsed);
    }
    renumberSetlist();
    renderSetlistRows();
    elements.setlistPaste.value = "";
  }

  function generatePerformanceId() {
    const parts = [
      elements.performanceLabel.value,
      elements.performanceDate.value,
      elements.performanceSession.value
    ].filter(Boolean).join(" ");
    elements.performanceId.value = stableSlug(parts || `performance-${Date.now()}`, "performance");
  }

  function updateGitHubPublishUi() {
    const status = state.githubPublishStatus;
    const selected = selectedEvent();
    const stateElement = elements.githubPublishState;
    const button = elements.publishGithubButton;
    stateElement.classList.remove("ready", "published");

    if (state.githubPublishing) {
      stateElement.textContent = "GitHubへ公開中";
      button.textContent = "commit・push中…";
      button.disabled = true;
      return;
    }

    button.textContent = "GitHubへ公開";
    if (!status) {
      stateElement.textContent = "GitHub確認中";
      button.disabled = true;
      return;
    }
    if (!status.available) {
      stateElement.textContent = "公開サーバー未接続";
      button.title = status.error || "server.pyを再起動してください。";
      button.disabled = true;
      return;
    }
    if (!status.remoteConfigured) {
      stateElement.textContent = "GitHub未設定";
      stateElement.classList.add("ready");
      button.title = "originリモートを追加すると公開できます。";
      button.disabled = !selected;
      return;
    }
    if (!status.identityConfigured) {
      stateElement.textContent = "Gitユーザー未設定";
      stateElement.classList.add("ready");
      button.title = "Gitのuser.nameとuser.emailを設定してください。";
      button.disabled = !selected;
      return;
    }
    if (
      status.publishedEventId === selected?.id &&
      status.publishedRevision &&
      !state.dirty
    ) {
      stateElement.textContent = `公開済み ${status.publishedRevision}`;
      stateElement.classList.add("published");
    } else {
      stateElement.textContent = `GitHub: ${status.branch || "準備完了"}`;
      stateElement.classList.add("ready");
    }
    button.title = "公開JSONを保存し、プロジェクトの変更をcommit・pushします。";
    button.disabled = !selected;
  }

  async function refreshGitHubPublishStatus() {
    try {
      const response = await fetch("/api/github-publish-status", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("server.pyを再起動してください。");
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GitHub公開状態を取得できません。");
      state.githubPublishStatus = result;
    } catch (error) {
      state.githubPublishStatus = {
        available: false,
        remoteConfigured: false,
        identityConfigured: false,
        branch: "",
        publishToken: "",
        error: error.message
      };
    }
    updateGitHubPublishUi();
  }

  async function publishSelectedEventToGitHub() {
    readEventFormIntoState(false);
    const event = selectedEvent();
    if (!event) return;
    const errors = validateEvent(event);
    if (errors.length) {
      showValidation(elements.eventErrors, errors);
      return;
    }

    const status = state.githubPublishStatus;
    if (!status?.available || !status.publishToken) {
      alert(status?.error || "server.pyを再起動してください。");
      return;
    }
    if (!status.remoteConfigured) {
      alert("GitHubリポジトリが未設定です。\n先にoriginリモートを追加し、管理画面を再読み込みしてください。");
      return;
    }
    if (!status.identityConfigured) {
      alert("Gitのuser.nameとuser.emailを設定し、管理画面を再読み込みしてください。");
      return;
    }

    const confirmed = confirm(
      `「${event.title}」をGitHubへ公開します。\n\n` +
      "・選択中イベントをdata/へ保存\n" +
      "・data/index.jsonを更新\n" +
      "・このプロジェクト内の変更をすべてcommit\n" +
      "・GitHubへpush\n\n続けますか？"
    );
    if (!confirmed) return;

    hideValidation(elements.eventErrors);
    persist();
    state.githubPublishing = true;
    updateGitHubPublishUi();
    try {
      const response = await fetch("/api/github-publish", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          publishToken: status.publishToken,
          event: deepClone(event)
        })
      });
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("公開用サーバーから正しい応答がありません。");
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GitHubへ公開できませんでした。");
      state.githubPublishStatus = {
        ...status,
        available: true,
        publishedEventId: event.id,
        publishedRevision: result.revision || ""
      };
      alert(
        `${result.filename}をGitHubへpushしました。` +
        (result.revision ? `\ncommit: ${result.revision}` : "") +
        "\nGitHub Actionsの完了後に公開ページへ反映されます。"
      );
    } catch (error) {
      alert(`GitHubへ公開できませんでした。\n${error.message}`);
    } finally {
      state.githubPublishing = false;
      updateGitHubPublishUi();
    }
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportSelectedEvent() {
    readEventFormIntoState(false);
    const event = selectedEvent();
    if (!event) return;
    const errors = validateEvent(event);
    if (errors.length) {
      showValidation(elements.eventErrors, errors);
      return;
    }
    downloadJson(`${event.id}.json`, event);
  }

  function exportAll() {
    readEventFormIntoState(false);
    downloadJson("setlist-admin-backup.json", {
      ...state.database,
      confirmedSpotifyMappings: readConfirmedSpotifyMappings()
    });
  }

  async function importJson(file) {
    const raw = JSON.parse(await file.text());
    if (
      raw.confirmedSpotifyMappings &&
      typeof raw.confirmedSpotifyMappings === "object" &&
      !Array.isArray(raw.confirmedSpotifyMappings)
    ) {
      localStorage.setItem(
        CONFIRMED_SPOTIFY_KEY,
        JSON.stringify({
          ...readConfirmedSpotifyMappings(),
          ...raw.confirmedSpotifyMappings
        })
      );
    }
    const incomingEvents = Array.isArray(raw.events)
      ? raw.events
      : [raw];

    const normalized = incomingEvents.map(normalizeEvent);
    for (const event of normalized) {
      const existingIndex = state.database.events.findIndex(
        (candidate) => candidate.id === event.id
      );
      if (existingIndex >= 0) {
        const replace = confirm(
          `イベントID「${event.id}」は既にあります。上書きしますか？`
        );
        if (replace) state.database.events[existingIndex] = event;
        else {
          event.id = `${event.id}-import-${Date.now().toString(36)}`;
          state.database.events.push(event);
        }
      } else {
        state.database.events.push(event);
      }
      state.selectedEventId = event.id;
    }
    persist();
    render();
  }

  function resetDatabase() {
    if (!confirm("ローカルの管理データをすべて初期化しますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SELECTED_KEY);
    localStorage.removeItem(CONFIRMED_SPOTIFY_KEY);
    location.reload();
  }

  function showValidation(element, errors) {
    element.innerHTML = `<ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`;
    element.classList.remove("hidden");
  }

  function hideValidation(element) {
    element.replaceChildren();
    element.classList.add("hidden");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  ["input", "change"].forEach((eventName) => {
    [elements.eventId, elements.eventTitle, elements.eventSeries, elements.sourceName, elements.sourceUrl]
      .forEach((element) => element.addEventListener(eventName, () => {
        readEventFormIntoState(true);
        renderEventList();
      }));
  });

  $("#new-event-button").addEventListener("click", newEvent);
  $("#save-event-button").addEventListener("click", saveEvent);
  $("#duplicate-event-button").addEventListener("click", duplicateEvent);
  $("#delete-event-button").addEventListener("click", deleteEvent);
  $("#llfans-sync-button").addEventListener("click", openLlFansSync);
  $("#close-llfans-sync-button").addEventListener("click", closeLlFansSync);
  $("#cancel-llfans-sync-button").addEventListener("click", closeLlFansSync);
  elements.refreshLlFansSyncButton.addEventListener("click", () => loadLlFansSyncCatalog(true));
  elements.llfansSyncSearch.addEventListener("input", renderLlFansSyncCatalog);
  elements.llfansSyncSeries.addEventListener("change", renderLlFansSyncCatalog);
  elements.toggleLlFansSyncVisibleButton.addEventListener("click", toggleVisibleLlFansSyncEvents);
  elements.startLlFansSyncButton.addEventListener("click", startLlFansSync);
  $("#page-import-button").addEventListener("click", openPageImport);
  $("#close-page-import-button").addEventListener("click", closePageImport);
  $("#cancel-page-import-button").addEventListener("click", closePageImport);
  elements.parsePageImportUrlButton.addEventListener("click", parsePageImportUrl);
  $("#parse-page-import-button").addEventListener("click", parsePageImportText);
  $("#page-import-form").addEventListener("submit", savePageImport);
  elements.spotifyConnectButton.addEventListener("click", handleSpotifyConnection);
  elements.spotifyEnrichButton.addEventListener("click", enrichArtistsFromSpotify);
  $("#close-spotify-candidate-button").addEventListener("click", closeSpotifyCandidateDialog);
  $("#cancel-spotify-candidate-button").addEventListener("click", closeSpotifyCandidateDialog);
  elements.spotifyUnavailableButton.addEventListener("click", markCurrentSpotifyReviewSongUnavailable);
  elements.spotifyManualSearchButton.addEventListener("click", searchSpotifyManually);
  elements.spotifyManualQuery.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchSpotifyManually();
  });
  elements.spotifyCandidateDialog.addEventListener("close", () => {
    state.spotifyManualRow = null;
    state.spotifyManualContext = null;
  });
  elements.spotifyCandidateDialog.addEventListener("cancel", (event) => {
    if (!state.spotifyReviewActive) return;
    event.preventDefault();
    cancelSpotifyReview();
  });
  elements.pageImportDialog.addEventListener("cancel", (event) => {
    if (!state.llfansSyncActive) return;
    event.preventDefault();
    closePageImport(true);
  });
  elements.pageImportDestination.addEventListener("change", updatePageImportDestination);
  elements.pageImportPerformanceSelector.addEventListener("change", () => {
    selectImportPerformance(elements.pageImportPerformanceSelector.value);
  });
  $("#add-performance-button").addEventListener("click", () => openPerformance(null));
  $("#close-performance-button").addEventListener("click", closePerformance);
  $("#cancel-performance-button").addEventListener("click", closePerformance);
  $("#performance-form").addEventListener("submit", savePerformance);
  elements.spotifyResearchAllButton.addEventListener("click", researchDraftSetlistFromSpotify);
  $("#add-song-button").addEventListener("click", addSong);
  $("#parse-setlist-button").addEventListener("click", parsePastedSetlist);
  $("#generate-performance-id").addEventListener("click", generatePerformanceId);
  elements.publishGithubButton.addEventListener("click", publishSelectedEventToGitHub);
  $("#export-event-button").addEventListener("click", exportSelectedEvent);
  $("#export-all-button").addEventListener("click", exportAll);
  $("#import-button").addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      await importJson(file);
    } catch (error) {
      alert(`JSONの読み込みに失敗しました。\n${error.message}`);
    } finally {
      elements.importFile.value = "";
    }
  });
  $("#reset-button").addEventListener("click", resetDatabase);

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  async function initializeApp() {
    const callbackError = sessionStorage.getItem("setlist_admin_spotify_callback_error_v01");
    if (callbackError) {
      sessionStorage.removeItem("setlist_admin_spotify_callback_error_v01");
      alert(`Spotify接続を完了できませんでした。\n${callbackError}`);
    }
    try {
      await window.SpotifyClient.initialize();
    } catch (error) {
      console.error("Spotify initialization failed", error);
      alert(`Spotify接続を完了できませんでした。\n${error.message}`);
    }
    await load();
    await refreshGitHubPublishStatus();
    updateSpotifyUi();
  }

  initializeApp().catch((error) => {
    console.error(error);
    setSaveState(`エラー: ${error.message}`);
    alert(error.message);
  });
})();
