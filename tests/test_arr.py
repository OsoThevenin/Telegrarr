"""Tests for the *arr integration layer (release naming, Newznab/NZB, API key)."""
from app import namer


def test_release_name_tv():
    n = namer.release_name("The Traitors (2025)", 2, 1, "720p", "tv")
    assert "S02E01" in n
    assert "720p" in n
    assert n.startswith("The.Traitors")
    assert " " not in n  # scene names use dots
    assert n == "The.Traitors.2025.S02E01.CAT.720p.WEB-DL.x264-TELEGRARR"


def test_release_name_quality_normalization():
    assert "2160p" in namer.release_name("Show", 1, 1, "4k")
    assert "2160p" in namer.release_name("Show", 1, 1, "UHD")
    assert "1080p" in namer.release_name("Show", 1, 1, "")   # sane default
    assert "S01E05" in namer.release_name("Show", 0, 5, "")   # episode-only -> S01


def test_build_save_path_rejects_traversal():
    # malicious channel filename must never escape base_dir (no season/episode path)
    for evil in ["../../../../data/telearr.db", "/etc/passwd", "..\\..\\x", "....//x.mp4"]:
        p = namer.build_save_path("/media/TvShows/1080p", "Show", 0, 0, evil, "")
        assert p.startswith("/media/TvShows/1080p/")
        assert ".." not in p.split("/")


def test_arr_nzb_ref_roundtrip():
    from app import arr
    xml = arr.nzb_xml(4, 7)
    assert arr.parse_ref(xml) == (4, 7)
    assert arr.parse_ref("nothing here") == (None, None)


def test_arr_caps_advertises_categories():
    from app import arr
    caps = arr.caps_xml()
    assert 'id="5000"' in caps and 'id="2000"' in caps
    assert '<server title="Telegrarr"' in caps


def test_arr_apikey_lifecycle(fresh_db):
    from app import arr
    k = arr.apikey()
    assert len(k) == 32
    assert arr.check_key(k)
    assert not arr.check_key("wrong")
    assert not arr.check_key("")
    k2 = arr.regenerate()
    assert k2 != k
    assert arr.check_key(k2)
    assert not arr.check_key(k)   # old key no longer valid


def test_sab_shapes(fresh_db):
    from app import arr
    assert arr.sab_version()["version"]
    assert "queue" in arr.sab_queue()
    assert "history" in arr.sab_history()
    assert "*" in arr.sab_categories()


def test_sab_config_categories_are_objects(fresh_db):
    # Sonarr/Radarr deserialize config.categories into objects — bare strings make
    # their download-client Test fail. Verified against real Sonarr 4.0.19 / Radarr 6.3.
    from app import arr
    cats = arr.sab_config()["config"]["categories"]
    assert cats and all(isinstance(c, dict) and "name" in c for c in cats)


def _seed_channel_releases(c, chat_id, tvdb_id, season, count):
    import time
    c.execute("INSERT INTO channels (chat_id, title, kind, tvdb_id, created_at) VALUES (?,?,?,?,?)",
              (chat_id, f"Show {tvdb_id}", "tv", tvdb_id, int(time.time())))
    cid = c.execute("SELECT id FROM channels WHERE chat_id=?", (chat_id,)).fetchone()[0]
    c.executemany("INSERT INTO releases (channel_id, message_id, title, season, episode, quality, size, added_at) "
                  "VALUES (?,?,?,?,?,?,?,?)",
                  [(cid, m, f"Show.S{season:02d}E{m:02d}", season, m, "1080p", 1, int(time.time()))
                   for m in range(1, count + 1)])


def test_id_search_finds_an_older_series_behind_more_than_the_scan_window(fresh_db):
    # Arrange: a busy newer series fills the newest-first window; the wanted one is older
    from app import arr, db
    with db.conn() as c:
        _seed_channel_releases(c, -1001, tvdb_id=111, season=1, count=3)
        _seed_channel_releases(c, -1002, tvdb_id=222, season=9, count=2100)

    # Act
    found = arr.search_releases("tvsearch", tvdbid="111", limit=100)

    # Assert
    assert [r["title"] for r in found] == ["Show.S01E03", "Show.S01E02", "Show.S01E01"]
