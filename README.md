# BitChord Qobuz Add‑on
Deploy free on Cloudflare Workers. Uses public Qobuz catalog search + FLAC stream endpoint.

## Deploy
1. `cd /opt/data/bitchord-addon`
2. `wrangler login`
3. `wrangler secret put QOBUZ_APP_ID`
4. `wrangler secret put QOBUZ_APP_SECRET`
5. optional: `wrangler secret put QOBUZ_USER_TOKEN` for higher-quality sources
6. `wrangler deploy`

Then add `https://<worker>.workers.dev` in BitChord addons.
