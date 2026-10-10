# TP Keycloak — Progressive Implementation (8h)

## Overview

Suite du TP Spring Boot (le TP1). On reprend l'api du TP1 et on remplace
l'authentification HTTP Basic par Keycloak et le flow OAuth2 OIDC.

For each step, write tests first, then implement until they pass. The tests
you write *are part of your deliverable*.

The specification describes **behaviors, contracts, and status codes**.
It does NOT prescribe the internal implementation.

> The TP1 (../springboot) is assumed done and green: CRUD, ownership,
> versioning, GPS, metrics. This TP only changes **who the user is** and
> how the API verifies them.

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

`http://localhost:8080/realms/listings/.well-known/openid-configuration`

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
| Identity (email, username, password, role) | SQLite `user` + BCrypt | **Keycloak** (realm `listings`) |
| Listing content | SQLite `listing` | SQLite `listing` (unchanged) |
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
| **Core** (required — must fit in the 8h) | 1 · 2 · 3 · 4 · 5 · 6 |
| **Bonus** (start only when the core checklists are green) | 7 (SPA) · refresh · multi-client · logout · admin UI |
| **Delivery** | 8 (final integration — see Step 8) |

Each core step's "Acceptance checklist" is your "definition of done".

---

## Conventions

- Tokens are **JWTs** signed with RS256 by Keycloak.
- The API expects the token in the HTTP header `Authorization: Bearer <jwt>`.
- The issuer is `http://localhost:8080/realms/listings`.
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
| 429 | (bonus) rate-limit on token endpoint | Keycloak |

> **Key change vs TP1**: the 401 reason is now a **JWT problem**
> (missing/invalid/expired/bad signature/bad issuer/bad audience), not a
> password problem. The API never knows the password.

---

## Testing strategy

`spring-boot-starter-test` and `spring-security-test` are already on the
classpath (JUnit 5, AssertJ, Mockito).

Three test levels:

| Level | Covers | Boots Spring? | Typical |
|---|---|---|---|
| **Unit** | one service, with a **mocked `Jwt`** (no real token) | no | `@ExtendWith(MockitoExtension)` |
| **Slice** | the web layer (`@ControllerAdvice`, validation) | a thin slice | `@WebMvcTest` |
| **Integration** | the real stack, with **the real Keycloak** from `docker compose` | yes | `@SpringBootTest(webEnvironment = RANDOM_PORT)` |

### 1) Unit test — mock the `Jwt`, not the realm

```java
@ExtendWith(MockitoExtension.class)
class ListingServiceImplTest {
    @Mock ListingRepository repository;
    @InjectMocks ListingServiceImpl service;

    @Test
    void nonOwnerUpdateIsRejected() {
        when(repository.findById(1L)).thenReturn(Optional.of(
                aListingOwnedBy("sub-alice")));
        Jwt jwt = aJwtWithSub("sub-bob");            // NOT the owner
        assertThatThrownBy(() -> service.update(1L, jwt, new ListingRequestDto()))
                .isInstanceOf(AccessDeniedException.class);
    }
}
```

> The "user" is now a `Jwt`. You build a fake `Jwt`
> (`Jwt.withTokenValue("x").header("typ","JWT").claim("sub","sub-alice")
>  .claim("realm_access", Map.of("roles", List.of("seller"))).build()`)
> instead of `httpBasic(...)`.

### 2) Integration test — the real Keycloak from `docker compose`

