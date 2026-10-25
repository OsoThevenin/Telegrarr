"""Tests for app.namer — pure stdlib parsing/path building (no network)."""
import pytest

from app import namer


# --------------------------------------------------------------------------
# extract_episode: season/episode/date detection across separators
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text, season, episode", [
    ("S15E01", 15, 1),
    ("Khatron_Ke_Khiladi_Season_15_Episode_1", 15, 1),
    ("KKK_S15_E02_720p", 15, 2),
    ("Show.15x03.2160p", 15, 3),
    ("Some Show S01 E10", 1, 10),
    ("Show S15E123", 15, 123),  # 3-digit episode
])
def test_extract_episode_season_episode(text, season, episode):
    info = namer.extract_episode(text)
    assert info["season"] == season
    assert info["episode"] == episode


def test_extract_episode_date_only():
    info = namer.extract_episode("Daily News 2024.05.10 morning edition")
    assert info["date"] == "2024-05-10"
    assert info["season"] is None
    assert info["episode"] is None


@pytest.mark.parametrize("text, episode", [
    ("Episode 5", 5),
    ("Ep 7", 7),
    ("The show Ep_012 final", 12),
])
def test_extract_episode_episode_only(text, episode):
    info = namer.extract_episode(text)
    assert info["episode"] == episode
    assert info["season"] is None


def test_extract_episode_empty():
    assert namer.extract_episode("") == {
        "season": None, "episode": None, "episode_end": None, "date": None, "quality": None}


# --------------------------------------------------------------------------
# quality detection across _ / space / dot separators
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text, quality", [
    ("movie_720p_x264", "720p"),
    ("movie 720p web", "720p"),
    ("movie.720p.mkv", "720p"),
    ("clip_2160p_final", "2160p"),
    ("Show.4K.mkv", "4k"),
    ("Film 4k", "4k"),
    ("Movie UHD remux", "uhd"),
    ("Series 1080p", "1080p"),
    ("Old.480p.avi", "480p"),
])
def test_quality_detection(text, quality):
    assert namer.extract_episode(text)["quality"] == quality


def test_quality_none_when_absent():
    assert namer.extract_episode("just.a.plain.x264.file")["quality"] is None


def test_quality_not_matched_when_glued_to_alnum():
    # negative look-around means "1080px" / "a720p" should not match
    assert namer.extract_episode("weird1080px")["quality"] is None


# --------------------------------------------------------------------------
# is_uhd
# --------------------------------------------------------------------------
@pytest.mark.parametrize("q, expected", [
    ("2160p", True),
    ("4k", True),
    ("4K", True),
    ("uhd", True),
    ("UHD", True),
    ("1080p", False),
    ("720p", False),
    (None, False),
    ("", False),
])
def test_is_uhd(q, expected):
    assert namer.is_uhd(q) is expected


# --------------------------------------------------------------------------
# build_save_path — Plex layout
# --------------------------------------------------------------------------
def test_build_save_path_plex_layout():
    p = namer.build_save_path("/media/tv", "My Show", 15, 1, "file.mkv", "The Title")
    assert p == "/media/tv/My Show/Season 15/My Show - S15E01 - The Title.mkv"


def test_build_save_path_no_episode_title():
    p = namer.build_save_path("/media/tv", "My Show", 3, 7, "file.mkv")
    assert p == "/media/tv/My Show/Season 03/My Show - S03E07.mkv"


def test_build_save_path_colon_sanitized():
    p = namer.build_save_path("/media/tv", "Show: Origins", 2, 3, "f.mp4", "Ep: Two")
    # colon is an illegal path char -> replaced with underscore
    assert ":" not in p
    assert "Show_ Origins" in p
    assert "Ep_ Two" in p


def test_build_save_path_extension_lowercased():
    p = namer.build_save_path("/media/tv", "Show", 1, 2, "clip.MKV", "Title")
    assert p.endswith(".mkv")


def test_build_save_path_default_extension():
    p = namer.build_save_path("/media/tv", "Show", 1, 2, "noext", "Title")
    assert p.endswith(".mp4")


