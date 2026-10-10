// =====================================================
//  auth.js — init Keycloak (code flow + PKCE, via keycloak-js)
// =====================================================
(function () {
  const { KEYCLOAK_URL, REALM, CLIENT } = window.CONFIG;

  // keycloak-js est chargé par index.html <script src="…keycloak.js">
  window.kc = Keycloak({
    url: KEYCLOAK_URL,
    realm: REALM,
    clientId: CLIENT,
    // on laisse keycloak-js gérer le PKCE + le refresh
  });

  // si on est déjà authentifié, on charge le token sans UI
  kc.init({ onLoad: "login-required", pkceMethod: "S256" });
})();