Boot the app on a random port, get a **real** token from the running Keycloak
(see `docs/verification.md`), then exercise the endpoints:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ListingsApiJwtIntegrationTest {
    @LocalServerPort int port;
    WebTestClient client;

    String tokenFor(String user) {     // real Keycloak on :8080
        return WebTestClient.bindToServer()
                .baseUri("http://localhost:8080").build()
                .post().uri("/realms/listings/protocol/openid-connect/token")
                .bodyValue("grant_type=password&client_id=listings-api"
                         + "&client_secret=listings-api-secret"
                         + "&username=" + user + "&password=secret")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .exchange().expectStatus().isOk()
                .expectBody(JsonNode.class).path("access_token").asText();
    }

    @Test
    void ownerCanCreate() throws Exception {
        try (var conn = new java.net.HttpURLConnection(
                new java.net.URL("http://localhost:" + port + "/listings"), "POST")) {
            conn.setRequestProperty("Authorization", "Bearer " + tokenFor("alice"));
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.getOutputStream().write(
              "{\"title\":\"bike\",\"price\":99,\"category\":\"SPORTS\"}".getBytes());
            assertThat(conn.getResponseCode()).isEqualTo(201);
        }
    }
}
```

> These integration tests need **`docker compose up`** running (Keycloak on
> :8080). Mark them with `@EnabledIfSystemProperty(named = "withKeycloak")`
> so `mvn verify` stays green without the stack: run them with
> `mvn verify -DwithKeycloak`.

### 3) What NOT to do

- Don't store the password in your app — Keycloak owns it.
- Don't call Keycloak from inside the request path to "check the user".
  Let Spring Security verify the JWT (issuer / audience / signature, already done
  by `oauth2ResourceServer`).

---

## Step 1 - Bring up the stack `CORE`

> **User story** — *As a **developer**, I want the Keycloak identity stack to
> be **running and verified**, so that **the API and the SPA can rely on a
> real issuer** before I change any application code.*

### Behavior

| # | Requirement |
|---|---|
| 1.1 | `docker compose up -d` starts **Keycloak (26.8)** and **Postgres (16)**, both `healthy`. |
| 1.2 | The realm **`listings`** is imported (it is created automatically from `realm/realm.json`). |
| 1.3 | The OIDC metadata `GET /realms/listings/.well-known/openid-configuration` returns `200` with `issuer = http://localhost:8080/realms/listings`. |
| 1.4 | The public endpoints are reachable: JWKS, the `account` console, the admin console. |

### Acceptance checklist

- [ ] `docker compose ps` shows `tp-keycloak` and `tp-postgres` **healthy**
- [ ] `GET .../realms/listings/.well-known/openid-configuration` → 200, `issuer` matches
- [ ] The list of realms (via admin API) includes `listings`
- [ ] You can log in as `alice` / `secret` on the account console

### Hints

- Start in the `keycloak/` folder: `docker compose up -d`.
- Wait for the healthcheck: `docker compose ps` (both `healthy`).
- `docker compose logs -f keycloak` to watch startup + import.
- Full verification walkthrough (URLs, `curl`, reading the JWT):
  [`docs/verification.md`](docs/verification.md).
- To wipe and start clean: `docker compose down -v && docker compose up -d`.

---

## Step 2 - Understand the flow (token + JWT) `CORE`

> **User story** — *As a **developer**, I want to **obtain a token** for
> `alice` and **read the claims**, so that I **know exactly what the API will
> receive** and can design the resource-server rules around it.*

### Behavior

| # | Requirement |
|---|---|
| 2.1 | Using the confidential client **`listings-api`** (secret `listings-api-secret`) with the **password grant**, the API returns an `access_token` for `alice`. |
| 2.2 | Decoding the `access_token`, the **payload** carries at least: `iss` (=`http://localhost:8080/realms/listings`), `sub` (a stable UUID), `azp` (=`listings-api`), `preferred_username`, and `realm_access.roles` containing `seller`. |
| 2.3 | A **`refresh_token`** is returned (the client can renew the access token without re-authenticating). |
| 2.4 | The JWKS endpoint serves the **public key(s)** that verify the token signature (RS256). |

### Acceptance checklist

- [ ] `POST .../protocol/openid-connect/token` (password grant, `listings-api`) → 200 with `access_token` + `refresh_token`
- [ ] The decoded payload has `iss`, `sub`, `azp`=`listings-api`, `realm_access.roles` ⊇ `["seller"]`
- [ ] `GET .../protocol/openid-connect/certs` returns a `keys` array (RS256)
- [ ] A bad password yields a `401` with `invalid_grant` (not a 200)

### Hints

- Walkthrough of every command: [`docs/verification.md`](docs/verification.md)
  (sections "Obtenir un token" and "Lire le JWT").
- `basic` and `roles` scope are already the **default client scopes** of
  `listings-api`, so a plain request already gets `sub` and `realm_access`.
- Decode the payload with the one-liner in `docs/verification.md` (base64url).

---

