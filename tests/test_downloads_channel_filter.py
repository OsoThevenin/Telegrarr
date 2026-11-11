"""GET /api/downloads narrows to the channels a show reads from, so the
channel sheet fetches only that show's downloads rather than every channel's."""
import pytest

FIRST, SECOND, OTHER = 101, 102, 103


def _seed(rows: list[tuple[int, int, str]]) -> None:
    from app import db
    with db.conn() as c:
        for channel_id, message_id, status in rows:
            c.execute(
                "INSERT INTO downloads (channel_id,message_id,file_name,status,created_at)"
                " VALUES (?,?,?,?,1)",
                (channel_id, message_id, f"{channel_id}-{message_id}.mkv", status),
            )


async def _channels_of(arr_app, params) -> list[int]:
    response = (await arr_app.http.get("/api/downloads", params=params)).raise_for_status()
    return sorted(row["channel_id"] for row in response.json())


@pytest.mark.asyncio
async def test_one_channel_id_lists_only_that_channels_downloads(arr_app):
    _seed([(FIRST, 1, "completed"), (OTHER, 2, "completed")])

    assert await _channels_of(arr_app, {"channel_id": FIRST}) == [FIRST]


@pytest.mark.asyncio
async def test_repeated_channel_ids_list_every_named_channel(arr_app):
    _seed([(FIRST, 1, "completed"), (SECOND, 2, "completed"), (OTHER, 3, "completed")])

    assert await _channels_of(arr_app, [("channel_id", FIRST), ("channel_id", SECOND)]) == [FIRST, SECOND]


@pytest.mark.asyncio
async def test_the_channel_filter_combines_with_the_status_filter(arr_app):
    _seed([(FIRST, 1, "completed"), (FIRST, 2, "failed"), (OTHER, 3, "completed")])

    params = [("channel_id", FIRST), ("status", "completed")]
    assert await _channels_of(arr_app, params) == [FIRST]


@pytest.mark.asyncio
async def test_without_a_channel_id_every_channel_is_listed(arr_app):
    _seed([(FIRST, 1, "completed"), (OTHER, 2, "completed")])

    assert await _channels_of(arr_app, {}) == [FIRST, OTHER]


@pytest.mark.asyncio
async def test_a_channel_id_that_is_not_a_number_is_refused(arr_app):
    response = await arr_app.http.get("/api/downloads", params={"channel_id": "abc"})

    assert response.status_code == 422
