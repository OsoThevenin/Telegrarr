# Telegrarr

Telegrarr exposes Telegram channels to Sonarr and Radarr as a usenet-style source, so Catalan
episodes and films posted on Telegram reach the media library through the *arr import pipeline.

## Sources

**Channel**:
A Telegram chat, or one topic of a forum group, that Telegrarr reads media from. Each has a kind
(series or movie).
_Avoid_: Source (in UI copy), feed, group

**Movie channel**:
A channel where each media message is a separate film.
_Avoid_: Film group, movie group

**Release**:
One media message in a channel, named and offered to Sonarr or Radarr as something they can grab.
_Avoid_: Post, item, file

**Catalog**:
The films a movie channel offers, one entry per film, whether or not they have been downloaded yet.
_Avoid_: Available list, links, index

## Getting films

**Download** (user action):
Asking Radarr for a catalog film: Radarr adds it to its monitored list and searches for it, then
grabs the release from Telegrarr on its own, so the file arrives after a short delay.
_Avoid_: Request, grab (for this action)

**Grab**:
Sonarr or Radarr choosing a release and handing it to Telegrarr, which starts the file transfer.
_Avoid_: Download (for this step)

**Requested**:
A catalog film whose Download was pressed but whose file has not yet arrived in Radarr.
_Avoid_: Pending, queued

**Quality upgrade** (_Millora qualitat_):
A catalog film Radarr already has, at a lower quality than the best release the channel offers.
_Avoid_: Better version, re-download
