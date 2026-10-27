"""Movie channel parsing: a film's title and year from a caption or file name,
and the Radarr-friendly release name built from them."""
import pytest

from app.namer import extract_movie, release_name


@pytest.mark.parametrize("text, title, year", [
    ("La.teoria.del.tot.2014.CAT.1080p.WEB-DL.mkv", "La teoria del tot", 2014),
    ("El gran Lebowski (1998) [CAT] 720p.mp4", "El gran Lebowski", 1998),
    ("Pa_negre_2010_1080p.mkv", "Pa negre", 2010),
    ("🎬 Blade Runner 2049 (2017)", "Blade Runner 2049", 2017),
    ("2001: Una odissea de l'espai (1968)", "2001 Una odissea de l'espai", 1968),
])
def test_extract_movie_reads_title_and_year(text, title, year):
    movie = extract_movie(text)

    assert (movie.title, movie.year) == (title, year)


def test_extract_movie_without_a_year_keeps_the_title_and_no_year():
    movie = extract_movie("Pel·lícula sense any 1080p.mkv")

    assert movie.title == "Pel·lícula sense any"
    assert movie.year is None


def test_extract_movie_reads_the_quality_tag():
    assert extract_movie("Pa.negre.2010.720p.mkv").quality == "720p"


def test_movie_release_name_has_year_then_language_token():
    name = release_name("The Theory of Everything", 0, 0, "1080p", kind="movie", language="cat", year=2014)

    assert name == "The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"
