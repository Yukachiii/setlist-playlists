from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
import re
import secrets
import subprocess
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any


GRAPHQL_URL = "https://ll-fans.jp/api/graphql"
EVENT_PATH = re.compile(r"^/data/event/(?P<id>\d+)/?$")
PUBLISH_EVENT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
PROJECT_DIRECTORY = Path(__file__).resolve().parent
PUBLISH_TOKEN = secrets.token_urlsafe(32)
PUBLISH_LOCK = threading.Lock()
MAX_PUBLISH_BODY = 50 * 1024 * 1024
SERIES_SLUGS = {
    "1": "muse",
    "2": "aqours",
    "3": "nijigasaki",
    "4": "liella",
    "5": "school-idol-musical",
    "6": "hasunosora",
    "7": "yohane",
    "8": "ikizulive",
}
LOCATION_SLUGS = (
    ("東京", "tokyo"),
    ("大阪", "osaka"),
    ("愛知", "aichi"),
    ("名古屋", "nagoya"),
    ("千葉", "chiba"),
    ("神奈川", "kanagawa"),
    ("横浜", "yokohama"),
    ("埼玉", "saitama"),
    ("福岡", "fukuoka"),
    ("兵庫", "hyogo"),
    ("神戸", "kobe"),
    ("京都", "kyoto"),
    ("宮城", "miyagi"),
    ("仙台", "sendai"),
    ("北海道", "hokkaido"),
    ("札幌", "sapporo"),
    ("広島", "hiroshima"),
    ("石川", "ishikawa"),
    ("静岡", "shizuoka"),
    ("沖縄", "okinawa"),
    ("群馬", "gunma"),
    ("栃木", "tochigi"),
    ("茨城", "ibaraki"),
    ("山梨", "yamanashi"),
    ("長野", "nagano"),
    ("新潟", "niigata"),
    ("岡山", "okayama"),
    ("香川", "kagawa"),
    ("熊本", "kumamoto"),
)

TOUR_QUERY = r"""
query AdminTourImport($id: ID!) {
  tour(id: $id) {
    id
    name
    note
    url
    startsOn
    endsOn
    seriesIds
    concerts {
      id
      name
      note
      startsOn
      endsOn
      venueId
      venue { id name }
      performances {
        id
        name
        date
        note
        openTime
        startTime
        setlists {
          id
          order
          note
          contentId
          contentType
          contentTypeOther
          content {
            __typename
            ... on Song { id name }
          }
        }
      }
    }
  }
  seriesList { id name }
}
"""


TOUR_INDEX_QUERY = r"""
query AdminTourIndex($first: Int!, $page: Int!) {
  tours(first: $first, page: $page) {
    data {
      id
      name
      startsOn
      endsOn
      seriesIds
    }
    paginatorInfo {
      currentPage
      lastPage
      total
    }
  }
}
"""

TOUR_INDEX_LOCK = threading.Lock()
TOUR_INDEX_CACHE_TTL = 10 * 60
TOUR_INDEX_CACHE: tuple[float, dict[str, Any]] | None = None


class ImportErrorResponse(RuntimeError):
    pass


class PublishErrorResponse(RuntimeError):
    pass


