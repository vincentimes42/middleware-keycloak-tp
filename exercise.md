# TP Keycloak — Progressive Implementation

## Overview

This is the follow-up to the Spring Boot TP (TP1, `../springboot/`). We reuse
the TP1 API and **replace its HTTP Basic authentication** with Keycloak via the
OAuth2 / OIDC flow.

**How a step is validated:** by what you can *show* — a `curl` returns the
right status code / body / header, a token carries the expected claims, the
stack is `healthy`. Each step's **`Verify` section** is your definition of
"done", and it is what gets graded. You do it with `curl` and the running
stack, not with a test suite.

**Java tests are optional.** `spring-boot-starter-test` and
`spring-security-test` are already on the classpath, so you *can* write your own
tests if you want to — but they are not required, not part of the deliverable,
and not re-scored at the end. (The TP1 starter smoke test still keeps
`mvn clean verify` green on its own.)

The specification describes **behaviors, contracts, and status codes**.
It does NOT prescribe the internal implementation.

> **Prerequisite: TP1 is done and green.** Concretely, the TP1 API
> (`../springboot`) passes its own core checklists (register, CRUD, ownership,
> versioning, metrics) using HTTP Basic authentication.
> For this TP the API runs on port **8080** (unchanged) with Keycloak on
> **8081** — read **README → Run** for the shared-network setup and the one
> required edit in `../springboot/docker-compose.yml`
> (issuer/JWKS env; no port change). If TP1 is not yet at that state, finish
> it first before starting this one.
>
> This TP only changes **who the user is** and how the API verifies them.

### How to read a step

| Section | What it gives you |
|---|---|
| **Outcome** | the observable result |
| **Why this step** | the concept taught and the real problem it solves |
| **How it fits** | where the request or the token goes and which part you change (when several components are involved) |
| **Build it** | the changes, grouped, in order; the `→` line under each item says what breaks without it |
| **Checkpoint** | a quick call to confirm a group works before starting the next one |
| **Expected behavior** | the contract: statuses, claims, rules |
| **Verify** | the definition of done (commands in [`docs/verification.md`](docs/verification.md)) |
| **If you are stuck** | pointers to the class, setting, or documentation; never the full code |

---

## What is Keycloak? (one minute)

**Keycloak is an open-source Identity and Access Management (IAM) server.**
It is the *single place* that knows who the users are, how to log them in,
and how to prove their identity to other applications.

| Question | Answer |
|---|---|
| Where do I put the users? | **Realm** (think of a tenant / a company). This TP has one realm: `listings`. |
| Where do I put an application that uses Keycloak? | **Client** (a "client" = one API or SPA that speaks to Keycloak). We have `listings-api` and `listings-spa`. |
| Where do I put the users' credentials? | In a **User** object inside the realm — never in your app. |
| How does my app say *who is calling*? | A **token** (a JWT) signed by Keycloak, carried in the `Authorization: Bearer <jwt>` header. |
| How does my app decide *what is allowed*? | From the **claims** of the JWT (here: `sub` and `realm_access.roles`). |

Three Keycloak objects you will meet in this TP:

| Keycloak object | Example in this realm |
|---|---|
| **Realm** (tenant) | `listings` |
| **Client** (application) | `listings-api` (confidential), `listings-spa` (public) |
| **User** | `alice`, `bob` — realm role `seller`; `carol` — no role (to test the 403) |

Keycloak is a **server**, not a Spring Boot starter, not a Java library. It
talks to your app over HTTP using standard protocols:
**OAuth2** (the grant flows), **OIDC** (the identity layer on top), and
**JWT** (the token format). The next section walks through those three in
two minutes.

> **Mental model for the day:** *Keycloak is the "who + who allowed" server.*
> Your Spring Boot app is the *what* server. They talk through JWTs.

---

## Before you start — OAuth2, OIDC, JWT in one minute

New to the three? This is the 2-minute mental model (details per step below).

### OAuth2 (the "delegation" protocol)

Four players:

| Role | In this exercise |
|---|---|
| **Resource Owner** | the end user (`alice`, `bob`) — owns the data |
| **Client** | a browser/SPA, or a script (Postman) that acts on the user's behalf |
| **Authorization Server** | Keycloak — knows the users, issues tokens |
| **Resource Server** | the listings API (TP1) — serves the listings, verifies tokens |

> Note: the resource owner does **not** talk to the resource server directly
> about identity — they log in at the authorization server (Keycloak).

Core flow (here we use the **authorization code flow**, the modern secure one):

1. Client asks Keycloak "let me identify `alice`".
2. Keycloak redirects the browser to its login page.
3. User types `alice`/secret. Keycloak is convinced.
4. Keycloak redirects back to the client with a short-lived **code**.
5. Client exchanges the code + its own client-secret for an **access token**
   (a JWT) + a **refresh token**.
6. Client calls the API with `Authorization: Bearer <jwt>`.

### OIDC (OpenID Connect)

OIDC = OAuth2 + a **standard identity layer**. It standardises the claims
in the token (`sub`, `email`, `preferred_username`, `realm_access`…) and
gives you a well-known metadata endpoint:

`http://localhost:8081/realms/listings/.well-known/openid-configuration`

### JWT (the token format)

A JWT is three base64url parts: `header.payload.signature`.

- **header**: `{ alg: "RS256", typ: "JWT" }`
- **payload**: the interesting part — a set of **claims**
- **signature**: the payload signed with Keycloak's **private key**

The API verifies the signature with the **public key** obtained from the
**JWKS** endpoint (`.../protocol/openid-connect/certs`). It never stores
the secret; it just checks the signature, issuer, audience, expiry.

> **Tip:** to read a JWT without a library, paste it in a JWT decoder
> website, or decode the middle segment with `base64 -d`. The `payload`
> is where the user's identity and roles live.

### The pieces of this TP, in one picture

Every step below touches one part of this picture.

```
             (1) get a token                       (3) public keys, fetched once
 client ─────────────────────────> Keycloak :8081 <──────────────────────┐
 curl / SPA <── JWT (signed) ──────  realm listings                       │
   │                                 users alice, bob                     │
   │ (2) Authorization: Bearer <jwt>                                       │
   ▼                                                                       │
 listings-api :8080 ── security chain ── verify signature/iss/aud/exp ─────┘
                       │                 (Steps 3a-3b)
                       ├── map realm_access.roles -> authorities (Step 4)
                       ▼
                     service ── owner check: jwt.sub == listing.owner_sub (Step 5)
                       ▼
                     PostgreSQL listing (owner_sub)
```

---

