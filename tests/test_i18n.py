"""UI language: dictionaries, translation and the persisted language setting."""
import json
import re
from pathlib import Path

import pytest

from app import i18n, settings

I18N_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "i18n"
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _dictionary(lang):
    return json.loads((I18N_DIR / f"{lang}.json").read_text(encoding="utf-8"))


def test_catalan_and_english_dictionaries_have_identical_keys():
    ca, en = _dictionary("ca"), _dictionary("en")
    assert set(ca) - set(en) == set(), "keys only in ca.json"
    assert set(en) - set(ca) == set(), "keys only in en.json"


def test_each_translation_uses_the_same_placeholders_in_both_languages():
    ca, en = _dictionary("ca"), _dictionary("en")
    mismatched = {key for key in en
                  if set(PLACEHOLDER.findall(en[key])) != set(PLACEHOLDER.findall(ca[key]))}
    assert mismatched == set()


def test_no_translation_is_empty():
    for lang in i18n.LANGS:
        assert [k for k, v in _dictionary(lang).items() if not v.strip()] == []


def test_translate_fills_placeholders_in_the_requested_language():
    assert i18n.translate("err.settings.poll_floor", "en", floor=15) == "Poll interval must be at least 15 minutes"
    assert i18n.translate("err.settings.poll_floor", "ca", floor=15) == "L’interval de consulta ha de ser d’almenys 15 minuts"


def test_translate_returns_the_key_when_it_is_unknown():
    assert i18n.translate("no.such.key", "ca") == "no.such.key"


def test_ui_language_defaults_to_catalan(fresh_db):
    assert settings.public()["ui_lang"] == "ca"
    assert i18n.ui_lang() == "ca"


def test_ui_language_switches_to_english_and_persists(fresh_db):
    settings.apply({"ui_lang": "en"})
    assert settings.public()["ui_lang"] == "en"
    assert i18n.translate("err.settings.poll_floor", floor=15) == "Poll interval must be at least 15 minutes"


def test_unknown_ui_language_is_rejected(fresh_db):
    with pytest.raises(settings.SettingRejected) as exc:
        settings.apply({"ui_lang": "fr"})
    assert exc.value.key == "err.settings.ui_lang"
    assert settings.public()["ui_lang"] == "ca"
