# app/notify.py — completion notifications: generic webhook and/or Telegram Saved Messages.
import logging
import httpx
from . import settings

log = logging.getLogger("notify")


async def _webhook(text):
    hook = settings.get("notify_webhook", "")
    if not hook:
        return None
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(hook, json={"content": text, "text": text}, timeout=10)
        return r.status_code < 400
    except Exception as e:
        log.warning("webhook notify failed: %s", e)
        return False


async def _telegram(text, poster=""):
    if not settings.get_bool("notify_telegram", False):
        return None
    try:
        from . import tg
        c = tg.get_client()
        if not c.is_connected():
            await c.connect()
        if poster:                              # send the poster as a photo with the text as caption
            try:
                import io
                async with httpx.AsyncClient() as hc:
                    resp = await hc.get(poster, timeout=15)
                if resp.status_code < 400 and resp.content:
                    bio = io.BytesIO(resp.content)
                    bio.name = "poster.jpg"
                    await c.send_file("me", bio, caption=text)
                    return True
            except Exception as e:
                log.warning("telegram poster send failed (%s); falling back to text", e)
        await c.send_message("me", text)        # "me" = the account's Saved Messages
        return True
    except Exception as e:
        log.warning("telegram notify failed: %s", e)
        return False


def _plex_link(show):
    if not show:
        return ""
    import urllib.parse
    return "https://app.plex.tv/desktop/#!/search?query=" + urllib.parse.quote(show)


async def send(title, detail="", imdb_id=None, show=None):
    link = _plex_link(show)
    text = f"📥 {title}" + (f"\n{detail}" if detail else "") + (f"\n▶ Open in Plex: {link}" if link else "")
    poster = ""
    if imdb_id:
        try:
            from . import tmdb
            poster = (await tmdb.art(imdb_id, show or "")).get("poster", "")
        except Exception:
            poster = ""
    await _webhook(text)
    await _telegram(text, poster)


async def test():
    # build a representative rich test (poster + Plex link) from the first mapped channel
    imdb = show = None
    try:
        from . import db
        with db.conn() as c:
            r = c.execute("SELECT imdb_id, imdb_title, title FROM channels "
                          "WHERE imdb_id IS NOT NULL AND imdb_id <> '' LIMIT 1").fetchone()
        if r:
            imdb, show = r["imdb_id"], (r["imdb_title"] or r["title"])
    except Exception:
        pass
    poster = ""
    if imdb:
        try:
            from . import tmdb
            poster = (await tmdb.art(imdb, show or "")).get("poster", "")
        except Exception:
            poster = ""
    link = _plex_link(show)
    text = "✅ Telegrarr test notification" + (f"\n▶ Open in Plex: {link}" if link else "")
    results, ok = [], True
    w = await _webhook(text)
    if w is not None:
        results.append("Webhook " + ("✓" if w else "✗"))
        ok = ok and w
    t = await _telegram(text, poster)
    if t is not None:
        results.append("Telegram Saved Messages " + ("✓" if t else "✗"))
        ok = ok and t
    if not results:
        return {"ok": True, "detail": "No notification channels enabled — turn on a webhook or Telegram below."}
    return {"ok": ok, "detail": " · ".join(results)}
