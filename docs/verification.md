# Keycloak — vérification de la stack

Objectif : vérifier que la stack (Keycloak + Postgres) est montée, que le realm
`listings` est importé, et qu'on y obtient un token JWT valide pour `alice`.

## 1) Prérequis

- `docker compose` disponible (`docker compose version`).
- Port 8080 libre (Keycloak) et 5433 libre (Postgres publié).

## 2) Démarrer

```bash
cd keycloak
docker compose up -d
```

Le `depends_on` attend que `postgres` passe en `healthy` avant de monter
`keycloak`. Quand l'app est prête, le healthcheck passe en `healthy`.

Suivi :

```bash
docker compose ps              # tp-keycloak  healthy / tp-postgres  healthy
docker compose logs -f keycloak
```

## 3) URLs utiles

| URL | Rôle |
|---|---|
| <http://localhost:8080/admin> | Admin console (login `admin` / `admin`) |
| <http://localhost:8080/realms/listings/account/> | Console utilisateur (`alice` / `secret`) |
| <http://localhost:8080/realms/listings/.well-known/openid-configuration> | OIDC metadata |
| <http://localhost:8080/realms/listings/protocol/openid-connect/certs> | JWKS (clés publiques) |
| <http://localhost:8080/realms/listings/protocol/openid-connect/token> | Token endpoint |

## 4) Rôles et comptes

| Identitant | Rôle realm | Mot de passe |
|---|---|---|
| `admin` (realm master) | admin | `admin` |
| `alice` | `seller` | `secret` |
| `bob` | `seller` | `secret` |

Comptes / rôles créés par `realm/realm.json`.

## 5) Obtenir un token (le geste type)

```bash
# client confidential : listings-api (secret: listings-api-secret)
curl -fsS -X POST http://localhost:8080/realms/listings/protocol/openid-connect/token \
  -d grant_type=password \
  -d client_id=listings-api \
  -d client_secret=listings-api-secret \
  -d username=alice \
  -d password=secret
```

Réponse attendue : un JSON avec `access_token`, `refresh_token`, `expires_in`,
`scope`, `token_type` (Bearer).

## 6) Lire le JWT (sans library)

Le token est `header.payload.signature` en base64url. Pour lire le `payload` :

```bash
ACCESS=$(curl -fsS -X POST http://localhost:8080/realms/listings/protocol/openid-connect/token \
  -d grant_type=password -d client_id=listings-api -d client_secret=listings-api-secret \
  -d username=alice -d password=secret | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
python3 - <<PY
import base64, json
raw = "$ACCESS".split(".")[1]
raw += "=" * (-len(raw) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(raw)), indent=2))
PY
```

Clés qui comptent pour l'application Spring Boot (voir `exercise.md`) :

| claim | valeur d'exemple |
|---|---|
| `iss` | `http://localhost:8080/realms/listings` |
| `sub` | le `uuid` Keycloak de l'utilisateur (stable, unique) |
| `azp` | `listings-api` |
| `preferred_username` | `alice` |
| `email` | `alice@listings.local` |
| `realm_access.roles` | `["seller"]` |
| `scope` | `basic profile email` |

> `sub` est la clé stable qui remplace la table `user` du TP1 — c'est la valeur
> attendue dans `listing.owner_sub`.

## 7) Arrêter

```bash
# garder les données
docker compose down

# tout effacer (Postgres + Keycloak)
docker compose down -v
```

## 8) Réinitialiser la stack

```bash
docker compose down -v && docker compose up -d
```

Le realm est réimporté au premier boot (`--import-realm`, `ignoreExisting`),
les comptes de démo reviennent à l'état initial.

## 9) Problèmes fréquents

| Symptôme | Cause | Correction |
|---|---|---|
| `tp-keycloak` redémarre | `postgres` pas ready | vérifier `docker compose logs postgres` |
| `401 invalid_client` | `client_secret` faux | utiliser `listings-api-secret` |
| `sub` absent du token | manque de `basic` scope | `basic` + `roles` sont déjà dans le realm.json |
| `404 /health/ready` | chemin health 26.x non monté | ne pas s'appuyer sur ce endpoint; tester `/realms/listings/.well-known/openid-configuration` |
