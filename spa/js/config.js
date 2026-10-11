// =====================================================
//  Config — SPA bonus (Keycloak + listings API)
//  Change if your environment differs (ports, host, ...)
// =====================================================
window.CONFIG = {
  KEYCLOAK_URL: "http://localhost:8080",
  REALM: "listings",
  CLIENT: "listings-spa",
  API: "http://localhost:8081",           // TP1 runs on 8081 (recommended)
  // if TP1 is running locally on 8080:
  // API: "http://localhost:8080",
};