## Step 3 - Turn the API into a resource server `CORE`

> **User story** — *As a **platform developer**, I want the TP1 API to
> **verify Keycloak JWTs** and stop using HTTP Basic, so that **identity is
> centralised** and no local password is ever stored.*

### Changes to make in the TP1 (`../springboot`)

| What | From (TP1) | To (TP2) |
|---|---|---|
| `pom.xml` | `spring-boot-starter-security` only | **add** `spring-boot-starter-oauth2-resource-server` |
| `SecurityConfig` | `.httpBasic(...)` | `.oauth2ResourceServer(jwt -> jwt... )` |
| `application.yml` | (none) | `spring.security.oauth2.resourceserver.jwt.issuer-uri: http://localhost:8080/realms/listings` |
| Auth source | local `user` table + BCrypt | the JWT (`sub` + `realm_access`) |

### Behavior

| # | Requirement |
|---|---|
| 3.1 | The API rejects a request with **no** `Authorization` header on protected endpoints → `401`. |
| 3.2 | The API rejects a token with a **wrong issuer**, **wrong audience**, or **invalid signature** → `401`. |
| 3.3 | The API accepts a valid `listings` JWT and exposes it as the current authentication. |
| 3.4 | `application.yml` sets `issuer-uri` to `http://localhost:8080/realms/listings` (the API then fetches the **JWKS** itself and verifies the signature). |

### Acceptance checklist

- [ ] `POST /listings` **without** Bearer → `401`
- [ ] `POST /listings` with a **forged** token → `401`
- [ ] `GET /listings` with a **valid** Bearer → `200`
- [ ] `spring.security.oauth2.resourceserver.jwt.issuer-uri` is set in `application.yml`
- [ ] `spring-boot-starter-oauth2-resource-server` is in `pom.xml`

### Hints

- Spring Security reference — *OAuth2 Resource Server → JWT*:
  <https://docs.spring.io/spring-security/reference/servlet/oauth2/web/jwt.html>
- `JwtDecoder` is created automatically from `issuer-uri` (it fetches JWKS).
  You do **not** need to build it by hand.
- Keep the `BCryptPasswordEncoder` out of any path you touch — it is now
  unused.
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

### Acceptance checklist

- [ ] anonymous `GET /listings` → `200` (public)
- [ ] anonymous `POST /listings` → `401`
- [ ] `alice` (seller) `POST /listings` → `201`
- [ ] `alice` `PUT` alice's listing → `200`; `alice` → **`bob`'s** listing → `403`
- [ ] `alice` `GET /auth/whoami` → 200, body has `sub` and `realm_access.roles` containing `seller`

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
| 5.1 | The local `user` table, `User` entity, `UserRepository`, `UserService` and `/auth/register` are **removed** (or clearly unused) from the TP1. |
| 5.2 | `listing` stores `owner_sub` (string) = the `sub` claim of the creator. |
| 5.3 | The Liquibase schema is **additive**: add `owner_sub` (nullable), do **not** drop `user_id` in a destructive way (the core TP1 tests must stay green). A cleanup changeSet is optional/bonus. |
| 5.4 | On create, `owner_sub` is set from the bearer's `sub`. On PUT/DELETE, ownership means `bearer.sub == listing.owner_sub`. |
| 5.5 | The core TP1 checklists (Steps 1-6 of TP1) still pass after the change. |

### Acceptance checklist

- [ ] `user` table / `User` entity / BCrypt are gone (or unused)
- [ ] a created listing has `owner_sub` set to the creator's `sub`
- [ ] `PUT/DELETE` by the creator → 200/204; by another seller → 403
- [ ] core TP1 tests still pass
- [ ] `docker compose up` (TP2) + `mvn test` (TP1) both green

### Hints

- Add a Liquibase changeSet `v1.3-owner-sub.yaml` (or `ownerSub`) with
  `addColumn` on `listing` — additive only.
- Change the ownership check key from the local user id to the `sub` string.
- `mvn clean verify -DwithKeycloak` (with the stack up) is your final net.

---

## Step 6 - 401 / 403 contracts `CORE`

> **User story** — *As an **API client**, I want a clear `401` (no/bad token)
> and a clear `403` (right user, wrong role) with a consistent `WWW-Authenticate`
> hint, so that **my client can react** (re-login, or tell me I cannot).*

