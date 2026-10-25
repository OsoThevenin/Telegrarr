"""Catalan caption/filename parsing, language token and quality from video dimensions."""
import re

import pytest

from app import namer

SAMPLE_CAPTION = "3x13 Un viatge pel temps (2a Part)"
SAMPLE_FILENAME = "El_Senyor_dels_Anells_Els_anells_de_poder_1x01_Una_ombra_del_passat.avi"
CATALAN_TITLE_FORMAT = re.compile(r"(CAT|CATALAN|CATALÀ|CATUB)[.\-_\s]")


# --------------------------------------------------------------------------
# Episode markers
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text, season, episode", [
    (SAMPLE_CAPTION, 3, 13),
    (SAMPLE_FILENAME, 1, 1),
    ("Serie 3x13 títol", 3, 13),
    ("Serie T3C13 títol", 3, 13),
    ("Serie T03E13 títol", 3, 13),
    ("Serie Temporada 3 Capítol 13 títol", 3, 13),
    ("Serie - Temporada 3, Capítol 13", 3, 13),
    ("Serie Temporada 2 Cap. 4", 2, 4),
    ("Serie_Temporada_3_Capitol_13", 3, 13),
    ("Serie S03E13", 3, 13),
])
def test_catalan_season_episode_markers(text, season, episode):
    info = namer.extract_episode(text)

    assert (info["season"], info["episode"]) == (season, episode)


@pytest.mark.parametrize("text, episode", [
    ("Serie Cap. 13 títol", 13),
    ("Serie Cap 13 títol", 13),
    ("Serie C13 títol", 13),
    ("Serie Capítol 13", 13),
    ("Serie Episodi 13 títol", 13),
    ("Serie Ep. 13 títol", 13),
    ("Serie_Ep_013_final", 13),
])
def test_catalan_episode_only_markers(text, episode):
    info = namer.extract_episode(text)

    assert info["episode"] == episode
    assert info["season"] is None


@pytest.mark.parametrize("text", [
    "Serie 1x01-02 Doble",
    "Serie 1x01-1x02 Doble",
    "Serie_1x01-02_Doble.mkv",
])
def test_double_episode_range(text):
    info = namer.extract_episode(text)

    assert (info["season"], info["episode"], info["episode_end"]) == (1, 1, 2)


def test_single_episode_has_no_range_end():
    assert namer.extract_episode(SAMPLE_CAPTION)["episode_end"] is None


@pytest.mark.parametrize("text", [
    "Film 1920x1080 WEB",
    "Serie 5.1 x264",
    "AC3 H264",
])
def test_resolutions_and_codecs_are_not_episode_markers(text):
    info = namer.extract_episode(text)

    assert info["season"] is None
    assert info["episode"] is None


def test_decomposed_accents_still_match():
    # macOS filenames often arrive NFD-normalised
    import unicodedata
    text = unicodedata.normalize("NFD", "Serie Temporada 2 Capítol 7")

    assert (namer.extract_episode(text)["season"], namer.extract_episode(text)["episode"]) == (2, 7)


def test_group_key_for_double_episode():
    assert namer.group_key("", "Serie_1x01-02_Doble.mkv", 9) == "S01E01E02"
