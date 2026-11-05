"""A version tag's GitHub Release title and notes come from its CHANGELOG section."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("release_notes", ROOT / ".github/scripts/release_notes.py")
release_notes_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release_notes_module)
release_notes = release_notes_module.release_notes

CHANGELOG = """# Changelog

## [Unreleased]

### Fixed
- Something not yet shipped.

## 1.2.0 — Bigger catalog (2026-11-01)

### Added
- A catalog.

### Fixed
- A bug.

## 1.1.0 — Older (2026-10-01)

### Added
- Older thing.
"""


def test_final_tag_takes_title_and_notes_from_its_section():
    title, notes = release_notes(CHANGELOG, "v1.2.0")

    assert title == "v1.2.0 — Bigger catalog"
    assert notes == "### Added\n- A catalog.\n\n### Fixed\n- A bug.\n"


def test_prerelease_tag_uses_its_base_version_section():
    title, notes = release_notes(CHANGELOG, "v1.2.0-rc.2")

    assert title == "v1.2.0-rc.2 — Bigger catalog"
    assert notes == "### Added\n- A catalog.\n\n### Fixed\n- A bug.\n"


def test_prerelease_tag_falls_back_to_unreleased_and_is_titled_by_its_tag():
    title, notes = release_notes(CHANGELOG, "v1.3.0-rc.1")

    assert title == "v1.3.0-rc.1"
    assert notes == "### Fixed\n- Something not yet shipped.\n"


def test_final_tag_without_a_section_is_refused():
    with pytest.raises(ValueError, match="v1.3.0"):
        release_notes(CHANGELOG, "v1.3.0")


def test_a_version_is_matched_whole_not_by_prefix():
    with pytest.raises(ValueError, match="v1.2"):
        release_notes(CHANGELOG, "v1.2")


def test_section_with_no_notes_is_refused():
    with pytest.raises(ValueError, match="v2.0.0"):
        release_notes("## 2.0.0 — Empty (2026-11-02)\n\n## 1.0.0 — Old (2026-01-01)\n- Old.\n", "v2.0.0")


def test_oldest_section_runs_to_the_end_of_the_changelog():
    _, notes = release_notes(CHANGELOG, "v1.1.0")

    assert notes == "### Added\n- Older thing.\n"


def test_the_real_changelog_gives_the_title_published_for_v1_1_0():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    title, notes = release_notes(changelog, "v1.1.0")

    assert title == "v1.1.0 — Movie-channel Catalog with Download to Radarr"
    assert notes.startswith("### Added\n")
