# TP Keycloak — identity stack

Follow-up to the Spring Boot TP (TP1, `../springboot/`): we **replace
HTTP Basic authentication** with **Keycloak** / **OAuth2 / OIDC**.

The student only modifies **the TP1 repo**. This folder provides:

- `docker-compose.yml` — the Keycloak + Postgres stack, ready to run
- `realm/realm.json` — the realm, the clients, the accounts, the roles
- `spa/` (bonus) — a small SPA that consumes the TP1 API with a JWT
- [`exercise.md`](exercise.md) — the full statement (8h, core 1-5 + bonus 6-8)

---

## Prerequisites

- Docker + Docker Compose (see `docker compose version`)
- JDK 27 + Maven 3.9+ (already installed for TP1)
- Port `8080` free (Keycloak), `5433` free (exposed Postgres)
- Port `8081` free (the TP1 API runs here — port `8080` is reserved
  for Keycloak in this TP)

> **Tip:** use `http://localhost:8080` (not `http://127.0.0.1:8080`) in
> every URL — both in this folder and in `../springboot/application.yml`.
> Keycloak copies the request `Host` header into the token's `iss` claim.
> If you mix hosts, the `JwtDecoder` will reject the token (`issuer`
> mismatch), which is very hard to debug.

## Run

### 1) The identity stack

```bash
cd keycloak
docker compose up -d

# verify
curl -s http://localhost:8080/realms/listings/.well-known/openid-configuration
docker compose ps    # tp-keycloak healthy — tp-postgres healthy
```

- Admin console: <http://localhost:8080/admin> (`admin` / `admin`)
- `alice` user console: <http://localhost:8080/realms/listings/account/>
  (`alice` / `secret`)
- issuer of the `listings` realm: `http://localhost:8080/realms/listings`
  (this is the value expected by `spring.security.oauth2.resourceserver.jwt.issuer-uri`
  in TP1, see `exercise.md` Steps 3a/3b)
- JWKS (public keys):
  <http://localhost:8080/realms/listings/protocol/openid-connect/certs>

A full verification walkthrough (with `curl` for the token and how to read the
JWT) is in [`docs/verification.md`](docs/verification.md).

### 2) The API (the TP1 repo)

Two options depending on your environment:

- **Locally** — in the `../springboot` folder, in parallel, run
  `mvn spring-boot:run` as in TP1. Change the API port (`server.port: 8081`)
  if `8080` is reserved for Keycloak on the same machine, or move Keycloak to
  another port in `docker-compose.yml`.

- **In compose** — if you prefer everything in Docker, add a service
  `build: ../springboot` (a Dockerfile is required) that references Keycloak
  via `http://keycloak:8080`. Not required; optional.

### 3) SPA (bonus, TP Step 7)

```bash
cd spa
python3 -m http.server 3000        # or any static file server
# open http://localhost:3000
```

The SPA loads `keycloak-js` served by Keycloak
(`http://localhost:8080/js/keycloak.js`), uses the public client `listings-spa`,
and consumes the TP1 API with a Bearer JWT.

## Stop

```bash
docker compose down        # keep Keycloak data
docker compose down -v     # wipe + re-initialize Postgres + Keycloak
```

## Tree

```
keycloak/
├── .gitignore
├── docker-compose.yml        # stack: keycloak(26.8) + postgres(16), volumes, health
├── realm/
│   └── realm.json            # realm "listings" — clients, users, roles, CORS
├── docs/
│   └── verification.md       # admin UI check + token curl + claims
├── spa/                      # BONUS (Step 7) — keycloak-js + fetch
│   ├── index.html
│   ├── js/{config,auth,api,ui}.js
│   └── README-spa.md
├── README.md                 # this file
└── exercise.md               # the statement (8h, core 1-5 + bonus 6-8)
```

## Useful links (project version)

- Keycloak 26.x — Getting started: <https://www.keycloak.org/documentation>
- Keycloak — Import & Export: <https://www.keycloak.org/misc/import-export>
- Spring Security — OAuth 2 Login / Resource Server / JWT:
  <https://docs.spring.io/spring-security/reference/servlet/authentication/index.html>
- OIDC — Core specification: <https://openid.net/specs/openid-connect-core-1_0.html>

> TP rule: no `TODO`, no stub, no secret in production code.
> The passwords in `realm.json` (`secret`) are **demos**, not real secrets.
