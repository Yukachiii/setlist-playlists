(function (root, factory) {
  // LL-Fans pasted-text parser used by the admin page.
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SetlistPageParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cleanLines(rawText) {
    return String(rawText ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function normalized(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function findLabel(lines, label, start = 0) {
    const target = normalized(label);
    return lines.findIndex((line, index) => index >= start && normalized(line) === target);
  }

  function valueAfter(lines, label, start = 0) {
    const index = findLabel(lines, label, start);
    return index >= 0 ? lines[index + 1] || "" : "";
  }

  function parseJapaneseDate(value) {
    const match = normalized(value).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (!match) return "";
    return [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
  }

  function dayNumber(firstDate, performanceDate) {
    if (!firstDate || !performanceDate) return null;
    const first = Date.parse(`${firstDate}T00:00:00Z`);
    const current = Date.parse(`${performanceDate}T00:00:00Z`);
    if (!Number.isFinite(first) || !Number.isFinite(current) || current < first) return null;
    return Math.floor((current - first) / 86400000) + 1;
  }

  function asciiSlug(value) {
    return normalized(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  const SERIES_ID_RULES = [
    [/虹ヶ咲|ニジガク|nijigasaki/i, "nijigasaki"],
    [/イキヅライブ|いきづらい部|ikizulive|lovelive!?\s*bluebird/i, "ikizulive"],
    [/蓮ノ空|hasunosora/i, "hasunosora"],
    [/liella|スーパースター/i, "liella"],
    [/aqours|サンシャイン/i, "aqours"],
    [/μ\s*['’]?s|ミューズ|音ノ木坂/i, "muse"],
    [/スクールアイドルミュージカル/i, "school-idol-musical"]
  ];

  function seriesIdFromName(seriesName) {
    const source = normalized(seriesName);
    for (const [pattern, seriesId] of SERIES_ID_RULES) {
      if (pattern.test(source)) return seriesId;
    }
    return asciiSlug(source);
  }

  function sourceIdFromUrl(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      const sourceId = url.searchParams.get("_id") || url.pathname.split("/").filter(Boolean).pop();
      return asciiSlug(sourceId);
    } catch (_error) {
      return "";
    }
  }

  function titledId(seriesId, title, sourceUrl) {
    const titleSlug = asciiSlug(title) || sourceIdFromUrl(sourceUrl);
    if (!seriesId) return titleSlug;
    if (!titleSlug || titleSlug === seriesId || titleSlug.startsWith(seriesId + "-")) {
      return titleSlug || seriesId;
    }
    return seriesId + "-" + titleSlug;
  }

  function performanceIdSuggestion(seriesId, title, sourceUrl, day) {
    const base = titledId(seriesId, title, sourceUrl);
    return day && day > 1 ? base + "-day-" + day : base;
  }

  function parseTitleAndVersion(rawTitle) {
    let title = String(rawTitle ?? "").trim();
    let version = "";
    const match = title.match(/[（(]([^）)]+)[）)]\s*$/);
    if (match && /ver|version|期|size|人|b\.?\s*g\.?\s*p/i.test(match[1])) {
      version = match[1].trim();
      title = title.slice(0, match.index).trim();
    }
    return { title, version };
  }

  function parseMarker(line) {
    const match = normalized(line).match(/^(M|EN|WEN)\s*0*(\d+)(?:\s*[.．:：-]\s*(.*))?$/i);
    if (!match) return null;
    return {
      marker: `${match[1].toUpperCase()}${String(Number(match[2])).padStart(2, "0")}`,
      inlineTitle: (match[3] || "").trim()
    };
  }

  function parseSetlist(lines, startIndex) {
    const setlist = [];
    for (let index = Math.max(0, startIndex); index < lines.length; index += 1) {
      const marker = parseMarker(lines[index]);
      if (!marker) continue;

      let rawTitle = marker.inlineTitle;
      if (!rawTitle) {
        for (let next = index + 1; next < lines.length; next += 1) {
          if (parseMarker(lines[next])) break;
          if (/^(初|衣装情報を全て表示)$/i.test(normalized(lines[next]))) continue;
          rawTitle = lines[next];
          break;
        }
      }
      if (!rawTitle) continue;

      const recording = parseTitleAndVersion(rawTitle);
      setlist.push({
        marker: marker.marker,
        title: recording.title,
        version: recording.version,
        artistHint: ""
      });
    }
    return setlist;
  }

  function parseLlFansPage(rawText) {
    const lines = cleanLines(rawText);
    const audienceIndex = findLabel(lines, "有観客");
    const setlistHeading = findLabel(lines, "セットリスト", Math.max(0, audienceIndex));

    const eventHeading = findLabel(lines, "イベント・TV出演");
    const eventTitle = eventHeading >= 0 ? lines[eventHeading + 1] || "" : "";
    const seriesName = valueAfter(lines, "ライブ・ファンミ");
    const seriesId = seriesIdFromName(seriesName);
    const sourceUrl = valueAfter(lines, "公式ページ");
    const venueName = valueAfter(lines, "会場");

    const firstScheduleValue = valueAfter(lines, "日程");
    const firstDate = parseJapaneseDate(firstScheduleValue);
    const performanceScheduleValue = audienceIndex >= 0
      ? valueAfter(lines, "日程", audienceIndex)
      : firstScheduleValue;
    const performanceDate = parseJapaneseDate(performanceScheduleValue);
    const day = dayNumber(firstDate, performanceDate);
    const performanceLabel = day
      ? `Day ${day}`
      : performanceDate
        ? `${performanceDate} 公演`
        : "公演";

    const setlist = parseSetlist(lines, setlistHeading >= 0 ? setlistHeading + 1 : 0);
    const warnings = [];
    if (!eventTitle) warnings.push("イベント名を抽出できませんでした。");
    if (seriesName && !seriesId) warnings.push("シリーズ名をローマ字IDへ変換できませんでした。");
    if (!performanceDate) warnings.push("公演日を抽出できませんでした。");
    if (!venueName) warnings.push("会場を抽出できませんでした。");
    if (!setlist.length) warnings.push("M01やEN01形式の曲を抽出できませんでした。");

    return {
      event: {
        idSuggestion: titledId(seriesId, eventTitle, sourceUrl),
        title: eventTitle,
        series: seriesId ? [seriesId] : [],
        source: sourceUrl
          ? { type: "web", name: "公式ページ", url: sourceUrl, priority: "primary" }
          : null
      },
      performance: {
        idSuggestion: performanceIdSuggestion(seriesId, eventTitle, sourceUrl, day),
        label: performanceLabel,
        day,
        session: null,
        date: performanceDate,
        venue: {
          name: venueName,
          city: "",
          countryCode: "JP"
        }
      },
      setlist,
      warnings
    };
  }

  return { parseLlFansPage };
});
