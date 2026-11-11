// =====================================================
//  auth.js — init Keycloak (code flow + PKCE, via keycloak-js)
//  ES module: keycloak-js 26 ships as ESM only, pinned version below.
// =====================================================
import Keycloak from "https://cdn.jsdelivr.net/npm/keycloak-js@26.2.4/lib/keycloak.js";

const { KEYCLOAK_URL, REALM, CLIENT } = window.CONFIG;

window.kc = new Keycloak({ url: KEYCLOAK_URL, realm: REALM, clientId: CLIENT });

// login-required: redirect to the Keycloak login page if there is no session.
// The redirect URI is the current page; realm.json allows http://localhost:3000/*.
// ui.js waits for this promise before calling the API.
window.kcReady = window.kc.init({ onLoad: "login-required", pkceMethod: "S256" });
