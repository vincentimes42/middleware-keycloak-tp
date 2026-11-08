# TP Keycloak — Progressive Implementation (8h)

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
 > it first (it is an independent 8h TP) before starting this one.
>
> This TP only changes **who the user is** and how the API verifies them.

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
| **User** | `alice`, `bob` — each with a realm role (`seller`) |

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
| **Core** (required — must fit in the 8h) | 1 · 2 · 3a · 3b · 4 · 5 |
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
- The audience is `listings-api` (the confidential client).
- `GET /listings*` stays **public** (same as TP1). Writes require a valid
  token whose `realm_access.roles` contains `seller`.
- Error JSON shape is the same as TP1 (timestamp/status/error/message/fields).

---

## Error handling & status codes (cross-cutting)

| Status | Trigger | Mechanism |
|---|---|---|
| 400 | Malformed request body | Spring |
| 401 | No token, or invalid / expired / bad signature / bad issuer / wrong audience | Spring Security — `WWW-Authenticate: Bearer realm="listings"` |
| 403 | Valid token but role is not `seller` (e.g. the token is a visitor) | Spring Security `hasRole("SELLER")` |
| 404 | Unknown listing, or `active=false` for a non-owner | service layer (`ResourceNotFoundException`) |
| 409 | (unchanged from TP1) duplicate business resource | service layer |
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

