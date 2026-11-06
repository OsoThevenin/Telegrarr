# Directory import

Telegrarr does not import channels in bulk from a "directory" channel or group,
and does not follow the links a directory posts to find them.

The feature (scan a directory, list the channels it links to with a TMDB
suggestion, import the ticked ones as series channels) shipped in v1.1.0 and was
removed in #103.

## Why this is out of scope

The feature assumed a directory is a channel whose messages link to many
**separate** per-series channels. The real directories operators use are not
built that way. The one that prompted #57 is a forum group whose A–Z index
topics link to **posts inside the same group**:

```
https://t.me/c/2623426951/11/24270   (series index → a post in topic 11)
https://t.me/c/2623426951/13/20562   (movie index → a post in topic 13)
```

Every such link names the directory itself, so a scan of hundreds of index
entries yields zero channels. Making it work would mean following each post
link and reading what it contains, which costs one Telegram read per index
entry (hundreds per directory). That is an account-safety cost for little gain:

- When the files live in the group itself, adding the group, or one of its
  topics, as a channel already covers it. No import step is needed.
- When a post points on to another channel, many index entries lead to the
  same few large channels (e.g. one "Pel·lícules HD" channel for the movies),
  which are quicker to add by hand.

The operator agreed the feature has no real use, and dropping it also removes a
screen from the React UI port (#51).

## Prior requests

- #57: "Directory import finds 0 links"
