# Maritime Trading Game — Fastify backend

A small Node.js/Fastify API that talks to the Supabase PostgreSQL database with `pg`.
It exposes player auth plus read/save endpoints for money, owned ports and owned vessels.

## Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Create the local env file and fill it in:

```bash
cp .env.example .env
```

3. Run the schema (`schema.sql` is idempotent, so this is safe to re-run). In the
   Supabase SQL Editor, or:

```bash
psql "$DATABASE_URL" -f schema.sql
```

4. Start the server:

```bash
npm run dev     # node --watch
# or
npm start
```

The API listens on `http://localhost:3001` by default.

## Connecting to Supabase (important)

Use the **connection pooler** host, **not** `db.<project-ref>.supabase.co`:

```
postgresql://postgres.<ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Direct connections (`db.<ref>.supabase.co`) are IPv6-only, so on an IPv4-only
machine `pg` fails with:

```
getaddrinfo ENOTFOUND db.<ref>.supabase.co
```

The pooler is reachable over IPv4. Get the exact URI from
**Supabase Dashboard → Project Settings → Database → Connection string → URI**
(the session pooler on port `5432` is the right one for a long-lived `pg.Pool`).

Remember to URL-encode the password (`@` → `%40`, `*` → `%2A`, `^` → `%5E`, …).

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | – | Supabase Postgres URI (use the pooler host) |
| `SESSION_SECRET` | yes | – | HMAC key that signs session tokens |
| `PORT` | no | `3001` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | no | `http://localhost:3000` | Comma-separated allowed origins |
| `SESSION_TTL_MS` | no | 30 days | Token lifetime |
| `PG_POOL_MAX` | no | `10` | Max pooled connections |
| `PG_CONNECTION_TIMEOUT_MS` | no | `10000` | Connect timeout |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`src/db.js` loads `.env` itself, so every entry point (`npm start`,
`node test_db.js`, `node examples/db-calls.js`) works from any directory.

## Endpoints

`/health` needs no auth. Every `/api/player/...` route needs
`Authorization: Bearer <token>` **and** the token must belong to the `:id` in the
path, so one player cannot read or write another player's state.

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | – | API + database status |
| `POST` | `/api/auth/register` | `{user_name, password}` | Create a player, returns `{token, player}` |
| `POST` | `/api/auth/login` | `{user_name, password}` | Returns `{token, player}` |
| `GET` | `/api/me` | – | Player for the current token |
| `GET` | `/api/player/:id` | – | Player row |
| `GET` | `/api/player/:id/money` | – | `{money}` |
| `POST` | `/api/player/:id/money` | `{money}` or `{delta}` | Set an absolute balance or apply a change |
| `GET` | `/api/player/:id/vessels` | – | `{vessels: [...]}` |
| `PUT` | `/api/player/:id/vessels/:vesselId` | – | Grant a vessel |
| `DELETE` | `/api/player/:id/vessels/:vesselId` | – | Remove a vessel |
| `GET` | `/api/player/:id/ports` | – | `{ports: [...]}` |
| `PUT` | `/api/player/:id/ports/:portId` | – | Grant a port |
| `DELETE` | `/api/player/:id/ports/:portId` | – | Remove a port |

`user_name` is 3–32 characters of letters, numbers, `_`, `.`, `-`.
Passwords are at least 8 characters and are stored as `scrypt` hashes
(`node:crypto`, no extra dependency). `password_hash` is never returned by the API.

### Example

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "content-type: application/json" \
  -d '{"user_name":"nashou","password":"hunter2hunter2"}'
```

```bash
TOKEN=...   # token from the response above
curl http://localhost:3001/api/player/<id>/money -H "authorization: Bearer $TOKEN"
curl -X POST http://localhost:3001/api/player/<id>/money \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"delta":-1000}'
```

## Catalog id mapping

`vessel` and `port` rows only hold an id, and those columns are `uuid` in the DB
while the game catalogs (`src/assets/ports.json`, `vessels.json`) use integer ids.
The frontend converts a catalog id to a stable uuid so no schema change is needed:

```
id 1  ->  00000000-0000-4000-8000-000000000001
```

Keeping the low 12 hex digits the catalog id means the mapping is reversible.

## Other scripts

```bash
node test_db.js              # connectivity + list public tables
node examples/db-calls.js    # reusable player helpers (creates then deletes a row)
```

## Security notes

- `.env` is gitignored (`.env.example` is the committable template).
- Never commit real credentials. For a server, set the variables in the host's
  environment / secret manager rather than shipping a `.env` file.
- Set `CORS_ORIGIN` to the deployed frontend origin, not `localhost`.
- `SUPABASE_SECRET_KEY` in your local `.env` is **not** used by this API. It is a
  service-level key — do not expose it to the browser.
