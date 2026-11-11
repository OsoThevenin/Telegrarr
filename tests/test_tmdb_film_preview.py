"""GET /api/tmdb/movie: what a typed TMDB id, TMDB link or IMDb id names, before
the Review screen assigns it. Read-only: it never touches the review queue.

Driven over HTTP (``arr_app``) with TMDB faked at the httpx transport (``fake_tmdb``).
"""
import pytest
import pytest_asyncio

from fake_tmdb import API_KEY

THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB = 50797
THEORY_PREVIEW = {
    "tmdb_id": THEORY_TMDB,
    "imdb_id": THEORY_IMDB,
    "title": "La teoria del tot",
    "original_title": "The Theory of Everything",
    "year": "2014",
    "poster": f"https://image.tmdb.org/t/p/w342/movie{THEORY_TMDB}.jpg",
    "overview": "La vida de Stephen Hawking.",
}


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB,
                        overviews={"ca-ES": "La vida de Stephen Hawking.", "en-US": "Stephen Hawking's life."})
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", has_poster=False,
                        overviews={"en-US": "A boy in post-war Catalonia."})
    return fake_tmdb


@pytest_asyncio.fixture()
async def keyed_app(arr_app):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    return arr_app


async def _preview(app, typed: str):
    return await app.http.get("/api/tmdb/movie", params={"id": typed})


@pytest.mark.asyncio
@pytest.mark.parametrize("typed", [
    str(THEORY_TMDB),
    f"https://www.themoviedb.org/movie/{THEORY_TMDB}-the-theory-of-everything",
    THEORY_IMDB,
])
async def test_a_typed_film_id_previews_the_film_it_names(keyed_app, films, typed):
    r = await _preview(keyed_app, typed)

    assert (r.status_code, r.json()) == (200, THEORY_PREVIEW)


@pytest.mark.asyncio
async def test_a_film_without_a_catalan_synopsis_or_poster_previews_the_english_one(keyed_app, films):
    r = await _preview(keyed_app, str(PA_NEGRE_TMDB))

    assert r.json() == {
        "tmdb_id": PA_NEGRE_TMDB, "imdb_id": None, "title": "Pa negre", "original_title": "Pa negre",
        "year": "2010", "poster": "", "overview": "A boy in post-war Catalonia.",
    }


@pytest.mark.asyncio
async def test_previewing_assigns_nothing(keyed_app, films):
    await _preview(keyed_app, str(THEORY_TMDB))

    assert (await keyed_app.http.get("/api/review")).json() == []
    assert films.movie_searches() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("typed, key", [
    ("nope", "err.tmdb.bad_id"),
    ("https://www.themoviedb.org/tv/61662-merli", "err.tmdb.link_not_film"),
    ("999999", "err.tmdb.no_film_id"),
    ("tt0000001", "err.tmdb.no_film_imdb"),
])
async def test_an_unusable_typed_id_is_a_keyed_400(keyed_app, films, typed, key):
    r = await _preview(keyed_app, typed)

    assert (r.status_code, r.json()["detail"]["key"]) == (400, key)


@pytest.mark.asyncio
async def test_previewing_without_a_tmdb_key_is_400(arr_app, films):
    r = await _preview(arr_app, str(THEORY_TMDB))

    assert (r.status_code, r.json()["detail"]["key"]) == (400, "err.tmdb.key_missing")


@pytest.mark.asyncio
async def test_previewing_needs_a_signed_in_user(keyed_app, films):
    keyed_app.http.cookies.clear()

    r = await _preview(keyed_app, str(THEORY_TMDB))

    assert r.status_code == 401
