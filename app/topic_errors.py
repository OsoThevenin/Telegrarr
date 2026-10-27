"""Why a topic source can't be read: its topic was deleted, or the account lost
access to its forum group. Turned into keyed event-log messages (#29)."""
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

TOPIC_GONE = "event.topic_gone"
TOPIC_INACCESSIBLE = "event.topic_inaccessible"


def unreadable_topic(channel, error: Exception) -> dict | None:
    """The keyed message explaining why ``channel``'s topic can't be read, or
    None when ``channel`` isn't a topic source or ``error`` is something else."""
    if channel["topic_id"] is None:
        return None
    source = {"channel": channel["title"], "topic": channel["topic_title"] or f"#{channel['topic_id']}"}
    if isinstance(error, TOPIC_GONE_ERRORS):
        return message(TOPIC_GONE, **source)
    if isinstance(error, NO_ACCESS_ERRORS):
        return message(TOPIC_INACCESSIBLE, **source)
    return None
