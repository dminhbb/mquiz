(function () {
  const scriptUrl = new URL(document.currentScript.src);

  window.__SQ_BASE_PATH__ = scriptUrl.pathname
    .replace(/\/assets\/supabase-config\.js$/, "")
    .replace(/\/$/, "");

  window.__SQ_SUPABASE__ = {
    url: "https://tgczppampuvdmkknysuv.supabase.co",
    anonKey: "sb_publishable_sELerzuAn5evJFvVk_oLog_gy1G4YA5"
  };
})();
