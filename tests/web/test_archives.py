"""Boundary controls use real ZIP bytes, including entries zipfile would normalize."""
import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import warnings
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("web", Path(__file__).resolve().parents[2] / "scripts/web-workspace.py")
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


class Archives(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name)

    def archive(self, entries, compression=zipfile.ZIP_STORED):
        path = self.root / "source.zip"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(path, "w", compression) as out:
                for name, data in entries:
                    if isinstance(name, str):
                        # ZipInfo normalizes the host separator on Windows. Preserve
                        # hostile header bytes instead of accidentally testing a safe name.
                        item = zipfile.ZipInfo(name)
                        item.filename = item.orig_filename = name
                        item.compress_type = compression
                        name = item
                    out.writestr(name, data)
        return path

    def rejected(self, entries, compression=zipfile.ZIP_STORED):
        archive = self.archive(entries, compression)
        with self.assertRaises((ValueError, zipfile.BadZipFile, NotImplementedError)):
            web.safe_extract(archive, self.root / "out")
        self.assertFalse((self.root / "out").exists())
        self.assertFalse((self.root / "escape").exists())

    def test_positive_stored_and_deflated(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            archive = self.archive([("repo/", ""), ("repo/src/hello.ts", "export const hello = 1;\n")], compression)
            target = self.root / str(compression)
            web.safe_extract(archive, target)
            self.assertEqual((target / "repo/src/hello.ts").read_text(), "export const hello = 1;\n")
            with self.assertRaises(FileExistsError):
                web.safe_extract(archive, target)

    def test_traversal_absolute_drive_backslash_controls(self):
        for name in ("../escape", "/escape", "repo/../../escape", "C:/escape", "repo\\escape", "repo//escape", "repo/./escape", "repo/file:stream", "repo/trail.", "repo/trail ", "repo/CON.txt", "repo/COM¹.txt", "repo/a?b", "repo/\nname", "repo/\u202ename"):
            with self.subTest(name=name):
                self.rejected([(name, "bad")])

    def test_nul_not_silently_truncated(self):
        # Write valid bytes first, then patch both header names with a same-length NUL.
        path = self.archive([("repo/xxx.ts", "bad")])
        path.write_bytes(path.read_bytes().replace(b"repo/xxx.ts", b"repo/x\x00x.ts"))
        with self.assertRaises(ValueError):
            web.safe_extract(path, self.root / "out")
        self.assertFalse((self.root / "out").exists())

    def test_backslash_header_survives_windows_zipinfo_normalization(self):
        with patch.object(zipfile.os, "sep", "\\"):
            path = self.archive([("repo\\escape", "bad")])
            with zipfile.ZipFile(path) as source:
                entry = source.infolist()[0]
                self.assertEqual(entry.orig_filename, "repo\\escape")
                self.assertEqual(entry.filename, "repo/escape")
            with self.assertRaises(ValueError):
                web.safe_extract(path, self.root / "out")
        self.assertFalse((self.root / "out").exists())

    def test_duplicates_aliases_and_file_prefixes(self):
        for names in (("a", "a"), ("A", "a"), ("A/x", "a/y"), ("caf\u00e9/x", "cafe\u0301/y"), ("a", "a/b"), ("a/b", "a")):
            with self.subTest(names=names):
                self.rejected([(name, "bad") for name in names])

    def test_links_and_special_files(self):
        for mode in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFSOCK):
            entry = zipfile.ZipInfo("repo/link")
            entry.create_system = 3
            entry.external_attr = (mode | 0o777) << 16
            with self.subTest(mode=mode):
                self.rejected([(entry, "../../escape")])

    def test_mode_name_disagreement(self):
        for name, mode in (("dir/", stat.S_IFREG), ("dir", stat.S_IFDIR)):
            entry = zipfile.ZipInfo(name)
            entry.external_attr = (mode | 0o755) << 16
            self.rejected([(entry, "")])

    def test_limits_and_compression_bomb(self):
        with patch.object(web, "MAX_FILE", 10):
            self.rejected([("a", "x" * 11)])
        with patch.object(web, "MAX_TOTAL", 10):
            self.rejected([("a", "x" * 6), ("b", "x" * 6)])
        with patch.object(web, "MAX_ENTRIES", 1):
            self.rejected([("a", ""), ("b", "")])
            self.rejected([("a/b", "")])  # implicit parent consumes a node too
        with patch.object(web, "MAX_ARCHIVE", 10):
            self.rejected([("a", "")])
        self.rejected([("a", "0" * (1024 * 1024 + 1))], zipfile.ZIP_DEFLATED)
        self.rejected([("/".join(["a"] * 65), "")])
        self.rejected([("a" * 256, "")])

    def test_unsupported_compression_and_encryption(self):
        self.rejected([("a", "text")], zipfile.ZIP_BZIP2)
        path = self.archive([("a", "text")])
        data = bytearray(path.read_bytes())
        data[6] |= 1
        central = data.index(b"PK\x01\x02")
        data[central + 8] |= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            web.safe_extract(path, self.root / "out")

    def test_corruption_removes_partial_extraction(self):
        path = self.archive([("good", "first"), ("bad", "second")])
        path.write_bytes(path.read_bytes().replace(b"second", b"broken"))
        with self.assertRaises(zipfile.BadZipFile):
            web.safe_extract(path, self.root / "out")
        self.assertFalse((self.root / "out").exists())

    def test_archive_symlink_rejected(self):
        path = self.archive([("a", "x")])
        link = self.root / "link.zip"
        try:
            link.symlink_to(path)
        except (OSError, NotImplementedError):
            self.skipTest("Host does not permit creating symlinks")
        with self.assertRaises(ValueError):
            web.archive_entries(link)

    def test_selection_and_strict_json(self):
        self.assertEqual(web.relative_path(".", True), ".")
        for name in ("../outside", "/tmp", "a//b", "a/../b", "a\\b"):
            with self.assertRaises(ValueError):
                web.relative_path(name, True)
        path = self.root / "config.json"
        path.write_text('{"version":1,"version":1}')
        with self.assertRaises(ValueError):
            web.read_json(path)

    def test_export_failure_never_exposes_partial_download(self):
        work = self.root / "work"
        source = work / "source"
        (source / "context").mkdir(parents=True)
        (source / "context/CONTEXT.md").write_text("owned control")
        output = self.root / "download.zip"
        with patch.object(web, "selected", return_value=(work, source, {"subfolder": "."})), patch.object(web, "invoke", return_value={"identity": "owned", "coverage": "complete"}), patch.object(web, "runtime", return_value=(sys.executable, Path("bridge"), "v24.0.0")), patch.object(web.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"coverage":"complete"}')), patch.object(web.zipfile.ZipFile, "writestr", side_effect=OSError("disk failure")):
            with self.assertRaisesRegex(OSError, "disk failure"):
                web.export_context(work, output)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".shcontext-export-*")), [])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Archives))
    if result.wasSuccessful():
        print("ARCHIVE SAFETY PASSED")
    sys.exit(not result.wasSuccessful())
