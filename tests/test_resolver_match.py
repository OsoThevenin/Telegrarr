"""Matching a "(Na Part)" title against a season's episode names (resolver.match_part)."""
import pytest

from app.resolver import match_part

SPLIT = [(12, "La paradoxa"), (13, "La Dansa de l'Àvia (1)"), (14, "La Dansa de l'Àvia (2)"), (15, "Final")]


@pytest.mark.parametrize("part, expected", [(1, 13), (2, 14)])
def test_parts_map_onto_consecutive_episodes_sharing_the_base_title(part, expected):
    assert match_part(SPLIT, "La dansa de l'avia", part, episode=13) == expected


def test_accents_case_and_punctuation_are_ignored():
    listing = [(4, "EL CÓR DEL BOSC - Part 1"), (5, "EL CÓR DEL BOSC - Part 2")]

    assert match_part(listing, "El cor del bosc", 2, episode=4) == 5


def test_a_small_spelling_difference_still_matches():
    listing = [(7, "Un viatge pel temps (1)"), (8, "Un viatje pel temps (2)")]

    assert match_part(listing, "Un viatge pel temps", 2, episode=7) == 8


def test_a_different_title_is_not_a_match():
    assert match_part(SPLIT, "La dansa del sol", 2, episode=13) is None


def test_a_single_matching_episode_keeps_the_channel_number():
    assert match_part([(13, "La Dansa de l'Àvia"), (14, "Final")], "La dansa de l'avia", 2, episode=13) == 13


def test_a_part_beyond_the_listed_parts_keeps_the_channel_number():
    assert match_part(SPLIT, "La dansa de l'avia", 3, episode=13) == 13


def test_a_trailing_number_in_a_title_is_not_a_part_marker():
    listing = [(3, "Apollo 13"), (4, "Apollo 13")]

    assert match_part(listing, "Apollo", 2, episode=3) is None
