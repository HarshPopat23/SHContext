#!/usr/bin/env python3
"""Offline archive boundary for Claude web skills. Python standard library only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata
import zipfile

MAX_ARCHIVE = 64 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_ENTRIES = 20000
MAX_RATIO = 200
MODEL = {"id": "host", "model": "claude-web-session"}


def relative_path(name, allow_dot=False):
    if allow_dot and name == ".":
        return "."
    if not isinstance(name, str) or not name or len(name) > 1024:
        raise ValueError("Invalid archive/selection path length.")
    if any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in "\\:" or unicodedata.category(c) == "Cf" for c in name):
        raise ValueError("Unsafe archive/selection path characters.")
    parts = name.split("/")
    if len(parts) > 64:
        raise ValueError("Archive path is too deep.")
    for part in parts:
        if part in ("", ".", "..") or part.endswith((" ", ".")):
            raise ValueError("Unsafe archive/selection path component.")
        if any(c in '<>"|?*' for c in part):
            raise ValueError("Nonportable archive path.")
        if re.match(r"^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", part, re.I):
            raise ValueError("Nonportable device path.")
        if len(part.encode("utf-8")) > 255:
            raise ValueError("Archive path component is too long.")
    return name


def archive_entries(archive):
    path = Path(archive)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Archive must be a regular ZIP of at most 64 MiB.")
    with zipfile.ZipFile(path) as source:
        entries = source.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            raise ValueError("ZIP must contain 1–20000 entries.")
        seen, kinds, spellings, total = set(), {}, {}, 0
        for item in entries:
            # orig_filename retains NULs that ZipInfo.filename would silently truncate.
            raw = item.orig_filename
            name = relative_path(raw[:-1] if raw.endswith("/") else raw)
            key = unicodedata.normalize("NFC", name).casefold()
            if key in seen:
                raise ValueError("Duplicate or case/Unicode-colliding ZIP entries.")
            seen.add(key)
            parts = name.split("/")
            for index in range(1, len(parts) + 1):
                spelling = "/".join(parts[:index])
                normalized = unicodedata.normalize("NFC", spelling).casefold()
                if normalized in spellings and spellings[normalized] != spelling:
                    raise ValueError("Case/Unicode-colliding ZIP directories.")
                spellings[normalized] = spelling
                if len(spellings) > MAX_ENTRIES:
                    raise ValueError("ZIP entries plus implicit directories exceed 20000 nodes.")
            mode = (item.external_attr >> 16) & 0xFFFF
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR) != item.is_dir() and kind != 0:
                raise ValueError("Links and special ZIP entries are forbidden.")
            if item.flag_bits & 1 or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Encrypted or unsupported compression in ZIP.")
            if item.file_size < 0 or item.compress_size < 0 or item.file_size > MAX_FILE:
                raise ValueError("ZIP entry exceeds 16 MiB.")
            if item.is_dir() and item.file_size:
                raise ValueError("ZIP directory has a payload.")
            if item.file_size > max(1024 * 1024, item.compress_size * MAX_RATIO):
                raise ValueError("ZIP compression ratio exceeds its bound.")
            total += item.file_size
            if total > MAX_TOTAL:
                raise ValueError("ZIP expands beyond 128 MiB.")
            kinds[key] = item.is_dir()
        for key in kinds:
            pieces = key.split("/")
            if any(kinds.get("/".join(pieces[:n])) is False for n in range(1, len(pieces))):
                raise ValueError("ZIP file/directory prefix collision.")
        return entries


def safe_extract(archive, destination):
    entries = archive_entries(archive)
    destination = Path(destination)
    destination.mkdir(mode=0o700)  # exclusive; never overwrite an existing tree
    try:
        total = 0
        with zipfile.ZipFile(archive) as source:
            for item in entries:
                target = destination / item.filename.rstrip("/")
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                count = 0
                with source.open(item) as inp, target.open("xb") as out:
                    os.chmod(target, 0o600)
                    while True:
                        data = inp.read(65536)
                        if not data:
                            break
                        count += len(data)
                        total += len(data)
                        if count > min(item.file_size, MAX_FILE) or total > MAX_TOTAL:
                            raise ValueError("ZIP payload exceeds declared bounds.")
                        out.write(data)
                if count != item.file_size:
                    raise ValueError("ZIP payload size mismatch.")
    except BaseException:
        shutil.rmtree(destination)
        raise


def read_json(path, limit=65536):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Expected a bounded regular JSON file.")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON field.")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)


def runtime():
    if sys.version_info < (3, 9):
        raise ValueError("Python 3.9 or newer is required.")
    node = shutil.which("node")
    if not node:
        raise ValueError("runtime_unavailable: Node.js 22.14+ (22.x) or 24.x is required; no installation or network call was attempted.")
    version = subprocess.run([node, "--version"], capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    if not match or not (int(match[1]) == 24 or int(match[1]) == 22 and int(match[2]) >= 14):
        raise ValueError("runtime_incompatible: tested Node versions are 22.14+ (22.x) and 24.x; found " + version)
    bridge = Path(__file__).resolve().parent / "runtime/dist/web/runtime.js"
    if not bridge.is_file():
        raise ValueError("runtime_missing: use a packaged web skill ZIP, not the unbundled source folder.")
    return node, bridge, version


def invoke(operation, root, session="", argument="", capture=False):
    node, bridge, _ = runtime()
    # No target scripts, npm, Git downloads, credentials or external model adapters.
    env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "NODE_PATH", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")}
    result = subprocess.run([node, str(bridge), operation, str(root), str(session), str(argument)], env=env, capture_output=capture, text=True)
    if capture and result.returncode:
        raise ValueError(result.stderr.strip() or "SHContext validation failed.")
    return json.loads(result.stdout) if capture else result.returncode


def selected(work):
    work = Path(work).resolve(strict=True)
    info = read_json(work / "workspace.json")
    if set(info) != {"version", "repo_prefix", "subfolder", "previous"} or info["version"] != 1 or type(info["previous"]) is not bool:
        raise ValueError("Malformed workspace descriptor.")
    prefix = relative_path(info["repo_prefix"], True)
    folder = relative_path(info["subfolder"], True)
    root = work / "source" / prefix / folder
    if root.is_symlink() or not root.is_dir() or not root.resolve().is_relative_to(work / "source"):
        raise ValueError("Selected root is missing or outside the workspace.")
    return work, root, info


def open_workspace(args):
    runtime()
    prefix = relative_path(args.repo_prefix, True)
    subfolder = relative_path(args.subfolder, True)
    work = Path(args.work).absolute()
    if os.path.lexists(work):
        raise ValueError("Workspace already exists; choose a new directory.")
    # Reject Git metadata instead of letting an uploaded checkout influence Git execution.
    entries = archive_entries(args.source)
    if any(".git" in item.filename.casefold().rstrip("/").split("/") for item in entries):
        raise ValueError("Upload a source ZIP without .git metadata (for example git archive).")
    stage = Path(tempfile.mkdtemp(prefix="shcontext-web-", dir=work.parent))
    try:
        safe_extract(args.source, stage / "source")
        root = stage / "source" / prefix / subfolder
        if not root.is_dir():
            raise ValueError("Selected repository prefix/subfolder does not exist; list the archive first.")
        if (root / "context").exists() or (root / ".shcontext").exists():
            raise ValueError("Source ZIP contains selected-root output/state; upload source only and pass previous context separately.")
        config_path = root / "shcontext.config.json"
        config = read_json(config_path) if config_path.exists() else {"version": 1}
        if not isinstance(config, dict) or config.get("version") != 1:
            raise ValueError("Configuration requires an object with version 1.")
        config["provider"] = MODEL
        config_path.write_text(json.dumps(config, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        invoke("scan", root, capture=True)  # validate all effective configuration before exposing a workspace
        info = {"version": 1, "repo_prefix": prefix, "subfolder": subfolder, "previous": bool(args.previous)}
        if args.previous:
            for item in archive_entries(args.previous):
                name = item.filename.rstrip("/")
                if name != "web-context.json" and name != "context" and not name.startswith("context/"):
                    raise ValueError("Previous context ZIP contains unexpected entries.")
            safe_extract(args.previous, stage / "previous")
            receipt = read_json(stage / "previous/web-context.json")
            if receipt != {"version": 1, "subfolder": subfolder, "provider": MODEL}:
                raise ValueError("Previous context scope/provenance does not match; build a new scope instead.")
            shutil.move(str(stage / "previous/context"), str(root / "context"))
            invoke("owned", root, capture=True)  # hashes, ownership, coverage, citations, structured cache
            shutil.rmtree(stage / "previous")
        (stage / "workspace.json").write_text(json.dumps(info, sort_keys=True) + "\n", encoding="utf-8")
        if os.path.lexists(work):
            raise ValueError("Workspace appeared during extraction; no overwrite allowed.")
        stage.rename(work)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    _, root, _ = selected(work)
    return {"workspace": str(work), "root": str(root), "previous": info["previous"], "provider": MODEL}


def export_context(work, output):
    work, root, info = selected(work)
    baseline = invoke("owned", root, capture=True)
    checked = subprocess.run([runtime()[0], str(runtime()[1]), "verify", str(root)], capture_output=True, text=True)
    if checked.returncode not in (0, 2):
        raise ValueError("Export requires fresh context; verify/update before exporting.")
    output = Path(output).absolute()
    if output.is_relative_to(work):
        raise ValueError("Export outside the workspace.")
    # Read all bounded owned files before opening the output; never follow new links.
    files = []
    for path in sorted((root / "context").rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError("Context contains a link or special entry.")
        if path.is_file():
            if path.stat().st_size > 32 * 1024 * 1024:
                raise ValueError("Context artifact exceeds 32 MiB.")
            files.append((path.relative_to(root).as_posix(), path.read_bytes()))
    if invoke("owned", root, capture=True) != baseline:
        raise ValueError("Context changed during export; no archive was published.")
    # Revalidate the captured bytes themselves, not just a possibly changed live tree.
    with tempfile.TemporaryDirectory(prefix="shcontext-export-", dir=work.parent) as temporary:
        captured = Path(temporary)
        for name, content in files:
            target = captured / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        if invoke("owned", captured, capture=True) != baseline:
            raise ValueError("Captured context does not match its manifest.")
    checked = subprocess.run([runtime()[0], str(runtime()[1]), "verify", str(root)], capture_output=True, text=True)
    if checked.returncode not in (0, 2):
        raise ValueError("Source changed during export; verify/update before exporting.")
    temporary_handle, temporary_name = tempfile.mkstemp(prefix=".shcontext-export-", suffix=".zip", dir=output.parent)
    temporary = Path(temporary_name)
    os.close(temporary_handle)
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            receipt = {"version": 1, "subfolder": info["subfolder"], "provider": MODEL}
            archive.writestr("web-context.json", json.dumps(receipt, sort_keys=True) + "\n")
            for name, content in files:
                archive.writestr(name, content)
        # Publish only a complete, reimportable archive. Hard-link creation is atomic
        # and fails if the destination exists, unlike POSIX rename's replacement.
        archive_entries(temporary)
        try:
            os.link(temporary, output)
        except FileExistsError:
            raise ValueError("Export already exists; choose a new filename.")
    finally:
        temporary.unlink(missing_ok=True)
    return {"archive": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "files": len(files), "coverage": json.loads(checked.stdout)["coverage"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight")
    listing = commands.add_parser("list")
    listing.add_argument("--source", required=True)
    opening = commands.add_parser("open")
    opening.add_argument("--source", required=True)
    opening.add_argument("--work", required=True)
    opening.add_argument("--repo-prefix", default=".")
    opening.add_argument("--subfolder", default=".")
    opening.add_argument("--previous")
    for operation in ("prepare", "submit", "finalize", "verify", "query", "export"):
        command = commands.add_parser(operation)
        command.add_argument("--work", required=True)
        if operation == "submit":
            command.add_argument("--draft", required=True)
        if operation == "query":
            command.add_argument("--question", required=True)
        if operation == "export":
            command.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "preflight":
        _, _, version = runtime()
        # Import all production code, including parser dependencies, without a network/install step.
        root = Path(__file__).resolve().parent / "runtime/dist/index.js"
        subprocess.run([runtime()[0], "--input-type=module", "-e", "await import(process.argv[1])", root.as_uri()], check=True, capture_output=True, timeout=20)
        result = {"status": "compatible", "node": version, "python": sys.version.split()[0], "network_required": False}
    elif args.command == "list":
        entries = archive_entries(args.source)
        directories = sorted({"/".join(item.filename.rstrip("/").split("/")[:n]) for item in entries for n in range(1, len(item.filename.rstrip("/").split("/")) + int(item.is_dir()))})
        result = {"entries": len(entries), "directories": directories[:200], "directories_truncated": len(directories) > 200}
    elif args.command == "open":
        result = open_workspace(args)
    elif args.command == "export":
        result = export_context(args.work, args.output)
    else:
        work, root, info = selected(args.work)
        argument = str(Path(args.draft).resolve()) if args.command == "submit" else args.question if args.command == "query" else "update" if info["previous"] else "build"
        return invoke(args.command, root, work / "session", argument)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"code": "web_workspace", "message": str(error)}), file=sys.stderr)
        sys.exit(1)
