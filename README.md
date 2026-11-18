# nova-helpers

Helper microservices for [Nova-KIT](https://github.com/novastardev/Nova-KIT) (WhatsApp bot).
Each port runs as an independent Express app so one crash can't take the rest down.

| Port | Service   | Endpoints |
|------|-----------|-----------|
| 9045 | utilities | `/weather?loc=`, `POST /translate {text,to,from}`, `POST /qr {data}`, `POST /tts {text,lang}`, `/define?word=`, `POST /lyrics {artist,track}`, `/quote`, `/bible?ref=` |
| 9042 | YouTube   | `/search?q=&limit=`, `POST /download {url, want:"video"\|"audio"}` |
| 9043 | social    | `POST /tiktok {url,want}`, `POST /instagram {url,want}` |

## Run
```bash
npm install
node server.js            # or: systemctl enable --now nova-helpers
```

Downloads land in `/home/nova/downloads` (60MB cap — WhatsApp-friendly).

## YouTube note
Direct video downloads from datacenter IPs get YouTube's "confirm you're not a bot" block
(search is unaffected). To unlock downloads, drop a Netscape cookie file at
`/home/nova/yt-cookies.txt` — the service picks it up automatically.
