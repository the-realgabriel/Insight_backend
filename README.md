# Supabase Clone

A Supabase-inspired backend built from scratch with:
- **Fastify** — REST API
- **PostgreSQL** — primary database
- **JWT** — access + refresh token auth
- **WebSockets + LISTEN/NOTIFY** — realtime change events

---

## Quick Start

```bash
# 1. Copy env file
cp .env.example .env
# Edit .env with your secrets

# 2. Start everything
docker compose up --build

# API: http://localhost:3000
# WS:  ws://localhost:3000/realtime/v1/websocket
```

---

## Auth API

### Sign Up
```http
POST /auth/signup
Content-Type: application/json

{ "email": "user@example.com", "password": "securepassword" }
```
Returns: `access_token`, `refresh_token`, `user`

### Sign In
```http
POST /auth/signin
Content-Type: application/json

{ "email": "user@example.com", "password": "securepassword" }
```

### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{ "refresh_token": "<your_refresh_token>" }
```

### Sign Out
```http
POST /auth/signout
Authorization: Bearer <access_token>

{ "refresh_token": "<your_refresh_token>" }
```

### Get Current User
```http
GET /auth/me
Authorization: Bearer <access_token>
```

---

## REST API

All endpoints require `Authorization: Bearer <access_token>`.

### Query rows
```http
GET /rest/v1/user_profiles

# Filtering
GET /rest/v1/user_profiles?username=eq.john

# Select specific columns
GET /rest/v1/user_profiles?select=id,username

# Sorting + pagination
GET /rest/v1/user_profiles?order=created_at.desc&limit=20&offset=0

# Supported filter operators: eq, neq, gt, gte, lt, lte, like, ilike
```

### Insert row
```http
POST /rest/v1/user_profiles
Content-Type: application/json

{ "username": "john_doe", "avatar_url": "https://..." }
```

### Update row
```http
PATCH /rest/v1/user_profiles/:id
Content-Type: application/json

{ "username": "new_name" }
```

### Delete row
```http
DELETE /rest/v1/user_profiles/:id
```

---

## Realtime

Connect via WebSocket to `ws://localhost:3000/realtime/v1/websocket`.

**Protocol:**

```js
// 1. Connect — server sends:
{ "type": "connected", "message": "Send auth message" }

// 2. Authenticate
{ "type": "auth", "token": "<your_access_token>" }

// Server responds:
{ "type": "auth_ok", "user": { "id": "...", "email": "..." } }

// 3. Subscribe to a table
{ "type": "subscribe", "table": "user_profiles" }

// Server responds:
{ "type": "subscribed", "table": "user_profiles" }

// 4. Receive changes in real time:
{
  "type": "INSERT" | "UPDATE" | "DELETE",
  "table": "user_profiles",
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00Z"
}

// 5. Unsubscribe
{ "type": "unsubscribe", "table": "user_profiles" }
```

---

## Adding New Tables

1. Add your table in `src/db/init.js`
2. Add the table name to `ALLOWED_TABLES` in `src/services/rest.service.js`
3. Add a notify trigger (copy the pattern from `notify_user_profiles`)
4. Restart the server

---

## Row-Level Security

- Tables with a `user_id` column automatically enforce ownership: users can only read/write their own rows
- Users with `role = 'admin'` bypass all RLS restrictions
- Change a user's role manually in the DB: `UPDATE auth_users SET role = 'admin' WHERE email = '...'`

---

## Project Structure

```
src/
  db/
    pool.js       — PostgreSQL connection pool
    init.js       — DB init, tables, triggers
  middleware/
    auth.js       — JWT authentication middleware
  services/
    auth.service.js  — signup, signin, token management
    rest.service.js  — generic CRUD with RLS
  routes/
    auth.routes.js   — /auth/* endpoints
    rest.routes.js   — /rest/v1/* endpoints
  realtime/
    server.js        — WebSocket + Postgres LISTEN/NOTIFY
  server.js       — Fastify app entry point
```
