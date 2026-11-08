# TP Keycloak — identity stack

Follow-up to the Spring Boot TP (TP1, `../springboot/`): we **replace
HTTP Basic authentication** with **Keycloak** / **OAuth2 / OIDC**.


The student modifies **the TP1 repo**, and the base compose (the API + its
Postgres) plus this folder provides the identity stack:

- `docker-compose.yml` — Keycloak + its Postgres, attached to the shared
  `middleware` network (defined in `../springboot/docker-compose.yml`)
- `realm/realm.json` — the realm, the clients, the accounts, the roles
- `spa/` (bonus) — a small SPA that consumes the TP1 API with a JWT
- [`exercise.md`](exercise.md) — the full statement (8h, core 1·2·3a·3b·4·5 + bonus 6·7·8)
---

## Prerequisites

- Docker + Docker Compose (see `docker compose version`)
- JDK 27 + Maven 3.9+ (already installed for TP1)
- Ports free on the host: `8081` (Keycloak), `8080` (the API, base — no change for this TP),
  `5435` (the API's Postgres, base), `5436` (Keycloak's Postgres, this file)

> **Tip:** use `http://localhost:8081` (not `http://127.0.0.1:8081`) for
> **Keycloak** URLs in every doc. Keycloak copies the request `Host` header
> into the token's `iss` claim. If you mix hosts, the `JwtDecoder` will
> reject the token (`issuer` mismatch), which is hard to debug.

## How the pieces fit (one shared network)

This TP is **two Docker Compose projects on ONE shared network** (`middleware`,
created by the base project in `../springboot/docker-compose.yml`):

| Project | Folder | Services | Host ports |
|---|---|---|---|
| base | `../springboot` | `listings-api`, `listings-postgres` | API `8080`, pg `5435` |
| this | `keycloak` | `keycloak`, `keycloak-postgres` | Keycloak `8081`, pg `5436` |

Services find each other by **container name** over the shared network, never
by `localhost`. So the API reaches Keycloak as `keycloak:8080` (Keycloak's
*internal* port), and Prometheus in the other TP reaches the API as
`listings-api:8080`.

> **Why did Keycloak move to 8081?** Because the API stays on 8080 for every
> TP. Two services cannot publish the same host port, so the one that is
> "added on top" (Keycloak) takes 8081. The API never changes its port.

## Run

> **Two repos, two folders.** The TP1 repo (the Spring Boot app) and this
> Keycloak repo are **side by side** (any folder names). Set these once per
> terminal so the commands below do not need hard-coded paths:
>
> ```bash
> export TP1_DIR="/path/to/your/tps-1-repo"     # the Spring Boot app repo
> export KC_DIR="/path/to/keycloak-repo"        # this Keycloak repo
> ```

### 0) Required base edit — `../springboot/docker-compose.yml`

The API keeps its port (8080). The only required edit is to tell it where
Keycloak's public keys are, so it can validate the JWTs. In the
`listings-api` service's `environment` block (the issuer can also go in
`application.yml` if you prefer):

```yaml
  listings-api:
    environment:
      # issuer = what a client sees (Host: localhost:8081); used to validate the JWT
      SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI: "http://localhost:8081/realms/listings"
      # JWKS = fetched from INSIDE the container -> use the network name `keycloak`
      SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI: "http://keycloak:8080/realms/listings/protocol/openid-connect/certs"
```

> **Why two different hostnames:** `issuer-uri` is only a validation string
> (the browser sees Keycloak at `localhost:8081`), but the SDK still fetches
> the public keys from `{issuer}/protocol/openid-connect/certs`. From inside
> the API container `localhost` is the container itself, so that fetch must go
> through the network name `keycloak` (on its internal port 8080). If you do
> not split these, you get `issuer`/key-loading errors that look like a
> mismatch.

### 1) Start the base (the API + its Postgres)

```bash
cd "$TP1_DIR"
docker compose up -d
curl -fsS http://localhost:8080/actuator/health      # API on 8080
```

### 2) Start the identity stack (this folder)

```bash
cd "$KC_DIR"
docker compose up -d

curl -s http://localhost:8081/realms/listings/.well-known/openid-configuration
docker compose ps        # keycloak + keycloak-postgres healthy
```

Endpoints on the host:

- Admin console: <http://localhost:8081/admin> (`admin` / `admin`)
- `alice` user console: <http://localhost:8081/realms/listings/account/>
  (`alice` / `secret`)
- issuer of the `listings` realm: `http://localhost:8081/realms/listings`
  (this is the value of `SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI`)
- JWKS (public keys):
  <http://localhost:8081/realms/listings/protocol/openid-connect/certs>

A full walkthrough (`curl` for the token, reading the JWT) is in
[`docs/verification.md`](docs/verification.md).

### 3) SPA (bonus, Step 7)

```bash
cd "$KC_DIR/spa"
python3 -m http.server 3000        # or any static file server
# open http://localhost:3000
```

The SPA loads `keycloak-js` from Keycloak (`http://localhost:8081/js/keycloak.js`)
and calls the API at `http://localhost:8080` (see `spa/js/config.js`).

## Stop

```bash
cd "$KC_DIR"  && docker compose down          # wipe the identity stack + its Postgres
cd "$TP1_DIR" && docker compose down -v       # wipe the API + its Postgres (optional)
```

## Tree

```
keycloak/
├── .gitignore
├── docker-compose.yml        # keycloak(26.8) + keycloak-postgres(16) on the
│                             #   shared `middleware` network (host 8081 / 5436)
├── realm/
│   └── realm.json            # realm "listings" — clients, users, roles, CORS
├── docs/
│   └── verification.md       # admin UI check + token curl + claims
├── spa/                      # BONUS (Step 7) — keycloak-js + fetch
│   ├── index.html
│   ├── js/{config,auth,api,ui}.js
│   └── README-spa.md
├── README.md                 # this file
└── exercise.md               # the statement (8h, core 1·2·3a·3b·4·5 + bonus 6·7·8)
```

## Useful links (project version)

- Keycloak 26.x — Getting started: <https://www.keycloak.org/documentation>
- Keycloak — Import & Export: <https://www.keycloak.org/misc/import-export>
- Spring Security — OAuth2 Resource Server / JWT:
  <https://docs.spring.io/spring-security/reference/servlet/oauth2/web/jwt.html>
- OIDC — Core: <https://openid.net/specs/openid-connect-core-1_0.html>

> TP rule: no `TODO`, no stub, no secret in production code.
> The passwords in `realm.json` (`secret`) are demos, not real secrets.
