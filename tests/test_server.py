import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from server import (
    ImportErrorResponse,
    PublishErrorResponse,
    convert_tour_index,
    convert_tour_payload,
    normalized_venue_name,
    parse_event_url,
    publish_event_to_github,
    publish_events_to_github,
    validate_publish_event,
    validate_study_playlists,
    write_event_to_public_data,
    write_events_to_public_data,
)


class ServerImportTests(unittest.TestCase):
    def test_ll_fans_event_url_is_limited_to_event_pages(self):
        self.assertEqual(
            parse_event_url("https://ll-fans.jp/data/event/288"),
            ("288", "https://ll-fans.jp/data/event/288"),
        )
        with self.assertRaises(ImportErrorResponse):
            parse_event_url("https://example.com/data/event/288")
        with self.assertRaises(ImportErrorResponse):
            parse_event_url("https://ll-fans.jp/data/song/428")

    def test_tour_is_converted_to_multiple_performances_and_song_markers(self):
        payload = {
            "data": {
                "tour": {
                    "id": "288",
                    "name": "ラブライブ！虹ヶ咲学園スクールアイドル同好会 8th Live! TOKIMEKI Express",
                    "url": "https://example.test/official",
                    "seriesIds": ["3"],
                    "concerts": [
                        {
                            "id": "427",
                            "name": "大阪公演",
                            "venue": {"id": "23", "name": "大阪城ホール"},
                            "performances": [
                                {
                                    "id": "730",
                                    "name": "Day.1",
                                    "date": "2026-06-06",
                                    "setlists": [
                                        {
                                            "order": 0,
                                            "contentTypeOther": None,
                                            "note": None,
                                            "content": {
                                                "__typename": "Song",
                                                "id": "428",
                                                "name": "Colorful Dreams! Colorful Smiles!",
                                            },
                                        },
                                        {
                                            "order": 1,
                                            "contentTypeOther": "Encore",
                                            "note": "幕間映像",
                                            "content": None,
                                        },
                                        {
                                            "order": 2,
                                            "contentTypeOther": None,
                                            "note": "ショート Ver.｜出演者情報",
                                            "content": {
                                                "__typename": "Song",
                                                "id": "481",
                                                "name": "OUR P13CES!!!",
                                            },
                                        },
                                    ],
                                },
                                {
                                    "id": "731",
                                    "name": "Day.2",
                                    "date": "2026-06-07",
                                    "setlists": [],
                                },
                            ],
                        }
                    ],
                },
                "seriesList": [{"id": "3", "name": "虹ヶ咲学園スクールアイドル同好会"}],
            }
        }

        result = convert_tour_payload(payload, "288", "https://ll-fans.jp/data/event/288")

        self.assertEqual(result["event"]["series"], ["nijigasaki"])
        self.assertEqual(result["event"]["idSuggestion"], "nijigasaki-8th-live-tokimeki-express")
        self.assertEqual(
            result["event"]["llFansSource"]["url"],
            "https://ll-fans.jp/data/event/288",
        )
        self.assertEqual(len(result["performances"]), 2)
        self.assertEqual(
            result["performances"][0]["idSuggestion"],
            "nijigasaki-8th-live-tokimeki-express-osaka-day-1",
        )
        self.assertEqual(
            [item["marker"] for item in result["performances"][0]["setlist"]],
            ["M01", "EN01"],
        )
        self.assertEqual(result["performances"][0]["setlist"][1]["version"], "ショート Ver.")

    def test_tour_index_is_normalized_and_sorted_for_sync(self):
        result = convert_tour_index([
            {
                "id": "287",
                "name": "Older Live",
                "startsOn": "2026-01-10",
                "endsOn": "2026-01-10",
                "seriesIds": ["6"],
            },
            {
                "id": "300",
                "name": "New Live",
                "startsOn": "2026-07-20",
                "endsOn": "2026-07-21",
                "seriesIds": ["8"],
            },
            {"id": None, "name": "Invalid"},
        ])

        self.assertEqual([item["sourceId"] for item in result], ["300", "287"])
        self.assertEqual(result[0]["series"], ["ikizulive"])
        self.assertEqual(result[0]["idSuggestion"], "ikizulive-new-live")
        self.assertEqual(
            result[0]["sourceUrl"],
            "https://ll-fans.jp/data/event/300",
        )

    def test_empty_or_dash_only_venue_is_saved_as_hyphen(self):
        self.assertEqual(normalized_venue_name(None), "-")
        self.assertEqual(normalized_venue_name(""), "-")
        self.assertEqual(normalized_venue_name("―"), "-")
        self.assertEqual(normalized_venue_name("-"), "-")
        self.assertEqual(normalized_venue_name("幕張メッセ"), "幕張メッセ")

    def test_public_events_are_grouped_written_manifested_and_idempotent(self):
        events = [
            {
                "schemaVersion": "0.3",
                "id": "ikizulive-test-live",
                "title": "テスト公演",
                "series": ["ikizulive"],
                "sources": [],
                "performances": [],
            },
            {
                "schemaVersion": "0.3",
                "id": "multi-series-live",
                "title": "Multi Series Live",
                "series": ["hasunosora", "aqours"],
                "sources": [],
                "performances": [],
            },
            {
                "schemaVersion": "0.3",
                "id": "other-live",
                "title": "Other Live",
                "series": [],
                "sources": [],
                "performances": [],
            },
        ]
        with TemporaryDirectory() as directory:
            project = Path(directory)
            result = write_events_to_public_data(events, project)

            filenames = [
                "ikizulive/ikizulive-test-live.json",
                "hasunosora/multi-series-live.json",
                "other/other-live.json",
            ]
            self.assertEqual(result["eventCount"], 3)
            self.assertEqual(result["changedEventCount"], 3)
            self.assertEqual(result["filenames"], filenames)
            for filename in filenames:
                self.assertTrue(project.joinpath("data", *filename.split("/")).exists())
            manifest = json.loads(
                (project / "data" / "index.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["events"], filenames)

            repeated = write_events_to_public_data(events, project)
            self.assertEqual(repeated["changedEventCount"], 0)
            self.assertFalse(repeated["manifestChanged"])

    def test_study_playlists_are_validated_and_written_for_public_site(self):
        events = [{
            "schemaVersion": "0.3",
            "id": "hasunosora-live",
            "title": "Hasunosora Live",
            "series": ["hasunosora"],
            "performances": [],
        }]
        study_playlists = {
            "hasunosora": {
                "series": "hasunosora",
                "seriesLabel": "蓮ノ空",
                "cutoffDate": "2026-05-17",
                "cutoffEventId": "hasunosora-6th-live",
                "cutoffEventTitle": "6th Live",
                "cutoffPerformanceId": "day-2",
                "artists": [{"id": "1234567890123456789012", "name": "蓮ノ空"}],
                "tracks": [{
                    "trackId": "abcdefghijklmnopqrstuv",
                    "uri": "spotify:track:abcdefghijklmnopqrstuv",
                    "title": "New Song",
                    "artists": "蓮ノ空",
                    "releaseDate": "2026-06-01",
                    "artworkUrl": "https://i.scdn.co/image/example",
                    "albumName": "New Single",
                }],
                "updatedAt": "2026-09-18T00:00:00.000Z",
            }
        }
        self.assertIn("hasunosora", validate_study_playlists(study_playlists))
        with TemporaryDirectory() as directory:
            project = Path(directory)
            result = write_events_to_public_data(events, project, study_playlists)
            self.assertTrue(result["studyPlaylistsChanged"])
            document = json.loads(
                (project / "data" / "study-playlists.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["playlists"][0]["series"], "hasunosora")
            self.assertEqual(document["playlists"][0]["tracks"][0]["title"], "New Song")

    def test_flat_event_file_is_migrated_when_published(self):
        event = {
            "schemaVersion": "0.3",
            "id": "migration-live",
            "title": "Migration Live",
            "series": ["liella"],
            "sources": [],
            "performances": [],
        }
        with TemporaryDirectory() as directory:
            project = Path(directory)
            data_directory = project / "data"
            data_directory.mkdir()
            (data_directory / "migration-live.json").write_text(
                "{}\n",
                encoding="utf-8",
            )
            (data_directory / "index.json").write_text(
                json.dumps({
                    "schemaVersion": "0.3",
                    "events": ["migration-live.json"],
                }),
                encoding="utf-8",
            )

            result = write_event_to_public_data(event, project)

            self.assertFalse((data_directory / "migration-live.json").exists())
            self.assertTrue((data_directory / "liella" / "migration-live.json").exists())
            self.assertEqual(result["removedLegacyFiles"], ["migration-live.json"])
            manifest = json.loads(
                (data_directory / "index.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["events"], ["liella/migration-live.json"])

    def test_publish_event_id_cannot_escape_data_directory(self):
        with self.assertRaises(PublishErrorResponse):
            validate_publish_event({
                "id": "../outside",
                "title": "不正な公演",
                "performances": [],
            })

    def test_publish_pushes_batches_and_rebases_non_conflicting_remote_changes(self):
        first_event = {
            "schemaVersion": "0.3",
            "id": "github-publish-first",
            "title": "GitHub公開テスト1",
            "series": [],
            "sources": [],
            "performances": [],
        }
        second_event = {
            **first_event,
            "id": "github-publish-second",
            "title": "GitHub公開テスト2",
        }
        third_event = {
            **first_event,
            "id": "github-publish-third",
            "title": "GitHub公開テスト3",
        }
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project"
            remote = root / "remote.git"
            collaborator = root / "collaborator"
            project.mkdir()

            def git(*arguments, cwd=project):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=cwd,
                    capture_output=True,
                    text=True,
                    check=True,
                )

            git("init")
            git("checkout", "-b", "main")
            git("config", "user.name", "Setlist Test")
            git("config", "user.email", "setlist@example.test")
            git("init", "--bare", str(remote), cwd=root)
            git("remote", "add", "origin", str(remote))
            initial = publish_event_to_github(first_event, project)
            self.assertTrue(initial["committed"])
            self.assertTrue(initial["pushed"])
            self.assertEqual(initial["branch"], "main")
            self.assertTrue(initial["revision"])

            git("clone", "--branch", "main", str(remote), str(collaborator), cwd=root)
            git("config", "user.name", "Remote Test", cwd=collaborator)
            git("config", "user.email", "remote@example.test", cwd=collaborator)
            (collaborator / "remote-note.txt").write_text("remote change\n", encoding="utf-8")
            git("add", "remote-note.txt", cwd=collaborator)
            git("commit", "-m", "Remote change", cwd=collaborator)
            git("push", cwd=collaborator)

            result = publish_events_to_github([second_event, third_event], project)
            self.assertTrue(result["committed"])
            self.assertTrue(result["pushed"])
            self.assertEqual(result["eventCount"], 2)
            self.assertTrue((project / "remote-note.txt").exists())
            self.assertTrue(
                (project / "data" / "other" / "github-publish-second.json").exists()
            )
            self.assertTrue(
                (project / "data" / "other" / "github-publish-third.json").exists()
            )

            remote_head = git(
                "--git-dir",
                str(remote),
                "rev-parse",
                "refs/heads/main",
                cwd=root,
            ).stdout.strip()
            local_head = git("rev-parse", "HEAD").stdout.strip()
            self.assertEqual(remote_head, local_head)


if __name__ == "__main__":
    unittest.main()
