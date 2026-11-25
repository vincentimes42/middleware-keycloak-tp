// =====================================================
//  api.js — wrapper HTTP pour l'API du TP1, avec Bearer
// =====================================================
(function () {
  const API = window.CONFIG.API;

  async function req(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + window.kc.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch (_) {
      return { status: res.status, body: text };
    }
  }

  window.api = {
    list: (page = 0, size = 20, category, maxPrice) => {
      const q = new URLSearchParams({ page, size, sort: "id,desc" });
      if (category) q.set("category", category);
      if (maxPrice) q.set("maxPrice", maxPrice);
      return req("GET", "/listings?" + q.toString());
    },
    one: (id) => req("GET", "/listings/" + id),
    create: (listing) => req("POST", "/listings", listing),
    whoami: () => req("GET", "/auth/whoami"),
  };
})();
