# Telegrarr

[English](README.md) · **Català**

[![CI](https://github.com/OsoThevenin/Telegrarr/actions/workflows/ci.yml/badge.svg)](https://github.com/OsoThevenin/Telegrarr/actions/workflows/ci.yml)
[![Llicència: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Versió](https://img.shields.io/github/v/release/OsoThevenin/Telegrarr)](https://github.com/OsoThevenin/Telegrarr/releases)
![Python 3.13](https://img.shields.io/badge/python-3.13-blue)

**Canals de Telegram com a font tipus usenet per a Sonarr i Radarr, pensat per a
contingut en català.** Telegrarr exposa els canals de Telegram que segueixes com a
**indexador Newznab** (cerca) i com a **client de baixades SABnzbd** (captura), de
manera que un capítol o una pel·lícula en català publicats a Telegram arriben a la
teva biblioteca pel circuit d'importació habitual de Sonarr/Radarr, sense passos
manuals.

Telegrarr és un fork de [Wishaal/Telearr](https://github.com/Wishaal/Telearr) v2.3.3.
Només ha canviat la marca visible: els identificadors interns (variables d'entorn
`TELEARR_*`, la galeta `telearr_sess`, `telearr.db`, els noms dels mòduls) es
mantenen com a l'original perquè les correccions de Telearr es puguin fusionar sense
conflictes. És una aplicació autoallotjada [FastAPI](https://fastapi.tiangolo.com/) +
[Telethon](https://docs.telethon.dev/) (Python 3.13) que es distribueix com un sol
contenidor Docker sense root.

Consulta el [CHANGELOG.md](CHANGELOG.md) per veure tots els canvis respecte de
Telearr v2.3.3.

---

## Com funciona

```
Prowlarr ──sincronitza──► Sonarr / Radarr
   │                         │ cerca (Newznab)       captura (SABnzbd)
   └────────────► Telegrarr :8790 ◄───────────────────────┘
                     │  llegeix els canals assignats i baixa el que s'ha capturat
                     ▼
   /downloads/telegram/<tv|movies>/<nom del llançament>/<fitxer>  ──►  importació a Sonarr/Radarr
```

1. Afegeixes canals de Telegram i n'assignes cadascun a una sèrie (id de TVDB) o el
   marques com a canal de pel·lícules.
2. Telegrarr llegeix les publicacions, n'extreu el número de capítol i la qualitat, i
   publica cada missatge com a llançament, per exemple
   `Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR`.
3. Sonarr/Radarr cerquen a Telegrarr per id de TVDB/TMDB/IMDb, capturen un
   llançament, Telegrarr el baixa a `/downloads` i l'aplicació \*arr l'importa.

## Instal·lació (Docker Compose)

Requisits: Docker + Docker Compose, credencials de l'API de Telegram de
<https://my.telegram.org> i una [clau de l'API de TMDB](https://www.themoviedb.org/settings/api)
gratuïta (cal per assignar canals).

```bash
cp .env.example .env
$EDITOR .env      # TG_API_ID, TG_API_HASH, TELEARR_SECRET_KEY, TELEARR_ADMIN_PASS, PATH_TO_DOWNLOADS
docker compose up -d
```

La imatge es publica a GHCR a cada versió:

```
ghcr.io/osothevenin/telegrarr:latest
ghcr.io/osothevenin/telegrarr:1.0.0
```

El `docker-compose.yml` inclòs construeix la imatge localment (`build: .`); per fer
servir la imatge publicada, treu `build: .` i posa
`image: ghcr.io/osothevenin/telegrarr:1.0.0`.

### Carpeta de baixades

- El contenidor s'executa **sense root, amb UID/GID 1000**. Les carpetes de
  l'amfitrió muntades a `/data` i `/downloads` han de ser escrivibles per l'UID 1000
  (`chown -R 1000:1000 …`), o bé descomenta `user:` al `docker-compose.yml` i posa a
  `PUID`/`PGID` el propietari del teu disc.
- `PATH_TO_DOWNLOADS` (al `.env`) és la carpeta **de l'amfitrió** muntada a
  `/downloads`. Munta la mateixa carpeta a `/downloads` també a Sonarr i Radarr: les
  captures van a `/downloads/telegram/<tv|movies>/<nom del llançament>/<fitxer>`,
  que així és el mateix camí als tres contenidors i no cal cap *Remote Path Mapping*.
- `TELEARR_DOWNLOADS_DIR` és la base de baixades **dins** del contenidor (per defecte
  `/downloads`). També es pot canviar a *Configuració → Baixades*.

### Mode de funcionament

| `operating_mode` | Comportament |
| --- | --- |
| `arr` (per defecte, suportat) | Els escanejos només indexen les publicacions. No es baixa res fins que Sonarr/Radarr ho capturen. |
| `standalone` | Comportament original de Telearr: cada capítol nou es baixa directament a les carpetes de la biblioteca (`TELEARR_TV_DIR`, …) amb actualització opcional de Plex. Es manté, però no té suport. |

Es canvia a *Configuració → Baixades* (interruptor **Mode autònom**).

Obre **http://\<amfitrió\>:8790**, entra amb les credencials d'administrador del
`.env` i prem **Connecta Telegram**: l'assistent et demana el número de telèfon, el
codi d'inici de sessió i (opcionalment) la contrasenya de verificació en dos passos.

## Connexió amb Prowlarr, Sonarr i Radarr

Obre **Connexió** a la barra lateral, introdueix l'URL (tal com s'hi arriba des de
Telegrarr) i la clau d'API de Prowlarr, Sonarr i Radarr, prem **Desa i prova** i
després **Registra Telegrarr**. Això crea:

- a Prowlarr, un indexador Generic Newznab anomenat `Telegrarr` (camí d'API
  `/api/newznab`) que Prowlarr sincronitza amb Sonarr i Radarr;
- a Sonarr i Radarr, un client de baixades SABnzbd anomenat `Telegrarr` (categoria
  `tv` / `movies`).

Es pot tornar a prémer sense problema: les entrades que ja es diuen `Telegrarr` no es
toquen. El camí manual (camp per camp) és a **[docs/CONNECT.md](docs/CONNECT.md)**
(en anglès). La connexió amb Sonarr també serveix per llegir les llistes de capítols
quan es resolen els capítols en dues parts (vegeu més avall).

La clau d'API de Telegrarr és a *Configuració → Integracions*.

## Canals

Afegeix canals des de **Canals → Afegeix un canal**: tria'n un de la llista de xats de
Telegram o enganxa un `@usuari` / enllaç `t.me`. Telegrarr **no s'uneix mai a cap
canal pel seu compte**: uneix-t'hi primer des de l'aplicació de Telegram.

- **Canal de sèrie** (un canal = una sèrie): cerca la sèrie a TMDB (primer títols en
  català, després en anglès) o escriu directament l'id de TVDB. Els ids de TMDB i
  IMDb se'n deriven. Després Sonarr troba els llançaments per id de TVDB.
- **Canal de pel·lícules** (un canal, moltes pel·lícules): el títol i l'any de cada
  publicació es cerquen a TMDB (`ca-ES` i després `en-US`). Els canals de
  pel·lícules necessiten la clau de TMDB. Les pel·lícules sense una coincidència
  segura van a **Revisió**, on tries la pel·lícula correcta o descartes el missatge.
- Cada canal té un **idioma d'àudio** (`cat` per defecte, `es`, `en`, `multi`) i una
  **qualitat de reserva**, que s'usa quan Telegram no informa de la mida del vídeo.

La clau de TMDB va a *Configuració → Integracions → Imatges (TMDB)*.

### Importació des d'un canal directori

Alguns canals només publiquen enllaços a un canal per sèrie. **Canals → Importa un
directori** llegeix aquest canal, llista els canals enllaçats amb una coincidència de
TMDB suggerida i afegeix de cop els que marquis. Límits, per protegir el compte:

- Telegrarr **no s'uneix** a res: els enllaços d'invitació privats a canals dels
  quals no ets membre es mostren, però no es poden importar fins que t'hi uneixis des
  de Telegram.
- Només es llegeixen els **300 missatges més recents** del directori.
- Com a màxim es resolen **60 enllaços per escaneig**; la resta s'indiquen i es
  resolen en un escaneig posterior.
- Un directori es llegeix de Telegram com a màxim un cop cada **15 minuts**; si el
  tornes a escanejar abans, es reutilitza el resultat desat.
- Els canals sense coincidència a TMDB s'importen **sense assignar**; els pots
  assignar després des del diàleg del canal.

## Interpretació de noms en català

Telegrarr llegeix el número de capítol del nom del fitxer o del text del missatge.
Els guions baixos compten com a espais
(`El_Senyor_dels_Anells_1x01_Una_ombra_del_passat.avi`). Els marcadors es reconeixen
a qualsevol lloc del text:

| Forma | Exemple |
| --- | --- |
| `NxNN` | `3x13 Un viatge pel temps` |
| `TnCnn` / `TnnEnn` | `T3C13`, `T03E13` |
| Temporada + Capítol | `Temporada 3 Capítol 13` |
| Capítol / Episodi | `Cap. 13`, `Cap 13`, `C13`, `Episodi 13`, `Ep. 13` |
| Formes angleses | `S03E13`, … |
| Capítols dobles | `1x01-02`, `1x01-1x02` |
| Número sol (últim recurs) | `El Capità Harlock 01 - La bandera pirata de l'espai` |

- Primer compten els marcadors amb temporada i capítol (nom del fitxer i després
  text del missatge), després els que només porten capítol (mateix ordre). Un
  **número sol** només compta al nom del fitxer d'una sèrie, com a últim recurs, i
  mai un any, `720p`, `x264`, `5.1`, `700 MB` o un número dins d'una paraula. Un
  capítol sense temporada es publica com a temporada 1 (`S01E01`); la temporada 0 és
  la d'especials de Sonarr.
- El **títol del capítol** és el text que hi ha després del marcador; als canals
  assignats, el text d'abans s'ignora.
- **`(1a Part)` / `(2a Part)`** es mantenen al títol i es resolen al número de capítol
  real: Telegrarr llegeix la llista de capítols de la temporada a TMDB en català,
  després a TMDB en anglès i després a Sonarr. Si dos capítols consecutius comparteixen
  el títol base, la part N passa a ser el capítol base + N − 1; si no, es manté la
  numeració del canal. La comparació no té en compte els accents i tolera petites
  diferències.
- La **qualitat** surt de les dimensions del vídeo que informa Telegram:
  ≥ 3200×2000 → `2160p`, ≥ 1800×1000 → `1080p`, ≥ 1200×700 → `720p`, més petit →
  `SDTV`. Sense dimensions, s'usa la qualitat de reserva del canal.

## Noms dels llançaments

Els llançaments s'anomenen de manera que els *custom formats* que ja tinguis a
Sonarr/Radarr els puguin puntuar:

```
Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR
Title.2019.CAT.1080p.WEB-DL.x264-TELEGRARR
```

El testimoni d'idioma surt de l'idioma d'àudio del canal: `CAT`, `SPA`, `ENG` o
`MULTI`. El grup del llançament és sempre `TELEGRARR`.

## Seguretat del compte

Telegrarr inicia la sessió amb el teu compte **personal** de Telegram, així que es
comporta com un client d'escriptori tranquil:

| Opció | Per defecte | On |
| --- | --- | --- |
| Connexions paral·leles per fitxer | 4 | *Configuració → Baixades → Rendiment*, `TELEARR_DL_WORKERS` |
| Fitxers simultanis | 2 | *Configuració → Baixades → Rendiment*, `TELEARR_MAX_CONCURRENT` |
| Interval de consulta dels canals | ≥ 15 min, més una variació aleatòria; els valors inferiors es rebutgen | per canal; el valor per defecte a *Rendiment* |
| Límit diari de baixades | 0 GB = il·limitat; quan s'arriba al límit, les baixades s'aturen fins l'endemà | *Rendiment* |
| FloodWait | bloqueig global amb espera exponencial; avís quan una espera supera els 10 min | automàtic |
| Empremta del client | client d'escriptori oficial (`Desktop` / `Windows 10` / `5.12.3 x64`) | `TELEARR_TG_DEVICE_MODEL`, `TELEARR_TG_SYSTEM_VERSION`, `TELEARR_TG_APP_VERSION` |
| Unir-se a canals | mai automàticament | — |

Es manté un únic fitxer de sessió persistent a `/data`.

## Idioma de la interfície

La interfície és **en català per defecte**. Per passar a l'anglès, ves a
*Configuració → Compte → Aparença* (*Settings → Account → Appearance*). L'opció
s'aplica a la interfície, als missatges d'error i a les notificacions.

## Referència de configuració

La configuració de desplegament és al `.env` (vegeu [`.env.example`](.env.example));
moltes opcions es poden canviar en calent a *Configuració*, que té prioritat sobre el
`.env`.

| Variable | Funció | Per defecte |
| --- | --- | --- |
| `TG_API_ID` / `TG_API_HASH` | Credencials de l'API de Telegram | obligatòries |
| `TELEARR_SECRET_KEY` | Clau de signatura de la galeta de sessió | posa-hi un valor aleatori llarg |
| `TELEARR_ADMIN_USER` / `TELEARR_ADMIN_PASS` | Usuari administrador inicial (primera execució) | — |
| `PATH_TO_DOWNLOADS` | Carpeta de l'amfitrió muntada a `/downloads` | `./downloads` |
| `TELEARR_DOWNLOADS_DIR` | Base de baixades dins del contenidor | `/downloads` |
| `TELEARR_MEDIA_ROOT` | Camí de l'amfitrió muntat a `/media` (biblioteques del mode autònom; no s'usa en mode *arr) | `./media` |
| `TELEARR_BIND_ADDR` | Adreça de l'amfitrió on escolta la interfície | `0.0.0.0` |
| `PUID` / `PGID` | Només si actives `user:` al compose | `1000` |
| `TELEARR_DL_WORKERS` / `TELEARR_MAX_CONCURRENT` | Connexions per fitxer / fitxers simultanis | `4` / `2` |
| `TELEARR_MIN_FREE_GB` | No baixa res per sota d'aquest espai lliure | `50` |
| `TELEARR_PROXY` | Fa passar Telegram per un servidor intermediari | — |
| `PLEX_URL` / `PLEX_TOKEN`, `TELEARR_NOTIFY_WEBHOOK` | Integracions opcionals heretades | — |

## Servidor intermediari / VPN

Si les baixades s'encallen en un centre de dades concret de Telegram, és possible que
el teu proveïdor estigui limitant Telegram. Configura un servidor intermediari a
*Configuració → Integracions → Servidor intermediari / VPN* (o `TELEARR_PROXY`):
`socks5://[usuari:contrasenya@]amfitrió:port`, `socks4://amfitrió:port`,
`http://[usuari:contrasenya@]amfitrió:port` o `mtproxy://<secret>@amfitrió:port`.
Només el trànsit de Telegram hi passa; si no funciona, es torna a la connexió directa.

## HTTPS

La instal·lació com a aplicació (service worker) i el copiar al porta-retalls
necessiten `https://` (o `localhost`). Posa Telegrarr darrere d'un servidor
intermediari invers amb TLS (Caddy, Nginx Proxy Manager, Tailscale Serve…).
L'aplicació llegeix `X-Forwarded-Proto` i marca la galeta de sessió com a `Secure`.

## Captures de pantalla

| Tauler | Canals |
| --- | --- |
| ![Tauler](docs/screenshots/dashboard.png) | ![Canals](docs/screenshots/channels.png) |

| Baixades | Configuració |
| --- | --- |
| ![Baixades](docs/screenshots/downloads.png) | ![Configuració](docs/screenshots/settings.png) |

## Seguretat

- Imatge sense root (UID/GID 1000) i `no-new-privileges` al compose.
- Desa els secrets al `.env` (permisos `0600`, mai al repositori).
- La interfície està protegida amb un inici de sessió bcrypt, i les API
  Newznab/SABnzbd amb una clau d'API (tracta-la com una contrasenya). **No exposis
  el port 8790 a Internet**; fes servir un servidor intermediari invers amb TLS i una
  llista d'accés.

Per informar de vulnerabilitats, segueix **[SECURITY.md](SECURITY.md)**.

## Ús legal i responsable

Telegrarr baixa fitxers dels canals de Telegram que *tu* tries a les carpetes que
*tu* controles; no allotja ni distribueix cap contingut. No està afiliat a Telegram,
Sonarr/Radarr/Prowlarr, Plex ni TMDB. Aquest producte fa servir l'API de TMDB, però
TMDB no l'avala ni el certifica. Ets responsable del que baixes. Vegeu
**[docs/LEGAL.md](docs/LEGAL.md)** i [`NOTICE`](NOTICE).

## Contribucions i llicència

Vegeu **[CONTRIBUTING.md](CONTRIBUTING.md)**. Telegrarr, igual que Telearr, es
distribueix sota la **Llicència Pública General de GNU v3.0** ([LICENSE](LICENSE)).
