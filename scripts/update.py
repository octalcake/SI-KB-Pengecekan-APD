"""Outbound-only updater for the existing Linux SIBK host (Python 3.12+)."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request


REPO = "octalcake/SI-KB-Pengecekan-APD"
BUNDLE = "sibk-linux-amd64.tar.gz"
UNITS = ["sibk-web.service", "sibk-api.service", "sibk-ai.service"]
HOST = "sibk.hailmary.my.id"


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, timeout=1200)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "sibk-updater"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def write_json(path, value):
    pending = path.with_suffix(".tmp")
    pending.write_text(json.dumps(value, indent=2) + "\n")
    pending.replace(path)


def switch(current, target):
    pending = current.with_name("current.pending")
    pending.unlink(missing_ok=True)
    pending.symlink_to(target, target_is_directory=True)
    pending.replace(current)


def verify_and_extract(archive, checksum, revision, destination):
    expected = checksum.decode().strip().split()
    if len(expected) != 2 or expected[1] != BUNDLE:
        raise ValueError("Unexpected checksum manifest")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected[0]:
        raise ValueError("Release checksum mismatch")
    with tarfile.open(archive) as bundle:
        # Releases contain regular source files, never devices, links or absolute paths.
        for member in bundle.getmembers():
            if (Path(member.name).is_absolute() or ".." in Path(member.name).parts
                    or not (member.isfile() or member.isdir())):
                raise ValueError("Unsafe release archive member")
        bundle.extractall(destination, filter="data")
    if (destination / "REVISION").read_text().strip() != revision:
        raise ValueError("Release revision mismatch")


def verify_provenance(release, revision):
    if release.get("author", {}).get("login") != "github-actions[bot]":
        raise ValueError("Production releases must be published by GitHub Actions")
    for asset in release["assets"]:
        if asset["name"] in (BUNDLE, "SHA256SUMS"):
            if asset.get("uploader", {}).get("login") != "github-actions[bot]":
                raise ValueError("Release assets must be uploaded by GitHub Actions")
    api = f"https://api.github.com/repos/{REPO}"
    tagged = json.loads(fetch(f"{api}/commits/{release['tag_name']}"))
    comparison = json.loads(fetch(f"{api}/compare/{revision}...main"))
    if tagged["sha"] != revision or comparison["status"] not in ("identical", "ahead"):
        raise ValueError("Release commit must match its tag and belong to main")
    runs = json.loads(fetch(
        f"{api}/actions/workflows/ci.yml/runs?branch=main&event=push"
        f"&status=success&head_sha={revision}&per_page=10"))["workflow_runs"]
    if not any(item["head_sha"] == revision and item["head_branch"] == "main"
               and item["event"] == "push" and item["conclusion"] == "success"
               and item.get("head_repository", {}).get("full_name") == REPO for item in runs):
        raise ValueError("Release commit has no successful main push CI run")


def prepare(candidate, root, deploy):
    for relative in ("backend/.env", "backend/storage", "ai-service/.env"):
        source = root / relative
        if not source.exists():
            raise FileNotFoundError(f"Missing persistent path: {source}")
        target = candidate / relative
        target.symlink_to(source, target_is_directory=source.is_dir())

    ai = candidate / "ai-service"
    # Models stay host-managed, alongside the original env files and evidence.
    shutil.rmtree(ai / "models")
    (ai / "models").symlink_to(root / "ai-service/models", target_is_directory=True)
    lock = ai / "requirements.lock"
    original = root / "ai-service"
    if lock.read_bytes() == (original / "requirements.lock").read_bytes():
        venv = original / ".venv"
    else:
        digest = hashlib.sha256(lock.read_bytes()).hexdigest()
        venv = deploy / "venvs" / digest
        if not (venv / "ready").exists():
            run("python3", "-m", "venv", str(venv))
            run(str(venv / "bin/python"), "-m", "pip", "install",
                "--extra-index-url", "https://download.pytorch.org/whl/cpu", "-r", str(lock))
            run(str(venv / "bin/python"), "-m", "pip", "check")
            (venv / "ready").touch()
    run(str(venv / "bin/python"), "-m", "pip", "check")
    (ai / ".venv").symlink_to(venv, target_is_directory=True)
    api = candidate / "backend/bin/api"
    api.chmod(0o755)
    frontend = candidate / "frontend"
    run("bun", "install", "--frozen-lockfile", cwd=frontend)
    run("bun", "run", "build", cwd=frontend)
    write_json(frontend / "static/deployment.json",
               {"revision": (candidate / "REVISION").read_text().strip()})


def copy_database(source, destination):
    with sqlite3.connect(source) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)


def health(release):
    revision = (release / "REVISION").read_text().strip() if (release / "REVISION").exists() else None
    last_error = None
    for _ in range(30):
        try:
            for port in (8090, 5173):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/v1/health", headers={"Host": HOST})
                with urllib.request.urlopen(request, timeout=3) as response:
                    assert json.load(response)["data"]["status"] == "ok"
            if revision:
                request = urllib.request.Request(
                    "http://127.0.0.1:5173/deployment.json", headers={"Host": HOST})
                with urllib.request.urlopen(request, timeout=3) as response:
                    assert json.load(response)["revision"] == revision
            assert json.loads(fetch("https://" + HOST + "/api/v1/health"))["data"]["status"] == "ok"
            break
        except (OSError, ValueError, AssertionError, KeyError) as error:
            last_error = error
            time.sleep(2)
    else:
        raise RuntimeError("API/web/public HTTPS health checks failed") from last_error
    # Read the internal credential through the application's settings, never log it.
    run(str(release / "ai-service/.venv/bin/python"), "-c",
        "import json, time, urllib.request\nfrom app.config import Settings\n"
        "s = Settings()\n"
        "for attempt in range(30):\n"
        "    try:\n"
        "        r = urllib.request.Request('http://127.0.0.1:8091/internal/v1/model-info', "
        "headers={'X-Internal-Token': s.ai_internal_token})\n"
        "        info = json.load(urllib.request.urlopen(r, timeout=3))\n"
        "        assert s.ai_mode != 'real' or info['ready'], 'AI model is not ready'\n"
        "        break\n"
        "    except (OSError, AssertionError):\n"
        "        if attempt == 29: raise\n"
        "        time.sleep(2)\n",
        cwd=release / "ai-service")


def activate(candidate, root, deploy):
    current = deploy / "current"
    previous = current.resolve() if current.exists() else root
    database = root / "backend/storage/k3.sqlite"
    backup = deploy / "backups" / (candidate.name + ".sqlite")
    backup.parent.mkdir(exist_ok=True)
    switched = False
    backup_ready = False
    try:
        run("systemctl", "--user", "stop", *UNITS)
        copy_database(database, backup)
        backup_ready = True
        run("dbmate", "--url", f"sqlite:{database}", "--migrations-dir",
            str(candidate / "backend/migrations"), "--no-dump-schema", "up")
        switch(current, candidate)
        switched = True
        run("systemctl", "--user", "start", *reversed(UNITS))
        health(candidate)
    except Exception:
        # Stop all writers before restoring the pre-migration snapshot, including WAL state.
        run("systemctl", "--user", "stop", *UNITS)
        if switched:
            switch(current, previous)
        if backup_ready:
            copy_database(backup, database)
        run("systemctl", "--user", "start", *reversed(UNITS))
        health(previous)
        raise


def update(root):
    import fcntl  # Linux-only lock; import here so validation tests also run on Windows.

    deploy = root / ".deploy"
    deploy.mkdir(exist_ok=True)
    with (deploy / "update.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            release = json.loads(fetch(f"https://api.github.com/repos/{REPO}/releases/latest"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                print("No production release published yet", flush=True)
                return
            raise
        tag = release["tag_name"]
        if not re.fullmatch(r"sibk-[0-9a-f]{40}", tag):
            raise ValueError("Latest release is not a SIBK production release")
        revision = tag.removeprefix("sibk-")
        status_file = deploy / "status.json"
        state = json.loads(status_file.read_text()) if status_file.exists() else {}
        current_revision = deploy / "current/REVISION"
        if current_revision.exists() and current_revision.read_text().strip() == revision:
            print(f"Already running {revision}", flush=True)
            return
        if state.get("failed_revision") == revision:
            print(f"Release {revision} previously failed; publish a fix or clear failed_revision to retry", flush=True)
            return
        assets = {asset["name"]: asset["browser_download_url"] for asset in release["assets"]}
        prefix = f"https://github.com/{REPO}/releases/download/{tag}/"
        for name in (BUNDLE, "SHA256SUMS"):
            if assets.get(name) != prefix + name:
                raise ValueError(f"Missing or unexpected release asset: {name}")
        verify_provenance(release, revision)
        releases = deploy / "releases"
        releases.mkdir(exist_ok=True)
        candidate = releases / revision
        print(f"Preparing {revision}", flush=True)
        # Incomplete dependency installs never become visible through current.
        with tempfile.TemporaryDirectory(prefix="staging-", dir=deploy) as temporary:
            stage = Path(temporary)
            archive = stage / BUNDLE
            archive.write_bytes(fetch(assets[BUNDLE]))
            unpacked = stage / "release"
            unpacked.mkdir()
            verify_and_extract(archive, fetch(assets["SHA256SUMS"]), revision, unpacked)
            if candidate.exists():
                shutil.rmtree(candidate)
            unpacked.rename(candidate)
            prepare(candidate, root, deploy)
        try:
            activate(candidate, root, deploy)
        except Exception:
            write_json(status_file, {**state, "failed_revision": revision, "status": "failed"})
            raise
        write_json(status_file, {"revision": revision, "status": "healthy", "release": release["html_url"]})
        print(f"Activated {revision}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    update(args.root.resolve())
