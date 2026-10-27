# Legal & Responsible Use

> **This document is not legal advice.** It is a plain-language risk map written
> by the maintainers to keep the project honest and to help users make informed
> decisions. For anything that actually matters to you, consult a qualified
> lawyer in your jurisdiction. Laws differ by country and change over time.

Telegrarr is a **self-hosted, general-purpose tool**: it signs into *your own*
Telegram account and downloads files from channels *you* choose into folders
*you* control, and it can present those to your own Sonarr/Radarr/Plex stack.
It does **not** host, index, seed, or distribute any content, and the project
ships **no copyrighted media** of any kind.

Below are the four areas people ask about, roughly in order of how much they
actually matter.

---

## 1. Copyright of the content you download (the one that matters most)

A logo change does nothing here — this is the real consideration.

- **The tool is neutral; the use may not be.** Like a web browser, `curl`, or
  `youtube-dl`, Telegrarr can be used lawfully (your own files, public-domain or
  Creative-Commons media, content you're licensed to access) or unlawfully
  (downloading copyrighted films/TV you have no right to). The legality lives in
  *what you point it at*, not in the software.
- **Downloading copyrighted works without authorization is illegal in most
  jurisdictions** and can carry civil (and sometimes criminal) liability. Making
  them available to others (re-uploading, sharing the library, opening it to the
  public) is generally treated far more seriously than private downloading.
- **Contributory/inducement risk for the project.** Software that is *marketed
  for* infringement can lose the "neutral tool" protection (this is why some
  projects have faced takedowns). To stay on the right side of that line, the
  project:
  - is described as a **Telegram downloader / \*arr bridge**, not as a piracy
    tool, and its docs never point users at infringing sources;
  - ships **no channel lists, no pre-configured sources, and no content**;
  - carries the disclaimers in this file and the README.
- **What you should do:** only download what you have the right to; don't
  redistribute; keep your instance private (Telegrarr binds to localhost by
  default and is behind login); and don't publicly advertise or share instances
  configured for piracy.

**Bottom line:** the project is a legitimate, general-purpose tool. Whether *your
usage* is legal depends entirely on the material you download and how you use it.
That responsibility is yours, not the software's.

---

## 2. Trademark & branding

- **Name.** "Telegrarr" (a fork of [Telearr](https://github.com/Wishaal/Telearr)) references "Telegram" (`Tele-`) and follows the community
  "`-arr`" naming convention (Sonarr, Radarr, Prowlarr, …). The `-arr` convention
  is widely used by community projects; the `Tele-` prefix is descriptive of what
  the tool talks to.
- **Not affiliated.** Telegrarr is an **independent project**. It is **not
  affiliated with, endorsed by, or sponsored by** Telegram, the Sonarr/Radarr
  teams, Plex, or The Movie Database (TMDB). This is stated in the README and in
  the app.
- **Logo.** The app logo is an **original mark** (a download arrow into a tray).
  It deliberately does **not** use Telegram's paper-plane, Telegram's colours as
  a badge, or any element of the Sonarr/Radarr/Plex marks, to avoid any
  implication of affiliation.
- **If you fork or rebrand:** avoid using another company's registered marks,
  logos, or a confusingly similar name in a way that suggests endorsement. A
  purely descriptive reference ("works with Telegram") is normal; imitating a
  brand's identity is not.

---

## 3. Telegram Terms of Service (operational, not usually a legal-liability issue)

- Telegrarr automates a **regular user account** (via the MTProto client Telethon),
  sometimes called a "userbot." Automating a user account and bulk-downloading
  can run against **Telegram's Terms of Service** and may lead to **rate limits
  (FloodWait) or account restrictions/bans** — this is an operational risk to
  *your account*, not typically a legal one.
- Mitigations already in the app: conservative worker defaults, flood-wait
  handling, and per-channel polling intervals. Use sane settings and don't hammer
  Telegram.

---

## 4. Licensing & attribution

- **Telegrarr is licensed under GPL-3.0** (see [`LICENSE`](../LICENSE)), matching
  the \*arr ecosystem.
- **Dependencies** are all under permissive licenses compatible with GPL-3.0
  (MIT / BSD / Apache-2.0). See [`NOTICE`](../NOTICE) for the per-component list.
- **Design & assets:**
  - UI icons follow the **Lucide (ISC)** / **Feather (MIT)** open icon sets.
  - The design tokens (colour roles, radii, type scale) were adapted from the
    **Open Design** project's reference design systems (**Apache-2.0**).
  - No proprietary fonts are bundled — the CSS references system fonts (e.g. SF
    Pro on Apple devices) with open fallbacks (Inter/Helvetica). Nothing is
    redistributed.
- **Third-party data:**
  - Poster/backdrop art can be fetched from **The Movie Database (TMDB)**.
    Telegrarr **uses the TMDB API but is not endorsed or certified by TMDB.** A
    TMDB API key is optional and supplied by you under TMDB's own terms.
  - A keyless fallback uses IMDb's public suggestion endpoint, which is
    undocumented/unofficial; treat it as best-effort and subject to change.

---

## Summary checklist for running Telegrarr responsibly

- [ ] Only download content you have the legal right to.
- [ ] Don't redistribute downloaded content or open your instance to the public.
- [ ] Keep the instance private (localhost bind + login; put it behind a VPN/
      reverse proxy with auth if remote).
- [ ] Don't promote or configure the tool specifically for piracy.
- [ ] Respect Telegram's ToS and use conservative download settings.
- [ ] If you fork/rebrand, keep the "not affiliated" disclaimers and avoid
      others' trademarks.

*Again: not legal advice. When in doubt, talk to a lawyer.*
