"""Connect page: the default Radarr quality profile and root folder used when
Telegrarr adds a film, driven over HTTP against the fake Radarr (tests/fake_arr.py)."""
import pytest

from fake_arr import RADARR_KEY

RADARR = {"radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
DEFAULTS_URL = "/api/connect/radarr/defaults"


async def _connect_radarr(arr_app, arrs, **overrides):
    arrs.radarr.quality_profiles = [{"id": 4, "name": "HD-1080p"}, {"id": 7, "name": "Ultra-HD"}]
    arrs.radarr.root_folders = [{"id": 1, "path": "/movies", "freeSpace": 100},
                                {"id": 2, "path": "/movies4k", "freeSpace": 200}]
    await arr_app.http.patch("/api/settings", json={**RADARR, **overrides})


@pytest.mark.asyncio
async def test_choices_come_from_radarr_and_default_to_its_first_entries(arr_app, arrs):
    await _connect_radarr(arr_app, arrs)

    r = await arr_app.http.get(DEFAULTS_URL)

    assert r.status_code == 200
    assert r.json() == {
        "quality_profiles": [{"id": 4, "name": "HD-1080p"}, {"id": 7, "name": "Ultra-HD"}],
        "root_folders": [{"path": "/movies"}, {"path": "/movies4k"}],
        "selected": {"quality_profile_id": 4, "root_folder": "/movies"},
    }
    asked = {req.url.path for req in arrs.radarr.requests}
    assert {"/api/v3/qualityprofile", "/api/v3/rootfolder"} <= asked


@pytest.mark.asyncio
async def test_saved_selection_is_stored_with_the_connection_settings(arr_app, arrs):
    await _connect_radarr(arr_app, arrs)

    r = await arr_app.http.put(DEFAULTS_URL, json={"quality_profile_id": 7, "root_folder": "/movies4k"})

    assert r.status_code == 200
    assert r.json() == {"quality_profile_id": 7, "root_folder": "/movies4k"}
    s = (await arr_app.http.get("/api/settings")).json()["settings"]
    assert (s["radarr_quality_profile_id"], s["radarr_root_folder"]) == (7, "/movies4k")
    selected = (await arr_app.http.get(DEFAULTS_URL)).json()["selected"]
    assert selected == {"quality_profile_id": 7, "root_folder": "/movies4k"}


@pytest.mark.asyncio
async def test_a_saved_choice_radarr_no_longer_offers_falls_back_to_its_first(arr_app, arrs):
    await _connect_radarr(arr_app, arrs)
    await arr_app.http.put(DEFAULTS_URL, json={"quality_profile_id": 99, "root_folder": "/gone"})

    selected = (await arr_app.http.get(DEFAULTS_URL)).json()["selected"]

    assert selected == {"quality_profile_id": 4, "root_folder": "/movies"}


@pytest.mark.asyncio
async def test_unconfigured_radarr_is_a_keyed_error_with_no_invented_choices(arr_app, arrs):
    r = await arr_app.http.get(DEFAULTS_URL)

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.arr.not_set", "params": {"app": "Radarr"}}
    assert arrs.radarr.requests == []


@pytest.mark.asyncio
async def test_unreachable_radarr_is_a_keyed_error(arr_app, arrs):
    await _connect_radarr(arr_app, arrs, radarr_url="http://nowhere.test:7878")

    r = await arr_app.http.get(DEFAULTS_URL)

    assert r.status_code == 502
    detail = r.json()["detail"]
    assert detail["key"] == "err.arr.unreachable"
    assert detail["params"]["app"] == "Radarr"
    assert "quality_profiles" not in r.text


@pytest.mark.asyncio
async def test_radarr_without_profiles_or_folders_offers_no_selection(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json=RADARR)

    r = await arr_app.http.get(DEFAULTS_URL)

    assert r.status_code == 200
    assert r.json() == {"quality_profiles": [], "root_folders": [],
                        "selected": {"quality_profile_id": None, "root_folder": None}}


@pytest.mark.asyncio
async def test_connect_page_renders_the_radarr_default_selects(arr_app):
    js = (await arr_app.http.get("/static/js/connect.js")).text

    assert "/api/connect/radarr/defaults" in js
    assert 'connect.radarr_defaults.profile' in js and 'connect.radarr_defaults.root_folder' in js


@pytest.mark.asyncio
async def test_saving_a_malformed_selection_is_a_keyed_error(arr_app, arrs):
    await _connect_radarr(arr_app, arrs)

    r = await arr_app.http.put(DEFAULTS_URL, json={"quality_profile_id": "abc", "root_folder": "/movies"})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.request.invalid"
