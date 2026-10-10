# SPA bonus — Listings d'achat / vente

> Cette SPA est **optionnelle / bonus** (Step 7 du TP). Elle remplace les `curl`
> du TP1 par une petite interface qui consomme l'api du TP1 **avec un JWT
> Keycloak**.

## Stack

Une page HTML + 4 scripts JS (`config.js`, `auth.js`, `api.js`, `ui.js`).
Aucun framework. Aucune dependance à installer (tout fonctionne en vanilla JS
+ `fetch`).

Pour l'auth on utilise le client **Keycloak officiel** [`keycloak-js`](https://github.com/keycloak/keycloak-js)
servi directement par l'image `keycloak/keycloak:26.8`:
`http://localhost:8080/js/keycloak.js`. Pas de `npm`, pas de `node_modules`.

## Démarrer

La SPA est servie par **n'importe quel serveur statique HTML** qui met à
dispo les fichiers (ex. `python3 -m http.server 3000`) depuis le dossier
contenant `index.html`.

Option A (le plus simple):

```bash
# dans le dossier `spa/`
python3 -m http.server 3000
# ouvrir http://localhost:3000
```

Option B (nginx ou caddy) si l'étudiant connaît :

```dockerfile
FROM nginx:alpine AS spa
COPY index.html /usr/share/nginx/html/
COPY js /usr/share/nginx/html/js
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

## Config (js/config.js)

| clé | valeur attendue |
|---|---|
| `KEYCLOAK_URL` | `http://localhost:8080` |
| `REALM` | `listings` |
| `CLIENT` | `listings-spa` (le client **public** défini dans realm.json) |
| `API` | `http://localhost:8081` (le TP1 monté sur le port 8081 via docker) |

> NB : en environnement académique on part de `http://localhost:8081` pour
> l'API parce que le port `8080` est réservé à Keycloak. Si l'étudiant fait
> tourner le TP1 **localement sur 8080**, il change juste `API` en `http://localhost:8080`.

## Flux

1. `ui.js` vérifie `kc.authenticated`. Si non → `auth.js` appelle `kc.login()`.
2. Keycloak redirige sur la page de login du realm `listings`.
3. L'utilisateur rentre `alice`/`secret` (ou `bob`/`secret`).
4. Keycloak redirige sur `http://localhost:3000/auth/callback` avec un `code`.
5. `auth.js` fait l'échange `code` → `access_token` via l'endpoint token de
   Keycloak (PKCE S256).
6. `ui.js` appelle `GET /listings` avec `Authorization: Bearer <jwt>`.
7. Refresh automatique: si le token expire, `auth.js` appelle `kc.updateToken(30)`
   avant l'endpoint.

## Ce que la SPA ne fait PAS

- Pas de gestion de `refresh_token` par l'UI (c'est Keycloak qui gère).
- Pas de `localStorage` pour le mot de passe (Keycloak gère le login).
- Pas de CORS (le server doit le déclarer s'il est sur un autre port).

## Si ça ne marche pas

1. Vérifier que `docker compose ps` est healthy.
2. Ouvrir `http://localhost:3080/realms/listings/protocol/openid-connect/authorize?client_id=listings-spa&redirect_uri=http://localhost:3000/auth/callback&response_type=code` — si la page de login n'apparait pas, le CORS ou `webOrigins` n'est pas bien réglé dans `realm.json`.
3. Vérifier la console du navigateur (403 = pas le role, 401 = pas de token).
4. Vérifier que l'API Spring Boot du TP1 tourne sur `localhost:8081`.
