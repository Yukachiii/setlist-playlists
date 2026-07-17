import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from server import (
    ImportErrorResponse,
    PublishErrorResponse,
    convert_tour_payload,
    parse_event_url,
    publish_event_to_github,
    validate_publish_event,
    write_event_to_public_data,
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

    def test_public_event_is_written_and_added_to_manifest(self):
        event = {
            "schemaVersion": "0.3",
            "id": "ikizulive-test-live",
            "title": "テスト公演",
            "series": ["ikizulive"],
            "sources": [],
            "performances": [],
        }
        with TemporaryDirectory() as directory:
            project = Path(directory)
            result = write_event_to_public_data(event, project)
            self.assertEqual(result["filename"], "ikizulive-test-live.json")
            self.assertTrue(result["eventChanged"])
            self.assertTrue(result["manifestChanged"])
            self.assertTrue((project / "data" / "ikizulive-test-live.json").exists())

            manifest = (project / "data" / "index.json").read_text(encoding="utf-8")
            self.assertIn('"ikizulive-test-live.json"', manifest)

            repeated = write_event_to_public_data(event, project)
            self.assertFalse(repeated["eventChanged"])
            self.assertFalse(repeated["manifestChanged"])

    def test_publish_event_id_cannot_escape_data_directory(self):
        with self.assertRaises(PublishErrorResponse):
            validate_publish_event({
                "id": "../outside",
                "title": "不正な公演",
                "performances": [],
            })

    def test_publish_commits_and_pushes_to_configured_remote(self):
        event = {
            "schemaVersion": "0.3",
            "id": "github-publish-test",
            "title": "GitHub公開テスト",
            "series": [],
            "sources": [],
            "performances": [],
        }
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project"
            remote = root / "remote.git"
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

            result = publish_event_to_github(event, project)
            self.assertTrue(result["committed"])
            self.assertTrue(result["pushed"])
            self.assertEqual(result["branch"], "main")
            self.assertTrue(result["revision"])
            self.assertTrue((project / "data" / "github-publish-test.json").exists())

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
