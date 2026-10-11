// =====================================================
//  ui.js — rendering + events
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);

  const CATEGORIES = [
    "ELECTRONICS", "FURNITURE", "CLOTHING", "BOOKS", "VEHICLES",
    "SPORTS", "HOUSEHOLD", "GARDEN", "OTHER",
  ];

  function status(msg) {
    const el = $("#status");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }

  async function refresh() {
    if (!window.kc) return;
    // if the token is near expiry, renew it (30s margin)
    try { await window.kc.updateToken(30); } catch (e) {
      window.location.reload();
      return;
    }
    try {
      const { status: code, body } = await window.api.list(0, 20);
      const rows = Array.isArray(body)
        ? body
        : (body && body.content);       // Spring Data page
      const html = (rows || []).map((l) => `
        <div class="card">
          <div>
            <span class="badge">${l.category || "?"}</span>
            <strong>${l.title || "?"}</strong>
            <span class="muted"> — ${l.price ?? "?"}</span>
          </div>
          <span class="muted">#${l.id}</span>
        </div>`).join("") || `<p class="muted">No listing found.</p>`;
      $("#listings").innerHTML = html;
      status(`OK — HTTP ${code} — ${rows ? rows.length : 0} items`);
    } catch (e) {
      status("HTTP error — " + e.message);
    }
  }

  function init() {
    if (window.kc.authenticated) $("#login").style.display = "none";
    const btnLogin = $("#login");
    btnLogin.onclick = () => (window.location =
      window.kc.createLoginUrl({ redirectUri: location.href }));

    $("#logout").onclick = () => window.kc.logout();
    if (window.kc.authenticated) {
      $("#logout").style.display = "";
    }
    $("#whoami").onclick = async () => {
      const { status: code, body } = await window.api.whoami();
      status("auth/whoami => HTTP " + code + " " +
             (typeof body === "string" ? body : JSON.stringify(body)));
    };

    const cat = $("#category");
    CATEGORIES.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      cat.appendChild(opt);
    });

    $("#create-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get("title"),
        price: parseFloat(fd.get("price")),
        category: fd.get("category"),
      };
      const { status: code, body } = await window.api.create(payload);
      status(
        `POST /listings => HTTP ${code} — ` +
        (typeof body === "string" ? body : JSON.stringify(body, null, 2))
      );
      if (code === 201) { e.target.reset(); refresh(); }
    };

    if (window.kc.authenticated) refresh();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
