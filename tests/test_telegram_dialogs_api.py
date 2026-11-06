"""The chats Add channel picks from, driven over HTTP as the UI does."""
import pytest

CHANNEL = -1007300000001
GROUP = -1007300000002
FORUM = -1007300000003


@pytest.fixture(autouse=True)
def _no_cached_dialogs(monkeypatch):
    from app import tg

    monkeypatch.setattr(tg, "_dialogs_cache", {"ts": 0, "data": []})


@pytest.mark.asyncio
async def test_dialogs_say_which_chats_are_channels_and_which_are_groups(arr_app):
    arr_app.telegram.add_channel(CHANNEL, "Zeta Cinema", username="zetacinema")
    arr_app.telegram.add_group(GROUP, "Amics")
    arr_app.telegram.add_forum(FORUM, "Fòrum")

    r = await arr_app.http.get("/api/telegram/dialogs")

    rows = r.raise_for_status().json()
    assert [(d["chat_id"], d["title"], d["username"], d["kind"]) for d in rows] == [
        (GROUP, "Amics", "", "group"),
        (FORUM, "Fòrum", "", "group"),
        (CHANNEL, "Zeta Cinema", "zetacinema", "channel"),
    ]


@pytest.mark.asyncio
async def test_a_chat_the_account_lost_is_not_offered(arr_app):
    arr_app.telegram.add_channel(CHANNEL, "Zeta Cinema")
    arr_app.telegram.lose_access(CHANNEL)

    r = await arr_app.http.get("/api/telegram/dialogs")

    assert r.raise_for_status().json() == []
