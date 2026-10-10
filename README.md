# TP Keycloak — stack d'identité

Suite du TP Spring Boot (le TP1, `../springboot/`) : on **remplace
l'authentification HTTP Basic** par **Keycloak** / **OAuth2 / OIDC**.

L'étudiant ne modifie **que** le repo du TP1. Ce dossier fournit uniquement :

- `docker-compose.yml` — la stack Keycloak + Postgres, prête à lancer
- `realm/realm.json` — le realm, les clients, les comptes, les rôles
- `spa/` (bonus) — une SPA simple consommant l'API du TP1 avec un JWT
- [`exercise.md`](exercise.md) — l'énoncé complet (8h, core 1-6 + bonus)

---

## Prérequis

- Docker + Docker Compose (voir `docker compose version`)
- JDK 27 + Maven 3.9+ (déjà installé pour le TP1)
- Port `8080` libre (Keycloak), `5433` libre (Postgres publié)
- Port `8081` libre (on publie l'API du TP1 dessus — le port `8080` est réservé
  à Keycloak sur ce TP)

## Démarrer

### 1) La stack d'identité

```bash
cd keycloak
docker compose up -d

# vérifier
curl -s http://localhost:8080/realms/listings/.well-known/openid-configuration
docker compose ps    # tp-keycloak healthy — tp-postgres healthy
```

- Admin console : <http://localhost:8080/admin> (`admin` / `admin`)
- Console user `alice` : <http://localhost:8080/realms/listings/account/>
  (`alice` / `secret`)
- Issuer du realm `listings` :
  `http://localhost:8080/realms/listings`
  (c'est la valeur attendue par `spring.security.oauth2.resourceserver.jwt.issuer-uri` dans
  le TP1, voir `exercise.md` Step 3)
- JWKS (clés publiques) :
  <http://localhost:8080/realms/listings/protocol/openid-connect/certs>

Un guide de vérification complet, avec `curl` du token et lecture du JWT, est
disponible dans [`docs/verification.md`](docs/verification.md).

### 2) L'API (le repo TP1)

Deux options selon l'environnement :

- **En local** — dans le dossier `../springboot`, en parallèle, `mvn spring-boot:run`
  comme au TP1. Modifier le port de l'API (`server.port: 8081`) si `8080` est
  réservé à Keycloak sur la même machine, ou décaler Keycloak sur un autre port
  dans `docker-compose.yml`.

- **Dans le compose** — si l'étudiant préfère tout dans docker, ajouter un
  service `build: ../springboot` (Dockerfile requis) qui référence Keycloak via
  `http://keycloak:8080`. Ce cas n'est pas exigé ; optionnel.

### 3) SPA (bonus, Step 7 du TP)

```bash
cd spa
python3 -m http.server 3000        # ou n'importe quel serveur statique
# ouvrir http://localhost:3000
```

La SPA charge `keycloak-js` servi par Keycloak
(`<http://localhost:8080/js/keycloak.js>`), utilise le client public
`listings-spa`, et consomme l'API du TP1 avec un JWT Bearer.

## Arrêter

```bash
docker compose down        # garder les données Keycloak
docker compose down -v     # effacer + réinitialiser Postgres + Keycloak
```

## Arborescence

```
keycloak/
├── .gitignore
├── docker-compose.yml        # stack: keycloak(26.8) + postgres(16), volumes, health
├── realm/
│   └── realm.json            # realm "listings" — clients, users, roles, CORS
├── docs/
│   └── verification.md       # vérif admin UI + curl du token + claims
├── spa/                      # BONUS (Step 7) — keycloak-js + fetch
│   ├── index.html
│   ├── js/{config,auth,api,ui}.js
│   └── README-spa.md
├── README.md                 # ce fichier
└── exercise.md               # l'énoncé (8h, core 1-6 + bonus)
```

## Liens utiles (à la version du projet)

- Keycloak 26.x — Getting started: <https://www.keycloak.org/documentation>
- Keycloak — Import & Export: <https://www.keycloak.org/misc/import-export>
- Spring Security — OAuth 2 Login / Resource Server / JWT:
  <https://docs.spring.io/spring-security/reference/servlet/authentication/index.html>
- OIDC — Core specification: <https://openid.net/specs/openid-connect-core-1_0.html>

> Règle du TP : aucun `TODO`, aucun stub, aucune secret dans le code produit.
> Les mots de passe de `realm.json` (`secret`) sont **des démos**, pas des
> secrets réels.
