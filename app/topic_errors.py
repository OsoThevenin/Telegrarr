"""Why a topic source can't be read: its topic was deleted, or the account lost
access to its forum group. Turned into keyed event-log messages (#29) and keyed
directory-scan errors (#28)."""
from telethon.errors import (ChannelBannedError, ChannelInvalidError, ChannelPrivateError,
                             ChatForbiddenError, MsgIdInvalidError, TopicDeletedError,
                             UserBannedInChannelError)

from .i18n import message

# Reading a deleted topic (``reply_to=<topic id>``): Telegram answers
# MSG_ID_INVALID, as the topic's top message is gone, or TOPIC_DELETED.
TOPIC_GONE_ERRORS = (MsgIdInvalidError, TopicDeletedError)
# The account left, was removed or banned from the group, or the group is gone.
NO_ACCESS_ERRORS = (ChannelPrivateError, ChannelInvalidError, ChatForbiddenError,
                    ChannelBannedError, UserBannedInChannelError)

GONE, INACCESSIBLE = "gone", "inaccessible"
EVENT_KEYS = {GONE: "event.topic_gone", INACCESSIBLE: "event.topic_inaccessible"}


def why_unreadable(error: Exception) -> str | None:
    """GONE or INACCESSIBLE when `error` came from reading a forum topic that was
    deleted or whose group the account can't read any more; None otherwise."""
    if isinstance(error, TOPIC_GONE_ERRORS):
        return GONE
    if isinstance(error, NO_ACCESS_ERRORS):
        return INACCESSIBLE
    return None


def source_label(channel) -> str:
    """How event messages name a source: "Group › Topic" for a topic source
    (its id when the topic has no title), the chat title otherwise."""
    if channel["topic_id"] is None:
        return channel["title"]
    return f"{channel['title']} › {channel['topic_title'] or '#' + str(channel['topic_id'])}"


def unreadable_topic(channel, error: Exception) -> dict | None:
    """The keyed message explaining why ``channel``'s topic can't be read, or
    None when ``channel`` isn't a topic source or ``error`` is something else."""
    reason = why_unreadable(error) if channel["topic_id"] is not None else None
    return message(EVENT_KEYS[reason], source=source_label(channel)) if reason else None
