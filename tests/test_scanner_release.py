"""scanner.build_release: what a Telegram message becomes in the Newznab feed."""
import types

import pytest

pytest.importorskip("telethon")
from telethon.tl.types import DocumentAttributeFilename, DocumentAttributeVideo  # noqa: E402

SAMPLE_CAPTION = "3x13 Un viatge pel temps (2a Part)"


def _channel(**overrides):
    base = {"id": 1, "title": "Els anells de poder", "imdb_id": "", "imdb_title": "", "kind": "tv",
            "language": "cat", "fallback_quality": "720p"}
    return {**base, **overrides}


def _message(caption, file_name, dims=None):
    attrs = [DocumentAttributeFilename(file_name=file_name)]
    if dims:
        attrs.append(DocumentAttributeVideo(duration=1.0, w=dims[0], h=dims[1]))
    doc = types.SimpleNamespace(size=1000, attributes=attrs)
    return types.SimpleNamespace(id=7, message=caption, document=doc, video=None)


def test_release_from_catalan_caption_with_video_dimensions():
    from app import scanner
    msg = _message(SAMPLE_CAPTION, "video.mp4", dims=(1920, 1080))

    rel = scanner.build_release(_channel(), msg, "video.mp4")

    assert rel["title"] == "Els.anells.de.poder.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR"
    assert (rel["season"], rel["episode"], rel["quality"]) == (3, 13, "1080p")
    assert rel["episode_title"] == "Un viatge pel temps (2a Part)"


def test_release_uses_channel_fallback_quality_without_dimensions():
    from app import scanner
    msg = _message(SAMPLE_CAPTION, "video.mp4")

    rel = scanner.build_release(_channel(fallback_quality="720p"), msg, "video.mp4")

    assert rel["quality"] == "720p"
    assert ".720p." in rel["title"]


def test_quality_in_file_name_beats_channel_fallback():
    from app import scanner
    msg = _message("", "Serie.1x01.2160p.mkv")

    rel = scanner.build_release(_channel(), msg, "Serie.1x01.2160p.mkv")

    assert rel["quality"] == "2160p"


def test_release_carries_channel_language_token():
    from app import scanner
    msg = _message(SAMPLE_CAPTION, "video.mp4", dims=(1280, 720))

    rel = scanner.build_release(_channel(language="es", imdb_title="Show"), msg, "video.mp4")

    assert rel["title"] == "Show.S03E13.SPA.720p.WEB-DL.x264-TELEGRARR"


def test_release_from_underscore_filename_double_episode():
    from app import scanner
    fn = "Serie_1x01-02_Doble.mkv"
    msg = _message("", fn, dims=(1920, 1080))

    rel = scanner.build_release(_channel(imdb_title="Serie"), msg, fn)

    assert rel["title"] == "Serie.S01E01E02.CAT.1080p.WEB-DL.x264-TELEGRARR"


HARLOCK_FILE = "El Capità Harlock 01 - La bandera pirata de l'espai.mkv"


def test_episode_only_file_publishes_as_season_one():
    from app import scanner
    msg = _message("", HARLOCK_FILE, dims=(1280, 720))

    rel = scanner.build_release(_channel(imdb_title="Space Pirate Captain Harlock"), msg, HARLOCK_FILE)

    assert rel["title"] == "Space.Pirate.Captain.Harlock.S01E01.CAT.720p.WEB-DL.x264-TELEGRARR"
    assert (rel["season"], rel["episode"]) == (1, 1)
    assert rel["episode_title"] == "La bandera pirata de l'espai"


def test_file_episode_is_kept_when_caption_has_no_marker():
    from app import scanner
    msg = _message("El capità Harlock en català", HARLOCK_FILE)

    rel = scanner.build_release(_channel(), msg, HARLOCK_FILE)

    assert (rel["season"], rel["episode"]) == (1, 1)


def test_caption_season_episode_beats_episode_only_file():
    from app import scanner
    msg = _message("2x05 Un altre títol", HARLOCK_FILE)

    rel = scanner.build_release(_channel(), msg, HARLOCK_FILE)

    assert (rel["season"], rel["episode"]) == (2, 5)


def test_caption_episode_marker_beats_bare_number_in_file():
    from app import scanner
    msg = _message("Cap 5", HARLOCK_FILE)

    rel = scanner.build_release(_channel(), msg, HARLOCK_FILE)

    assert (rel["season"], rel["episode"]) == (1, 5)


def test_bare_number_in_caption_is_not_an_episode():
    from app import scanner
    msg = _message("Pujat el 12 de març", "video.mp4")

    rel = scanner.build_release(_channel(), msg, "video.mp4")

    assert (rel["season"], rel["episode"]) == (None, None)
