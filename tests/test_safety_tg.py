"""Telegram client account safety: desktop fingerprint, one session file, no automatic joins."""
from types import SimpleNamespace

import pytest

pytest.importorskip("telethon")

from telethon.tl import types  # noqa: E402
from telethon.tl.functions.channels import JoinChannelRequest  # noqa: E402
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest  # noqa: E402

from app import config, tg  # noqa: E402


class RecordingTelegramClient:
    built = []

    def __init__(self, session, api_id, api_hash, **kwargs):
        self.session, self.kwargs = session, kwargs
        RecordingTelegramClient.built.append(self)

    def is_connected(self):
        return False


@pytest.fixture()
def recorder(fresh_db, monkeypatch):
    RecordingTelegramClient.built = []
    monkeypatch.setattr(tg, "TelegramClient", RecordingTelegramClient)
    monkeypatch.setattr(tg, "_client", None)
    return RecordingTelegramClient


def test_client_presents_desktop_fingerprint(recorder):
    tg.get_client()
    kw = recorder.built[0].kwargs
    assert kw["device_model"] == config.TG_DEVICE_MODEL
    assert kw["system_version"] == config.TG_SYSTEM_VERSION
    assert kw["app_version"] == config.TG_APP_VERSION
    assert "Desktop" in config.TG_DEVICE_MODEL or "PC" in config.TG_DEVICE_MODEL
    assert config.TG_SYSTEM_VERSION.startswith("Windows")


@pytest.mark.asyncio
async def test_single_session_file_reused_across_restarts(recorder):
    tg.get_client()
    assert tg.get_client() is recorder.built[0]       # one client per process
    await tg.reset_client()                           # e.g. proxy change / restart
    tg.get_client()
    assert [c.session for c in recorder.built] == [config.SESSION_PATH, config.SESSION_PATH]


class FakeAuthedClient:
    def __init__(self, entity=None, invite=None):
        self.entity, self.invite, self.requests = entity, invite, []

    def is_connected(self):
        return True

    async def is_user_authorized(self):
        return True

    async def get_entity(self, _query):
        return self.entity

    async def __call__(self, request):
        self.requests.append(request)
        if isinstance(request, CheckChatInviteRequest):
            return self.invite
        raise AssertionError(f"unexpected request {type(request).__name__}")


def _channel():
    return types.Channel(id=123, title="Public Show", photo=types.ChatPhotoEmpty(), date=None,
                         broadcast=True, access_hash=1, username="publicshow")


@pytest.mark.asyncio
async def test_resolving_a_public_channel_never_joins(monkeypatch):
    fake = FakeAuthedClient(entity=_channel())
    monkeypatch.setattr(tg, "_client", fake)
    res = await tg.resolve("@publicshow")
    assert res["chat_id"] == -1000000000123
    assert not any(isinstance(r, JoinChannelRequest) for r in fake.requests)


@pytest.mark.asyncio
async def test_invite_link_for_member_resolves_without_importing(monkeypatch):
    fake = FakeAuthedClient(invite=types.ChatInviteAlready(chat=_channel()))
    monkeypatch.setattr(tg, "_client", fake)
    res = await tg.resolve("https://t.me/+AbCdEfGhIjKlMn")
    assert res["chat_id"] == -1000000000123
    assert not any(isinstance(r, ImportChatInviteRequest) for r in fake.requests)


@pytest.mark.asyncio
async def test_invite_link_for_non_member_asks_user_to_join(monkeypatch):
    fake = FakeAuthedClient(invite=SimpleNamespace(title="Private"))   # a ChatInvite: not a member
    monkeypatch.setattr(tg, "_client", fake)
    res = await tg.resolve("https://t.me/+AbCdEfGhIjKlMn")
    assert res["error"]["key"] == "err.tg.not_a_member"
    assert not any(isinstance(r, ImportChatInviteRequest) for r in fake.requests)
