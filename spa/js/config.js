// =====================================================
//  Config — SPA bonus (Keycloak + listings API)
//  Change if your environment differs (ports, host, ...)
// =====================================================
window.CONFIG = {
  KEYCLOAK_URL: "http://localhost:8081",
  REALM: "listings",
  CLIENT: "listings-spa",
  API: "http://localhost:8080",           // TP1 runs on 8080 for every TP
};