## Domain & data model (this TP)

The domain (TP1) does not change: actors, the two entities, 1-N ownership,
active lifecycle. What changes is **where the user lives**.

| Data | TP1 (local) | TP2 (external) |
|---|---|---|
| Identity (email, username, password, role) | PostgreSQL `app_user` + BCrypt | **Keycloak** (realm `listings`) |
| Listing content | PostgreSQL `listing` | PostgreSQL `listing` (unchanged) |
| "Who owns the listing" | `listing.user_id` | **`listing.owner_sub`** = `sub` claim of the JWT |

### What the API needs to know from Keycloak

Two **claims** are sufficient:

- **`sub`** — a stable, unique user identifier (UUID). This is the new
  "owner".
- **`realm_access.roles`** — the list of realm roles (here: `["seller"]`).

Everything else (`name`, `email`, `preferred_username` …) is cosmetic.

> **Key idea**: the API no longer stores a `user` table. The `sub` claim
> *is* the user. `listing.owner_sub` stores it.

---

## Scope

| Track | Steps |
|---|---|
| **Core** (required) | 1 · 2 · 3a · 3b · 4 · 5 |
| **Bonus** (start only when the core `Verify` sections are green) | 6 (401/403 contracts) · 7 (SPA) · 8 (WebAuthn / custom flow) · refresh · multi-client · logout · admin UI |
| **Delivery** | 9 (final integration — see Step 9) |

Each core step's `Verify` section is your "definition of done".
Bonus steps have their own `Verify` section; doing them is optional
but counts for the grade if you deliver them.

---

## Conventions

- Tokens are **JWTs** signed with RS256 by Keycloak.
- The API expects the token in the HTTP header `Authorization: Bearer <jwt>`.
- The issuer is `http://localhost:8081/realms/listings`.
- The audience is `listings-api`: every token of the realm carries
  `aud: listings-api` (audience mapper in `realm/realm.json`), and the API
  rejects a token whose `aud` does not contain it.
