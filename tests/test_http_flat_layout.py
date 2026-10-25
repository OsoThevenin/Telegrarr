"""*arr mode: SABnzbd grabs land in a flat release folder under the downloads base.

``<downloads base>/telegram/<category>/<release name>/<file>`` is the path Sonarr
and Radarr see, so no remote path mapping is needed. Driven over HTTP only.
"""
import os
import xml.etree.ElementTree as ET

import pytest

from http_harness import eventually

TV_CHAT = -1001000000001
MOVIE_CHAT = -1001000000002
SAB_PATH = "/sabnzbd/api"


def _first_item(feed_xml: str) -> tuple[str, str]:
    """(release title, enclosure url) of the first item in a Newznab feed."""
    item = ET.fromstring(feed_xml).find("./channel/item")
    return item.find("title").text, item.find("enclosure").attrib["url"]


async def _search(arr_app, kind: str, query: str) -> tuple[str, str]:
    t = "tvsearch" if kind == "tv" else "movie"
    r = await arr_app.http.get("/api/newznab", params={"t": t, "apikey": arr_app.apikey, "q": query})
    return _first_item(r.raise_for_status().text)


async def _sab(arr_app, **params) -> dict:
    r = await arr_app.http.get(SAB_PATH, params={"apikey": arr_app.apikey, "output": "json", **params})
    return r.raise_for_status().json()


async def _publish(arr_app, chat_id: int, kind: str, title: str, *, text: str, file_name: str,
                   content: bytes) -> dict:
    """A channel with one media post, added and scanned."""
    arr_app.telegram.add_channel(chat_id, title)
    arr_app.telegram.post(chat_id, text=text, file_name=file_name, content=content)
    channel = await arr_app.add_channel(chat_id, kind=kind)
    await arr_app.scan(channel["id"])
    return channel


@pytest.mark.asyncio
async def test_tv_grab_lands_in_flat_release_folder(arr_app, library_dirs):
    content = b"tv-bytes" * 64
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="The.Show.S01E02.1080p.mkv", content=content)
    release, url = await _search(arr_app, "tv", "the show")

    added = await _sab(arr_app, mode="addurl", name=url, cat="tv")
    slot = await arr_app.history_slot(added["nzo_ids"][0])

    folder = os.path.join(library_dirs["DOWNLOADS_DIR"], "telegram", "tv", release)
    assert slot["storage"] == folder
    assert slot["path"] == folder
    with open(os.path.join(folder, "The.Show.S01E02.1080p.mkv"), "rb") as fh:
        assert fh.read() == content


@pytest.mark.asyncio
async def test_movie_grab_lands_in_movies_category_folder(arr_app, library_dirs):
    content = b"movie-bytes" * 64
    await _publish(arr_app, MOVIE_CHAT, "movie", "Pa negre", text="Pa negre 1080p",
                   file_name="Pa.negre.1080p.mkv", content=content)
    release, url = await _search(arr_app, "movie", "pa negre")

    added = await _sab(arr_app, mode="addurl", name=url, cat="movies")
    slot = await arr_app.history_slot(added["nzo_ids"][0])

    folder = os.path.join(library_dirs["DOWNLOADS_DIR"], "telegram", "movies", release)
    assert slot["storage"] == folder
    with open(os.path.join(folder, "Pa.negre.1080p.mkv"), "rb") as fh:
        assert fh.read() == content


@pytest.mark.asyncio
async def test_queue_reports_flat_release_folder_while_downloading(arr_app, library_dirs):
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="The.Show.S01E02.1080p.mkv", content=b"x" * 512)
    release, url = await _search(arr_app, "tv", "the show")
    arr_app.telegram.hold_downloads()

    added = await _sab(arr_app, mode="addurl", name=url, cat="tv")
    queue = await _sab(arr_app, mode="queue")
    arr_app.telegram.release_downloads()

    [slot] = queue["queue"]["slots"]
    assert slot["nzo_id"] == added["nzo_ids"][0]
    folder = os.path.join(library_dirs["DOWNLOADS_DIR"], "telegram", "tv", release)
    assert slot["storage"] == folder


@pytest.mark.asyncio
async def test_arr_mode_scan_indexes_without_downloading(arr_app):
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="The.Show.S01E02.1080p.mkv", content=b"x" * 512)

    queue = await _sab(arr_app, mode="queue")
    history = await _sab(arr_app, mode="history")

    assert arr_app.telegram.downloaded == []
    assert queue["queue"]["slots"] == []
    assert history["history"]["slots"] == []


@pytest.mark.asyncio
async def test_standalone_mode_scan_still_downloads_into_library_layout(arr_app, library_dirs):
    patched = await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})
    assert patched.json()["settings"]["operating_mode"] == "standalone"
    content = b"library-bytes" * 64
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="The.Show.S01E02.1080p.mkv", content=content)

    async def completed() -> list:
        return (await _sab(arr_app, mode="history"))["history"]["slots"]

    [slot] = await eventually(completed)

    library_file = os.path.join(library_dirs["TV_DIR"], "The Show", "Season 01", "The Show - S01E02.mkv")
    assert slot["storage"] == library_file
    with open(library_file, "rb") as fh:
        assert fh.read() == content


@pytest.mark.asyncio
async def test_hostile_file_name_cannot_escape_release_folder(arr_app, library_dirs):
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="../../../../escape S01E02.mkv", content=b"x" * 512)
    release, url = await _search(arr_app, "tv", "the show")

    added = await _sab(arr_app, mode="addurl", name=url, cat="tv")
    slot = await arr_app.history_slot(added["nzo_ids"][0])

    folder = os.path.join(library_dirs["DOWNLOADS_DIR"], "telegram", "tv", release)
    assert slot["storage"] == folder
    assert os.listdir(folder) == ["escape S01E02.mkv"]


@pytest.mark.asyncio
async def test_downloads_base_is_configurable_over_settings_api(arr_app, tmp_path):
    base = str(tmp_path / "elsewhere")
    patched = await arr_app.http.patch("/api/settings", json={"downloads_dir": base})
    assert patched.json()["settings"]["downloads_dir"] == base
    await _publish(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                   file_name="The.Show.S01E02.1080p.mkv", content=b"x" * 512)
    release, url = await _search(arr_app, "tv", "the show")

    added = await _sab(arr_app, mode="addurl", name=url, cat="tv")
    slot = await arr_app.history_slot(added["nzo_ids"][0])
    config = await _sab(arr_app, mode="get_config")

    assert slot["storage"] == os.path.join(base, "telegram", "tv", release)
    assert config["config"]["misc"]["complete_dir"] == os.path.join(base, "telegram")


@pytest.mark.asyncio
async def test_relative_downloads_base_is_rejected(arr_app, library_dirs):
    patched = await arr_app.http.patch("/api/settings", json={"downloads_dir": "../etc"})

    assert patched.json()["settings"]["downloads_dir"] == library_dirs["DOWNLOADS_DIR"]
