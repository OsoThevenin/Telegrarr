"""Derive a version tag's GitHub Release title and notes from CHANGELOG.md."""

import re
import sys
from pathlib import Path

HEADING = re.compile(r"^## v?(?P<version>\S+)(?: — (?P<title>.+?))?(?: \(\d{4}-\d{2}-\d{2}\))?$", re.M)
UNRELEASED = "[Unreleased]"


def _candidate_sections(tag: str) -> list[str]:
    """Section names for `tag`, best first; a pre-release may predate its own section."""
    version, _, prerelease = tag.removeprefix("v").partition("-")
    return [version, UNRELEASED] if prerelease else [version]


def release_notes(changelog: str, tag: str) -> tuple[str, str]:
    """Return the (title, notes) of `tag`'s section of `changelog`."""
    headings = list(HEADING.finditer(changelog))
    positions = {heading["version"]: index for index, heading in enumerate(headings)}
    index = next((positions[name] for name in _candidate_sections(tag) if name in positions), None)
    if index is None:
        raise ValueError(f"CHANGELOG.md has no section for {tag}")
    heading = headings[index]
    end = headings[index + 1].start() if index + 1 < len(headings) else len(changelog)
    notes = changelog[heading.end() : end].strip()
    if not notes:
        raise ValueError(f"The CHANGELOG.md section for {tag} is empty")
    title = f"{tag} — {heading['title']}" if heading["title"] else tag
    return title, f"{notes}\n"


def main(tag: str, notes_path: str) -> None:
    """Write `tag`'s notes to `notes_path` and its title to stdout."""
    try:
        title, notes = release_notes(Path("CHANGELOG.md").read_text(encoding="utf-8"), tag)
    except ValueError as error:
        sys.exit(str(error))
    Path(notes_path).write_text(notes, encoding="utf-8")
    sys.stdout.write(f"{title}\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
