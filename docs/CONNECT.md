# Connecting Telegrarr to Prowlarr, Sonarr and Radarr

Telegrarr is a **Newznab indexer** (search) and a **SABnzbd download client** (grab) for
the \*arr apps. Prowlarr gets the indexer and syncs it to Sonarr and Radarr; Sonarr and
Radarr each get the download client.

You can register everything from the **Connect** page in one click, or by hand.

## What you need

- **Telegrarr URL**: the address the \*arr apps use to reach Telegrarr, for example
  `http://telegrarr:8790` when they share a Docker network. This is not necessarily the
  address you open in your browser.
- **Telegrarr API key**: *Settings → Integrations → Sonarr / Radarr / Prowlarr*. One key
  authenticates both the indexer and the download client.
- The URL and API key of each \*arr app (*Settings → General → API Key* in each app).

## One click: the Connect page

1. Open **Connect** in the sidebar.
2. For Prowlarr, Sonarr and Radarr, enter the URL as reachable **from Telegrarr** and the
   API key, then press **Save & test**. A working connection shows the app version.
   Saved keys are never shown again; type a new one to replace it.
3. Check the **Telegrarr URL** and press **Register Telegrarr**.

Registration creates, in every app that is saved:

| App | What is created | Name |
| --- | --- | --- |
| Prowlarr | Generic Newznab indexer: URL = Telegrarr URL, API path `/api/newznab`, Telegrarr API key | `Telegrarr` |
| Sonarr | SABnzbd download client: host/port/SSL/URL base from the Telegrarr URL, Telegrarr API key, category `tv` | `Telegrarr` |
| Radarr | SABnzbd download client: same, category `movies` | `Telegrarr` |

It is safe to press again. Anything already named `Telegrarr` (any case) is left as is
and reported as "already registered". To change an existing entry, edit or delete it in
the \*arr app and register again. Each app tests the new entry when it is saved, so a
failure there (for example, the app cannot reach the Telegrarr URL) is shown next to that
app and nothing is created in it.

## By hand

### Prowlarr: Newznab indexer

*Settings → Indexers → Add Indexer → Generic Newznab*

| Field | Value |
| --- | --- |
| Name | `Telegrarr` |
| URL | the Telegrarr URL, e.g. `http://telegrarr:8790` |
| API Path | `/api/newznab` |
| API Key | the Telegrarr API key |
| Sync Profile | Standard |

Press **Test**, then **Save**. Prowlarr reads the categories from Telegrarr (`5000` TV,
`2000` Movies) and syncs the indexer to Sonarr and Radarr.

Without Prowlarr, add it straight to Sonarr/Radarr (*Settings → Indexers → Add → Newznab*)
with the same URL, API path and key; categories `5000` for Sonarr, `2000` for Radarr.

### Sonarr and Radarr: SABnzbd download client

*Settings → Download Clients → Add → SABnzbd*

| Field | Value |
| --- | --- |
| Name | `Telegrarr` |
| Host | host of the Telegrarr URL, e.g. `telegrarr` |
| Port | `8790` (or the port in the Telegrarr URL) |
| Use SSL | only if the Telegrarr URL is `https://` |
| URL Base | empty, unless Telegrarr is served under a sub-path (e.g. `/telegrarr`) |
| API Key | the Telegrarr API key |
| Category | `tv` in Sonarr, `movies` in Radarr |

Press **Test**, then **Save**.

## Sonarr episode lists

The Sonarr URL and key saved on the Connect page are also used to read a series' episode
list (by TVDB id and season) when Telegrarr resolves episode numbers.
