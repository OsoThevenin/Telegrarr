"""SAB queue and history name each job by its Release title, as a real SABnzbd does (#95).

Sonarr parses the job name to tie a download to a series; a Telegram file basename
like ``S05e26 - Episode Title.mkv`` has no series in it and blocks import. The file
on disk keeps its name. Plays Sonarr/Radarr over HTTP (``arr_app``).
"""
import os
import xml.etree.ElementTree as ET

import pytest

from fake_tmdb import API_KEY as TMDB_KEY

TV_CHAT = -1001000000095
MOVIE_CHAT = -1001000000096
TV_FILE = "S01e02 - Episode Title.mkv"
MOVIE_FILE = "pelicula.mkv"


async def _grab(arr_app, chat_id: int, kind: str, title: str, *, text: str, file_name: str,
                query: str) -> tuple[str, str]:
    """Publish one post, search for it as Sonarr/Radarr would and Grab it:
    (release title, nzo_id)."""
    arr_app.telegram.add_channel(chat_id, title)
    arr_app.telegram.post(chat_id, text=text, file_name=file_name, content=b"x" * 512)
    channel = await arr_app.add_channel(chat_id, kind=kind)
    await arr_app.scan(channel["id"])
    t = "tvsearch" if kind == "tv" else "movie"
    feed = await arr_app.http.get("/api/newznab", params={"t": t, "apikey": arr_app.apikey,
                                                          "q": query})
    item = ET.fromstring(feed.raise_for_status().text).find("./channel/item")
    release, url = item.find("title").text, item.find("enclosure").attrib["url"]
    added = await arr_app.sab(mode="addurl", name=url, cat="tv" if kind == "tv" else "movies")
    return release, added["nzo_ids"][0]


async def _grab_tv(arr_app) -> tuple[str, str]:
    return await _grab(arr_app, TV_CHAT, "tv", "The Show", text="The Show S01E02 1080p",
                       file_name=TV_FILE, query="the show")


async def _grab_movie(arr_app, fake_tmdb) -> tuple[str, str]:
    fake_tmdb.add_movie(50797, titles={"ca-ES": "Pa negre", "en-US": "Pa negre"},
                        release_date="2010-10-15")
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": TMDB_KEY})).raise_for_status()
    return await _grab(arr_app, MOVIE_CHAT, "movie", "Pa negre", text="Pa negre (2010) 1080p",
                       file_name=MOVIE_FILE, query="pa negre")


async def _queue_slot(arr_app, nzo: str) -> dict:
    [slot] = [s for s in (await arr_app.sab(mode="queue"))["queue"]["slots"] if s["nzo_id"] == nzo]
    return slot


@pytest.mark.asyncio
async def test_tv_history_names_the_job_by_its_release_title(arr_app, library_dirs):
    release, nzo = await _grab_tv(arr_app)

    slot = await arr_app.history_slot(nzo)

    assert release != TV_FILE
    assert slot["name"] == release
    assert os.path.isfile(os.path.join(slot["storage"], TV_FILE))


@pytest.mark.asyncio
async def test_tv_queue_names_the_job_by_its_release_title(arr_app):
    arr_app.telegram.hold_downloads()
    release, nzo = await _grab_tv(arr_app)

    slot = await _queue_slot(arr_app, nzo)
    arr_app.telegram.release_downloads()

    assert slot["filename"] == release


@pytest.mark.asyncio
async def test_movie_history_names_the_job_by_its_release_title(arr_app, library_dirs, fake_tmdb):
    release, nzo = await _grab_movie(arr_app, fake_tmdb)

    slot = await arr_app.history_slot(nzo)

    assert release != MOVIE_FILE
    assert slot["name"] == release
    assert os.path.isfile(os.path.join(slot["storage"], MOVIE_FILE))


@pytest.mark.asyncio
async def test_movie_queue_names_the_job_by_its_release_title(arr_app, fake_tmdb):
    arr_app.telegram.hold_downloads()
    release, nzo = await _grab_movie(arr_app, fake_tmdb)

    slot = await _queue_slot(arr_app, nzo)
    arr_app.telegram.release_downloads()

    assert slot["filename"] == release
