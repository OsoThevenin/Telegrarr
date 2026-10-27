"""Release documentation stays consistent with the shipped version."""
import re
from pathlib import Path

from app import __version__

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG_HEADING = re.compile(r"^## v?(\d+\.\d+\.\d+)\b", re.M)


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def test_newest_changelog_entry_is_the_app_version():
    newest = CHANGELOG_HEADING.search(_read("CHANGELOG.md"))

    assert newest is not None
    assert newest.group(1) == __version__


def test_english_readme_links_to_catalan_readme():
    assert "](README.ca.md)" in _read("README.md")


def test_catalan_readme_links_to_english_readme():
    assert "](README.md)" in _read("README.ca.md")
