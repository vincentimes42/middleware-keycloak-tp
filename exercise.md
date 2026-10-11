# TP Keycloak — Progressive Implementation (8h)

## Overview

This is the follow-up to the Spring Boot TP (TP1, `../springboot/`). We reuse
the TP1 API and **replace its HTTP Basic authentication** with Keycloak via the
OAuth2 / OIDC flow.

**How a step is validated:** by what you can *show* — a `curl` returns the
right status code / body / header, a token carries the expected claims, the
stack is `healthy`. Each step's **acceptance checklist** is your definition of
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
> **8081** — read [`README.md` "Run"](README.md#run) for the shared-network
> setup and the one required edit in `../springboot/docker-compose.yml`
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
| **Bonus** (start only when the core checklists are green) | 6 (401/403 contracts) · 7 (SPA) · 8 (WebAuthn / custom flow) · refresh · multi-client · logout · admin UI |
| **Delivery** | 9 (final integration — see Step 9) |

Each core step's "Acceptance checklist" is your "definition of done".
Bonus steps have their own acceptance checklists; doing them is optional
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

## Step 1 - Bring up the stack `CORE`

> **User story** — *As a **developer**, I want the Keycloak identity stack to
> be **running and verified**, so that **the API and the SPA can rely on a
> real issuer** before I change any application code.*

> **Before this step:** the TP1 base must be up on **8080**
> (`cd ../springboot && docker compose up -d`, health `http://localhost:8080/actuator/health`),
> and the one required base edit (issuer + JWKS env in `../springboot/docker-compose.yml`)
> must be applied — see [`README.md` → Run](README.md#run).

### Behavior

| # | Requirement |
|---|---|
| 1.1 | `docker compose up -d` starts **Keycloak (26.8)** and **Postgres (16)**, both `healthy`. |
| 1.2 | The realm **`listings`** is imported (it is created automatically from `realm/realm.json`). |
| 1.3 | The OIDC metadata `GET /realms/listings/.well-known/openid-configuration` returns `200` with `issuer = http://localhost:8081/realms/listings`. |
| 1.4 | The public endpoints are reachable: JWKS, the `account` console, the admin console. |

### Acceptance checklist

- [ ] `docker compose ps` (from `keycloak/`) shows `keycloak` and `keycloak-postgres` **healthy**; `listings-api` (from the base, `../springboot`) is `Up` on 8080
- [ ] `GET .../realms/listings/.well-known/openid-configuration` → 200, `issuer` matches
- [ ] The list of realms (via admin API) includes `listings`
- [ ] You can log in as `alice` / `secret` on the account console

### Hints

- Start from [`README.md` → Run](README.md#run), then wait for `docker compose ps`
  to show both `keycloak` and `keycloak-postgres` `healthy`
  (`docker compose logs -f keycloak` to watch startup + import).
- Full verification walkthrough (URLs, `curl`, reading the JWT):
  [`docs/verification.md`](docs/verification.md).

---

## Step 2 - Understand the flow (token + JWT) `CORE`

> **User story** — *As a **developer**, I want to **obtain a token** for
> `alice` and **read the claims**, so that I **know exactly what the API will
> receive** and can design the resource-server rules around it.*

### Behavior

| # | Requirement |
|---|---|
| 2.1 | Using the confidential client **`listings-api`** (secret `listings-api-secret`) with the **password grant**, the API returns an `access_token` for `alice`. |
| 2.2 | Decoding the `access_token`, the **payload** carries at least: `iss` (=`http://localhost:8081/realms/listings`), `sub` (a stable UUID), `azp` (=`listings-api`), `preferred_username`, and `realm_access.roles` containing `seller`. |
| 2.3 | A **`refresh_token`** is returned (the client can renew the access token without re-authenticating). |
| 2.4 | The JWKS endpoint serves the **public key(s)** that verify the token signature (RS256). |

### Acceptance checklist

- [ ] `docs/verification.md` **§5 (Obtain a token)** and **§6 (Read the JWT)** both pass: `access_token` + `refresh_token` present; decoded payload has `iss`, `sub`, `azp`=`listings-api`, `realm_access.roles` ⊇ `["seller"]`; JWKS has a `keys` array (RS256)
- [ ] A bad password yields a `400` with `invalid_grant` (not a 200)

### Hints

- Walkthrough of every command: [`docs/verification.md`](docs/verification.md)
  (sections "Obtain a token" and "Read the JWT").
- `basic` and `roles` scope are already the **default client scopes** of
  `listings-api`, so a plain request already gets `sub` and `realm_access`.
- Decode the payload with the one-liner in `docs/verification.md` (base64url).

---

## Step 3a — Declare a resource server (no behavior change) `CORE`

> **User story** — *As a **platform developer**, I want the TP1 API to
> **declare itself as a Keycloak resource server** without breaking any TP1
> behaviour, so that I have a verified baseline before I replace the auth
> mechanism.*

### Changes to make in the TP1 (`../springboot`)

| What | From (TP1) | To (this step) |
|---|---|---|
| `pom.xml` | `spring-boot-starter-security` only | **add** `spring-boot-starter-oauth2-resource-server` |
| `application.yml` | (none) | `spring.security.oauth2.resourceserver.jwt.issuer-uri: http://localhost:8081/realms/listings` |
| `SecurityConfig` | (unchanged) | (unchanged — the filter chain still runs HTTP Basic) |
| Java classes | (unchanged) | (unchanged) |

This is a **checkpoint**, not a migration. The API still runs on HTTP Basic;
you are only *declaring the capability* for the next step.

### Behavior

| # | Requirement |
|---|---|
| 3a.1 | The API still boots, the core TP1 checklists (1·2·3·5·6·8) still pass (no regression). |
| 3a.2 | `pom.xml` contains the `spring-boot-starter-oauth2-resource-server` dependency. |
| 3a.3 | `application.yml` (or `application-dev.yml`) contains `spring.security.oauth2.resourceserver.jwt.issuer-uri: http://localhost:8081/realms/listings`. |
| 3a.4 | The JWKS endpoint for that issuer is reachable: `GET http://localhost:8081/realms/listings/protocol/openid-connect/certs` → `200` with a `keys` array. |
| 3a.5 | A TP1 basic-auth write (e.g. `POST /auth/register` followed by `POST /listings` with `Authorization: Basic …`) still returns `201`. |

### Acceptance checklist

- [ ] `docker compose` (base, `../springboot`) — the app still boots on **8080**
- [ ] `GET http://localhost:8080/actuator/health` → 200
- [ ] `grep -q "spring-boot-starter-oauth2-resource-server" pom.xml` → yes
- [ ] `grep -E "issuer-uri" src/main/resources/application*.yml` → value matches `http://localhost:8081/realms/listings`
- [ ] All core TP1 checklists (1·2·3·5·6·8) still pass (`cd ../springboot && mvn clean verify`)
- [ ] In your notebook: "I can explain *why* the API fetches its public keys from `/protocol/openid-connect/certs` before validating any JWT."

### Hints

- Spring Security — *OAuth2 Resource Server → JWT*:
  <https://docs.spring.io/spring-security/reference/servlet/oauth2/web/jwt.html>
- `issuer-uri` is the single Spring config that lets a `JwtDecoder`
  auto-discover the **JWKS** endpoint. You do **not** build the decoder by
  hand.
- The JWKS URL is derived from `issuer-uri`:
  `{issuer}/protocol/openid-connect/certs`. Verify it returns a JSON
  `keys` array **before** you rely on it in Step 3b.
- If the app does not boot after adding the starter, look at the
  `NoSuchBeanDefinitionException` (or similar) — usually a conflicting
  `SecurityFilterChain` from TP1. Read the stack trace before touching code.

---

## Step 3b — Switch to Bearer, drop the Basic path `CORE`

> **User story** — *As a **platform developer**, I want the TP1 API to
> **verify Keycloak JWTs** and stop using HTTP Basic, so that **identity is
> centralised** and no local password is ever stored.*

### Changes to make in the TP1 (`../springboot`)

On top of Step 3a:

| What | From (3a) | To (3b) |
|---|---|---|
| `SecurityConfig` | `.httpBasic(...)` on protected writes | `.oauth2ResourceServer(jwt -> jwt…)` on protected writes |
| `pom.xml` | both `spring-boot-starter-security` and `spring-boot-starter-oauth2-resource-server` | unchanged |
| `UserServiceImpl` (TP1) | BCrypt path | keep the bean, make sure **no production request path** reads it |
| `application.yml` | `issuer-uri` set | unchanged |
| TP1 tests (only if you wrote them) | `httpBasic(...)` / `@WithMockUser` | `@Disabled` with a comment (`// TP1 Basic-auth tests — see TP2 Step 3b`). **Optional.** |

### Behavior

| # | Requirement |
|---|---|
| 3b.1 | A write (`POST /listings`, `PUT/DELETE /listings/{id}`) with **no** `Authorization` header → `401`. |
| 3b.2 | A write with a token whose **issuer / audience / signature / expiry** is wrong → `401`. |
| 3b.3 | A write with a **valid** `listings` JWT is accepted; the claims (`sub`, `realm_access.roles`) are available to the security chain. |
| 3b.4 | `GET /listings*` stays **public** (no token needed) — same as TP1. |
| 3b.5 | The local `user` table and BCrypt are **no longer part of any write path** (the bean may exist, but nothing calls it). |

### Acceptance checklist

- [ ] `POST /listings` **without** Bearer → `401` (not 400, not 500)
- [ ] `POST /listings` with a **forged** token (e.g. `iss` from a different realm) → `401`
- [ ] `POST /listings` with the **canonical** token from
  `docs/verification.md` §5 → `201`
- [ ] `GET /listings` anonymous → `200` (unchanged)
- [ ] (only if you wrote them) the TP1 Basic-auth tests are `@Disabled`
      (or deleted) — they are **not** a required part of this step
- [ ] `grep -rE "httpBasic|@WithMockUser" src/main/java` → no hit
      (the production chain no longer uses Basic)

### Hints

- Spring Security reference — same page as 3a.
- In `SecurityConfig`, replace the `httpBasic(...)` clause with:
  `.oauth2ResourceServer(jwt -> jwt.authenticationConverter(...))`
  (or the default `JwtAuthenticationConverter` + a custom
  `authoritiesMapper` for the `seller` role — that is Step 4 territory).
- The `BCryptPasswordEncoder` bean can stay as a bean (Spring does not use it
  anymore) or be removed. Either is fine — **but** make sure no
  production path reads it.
- A useful test:
  `POST /auth/register` (still 200 or, if you keep TP1's behavior, 400 with
  a clear "feature deprecated in TP2 — see Step 5" message). Do **not** let
  it succeed and hash a password into the `user` table — that would
  reintroduce a local password.
- If you see a `401` with no `WWW-Authenticate: Bearer` hint, the
  `oauth2ResourceServer` config is probably missing on that request matcher.

---

## Step 4 - Map claims to authorizations `CORE`

> **User story** — *As a **platform developer**, I want a valid token with the
> `seller` role to be **allowed to write** and a token without it to be
> **denied**, so that **authorization follows the identity** without any local
> account.*

### Behavior

| # | Requirement |
|---|---|
| 4.1 | `GET /listings` and `GET /listings/{id}` stay **public** (no token needed) — same as TP1. |
| 4.2 | `POST /listings` requires a valid token whose `realm_access.roles` contains **`seller`**. Otherwise → `401` (no token) or `403` (wrong role). |
| 4.3 | `PUT`/`DELETE /listings/{id}` require **the same rules as TP1**: a valid `seller` token AND `sub == listing.owner_sub`. Non-owner (another seller) → `403`. |
| 4.4 | The API exposes `GET /auth/whoami`: returns the **current claims** (`sub`, `preferred_username`, `realm_access.roles`) for the bearer. Unauthenticated → `401`. |
| 4.5 | No local `user` table is required: the decision is taken **from the JWT only**. |

### Expected behavior matrix

| Client | GET list | POST | PUT own | PUT other | DELETE own |
|---|---|---|---|---|---|
| Anonymous | 200 | 401 | 401 | 401 | 401 |
| Seller (not owner) | 200 | 201 | 403 | 403 | 403 |
| Seller (owner) | 200 | 201 | 200 | — | 204 |

> The `PUT`/`DELETE` "own vs other" rows (200 vs 403) are decided by
> `sub == listing.owner_sub`; that key is introduced in **Step 5** (this step
> states the target authorization contract).

### Acceptance checklist

- [ ] every row of the matrix above behaves exactly as shown
- [ ] `GET /listings` and `GET /listings/{id}` stay **public** (no token needed)
- [ ] `alice` `GET /auth/whoami` → 200, body has `sub` and `realm_access.roles` containing `seller`
- [ ] unauthenticated `GET /auth/whoami` → `401`

### Hints

- In `SecurityConfig`: keep `GET /listings**` `permitAll()`; require
  `authenticated()` + a role matcher on `POST/PUT/DELETE`. The role name maps
  from the claim (`realm_access.roles` → `ROLE_seller`).
- The ownership rule (`sub == owner_sub`) stays in the **service layer**
  (exactly as TP1's "owner only" rule), but the comparison key is now the
  `sub` claim, not a local `user` id.

---

## Step 5 - Refactor the data model (drop the local user) `CORE`

> **User story** — *As a **platform developer**, I want the listing to store
> the Keycloak `sub` (`owner_sub`) instead of a local `user_id`, so that the
> **identity source is single** and the `user` table can disappear.*

### Behavior

| # | Requirement |
|---|---|
| 5.1 | The local `user` table, `User` entity, `UserRepository`, `UserService` and `/auth/register` are **deleted** from the TP1 (the identity is now Keycloak's; the `sub` claim replaces the user id). |
| 5.2 | `listing` stores `owner_sub` (string) = the `sub` claim of the creator. |
| 5.3 | The Liquibase schema is **additive**: add `owner_sub` (nullable), do **not** drop `user_id` in a destructive way (the core TP1 tests must stay green). A cleanup changeSet is optional/bonus. |
| 5.4 | On create, `owner_sub` is set from the bearer's `sub`. On PUT/DELETE, ownership means `bearer.sub == listing.owner_sub`. |
| 5.5 | The business rules of TP1 (CRUD, V1/V2, versioning, metrics, ownership) still behave as before — verify them **by `curl`** (the TP1 Java tests used Basic auth and do not apply after Step 3b). |

### Acceptance checklist

- [ ] `user` table / `User` entity / `UserRepository` / `UserService` / `/auth/register` are **gone** (deleted, not just un-referenced)
- [ ] `POST /auth/register` → **405** or **410** (the endpoint is gone)
- [ ] a created listing has `owner_sub` set to the creator's `sub`
- [ ] `PUT/DELETE` by the creator → 200/204; by another seller (different `sub`) → 403
- [ ] the **business rules of TP1** still hold (verify with `curl`): CRUD happy paths, V2 non-seller field hiding (Step 6 of TP1), `?version=` V1/V2 fallback (Step 6 of TP1), `listings.created` counter
- [ ] `cd ../springboot && mvn clean verify` → green (the TP1 starter smoke test does not need the Keycloak stack)

### Hints

- Add a Liquibase changeSet `v1.3-owner-sub.yaml` (or `ownerSub`) with
  `addColumn` on `listing` — additive only.
- Change the ownership check key from the local user id to the `sub` string.
- `mvn clean verify` is your final net (the TP1 starter smoke test does not need the Keycloak stack; any optional tests you wrote that hit Keycloak are **not required** for the core checklist).

---

## Step 6 - 401 / 403 contracts `BONUS`

> **User story** — *As an **API client**, I want a clear `401` (no/bad token)
> and a clear `403` (right user, wrong role) with a consistent `WWW-Authenticate`
> hint, so that **my client can react** (re-login, or tell me I cannot).*

> **Not to be confused with Step 4.** Step 4 decides **who can do what**
> (the authorization decision) — the same decision stays valid here. Step 6
> is about **how a refusal is *phrased* as an HTTP response**: the status
> code, the body shape, and the `WWW-Authenticate` header on 401. Everything
> in Step 6 is "response surface" — no new business rule, no new role logic,
> no new endpoint.
>
> Step 6 only *adds* **one** concrete requirement on top of Step 4: protected
> write endpoints that return **401** (missing/invalid/expired token) must
> also carry the standard header `WWW-Authenticate: Bearer realm="listings"`
> so that a well-behaved client knows *where* to log in. This single
> requirement is the step's whole contract.

### Behavior

| # | Requirement |
|---|---|
| 6.1 | A `401` on a protected write carries **both** the JSON error body **and** the header `WWW-Authenticate: Bearer realm="listings"` (so a client knows where to log in). |
| 6.2 | A `403` (valid bearer, but no `seller` role / not the owner) uses the **same JSON error body shape** as TP1 (status/timestamp/error/message). |
| 6.3 | A public read (`GET /listings`) **without a token** still returns `200` — Step 6 must not accidentally break public reads. |
| 6.4 | `404`/`409`/`422` keep **exactly** the TP1 JSON body shape (unknown listing, duplicate, validation `fields` map). |

> Full status-code matrix (who gets which code on which endpoint) — see the
> **Step 4** matrix; Step 6 does not change any of those decisions, only
> *how* the `401` is phrased (the `WWW-Authenticate` header).

### Acceptance checklist

- [ ] `401` on a protected write carries `WWW-Authenticate: Bearer realm="listings" ...`
- [ ] `403` for a valid-but-unauthorised seller (wrong role / not owner)
- [ ] anonymous reads remain `200`

### Hints

- Set the `WWW-Authenticate` response header in the `SecurityConfig`
  (`.exceptionHandling(e -> e.authenticationEntryPoint(...))`).
- `403` "not owner" comes from the **service layer**; `403` "no seller role"
  from `SecurityConfig`.

---

## Step 7 - SPA wired to Keycloak `BONUS`

> **User story** — *As an **end user**, I want to **log in through Keycloak**
> in a small web app and **list / create listings** without typing JWTs by
> hand, so the flow is **what a real user experiences**.*

A starter is provided in `spa/` (keycloak-js + `fetch`). See
`spa/README-spa.md`. Acceptance:

- [ ] from the SPA, login as `alice/secret` (redirect flow)
- [ ] the listing list loads with the `seller` token (the API returns 200/201)
- [ ] logout clears the session

> This step re-uses the client **`listings-spa`** (public) and the **code
> flow + PKCE** — different from the confidential `listings-api` used by
> scripts (Step 2).

---

## Step 8 - Beyond the token: an authenticator and a custom authentication flow `BONUS`

> **User story** — *As a **platform developer**, I want to **add a second
> factor (FIDO2/WebAuthn)** and to **rework the login flow itself** (a
> password step then a conditional WebAuthn step) purely in Keycloak, so that
> I experience identity as a **configurable platform** — not as a fixed
> username/password check — and to see it change the JWT.*

This is the step that reveals the other face of Keycloak. So far you have
*consumed* tokens; here you **produce the authentication policy**. It is done
entirely through the **admin console** and/or **`realm.json`** (no Java), which
keeps it achievable inside the session.

### Behavior

| # | Requirement |
|---|---|
| 8.1 | The realm `listings` **enables FIDO2 / WebAuthn** (a user can register a platform authenticator). |
| 8.2 | The login flow is **customized**: a `Password` step followed by a **conditional WebAuthn** (or OTP) step — i.e. a multi-factor flow — visible to `alice`. |
| 8.3 | Completing the flow changes the **token**: either the `acr` claim reflects the method used (e.g. `password` vs `webauthn`/`otp`), or `auth_time`/`sso` reflects the new session. State exactly which claim you rely on and why. |
| 8.4 | A user without a registered authenticator still logs in (the WebAuthn step is **conditional**), so the core stays usable. |
| 8.5 | Everything works from the browser (console) **and/or** `realm.json`; do not hard-code anything in the Java code. |

### Acceptance checklist

- [ ] FIDO2/WebAuthn is enabled for the realm (visible in the admin console → Authentication → flows)
- [ ] `alice` can register an authenticator and the login flow now includes a second step
- [ ] After the full flow, the JWT shows the higher assurance (`acr`/method) or a fresh `auth_time`
- [ ] A new user (no authenticator) still completes login (conditional step skipped)
- [ ] The change is reproducible via `realm.json` (or documented admin-console steps) — no code change

### Hints

- Admin console → **Realms → `listings` → Authentication → Flows**: duplicate
  the `browser` flow, add a `WebAuthn` step (or a `Conditional OTP`) after
  `Password`, and make it **conditional** (e.g. "webauthn conditional").
- Enable FIDO2 under **Authentication → Flows → configure the WebAuthn
  authenticator** (Relying Party Id, etc.).
- `acr` (Authentication Context Class Reference) is the OIDC claim describing
  *how* the subject was authenticated — the natural thing to assert on.
- Re-export the realm (**Export → full**) to see the flow serialized in the
  JSON, then import it back — that is your "no-code, reproducible" proof.
- Keep password-only as the **fallback** flow for scripts (`listings-api`) so
  core tests are unaffected; bind the WebAuthn flow to the browser client.
- (Out of scope, "to go further") a **custom authenticator Provider** written
  in Java and imported into Keycloak — mention it, do not build it in this TP.

---

## Bonus (start only when the core checklist is green)

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

## Step 9 - Final Integration

| # | Requirement |
|---|---|
| 9.1 | `docker compose up -d` (Keycloak + Postgres) is **healthy**; the realm `listings` is present. |
| 9.2 | `mvn clean verify` (TP1) is **green** — the starter smoke test passes (any optional tests you wrote that require Keycloak are not part of the core delivery). |
| 9.3 | The README documents: how to start the stack, how to get a token, the 401/403 contracts, claims used, and your technical choices. (Add the bonus authentication flow only if you built it.) |
| 9.4 | The local `user` table / BCrypt / `/auth/register` are no longer used for authentication. |
| 9.5 | No `TODO` / stubs remain in production code. (If you wrote tests, they pass — optional.) |
| 9.6 | Oral: 10 min (OAuth2/OIDC flow, JWT verification, ownership via `sub`) + 5 min Q&A. (If you built the bonus authentication flow, demo it.) |

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