def test_build_save_path_episode_title_trailing_ext_stripped():
    p = namer.build_save_path("/media/tv", "My Show", 1, 2, "clip.mkv", "Title.mkv")
    assert p == "/media/tv/My Show/Season 01/My Show - S01E02 - Title.mkv"


@pytest.mark.parametrize("season", [0, None])
def test_build_save_path_episode_only_is_season_01(season):
    p = namer.build_save_path("/media/tv", "My Show", season, 5, "f.mp4")
    assert p == "/media/tv/My Show/Season 01/My Show - S01E05.mp4"


def test_build_save_path_no_season_no_episode_falls_back_to_filename():
    p = namer.build_save_path("/media/tv", "My Show", 0, 0, "raw.mkv")
    assert p == "/media/tv/My Show/raw.mkv"


def test_build_save_path_empty_show_becomes_unknown():
    p = namer.build_save_path("/media/tv", "", 1, 1, "f.mkv")
    assert p.startswith("/media/tv/Unknown/")


# --------------------------------------------------------------------------
# extract_episode_title — junk stripping / show-name removal
# --------------------------------------------------------------------------
def test_extract_episode_title_strips_show_and_junk():
    out = namer.extract_episode_title(
        "Khatron Ke Khiladi S15E01 The Big Jump 1080p x265 H.264",
        "", 15, 1, "Khatron Ke Khiladi")
    assert out == "The Big Jump"


def test_extract_episode_title_strips_h264_spaced():
    out = namer.extract_episode_title("The Grand Finale H 264", "", 15, 1, "")
    assert out == "The Grand Finale"


def test_extract_episode_title_from_filename():
    out = namer.extract_episode_title(
        "", "KKK.S15E01.The.Escape.720p.x265.mkv", 15, 1, "KKK")
    assert out == "The Escape"


def test_extract_episode_title_empty_source():
    assert namer.extract_episode_title("", "", 1, 1, "") == ""


def test_extract_episode_title_too_short_returns_empty():
    # after stripping everything, nothing meaningful (< 3 chars) remains
    out = namer.extract_episode_title("1080p x265", "", 1, 1, "")
    assert out == ""


# --------------------------------------------------------------------------
# group_key
# --------------------------------------------------------------------------
def test_group_key_season_episode():
    assert namer.group_key("", "KKK_S15E02_720p.mkv", 99) == "S15E02"


def test_group_key_episode_only():
    assert namer.group_key("Episode 5", "", 99) == "E005"


def test_group_key_date():
    assert namer.group_key("News 2024.05.10", "", 99) == "D2024-05-10"


def test_group_key_falls_back_to_message_id():
    assert namer.group_key("", "random.mkv", 12345) == "MID12345"


def test_group_key_prefers_filename_over_caption():
    # filename carries S/E, caption does not -> filename wins
    assert namer.group_key("some caption", "Show.S02E04.mkv", 7) == "S02E04"


# --------------------------------------------------------------------------
# flat_save_path: *arr layout <root>/<category>/<release>/<file>, traversal-proof
# --------------------------------------------------------------------------
def test_flat_save_path_builds_category_release_file():
    path = namer.flat_save_path("/downloads/telegram", "tv", "Show.S01E02.1080p", "Show.S01E02.mkv")
    assert path == "/downloads/telegram/tv/Show.S01E02.1080p/Show.S01E02.mkv"


@pytest.mark.parametrize("release, file_name, expected", [
    ("..", "a.mkv", "/dl/tv/Unknown/a.mkv"),
    ("../../etc", "a.mkv", "/dl/tv/etc/a.mkv"),
    ("Rel", "..\\..\\passwd", "/dl/tv/Rel/passwd"),
    ("Rel", ".hidden.mkv", "/dl/tv/Rel/hidden.mkv"),
    ("Rel: <A|B>?", "", "/dl/tv/Rel_ _A_B__/file"),
])
def test_flat_save_path_neutralises_hostile_names(release, file_name, expected):
    assert namer.flat_save_path("/dl", "tv", release, file_name) == expected