### Build it
> **Pre-req** — the TP1 base is up on `8080` (TP1's `docker compose up`),
> and the one required base edit (issuer + JWKS env) from **README → Run §0**
> is applied.

1. **Start** the identity stack in this repo:
   `cd "$KC_DIR" && docker compose up -d`.
2. **Wait** for `keycloak` + `keycloak-postgres` to become **healthy**
   (`docker compose -f <compose> logs -f keycloak` to watch the realm import).
3. **Verify** the realm, the OIDC metadata, and the consoles (the Verify list).

### Expected behavior
- `docker compose ps` shows `keycloak` and `keycloak-postgres` **healthy**;
  `listings-api` (base) is `Up` on `8080`.
- The realm **`listings`** exists (imported automatically from
  `realm/realm.json`).
- OIDC metadata
  `GET /realms/listings/.well-known/openid-configuration` → **200** with
  `issuer = http://localhost:8081/realms/listings`.
- Public endpoints reachable: **JWKS**, the **account** console, the **admin**
  console.

### Verify
- [ ] `cd "$KC_DIR" && docker compose ps` shows `keycloak` and `keycloak-postgres` **healthy**; `cd "$TP1_DIR" && docker compose ps` shows `listings-api` `Up` on 8080
- [ ] `curl -fsS http://localhost:8081/realms/listings/.well-known/openid-configuration` → 200, `issuer` matches
- [ ] the list of realms (admin API) includes `listings`
- [ ] you can log in as `alice` / `secret` on the account console

### If you are stuck
- Start from **README → Run**, then wait for `docker compose ps` to show both `keycloak` and `keycloak-postgres` healthy (`docker compose logs -f keycloak` to watch startup + import).
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

### Build it
> This step is **read-only**: you **run the `curl`s** (no code, no config).
> The canonical commands are in [`docs/verification.md` §5 / §6](docs/verification.md).

1. **Obtain** an access token for `alice` using the confidential client
   `listings-api` (secret `listings-api-secret`) with the **password grant**.
2. **Decode** the `access_token` (base64url one-liner) and **read** the
   payload claims.
3. **Confirm** the `refresh_token` is returned (the client can renew without
   re-authenticating).
4. **Read** the JWKS endpoint and confirm it serves the RS256 public key(s).
5. **Try a bad password** and confirm it returns `400 invalid_grant`.

### Expected behavior
- The token **payload** carries: `iss` (= `http://localhost:8081/realms/listings`),
  `sub` (a stable UUID), `azp` (= `listings-api`), `preferred_username`, and
  `realm_access.roles` **containing `seller`**.
- A **`refresh_token`** is present (used to renew the access token).
- The **JWKS** endpoint serves the **public key(s)** that verify the signature
  (RS256) — this is what the API will use in Step 3b.
- `basic` and `roles` are already the **default client scopes** of
  `listings-api`, so a plain request already gets `sub` + `realm_access`.

### Verify
- [ ] [`docs/verification.md` §5](docs/verification.md) (Obtain a token) + [§6](docs/verification.md) (Read the JWT) both pass: `access_token` + `refresh_token` present; payload has `iss`, `sub`, `azp=listings-api`, `realm_access.roles ⊇ ["seller"]`; JWKS has a `keys` array (RS256)
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

### Build it
**In the TP1 repo (`../springboot`)**:
1. **Add** `spring-boot-starter-oauth2-resource-server` to `pom.xml`.
2. **Add** `spring.security.oauth2.resourceserver.jwt.issuer-uri:
   http://localhost:8081/realms/listings` to `application.yml`.
3. **Leave** `SecurityConfig` and all Java classes **unchanged** — the filter
   chain **still runs HTTP Basic**. (This is the "no behavior change" part.)
4. **Rebuild + restart** the app
   (`cd "$TP1_DIR" && mvn clean verify && docker compose up -d --build
   listings-api`) and confirm the baseline is intact.

### Expected behavior
- The API **still boots**; the core TP1 checklists (1·2·3·5·6·8) **still pass**
  (no regression).
- `pom.xml` now contains
  `spring-boot-starter-oauth2-resource-server`.
- `application.yml` (or `application-dev.yml`) sets
  `…oauth2.resourceserver.jwt.issuer-uri: http://localhost:8081/realms/listings`.
- The JWKS endpoint for that issuer is reachable:
  `GET http://localhost:8081/realms/listings/protocol/openid-connect/certs` →
  **200** with a `keys` array.
- A **Basic-auth** write (`POST /auth/register` then `POST /listings` with
  `Authorization: Basic …`) **still returns `201`** — the behavior is
  intentionally **unchanged**.

### Verify
- [ ] `cd "$TP1_DIR" && docker compose ps` — the app still boots on **8080**; `curl -fsS http://localhost:8080/actuator/health` → 200
- [ ] `grep -q "spring-boot-starter-oauth2-resource-server" "$TP1_DIR/pom.xml"` → yes
- [ ] `grep -E "issuer-uri" "$TP1_DIR/src/main/resources/application"*.yml` → value matches `http://localhost:8081/realms/listings`
- [ ] All core TP1 checklists (1·2·3·5·6·8) still pass (`cd "$TP1_DIR" && mvn clean verify`)
- [ ] You can explain *why* the API fetches its public keys from `/protocol/openid-connect/certs` before validating any JWT

### If you are stuck
- Spring Security — *OAuth2 Resource Server → JWT*: <https://docs.spring.io/spring-security/reference/servlet/oauth2/web/jwt.html>.
- `issuer-uri` is the **single** Spring config that lets a `JwtDecoder` auto-discover the **JWKS** endpoint — you do **not** build the decoder by hand.
- The JWKS URL is derived from `issuer-uri`: `{issuer}/protocol/openid-connect/certs`. Verify it returns a JSON `keys` array **before** you rely on it in Step 3b.
- If the app does not boot after adding the starter, look at the `NoSuchBeanDefinitionException` (or similar) — usually a conflicting `SecurityFilterChain` from TP1. Read the stack trace **before** touching code.

---

## Step 3b — Switch to Bearer, drop the Basic path   CORE

**Outcome** — The TP1 API **verifies Keycloak JWTs** (Bearer) and **stops
using HTTP Basic**: a write with no / bad / forged token → **401**, a write
with a valid `listings` JWT → **201**, and `GET /listings*` stays **public**.
The local `user` table and BCrypt are **no longer on any write path** —
**identity is centralised** and no local password is ever stored.

### Build it
**In the TP1 repo (`../springboot`)** — on top of Step 3a:
1. **Replace** the `httpBasic(...)` clause in `SecurityConfig` with
   `.oauth2ResourceServer(jwt -> …)` on the protected **write** paths. (The
   `seller` role mapping is **Step 4's** job — this step only enforces
   "some valid bearer".)
2. **Keep** `pom.xml` (both `spring-boot-starter-security` +
   `spring-boot-starter-oauth2-resource-server`), `application.yml`
   (`issuer-uri`), and the `UserServiceImpl` bean **unchanged** — but make
   sure **no production request path** reads the BCrypt path anymore.
3. **(Optional)** `@Disabled` the TP1 Basic-auth tests
   (`// TP1 Basic-auth tests — see TP2 Step 3b`).
4. **Rebuild + restart** (`cd "$TP1_DIR" && docker compose up -d --build
   listings-api`), then obtain a fresh token and exercise the matrix below.

### Expected behavior
- A **write** (`POST /listings`, `PUT/DELETE /listings/{id}`) with **no**
  `Authorization` header → **401**.
- A write with a token whose **issuer / audience / signature / expiry** is
  wrong → **401**.
- A write with a **valid `listings` JWT** is **accepted**; the claims
  (`sub`, `realm_access.roles`) are available to the security chain.
- `GET /listings*` **stays public** (no token needed) — **same as TP1**.
- The local `user` table and **BCrypt** are **no longer part of any write
  path** (the bean may exist, but **nothing calls it**).

### Verify
- [ ] `POST /listings` **without** Bearer → **401** (not 400, not 500)
- [ ] `POST /listings` with a **forged** token (e.g. `iss` from a different realm) → **401**
- [ ] `POST /listings` with the **canonical** token from [`docs/verification.md` §5](docs/verification.md) → **201**
- [ ] `GET /listings` anonymous → **200** (unchanged)
- [ ] `grep -rE "httpBasic|@WithMockUser" "$TP1_DIR/src/main/java"` → **no hit** (the production chain no longer uses Basic)
- [ ] (only if you wrote them) the TP1 Basic-auth tests are `@Disabled` (or deleted) — **not** a required part of this step

### If you are stuck
- Spring Security reference — same page as Step 3a.
- In `SecurityConfig`, replace the `httpBasic(...)` clause with `.oauth2ResourceServer(jwt -> jwt.authenticationConverter(…))` — or the default `JwtAuthenticationConverter` + a custom `authoritiesMapper` for the `seller` role (that is **Step 4** territory, not this one).
- The `BCryptPasswordEncoder` bean can stay as a bean (Spring does not use it anymore) or be removed — **but** make sure no production path reads it.
- A useful test: `POST /auth/register` may still **200**, or — if you keep TP1's behavior — **400** with a clear *"feature deprecated in TP2 — see Step 5"* message. Do **not** let it hash a password into the `user` table — that would **reintroduce** a local password.
- If you see a `401` with **no** `WWW-Authenticate: Bearer` hint, the `oauth2ResourceServer` config is probably **missing** on that request matcher.

---

## Step 4 — Map claims to authorizations   CORE

**Outcome** — **Authorization follows the identity**: a valid token with the
`seller` role is **allowed to write**, a token without it is **denied**
(`401` no token / `403` wrong role), `GET /listings*` stays **public**, and a
new `GET /auth/whoami` returns the **current claims**. The decision is taken
**from the JWT only** — no local `user` table.

### Build it
**In the TP1 repo (`../springboot`)**:
1. **Keep** `GET /listings**` **`permitAll()`** (public reads unchanged).
2. **Require** a valid bearer **plus the `seller` role** on
   `POST/PUT/DELETE /listings`. Map the role from the claim
   (`realm_access.roles` → `ROLE_seller`), e.g. a custom `authoritiesMapper`
   on the `.oauth2ResourceServer(jwt -> jwt.authenticationConverter(…))` chain.
3. **Expose** `GET /auth/whoami`: return the current claims
   (`sub`, `preferred_username`, `realm_access.roles`); unauthenticated →
   **401**.
4. **Rebuild + verify** the full matrix below.

### Expected behavior

**The authorization contract** (the `PUT`/`DELETE` "own vs other" split is
decided by `sub == listing.owner_sub` — that key is **introduced in Step 5**;
this step states the **target** contract):

| Client | GET list | POST | PUT own | PUT other | DELETE own |
|---|---|---|---|---|---|
| **Anonymous** | 200 | 401 | 401 | 401 | 401 |
| **Seller (not owner)** | 200 | 201 | 403 | 403 | 403 |
| **Seller (owner)** | 200 | 201 | 200 | — | 204 |

Plus:
- `GET /listings` and `GET /listings/{id}` stay **public** (no token needed)
  — same as TP1.
- `POST /listings` requires a valid token whose `realm_access.roles` contains
  **`seller`**; otherwise `401` (no token) or `403` (wrong role).
- `GET /auth/whoami` returns the **current claims**; unauthenticated → `401`.
- **No local `user` table** is required — the decision comes **from the JWT
  only**.

### Verify
- [ ] **every row** of the matrix above behaves **exactly** as shown
- [ ] `GET /listings` and `GET /listings/{id}` stay **public** (no token needed)
- [ ] `alice` `GET /auth/whoami` → 200, body has `sub` and `realm_access.roles` containing `seller`
- [ ] unauthenticated `GET /auth/whoami` → **401**

### If you are stuck
- In `SecurityConfig`: keep `GET /listings**` `permitAll()`; require `authenticated()` + a role matcher on `POST/PUT/DELETE`. The role name maps **from the claim** (`realm_access.roles` → `ROLE_seller`).
- The **ownership** rule (`sub == owner_sub`) stays in the **service layer** (exactly as TP1's "owner only" rule), but the comparison key is now the **`sub` claim**, not a local `user` id.

---

## Step 5 — Refactor the data model (drop the local user)   CORE

**Outcome** — The **single source of identity** is Keycloak: `listing` stores
the creator's `sub` as **`owner_sub`** (instead of a local `user_id`), the
whole local identity (`user` table, `User` entity, `UserRepository`,
`UserService`, `/auth/register`) is **deleted**, ownership is
`bearer.sub == listing.owner_sub`, and **all TP1 business rules still hold**
(verified by `curl`).

### Build it
**In the TP1 repo (`../springboot`)**:
1. **Add** a Liquibase changeSet (e.g. `v1.3-owner-sub.yaml`) that does
   `addColumn` on `listing`: `owner_sub` (string, **nullable**) —
   **additive only**. Do **not** destructively drop `user_id` (the core TP1
   tests must stay green; a cleanup changeSet is optional / bonus). Include it
   in `db.changelog-master.yaml`.
2. **Change** the ownership key: on **create**, set `owner_sub` from the
   bearer's **`sub`** claim; on **PUT/DELETE**, ownership means
   `bearer.sub == listing.owner_sub` (the service-layer "owner only" rule now
   compares `sub`, not a local user id).
3. **Delete** the local identity from the TP1: the `user` table, `User`
   entity, `UserRepository`, `UserService`, and `/auth/register`
   (**deleted, not just un-referenced**).
4. **Rebuild + verify** the whole TP1 rule-set by `curl`
   (the TP1 Java tests used Basic auth and **do not apply** after Step 3b).

### Expected behavior
- `listing` stores **`owner_sub`** = the `sub` claim of the creator.
- The local `user` table / `User` entity / `UserRepository` / `UserService` /
  `/auth/register` are **gone**.
- On **create**, `owner_sub` = bearer's `sub`; on **PUT/DELETE**, ownership =
  `bearer.sub == listing.owner_sub`.
- The **TP1 business rules** — CRUD, V1/V2, versioning, metrics, ownership —
  **still behave as before** (verify by `curl`).

### Verify
- [ ] `user` table / `User` entity / `UserRepository` / `UserService` / `/auth/register` are **gone** (deleted, not just un-referenced)
- [ ] `POST /auth/register` → **405** or **410** (the endpoint is gone)
- [ ] a created listing has `owner_sub` set to the creator's `sub`
- [ ] `PUT/DELETE` by the creator → 200/204; by another seller (different `sub`) → **403**
- [ ] the **TP1 business rules** still hold (via `curl`): CRUD happy paths, V2 non-seller field hiding, `?version=` V1/V2 fallback, the `listings.created` counter
- [ ] `cd "$TP1_DIR" && mvn clean verify` → **green** (the TP1 starter smoke test does not need the Keycloak stack)

### If you are stuck
- The Liquibase changeSet is **additive**: one `addColumn listing owner_sub VARCHAR(255) NULL`. Do **not** run a `dropColumn` on `user_id` unless you also have a cleanup changeSet (and you have verified the DB migration).
- `mvn clean verify` is your **final net** — the TP1 starter smoke test does **not** need Keycloak; any optional tests that hit Keycloak are **not** part of the core checklist.

---

## Step 6 — 401 / 403 contracts   BONUS

**Outcome** — As an **API client**, you get a **clear `401`** (no/bad token)
*and* a **clear `403`** (right user, wrong role), both with a consistent
**`WWW-Authenticate: Bearer realm="listings"`** hint on 401 — so your client
can **react** (re-login, or "you cannot").

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
1. **Set the `WWW-Authenticate` response header** in `SecurityConfig` via
   `.exceptionHandling(e -> e.authenticationEntryPoint(…))` on 401.
2. **Confirm** the **403** (no `seller` role / not owner) still uses TP1's
   exact JSON body shape (`status`/`timestamp`/`error`/`message`).
3. **Rebuild + verify** that 401, 403, and the public-read path all behave
   (and that public reads are **not** broken).

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
- The `WWW-Authenticate` header is set via `.exceptionHandling(e -> e.authenticationEntryPoint(…))` in `SecurityConfig`.
- `403` "not owner" comes from the **service layer**; `403` "no `seller` role" comes from `SecurityConfig`.

---

## Step 7 — SPA wired to Keycloak   BONUS

**Outcome** — As an **end user**, you can **log in through Keycloak** in a
small web app and **list / create listings** **without typing JWTs by hand** —
the real-user flow, end to end.

### Build it
> A **starter** is provided in `spa/` (keycloak-js + `fetch`) — see
> `spa/README-spa.md`. This step re-uses the public client **`listings-spa`**
> and the **code flow + PKCE** (different from the confidential `listings-api`
> used by scripts in Step 2).

1. **Complete** the SPA starter so it loads `keycloak-js` from Keycloak
   (`http://localhost:8081/js/keycloak.js`) and calls the API at
   `http://localhost:8080` (see `spa/js/config.js`).
2. **Serve + open** the SPA, **log in** as `alice` / `secret` (redirect flow).
3. **List** the listings with the `seller` token and **create** one; then
   **log out** and confirm the session is cleared.

### Expected behavior
- **Login** as `alice` / `secret` works (redirect flow, code + PKCE).
- The **listing list loads** with the `seller` token (the API returns 200/201).
- **Logout clears the session**.

### Verify
- [ ] from the SPA, login as `alice` / `secret` (redirect flow)
- [ ] the listing list loads with the `seller` token (the API returns 200/201)
- [ ] logout clears the session

### If you are stuck
- The starter in `spa/` is **not empty but not finished** — `spa/README-spa.md` tells you the 3-4 pieces to wire.
- If the SPA shows "401" on the first load, the `keycloak.init` promise has not resolved before the `fetch` — **await** it.

---

## Step 8 — Beyond the token: an authenticator and a custom authentication flow   BONUS

**Outcome** — You **add a second factor (FIDO2/WebAuthn)** and **rework the
login flow itself** (a `Password` step then a **conditional** WebAuthn step)
**purely in Keycloak** — so identity is a **configurable platform**, not a
fixed username/password check, and you can **see it change the JWT**. This is
the other face of Keycloak: so far you have *consumed* tokens; here you
**produce the authentication policy**, entirely via the **admin console**
and/or **`realm.json`** (no Java).

### Build it
In **this repo** (`realm/realm.json`) **or** the admin console (no Java):
1. **Enable FIDO2 / WebAuthn** on the realm `listings` (a user can register a
   platform authenticator).
2. **Customize the login flow**: a `Password` step followed by a
   **conditional WebAuthn** (or OTP) step — a multi-factor flow, visible to
   `alice`.
3. **State** exactly which claim you rely on to read the assurance —
   `acr` (e.g. `password` vs `webauthn`/`otp`) or `auth_time`/`sso`.
4. **Prove reproducibility**: export the realm (**Export → full**) and re-import
   it back — that is your "no-code, reproducible" proof.

### Expected behavior
- The realm `listings` **enables FIDO2 / WebAuthn** (a user can register a
  platform authenticator).
- The login flow is **customized**: a `Password` step then a **conditional
  WebAuthn** (or OTP) step — a multi-factor flow, visible to `alice`.
- Completing the flow **changes the token** — `acr` (or `auth_time`/`sso`)
  reflects the method used.
- A user **without** a registered authenticator still logs in (the WebAuthn
  step is **conditional**), so the core stays usable.
- Everything works from the browser console **and/or** `realm.json`; **no**
  hard-coded anything in the Java code.

### Verify
- [ ] FIDO2/WebAuthn is enabled for the realm (admin console → Authentication → flows)
- [ ] `alice` can register an authenticator and the login flow now includes a second step
- [ ] after the full flow, the JWT shows the higher assurance (`acr`/method) or a fresh `auth_time`
- [ ] a new user (no authenticator) still completes login (conditional step skipped)
- [ ] the change is reproducible via `realm.json` (or documented admin-console steps) — **no code change**

### If you are stuck
- Admin console → **Realms → `listings` → Authentication → Flows**: duplicate the `browser` flow, add a `WebAuthn` step (or a `Conditional OTP`) after `Password`, and make it **conditional** (e.g. "webauthn conditional").
- Enable FIDO2 under **Authentication → Flows → configure the WebAuthn authenticator** (Relying Party Id, etc.).
- `acr` (Authentication Context Class Reference) is the OIDC claim describing *how* the subject was authenticated — the natural thing to assert on.
- Keep password-only as the **fallback** flow for scripts (`listings-api`) so core tests are unaffected; bind the WebAuthn flow to the browser client.
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

### Final checks
- [ ] `cd "$KC_DIR" && docker compose up -d` → Keycloak + Postgres **healthy**; the realm `listings` is present
- [ ] `cd "$TP1_DIR" && mvn clean verify` → **green** (the starter smoke test passes; any optional tests that require Keycloak are **not** part of the core delivery)
- [ ] The team **README** documents: how to start the stack, how to get a token, the 401/403 contracts, the claims used, and your technical choices (add the bonus authentication flow **only if you built it**)
- [ ] The local `user` table / BCrypt / `/auth/register` are **no longer used for authentication**
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

The Step 8 authentication flow is built in the admin console. To make it
**reproducible from code** (and to "prove" it is no-code configuration), export
the realm and commit the JSON:

```bash
# 1) in the admin console: Realms -> listings -> Export -> Full -> Download
#    (or via the admin REST API:)
curl -fsS http://localhost:8081/admin/realms/listings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --output realm/listings-after-step8.json

# 2) to re-import it from scratch (e.g. after `docker compose down -v`):
docker compose down -v && docker compose up -d
docker compose exec keycloak /opt/keycloak/bin/kc.sh import \
  --file /opt/keycloak/data/import/listings-after-step8.json --overwrite \
  --realm listings
```

> The imported realm serializes the **flows** (`browser`, `browser-webauthn`,
> …), the **authenticators** (WebAuthn configuration) and the **conditional
> actions** — that is the whole authentication policy as data.
