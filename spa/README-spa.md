# SPA bonus — Classifieds

> This SPA is **optional / bonus** (TP Step 7). It replaces the TP1 `curl`
> calls with a small interface that consumes the TP1 API **with a Keycloak JWT**.

## Stack

One HTML page + 4 JS scripts (`config.js`, `auth.js`, `api.js`, `ui.js`).
No framework. No dependency to install (everything runs with vanilla JS +
`fetch`).

For auth we use the **official Keycloak client**
[`keycloak-js`](https://github.com/keycloak/keycloak-js), served directly by
the `keycloak/keycloak:26.8` image:
`http://localhost:8081/js/keycloak.js`. No `npm`, no `node_modules`.

## Run

The SPA is served by **any static HTML server** that exposes the files
(e.g. `python3 -m http.server 3000`) from the folder containing `index.html`.

Option A (simplest):

```bash
# in the `spa/` folder
python3 -m http.server 3000
# open http://localhost:3000
```

Option B (nginx or caddy), if you know them:

```dockerfile
FROM nginx:alpine AS spa
COPY index.html /usr/share/nginx/html/
COPY js /usr/share/nginx/html/js
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

## Config (js/config.js)

| key | expected value |
|---|---|
| `KEYCLOAK_URL` | `http://localhost:8081` |
| `REALM` | `listings` |
| `CLIENT` | `listings-spa` (the **public** client defined in `realm.json`) |
| `API` | `http://localhost:8080` (TP1 published on port 8080 via docker) |

> NB: the API stays on `http://localhost:8080` for every TP (Keycloak moved to
> `8081`, so it never collides) — see `js/config.js`.

## Flow

1. `ui.js` checks `kc.authenticated`. If not → `auth.js` calls `kc.login()`.
2. Keycloak redirects to the login page of the `listings` realm.
3. The user types `alice`/`secret` (or `bob`/`secret`).
4. Keycloak redirects to `http://localhost:3000/auth/callback` with a `code`.
5. `auth.js` exchanges `code` → `access_token` via the Keycloak token endpoint
   (PKCE S256).
6. `ui.js` calls `GET /listings` with `Authorization: Bearer <jwt>`.
7. Automatic refresh: if the token is about to expire, `auth.js` calls
   `kc.updateToken(30)` before the request.

## What the SPA does NOT do

- No `refresh_token` handling in the UI (Keycloak handles it).
- No `localStorage` for the password (Keycloak handles the login).
- No CORS of its own (the server must declare it if it runs on another port).

## If it does not work

1. Check that `docker compose ps` is healthy.
2. Open `http://localhost:8081/realms/listings/protocol/openid-connect/authorize?client_id=listings-spa&redirect_uri=http://localhost:3000/auth/callback&response_type=code` — if the login page does not appear, CORS or `webOrigins` is not set correctly in `realm.json`.
3. Check the browser console (403 = wrong role, 401 = no token).
4. Check that the TP1 Spring Boot API is running on `localhost:8080`.