### Behavior

| # | Requirement |
|---|---|
| 6.1 | Unauthenticated / invalid/expired **write** → `401` with body and header `WWW-Authenticate: Bearer realm="listings", error="invalid_token"`. |
| 6.2 | Authenticated but missing the `seller` role on a write → `403`. |
| 6.3 | Anonymous **read** (`GET /listings`) stays `200`. |
| 6.4 | `404`/`409`/`422` behave exactly as TP1 (unknown listing, duplicate, validation). |

### Test matrix

| Client | GET list | POST | PUT own | PUT other | DELETE own |
|---|---|---|---|---|---|
| Anonymous | 200 | 401 | 401 | 401 | 401 |
| Seller (not owner) | 200 | 201 | 403 | 403 | 403 |
| Seller (owner) | 200 | 201 | 200 | — | 204 |

### Acceptance checklist

- [ ] every row of the matrix behaves as above
- [ ] `401` on protected write carries `WWW-Authenticate: Bearer ...`
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

## Bonus (start only when the core checklist is green)

- **Refresh**: the SPA / client renews the access token with the
  `refresh_token` before it expires.
- **Multi-client**: one identity realm serves both `listings-api` (script)
  and `listings-spa` (browser) — keep both working from the same realm.
- **Logout**: front-channel logout + Keycloak session invalidation.
- **Admin role**: a user with the realm `admin` sees an `GET /listings` count
  or other admin-only endpoint; a seller does not (403).
- **Introspection**: the API validates a token via the OIDC **introspection
  endpoint** instead of (or in addition to) local JWT verification.

---

## Step 8 - Final Integration

| # | Requirement |
|---|---|
| 11.1 | `docker compose up -d` (Keycloak + Postgres) is **healthy**; the realm `listings` is present. |
| 11.2 | `mvn clean verify` (TP1) is **green** — core checklists pass; add `-DwithKeycloak` to also run the integration tests against the real Keycloak. |
| 11.3 | The README documents: how to start the stack, how to get a token, the 401/403 contracts, claims used, and your technical choices. |
| 11.4 | The local `user` table / BCrypt / `/auth/register` are no longer used for authentication. |
| 11.5 | No `TODO` / stubs remain in production code. Total test count (unit + integration) keeps growing on top of TP1. |
| 11.6 | Oral: 10 min (OAuth2/OIDC flow, JWT verification, ownership via `sub`, demo) + 5 min Q&A. |

---

## Deliverables

| Item | Detail |
|---|---|
| Git repository (pair) | TP1 repo modified + this keycloak folder, clean history |
| `docker compose up` | Keycloak + Postgres healthy, realm imported |
| `mvn clean verify` (TP1) | green; `-DwithKeycloak` runs the integration tests |
| README.md | stack run, token, 401/403, claims, choices |
| Oral | 10 min + Q&A |

---

## Appendix A - OIDC / JWT quick reference

- Code flow + PKCE: a browser gets a short **code**, exchanges it for a token.
  PKCE adds a one-time verifier/challenge so the code cannot be replayed.
- Key claims you rely on: `iss` (issuer), `sub` (stable user id), `azp`
  (authorized party = the client), `realm_access.roles`.
- `sub` is the replacement for the local `user` — store it as `owner_sub`.
- The API never stores the JWT secret. It verifies with the **public** key
  from the JWKS endpoint.

## Appendix B - Useful endpoints (realm `listings`)

| URL | Purpose |
|---|---|
| `http://localhost:8080/realms/listings/.well-known/openid-configuration` | OIDC metadata |
| `…/protocol/openid-connect/issuer` | the issuer string |
| `…/protocol/openid-connect/token` | get a token |
| `…/protocol/openid-connect/certs` | JWKS (public keys) |
| `http://localhost:8080/admin` | admin console (admin/admin) |
| `http://localhost:8080/realms/listings/account/` | user console (alice/secret) |

## Appendix C - Keycloak CLI

```
docker compose exec keycloak /opt/keycloak/bin/kc.sh build
docker compose exec keycloak /opt/keycloak/bin/kc.sh import --file /opt/keycloak/data/import/realm.json --overwrite
```
