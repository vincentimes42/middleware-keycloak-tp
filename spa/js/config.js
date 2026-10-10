// =====================================================
//  Config — SPA bonus (Keycloak + listings API)
//  Modifie si ton environnement change (ports, host, …)
// =====================================================
window.CONFIG = {
  KEYCLOAK_URL: "http://localhost:8080",
  REALM: "listings",
  CLIENT: "listings-spa",
  API: "http://localhost:8081",           // le TP1 tourne sur 8081 (docker)
  // si le TP1 est tourné en local sur 8080:
  // API: "http://localhost:8080",
};