def ascii_slug(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def event_id_suggestion(series_slug: str, title: str, source_id: str) -> str:
    title_slug = ascii_slug(title) or f"event-{source_id}"
    if not series_slug or title_slug == series_slug or title_slug.startswith(series_slug + "-"):
        return title_slug
    return f"{series_slug}-{title_slug}"


def location_slug(concert: dict[str, Any]) -> str:
    venue = concert.get("venue") or {}
    source = f"{concert.get('name') or ''} {venue.get('name') or ''}"
    for label, slug in LOCATION_SLUGS:
        if label in source:
            return slug
    return ascii_slug(source) or f"venue-{concert.get('id') or 'unknown'}"


def normalized_venue_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text or re.fullmatch(r"[-‐‑‒–—―ー－]+", text):
        return "-"
    return text


def performance_day(name: str) -> int | None:
    match = re.search(r"day\s*[.\s_-]*0*(\d+)", str(name or ""), re.IGNORECASE)
    return int(match.group(1)) if match else None


def version_from_note(note: Any) -> str:
    first_part = re.split(r"[｜|]", str(note or ""), maxsplit=1)[0].strip()
    if re.search(r"ver(?:sion)?\.?|ショート|short|tv\s*size", first_part, re.IGNORECASE):
        return first_part
    return ""


def song_setlist(entries: list[dict[str, Any]]) -> list[dict[str, str]]:
    prefix = "M"
    counters = {"M": 0, "EN": 0, "WEN": 0}
    songs: list[dict[str, str]] = []

    for entry in sorted(entries or [], key=lambda item: int(item.get("order") or 0)):
        other = str(entry.get("contentTypeOther") or "").strip()
        if re.search(r"w(?:double)?\s*encore|ダブルアンコール", other, re.IGNORECASE):
            prefix = "WEN"
        elif re.search(r"encore|アンコール", other, re.IGNORECASE):
            prefix = "EN"

        content = entry.get("content") or {}
        if content.get("__typename") != "Song" or not content.get("name"):
            continue

        counters[prefix] += 1
        songs.append(
            {
                "marker": f"{prefix}{counters[prefix]:02d}",
                "title": str(content["name"]).strip(),
                "version": version_from_note(entry.get("note")),
                "artistHint": "",
            }
        )
    return songs


def parse_event_url(value: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(str(value or "").strip())
    if parsed.scheme != "https" or parsed.hostname not in {"ll-fans.jp", "www.ll-fans.jp"}:
        raise ImportErrorResponse("https://ll-fans.jp/data/event/数字 のURLを入力してください。")
    match = EVENT_PATH.fullmatch(parsed.path)
    if not match:
        raise ImportErrorResponse("LL-Fansのイベント詳細URLを入力してください。")
    event_id = match.group("id")
    canonical = f"https://ll-fans.jp/data/event/{event_id}"
    return event_id, canonical


def fetch_tour(event_id: str) -> dict[str, Any]:
    body = json.dumps(
        {"query": TOUR_QUERY, "variables": {"id": event_id}},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Setlist-Playlists-Admin/0.3",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ImportErrorResponse("LL-Fansからデータを取得できませんでした。") from error

    if payload.get("errors"):
        message = payload["errors"][0].get("message") or "GraphQL error"
        raise ImportErrorResponse(f"LL-Fansのデータ取得に失敗しました: {message}")
    return payload


def fetch_tour_index_page(page: int, first: int = 100) -> dict[str, Any]:
    body = json.dumps(
        {
            "query": TOUR_INDEX_QUERY,
            "variables": {"first": first, "page": page},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Setlist-Playlists-Admin/0.3",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ImportErrorResponse(
            "LL-Fansから公演一覧を取得できませんでした。"
        ) from error

    if payload.get("errors"):
        message = payload["errors"][0].get("message") or "GraphQL error"
        raise ImportErrorResponse(f"LL-Fansの公演一覧取得に失敗しました: {message}")
    return payload


def convert_tour_index(tours: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for tour in tours:
        source_id = str(tour.get("id") or "").strip()
        title = str(tour.get("name") or "").strip()
        if not source_id or not title:
            continue
        series_ids = [str(value) for value in tour.get("seriesIds") or []]
        series = [SERIES_SLUGS[value] for value in series_ids if value in SERIES_SLUGS]
        primary_series = series[0] if series else ""
        events.append(
            {
                "sourceId": source_id,
                "title": title,
                "startsOn": str(tour.get("startsOn") or ""),
                "endsOn": str(tour.get("endsOn") or ""),
                "series": series,
                "idSuggestion": event_id_suggestion(primary_series, title, source_id),
                "sourceUrl": f"https://ll-fans.jp/data/event/{source_id}",
            }
        )

    def sort_key(item: dict[str, Any]) -> tuple[str, int]:
        try:
            numeric_id = int(item["sourceId"])
        except (TypeError, ValueError):
            numeric_id = 0
        return item.get("startsOn") or item.get("endsOn") or "", numeric_id

    return sorted(events, key=sort_key, reverse=True)


def fetch_tour_index(force: bool = False) -> dict[str, Any]:
    global TOUR_INDEX_CACHE
    with TOUR_INDEX_LOCK:
        now = time.monotonic()
        if (
            not force
            and TOUR_INDEX_CACHE is not None
            and now - TOUR_INDEX_CACHE[0] < TOUR_INDEX_CACHE_TTL
        ):
            return TOUR_INDEX_CACHE[1]

        page = 1
        last_page = 1
        total = 0
        tours: list[dict[str, Any]] = []
        while page <= last_page:
            payload = fetch_tour_index_page(page)
            page_data = ((payload.get("data") or {}).get("tours") or {})
            tours.extend(page_data.get("data") or [])
            paginator = page_data.get("paginatorInfo") or {}
            last_page = max(1, int(paginator.get("lastPage") or 1))
            total = int(paginator.get("total") or total)
            if page < last_page:
                time.sleep(0.35)
            page += 1

        result = {
            "events": convert_tour_index(tours),
            "total": total or len(tours),
            "cacheSeconds": TOUR_INDEX_CACHE_TTL,
        }
        TOUR_INDEX_CACHE = (time.monotonic(), result)
        return result


def convert_tour_payload(
    payload: dict[str, Any], event_id: str, canonical_url: str
) -> dict[str, Any]:
    data = payload.get("data") or {}
    tour = data.get("tour")
    if not tour:
        raise ImportErrorResponse(f"イベントID {event_id} が見つかりません。")

    series_ids = [str(value) for value in tour.get("seriesIds") or []]
    series = [SERIES_SLUGS[value] for value in series_ids if value in SERIES_SLUGS]
    primary_series = series[0] if series else ""
    suggested_event_id = event_id_suggestion(primary_series, tour.get("name") or "", event_id)
    official_url = str(tour.get("url") or "").strip()

    performances: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for concert in tour.get("concerts") or []:
        concert_name = str(concert.get("name") or "").strip()
        concert_slug = location_slug(concert)
        venue = concert.get("venue") or {}
        for raw_performance in concert.get("performances") or []:
            performance_name = str(raw_performance.get("name") or "").strip()
            suffix = ascii_slug(performance_name) or f"performance-{raw_performance.get('id') or len(performances) + 1}"
            base_id = f"{suggested_event_id}-{concert_slug}-{suffix}"
            performance_id = base_id
            duplicate_suffix = 2
            while performance_id in used_ids:
                performance_id = f"{base_id}-{duplicate_suffix}"
                duplicate_suffix += 1
            used_ids.add(performance_id)

            setlist = song_setlist(raw_performance.get("setlists") or [])
            label = " ".join(value for value in (concert_name, performance_name) if value)
            performances.append(
                {
                    "idSuggestion": performance_id,
                    "label": label or f"公演 {len(performances) + 1}",
                    "day": performance_day(performance_name),
                    "session": None,
                    "date": str(raw_performance.get("date") or ""),
                    "venue": {
                        "name": normalized_venue_name(venue.get("name")),
                        "city": "",
                        "countryCode": "JP",
                    },
                    "setlist": setlist,
                }
            )

    warnings: list[str] = []
    if not performances:
        warnings.append("公演を取得できませんでした。")
    empty_labels = [item["label"] for item in performances if not item["setlist"]]
    if empty_labels:
        warnings.append("セットリストが空の公演: " + "、".join(empty_labels))

    source_url = official_url or canonical_url
    return {
        "event": {
            "idSuggestion": suggested_event_id,
            "title": str(tour.get("name") or ""),
            "series": series,
            "source": {
                "type": "web",
                "name": "公式ページ" if official_url else "LL-Fans",
                "url": source_url,
                "priority": "primary",
            },
            "llFansSource": {
                "type": "web",
                "name": "LL-Fans",
                "url": canonical_url,
                "priority": "reference",
            },
        },
        "performances": performances,
        "warnings": warnings,
        "sourcePage": canonical_url,
    }


def is_loopback_address(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return value.lower() == "localhost"


def validate_publish_event(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PublishErrorResponse("公開するイベントデータが不正です。")
    event_id = str(value.get("id") or "").strip()
    title = str(value.get("title") or "").strip()
    if not PUBLISH_EVENT_ID.fullmatch(event_id):
        raise PublishErrorResponse(
            "イベントIDは半角英小文字・数字・ハイフン・アンダースコアで入力してください。"
        )
    if not title:
        raise PublishErrorResponse("正式公演名は必須です。")
    if not isinstance(value.get("performances"), list):
        raise PublishErrorResponse("公演データが不正です。")
    normalized = dict(value)
    normalized["schemaVersion"] = str(value.get("schemaVersion") or "0.3")
    normalized["id"] = event_id
    normalized["title"] = title
    return normalized


def write_json_if_changed(path: Path, value: Any) -> bool:
    serialized = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == serialized:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    try:
        temporary.write_text(serialized, encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return True


def event_data_filename(event: dict[str, Any]) -> str:
    series = event.get("series")
    primary_series = series[0] if isinstance(series, list) and series else ""
    directory = ascii_slug(primary_series) or "other"
    return f"{directory}/{event['id']}.json"


def safe_manifest_data_path(data_directory: Path, entry: Any) -> Path | None:
    relative = PurePosixPath(str(entry or ""))
    if (
        relative.is_absolute()
        or not relative.parts
        or ".." in relative.parts
        or relative.suffix.lower() != ".json"
    ):
        return None
    candidate = data_directory.joinpath(*relative.parts).resolve()
    data_root = data_directory.resolve()
    if candidate == data_root or data_root not in candidate.parents:
        return None
    return candidate


def write_event_to_public_data(
    event: Any, project_directory: Path = PROJECT_DIRECTORY
) -> dict[str, Any]:
    normalized = validate_publish_event(event)
    data_directory = project_directory / "data"
    filename = event_data_filename(normalized)
    event_changed = write_json_if_changed(
        data_directory.joinpath(*PurePosixPath(filename).parts),
        normalized,
    )

    manifest_path = data_directory / "index.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise PublishErrorResponse("data/index.jsonを読み込めません。") from error
    else:
        manifest = {"schemaVersion": "0.3", "events": []}
    if not isinstance(manifest, dict) or not isinstance(manifest.get("events"), list):
        raise PublishErrorResponse("data/index.jsonの形式が不正です。")

    event_basename = f"{normalized['id']}.json"
    previous_entries = list(manifest["events"])
    next_entries: list[Any] = []
    inserted = False
    stale_entries: list[Any] = []
    for entry in previous_entries:
        entry_name = PurePosixPath(str(entry or "")).name
        if entry_name != event_basename:
            next_entries.append(entry)
            continue
        if str(entry) != filename:
            stale_entries.append(entry)
        if not inserted:
            next_entries.append(filename)
            inserted = True
    if not inserted:
        next_entries.append(filename)
    manifest["events"] = next_entries
    manifest_changed = next_entries != previous_entries
    manifest["schemaVersion"] = str(manifest.get("schemaVersion") or "0.3")
    if manifest_changed or not manifest_path.exists():
        write_json_if_changed(manifest_path, manifest)

    removed_legacy_files: list[str] = []
    for entry in stale_entries:
        stale_path = safe_manifest_data_path(data_directory, entry)
        if stale_path and stale_path.exists() and stale_path.is_file():
            stale_path.unlink()
            removed_legacy_files.append(str(entry))

    return {
        "filename": filename,
        "eventChanged": event_changed,
        "manifestChanged": manifest_changed,
        "removedLegacyFiles": removed_legacy_files,
    }


def validate_publish_events(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise PublishErrorResponse("公開するイベントがありません。")
    normalized = [validate_publish_event(event) for event in value]
    event_ids = [event["id"] for event in normalized]
    if len(event_ids) != len(set(event_ids)):
        raise PublishErrorResponse("同じイベントIDが複数存在します。")
    return normalized


def write_events_to_public_data(
    events: Any, project_directory: Path = PROJECT_DIRECTORY
) -> dict[str, Any]:
    normalized = validate_publish_events(events)
    results = [
        write_event_to_public_data(event, project_directory)
        for event in normalized
    ]
    changed_filenames = [
        result["filename"] for result in results if result["eventChanged"]
    ]
    filenames = [result["filename"] for result in results]
    return {
        "eventCount": len(results),
        "changedEventCount": len(changed_filenames),
        "filenames": filenames,
        "changedFilenames": changed_filenames,
        "manifestChanged": any(result["manifestChanged"] for result in results),
    }


def git_process(
    arguments: list[str],
    project_directory: Path = PROJECT_DIRECTORY,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            ["git", *arguments],
            cwd=project_directory,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            env=environment,
        )
    except FileNotFoundError as error:
        raise PublishErrorResponse("Gitが見つかりません。Gitをインストールしてください。") from error
    except subprocess.TimeoutExpired as error:
        raise PublishErrorResponse("GitHubへの処理がタイムアウトしました。") from error


def safe_git_message(result: subprocess.CompletedProcess[str]) -> str:
    message = (result.stderr or result.stdout or "Gitコマンドに失敗しました。").strip()
    message = re.sub(r"(https?://)[^@\s]+@", r"\1***@", message)
    return message[-1000:]


def git_repository_status(project_directory: Path = PROJECT_DIRECTORY) -> dict[str, Any]:
    try:
        inside = git_process(
            ["rev-parse", "--is-inside-work-tree"], project_directory
        )
    except PublishErrorResponse as error:
        return {
            "available": False,
            "remoteConfigured": False,
            "identityConfigured": False,
            "branch": "",
            "error": str(error),
        }
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {
            "available": False,
            "remoteConfigured": False,
            "identityConfigured": False,
            "branch": "",
            "error": "このプロジェクトはGitリポジトリではありません。",
        }

    root_result = git_process(["rev-parse", "--show-toplevel"], project_directory)
    root_matches = (
        root_result.returncode == 0
        and Path(root_result.stdout.strip()).resolve() == project_directory.resolve()
    )
    branch_result = git_process(["branch", "--show-current"], project_directory)
    remote_result = git_process(["remote", "get-url", "origin"], project_directory)
    name_result = git_process(["config", "--get", "user.name"], project_directory)
    email_result = git_process(["config", "--get", "user.email"], project_directory)
    return {
        "available": root_matches,
        "remoteConfigured": remote_result.returncode == 0 and bool(remote_result.stdout.strip()),
        "identityConfigured": (
            name_result.returncode == 0
            and bool(name_result.stdout.strip())
            and email_result.returncode == 0
            and bool(email_result.stdout.strip())
        ),
        "branch": branch_result.stdout.strip() if branch_result.returncode == 0 else "",
        "error": "" if root_matches else "プロジェクト直下のGitリポジトリを使用してください。",
    }


def require_git_publish_ready(project_directory: Path = PROJECT_DIRECTORY) -> dict[str, Any]:
    status = git_repository_status(project_directory)
    if not status["available"]:
        raise PublishErrorResponse(status["error"] or "Gitを利用できません。")
    if not status["remoteConfigured"]:
        raise PublishErrorResponse(
            "GitHubリポジトリが未設定です。先にoriginリモートを追加してください。"
        )
    if not status["identityConfigured"]:
        raise PublishErrorResponse("Gitのuser.nameとuser.emailを設定してください。")
    if not status["branch"]:
        raise PublishErrorResponse("現在のGitブランチを取得できません。")
    return status


def publish_events_to_github(
    events: Any, project_directory: Path = PROJECT_DIRECTORY
) -> dict[str, Any]:
    normalized_events = validate_publish_events(events)
    status = require_git_publish_ready(project_directory)
    with PUBLISH_LOCK:
        saved = write_events_to_public_data(normalized_events, project_directory)

        add_result = git_process(["add", "--all"], project_directory)
        if add_result.returncode != 0:
            raise PublishErrorResponse(f"Gitへの追加に失敗しました: {safe_git_message(add_result)}")

        diff_result = git_process(["diff", "--cached", "--quiet"], project_directory)
        if diff_result.returncode not in {0, 1}:
            raise PublishErrorResponse(f"変更確認に失敗しました: {safe_git_message(diff_result)}")

        committed = diff_result.returncode == 1
        if committed:
            if len(normalized_events) == 1:
                event = normalized_events[0]
                title = re.sub(r"\s+", " ", str(event.get("title") or "")).strip()
                message = f"Publish {title or event.get('id')}"[:120]
            else:
                message = f"Publish all setlist events ({len(normalized_events)})"
            commit_result = git_process(["commit", "-m", message], project_directory)
            if commit_result.returncode != 0:
                raise PublishErrorResponse(
                    f"commitに失敗しました: {safe_git_message(commit_result)}"
                )

        upstream_result = git_process(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
            project_directory,
        )
        if upstream_result.returncode == 0:
            fetch_result = git_process(["fetch", "origin"], project_directory, timeout=180)
            if fetch_result.returncode != 0:
                raise PublishErrorResponse(
                    "GitHubの最新状態を取得できませんでした。ローカルのcommitは保持されています: "
                    f"{safe_git_message(fetch_result)}"
                )

            rebase_result = git_process(["rebase", "@{u}"], project_directory, timeout=180)
            if rebase_result.returncode != 0:
                git_process(["rebase", "--abort"], project_directory)
                raise PublishErrorResponse(
                    "GitHub側の変更と自動統合できませんでした。ローカルのcommitは保持されています。"
                    "Codexの変更画面で競合を確認してください: "
                    f"{safe_git_message(rebase_result)}"
                )

        push_arguments = ["push"] if upstream_result.returncode == 0 else [
            "push",
            "--set-upstream",
            "origin",
            status["branch"],
        ]
        push_result = git_process(push_arguments, project_directory, timeout=180)
        if push_result.returncode != 0:
            raise PublishErrorResponse(
                "pushに失敗しました。ローカルのcommitは保持されています。"
                f"もう一度公開するとpushを再試行できます: {safe_git_message(push_result)}"
            )

        revision_result = git_process(["rev-parse", "--short", "HEAD"], project_directory)
        revision = revision_result.stdout.strip() if revision_result.returncode == 0 else ""
        return {
            **saved,
            "committed": committed,
            "pushed": True,
            "branch": status["branch"],
            "revision": revision,
        }


def publish_event_to_github(
    event: Any, project_directory: Path = PROJECT_DIRECTORY
) -> dict[str, Any]:
    return publish_events_to_github([event], project_directory)


class AdminHandler(SimpleHTTPRequestHandler):
    server_version = "SetlistAdmin/0.3"

    def is_local_request(self) -> bool:
        return is_loopback_address(self.client_address[0])

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/github-publish-status":
            if not self.is_local_request():
                self.send_json({"error": "ローカル端末からのみ利用できます。"}, status=403)
                return
            self.send_json({
                **git_repository_status(PROJECT_DIRECTORY),
                "publishToken": PUBLISH_TOKEN,
            })
            return

        if parsed.path == "/api/llfans-events":
            if not self.is_local_request():
                self.send_json({"error": "ローカル端末からのみ利用できます。"}, status=403)
                return
            query = urllib.parse.parse_qs(parsed.query)
            try:
                self.send_json(fetch_tour_index(force=query.get("refresh") == ["1"]))
            except ImportErrorResponse as error:
                self.send_json({"error": str(error)}, status=400)
            except Exception:
                self.send_json(
                    {"error": "LL-Fansの公演一覧取得中に予期しないエラーが発生しました。"},
                    status=500,
                )
            return

        if parsed.path != "/api/llfans-event":
            super().do_GET()
            return

        query = urllib.parse.parse_qs(parsed.query)
        try:
            event_id, canonical_url = parse_event_url(query.get("url", [""])[0])
            payload = fetch_tour(event_id)
            self.send_json(convert_tour_payload(payload, event_id, canonical_url))
        except ImportErrorResponse as error:
            self.send_json({"error": str(error)}, status=400)
        except Exception:
            self.send_json({"error": "一括取り込み中に予期しないエラーが発生しました。"}, status=500)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/github-publish":
            self.send_json({"error": "APIが見つかりません。"}, status=404)
            return
        if not self.is_local_request():
            self.send_json({"error": "ローカル端末からのみ利用できます。"}, status=403)
            return
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            self.send_json({"error": "JSON形式で送信してください。"}, status=415)
            return

        try:
            content_length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_PUBLISH_BODY:
            self.send_json({"error": "送信データのサイズが不正です。"}, status=413)
            return

        try:
            body = json.loads(self.rfile.read(content_length).decode("utf-8"))
            token = str(body.get("publishToken") or "") if isinstance(body, dict) else ""
            if not hmac.compare_digest(token, PUBLISH_TOKEN):
                self.send_json({"error": "公開操作の認証に失敗しました。画面を再読み込みしてください。"}, status=403)
                return
            events = body.get("events")
            if events is None and body.get("event") is not None:
                events = [body.get("event")]
            result = publish_events_to_github(events, PROJECT_DIRECTORY)
            self.send_json(result)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json({"error": "送信されたJSONを読み込めません。"}, status=400)
        except PublishErrorResponse as error:
            self.send_json({"error": str(error)}, status=400)
        except Exception:
            self.send_json({"error": "GitHubへの公開中に予期しないエラーが発生しました。"}, status=500)

    def send_json(self, value: Any, status: int = 200) -> None:
        body = (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Setlist Playlists Admin local server")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    handler = partial(AdminHandler, directory=str(PROJECT_DIRECTORY))
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"Serving Setlist Admin on http://{args.bind}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
