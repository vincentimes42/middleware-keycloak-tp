// =====================================================
//  auth.js — init Keycloak (code flow + PKCE, via keycloak-js)
// =====================================================
(function () {
  const { KEYCLOAK_URL, REALM, CLIENT } = window.CONFIG;

  // keycloak-js is loaded by index.html <script src="http://localhost:8080/js/keycloak.js">
  window.kc = Keycloak({
    url: KEYCLOAK_URL,
    realm: REALM,
    clientId: CLIENT,
    // let keycloak-js handle PKCE + token refresh
  });

  // if we are already authenticated, load the token without UI
  kc.init({ onLoad: "login-required", pkceMethod: "S256" });
})();