- `GET /listings*` stays **public** (same as TP1). Writes require a valid
  token whose `realm_access.roles` contains `seller`, mapped to the Spring
  authority `ROLE_SELLER` (so TP1's `hasRole("SELLER")` rules do not change).
- Accounts (password `secret`): `alice` and `bob` have the role `seller`;
  `carol` has no role.
- Access tokens expire after **5 minutes**: get a fresh one when a call that
  worked starts returning 401.
- Error JSON shape is the same as TP1 (timestamp/status/error/message/fields).

---

## Error handling & status codes (cross-cutting)

| Status | Trigger | Mechanism |
|---|---|---|
| 400 | Malformed request body | Spring |
| 401 | No token, or invalid / expired / bad signature / bad issuer / wrong audience — also on a public `GET` that carries an invalid token | Spring Security (`WWW-Authenticate: Bearer …`; `realm="listings"` added in Step 6) |
| 403 | Valid token without the `seller` role (`carol`), or not the owner | Spring Security `hasRole("SELLER")` / service layer |
| 404 | Unknown listing, or `active=false` for a non-owner; a removed endpoint (`/auth/register`, Step 5) | service layer (`ResourceNotFoundException`); `NoResourceFoundException` |
| 422 | DTO validation (title > 120, price <= 0, missing field) | `@ControllerAdvice` (TP1) |

> **Key change vs TP1**: the 401 reason is now a **JWT problem**
> (missing/invalid/expired/bad signature/bad issuer/bad audience), not a
> password problem. The API never knows the password.

---

## Testing strategy (only if you write tests — optional)

If you do write Java tests, `spring-boot-starter-test` and `spring-security-test`
are already on the classpath (JUnit 5, AssertJ, Mockito). The three levels to
consider: **Unit** (one service, `Jwt` mocked with Mockito), **Slice** (web layer
only, `@WebMvcTest`), **Integration** (real stack against the running Keycloak,
`@SpringBootTest` + `WebTestClient`).

### What NOT to do (in production code)

- Don't store the password in your app — Keycloak owns it.
- Don't call Keycloak from inside the request path to "check the user".
  Let Spring Security verify the JWT (issuer / audience / signature, already done
  by `oauth2ResourceServer`).

---

## Step 1 — Bring up the stack   CORE

**Outcome** — The Keycloak identity stack is **running and verified**:
**Keycloak (26.8)** + **Postgres (16)** are healthy, the realm **`listings`**
is imported from `realm/realm.json`, and the OIDC metadata + JWKS + account +
admin consoles are reachable. The API and the SPA can now rely on a **real
issuer** before any application code changes.

**Why this step** — An identity provider is infrastructure the API depends on,
like its database. You start it first and check it answers, so that every
later failure points at your code, not at a stack that was never up.

### How it fits

```
../springboot/docker-compose.yml          keycloak/docker-compose.yml (this repo)
  listings-api      :8080                   keycloak            :8081 -> 8080
                                                                :9001 -> 9000 (health)
  listings-postgres :5435                   keycloak-postgres   :5436
        └──────────── network `middleware` (created by TP1) ───────────┘
                                            realm/realm.json -> imported at first boot
```

### Build it

> **Pre-req** — the TP1 base is up on `8080` (TP1's `docker compose up`),
> and the one required base edit (issuer + JWKS env) from **README → Run §0**
> is applied.

1. **Start** the identity stack in this repo:
   `cd "$KC_DIR" && docker compose up -d`.
   → Keycloak attaches to the `middleware` network created by TP1: if TP1's
   stack is not up, the network does not exist and the start fails.
2. **Wait** for `keycloak` + `keycloak-postgres` to become **healthy**
   (`docker compose logs -f keycloak` to watch the realm import).
   → The realm is imported during the first boot; a token request before the
   end of the import fails. "Healthy" is the readiness check: once it is
   green, the realm is there.
3. **Check** the realm, the OIDC metadata, and the consoles (the `Verify`
   list).
   → The metadata document is what the API reads in Step 3a: if it is wrong
   here, the API cannot start there.

### Expected behavior
- `docker compose ps` shows `keycloak` and `keycloak-postgres` **healthy**
  (Keycloak's healthcheck is its readiness endpoint: healthy = realm imported
  and server ready); `listings-api` (base) is `Up` on `8080`.
- `GET http://localhost:9001/health/ready` (management port) → **200**,
  `"status": "UP"`.
- The realm **`listings`** exists (imported automatically from
  `realm/realm.json`).
- OIDC metadata
  `GET /realms/listings/.well-known/openid-configuration` → **200** with
  `issuer = http://localhost:8081/realms/listings`.
- Public endpoints reachable: **JWKS**, the **account** console, the **admin**
  console.

### Verify
- [ ] `cd "$KC_DIR" && docker compose ps` shows `keycloak` and `keycloak-postgres` **healthy**; `cd "$TP1_DIR" && docker compose ps` shows `listings-api` `Up` on 8080
- [ ] `curl -fsS http://localhost:9001/health/ready` → `"status": "UP"`
- [ ] `curl -fsS http://localhost:8081/realms/listings/.well-known/openid-configuration` → 200, `issuer` matches
- [ ] the list of realms (admin API, [`docs/verification.md` §2](docs/verification.md)) includes `listings`
- [ ] you can log in as `alice` / `secret` on the account console

### If you are stuck
- Start from **README → Run**.
- If the realm is missing, the **import** failed — tail the `keycloak` logs for the `import` line and confirm `realm/realm.json` is mounted.
- Full walkthrough (URLs, `curl`, reading the JWT): [`docs/verification.md`](docs/verification.md).

---

## Step 2 — Understand the flow (token + JWT)   CORE

**Outcome** — You can **obtain a token** for `alice` (confidential client
`listings-api`, password grant), **decode the JWT**, and **read the claims**
the API will receive — `iss`, `sub`, `azp`, `preferred_username`, and
`realm_access.roles` ⊇ `["seller"]` — with a **`refresh_token`** and a **JWKS**
endpoint that verifies the signature (RS256). A **bad password → 400
`invalid_grant`**. No Java involved — this is **pure protocol**.

**Why this step** — Before writing code that trusts a token, you look at one.
Every security decision of Steps 3b to 5 reads a claim you see here: `iss`
for trust, `realm_access.roles` for permission, `sub` for ownership.

### How it fits

```
curl ── POST /realms/listings/protocol/openid-connect/token ──> Keycloak
        (client listings-api + secret, user alice + password)      │
     <── { access_token (JWT), refresh_token, expires_in } ────────┘
           │
           └─ decode the payload: iss, sub, azp, realm_access.roles
curl ── GET  /realms/listings/protocol/openid-connect/certs ──> public keys (JWKS)
```

### Build it

> This step is **read-only**: you **run the `curl`s** (no code, no config).
> The canonical commands are in [`docs/verification.md` §5 / §6](docs/verification.md).

1. **Obtain** an access token for `alice` using the confidential client
   `listings-api` (secret `listings-api-secret`) with the **password grant**.
   → This is the token every later step sends to the API; you will reuse the
   same call all day.
2. **Decode** the `access_token` (base64url one-liner) and **read** the
   payload claims.
   → A JWT is not encrypted, only signed: anyone can read it. What protects it
   is the signature, checked in Step 3b.
3. **Confirm** the `refresh_token` is returned.
   → Access tokens expire after a few minutes; the refresh token renews them
   without asking for the password again (SPA, Step 7).
4. **Read** the JWKS endpoint and confirm it serves the RS256 public key(s).
   → These are the keys the API uses to verify signatures: the API never
   needs a secret shared with Keycloak.
5. **Try a bad password** and confirm it returns `400 invalid_grant`.
   → The password is checked by Keycloak only; the API never sees it.

### Expected behavior
- The token **payload** carries: `iss` (= `http://localhost:8081/realms/listings`),
  `sub` (a stable UUID), `aud` (= `listings-api`), `azp` (= `listings-api`),
  `preferred_username`, `acr` (= `"1"`, see Step 8), and
  `realm_access.roles` **containing `seller`**.
- A token for `carol` has **no** `realm_access` claim (no realm role).
- A **`refresh_token`** is present (used to renew the access token).
- The **JWKS** endpoint serves the **public key(s)** that verify the signature
  (RS256) — this is what the API will use in Step 3b.
- `basic`, `roles`, and `acr` are already **default client scopes** of
  `listings-api`, so a plain request already gets `sub`, `realm_access`, and
  `acr`.

### Verify
- [ ] [`docs/verification.md` §5](docs/verification.md) (Obtain a token) + [§6](docs/verification.md) (Read the JWT) both pass: `access_token` + `refresh_token` present; payload has `iss`, `sub`, `aud=listings-api`, `azp=listings-api`, `realm_access.roles ⊇ ["seller"]`; JWKS has a `keys` array (RS256)
- [ ] A bad password yields a `400` with `invalid_grant` (not a 200)

### If you are stuck
- The exact commands + the base64url decode one-liner are in [`docs/verification.md` §5 / §6](docs/verification.md).
- If you see **no** `realm_access` in the payload, the client is missing the **`roles`** scope — but it is already the default of `listings-api`, so the usual cause is using a **different** client (a public one) that lacks the scope.

---

## Step 3a — Declare a resource server (no behavior change)   CORE

**Outcome** — The TP1 API **declares itself as a Keycloak resource server**
(oauth2-resource-server starter + `issuer-uri`) **without changing any
behavior**: the app still boots on HTTP Basic, all core TP1 checklists still
pass, and the JWKS endpoint is reachable. This is a **checkpoint, not a
migration** — you are only *declaring the capability* for Step 3b.

**Why this step** — Changing a dependency and changing behavior at the same
time makes failures impossible to locate. You first add the capability with
no effect, prove nothing regressed, and switch behavior in Step 3b.

### Build it

**In the TP1 repo (`../springboot`)**:

1. **Add** `spring-boot-starter-oauth2-resource-server` to `pom.xml`.
   → It brings the JWT decoder and the Bearer filter that Step 3b turns on.
2. **Add** to `application.yml`, under
   `spring.security.oauth2.resourceserver.jwt`: `issuer-uri:
   http://localhost:8081/realms/listings` and `audiences: listings-api`.
   → From the issuer, Spring finds the public keys and checks the `iss` claim
   of every token: no decoder to write by hand. Without `audiences`, a token
   issued by the same realm for **another** application would be accepted.
3. **Leave** `SecurityConfig` and all Java classes **unchanged** — the filter
   chain **still runs HTTP Basic**.
   → This is the "no behavior change" part: any regression now comes from
   items 1-2 only.
4. **Rebuild + restart** the app
   (`cd "$TP1_DIR" && mvn clean verify && docker compose up -d --build
   listings-api`) and confirm the baseline is intact.
   → In Docker mode, the new dependency is only in a rebuilt image.

### Expected behavior
- The API **still boots**; the core TP1 checklists (1·2·3·5·6·8) **still pass**
  (no regression).
- `pom.xml` now contains
  `spring-boot-starter-oauth2-resource-server`.
- `application.yml` (or `application-dev.yml`) sets
  `…oauth2.resourceserver.jwt.issuer-uri: http://localhost:8081/realms/listings`
  and `…oauth2.resourceserver.jwt.audiences: listings-api`.
- The JWKS endpoint for that issuer is reachable:
  `GET http://localhost:8081/realms/listings/protocol/openid-connect/certs` →
  **200** with a `keys` array.
- A **Basic-auth** write (`POST /auth/register` then `POST /listings` with
  `Authorization: Basic …`) **still returns `201`** — the behavior is
  intentionally **unchanged**.

### Verify
- [ ] `cd "$TP1_DIR" && docker compose ps` — the app still boots on **8080**; `curl -fsS http://localhost:8080/actuator/health` → 200
- [ ] `grep -q "spring-boot-starter-oauth2-resource-server" "$TP1_DIR/pom.xml"` → yes
- [ ] `grep -E "issuer-uri|audiences" "$TP1_DIR/src/main/resources/application"*.yml` → `http://localhost:8081/realms/listings` and `listings-api`
- [ ] All core TP1 checklists (1·2·3·5·6·8) still pass (`cd "$TP1_DIR" && mvn clean verify`)
- [ ] You can explain *why* the API fetches its public keys from `/protocol/openid-connect/certs` before validating any JWT

### If you are stuck
- Spring Security 7.1 — *OAuth2 Resource Server → JWT*: <https://docs.spring.io/spring-security/reference/7.1/servlet/oauth2/resource-server/jwt.html>.
- The JWKS URL is derived from `issuer-uri`: `{issuer}/protocol/openid-connect/certs`. In Docker mode the API cannot reach `localhost:8081`: the `JWK_SET_URI` env of README §0 points it to `keycloak:8080` instead.
- If the app does not boot after adding the starter, look at the `NoSuchBeanDefinitionException` (or similar) — usually a conflicting `SecurityFilterChain` from TP1. Read the stack trace **before** touching code.

---

## Step 3b — Switch to Bearer, drop the Basic path   CORE

**Outcome** — The TP1 API **verifies Keycloak JWTs** (Bearer) and **stops
using HTTP Basic**: a write with no / bad / forged token → **401**, a write
with a valid `listings` JWT → **201**, and `GET /listings*` stays **public**.
The local `user` table and BCrypt are **no longer on any write path** —
**identity is centralised** and no local password is ever stored.

**Why this step** — The API stops checking passwords and starts checking
**signatures**. It no longer knows who the users are; it trusts any token
signed by the issuer it was configured with, and only that issuer.

### How it fits

```
request ── Authorization: Bearer <jwt> ──> BearerTokenAuthenticationFilter
                                              │
                                              ├─ JwtDecoder (keys from JWKS, Step 3a)
                                              │    signature, iss, exp ok? ── no ──> 401
                                              ▼
                                         authenticated (claims available)
                                              │
                                              ▼
                                   controller ──> service   (unchanged in this step)
```

### Build it

**In the TP1 repo (`../springboot`)** — on top of Step 3a:

1. **Replace** the `httpBasic(...)` clause in `SecurityConfig` with
   `.oauth2ResourceServer(jwt -> …)` on the protected **write** paths.
   → Without it, the Bearer header is ignored and every write is still
   checked as Basic, so a valid token gets a 401. The `seller` role mapping is
   **Step 4's** job: this step only enforces "some valid bearer".
2. **Keep** `pom.xml` (both `spring-boot-starter-security` +
   `spring-boot-starter-oauth2-resource-server`), `application.yml`
   (`issuer-uri`), and the `UserServiceImpl` bean **unchanged** — but make
   sure **no production request path** reads the BCrypt path anymore.
   → The local identity is deleted in Step 5; until then it must not be
   reachable, or a local password could still authenticate someone.
3. **(Optional)** `@Disabled` the TP1 Basic-auth tests
   (`// TP1 Basic-auth tests — see TP2 Step 3b`).
   → They send Basic credentials, which the API now rejects.
4. **Rebuild + restart** (`cd "$TP1_DIR" && docker compose up -d --build
   listings-api`), then obtain a fresh token and exercise the matrix below.
   → Tokens expire within minutes: an old token from Step 2 gives a 401 that
   is not a bug.

### Expected behavior
- A **write** (`POST /listings`, `PUT/DELETE /listings/{id}`) with **no**
  `Authorization` header → **401**.
- A write with a token whose **issuer / audience / signature / expiry** is
  wrong → **401**.
- A write with a **valid `listings` JWT** is **accepted**; the claims
  (`sub`, `realm_access.roles`) are available to the security chain.
- `GET /listings*` **stays public** (no token needed) — **same as TP1**.
- A `GET /listings*` that **carries** an invalid or expired token → **401**:
  a token, when present, is always checked. (A client that sends a stale
  token on a public read gets a 401, not the public answer.)
- A token **without** `aud: listings-api` → **401**.
- The local `user` table and **BCrypt** are **no longer part of any write
  path** (the bean may exist, but **nothing calls it**).

### Verify
- [ ] `POST /listings` **without** Bearer → **401** (not 400, not 500)
- [ ] `POST /listings` with a token of **another realm** (`master`) and with a **tampered** token → **401** ([`docs/verification.md` §7](docs/verification.md))
- [ ] `POST /listings` with the **canonical** token from [`docs/verification.md` §5](docs/verification.md) → **201**
- [ ] `GET /listings` with an invalid token → **401**; without a token → **200**
- [ ] `GET /listings` anonymous → **200** (unchanged)
- [ ] `grep -rn "httpBasic" "$TP1_DIR/src/main/java"` → **no hit** (the production chain no longer uses Basic)
- [ ] (only if you wrote them) the TP1 Basic-auth tests are `@Disabled` (or deleted) — **not** a required part of this step

### If you are stuck
- Spring Security reference — same page as Step 3a.
- In `SecurityConfig`, replace the `httpBasic(...)` clause with `.oauth2ResourceServer(jwt -> jwt.authenticationConverter(…))` — or the default `JwtAuthenticationConverter` + a custom `authoritiesMapper` for the `seller` role (that is **Step 4** territory, not this one).
- The `BCryptPasswordEncoder` bean can stay as a bean (Spring does not use it anymore) or be removed.
- `POST /auth/register` may still answer, or — if you keep TP1's behavior — **400** with a clear *"feature deprecated in TP2 — see Step 5"* message. Do **not** let it hash a password into the `user` table — that would **reintroduce** a local password.
- If you see a `401` with **no** `WWW-Authenticate: Bearer` hint, the `oauth2ResourceServer` config is probably **missing** on that request matcher.

---

## Step 4 — Map claims to authorizations   CORE

**Outcome** — **Authorization follows the identity**: a valid token with the
`seller` role is **allowed to write**, a token without it is **denied**
(`401` no token / `403` wrong role), `GET /listings*` stays **public**, and a
new `GET /auth/whoami` returns the **current claims**. The decision is taken
**from the JWT only** — no local `user` table.

**Why this step** — A valid token proves *who* is calling, not *what* they may
do. Keycloak puts the roles in a claim with its own shape
(`realm_access.roles`); Spring Security expects authorities named `ROLE_…`.
This step is the translation between the two.

### How it fits

```
valid JWT (Step 3b)
   │
   ▼
JwtAuthenticationConverter ── realm_access.roles ["seller"] ──> authorities [ROLE_…]   (item 2)
   │
   ▼
authorizeHttpRequests ── POST/PUT/DELETE /listings needs the role ── missing ──> 403  (item 2)
   │
   ▼
controller ── GET /auth/whoami returns the claims                                      (item 3)
   │
   ▼
service ── owner check: sub == listing.owner_sub                                       (Step 5)
```

### Build it

**In the TP1 repo (`../springboot`)**:

1. **Keep** `GET /listings**` **`permitAll()`** (public reads unchanged).
   → Switching to Bearer must not lock visitors out of browsing.
2. **Require** a valid bearer **plus the `seller` role** on
   `POST/PUT/DELETE /listings`. Map the role from the claim
   (`realm_access.roles`), e.g. a custom `authoritiesMapper`
   on the `.oauth2ResourceServer(jwt -> jwt.authenticationConverter(…))` chain.
   Map each role to `ROLE_` + the role in **upper case** (`seller` →
   `ROLE_SELLER`), so TP1's `hasRole("SELLER")` rules keep working.
   → Spring's default converter reads the `scope` claim only: without the
   mapping, no Keycloak role ever becomes an authority, and every role check
   answers 403. Authority names are case-sensitive: `ROLE_seller` does not
   match `hasRole("SELLER")`.
3. **Expose** `GET /auth/whoami`: return the current claims
   (`sub`, `preferred_username`, `realm_access.roles`); unauthenticated →
   **401**.
   → It shows what the API actually received, which is the fastest way to
   debug a 403.
4. **Rebuild + verify** the full matrix below.

### Expected behavior

**The authorization contract** (the `PUT`/`DELETE` "own vs other" split is
decided by `sub == listing.owner_sub` — that key is **introduced in Step 5**;
this step states the **target** contract):

| Client | GET list | POST | PUT own | PUT other | DELETE own |
|---|---|---|---|---|---|
| **Anonymous** | 200 | 401 | 401 | 401 | 401 |
| **Authenticated, no `seller` role** (`carol`) | 200 | 403 | — | 403 | — |
| **Seller (not owner)** (`bob`) | 200 | 201 | 403 | 403 | 403 |
| **Seller (owner)** (`alice`) | 200 | 201 | 200 | — | 204 |

Plus:
- `GET /listings` and `GET /listings/{id}` stay **public** (no token needed)
  — same as TP1.
- `POST /listings` requires a valid token whose `realm_access.roles` contains
  **`seller`**; otherwise `401` (no token) or `403` (wrong role).
- `GET /auth/whoami` returns the **current claims**; unauthenticated → `401`.
- **No local `user` table** is required — the decision comes **from the JWT
  only**.

### Verify
- [ ] **every row** of the matrix above behaves **exactly** as shown ([`docs/verification.md` §8](docs/verification.md))
- [ ] `carol` `POST /listings` → **403** (authenticated, but no `seller` role)
- [ ] `GET /listings` and `GET /listings/{id}` stay **public** (no token needed)
- [ ] `alice` `GET /auth/whoami` → 200, body has `sub` and `realm_access.roles` containing `seller`
- [ ] unauthenticated `GET /auth/whoami` → **401**

### If you are stuck
- `JwtAuthenticationConverter#setJwtGrantedAuthoritiesConverter` takes a function `Jwt → Collection<GrantedAuthority>`; `jwt.getClaimAsMap("realm_access")` reads the claim.
- `carol`'s token has **no** `realm_access` claim at all: handle `null`, or her requests fail with a 500 instead of a 403.
- The **ownership** rule (`sub == owner_sub`) stays in the **service layer** (exactly as TP1's "owner only" rule), but the comparison key is now the **`sub` claim**, not a local `user` id.

---

## Step 5 — Refactor the data model (drop the local user)   CORE

**Outcome** — The **single source of identity** is Keycloak: `listing` stores
the creator's `sub` as **`owner_sub`** (instead of a local `user_id`), the
whole local identity (`user` table, `User` entity, `UserRepository`,
`UserService`, `/auth/register`) is **deleted**, ownership is
`bearer.sub == listing.owner_sub`, and **all TP1 business rules still hold**
(verified by `curl`).

**Why this step** — Two sources of identity drift apart: a user deleted in
Keycloak would still own listings through a local row. Once Keycloak is the
only source, the API stores a **reference** to the user (`sub`), never a
copy.

### How it fits

```
POST /listings (Bearer, Steps 3b-4)
   │
   ▼
controller ── reads jwt.sub ──> service ── create: owner_sub = sub            (group B)
                                       └── PUT/DELETE: sub == owner_sub ?     (group B)
                                              │
                                              ▼
                                   listing.owner_sub (new column)             (group A)

User, UserRepository, UserService, /auth/register, /auth/me ──> deleted   (group C)
(the app_user table stays, unused)
```

### Build it

**A. Storage**

1. **Add** a Liquibase changeSet (e.g. `v1.2-owner-sub.yaml`) on `listing`:
   `addColumn` `owner_sub` (VARCHAR 255, **nullable**) and
   `dropNotNullConstraint` on `user_id`. Do **not** drop `user_id` or
   `app_user` (a cleanup changeSet is optional / bonus). Include it in
   `db.changelog-master.yaml`.
   → `owner_sub` is where the new owner key lives; nullable, because
   listings created in TP1 have no `sub`. TP1 made `user_id` `NOT NULL`: a
   listing created by a Keycloak user has no local user id, so without
   relaxing the constraint every insert fails.

> **Checkpoint** — the app boots and `psql` `\d listing` shows `owner_sub`.

**B. Ownership by `sub`**

2. **Change** the ownership key: on **create**, set `owner_sub` from the
   bearer's **`sub`** claim; on **PUT/DELETE**, ownership means
   `bearer.sub == listing.owner_sub`.
   → The local user id no longer exists for a Keycloak user: without this
   change, the TP1 owner check compares against nothing and fails for
   everyone.

**C. Remove the local identity**

3. **Delete** the local identity from the TP1 code: the `User` entity, the
   `owner` relation of `Listing`, `UserRepository`, `UserService`, the TP1
   `AuthController` (`/auth/register`, `/auth/me`), and the
   `UserDetailsService` / `DaoAuthenticationProvider` / `PasswordEncoder`
   beans of `SecurityConfig` (**deleted, not just un-referenced**). Keep
   `/auth/whoami` (Step 4).
   → Code that is only un-referenced can be wired back by mistake; deleted
   code cannot reintroduce a local password. The `SecurityConfig` beans
   depend on `UserService`: the app does not start until they go too.
4. **Add** to `GlobalExceptionHandler` a **404** handler for
   `NoResourceFoundException`.
   → A request to a deleted endpoint raises it; without a handler, TP1's
   catch-all turns it into a 500.
5. **Rebuild + verify** the whole TP1 rule-set by `curl`
   (the TP1 Java tests used Basic auth and **do not apply** after Step 3b).
   → Deleting the identity layer touches the service and the controller:
   the TP1 rules (CRUD, V1/V2, metrics) are what could break.

### Expected behavior
- `listing` stores **`owner_sub`** = the `sub` claim of the creator.
- The local identity **code** (`User`, `UserRepository`, `UserService`,
  `/auth/register`, `/auth/me`) is **gone**; the `app_user` table stays in the
  database, unused (no destructive migration).
- On **create**, `owner_sub` = bearer's `sub`; on **PUT/DELETE**, ownership =
  `bearer.sub == listing.owner_sub`.
- The **TP1 business rules** — CRUD, V1/V2, versioning, metrics, ownership —
  **still behave as before** (verify by `curl`).

### Verify
- [ ] `grep -rnE "class User\b|UserRepository|UserService|PasswordEncoder" "$TP1_DIR/src/main/java"` → **no hit** ([`docs/verification.md` §9](docs/verification.md))
- [ ] `POST /auth/register` → **404** with a JSON body (the endpoint is gone)
- [ ] a created listing has `owner_sub` set to the creator's `sub` and `user_id` `NULL` (`psql`)
- [ ] `PUT/DELETE` by the creator → 200/204; by another seller (different `sub`) → **403**
- [ ] the **TP1 business rules** still hold (via `curl`): CRUD happy paths, V2 non-seller field hiding, `?version=` V1/V2 fallback, the `listings.created` counter
- [ ] `cd "$TP1_DIR" && mvn clean verify` → **green** (the TP1 starter smoke test does not need the Keycloak stack)

### If you are stuck
- Liquibase change types: `addColumn`, `dropNotNullConstraint` (with `columnDataType: BIGINT`). Do **not** run a `dropColumn` on `user_id` or a `dropTable` on `app_user` in the core: data in production is removed in a separate, later migration, once nothing reads it.
- `mvn clean verify` is your **final net** — the TP1 starter smoke test does **not** need Keycloak; any optional tests that hit Keycloak are **not** part of the core checklist.

---

## Step 6 — 401 / 403 contracts   BONUS

**Outcome** — As an **API client**, you get a **clear `401`** (no/bad token)
*and* a **clear `403`** (right user, wrong role), both with a consistent
**`WWW-Authenticate: Bearer realm="listings"`** hint on 401 — so your client
can **react** (re-login, or "you cannot").

**Why this step** — A client must tell "log in again" (401) from "you are
logged in but not allowed" (403) without parsing a message. The status code
and the `WWW-Authenticate` header are that machine-readable signal.

> **Not to be confused with Step 4.** Step 4 decides **who can do what** —
> that decision is unchanged here. Step 6 is only about **how a refusal is
> phrased** as an HTTP response: the status code, the body shape, and the
> `WWW-Authenticate` header on 401. It **adds exactly one** requirement on top
> of Step 4: a protected write that returns **401** (missing/invalid/expired
> token) must **also** carry
> `WWW-Authenticate: Bearer realm="listings"` so a well-behaved client knows
> *where* to log in.

### Build it

**In the TP1 repo (`../springboot`)**:

1. **Set the `WWW-Authenticate` response header** and a JSON body on 401, in
   `SecurityConfig`, through the resource server's `authenticationEntryPoint`.
   → By default the 401 has an **empty body** and a `WWW-Authenticate: Bearer …`
   header **without** `realm`: the client cannot tell where to obtain a token,
   and gets no JSON error.
2. **Set** an `accessDeniedHandler` that writes TP1's JSON body shape
   (`status`/`timestamp`/`error`/`message`) for the role 403.
   → A 403 from the security chain (no `seller` role) has an empty body by
   default; the 403 from the service (not owner) goes through
   `GlobalExceptionHandler`. A client expects one shape.
3. **Rebuild + verify** that 401, 403, and the public-read path all behave.
   → `SecurityConfig` is shared by every path: a change for the 401 must
   leave public reads and the Step 4 matrix as they were.

### Expected behavior
- A **401** on a protected write carries **both** the JSON error body **and**
  the header `WWW-Authenticate: Bearer realm="listings"`.
- A **403** (valid bearer, but no `seller` role / not the owner) uses the
  **same JSON body shape** as TP1.
- A **public read** (`GET /listings`) without a token still returns **200** —
  Step 6 must not break public reads.
- **404 / 409 / 422** keep **exactly** the TP1 JSON body shape.
- The full status-code matrix is the **Step 4** matrix — Step 6 only changes
  *how* the 401 is phrased (the `WWW-Authenticate` header).

### Verify
- [ ] a `401` on a protected write carries `WWW-Authenticate: Bearer realm="listings" ...`
- [ ] a `403` for a valid-but-unauthorised seller (wrong role / not owner) → TP1 JSON shape
- [ ] anonymous reads remain **200**

### If you are stuck
- `BearerTokenAuthenticationEntryPoint#setRealmName("listings")` adds the `realm` parameter; wrap it (or delegate to it) to also write the JSON body.
- `403` "not owner" comes from the **service layer**; `403` "no `seller` role" comes from `SecurityConfig` (its body is written by the `accessDeniedHandler`, not by `@ControllerAdvice`).
- Test the role 403 with `carol`, the owner 403 with `bob`.

---

## Step 7 — SPA wired to Keycloak   BONUS

**Outcome** — As an **end user**, you can **log in through Keycloak** in a
small web app and **list / create listings** **without typing JWTs by hand** —
the real-user flow, end to end.

**Why this step** — The password grant of Step 2 is for scripts. A browser
application never sees the user's password: it redirects to Keycloak and
receives a token back (authorization code + PKCE). This is the flow real users
go through.

### How it fits

```
browser (SPA, public client listings-spa)
   │ 1. keycloak.init -> redirect to Keycloak login page
   ▼
Keycloak :8081 ── 2. alice logs in ── 3. redirect back with a code
   │
   ▼
SPA ── 4. code + PKCE verifier -> token (keycloak-js does it)
   │
   └── 5. fetch http://localhost:8080/listings with Authorization: Bearer <jwt>
```

### Build it

> A **starter** is provided in `spa/` (keycloak-js + `fetch`) — see
> `spa/README-spa.md`. This step re-uses the public client **`listings-spa`**
> and the **code flow + PKCE** (different from the confidential `listings-api`
> used by scripts in Step 2).

1. **Enable CORS** on the TP1 API for the origin `http://localhost:3000`
   (methods `GET`, `POST`, `PUT`, `DELETE`; header `Authorization`,
   `Content-Type`) in `SecurityConfig`.
   → The SPA (`:3000`) and the API (`:8080`) are two origins: without CORS,
   the browser blocks every API call before your code sees it, even with a
   valid token.
2. **Read** the starter in `spa/` (`spa/README-spa.md`): `auth.js` imports
   `keycloak-js` 26 from a CDN and runs the code flow + PKCE with the public
   client `listings-spa`; `api.js` adds the Bearer header.
   → A public client cannot keep a secret (its code runs in the browser);
   PKCE is what replaces the secret.
3. **Serve + open** the SPA, **log in** as `alice` / `secret` (redirect flow).
   → The login page is Keycloak's, not yours: the SPA never handles the
   password.
4. **List** the listings with the `seller` token and **create** one; then
   **log out** and confirm the session is cleared.
   → The same API, the same rules as with `curl`: only the way the token is
   obtained has changed.

### Expected behavior
- **Login** as `alice` / `secret` works (redirect flow, code + PKCE).
- The **listing list loads** with the `seller` token (the API returns 200/201).
- **Logout clears the session**.

### Verify
- [ ] from the SPA, login as `alice` / `secret` (redirect flow)
- [ ] the listing list loads with the `seller` token (the API returns 200/201)
- [ ] logout clears the session

### If you are stuck
- A `CORS` error in the browser console (not an HTTP status) means item 1 is missing: `http.cors(…)` + a `CorsConfigurationSource` bean. With `cors(withDefaults())`, Spring Security only picks the bean named **`corsConfigurationSource`**: under another name, the preflight answers 200 **without** any `Access-Control-*` header. Reference: <https://docs.spring.io/spring-security/reference/7.1/servlet/integrations/cors.html>
- `Invalid parameter: redirect_uri` on the Keycloak page: the SPA is not served from `http://localhost:3000` (or `:5500`), the origins allowed in `realm.json`.
- keycloak-js reference: <https://www.keycloak.org/securing-apps/javascript-adapter>

---

## Step 8 — Beyond the token: an authenticator and a step-up authentication flow   BONUS

**Outcome** — You **add a second factor (WebAuthn / passkey)** and **rework the
login flow itself** **purely in Keycloak**: a normal login asks for the
password (`acr: "silver"`); a client that asks for more (`acr_values=gold`)
gets a WebAuthn step on top (`acr: "gold"`). Users without an authenticator
still log in at the first level. No Java: the admin console, then an export of
the realm.

**Why this step** — Centralising identity means a security policy (MFA,
passkeys) changes in one place, for every application, with no code change in
the API. The token tells the API *how strongly* the user logged in, so an API
can demand a stronger login for a sensitive action by reading one claim.

### How it fits

```
authorization request (acr_values absent, or =gold)
   │
   ▼
browser flow "browser-stepup" (bound as the realm browser flow)
   ├─ Cookie                                     ALTERNATIVE  (SSO session, if its level is enough)
   └─ forms                                      ALTERNATIVE
        ├─ loa1                                  CONDITIONAL
        │    ├─ Condition - Level of Authentication (level 1)   REQUIRED
        │    └─ Username Password Form                          REQUIRED
        └─ loa2                                  CONDITIONAL
             ├─ Condition - Level of Authentication (level 2)   REQUIRED
             └─ WebAuthn Authenticator                          REQUIRED
   │
   ▼
token: acr = name mapped to the level reached ("silver" = 1, "gold" = 2)
```

### Build it

In the admin console of the realm `listings` (no Java):

1. **Map** ACR names to levels — *Realm settings → General → ACR to LoA
   Mapping*: `silver` → `1`, `gold` → `2`.
   → Without the mapping, `acr` stays a bare number and a client cannot ask
   for a level by name.
2. **Create** the flow `browser-stepup` with the structure of the diagram: a
   `Cookie` alternative and a `forms` sub-flow holding two conditional
   sub-flows, `loa1` (password) and `loa2` (WebAuthn), each guarded by a
   *Condition - Level of Authentication* (level 1, then level 2; max age `0`
   for level 2).
   → The conditions make the WebAuthn step run **only** when level 2 is
   requested: a normal login stays password-only, and users without an
   authenticator are not locked out.
3. **Bind** `browser-stepup` as the realm's **browser flow**.
   → The password grant used by scripts goes through the *direct grant* flow,
   not the browser flow: `curl` tokens of Steps 2-6 are not affected.
4. **Register** a WebAuthn authenticator for `alice`: set the required action
   *Webauthn Register* on her account, then log in once (SPA or account
   console).
   → The level 2 step needs a credential to check; the required action makes
   Keycloak ask for it right after the password.
5. **Request** level 2: log in with `acr_values=gold` in the authorization
   request, and read `acr` in the token.
   → This is how a client asks for a stronger login; the API only reads the
   resulting claim.
6. **Export** the realm and **re-import** it on a fresh stack (Appendix C).
   → A policy clicked in a console disappears with `docker compose down -v`;
   exported, it is versioned with the code.

### Expected behavior
- With the mapping configured, a password login gives `acr: "silver"`
  (before the mapping, the same login gave `acr: "1"`).
- A login with `acr_values=gold` asks `alice` for her WebAuthn authenticator
  **after** the password (or after the SSO cookie, which only proves level 1)
  and gives `acr: "gold"`.
- `bob` (no authenticator) still logs in normally, `acr: "silver"`.
- Tokens obtained with the password grant (`curl`, Steps 2-6) are unchanged.
- After `docker compose down -v` and the re-import of Appendix C, the flow,
  the mapping, and `alice`'s WebAuthn credential are back.
- No change in the Java code.

### Verify
- [ ] Admin console: the realm browser flow is `browser-stepup`; *ACR to LoA Mapping* has `silver` = 1 and `gold` = 2
- [ ] `alice` registers an authenticator; her credentials list `password` and `webauthn` (admin console → Users → alice → Credentials)
- [ ] Login without `acr_values` → token `acr: "silver"`; login with `acr_values=gold` → WebAuthn prompt, token `acr: "gold"`
- [ ] `bob` logs in without any authenticator → `acr: "silver"`
- [ ] Appendix C: export, `docker compose down -v`, re-import → the realm browser flow is `browser-stepup` again

### If you are stuck
- Keycloak's step-up guide (the structure above follows it): <https://www.keycloak.org/docs/latest/server_admin/index.html#_step-up-flow>
- `acr` (Authentication Context Class Reference) is the OIDC claim describing *how strongly* the subject was authenticated; `acr_values` (or the `claims` parameter) is how a client requests a level. keycloak-js passes it with `kc.login({ acr: { values: ["gold"], essential: true } })`.
- WebAuthn needs a secure context: `http://localhost` qualifies, a LAN IP over plain HTTP does not.
- A test browser without a security key: Chrome DevTools → *More tools → WebAuthn* → enable a virtual authenticator.
- (Out of scope, "to go further"): a **custom authenticator Provider** in Java imported into Keycloak — mention it, do **not** build it in this TP.

---

## Bonus (start only when the core `Verify` sections are green)

- **Refresh**: the SPA / client renews the access token with the
  `refresh_token` before it expires.
- **Multi-client**: one identity realm serves both `listings-api` (script)
  and `listings-spa` (browser) — keep both working from the same realm.
- **Logout**: front-channel logout + Keycloak session invalidation.
- **Admin role**: a user with the realm `admin` sees a `GET /listings` count
  or other admin-only endpoint; a seller does not (403).
- **Introspection**: the API validates a token via the OIDC **introspection
  endpoint** instead of (or in addition to) local JWT verification.

---

## Step 9 — Final Integration   DELIVERY

**Outcome** — The whole stack boots clean from **your own configs**; the
realm `listings` is present, the **TP1 Java is green**, the **local `user`
table / BCrypt / `/auth/register` are no longer used**, no `TODO` or stubs
remain in production code, the team README documents the choices, and you can
**walk one token → JWT → authorization decision** in the oral.

**Why this step** — The evaluator runs your stack in your place. This step
proves it starts from your configuration alone, and that you can explain each
decision the API takes on a token.

### Final checks
- [ ] `cd "$KC_DIR" && docker compose up -d` → Keycloak + Postgres **healthy**; the realm `listings` is present
- [ ] `cd "$TP1_DIR" && mvn clean verify` → **green** (the starter smoke test passes; any optional tests that require Keycloak are **not** part of the core delivery)
- [ ] The team **README** documents: how to start the stack, how to get a token, the 401/403 contracts, the claims used, and your technical choices (add the bonus authentication flow **only if you built it**)
- [ ] The local identity code / BCrypt / `/auth/register` are **gone** (Step 5 `grep`)
- [ ] No `TODO` / stubs remain in production code (if you wrote tests, they pass — optional)
- [ ] **Oral** (10 min + 5 Q&A): walk one OAuth2/OIDC flow, JWT verification, ownership via `sub` (demo the bonus authentication flow if you built it)

### If you are stuck
- The **team README** is where you write *what* you decided and *why* — it is **not** a copy of this exercise statement. It is what the evaluator reuses to **run the stack in your place** and **trust the output**.
- The **smoke bar** is `mvn clean verify` green — the TP1 starter smoke test does **not** require the Keycloak stack, and none of the optional tests you may have written that do is part of the core checklist.

---

## Deliverables

| Item | Detail |
|---|---|
| Git repository (pair) | TP1 repo modified + this keycloak folder, clean history |
| `docker compose up` | Keycloak + Postgres healthy, realm imported |
| `mvn clean verify` (TP1) | green (starter smoke test does not need Keycloak) |
| README.md | stack run, token, 401/403, claims, choices |

---

## Appendix A - OIDC / JWT quick reference

(See “Before you start” above for the full protocol / token recap.)
The one fact that matters for the code: **`sub` replaces the local `user`** —
store it as `owner_sub`, and the API never stores any secret (it verifies with
the public key from the JWKS endpoint).

## Appendix B - Useful endpoints (realm `listings`)

All endpoints (metadata, token, JWKS, admin & account consoles) are listed in
[`docs/verification.md` §3](docs/verification.md).

## Appendix C - Export / import a realm (Step 8, reproducible config — only if doing Step 8)

The Step 8 flow is built in the admin console. To make it **reproducible from
code**, export the full realm with `kc.sh` and commit the JSON in a folder
**outside** `realm/`.

> **Why not the admin console export or the admin API?** *Realm settings →
> Action → Partial export* (and its REST equivalent) masks client secrets
> (`**********`) and leaves out users and their credentials; `GET
> /admin/realms/listings` does not even contain the flows. Only `kc.sh export`
> writes the whole policy, users included.
>
> **Why outside `realm/`?** `realm/` is the import folder: on a fresh start
> Keycloak imports every JSON file in it, and two files for the same realm
> conflict.

```bash
cd "$KC_DIR"
mkdir -p realm-export

# 1) export (the running server is not stopped; the extra flag only moves the
#    export process's own management port away from 9000, which is in use)
docker compose exec keycloak /opt/keycloak/bin/kc.sh export \
  --file /tmp/listings-step8.json --realm listings --users same_file \
  --http-management-port 9100
docker compose cp keycloak:/tmp/listings-step8.json realm-export/listings-step8.json

# 2) re-import on a fresh stack
docker compose down -v && docker compose up -d       # base realm.json is imported
# wait for: curl -fsS http://localhost:9001/health/ready
docker compose cp realm-export/listings-step8.json keycloak:/tmp/listings-step8.json
docker compose exec keycloak /opt/keycloak/bin/kc.sh import \
  --file /tmp/listings-step8.json --override true --http-management-port 9100
docker compose restart keycloak                       # reload the imported realm
```

> The export serializes the **flows** (`browser-stepup`, `loa1`, `loa2`, …),
> their **conditions** and configurations, the **ACR to LoA mapping**, and the
> users' **credentials** (including `alice`'s WebAuthn key) — the whole
> authentication policy as data.
