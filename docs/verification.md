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
- Ports `8081` (Keycloak), `9001` (Keycloak health / management) and `5436`
  (Keycloak's Postgres) free.

## 2) Start

```bash
cd "$TP1_DIR" && docker compose up -d   # base: API (8080) + its Postgres (5435)
cd "$KC_DIR"  && docker compose up -d   # this: Keycloak (8081) + its Postgres (5436)
```

`depends_on` waits for `keycloak-postgres` to become `healthy` before starting
`keycloak`. The Keycloak healthcheck calls its readiness endpoint (management
port, container 9000): `healthy` means the realm is imported and the server is
ready. The same endpoint is published on host port **9001**.

Tail:

```bash
docker compose ps              # keycloak healthy / keycloak-postgres healthy
curl -fsS http://localhost:9001/health/ready   # {"status": "UP", ...}
docker compose logs -f keycloak
```

List the realms through the admin API (Step 1 `Verify`):

```bash
ADMIN_TOKEN=$(curl -fsS -X POST http://localhost:8081/realms/master/protocol/openid-connect/token \
  -d grant_type=password -d client_id=admin-cli -d username=admin -d password=admin \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8081/admin/realms \
  | python3 -c 'import sys,json;print([r["realm"] for r in json.load(sys.stdin)])'
# expected: ['master', 'listings']
```

## 3) Useful URLs

| URL | Purpose |
|---|---|
| <http://localhost:8081/admin> | Admin console (login `admin` / `admin`) |
| <http://localhost:9001/health/ready> | Readiness (management port; `"status": "UP"`) |
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
| `carol` | (none) | `secret` |

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
| `aud` | `listings-api` (audience mapper in `realm.json`) |
| `azp` | `listings-api` |
| `preferred_username` | `alice` |
| `email` | `alice@listings.local` |
| `realm_access.roles` | `["seller"]` |
| `scope` | `profile email` |
| `acr` | `1` (level of authentication; Step 8) |

> `sub` is the stable key that replaces the TP1 `app_user` table — it is the
> value expected in `listing.owner_sub`.

> **Note:** the `scope` claim lists the standard OIDC scopes (profile, email,
> ...). The realm roles live in a separate `realm_access.roles` array — that
> is where `seller` is, not in the `scope`.

## 7) Step 3b — Bearer validation

Helpers for §7 to §10 (tokens expire after 5 minutes: re-run `tok`):

```bash
API=http://localhost:8080
R=http://localhost:8081/realms/listings
JSON='Content-Type: application/json'
tok()  { curl -fsS -X POST $R/protocol/openid-connect/token -d grant_type=password \
           -d client_id=listings-api -d client_secret=listings-api-secret \
           -d username="$1" -d password=secret \
         | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }
ALICE=$(tok alice); BOB=$(tok bob); CAROL=$(tok carol)
BODY='{"title":"Bike","price":350,"category":"SPORTS"}'
```

```bash
code -X POST $API/listings -H "$JSON" -d "$BODY"                                   # 401
code -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer ${ALICE%?}x"   # 401 (tampered)
code -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer $ADMIN_TOKEN"  # 401 (master realm, §2)
code -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer $ALICE"       # 201
code $API/listings                                                                  # 200
code $API/listings -H "Authorization: Bearer abc.def.ghi"                           # 401
curl -s -i -X POST $API/listings -H "$JSON" -d "$BODY" | grep -i '^WWW-Authenticate'   # Bearer ...
```

## 8) Step 4 — roles and ownership matrix

```bash
ID=$(curl -fsS -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer $ALICE" \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
for who in anonymous carol bob alice; do
  case $who in anonymous) H=();; carol) H=(-H "Authorization: Bearer $CAROL");;
               bob) H=(-H "Authorization: Bearer $BOB");; alice) H=(-H "Authorization: Bearer $ALICE");; esac
  printf "%-9s GET=%s POST=%s PUT=%s\n" "$who" "$(code "${H[@]}" $API/listings)" \
    "$(code "${H[@]}" -X POST $API/listings -H "$JSON" -d "$BODY")" \
    "$(code "${H[@]}" -X PUT $API/listings/$ID -H "$JSON" -d "$BODY")"
done
# expected: anonymous 200 401 401 | carol 200 403 403 | bob 200 201 403 | alice 200 201 200
code -H "Authorization: Bearer $ALICE" -X DELETE $API/listings/$ID                   # 204

curl -fsS -H "Authorization: Bearer $ALICE" $API/auth/whoami; echo                 # sub + roles
code $API/auth/whoami                                                                # 401
```

## 9) Step 5 — `owner_sub`, local identity removed

```bash
ID=$(curl -fsS -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer $ALICE" \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
SUB=$(curl -fsS -H "Authorization: Bearer $ALICE" $API/auth/whoami | python3 -c 'import sys,json;print(json.load(sys.stdin)["sub"])')
(cd "$TP1_DIR" && docker compose exec -T listings-postgres psql -U listings -d listings \
  -c "SELECT id, owner_sub, user_id FROM listing WHERE id = $ID")      # owner_sub = $SUB, user_id NULL
echo "alice sub = $SUB"

code -H "Authorization: Bearer $BOB"   -X DELETE $API/listings/$ID     # 403
code -H "Authorization: Bearer $ALICE" -X DELETE $API/listings/$ID     # 204

curl -s -w "\n-> %{http_code}\n" -X POST $API/auth/register -H "$JSON" -d '{}'   # 404 + JSON
grep -rnE "class User\b|UserRepository|UserService|PasswordEncoder" "$TP1_DIR/src/main/java" \
  || echo "ok: local identity removed"
```

Then replay the TP1 checks (`../springboot/docs/verification.md` §6, §10, §12)
with `-H "Authorization: Bearer $ALICE"` instead of `-u`.

## 10) Step 6 (bonus) — 401 / 403 contracts

```bash
curl -s -i -X POST $API/listings -H "$JSON" -d "$BODY" | grep -iE '^HTTP|^WWW-Authenticate|status'
# 401, WWW-Authenticate: Bearer realm="listings" ..., JSON body
curl -s -i -X POST $API/listings -H "$JSON" -d "$BODY" -H "Authorization: Bearer $CAROL" | grep -iE '^HTTP|status'
# 403, JSON body (role)
code $API/listings                                                     # 200
```

## 11) Stop

```bash
# keep the data
docker compose down

# wipe everything (Postgres + Keycloak)
docker compose down -v
```

## 12) Reset the stack

```bash
docker compose down -v && docker compose up -d
```

The realm is re-imported on the first boot (`--import-realm`, `ignoreExisting`),
and the demo accounts return to their initial state.

## 13) Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `keycloak` restarts | `keycloak-postgres` not ready | check `docker compose logs keycloak-postgres` |
| `401 invalid_client` | wrong `client_secret` | use `listings-api-secret` |
| `sub` missing from token | `basic` scope missing | `basic` + `roles` are already in `realm.json` |
| `404` on `http://localhost:8081/health/ready` | health is served on the management port, not on the main port | use `http://localhost:9001/health/ready` |
| `401` with `The aud claim is not valid` | token without `aud: listings-api` | re-import the realm (`docker compose down -v && docker compose up -d`): the audience mapper is in `realm.json` |
| `403` for `alice` on every write | authorities mapped as `ROLE_seller` | map to upper case (`ROLE_SELLER`), exercise Step 4 |
| `401` on a public `GET` | the client sent an expired token | get a fresh token, or send none |
| `Invalid parameter: redirect_uri` (SPA) | SPA not served from `localhost:3000` / `:5500` | serve it from one of the allowed origins |
