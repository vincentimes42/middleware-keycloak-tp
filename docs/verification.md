# Keycloak — stack verification

Goal: verify that the stack (Keycloak + Postgres) is up, that the `listings`
realm is imported, and that we can obtain a valid JWT for `alice`.

> **Paths:** the commands below use two variables, set once per terminal
> (from the "Run" box of [`README.md`](../README.md)):
>
> ```bash
> export TP1_DIR="/path/to/your/tps-1-repo"     # the Spring Boot app repo
> export KC_DIR="/path/to/keycloak-repo"        # this Keycloak repo
> ```

## 1) Prerequisites

- `docker compose` available (`docker compose version`).
- The base project (`../springboot/docker-compose.yml`) already up — it runs
  the API on `8080` (see README "Run").
- Port `8081` free (Keycloak) and `5436` free (Keycloak's Postgres).

## 2) Start

```bash
cd "$TP1_DIR" && docker compose up -d   # base: API (8080) + its Postgres (5435)
cd "$KC_DIR"  && docker compose up -d   # this: Keycloak (8081) + its Postgres (5436)
```

`depends_on` waits for `keycloak-postgres` to become `healthy` before starting
`keycloak`. Once the app is ready, the healthcheck turns `healthy`.

Tail:

```bash
docker compose ps              # keycloak healthy / keycloak-postgres healthy
docker compose logs -f keycloak
```

## 3) Useful URLs

| URL | Purpose |
|---|---|
| <http://localhost:8081/admin> | Admin console (login `admin` / `admin`) |
| <http://localhost:8081/realms/listings/account/> | User console (`alice` / `secret`) |
| <http://localhost:8081/realms/listings/.well-known/openid-configuration> | OIDC metadata |
| <http://localhost:8081/realms/listings/protocol/openid-connect/certs> | JWKS (public keys) |
| <http://localhost:8081/realms/listings/protocol/openid-connect/token> | Token endpoint |

## 4) Roles and accounts

| Account | Realm role | Password |
|---|---|---|
| `admin` (master realm) | admin | `admin` |
| `alice` | `seller` | `secret` |
| `bob` | `seller` | `secret` |

Accounts / roles are created by `realm/realm.json`.

## 5) Obtain a token (the canonical call)

```bash
# confidential client: listings-api (secret: listings-api-secret)
curl -fsS -X POST http://localhost:8081/realms/listings/protocol/openid-connect/token \
  -d grant_type=password \
  -d client_id=listings-api \
  -d client_secret=listings-api-secret \
  -d username=alice \
  -d password=secret
```

Expected response: a JSON with `access_token`, `refresh_token`, `expires_in`,
`scope`, `token_type` (Bearer).

## 6) Read the JWT (no library)

The token is `header.payload.signature` in base64url. To read the `payload`:

```bash
ACCESS=$(curl -fsS -X POST http://localhost:8081/realms/listings/protocol/openid-connect/token \
  -d grant_type=password -d client_id=listings-api -d client_secret=listings-api-secret \
  -d username=alice -d password=secret | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
python3 - <<PY
import base64, json
raw = "$ACCESS".split(".")[1]
raw += "=" * (-len(raw) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(raw)), indent=2))
PY
```

Claims that matter for the Spring Boot application (see `exercise.md`):

| claim | example value |
|---|---|
| `iss` | `http://localhost:8081/realms/listings` |
| `sub` | the Keycloak `uuid` of the user (stable, unique) |
| `azp` | `listings-api` |
| `preferred_username` | `alice` |
| `email` | `alice@listings.local` |
| `realm_access.roles` | `["seller"]` |
| `scope` | `email profile` |

> `sub` is the stable key that replaces the TP1 `app_user` table — it is the
> value expected in `listing.owner_sub`.

> **Note:** the `scope` claim lists the standard OIDC scopes (profile, email,
> ...). The realm roles live in a separate `realm_access.roles` array — that
> is where `seller` is, not in the `scope`.

## 7) Stop

```bash
# keep the data
docker compose down

# wipe everything (Postgres + Keycloak)
docker compose down -v
```

## 8) Reset the stack

```bash
docker compose down -v && docker compose up -d
```

The realm is re-imported on the first boot (`--import-realm`, `ignoreExisting`),
and the demo accounts return to their initial state.

## 9) Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `keycloak` restarts | `keycloak-postgres` not ready | check `docker compose logs keycloak-postgres` |
| `401 invalid_client` | wrong `client_secret` | use `listings-api-secret` |
| `sub` missing from token | `basic` scope missing | `basic` + `roles` are already in `realm.json` |
| `404 /health/ready` | 26.x health path not mounted | don't rely on it; test `/realms/listings/.well-known/openid-configuration` |
