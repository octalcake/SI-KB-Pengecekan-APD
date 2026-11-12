import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import update


class ReleaseTests(unittest.TestCase):
    def test_release_requires_actions_provenance_main_ancestry_and_passing_ci(self):
        revision = "a" * 40
        release = {"tag_name": "sibk-" + revision,
                   "author": {"login": "github-actions[bot]"},
                   "assets": [{"name": update.BUNDLE,
                               "uploader": {"login": "github-actions[bot]"}}]}
        passed = {"head_sha": revision, "head_branch": "main", "event": "push",
                  "conclusion": "success", "head_repository": {"full_name": update.REPO}}
        for tag_sha, ancestry, runs, succeeds in (
            (revision, "identical", [passed], True),
            (revision, "ahead", [passed], True),
            ("b" * 40, "identical", [passed], False),
            (revision, "diverged", [passed], False),
            (revision, "behind", [passed], False),
            (revision, "identical", [], False),
            (revision, "identical", [{**passed, "event": "pull_request"}], False),
            (revision, "identical", [{**passed, "conclusion": "failure"}], False),
        ):
            responses = [{"sha": tag_sha}, {"status": ancestry}, {"workflow_runs": runs}]
            with self.subTest(tag_sha=tag_sha, ancestry=ancestry, runs=runs), \
                 patch.object(update, "fetch", side_effect=[json.dumps(value).encode() for value in responses]):
                if succeeds:
                    update.verify_provenance(release, revision)
                else:
                    with self.assertRaises(ValueError):
                        update.verify_provenance(release, revision)
        release["author"]["login"] = "repository-writer"
        with self.assertRaisesRegex(ValueError, "published by GitHub Actions"):
            update.verify_provenance(release, revision)
        release["author"]["login"] = "github-actions[bot]"
        release["assets"][0]["uploader"]["login"] = "repository-writer"
        with self.assertRaisesRegex(ValueError, "uploaded by GitHub Actions"):
            update.verify_provenance(release, revision)

    def test_rejects_checksum_revision_and_unsafe_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / update.BUNDLE
            for name, value, expected_error in (
                ("REVISION", b"a" * 40, "checksum"),
                ("REVISION", b"b" * 40, "revision"),
                ("../escaped", b"bad", "Unsafe"),
            ):
                with self.subTest(expected_error=expected_error):
                    with tarfile.open(archive, "w:gz") as bundle:
                        member = tarfile.TarInfo(name)
                        member.size = len(value)
                        bundle.addfile(member, io.BytesIO(value))
                    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                    if expected_error == "checksum":
                        digest = "0" * 64
                    checksum = f"{digest}  {update.BUNDLE}\n".encode()
                    target = root / expected_error
                    target.mkdir()
                    with self.assertRaisesRegex(ValueError, expected_error):
                        update.verify_and_extract(archive, checksum, "a" * 40, target)
            self.assertFalse((root / "escaped").exists())

    def test_valid_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / update.BUNDLE
            with tarfile.open(archive, "w:gz") as bundle:
                member = tarfile.TarInfo("./REVISION")
                member.size = 40
                bundle.addfile(member, io.BytesIO(b"a" * 40))
            checksum = f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {update.BUNDLE}".encode()
            target = root / "release"
            target.mkdir()
            update.verify_and_extract(archive, checksum, "a" * 40, target)
            self.assertEqual((target / "REVISION").read_text(), "a" * 40)


@unittest.skipIf(__import__("os").name == "nt", "Activation uses Linux symlinks")
class ActivationTests(unittest.TestCase):
    def test_migration_and_health_failures_restore_database_and_release(self):
        for failure in ("migration", "health", "backup"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                deploy = root / ".deploy"
                deploy.mkdir()
                previous = root / "old"
                previous.mkdir()
                candidate = root / "new"
                candidate.mkdir()
                update.switch(deploy / "current", previous)
                storage = root / "backend/storage"
                storage.mkdir(parents=True)
                database = storage / "k3.sqlite"
                with sqlite3.connect(database) as connection:
                    connection.execute("CREATE TABLE evidence (id INTEGER)")
                    connection.execute("INSERT INTO evidence VALUES (7)")
                commands = []

                def fake_run(*args, **kwargs):
                    commands.append(args)
                    if args[0] == "dbmate":
                        with sqlite3.connect(database) as connection:
                            connection.execute("ALTER TABLE evidence ADD COLUMN new_schema TEXT")
                            connection.execute("DELETE FROM evidence")
                        if failure == "migration":
                            raise RuntimeError("migration failed")

                def fake_health(release):
                    if release == candidate and failure == "health":
                        raise RuntimeError("health failed")

                real_copy = update.copy_database

                def fake_copy(source, destination):
                    if failure == "backup":
                        destination.touch()  # A partial backup must never be restored.
                        raise RuntimeError("backup failed")
                    real_copy(source, destination)

                with patch.object(update, "run", side_effect=fake_run), \
                     patch.object(update, "health", side_effect=fake_health), \
                     patch.object(update, "copy_database", side_effect=fake_copy):
                    with self.assertRaisesRegex(RuntimeError, failure):
                        update.activate(candidate, root, deploy)
                self.assertEqual((deploy / "current").resolve(), previous)
                with sqlite3.connect(database) as connection:
                    self.assertEqual(connection.execute("SELECT * FROM evidence").fetchall(), [(7,)])
                self.assertEqual(commands[-1], ("systemctl", "--user", "start", *reversed(update.UNITS)))


if __name__ == "__main__":
    unittest.main()
