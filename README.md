# SmartLift API server

A small Express + PostgreSQL backend for the SmartLift app. The mobile app talks
HTTP to this server; this server talks to the Aiven PostgreSQL database.

## Why this exists

A React Native / Expo app **cannot connect to PostgreSQL directly**:

- React Native has no raw TCP sockets, so the `pg` driver cannot run in the app.
- Shipping DB credentials inside a mobile app would expose the whole database.
- Free-tier databases allow only a few connections — one per app instance would
  exhaust them instantly.

So the app → **this server** → PostgreSQL.

## Setup

1. **Install dependencies**

   ```bash
   cd server
   npm install
   ```

2. **Create the `.env` file**

   Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env       # macOS/Linux
   copy .env.example .env     # Windows
   ```

   Then set `DATABASE_URL` to your **Neon connection string**
   (console.neon.tech → your project → "Connection string" on the dashboard).
   Leave `PG_SSL` empty. `JWT_SECRET` can be any long random string — generate
   one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   `.env` is gitignored — it never gets committed. Neon uses publicly-trusted
   TLS certificates, so no certificate file is needed.

3. **Start the server**

   ```bash
   npm start
   ```

   On first start it connects to the database and creates all tables
   automatically. You should see `SmartLift API listening on http://localhost:4000`.

4. **Verify it works**

   Open <http://localhost:4000/api/health> in a browser — it should return
   `{ "ok": true, "db": "connected" }`.

## API overview

All routes are prefixed with `/api`. Every route except `/auth/*` and `/health`
requires an `Authorization: Bearer <token>` header.

| Method | Path                        | Purpose                          |
|--------|-----------------------------|----------------------------------|
| GET    | `/health`                   | Connectivity check               |
| POST   | `/auth/register`            | Create account → `{ token, user }` |
| POST   | `/auth/login`               | Log in → `{ token, user }`       |
| GET    | `/auth/me`                  | Current user from token          |
| GET/PUT| `/profile`                  | Read / update the user profile   |
| CRUD   | `/workouts`                 | Workout templates                |
| PATCH  | `/workouts/:id/exercise`    | AI tool: edit one exercise       |
| CRUD   | `/logs`                     | Completed workout sessions       |
| CRUD   | `/meals`                    | Logged meals                     |
| GET/POST/DELETE | `/chat`            | Chat history                     |
| GET    | `/analytics/1rm`            | Estimated 1-rep-max per exercise |
| GET    | `/analytics/weekly`         | Last-7-days aggregates           |
| GET/POST | `/summaries`              | Weekly AI summary snapshots      |

## Notes

- Passwords are stored as bcrypt hashes; sessions use JWTs valid for 30 days.
- `workouts.exercises` and `workout_logs.exercises` are stored as `jsonb`, which
  keeps the shape identical to what the app sends. The analytics queries unnest
  that JSON with `jsonb_array_elements`.
