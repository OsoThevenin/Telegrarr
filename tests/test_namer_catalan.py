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


# --------------------------------------------------------------------------
# Episode title: text after the marker
# --------------------------------------------------------------------------
@pytest.mark.parametrize("caption, filename, expected", [
    (SAMPLE_CAPTION, "", "Un viatge pel temps (2a Part)"),
    ("", SAMPLE_FILENAME, "Una ombra del passat"),
    ("Serie T3C13 Un viatge (1a Part) 1080p", "", "Un viatge (1a Part)"),
    ("Serie Temporada 3 Capítol 13 - La tornada", "", "La tornada"),
    ("Serie 1x01-02 Doble episodi", "", "Doble episodi"),
    ("La casa de l'avi 2x05 L'avi torna.mkv", "", "L'avi torna"),
])
def test_episode_title_is_text_after_marker(caption, filename, expected):
    title = namer.extract_episode_title(caption, filename, 0, 0, show_title="", mapped=True)

    assert title == expected


def test_episode_title_picks_the_line_with_the_marker():
    caption = "📺 Canal de sèries\n3x13 Un viatge pel temps (2a Part)\nMida: 1.2 GB"

    assert namer.extract_episode_title(caption, "", 3, 13, mapped=True) == "Un viatge pel temps (2a Part)"


def test_mapped_channel_ignores_text_before_marker_when_nothing_follows():
    assert namer.extract_episode_title("Els anells de poder 1x01", "", 1, 1, mapped=True) == ""


def test_unmapped_channel_falls_back_to_text_before_marker():
    title = namer.extract_episode_title("La Gran Final 1x01", "", 1, 1, show_title="", mapped=False)

    assert title == "La Gran Final"


def test_other_brackets_are_still_stripped():
    title = namer.extract_episode_title("3x13 Un viatge [WEB] (2023) (2a Part)", "", 3, 13, mapped=True)

    assert title == "Un viatge (2a Part)"


# --------------------------------------------------------------------------
# Quality from Telegram video dimensions
# --------------------------------------------------------------------------
@pytest.mark.parametrize("width, height, expected", [
    (1920, 1080, "1080p"),
    (1280, 720, "720p"),
    (3840, 2160, "2160p"),
    (1920, 800, "1080p"),   # scope-cropped 1080p
    (960, 540, "SDTV"),
    (720, 576, "SDTV"),
])
def test_quality_from_dimensions(width, height, expected):
    assert namer.quality_from_dims(width, height, fallback="720p") == expected


@pytest.mark.parametrize("width, height", [(None, None), (0, 0), (1920, None)])
def test_quality_from_missing_dimensions_uses_fallback(width, height):
    assert namer.quality_from_dims(width, height, fallback="720p") == "720p"


# --------------------------------------------------------------------------
# Release name: language token + TELEGRARR group
# --------------------------------------------------------------------------
def test_release_name_spec_format():
    name = namer.release_name("Show", 3, 13, "1080p", "tv", language="cat")

    assert name == "Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR"
    assert CATALAN_TITLE_FORMAT.search(name)


@pytest.mark.parametrize("language, token", [
    ("cat", "CAT"), ("es", "SPA"), ("en", "ENG"), ("multi", "MULTI"),
])
def test_release_name_language_token(language, token):
    name = namer.release_name("Show", 1, 2, "720p", language=language)

    assert name == f"Show.S01E02.{token}.720p.WEB-DL.x264-TELEGRARR"


def test_release_name_defaults_to_catalan():
    assert ".CAT." in namer.release_name("Show", 1, 2, "720p")


def test_release_name_sdtv_maps_to_480p():
    assert namer.release_name("Show", 1, 2, "SDTV") == "Show.S01E02.CAT.480p.WEB-DL.x264-TELEGRARR"


def test_release_name_double_episode():
    name = namer.release_name("Show", 1, 1, "1080p", episode_end=2)

    assert name == "Show.S01E01E02.CAT.1080p.WEB-DL.x264-TELEGRARR"


# --------------------------------------------------------------------------
# bare-number fallback: "Show 01 - Title" (issue #20)
# --------------------------------------------------------------------------
HARLOCK_SAMPLES = [
    ("El Capità Harlock 01 - La bandera pirata de l'espai.mkv", 1, "La bandera pirata de l'espai"),
    ("El_Capità_Harlock_02_Un_objecte_arriba_d'espais_desconeguts.mkv", 2,
     "Un objecte arriba d'espais desconeguts"),
]


@pytest.mark.parametrize("filename, episode", [
    *((filename, episode) for filename, episode, _title in HARLOCK_SAMPLES),
    ("Harlock.01.720p.mkv", 1),
    ("Harlock 03.720p.x264.mkv", 3),
    ("Harlock.04.Title.mkv", 4),
])
def test_bare_number_after_show_name_is_the_episode(filename, episode):
    info = namer.extract_episode(filename, bare=True)
    assert (info["season"], info["episode"]) == (None, episode)


def test_bare_number_is_off_unless_asked_for():
    assert namer.extract_episode(HARLOCK_SAMPLES[0][0])["episode"] is None


@pytest.mark.parametrize("filename, episode, title", HARLOCK_SAMPLES)
def test_bare_number_episode_title_is_text_after_number(filename, episode, title):
    assert namer.extract_episode_title("", filename, 1, episode, show_title="El Capità Harlock",
                                       mapped=True, bare=True) == title


@pytest.mark.parametrize("text", [
    "Pel·lícula 1978 restaurada.mkv",
    "Show.2019.720p.mkv",
    "Show 1080p x264.mkv",
    "Show h265 AAC 5.1.mkv",
    "Show H.264 x 265.mkv",
    "Show Part2 final.mkv",
    "Show 700 MB.mkv",
    "Show 1.5 GB.mkv",
    "Show 10 bit.mkv",
    "Show Part 2.mkv",
    "Show Vol. 3.mkv",
    "Show CD 1.mkv",
    "Show 12-03-2021.mkv",
])
def test_non_episode_numbers_are_not_bare_episodes(text):
    assert namer.extract_episode(text, bare=True)["episode"] is None


@pytest.mark.parametrize("text, season, episode", [
    ("Show 05 S02E07.mkv", 2, 7),
    ("Show 05 Cap 3.mkv", None, 3),
])
def test_existing_markers_beat_the_bare_number(text, season, episode):
    info = namer.extract_episode(text, bare=True)
    assert (info["season"], info["episode"]) == (season, episode)
