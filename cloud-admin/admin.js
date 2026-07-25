(function () {
  const app = document.getElementById("adminApp");
  const dialog = document.getElementById("adminDialog");
  const adminBaseUrl = new URL("./", location.href);
  const quizBaseUrl = new URL("../", adminBaseUrl);
  const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "unknown";
  const APP_VERSION_URL = new URL("../app-version.json", document.currentScript?.src || adminBaseUrl);
  const APP_VERSION_CHECK_INTERVAL_MS = 60_000;
  const config = window.__SQ_SUPABASE__ || {};
  const client = window.supabase?.createClient(config.url, config.anonKey);
  let dialogErrorTimer = null;
  let activeSpaceSettings = null;
  let spaceSettingsDirty = false;
  const state = {
    session: null,
    profile: null,
    view: "spaces",
    spaces: [],
    passwordRecovery: false,
    status: "",
    error: false,
    updateAvailableVersion: ""
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  function syncAppUpdateToast() {
    if (!state.updateAvailableVersion || document.querySelector(".app-update-toast")) return;
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "status app-update-toast";
    toast.textContent = "Làm mới ứng dụng";
    toast.setAttribute("aria-label", "Có phiên bản mới. Làm mới ứng dụng");
    toast.onclick = () => {
      const target = new URL(window.location.href);
      target.searchParams.set("app_version", state.updateAvailableVersion || String(Date.now()));
      window.location.replace(target.href);
    };
    document.body.appendChild(toast);
  }

  async function checkForAppUpdate() {
    try {
      const response = await fetch(APP_VERSION_URL, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const latestVersion = typeof payload?.version === "string" ? payload.version.trim() : "";
      if (latestVersion && latestVersion !== APP_VERSION) {
        state.updateAvailableVersion = latestVersion;
        syncAppUpdateToast();
      }
    } catch {
      // Version monitoring must never block the administration interface.
    }
  }

  function startAppVersionMonitoring() {
    checkForAppUpdate();
    window.setInterval(checkForAppUpdate, APP_VERSION_CHECK_INTERVAL_MS);
  }

  function setStatus(message, error = false) {
    state.status = message;
    state.error = error;
    render();
  }

  function loadingPanel(label) {
    return `<section class="panel loading-state" role="status" aria-live="polite" aria-label="${esc(label)}">
      <span class="skeleton loading-title" aria-hidden="true"></span>
      <span class="skeleton" aria-hidden="true"></span>
      <span class="skeleton loading-short" aria-hidden="true"></span>
      <span class="sr-only">${esc(label)}</span>
    </section>`;
  }

  async function boot() {
    if (!client) {
      app.innerHTML = '<main class="login-screen" id="main-content" tabindex="-1"><section class="login-panel"><h1>Chưa cấu hình Supabase</h1></section></main>';
      return;
    }
    const { data } = await client.auth.getSession();
    state.session = data.session;
    if (state.session) await loadProfile();
    render();
    client.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") state.passwordRecovery = true;
      state.session = session;
      state.profile = null;
      if (session) await loadProfile();
      render();
    });
  }

  async function loadProfile() {
    const { data, error } = await client
      .from("profiles")
      .select("id,email,fullname,role,active")
      .eq("id", state.session.user.id)
      .single();
    if (error || !data?.active) {
      await client.auth.signOut();
      state.status = "Tài khoản chưa được cấp quyền quản trị.";
      state.error = true;
      return;
    }
    state.profile = data;
  }

  function render() {
    if (state.passwordRecovery && state.session) return renderRecoveryPassword();
    if (!state.session || !state.profile) return renderLogin();
    app.innerHTML = `<section class="admin-shell">
      <aside class="sidebar">
        <div><div class="brand" aria-label="mquiz"><span>m</span>quiz</div><div class="admin-edition">Quản trị</div></div>
        <nav aria-label="Điều hướng quản trị">
          <button class="${state.view === "spaces" ? "active" : ""}" data-view="spaces" ${state.view === "spaces" ? 'aria-current="page"' : ""}>Quản lý Space</button>
          ${state.profile.role === "superadmin" ? '<button class="' + (state.view === "users" ? "active" : "") + '" data-view="users" ' + (state.view === "users" ? 'aria-current="page"' : "") + '>Quản lý Admin</button>' : ""}
          ${state.profile.role === "superadmin" ? '<button class="' + (state.view === "backup" ? "active" : "") + '" data-view="backup" ' + (state.view === "backup" ? 'aria-current="page"' : "") + '>Backup & Restore</button>' : ""}
          <button class="${state.view === "password" ? "active" : ""}" data-view="password" ${state.view === "password" ? 'aria-current="page"' : ""}>Đổi mật khẩu</button>
        </nav>
        <div class="sidebar-user"><b>${esc(state.profile.fullname)}</b><br><span>${esc(state.profile.email)}</span><br><small>${esc(state.profile.role)}</small></div>
        <button id="logoutBtn">Đăng xuất</button>
      </aside>
      <main class="workspace" id="main-content" tabindex="-1">
        ${state.status ? `<div class="status ${state.error ? "error" : ""}" role="${state.error ? "alert" : "status"}" aria-live="${state.error ? "assertive" : "polite"}">${esc(state.status)}</div>` : ""}
        <div id="view"></div>
        <footer class="copyright">mquiz © 2026 · minhnd7 <span class="app-build-info">· Version ${esc(APP_VERSION)} · Build ${esc(APP_VERSION)}</span></footer>
      </main>
    </section>`;
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.onclick = () => {
        state.view = button.dataset.view;
        state.status = "";
        render();
      };
    });
    document.getElementById("logoutBtn").onclick = () => client.auth.signOut();
    if (state.view === "spaces") renderSpaces();
    if (state.view === "users") renderUsers();
    if (state.view === "backup") renderBackup();
    if (state.view === "password") renderPassword();
  }

  function renderLogin() {
    app.innerHTML = `<main class="login-screen" id="main-content" tabindex="-1">
      <form class="login-panel" id="loginForm">
        <div><div class="brand">mquiz</div><p class="muted">Đăng nhập quản trị cloud</p></div>
        ${state.status ? `<div class="status ${state.error ? "error" : ""}">${esc(state.status)}</div>` : ""}
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary">Đăng nhập</button>
        <button type="button" id="forgotBtn">Quên mật khẩu</button>
      </form>
    </main>`;
    document.getElementById("loginForm").onsubmit = login;
    document.getElementById("forgotBtn").onclick = resetPassword;
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await client.auth.signInWithPassword({
      email: form.get("email").trim(),
      password: form.get("password")
    });
    if (error) setStatus(error.message, true);
  }

  async function resetPassword() {
    const email = document.querySelector('[name="email"]').value.trim();
    if (!email) return setStatus("Nhập email trước khi yêu cầu đặt lại mật khẩu.", true);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: adminBaseUrl.href
    });
    setStatus(error ? error.message : "Đã gửi email đặt lại mật khẩu.", Boolean(error));
  }

  function renderRecoveryPassword() {
    app.innerHTML = `<main class="login-screen" id="main-content" tabindex="-1"><form class="login-panel" id="recoveryForm">
      <div><div class="brand">mquiz</div><p class="muted">Đặt mật khẩu mới</p></div>
      <label>Mật khẩu mới<input name="password" type="password" minlength="8" required></label>
      <button class="primary">Cập nhật mật khẩu</button>
    </form></main>`;
    document.getElementById("recoveryForm").onsubmit = async (event) => {
      event.preventDefault();
      const password = new FormData(event.target).get("password");
      const { error } = await client.auth.updateUser({ password });
      if (error) return setStatus(error.message, true);
      state.passwordRecovery = false;
      await loadProfile();
      render();
    };
  }

  async function renderSpaces() {
    const view = document.getElementById("view");
    view.innerHTML = loadingPanel("Đang tải danh sách Space");
    const [{ data: spaces, error }, { data: questions }, { data: realExams }] = await Promise.all([
      client.from("spaces").select("*").order("updated_at", { ascending: false }),
      client.from("questions").select("id,space_id,type").is("hidden_at", null),
      client.from("real_exams").select("id,space_id,name,start_at,end_at,ended_at").is("hidden_at", null)
    ]);
    if (error) return setStatus(error.message, true);
    const counts = new Map();
    (questions || []).forEach((question) => {
      const current = counts.get(question.space_id) || { total: 0, multi: 0 };
      current.total += 1;
      if (question.type === "multi") current.multi += 1;
      counts.set(question.space_id, current);
    });
    const now = Date.now();
    const activeExamBySpace = new Map();
    (realExams || []).forEach((exam) => {
      const start = new Date(exam.start_at).getTime();
      const end = new Date(exam.end_at).getTime();
      if (!exam.ended_at && start <= now && end >= now && !activeExamBySpace.has(exam.space_id)) {
        activeExamBySpace.set(exam.space_id, exam);
      }
    });
    state.spaces = (spaces || []).map((space) => ({
      ...space,
      counts: counts.get(space.id) || { total: 0, multi: 0 },
      active_real_exam: activeExamBySpace.get(space.id) || null
    }));
    const summary = {
      total: state.spaces.length,
      published: state.spaces.filter((space) => space.published).length,
      real: state.spaces.filter((space) => space.active_real_exam).length,
      empty: state.spaces.filter((space) => Number(space.counts.total || 0) === 0).length
    };
    view.innerHTML = `<header class="topbar">
      <div><h1>Quản lý Space</h1><p class="muted">Dữ liệu được lưu trực tiếp trên Supabase.</p></div>
      <button class="primary" id="addSpaceBtn">Thêm Space</button>
    </header>
    <section class="space-summary-grid" aria-label="Tổng quan Space">
      <article class="metric-card"><span>Tổng Space</span><b>${summary.total}</b><small>Đang quản trị</small></article>
      <article class="metric-card"><span>Đã xuất bản</span><b>${summary.published}</b><small>${summary.total - summary.published} bản nháp</small></article>
      <article class="metric-card"><span>Thi thật đang diễn ra</span><b>${summary.real}</b><small>Space có đợt đang hoạt động</small></article>
      <article class="metric-card ${summary.empty ? "attention" : ""}"><span>Chưa có câu hỏi</span><b>${summary.empty}</b><small>Cần bổ sung ngân hàng</small></article>
    </section>
    <section class="panel table-wrap spaces-table"><table>
      <thead><tr><th>Space</th><th>Câu hỏi</th><th>Thi thật</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${state.spaces.map((space) => `<tr>
        <td><button type="button" class="space-name-button" data-space-settings="${space.id}" aria-label="Mở cấu hình ${esc(space.name)}"><b>${esc(space.name)}</b><span>/${esc(space.slug)}</span></button></td>
        <td><span class="table-number">${space.counts.total}</span><br><span class="muted">${space.counts.multi} câu nhiều đáp án</span></td>
        <td><span class="badge ${space.active_real_exam ? "on" : ""}">${space.active_real_exam ? "Đang có Thi thật" : "Không có đợt đang thi"}</span>${space.active_real_exam ? `<br><span class="muted">${esc(space.active_real_exam.name)}</span>` : ""}</td>
        <td><span class="status-pill ${space.published ? "published" : "draft"}">${space.published ? "Đã xuất bản" : "Bản nháp"}</span></td>
        <td class="settings-cell"><div class="space-row-actions">
          <button class="row-primary-action" data-space-settings="${space.id}" title="Cấu hình Space" aria-label="Cấu hình Space"><i data-lucide="settings"></i></button>
          <button class="icon-button" data-share-space="${space.id}" title="Chia sẻ Space" aria-label="Chia sẻ Space"><i data-lucide="share-2"></i></button>
          <button class="icon-button danger" data-delete-space="${space.id}" title="Xóa Space" aria-label="Xóa Space"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`).join("")}</tbody>
    </table></section>`;
    document.getElementById("addSpaceBtn").onclick = () => openSpace();
    bind("[data-share-space]", (button) => openShare(Number(button.dataset.shareSpace)));
    bind("[data-space-settings]", (button) => openSpaceSettings(Number(button.dataset.spaceSettings)));
    bind("[data-delete-space]", (button) => deleteSpace(Number(button.dataset.deleteSpace)));
    window.lucide?.createIcons();
  }

  function bind(selector, handler) {
    document.querySelectorAll(selector).forEach((element) => {
      element.onclick = () => handler(element);
    });
  }

  function openDialog(content, className = "") {
    clearDialogError();
    dialog.className = className;
    dialog.innerHTML = `<div class="dialog-body">${content}</div>`;
    dialog.showModal();
    window.requestAnimationFrame(() => dialog.querySelector("input, select, textarea, button, [tabindex]:not([tabindex='-1'])")?.focus());
  }

  function closeDialog() {
    clearDialogError();
    dialog.close();
    dialog.innerHTML = "";
    dialog.className = "";
  }

  function markSpaceSettingsClean() {
    spaceSettingsDirty = false;
  }

  function confirmSpaceSettingsDiscard(action, onConfirm) {
    if (!spaceSettingsDirty) return onConfirm();
    const confirmation = document.createElement("dialog");
    confirmation.className = "space-settings-discard-dialog";
    confirmation.innerHTML = `<section aria-labelledby="discardSettingsTitle"><span class="warning-label">Thay đổi chưa lưu</span><h2 id="discardSettingsTitle">Rời khỏi màn hình này?</h2><p>Các thông tin bạn vừa nhập sẽ không được lưu.</p><div class="actions"><button type="button" data-cancel>Ở lại</button><button type="button" class="danger" data-confirm>${esc(action)}</button></div></section>`;
    const close = () => confirmation.close();
    confirmation.querySelector("[data-cancel]").onclick = close;
    confirmation.querySelector("[data-confirm]").onclick = () => { confirmation.close(); markSpaceSettingsClean(); onConfirm(); };
    confirmation.addEventListener("close", () => confirmation.remove(), { once: true });
    document.body.append(confirmation);
    confirmation.showModal();
    confirmation.querySelector("[data-cancel]")?.focus();
  }

  function requestSpaceSettingsTab(tab) {
    if (!activeSpaceSettings || activeSpaceSettings.tab === tab) return;
    confirmSpaceSettingsDiscard("Rời màn hình", () => renderSpaceSettingsPanel(activeSpaceSettings.spaceId, tab));
  }

  function requestSpaceSettingsClose() {
    if (!activeSpaceSettings) return closeDialog();
    confirmSpaceSettingsDiscard("Đóng popup", () => {
      activeSpaceSettings = null;
      closeDialog();
    });
  }

  function updateSpaceSettingsNavigation(tab) {
    if (!activeSpaceSettings) return;
    activeSpaceSettings.tab = tab;
    const current = activeSpaceSettings.tabs.findIndex(([key]) => key === tab);
    const previous = dialog.querySelector("#previousSpaceSettingsTab");
    const next = dialog.querySelector("#nextSpaceSettingsTab");
    if (previous) previous.disabled = current <= 0;
    if (next) next.disabled = current === -1 || current >= activeSpaceSettings.tabs.length - 1;
  }

  dialog.addEventListener("input", (event) => {
    if (dialog.classList.contains("space-settings-dialog") && event.target.closest(".space-settings-main")) spaceSettingsDirty = true;
  });
  dialog.addEventListener("change", (event) => {
    if (dialog.classList.contains("space-settings-dialog") && event.target.closest(".space-settings-main")) spaceSettingsDirty = true;
  });
  dialog.addEventListener("cancel", (event) => {
    if (!dialog.classList.contains("space-settings-dialog")) return;
    event.preventDefault();
    requestSpaceSettingsClose();
  });

  function openShare(id) {
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return;
    const url = new URL(encodeURIComponent(space.slug), quizBaseUrl).href;
    openDialog(`<section class="share-dialog" aria-labelledby="shareDialogTitle">
      <div>
        <h2 id="shareDialogTitle">Chia sẻ Space · ${esc(space.name)}</h2>
        <p class="muted">Học viên có thể mở đường dẫn hoặc quét mã bằng điện thoại.</p>
      </div>
      <div class="share-url-block">
        <span>URL tới Space</span>
        <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>
      </div>
      <div class="share-qr-block">
        <span>Quét mã QR</span>
        <div id="spaceQrCode" class="share-qr" aria-label="Mã QR dẫn tới ${esc(url)}"></div>
      </div>
      <div class="actions"><button type="button" data-close>Đóng</button></div>
    </section>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    if (window.QRCode) {
      new QRCode(document.getElementById("spaceQrCode"), {
        text: url,
        width: 300,
        height: 300,
        colorDark: "#182033",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      document.getElementById("spaceQrCode").textContent = "Không thể tạo mã QR.";
    }
  }

  function renderSpaceShareSettings(panel, space) {
    const url = new URL(encodeURIComponent(space.slug), quizBaseUrl).href;
    panel.innerHTML = `<section class="space-share-pane settings-pane" aria-labelledby="spaceShareTitle"><header><div><span class="settings-eyebrow">Chia sẻ Space</span><h2 id="spaceShareTitle">Link dành cho học viên</h2><p class="muted">Quét QR hoặc mở link để vào Space “${esc(space.name)}”.</p></div></header><div class="space-share-content"><div class="share-qr-block"><span>Quét mã QR</span><div id="spaceSettingsQrCode" class="share-qr" aria-label="Mã QR dẫn tới ${esc(url)}"></div></div><div class="share-url-block"><span>URL tới Space</span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></div></div></section>`;
    const qrTarget = panel.querySelector("#spaceSettingsQrCode");
    if (window.QRCode) {
      new QRCode(qrTarget, { text: url, width: 300, height: 300, colorDark: "#182033", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
    } else {
      qrTarget.textContent = "Không thể tạo mã QR.";
    }
  }

  function openSpaceSettings(spaceId, activeTab = "info") {
    const space = state.spaces.find((item) => item.id === spaceId);
    if (!space) return setStatus("Space không tồn tại.", true);
    const canManageResults = state.profile?.role === "superadmin";
    const resolvedTab = activeTab === "results" && !canManageResults ? "info" : activeTab;
    const tabs = [
      ["share", "Chia sẻ Link"],
      ["info", "Sửa thông tin Space"],
      ["groups", "Quản lý nhóm trong Space"],
      ["questions", "Quản lý Ngân hàng câu hỏi"],
      ["real", "Quản lý Đợt thi thật"],
      ...(canManageResults ? [["results", "Thiết lập Database"]] : [])
    ];
    activeSpaceSettings = { spaceId, tabs, tab: resolvedTab };
    markSpaceSettingsClean();
    openDialog(`<section class="space-settings">
      <aside class="space-settings-nav">
        <div>
          <span class="settings-eyebrow">Cấu hình Space</span>
          <h2>${esc(space.name)}</h2>
          <p class="muted">/${esc(space.slug)}</p>
        </div>
        <nav>${tabs.map(([key, label]) => `<button type="button" class="${key === resolvedTab ? "active" : ""}" data-settings-tab="${key}">${label}</button>`).join("")}</nav>
      </aside>
      <div class="space-settings-main" id="spaceSettingsPanel"></div>
      <button type="button" class="space-settings-close" id="closeSpaceSettings" aria-label="Đóng popup">×</button>
      <nav class="space-settings-pagination" aria-label="Điều hướng màn hình"><button type="button" id="previousSpaceSettingsTab" aria-label="Màn hình trước">‹</button><button type="button" id="nextSpaceSettingsTab" aria-label="Màn hình sau">›</button></nav>
    </section>`, "space-settings-dialog");
    bind("[data-settings-tab]", (button) => requestSpaceSettingsTab(button.dataset.settingsTab));
    document.getElementById("closeSpaceSettings").onclick = requestSpaceSettingsClose;
    document.getElementById("previousSpaceSettingsTab").onclick = () => {
      const index = activeSpaceSettings.tabs.findIndex(([key]) => key === activeSpaceSettings.tab);
      if (index > 0) requestSpaceSettingsTab(activeSpaceSettings.tabs[index - 1][0]);
    };
    document.getElementById("nextSpaceSettingsTab").onclick = () => {
      const index = activeSpaceSettings.tabs.findIndex(([key]) => key === activeSpaceSettings.tab);
      if (index >= 0 && index < activeSpaceSettings.tabs.length - 1) requestSpaceSettingsTab(activeSpaceSettings.tabs[index + 1][0]);
    };
    window.lucide?.createIcons();
    renderSpaceSettingsPanel(spaceId, resolvedTab);
  }

  async function renderSpaceSettingsPanel(spaceId, tab) {
    clearDialogError();
    const space = state.spaces.find((item) => item.id === spaceId);
    const panel = document.getElementById("spaceSettingsPanel");
    if (!space || !panel) return;
    if (tab === "results" && state.profile?.role !== "superadmin") {
      return renderSpaceSettingsPanel(spaceId, "info");
    }
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.settingsTab === tab);
    });
    updateSpaceSettingsNavigation(tab);
    if (tab === "share") return renderSpaceShareSettings(panel, space);
    if (tab === "info") return renderSpaceInfoSettings(panel, spaceId, space);
    if (tab === "groups") return renderGroupSettings(panel, spaceId, space);
    if (tab === "questions") return renderQuestionSettings(panel, spaceId, space);
    if (tab === "real") return renderRealExamSettings(panel, spaceId, space);
    if (tab === "results") return renderResultSettings(panel, spaceId, space);
  }

  function renderSpaceInfoSettings(panel, id, space) {
    panel.innerHTML = `<form id="spaceForm" class="grid compact-dialog-form settings-pane">
      <h2>Sửa thông tin Space</h2>
      <div class="grid two">
        <label>Tên Space<input name="name" value="${esc(space.name)}" required></label>
        <label>Timer mặc định<input name="timer_seconds" type="number" min="1" value="${space.timer_seconds}" required></label>
      </div>
      <div class="path-field-row">
        <label>Đường dẫn<input id="spaceSlugInput" name="slug" value="${esc(space.slug)}" pattern="[a-z0-9-]+" required></label>
        <div class="path-example path-example-inline"><span>Ví dụ</span><code>&lt;Đường dẫn của ứng dụng&gt;/&lt;Slug&gt;</code><small id="spaceUrlPreview">${esc(new URL(encodeURIComponent(space.slug || "slug"), quizBaseUrl).href)}</small></div>
      </div>
      <label class="switch publish-switch"><input name="published" type="checkbox" ${space.published ? "checked" : ""}><span class="switch-track"></span><span>Đã xuất bản</span></label>
      <div class="settings-save"><button class="primary">Lưu thay đổi</button><button type="button" data-close>Đóng</button></div>
    </form>`;
    bindPanelCloseButtons(panel);
    document.getElementById("spaceSlugInput").oninput = (event) => {
      document.getElementById("spaceUrlPreview").textContent = new URL(
        encodeURIComponent(event.target.value || "slug"),
        quizBaseUrl
      ).href;
    };
    document.getElementById("spaceForm").onsubmit = (event) => saveSpace(event, id);
  }

  async function renderGroupSettings(panel, spaceId, space) {
    panel.innerHTML = loadingPanel("Đang tải danh sách nhóm");
    const { data, error } = await client.from("groups").select("*").eq("space_id", spaceId).order("name");
    if (error) return showDialogError(error.message);
    const groups = [...(data || [])].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
    panel.innerHTML = `<section class="grid settings-pane">
      <h2>Quản lý nhóm trong Space</h2>
      <form id="addGroupForm" class="group-add-form">
        <label>Thêm nhóm mới<input name="name" placeholder="Tên Group mới" required></label>
        <button class="primary">Thêm</button>
      </form>
      <div id="groupList" class="group-settings-list">${groups.map((group) => `<div class="group-settings-item"><b>${esc(group.name)}</b><div class="group-card-actions"><button type="button" class="link-button" data-rename-group="${group.id}">Sửa</button><button type="button" class="link-button danger" data-delete-group="${group.id}">Xóa</button></div></div>`).join("") || '<p class="muted">Chưa có nhóm.</p>'}</div>
      <div class="settings-save"><button type="button" class="primary" data-close>Hoàn tất</button><button type="button" data-close>Đóng</button></div>
    </section>`;
    document.getElementById("addGroupForm").onsubmit = async (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name").trim();
      const { error: insertError } = await client.from("groups").insert({ space_id: spaceId, name });
      if (insertError) return showDialogError(insertError.message);
      await renderGroupSettings(panel, spaceId, space);
    };
    bind("[data-rename-group]", async (button) => {
      const group = groups.find((item) => item.id === Number(button.dataset.renameGroup));
      const name = prompt("Tên Group mới", group.name)?.trim();
      if (!name) return;
      const { error: updateError } = await client.from("groups").update({ name }).eq("id", group.id);
      if (updateError) return showDialogError(updateError.message);
      await renderGroupSettings(panel, spaceId, space);
    });
    bind("[data-delete-group]", async (button) => {
      if (groups.length <= 1) return showDialogError("Space phải có ít nhất 1 Group.");
      const group = groups.find((item) => item.id === Number(button.dataset.deleteGroup));
      if (!group || !confirm("Xóa Group này? Dữ liệu đã dùng Group này sẽ được bỏ trống tên Group.")) return;
      const { error: deleteError } = await client.from("groups").delete().eq("id", group.id);
      if (deleteError) return showDialogError(deleteError.message);
      await renderGroupSettings(panel, spaceId, space);
    });
    bindPanelCloseButtons(panel);
  }

  async function loadQuestionSets(spaceId) {
    let setQuery = client.from("question_sets").select("*").eq("space_id", spaceId).order("name");
    let questionQuery = client.from("questions").select("id,type,question_set_id,hidden_at,permanent_hidden").eq("space_id", spaceId);
    const [{ data: sets, error: setError }, { data: questions, error: questionError }] = await Promise.all([
      setQuery,
      questionQuery
    ]);
    if (setError) throw setError;
    if (questionError) throw questionError;

    const setsList = sets || [];
    const hiddenSetIds = new Set(setsList.filter(s => s.hidden_at !== null).map(s => s.id));

    const counts = new Map();
    (questions || []).forEach((question) => {
      const key = question.question_set_id || 0;
      const isQuestionActive = question.hidden_at === null;
      const isRestorableHiddenQuestion = question.hidden_at !== null &&
                                         hiddenSetIds.has(key) &&
                                         !question.permanent_hidden;
      if (isQuestionActive || isRestorableHiddenQuestion) {
        const current = counts.get(key) || { total: 0, multi: 0 };
        current.total += 1;
        if (question.type === "multi") current.multi += 1;
        counts.set(key, current);
      }
    });
    return setsList.map((set) => ({ ...set, counts: counts.get(set.id) || { total: 0, multi: 0 } }));
  }

  function isRealExamRunning(space) {
    return Boolean(space.active_real_exam?.manual_running);
  }

  function formatAdminDateTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Chưa cấu hình";
    return date.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function questionWizardProgress(currentStep) {
    const labels = ["Chọn ngân hàng", "Chọn thao tác", "Thực hiện"];
    return `<ol class="question-wizard-steps" aria-label="Tiến trình quản lý ngân hàng câu hỏi">
      ${labels.map((label, index) => {
        const step = index + 1;
        return `<li class="${step === currentStep ? "current" : ""} ${step < currentStep ? "complete" : ""}" ${step === currentStep ? 'aria-current="step"' : ""}>
          <span>${step < currentStep ? "✓" : step}</span><b>${label}</b>
        </li>`;
      }).join("")}
    </ol>`;
  }

  function questionWizardNotice(flow) {
    if (!flow.message) return "";
    return `<div class="question-wizard-notice ${flow.messageTone === "error" ? "error" : ""}" role="${flow.messageTone === "error" ? "alert" : "status"}" aria-live="polite">${esc(flow.message)}</div>`;
  }

  async function closeQuestionWizard() {
    closeDialog();
    await renderSpaces();
  }

  async function renderQuestionSettings(panel, spaceId, space, inputFlow = {}) {
    clearDialogError();
    const flow = {
      step: Number(inputFlow.step) || 1,
      mode: inputFlow.mode || "",
      selectedSetId: inputFlow.selectedSetId ? Number(inputFlow.selectedSetId) : null,
      confirmation: inputFlow.confirmation || "",
      message: inputFlow.message || "",
      messageTone: inputFlow.messageTone || "",
      questionPage: Math.max(1, Number(inputFlow.questionPage) || 1),
      questionDeleteId: inputFlow.questionDeleteId ? Number(inputFlow.questionDeleteId) : null,
      selectedQuestionIds: Array.isArray(inputFlow.selectedQuestionIds) ? inputFlow.selectedQuestionIds.map(Number).filter(Number.isFinite) : [],
      questionEditorMode: inputFlow.questionEditorMode || "",
      questionId: inputFlow.questionId ? Number(inputFlow.questionId) : null
    };
    panel.innerHTML = loadingPanel("Đang tải ngân hàng câu hỏi");
    let sets;
    try {
      const nowIso = new Date().toISOString();
      const [
        loadedSets,
        { data: latestExamState, error: examStateError },
        { data: activeRealExam, error: activeRealExamError }
      ] = await Promise.all([
        loadQuestionSets(spaceId),
        client
          .from("spaces")
          .select("real_exam_enabled,real_exam_name,real_start_at,real_end_at,real_question_sets")
          .eq("id", spaceId)
          .single(),
        client
          .from("real_exams")
          .select("id,name,start_at,end_at,manual_running,real_exam_sources(question_set_id)")
          .eq("space_id", spaceId)
          .is("hidden_at", null)
          .is("ended_at", null)
          .lte("start_at", nowIso)
          .gte("end_at", nowIso)
          .limit(1)
          .maybeSingle()
      ]);
      if (examStateError) throw examStateError;
      if (activeRealExamError) throw activeRealExamError;
      sets = loadedSets;
      Object.assign(space, latestExamState || {});
      space.active_real_exam = activeRealExam || null;
      if (activeRealExam) {
        space.real_exam_name = activeRealExam.name;
        space.real_start_at = activeRealExam.start_at;
        space.real_end_at = activeRealExam.end_at;
      }
    } catch (error) {
      return showDialogError(error.message || "Không tải được ngân hàng câu hỏi.");
    }
    const selectedSet = sets.find((set) => Number(set.id) === flow.selectedSetId) || null;
    if (!selectedSet && flow.step > 1) {
      flow.step = 1;
      flow.mode = "";
      flow.selectedSetId = null;
      flow.confirmation = "";
    }
    const activeSet = sets.find((set) => Number(set.id) === flow.selectedSetId) || null;
    const activeRealExamSources = space.active_real_exam?.real_exam_sources || [];
    const lockedSetIds = new Set(activeRealExamSources.map(s => Number(s.question_set_id)));
    const isCurrentSetLocked = activeSet && isRealExamRunning(space) && lockedSetIds.has(Number(activeSet.id));
    if (isCurrentSetLocked) flow.confirmation = "";
    // real_exam_sources is the canonical source configuration. Do not use the legacy
    // spaces.real_question_sets field here: it can be stale and produce false badges.
    const realSetIds = isRealExamRunning(space) ? lockedSetIds : new Set();
    const setIsUsedForRealExam = activeSet ? realSetIds.has(Number(activeSet.id)) : false;
    const on = (selector, handler) => {
      panel.querySelectorAll(selector).forEach((element) => {
        element.onclick = () => handler(element);
      });
    };
    const renderNext = (changes) => renderQuestionSettings(panel, spaceId, space, { ...flow, ...changes });

    if (flow.step === 1) {
      panel.innerHTML = `<section class="question-wizard settings-pane" aria-labelledby="questionWizardTitle">
        <header class="question-wizard-header">
          <div><span class="settings-eyebrow">Ngân hàng câu hỏi</span><h2 id="questionWizardTitle">Chọn ngân hàng cần quản lý</h2></div>
          <p class="muted">Chọn một ngân hàng có sẵn hoặc tạo ngân hàng mới để tiếp tục.</p>
        </header>
        ${questionWizardProgress(1)}
        ${questionWizardNotice(flow)}
        <section class="question-wizard-section">
          <div class="question-wizard-section-heading">
            <div><h3>Ngân hàng trong Space</h3><p class="muted">${sets.length} ngân hàng câu hỏi</p></div>
          </div>
          <div class="question-bank-list" aria-label="Danh sách ngân hàng câu hỏi">
            ${sets.map((set) => {
              const isHidden = set.hidden_at !== null;
              return `<button type="button" class="question-bank-row${isHidden ? " hidden-bank" : ""}" data-select-question-set="${set.id}">
                <span class="question-bank-icon"><i data-lucide="${isHidden ? "archive" : "library-big"}" aria-hidden="true"></i></span>
                <span class="question-bank-copy">
                  <b>${esc(set.name)} ${isHidden ? '<span class="status-badge hidden-badge">Đã ẩn</span>' : ""}</b>
                  <span>${set.counts.total} câu hỏi · ${set.counts.multi} câu nhiều đáp án</span>
                </span>
                <span class="question-bank-trailing">
                  ${realSetIds.has(Number(set.id)) ? '<span class="question-bank-usage">Đang dùng cho Thi thật</span>' : ""}
                  <i class="question-bank-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
                </span>
              </button>`;
            }).join("") || '<div class="question-bank-empty"><b>Chưa có ngân hàng câu hỏi</b><span>Tạo ngân hàng đầu tiên để bắt đầu.</span></div>'}
          </div>
        </section>
        <form id="addQuestionSetForm" class="question-bank-create">
          <label for="newQuestionSetName">Tạo ngân hàng mới</label>
          <div><input id="newQuestionSetName" name="name" placeholder="Ví dụ: Kiến thức cơ bản" required><button class="primary">Tạo mới</button></div>
        </form>
        <footer class="question-wizard-footer">
          <button type="button" data-close>Đóng</button>
        </footer>
      </section>`;
      window.lucide?.createIcons();
      panel.querySelector("#addQuestionSetForm").onsubmit = async (event) => {
        event.preventDefault();
        const button = event.target.querySelector("button");
        const name = String(new FormData(event.target).get("name") || "").trim();
        if (!name) return;
        const restoreButton = setButtonBusy(button, "Đang tạo...");
        try {
          const { data, error } = await client.from("question_sets").insert({ space_id: spaceId, name }).select("id").single();
          if (error) throw error;
          await renderNext({
            selectedSetId: data.id,
            step: 2,
            message: `Đã tạo ngân hàng “${name}”.`,
            messageTone: ""
          });
        } catch (error) {
          showDialogError(error.message || "Không thể tạo ngân hàng câu hỏi.");
        } finally {
          restoreButton();
        }
      };
      on("[data-select-question-set]", (button) => renderNext({
        selectedSetId: Number(button.dataset.selectQuestionSet),
        step: 2,
        message: "",
        messageTone: "",
        selectedQuestionIds: []
      }));
      panel.querySelector("[data-close]").onclick = closeQuestionWizard;
      return;
    }

    if (flow.step === 2) {
      const deleteDisabled = sets.filter((set) => set.hidden_at === null).length <= 1;
      let confirmation = "";
      if (flow.confirmation === "clear") {
        confirmation = `<section class="question-inline-confirmation" aria-labelledby="clearQuestionsTitle">
          <span class="danger-label">Xác nhận xóa</span>
          <h3 id="clearQuestionsTitle">Xóa ${activeSet.counts.total} câu hỏi trong “${esc(activeSet.name)}”?</h3>
          <p>Ngân hàng vẫn được giữ lại. Câu hỏi sẽ vào Thùng rác trong 30 ngày; đề thi và kết quả đã tạo vẫn được bảo toàn.</p>
          <div class="actions"><button type="button" data-cancel-confirmation>Hủy</button><button type="button" class="danger" id="confirmClearQuestions">Xóa câu hỏi</button></div>
        </section>`;
      }
      if (flow.confirmation === "delete-first") {
        confirmation = `<section class="question-inline-confirmation" aria-labelledby="deleteBankFirstTitle">
          <span class="danger-label">Xác nhận 1/2</span>
          <h3 id="deleteBankFirstTitle">Xóa ngân hàng “${esc(activeSet.name)}”?</h3>
          <p>Ngân hàng và ${activeSet.counts.total} câu hỏi sẽ vào Thùng rác trong 30 ngày. Dữ liệu lịch sử của các Đợt thi đã tạo vẫn được giữ.</p>
          <div class="actions"><button type="button" data-cancel-confirmation>Hủy</button><button type="button" class="danger" id="continueDeleteBank">Tôi hiểu, tiếp tục</button></div>
        </section>`;
      }
      if (flow.confirmation === "delete-final") {
        confirmation = `<section class="question-inline-confirmation" aria-labelledby="deleteBankFinalTitle">
          <span class="danger-label">Xác nhận 2/2</span>
          <h3 id="deleteBankFinalTitle">Nhập chính xác tên ngân hàng để xác nhận</h3>
          <p>Nhập <b>${esc(activeSet.name)}</b> vào ô bên dưới.</p>
          <label for="confirmQuestionSetName">Tên ngân hàng<input id="confirmQuestionSetName" autocomplete="off"></label>
          <div class="actions"><button type="button" data-cancel-confirmation>Hủy</button><button type="button" class="danger" id="confirmDeleteBank" disabled>Xóa ngân hàng và câu hỏi</button></div>
        </section>`;
      }
      const isSetHidden = activeSet.hidden_at !== null;
      panel.innerHTML = `<section class="question-wizard settings-pane" aria-labelledby="questionWizardTitle">
        <header class="question-wizard-header">
          <div><span class="settings-eyebrow">Ngân hàng đã chọn</span><h2 id="questionWizardTitle">${esc(activeSet.name)}</h2></div>
          <div class="question-bank-summary"><b>${activeSet.counts.total}</b><span>câu hỏi</span><b>${activeSet.counts.multi}</b><span>nhiều đáp án</span></div>
        </header>
        ${questionWizardProgress(2)}
        ${questionWizardNotice(flow)}
        ${isCurrentSetLocked ? `<section class="question-real-exam-lock" role="status" aria-labelledby="realExamDeleteLockTitle">
          <div>
            <span class="warning-label">Đang khóa thao tác xóa</span>
            <h3 id="realExamDeleteLockTitle">${esc(space.real_exam_name || "Đợt thi thật")} đang diễn ra</h3>
            <p>Từ ${esc(formatAdminDateTime(space.real_start_at))} đến ${esc(formatAdminDateTime(space.real_end_at))}. Không thể xóa câu hỏi hoặc ngân hàng trong Space này cho đến khi đợt thi kết thúc.</p>
          </div>
          <button type="button" id="openRealExamSettings">Mở cấu hình Đợt thi thật</button>
        </section>` : ""}
        ${confirmation || (isSetHidden ? `<section class="question-action-group" aria-labelledby="manageQuestionBankTitle">
          <div><h3 id="manageQuestionBankTitle">Quản lý ngân hàng (Đã ẩn)</h3><p class="muted">Ngân hàng câu hỏi này đang bị ẩn.</p></div>
          <div class="question-action-list">
            <button type="button" class="question-action-row" id="unhideQuestionSet">
              <span class="question-action-icon"><i data-lucide="rotate-ccw" aria-hidden="true"></i></span><span><b>Khôi phục ngân hàng câu hỏi</b><small>Bỏ ẩn ngân hàng này và phục hồi các câu hỏi hợp lệ bên trong</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="question-action-row" id="exportQuestionsBtn" ${activeSet.counts.total ? "" : "disabled"}>
              <span class="question-action-icon"><i data-lucide="download" aria-hidden="true"></i></span><span><b>Tải về ngân hàng câu hỏi</b><small>${activeSet.counts.total ? "Xuất toàn bộ câu hỏi của ngân hàng thành CSV" : "Ngân hàng chưa có câu hỏi để tải"}</small></span><i class="question-action-arrow" data-lucide="download" aria-hidden="true"></i>
            </button>
          </div>
        </section>` : `<section class="question-action-group" aria-labelledby="manageQuestionBankTitle">
          <div><h3 id="manageQuestionBankTitle">Quản lý ngân hàng</h3><p class="muted">Chọn một thao tác để tiếp tục.</p></div>
          <div class="question-action-list">
            <button type="button" class="question-action-row" id="editQuestionSet">
              <span class="question-action-icon"><i data-lucide="pencil" aria-hidden="true"></i></span><span><b>Sửa tên ngân hàng câu hỏi</b><small>Đổi tên ngân hàng câu hỏi</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="question-action-row" id="uploadQuestionSet">
              <span class="question-action-icon"><i data-lucide="upload" aria-hidden="true"></i></span><span><b>Upload câu hỏi</b><small>Thêm câu hỏi từ tệp CSV vào ngân hàng này</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="question-action-row" id="manageQuestions">
              <span class="question-action-icon"><i data-lucide="list-checks" aria-hidden="true"></i></span><span><b>Thêm / Sửa / Xóa câu hỏi</b><small>Xem, thêm mới, sao chép, sửa và đưa từng câu hỏi vào Thùng rác</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="question-action-row" id="exportQuestionsBtn" ${activeSet.counts.total ? "" : "disabled"}>
              <span class="question-action-icon"><i data-lucide="download" aria-hidden="true"></i></span><span><b>Tải về ngân hàng câu hỏi</b><small>${activeSet.counts.total ? "Xuất toàn bộ câu hỏi của ngân hàng thành CSV" : "Ngân hàng chưa có câu hỏi để tải"}</small></span><i class="question-action-arrow" data-lucide="download" aria-hidden="true"></i>
            </button>
          </div>
        </section>
        <section class="question-danger-zone" aria-labelledby="questionDangerTitle">
          <div><span class="danger-label">Khu vực xóa</span><h3 id="questionDangerTitle">Đưa vào Thùng rác</h3></div>
          <div class="question-action-list">
            <button type="button" class="question-action-row danger-row" id="clearQuestions" ${activeSet.counts.total && !isCurrentSetLocked ? "" : "disabled"}>
              <span class="question-action-icon"><i data-lucide="trash-2" aria-hidden="true"></i></span><span><b>Xóa toàn bộ câu hỏi</b><small>${isCurrentSetLocked ? "Bị khóa trong thời gian Đợt thi thật diễn ra" : `Có thể khôi phục trong 30 ngày; giữ lại ngân hàng “${esc(activeSet.name)}”`}</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="question-action-row danger-row" id="deleteQuestionSet" ${deleteDisabled || isCurrentSetLocked ? "disabled" : ""}>
              <span class="question-action-icon"><i data-lucide="folder-x" aria-hidden="true"></i></span><span><b>Xóa ngân hàng câu hỏi</b><small>${isCurrentSetLocked ? "Bị khóa trong thời gian Đợt thi thật diễn ra" : deleteDisabled ? "Space phải có ít nhất một ngân hàng" : `Có thể khôi phục trong 30 ngày`}</small></span><i class="question-action-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
            </button>
          </div>
        </section>`)}
        <footer class="question-wizard-footer">
          <button type="button" id="backToQuestionSets">Quay lại</button>
          <button type="button" data-close>Đóng</button>
        </footer>
      </section>`;
      window.lucide?.createIcons();
      panel.querySelector("#backToQuestionSets").onclick = () => renderNext({ step: 1, confirmation: "", message: "" });
      panel.querySelector("[data-close]").onclick = closeQuestionWizard;
      const openRealExamSettings = panel.querySelector("#openRealExamSettings");
      if (openRealExamSettings) {
        openRealExamSettings.onclick = () => renderSpaceSettingsPanel(spaceId, "real");
      }
      on("[data-cancel-confirmation]", () => renderNext({ confirmation: "" }));
      if (confirmation) {
        if (flow.confirmation === "clear") {
          panel.querySelector("#confirmClearQuestions").onclick = async (event) => {
            const deleted = await deleteAllQuestions(spaceId, activeSet.id, event.currentTarget, { confirmed: true, preserveDialog: true });
            if (deleted) await renderNext({ confirmation: "", message: `Đã xóa ${activeSet.counts.total} câu hỏi vào Thùng rác trong 30 ngày. Ngân hàng vẫn được giữ lại.` });
          };
        }
        if (flow.confirmation === "delete-first") {
          panel.querySelector("#continueDeleteBank").onclick = () => renderNext({ confirmation: "delete-final" });
        }
        if (flow.confirmation === "delete-final") {
          const input = panel.querySelector("#confirmQuestionSetName");
          const button = panel.querySelector("#confirmDeleteBank");
          input.oninput = () => {
            button.disabled = input.value !== activeSet.name;
          };
          button.onclick = async () => {
            const restoreButton = setButtonBusy(button, "Đang xóa...");
            try {
              const { data, error } = await client.rpc("delete_question_set_cascade", {
                target_question_set_id: activeSet.id
              });
              if (error) throw error;
              const deletedCount = Number(data?.archived_questions ?? data?.deleted_questions ?? activeSet.counts.total);
              await renderQuestionSettings(panel, spaceId, space, {
                step: 1,
                message: `Đã xóa ngân hàng “${activeSet.name}” và ${deletedCount} câu hỏi vào Thùng rác trong 30 ngày.`
              });
            } catch (error) {
              showDialogError(error.message || "Không thể xóa ngân hàng câu hỏi.");
            } finally {
              restoreButton();
            }
          };
        }
        return;
      }
      if (isSetHidden) {
        const unhideBtn = panel.querySelector("#unhideQuestionSet");
        if (unhideBtn) {
          unhideBtn.onclick = async () => {
            const restore = setButtonBusy(unhideBtn, "Đang khôi phục...");
            try {
              const { error } = await client.rpc("unhide_question_set", {
                target_question_set_id: activeSet.id
              });
              if (error) throw error;
              await renderQuestionSettings(panel, spaceId, space, {
                step: 1,
                message: `Đã khôi phục ngân hàng “${activeSet.name}”.`
              });
            } catch (error) {
              showDialogError(error.message || "Không thể khôi phục ngân hàng câu hỏi.");
            } finally {
              restore();
            }
          };
        }
        const exportBtn = panel.querySelector("#exportQuestionsBtn");
        if (exportBtn) {
          exportBtn.onclick = async () => {
            const count = await exportQuestions(spaceId, space.slug, activeSet.id, { preserveDialog: true });
            if (count) await renderNext({ message: `Đã tải ${count} câu hỏi từ “${activeSet.name}”.` });
          };
        }
        return;
      }
      panel.querySelector("#editQuestionSet").onclick = () => renderNext({ step: 3, mode: "edit", message: "" });
      panel.querySelector("#uploadQuestionSet").onclick = () => renderNext({ step: 3, mode: "upload", message: "" });
      panel.querySelector("#manageQuestions").onclick = () => renderNext({ step: 3, mode: "questions", questionPage: 1, message: "" });
      panel.querySelector("#exportQuestionsBtn").onclick = async () => {
        const count = await exportQuestions(spaceId, space.slug, activeSet.id, { preserveDialog: true });
        if (count) await renderNext({ message: `Đã tải ${count} câu hỏi từ “${activeSet.name}”.` });
      };
      panel.querySelector("#clearQuestions").onclick = () => renderNext({ confirmation: "clear", message: "" });
      panel.querySelector("#deleteQuestionSet").onclick = () => renderNext({ confirmation: "delete-first", message: "" });
      return;
    }

    if (flow.mode === "questions") {
      return renderQuestionManager(panel, spaceId, space, activeSet, flow, renderNext, isCurrentSetLocked);
    }

    const isEdit = flow.mode === "edit";
    panel.innerHTML = `<section class="question-wizard settings-pane" aria-labelledby="questionWizardTitle">
      <header class="question-wizard-header">
        <div><span class="settings-eyebrow">${esc(activeSet.name)}</span><h2 id="questionWizardTitle">${isEdit ? "Sửa tên ngân hàng câu hỏi" : "Upload câu hỏi"}</h2></div>
        <p class="muted">${isEdit ? "Cập nhật tên hiển thị của ngân hàng câu hỏi." : "Tệp hợp lệ sẽ được thêm vào ngân hàng hiện tại, không thay thế câu hỏi cũ."}</p>
      </header>
      ${questionWizardProgress(3)}
      ${isEdit ? `<form id="editQuestionSetForm" class="question-wizard-form">
        <label for="questionSetName">Tên ngân hàng câu hỏi<input id="questionSetName" name="name" value="${esc(activeSet.name)}" required></label>
        <dl class="question-bank-details">
          <div><dt>Tổng câu hỏi</dt><dd>${activeSet.counts.total}</dd></div>
          <div><dt>Câu nhiều đáp án</dt><dd>${activeSet.counts.multi}</dd></div>
          <div><dt>Dùng cho Thi thật</dt><dd>${setIsUsedForRealExam ? "Có" : "Không"}</dd></div>
        </dl>
        <footer class="question-wizard-footer">
          <button type="button" data-back-actions>Quay lại</button>
          <button class="primary">Lưu thay đổi</button>
        </footer>
      </form>` : `<section class="question-upload-form">
        <label class="question-upload-dropzone" for="csvFile">
          <b>Chọn tệp CSV</b>
          <span>Tệp cần có các cột nội dung, đáp án A–E và đáp án đúng.</span>
          <input id="csvFile" type="file" accept=".csv,text/csv">
        </label>
        <p class="question-upload-capacity">Không giới hạn 20 câu mỗi lần. Ứng dụng sẽ nhập toàn bộ dòng hợp lệ trong tệp.</p>
        <div id="csvPreview" class="question-upload-preview muted" role="status" aria-live="polite">Chưa chọn tệp.</div>
        <footer class="question-wizard-footer">
          <button type="button" data-back-actions>Quay lại</button>
          <button type="button" class="primary" id="importCsvBtn" disabled>Thêm câu hỏi</button>
        </footer>
      </section>`}
    </section>`;
    panel.querySelector("[data-back-actions]").onclick = () => renderNext({ step: 2, mode: "", message: "" });
    if (isEdit) {
      panel.querySelector("#editQuestionSetForm").onsubmit = async (event) => {
        event.preventDefault();
        const button = event.submitter;
        const name = String(new FormData(event.target).get("name") || "").trim();
        const restoreButton = setButtonBusy(button, "Đang lưu...");
        try {
          const { error } = await client.from("question_sets").update({ name }).eq("id", activeSet.id).eq("space_id", spaceId);
          if (error) throw error;
          await renderNext({ step: 2, mode: "", message: `Đã đổi tên ngân hàng thành “${name}”.` });
        } catch (error) {
          showDialogError(error.message || "Không thể cập nhật ngân hàng câu hỏi.");
        } finally {
          restoreButton();
        }
      };
      return;
    }
    let parsedQuestions = [];
    const fileInput = panel.querySelector("#csvFile");
    const preview = panel.querySelector("#csvPreview");
    const importButton = panel.querySelector("#importCsvBtn");
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      parsedQuestions = [];
      importButton.disabled = true;
      importButton.textContent = "Thêm câu hỏi";
      if (!file) {
        preview.className = "question-upload-preview muted";
        preview.textContent = "Chưa chọn tệp.";
        return;
      }
      preview.className = "question-upload-preview muted";
      preview.textContent = `Đang đọc ${file.name}...`;
      Papa.parse(file, {
        complete: (result) => {
          try {
            parsedQuestions = parseQuestions(result.data);
            const multiCount = parsedQuestions.filter((question) => question.type === "multi").length;
            preview.className = "question-upload-preview valid";
            preview.innerHTML = `<b>${esc(file.name)}</b><span>${parsedQuestions.length} câu hợp lệ · ${multiCount} câu nhiều đáp án</span>`;
            importButton.disabled = false;
            importButton.textContent = `Thêm ${parsedQuestions.length} câu hỏi`;
          } catch (error) {
            parsedQuestions = [];
            preview.className = "question-upload-preview error";
            preview.textContent = error.message;
          }
        },
        error: () => {
          parsedQuestions = [];
          importButton.disabled = true;
          importButton.textContent = "Thêm câu hỏi";
          preview.className = "question-upload-preview error";
          preview.textContent = "Không thể đọc tệp CSV.";
        }
      });
    };
    importButton.onclick = async () => {
      const inserted = await importQuestions(spaceId, parsedQuestions, activeSet.id, importButton, { preserveDialog: true });
      if (inserted) await renderNext({ step: 2, mode: "", message: `Đã thêm ${inserted} câu hỏi vào “${activeSet.name}”.` });
    };
  }

  const questionOptionLetters = ["A", "B", "C", "D", "E"];

  function questionTypeIcon(type) {
    return type === "multi" ? "list-checks" : "circle-dot";
  }

  function questionExcerpt(content, limit = 256) {
    const value = String(content || "");
    return value.length > limit ? `${value.slice(0, limit)}....` : value;
  }

  function openQuestionPreview(question) {
    const answerSet = new Set(Array.isArray(question.correct_json) ? question.correct_json : []);
    const preview = document.createElement("dialog");
    preview.className = "question-preview-dialog";
    preview.innerHTML = `<section aria-labelledby="questionPreviewTitle">
      <header><div><span class="settings-eyebrow">${question.type === "multi" ? "Nhiều đáp án" : "Một đáp án"}</span><h2 id="questionPreviewTitle">Câu hỏi #${esc(question.question_code || question.id)}</h2></div><button type="button" aria-label="Đóng">×</button></header>
      <p class="question-preview-content">${esc(question.content)}</p>
      <ol class="question-preview-options">${Object.entries(question.options_json || {}).map(([letter, text]) => `<li class="${answerSet.has(letter) ? "correct" : ""}"><b>${esc(letter)}</b><span>${esc(text)}</span>${answerSet.has(letter) ? '<em>Đáp án đúng</em>' : ""}</li>`).join("")}</ol>
      <footer><button type="button" class="primary">Đóng</button></footer>
    </section>`;
    const close = () => preview.close();
    preview.querySelectorAll("button").forEach((button) => { button.onclick = close; });
    preview.addEventListener("close", () => preview.remove(), { once: true });
    document.body.append(preview);
    preview.showModal();
    preview.querySelector("button")?.focus();
  }

  async function renderQuestionManager(panel, spaceId, space, activeSet, flow, renderNext, isCurrentSetLocked) {
    const pageSize = 20;
    panel.innerHTML = loadingPanel("Đang tải danh sách câu hỏi");
    const page = flow.questionPage;
    const from = (page - 1) * pageSize;
    const { data: questions, error, count } = await client
      .from("questions")
      .select("id,question_code,type,content,options_json,correct_json,order_no", { count: "exact" })
      .eq("space_id", spaceId)
      .eq("question_set_id", activeSet.id)
      .is("hidden_at", null)
      .order("order_no")
      .range(from, from + pageSize - 1);
    if (error) return showDialogError(error.message || "Không tải được danh sách câu hỏi.");
    const total = Number(count || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) return renderNext({ questionPage: totalPages, questionDeleteId: null });
    const deleting = (questions || []).find((item) => Number(item.id) === flow.questionDeleteId);
    const selectedIds = [...new Set(flow.selectedQuestionIds)];
    const selectedIdSet = new Set(selectedIds);
    panel.innerHTML = `<section class="question-wizard settings-pane question-manager" aria-labelledby="questionWizardTitle">
      <header class="question-wizard-header">
        <div><span class="settings-eyebrow">${esc(activeSet.name)}</span><h2 id="questionWizardTitle">Câu hỏi trong ngân hàng</h2></div>
        <div class="question-manager-actions"><button type="button" id="addBatchQuestions" ${isCurrentSetLocked ? "disabled" : ""}>Thêm nhiều câu hỏi</button><button type="button" class="primary" id="addQuestion" ${isCurrentSetLocked ? "disabled" : ""}>Thêm câu hỏi</button></div>
      </header>
      ${questionWizardProgress(3)}
      ${questionWizardNotice(flow)}
      ${isCurrentSetLocked ? '<p class="question-manager-lock" role="status">Ngân hàng đang là nguồn của Đợt thi thật diễn ra; chỉ có thể xem câu hỏi.</p>' : ""}
      ${deleting ? `<section class="question-inline-confirmation" aria-labelledby="deleteQuestionTitle"><span class="danger-label">Xác nhận xóa</span><h3 id="deleteQuestionTitle">Đưa câu hỏi này vào Thùng rác?</h3><p>Câu hỏi được lưu trữ trong 30 ngày. Đề thi và kết quả đã tạo vẫn được bảo toàn.</p><div class="actions"><button type="button" id="cancelQuestionDelete">Hủy</button><button type="button" class="danger" id="confirmQuestionDelete">Xóa câu hỏi</button></div></section>` : ""}
      <div class="question-list-meta"><span>${total} câu hỏi</span><span class="question-list-bulk"><span id="selectedQuestionCount">Đã chọn ${selectedIds.length}</span><button type="button" id="clearSelectedQuestions" ${selectedIds.length && !isCurrentSetLocked ? "" : "disabled"}>Bỏ chọn</button><button type="button" class="danger" id="deleteSelectedQuestions" ${selectedIds.length && !isCurrentSetLocked ? "" : "disabled"}>Xóa đã chọn</button><span>Trang ${page} / ${totalPages}</span></span></div>
      <div class="question-manager-list" aria-label="Danh sách câu hỏi">${(questions || []).map((question, index) => { const optionCount = Object.keys(question.options_json || {}).length; return `<article class="question-list-row"><label class="question-select-control"><input type="checkbox" data-select-question="${question.id}" ${selectedIdSet.has(Number(question.id)) ? "checked" : ""} ${isCurrentSetLocked ? "disabled" : ""}><span class="sr-only">Chọn câu hỏi ${from + index + 1}</span></label><button type="button" class="question-list-copy" data-view-question="${question.id}" aria-label="Xem chi tiết câu hỏi ${from + index + 1}"><span class="question-list-number">${from + index + 1}</span><i class="question-type-icon" data-lucide="${questionTypeIcon(question.type)}" aria-hidden="true"></i><span><span class="question-list-title">${esc(questionExcerpt(question.content))}</span><small>#${esc(question.question_code || question.id)} · ${optionCount} đáp án</small></span></button><div class="question-list-actions"><button type="button" class="icon-button" data-edit-question="${question.id}" ${isCurrentSetLocked ? "disabled" : ""} aria-label="Sửa câu hỏi ${from + index + 1}" title="Sửa"><i data-lucide="pencil" aria-hidden="true"></i></button><button type="button" class="icon-button" data-copy-question="${question.id}" ${isCurrentSetLocked ? "disabled" : ""} aria-label="Copy câu hỏi ${from + index + 1}" title="Copy"><i data-lucide="copy" aria-hidden="true"></i></button><button type="button" class="icon-button danger" data-delete-question="${question.id}" ${isCurrentSetLocked ? "disabled" : ""} aria-label="Xóa câu hỏi ${from + index + 1}" title="Xóa"><i data-lucide="trash-2" aria-hidden="true"></i></button></div></article>`; }).join("") || '<div class="question-bank-empty"><b>Ngân hàng chưa có câu hỏi</b><span>Thêm câu hỏi đầu tiên để bắt đầu.</span></div>'}</div>
      <nav class="question-pagination" aria-label="Phân trang câu hỏi"><button type="button" id="previousQuestionPage" ${page <= 1 ? "disabled" : ""}>← Trang trước</button><span>${from + (questions || []).length ? `${from + 1}–${from + (questions || []).length}` : "0"} / ${total}</span><button type="button" id="nextQuestionPage" ${page >= totalPages ? "disabled" : ""}>Trang sau →</button></nav>
      <footer class="question-wizard-footer"><button type="button" data-back-actions>Quay lại</button><button type="button" data-close>Đóng</button></footer>
    </section>`;
    panel.querySelector("#addQuestion").onclick = () => renderQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext, "add");
    panel.querySelector("#addBatchQuestions").onclick = () => renderBatchQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext);
    panel.querySelector("#previousQuestionPage").onclick = () => renderNext({ questionPage: page - 1, questionDeleteId: null });
    panel.querySelector("#nextQuestionPage").onclick = () => renderNext({ questionPage: page + 1, questionDeleteId: null });
    panel.querySelector("[data-back-actions]").onclick = () => renderNext({ step: 2, mode: "", message: "" });
    panel.querySelector("[data-close]").onclick = closeQuestionWizard;
    panel.querySelectorAll("[data-view-question]").forEach((button) => { button.onclick = () => openQuestionPreview((questions || []).find((item) => Number(item.id) === Number(button.dataset.viewQuestion))); });
    panel.querySelectorAll("[data-edit-question]").forEach((button) => { button.onclick = () => renderQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext, "edit", (questions || []).find((item) => Number(item.id) === Number(button.dataset.editQuestion))); });
    panel.querySelectorAll("[data-copy-question]").forEach((button) => { button.onclick = () => renderQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext, "copy", (questions || []).find((item) => Number(item.id) === Number(button.dataset.copyQuestion))); });
    panel.querySelectorAll("[data-delete-question]").forEach((button) => { button.onclick = () => renderNext({ questionDeleteId: Number(button.dataset.deleteQuestion), message: "" }); });
    panel.querySelectorAll("[data-select-question]").forEach((input) => {
      input.onchange = () => {
        const id = Number(input.dataset.selectQuestion);
        const activeSelectedIds = [...new Set(flow.selectedQuestionIds || [])];
        const next = input.checked ? [...new Set([...activeSelectedIds, id])] : activeSelectedIds.filter((item) => item !== id);
        flow.selectedQuestionIds = next;
        panel.querySelector("#selectedQuestionCount").textContent = `Đã chọn ${next.length}`;
        panel.querySelector("#clearSelectedQuestions").disabled = !next.length || isCurrentSetLocked;
        panel.querySelector("#deleteSelectedQuestions").disabled = !next.length || isCurrentSetLocked;
      };
    });
    panel.querySelector("#clearSelectedQuestions").onclick = () => {
      flow.selectedQuestionIds = [];
      panel.querySelectorAll("[data-select-question]").forEach((input) => { input.checked = false; });
      panel.querySelector("#selectedQuestionCount").textContent = "Đã chọn 0";
      panel.querySelector("#clearSelectedQuestions").disabled = true;
      panel.querySelector("#deleteSelectedQuestions").disabled = true;
    };
    panel.querySelector("#deleteSelectedQuestions").onclick = async () => {
      const currentIds = [...new Set(flow.selectedQuestionIds || [])];
      if (!currentIds.length) return;
      const { data: selectedQuestions, error: selectedError } = await client.from("questions").select("id,question_code,content").in("id", currentIds).eq("space_id", spaceId).is("hidden_at", null).order("order_no");
      if (selectedError) return showDialogError(selectedError.message || "Không tải được các câu hỏi đã chọn.");
      const currentSelectedIds = (selectedQuestions || []).map((question) => Number(question.id));
      if (!currentSelectedIds.length) return renderNext({ selectedQuestionIds: [], questionDeleteId: null });
      openBulkQuestionDeleteConfirmation(selectedQuestions || [], async () => {
        const { error: bulkError } = await client.rpc("archive_questions", { target_question_ids: currentSelectedIds });
        if (bulkError) throw bulkError;
        await renderNext({ selectedQuestionIds: [], questionDeleteId: null, message: `Đã đưa ${currentSelectedIds.length} câu hỏi vào Thùng rác trong 30 ngày.` });
      });
    };
    if (deleting) {
      panel.querySelector("#cancelQuestionDelete").onclick = () => renderNext({ questionDeleteId: null });
      panel.querySelector("#confirmQuestionDelete").onclick = async (event) => {
        const restore = setButtonBusy(event.currentTarget, "Đang xóa...");
        try {
          const { error: archiveError } = await client.rpc("archive_question", { target_question_id: deleting.id });
          if (archiveError) throw archiveError;
          await renderNext({ questionDeleteId: null, message: "Đã đưa câu hỏi vào Thùng rác trong 30 ngày." });
        } catch (archiveError) { showDialogError(archiveError.message || "Không thể xóa câu hỏi."); } finally { restore(); }
      };
    }
    window.lucide?.createIcons();
  }

  function openBulkQuestionDeleteConfirmation(questions, onConfirm) {
    const confirmation = document.createElement("dialog");
    confirmation.className = "question-bulk-delete-dialog";
    confirmation.innerHTML = `<section aria-labelledby="bulkDeleteTitle"><header><div><span class="danger-label">Xác nhận xóa hàng loạt</span><h2 id="bulkDeleteTitle">Đưa ${questions.length} câu hỏi vào Thùng rác?</h2></div><button type="button" aria-label="Đóng">×</button></header><p class="muted">Các câu hỏi dưới đây được lưu trữ trong 30 ngày. Đề thi và kết quả đã tạo vẫn được bảo toàn.</p><ol class="bulk-delete-question-list">${questions.map((question) => `<li><span>#${esc(question.question_code || question.id)}</span><b>${esc(questionExcerpt(question.content, 160))}</b></li>`).join("")}</ol><p class="question-bulk-delete-error" role="alert" aria-live="polite"></p><footer><button type="button" data-cancel>Hủy</button><button type="button" class="danger" data-confirm>Xóa ${questions.length} câu hỏi</button></footer></section>`;
    const close = () => confirmation.close();
    confirmation.querySelectorAll("header button, [data-cancel]").forEach((button) => { button.onclick = close; });
    confirmation.querySelector("[data-confirm]").onclick = async (event) => {
      const restore = setButtonBusy(event.currentTarget, "Đang xóa...");
      try { await onConfirm(); confirmation.close(); }
      catch (error) { confirmation.querySelector(".question-bulk-delete-error").textContent = error.message || "Không thể xóa các câu hỏi đã chọn."; }
      finally { restore(); }
    };
    confirmation.addEventListener("close", () => confirmation.remove(), { once: true });
    document.body.append(confirmation);
    confirmation.showModal();
    confirmation.querySelector("[data-cancel]")?.focus();
  }

  function parseBatchQuestions(source) {
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const groups = [];
    let current = [];
    let startLine = 1;
    lines.forEach((line, index) => {
      if (!line.trim()) {
        if (current.length) groups.push({ startLine, lines: current });
        current = [];
        startLine = index + 2;
        return;
      }
      if (!current.length) startLine = index + 1;
      current.push({ value: line, line: index + 1 });
    });
    if (current.length) groups.push({ startLine, lines: current });
    if (!groups.length) return { questions: [], errors: [{ line: 1, message: "Hãy nhập ít nhất một cụm câu hỏi." }] };

    const errors = [];
    const questions = groups.map((group) => {
      const questionLine = group.lines[0];
      const answerLines = group.lines.slice(1);
      if (answerLines.length < 2 || answerLines.length > 5) {
        errors.push({ line: questionLine.line, message: "Mỗi cụm cần có từ 2 đến 5 đáp án." });
        return null;
      }
      const options = {};
      const correct = [];
      answerLines.forEach((answerLine, index) => {
        const raw = answerLine.value.trim();
        const isCorrect = raw.endsWith("*");
        const text = (isCorrect ? raw.slice(0, -1) : raw).trim();
        const letter = questionOptionLetters[index];
        if (!text) errors.push({ line: answerLine.line, message: "Đáp án không được để trống; dấu * phải đi sau nội dung đáp án." });
        else options[letter] = text;
        if (isCorrect && text) correct.push(letter);
      });
      if (!correct.length) errors.push({ line: questionLine.line, message: "Cụm câu hỏi phải có ít nhất một đáp án đúng, đánh dấu bằng * ở cuối dòng." });
      const content = questionLine.value.trim().replace(/<br\s*\/?>/gi, "\n");
      if (!content) errors.push({ line: questionLine.line, message: "Nội dung câu hỏi không được để trống." });
      return {
        sourceLine: questionLine.line,
        type: correct.length === 1 ? "single" : "multi",
        content,
        options_json: options,
        correct_json: correct
      };
    }).filter(Boolean);
    return { questions, errors };
  }

  function openBatchQuestionConfirmation(questions, onConfirm) {
    const preview = document.createElement("dialog");
    preview.className = "batch-question-confirmation";
    preview.innerHTML = `<section aria-labelledby="batchQuestionConfirmTitle"><header><div><span class="settings-eyebrow">Kiểm tra hoàn tất</span><h2 id="batchQuestionConfirmTitle">Thêm ${questions.length} câu hỏi?</h2></div><button type="button" aria-label="Đóng">×</button></header><p class="muted">Hãy kiểm tra loại câu hỏi và số đáp án trước khi thêm vào ngân hàng.</p><ol class="batch-question-preview-list">${questions.map((question, index) => `<li><span>${index + 1}</span><div><b>${esc(questionExcerpt(question.content, 120))}</b><small>${question.type === "single" ? "Một đáp án" : "Nhiều đáp án"} · ${Object.keys(question.options_json).length} đáp án</small></div></li>`).join("")}</ol><footer><button type="button" data-cancel>Quay lại</button><button type="button" class="primary" data-confirm>Thêm ${questions.length} câu hỏi</button></footer></section>`;
    const close = () => preview.close();
    preview.querySelectorAll("[data-cancel], header button").forEach((button) => { button.onclick = close; });
    preview.querySelector("[data-confirm]").onclick = async (event) => {
      const restore = setButtonBusy(event.currentTarget, "Đang thêm...");
      try { await onConfirm(); preview.close(); } catch (error) { preview.querySelector(".muted").textContent = error.message || "Không thể thêm câu hỏi."; } finally { restore(); }
    };
    preview.addEventListener("close", () => preview.remove(), { once: true });
    document.body.append(preview);
    preview.showModal();
    preview.querySelector("[data-cancel]")?.focus();
  }

  function openBatchDiscardConfirmation(onDiscard) {
    const confirmation = document.createElement("dialog");
    confirmation.className = "batch-discard-dialog";
    confirmation.innerHTML = `<section aria-labelledby="batchDiscardTitle"><span class="warning-label">Xác nhận</span><h2 id="batchDiscardTitle">Bỏ nội dung đang soạn?</h2><p>Những câu hỏi đã nhập sẽ không được lưu.</p><div class="actions"><button type="button" data-cancel>Tiếp tục soạn</button><button type="button" class="danger" data-confirm>Bỏ nội dung</button></div></section>`;
    const close = () => confirmation.close();
    confirmation.querySelector("[data-cancel]").onclick = close;
    confirmation.querySelector("[data-confirm]").onclick = () => { confirmation.close(); onDiscard(); };
    confirmation.addEventListener("close", () => confirmation.remove(), { once: true });
    document.body.append(confirmation);
    confirmation.showModal();
    confirmation.querySelector("[data-cancel]")?.focus();
  }

  const batchQuestionAiPrompt = [
    "Hãy tạo bộ câu hỏi trắc nghiệm về [CHỦ ĐỀ] theo đúng định dạng plain text dưới đây để tôi dán trực tiếp vào ứng dụng.",
    "",
    "QUY TẮC BẮT BUỘC",
    "- Chỉ trả về nội dung bộ câu hỏi, không tiêu đề, không lời giải thích, không Markdown và không đánh số câu/đáp án.",
    "- TUÂN THỦ tuyệt đối format này: giữa các cụm chỉ dùng một hoặc nhiều dòng trống; tuyệt đối không thêm dòng phân cách như ----, ===, ### hoặc bất kỳ ký tự/trang trí nào khác.",
    "- Mỗi cụm câu hỏi cách nhau bằng ít nhất một dòng trống.",
    "- Dòng đầu tiên của mỗi cụm là nội dung câu hỏi.",
    "- Nếu câu hỏi cần xuống dòng, dùng mã <BR> ngay trong dòng câu hỏi; không dùng dòng mới thật cho nội dung câu hỏi.",
    "- Mỗi dòng tiếp theo là một đáp án, có từ 2 đến 5 đáp án cho mỗi câu.",
    "- Đặt dấu * ở CUỐI dòng của mọi đáp án đúng.",
    "- Một dấu * nghĩa là câu một đáp án; từ hai dấu * trở lên nghĩa là câu nhiều đáp án. Có thể đánh dấu tất cả đáp án là đúng.",
    "- Nội dung đáp án không được rỗng.",
    "",
    "VÍ DỤ ĐÚNG",
    "",
    "Thủ đô của Việt Nam là gì?",
    "Hà Nội*",
    "Đà Nẵng",
    "Hải Phòng",
    "",
    "Ngôn ngữ nào thường dùng cho web?",
    "JavaScript*",
    "Python*",
    "HTML*",
    "CSS*",
    "",
    "Bây giờ hãy tạo [SỐ LƯỢNG] câu hỏi về [CHỦ ĐỀ] theo đúng định dạng trên."
  ].join("\n");

  function buildBatchQuestionAiPrompt(settings) {
    const information = [
      `- Chủ đề: ${settings.topic}`,
      settings.learner ? `- Đối tượng học viên: ${settings.learner}` : "",
      settings.level ? `- Trình độ học viên: ${settings.level}` : "",
      `- Số câu hỏi: ${settings.questionCount}`,
      `- Số câu hỏi nhiều đáp án: ${settings.multiCount}`,
      `- Mức độ khó: ${settings.difficulty}`,
      settings.longCount ? `- Số câu hỏi dài: ${settings.longCount}` : ""
    ].filter(Boolean);
    return [
      "Hãy tạo bộ câu hỏi trắc nghiệm theo đúng định dạng plain text dưới đây để tôi dán trực tiếp vào ứng dụng.",
      "",
      "THÔNG TIN BỘ ĐỀ",
      ...information,
      "",
      `- Tạo đúng ${settings.questionCount} câu hỏi; trong đó đúng ${settings.multiCount} câu có nhiều đáp án đúng và ${settings.questionCount - settings.multiCount} câu có một đáp án đúng.`,
      settings.longCount ? `- Có đúng ${settings.longCount} câu hỏi dài.` : "",
      "",
      ...batchQuestionAiPrompt.split("\n").slice(2, -1),
      "",
      "Bây giờ hãy trả về bộ câu hỏi theo đúng thông tin và định dạng trên."
    ].filter(Boolean).join("\n");
  }

  function openBatchQuestionAiPrompt(settings) {
    const prompt = buildBatchQuestionAiPrompt(settings);
    const promptDialog = document.createElement("dialog");
    promptDialog.className = "batch-ai-prompt-dialog";
    promptDialog.innerHTML = `<section aria-labelledby="batchAiPromptTitle"><header><div><span class="settings-eyebrow">Tạo đề với chatbot</span><h2 id="batchAiPromptTitle">AI Prompt</h2></div><button type="button" aria-label="Đóng">×</button></header><p class="muted">Prompt đã được tạo theo thông tin bạn nhập và có thể sao chép ngay.</p><textarea readonly aria-label="AI Prompt">${esc(prompt)}</textarea><p class="batch-ai-copy-status" role="status" aria-live="polite"></p><footer><button type="button" data-close>Đóng</button><button type="button" class="primary" data-copy>Sao chép prompt</button></footer></section>`;
    const close = () => promptDialog.close();
    promptDialog.querySelectorAll("header button, [data-close]").forEach((button) => { button.onclick = close; });
    promptDialog.querySelector("[data-copy]").onclick = async (event) => {
      const textarea = promptDialog.querySelector("textarea");
      const status = promptDialog.querySelector(".batch-ai-copy-status");
      const restore = setButtonBusy(event.currentTarget, "Đang sao chép...");
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(prompt);
        else {
          textarea.focus();
          textarea.select();
          if (!document.execCommand("copy")) throw new Error("Copy bị chặn");
        }
        status.textContent = "Đã sao chép prompt.";
      } catch {
        status.textContent = "Không thể sao chép tự động. Hãy chọn và sao chép nội dung trong ô.";
      } finally { restore(); }
    };
    promptDialog.addEventListener("close", () => promptDialog.remove(), { once: true });
    document.body.append(promptDialog);
    promptDialog.showModal();
    promptDialog.querySelector("[data-copy]")?.focus();
  }

  function openBatchQuestionAiPromptSetup() {
    const setupDialog = document.createElement("dialog");
    setupDialog.className = "batch-ai-setup-dialog";
    setupDialog.innerHTML = `<form aria-labelledby="batchAiSetupTitle"><header><div><span class="settings-eyebrow">Tạo đề với chatbot</span><h2 id="batchAiSetupTitle">Thiết lập AI Prompt</h2></div><button type="button" aria-label="Đóng">×</button></header><p class="muted">Các trường có dấu <b>*</b> là bắt buộc. Thông tin tùy chọn để trống sẽ không xuất hiện trong prompt.</p><div class="batch-ai-setup-fields"><label>Nhập chủ đề*<input name="topic" required maxlength="300"></label><label>Nhập đối tượng học viên<input name="learner" maxlength="300"></label><label>Trình độ học viên<select name="level"><option value="">Không nêu</option><option>Chưa biết</option><option>Đã nắm kiến thức này</option><option>Thông thạo</option></select></label><label>Nhập số câu hỏi*<input name="questionCount" type="number" min="1" step="1" required></label><label>Nhập số câu hỏi nhiều đáp án*<input name="multiCount" type="number" min="0" step="1" required></label><label>Mức độ khó của bộ đề*<select name="difficulty" required><option value="" selected disabled>Chọn mức độ khó</option><option>Dễ</option><option>Trung bình</option><option>Khó</option></select></label><label>Số câu hỏi dài<input name="longCount" type="number" min="0" step="1"></label></div><p class="batch-ai-setup-error" role="alert" aria-live="polite"></p><footer><button type="button" data-cancel>Hủy</button><button type="submit" class="primary">Tạo prompt</button></footer></form>`;
    const close = () => setupDialog.close();
    setupDialog.querySelectorAll("header button, [data-cancel]").forEach((button) => { button.onclick = close; });
    setupDialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const questionCount = Number(form.get("questionCount"));
      const multiCount = Number(form.get("multiCount"));
      const longCountValue = String(form.get("longCount") || "").trim();
      const longCount = longCountValue ? Number(longCountValue) : null;
      const error = setupDialog.querySelector(".batch-ai-setup-error");
      if (!Number.isInteger(questionCount) || questionCount < 1 || !Number.isInteger(multiCount) || multiCount < 0 || multiCount > questionCount) { error.textContent = "Số câu hỏi nhiều đáp án phải từ 0 đến tổng số câu hỏi."; return; }
      if (longCount !== null && (!Number.isInteger(longCount) || longCount < 0 || longCount > questionCount)) { error.textContent = "Số câu hỏi dài phải từ 0 đến tổng số câu hỏi."; return; }
      const settings = { topic: String(form.get("topic") || "").trim(), learner: String(form.get("learner") || "").trim(), level: String(form.get("level") || ""), questionCount, multiCount, difficulty: String(form.get("difficulty") || ""), longCount };
      if (!settings.topic || !settings.difficulty) { error.textContent = "Hãy điền đủ các trường bắt buộc."; return; }
      setupDialog.close();
      window.setTimeout(() => openBatchQuestionAiPrompt(settings), 0);
    };
    setupDialog.addEventListener("close", () => setupDialog.remove(), { once: true });
    document.body.append(setupDialog);
    setupDialog.showModal();
    setupDialog.querySelector("[name=topic]")?.focus();
  }

  function renderBatchQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext) {
    panel.innerHTML = `<section class="question-wizard settings-pane batch-question-editor" aria-labelledby="questionWizardTitle"><header class="question-wizard-header"><div><span class="settings-eyebrow">${esc(activeSet.name)}</span><h2 id="questionWizardTitle">Thêm nhiều câu hỏi</h2></div><p class="muted">Mỗi cụm cách nhau bằng dòng trống. Dùng <code>&lt;BR&gt;</code> trong dòng câu hỏi để xuống dòng.</p></header>${questionWizardProgress(3)}<div class="batch-question-rules"><div><b>Quy ước nhanh</b><span>Dòng đầu là câu hỏi · 2–5 dòng sau là đáp án · thêm <code>*</code> cuối đáp án đúng.</span></div><button type="button" id="openBatchAiPrompt">AI Prompt</button></div><div class="batch-question-source"><pre id="batchLineNumbers" aria-hidden="true">1</pre><textarea id="batchQuestionText" spellcheck="true" placeholder="Câu hỏi 1&#10;Đáp án 1&#10;Đáp án đúng*&#10;&#10;Câu hỏi 2&lt;BR&gt;dòng thứ hai&#10;Đáp án 1*&#10;Đáp án 2*"></textarea></div><div id="batchQuestionErrors" class="batch-question-errors" role="alert" aria-live="polite"></div><footer class="question-wizard-footer"><button type="button" id="closeBatchEditor">Đóng</button><button type="button" class="primary" id="validateBatchQuestions">Kiểm tra</button></footer></section>`;
    const textarea = panel.querySelector("#batchQuestionText");
    const lineNumbers = panel.querySelector("#batchLineNumbers");
    const errorBox = panel.querySelector("#batchQuestionErrors");
    panel.querySelector("#openBatchAiPrompt").onclick = openBatchQuestionAiPromptSetup;
    const syncLineNumbers = () => {
      const count = Math.max(1, textarea.value.split(/\r?\n/).length);
      lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
      lineNumbers.scrollTop = textarea.scrollTop;
    };
    const showErrors = (errors) => {
      if (!errors.length) { errorBox.innerHTML = ""; return; }
      errorBox.innerHTML = `<b>Cần sửa ${errors.length} lỗi:</b><ul>${errors.map((error) => `<li><span>Dòng ${error.line}</span>${esc(error.message)}</li>`).join("")}</ul>`;
    };
    textarea.oninput = () => { syncLineNumbers(); showErrors([]); };
    textarea.onscroll = () => { lineNumbers.scrollTop = textarea.scrollTop; };
    syncLineNumbers();
    panel.querySelector("#closeBatchEditor").onclick = () => {
      if (!textarea.value.trim()) return renderNext({ questionDeleteId: null });
      openBatchDiscardConfirmation(() => renderNext({ questionDeleteId: null }));
    };
    panel.querySelector("#validateBatchQuestions").onclick = () => {
      const result = parseBatchQuestions(textarea.value);
      showErrors(result.errors);
      if (result.errors.length) return;
      openBatchQuestionConfirmation(result.questions, async () => {
        const inserted = await importQuestions(spaceId, result.questions, activeSet.id, null, { preserveDialog: true });
        if (inserted !== result.questions.length) throw new Error("Không thể thêm đầy đủ các câu hỏi.");
        await renderNext({ questionDeleteId: null, message: `Đã thêm ${inserted} câu hỏi vào ngân hàng.` });
      });
    };
  }

  function renderQuestionEditor(panel, spaceId, space, activeSet, flow, renderNext, mode, question = null) {
    const isEdit = mode === "edit";
    const source = question || { type: "single", content: "", options_json: { A: "", B: "" }, correct_json: [] };
    const title = isEdit ? "Sửa câu hỏi" : mode === "copy" ? "Copy câu hỏi" : "Thêm câu hỏi";
    panel.innerHTML = `<section class="question-wizard settings-pane question-editor" aria-labelledby="questionWizardTitle"><header class="question-wizard-header"><div><span class="settings-eyebrow">${esc(activeSet.name)}</span><h2 id="questionWizardTitle">${title}</h2></div><p class="muted">Nội dung thuần văn bản; có thể xuống dòng và dùng mọi ký tự.</p></header>${questionWizardProgress(3)}<form id="questionEditorForm" class="question-editor-form"><label for="questionType">Loại câu hỏi<select id="questionType" name="type"><option value="single" ${source.type !== "multi" ? "selected" : ""}>Một đáp án đúng</option><option value="multi" ${source.type === "multi" ? "selected" : ""}>Nhiều đáp án đúng</option></select></label><label for="questionContent">Nội dung câu hỏi<textarea id="questionContent" name="content" rows="5" required>${esc(source.content)}</textarea></label><fieldset><legend>Đáp án <small>Điền tối đa 5 đáp án; đánh dấu đáp án đúng.</small></legend><div class="question-option-editor">${questionOptionLetters.map((letter) => `<label class="question-option-field"><span>${letter}</span><input name="option_${letter}" value="${esc(source.options_json?.[letter] || "")}" placeholder="Đáp án ${letter}"><input class="question-correct-control" type="${source.type === "multi" ? "checkbox" : "radio"}" name="correct" value="${letter}" ${Array.isArray(source.correct_json) && source.correct_json.includes(letter) ? "checked" : ""} aria-label="Đáp án ${letter} là đúng"></label>`).join("")}</div></fieldset><p class="question-editor-error" id="questionEditorError" role="alert" hidden></p><footer class="question-wizard-footer"><button type="button" id="backToQuestions">Quay lại</button><button class="primary">${isEdit ? "Lưu thay đổi" : "Thêm câu hỏi"}</button></footer></form></section>`;
    panel.querySelector("#backToQuestions").onclick = () => renderNext({ questionDeleteId: null });
    panel.querySelector("#questionType").onchange = (event) => {
      const controls = panel.querySelectorAll(".question-correct-control");
      controls.forEach((control) => { control.type = event.target.value === "multi" ? "checkbox" : "radio"; });
      if (event.target.value === "single") {
        const selected = [...controls].find((control) => control.checked);
        controls.forEach((control) => { control.checked = control === selected; });
      }
    };
    panel.querySelector("#questionEditorForm").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const type = String(form.get("type"));
      const content = String(form.get("content") || "").trim();
      const options = Object.fromEntries(questionOptionLetters.map((letter) => [letter, String(form.get(`option_${letter}`) || "").trim()]).filter(([, value]) => value));
      const correct = form.getAll("correct").filter((letter) => options[letter]);
      const errorNode = panel.querySelector("#questionEditorError");
      const showError = (message) => { errorNode.textContent = message; errorNode.hidden = false; };
      errorNode.hidden = true;
      if (!content) return showError("Hãy nhập nội dung câu hỏi.");
      if (!options.A || !options.B) return showError("Cần có ít nhất đáp án A và B.");
      if (!correct.length || (type === "single" && correct.length !== 1) || (type === "multi" && correct.length < 2)) return showError(type === "single" ? "Câu một đáp án cần chọn đúng một đáp án đúng." : "Câu nhiều đáp án cần chọn ít nhất hai đáp án đúng.");
      const submit = event.submitter;
      const restore = setButtonBusy(submit, isEdit ? "Đang lưu..." : "Đang thêm...");
      try {
        if (isEdit) {
          const { error } = await client.from("questions").update({ type, content, options_json: options, correct_json: correct }).eq("id", question.id).eq("space_id", spaceId);
          if (error) throw error;
        } else {
          const { data: latest, error: latestError } = await client.from("questions").select("order_no").eq("space_id", spaceId).order("order_no", { ascending: false }).limit(1);
          if (latestError) throw latestError;
          const { error } = await client.from("questions").insert({ space_id: spaceId, question_set_id: activeSet.id, order_no: Number(latest?.[0]?.order_no || 0) + 1, type, content, options_json: options, correct_json: correct });
          if (error) throw error;
        }
        await renderNext({ questionDeleteId: null, message: isEdit ? "Đã lưu thay đổi câu hỏi." : "Đã thêm câu hỏi vào ngân hàng." });
      } catch (saveError) { showError(saveError.message || "Không thể lưu câu hỏi."); } finally { restore(); }
    };
  }

  function realExamStatusLabel(status) {
    return {
      scheduled: "Sắp diễn ra",
      active: "Đang hoạt động",
      paused: "Đã tạm dừng",
      ended: "Đã kết thúc",
      hidden: "Đã ẩn"
    }[status] || "Không xác định";
  }

  function realExamDisplayName(exam) {
    return `${exam.name || "Đợt thi thật"} · #${String(exam.code || "").padStart(5, "0")}`;
  }

  function realExamListName(exam) {
    return `#${String(exam.code || "").padStart(5, "0")} · ${exam.name || "Đợt thi thật"}`;
  }

  function realExamShareUrl(code) {
    return new URL(`exam/${String(code).padStart(5, "0")}`, quizBaseUrl).href;
  }

  async function copyShareLink(input, status) {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(input.value);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
    }
    status.textContent = copied
      ? "Đã sao chép link Đợt thi."
      : "Link đã được chọn. Nhấn Ctrl+C để sao chép.";
    status.classList.toggle("error", !copied);
  }

  async function renderRealExamSettings(panel, spaceId, space, inputFlow = {}) {
    clearDialogError();
    const flow = {
      view: inputFlow.view || "list",
      page: Math.max(1, Number(inputFlow.page) || 1),
      search: inputFlow.search || "",
      status: inputFlow.status || "",
      examId: inputFlow.examId ? Number(inputFlow.examId) : null,
      message: inputFlow.message || "",
      clone: inputFlow.clone || null,
      hideStep: Math.max(0, Number(inputFlow.hideStep) || 0),
      revisionId: inputFlow.revisionId ? Number(inputFlow.revisionId) : null
    };
    const renderNext = (changes) => renderRealExamSettings(panel, spaceId, space, { ...flow, ...changes });
    const notice = flow.message
      ? `<div class="question-wizard-notice" role="status" aria-live="polite">${esc(flow.message)}</div>`
      : "";
    panel.innerHTML = loadingPanel("Đang tải danh sách Đợt thi thật");

    if (flow.view === "list") {
      const { data, error } = await client.rpc("list_real_exams", {
        target_space_id: spaceId,
        requested_page: flow.page,
        requested_page_size: 15,
        search_text: flow.search || null,
        status_filter: flow.status || null
      });
      if (error) return showDialogError(error.message);
      const exams = data || [];
      const total = Number(exams[0]?.total_count || 0);
      const pages = Math.max(1, Math.ceil(total / 15));
      panel.innerHTML = `<section class="real-exam-wizard settings-pane" aria-labelledby="realExamListTitle">
        <header class="real-exam-list-header">
          <div><span class="settings-eyebrow">Thi thật</span><h2 id="realExamListTitle">Danh sách Đợt thi thật</h2><p class="muted">${total} đợt trong Space này · 15 đợt mỗi trang</p></div>
          <button type="button" class="primary" id="createRealExamBtn">Tạo Đợt thi thật</button>
        </header>
        ${notice}
        <form id="realExamFilterForm" class="real-exam-filters">
          <label>Tìm theo tên hoặc ID<input name="search" value="${esc(flow.search)}" placeholder="Ví dụ: cuối kỳ hoặc #12345"></label>
          <button type="submit">Tìm kiếm</button>
          <label>Trạng thái<select name="status">
            <option value="">Tất cả</option>
            <option value="scheduled" ${flow.status === "scheduled" ? "selected" : ""}>Sắp diễn ra</option>
            <option value="active" ${flow.status === "active" ? "selected" : ""}>Đang hoạt động</option>
            <option value="paused" ${flow.status === "paused" ? "selected" : ""}>Đã tạm dừng</option>
            <option value="ended" ${flow.status === "ended" ? "selected" : ""}>Đã kết thúc</option>
            ${state.profile?.role === "superadmin" ? `<option value="hidden" ${flow.status === "hidden" ? "selected" : ""}>Đã ẩn</option>` : ""}
          </select></label>
        </form>
        <div class="real-exam-list">
          ${exams.map((exam) => `<button type="button" class="real-exam-list-row" data-real-exam-id="${exam.id}">
            <span class="real-exam-row-main"><b>${esc(realExamListName(exam))}</b><span>${esc(formatExportDateTime(exam.start_at))} – ${esc(formatExportDateTime(exam.end_at))}</span></span>
            <span class="real-exam-status ${esc(exam.status)}">${esc(realExamStatusLabel(exam.status))}</span>
            <span class="real-exam-row-stat"><b>${Number(exam.question_count || 0)}</b><small>câu hỏi</small></span>
            <span class="real-exam-row-stat"><b>${Number(exam.result_count || 0)}</b><small>kết quả</small></span>
            <span class="question-bank-arrow" aria-hidden="true">→</span>
          </button>`).join("") || `<div class="question-bank-empty"><b>Chưa có Đợt thi thật</b><span>${flow.search || flow.status ? "Thử thay đổi bộ lọc." : "Tạo đợt đầu tiên để có link Thi thật riêng."}</span></div>`}
        </div>
        <nav class="real-exam-pagination" aria-label="Phân trang Đợt thi thật">
          <button type="button" id="previousRealExamPage" ${flow.page <= 1 ? "disabled" : ""}>← Trang trước</button>
          <span>Trang <b>${Math.min(flow.page, pages)}</b> / ${pages}</span>
          <button type="button" id="nextRealExamPage" ${flow.page >= pages ? "disabled" : ""}>Trang sau →</button>
        </nav>
        <footer class="question-wizard-footer"><button type="button" data-close>Đóng</button></footer>
      </section>`;
      panel.querySelector("#createRealExamBtn").onclick = () => renderNext({ view: "form", examId: null, clone: null, message: "" });
      panel.querySelector("#realExamFilterForm").onsubmit = (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        renderNext({ page: 1, search: String(form.get("search") || "").trim(), status: String(form.get("status") || "") });
      };
      panel.querySelector("#realExamFilterForm select[name='status']").onchange = (event) => {
        const form = new FormData(event.currentTarget.form);
        renderNext({ page: 1, search: String(form.get("search") || "").trim(), status: String(form.get("status") || "") });
      };
      panel.querySelector("#previousRealExamPage").onclick = () => renderNext({ page: flow.page - 1 });
      panel.querySelector("#nextRealExamPage").onclick = () => renderNext({ page: flow.page + 1 });
      panel.querySelectorAll("[data-real-exam-id]").forEach((button) => {
        button.onclick = () => renderNext({ view: "detail", examId: Number(button.dataset.realExamId), message: "", hideStep: 0 });
      });
      bindPanelCloseButtons(panel);
      return;
    }

    let exam = null;
    if (flow.examId) {
      const { data, error } = await client.rpc("get_real_exam_admin", { target_real_exam_id: flow.examId });
      if (error) return showDialogError(error.message);
      exam = data;
    }

    if (flow.view === "share" && exam) {
      const shareUrl = realExamShareUrl(exam.code);
      panel.innerHTML = `<section class="real-exam-wizard settings-pane real-exam-share-view" aria-labelledby="realExamShareTitle">
        <header class="question-wizard-header">
          <div><span class="settings-eyebrow">Chia sẻ Đợt thi</span><h2 id="realExamShareTitle">${esc(realExamDisplayName(exam))}</h2></div>
          <p class="muted">Quét mã QR hoặc sao chép đường dẫn để gửi cho học viên.</p>
        </header>
        <section class="real-exam-share-sheet">
          <div class="real-exam-qr-frame">
            <div id="realExamQrCode" aria-label="Mã QR dẫn tới ${esc(shareUrl)}"></div>
            <span>Quét để mở Đợt thi</span>
          </div>
          <div class="real-exam-share-copy">
            <label for="realExamShareLink">Link Thi thật</label>
            <input id="realExamShareLink" value="${esc(shareUrl)}" readonly>
            <p id="realExamCopyStatus" class="muted" role="status" aria-live="polite">Link dùng chung cho mọi phiên bản của ID #${String(exam.code).padStart(5, "0")}.</p>
            <div class="actions">
              <button type="button" class="primary" id="copyRealExamShareLink">Sao chép link</button>
              <a class="button-link" href="${esc(shareUrl)}" target="_blank" rel="noopener noreferrer">Mở link</a>
            </div>
          </div>
        </section>
        <footer class="question-wizard-footer"><button type="button" id="backFromRealExamShare">Quay lại</button><button type="button" data-close>Đóng</button></footer>
      </section>`;
      const qrTarget = panel.querySelector("#realExamQrCode");
      if (window.QRCode) {
        new QRCode(qrTarget, {
          text: shareUrl,
          width: 220,
          height: 220,
          correctLevel: QRCode.CorrectLevel.H
        });
      } else {
        qrTarget.innerHTML = '<div class="question-bank-empty"><b>Không tạo được mã QR</b><span>Vẫn có thể sao chép hoặc mở đường dẫn bên cạnh.</span></div>';
      }
      const linkInput = panel.querySelector("#realExamShareLink");
      const copyStatus = panel.querySelector("#realExamCopyStatus");
      panel.querySelector("#copyRealExamShareLink").onclick = () => copyShareLink(linkInput, copyStatus);
      linkInput.onclick = () => linkInput.select();
      panel.querySelector("#backFromRealExamShare").onclick = () => renderNext({ view: "detail" });
      bindPanelCloseButtons(panel);
      return;
    }

    if (flow.view === "detail" && exam) {
      const shareUrl = realExamShareUrl(exam.code);
      const isRunning = Boolean(exam.manual_running && exam.status !== "ended" && exam.status !== "hidden");
      const rebuildInvalid = Boolean(exam.rebuild_validation && (!exam.rebuild_validation.has_sources || exam.rebuild_validation.has_empty_source));
      const rebuildNotice = exam.needs_rebuild || rebuildInvalid
        ? `<section class="question-real-exam-lock" role="status"><div><span class="warning-label">${rebuildInvalid ? "Cấu hình nguồn chưa hợp lệ" : "Cần build lại đề"}</span><h3>${rebuildInvalid ? "Chưa thể Start Đợt thi" : "Đợt thi sẽ build lại khi Start"}</h3><p>${rebuildInvalid ? "Hãy chọn ít nhất một nguồn câu hỏi đang hoạt động và có từ 1 câu hỏi trở lên trước khi Start." : "Nguồn câu hỏi hoặc nguyên tắc tạo đề đã thay đổi. Start sẽ tạo phiên bản đề mới."}</p></div></section>`
        : "";
      let hideConfirmation = "";
      if (flow.hideStep === 1) {
        hideConfirmation = `<section class="question-inline-confirmation" aria-labelledby="hideRealExamFirstTitle">
          <span class="danger-label">Xác nhận 1/2</span>
          <h3 id="hideRealExamFirstTitle">Xóa “${esc(realExamDisplayName(exam))}”?</h3>
          <p>Đợt thi sẽ không còn xuất hiện trong danh sách thường. Mã, cấu hình nguồn, các phiên bản đề và toàn bộ kết quả vẫn được giữ để tra cứu.</p>
          <div class="actions"><button type="button" id="cancelHideRealExam">Hủy</button><button type="button" class="danger" id="continueHideRealExam">Tôi hiểu, tiếp tục</button></div>
        </section>`;
      }
      if (flow.hideStep === 2) {
        hideConfirmation = `<section class="question-inline-confirmation" aria-labelledby="hideRealExamFinalTitle">
          <span class="danger-label">Xác nhận 2/2</span>
          <h3 id="hideRealExamFinalTitle">Nhập ID Đợt thi để xác nhận</h3>
          <p>Nhập chính xác <b>${String(exam.code).padStart(5, "0")}</b>. Superadmin có thể khôi phục Đợt thi sau này.</p>
          <label for="confirmHideRealExamCode">Mã Đợt thi<input id="confirmHideRealExamCode" inputmode="numeric" autocomplete="off" maxlength="5"></label>
          <div class="actions"><button type="button" id="cancelHideRealExam">Hủy</button><button type="button" class="danger" id="confirmHideRealExam" disabled>Xóa Đợt thi</button></div>
        </section>`;
      }
      panel.innerHTML = `<section class="real-exam-wizard settings-pane" aria-labelledby="realExamDetailTitle">
        <header class="real-exam-detail-header">
          <div><span class="settings-eyebrow">Đợt thi thật</span><h2 id="realExamDetailTitle">${esc(realExamDisplayName(exam))}</h2><p class="muted">${esc(formatExportDateTime(exam.start_at))} – ${esc(formatExportDateTime(exam.end_at))}</p></div>
          <div class="real-exam-detail-controls">
            <span class="real-exam-status ${esc(exam.status)}">${esc(realExamStatusLabel(exam.status))}</span>
            <label class="real-exam-run-toggle" title="Có thể Start hoặc Stop bất kỳ lúc nào. Start yêu cầu thời gian kết thúc chưa qua.">
              <span>Stop</span>
              <input id="realExamRunningToggle" type="checkbox" role="switch" ${isRunning ? "checked" : ""} ${exam.status === "hidden" ? "disabled" : ""} aria-label="Start hoặc Stop Đợt thi thật">
              <span class="real-exam-toggle-track" aria-hidden="true"><span></span></span>
              <span>Start</span>
            </label>
          </div>
        </header>
        ${notice}
        ${rebuildNotice}
        <dl class="real-exam-detail-metrics">
          <div><dt>Câu hỏi trong Đề thi</dt><dd>${Number(exam.question_count || 0)}</dd></div>
          <div><dt>Kết quả đã nộp</dt><dd>${Number(exam.result_count || 0)}</dd></div>
          <div><dt>Phiên bản hiện tại</dt><dd>V${Number(exam.current_revision_no || 1)}</dd></div>
          <div><dt>Số lần thi / phiên bản</dt><dd>${Number(exam.max_attempts || 1)}</dd></div>
        </dl>
        <section class="real-exam-share">
          <div><span>Link Thi thật</span><a href="${esc(shareUrl)}" target="_blank" rel="noopener noreferrer">${esc(shareUrl)}</a></div>
          <button type="button" id="openRealExamShare">Chia sẻ</button>
        </section>
        ${hideConfirmation || `<section class="question-action-group">
          <div><h3>Thao tác</h3><p class="muted">Các hành động khả dụng theo trạng thái hiện tại.</p></div>
          <div class="question-action-list">
            <button type="button" class="question-action-row" id="manageRealExamResults"><span><b>Quản lý kết quả</b><small>Xem 20 kết quả gần nhất và xuất Excel</small></span><span>→</span></button>
            ${exam.status !== "hidden" ? `<button type="button" class="question-action-row" id="editRealExam"><span><b>Sửa thông tin Đợt thi</b><small>Giữ nguyên ID; thay đổi nguồn hoặc nguyên tắc sẽ tạo phiên bản Đề thi mới</small></span><span>→</span></button>` : ""}
            ${exam.status === "scheduled" ? '<button type="button" class="question-action-row" id="regenerateRealExam"><span><b>Tạo lại Đề thi</b><small>Tạo ngẫu nhiên một Đề thi mới theo cấu hình hiện tại</small></span><span>↻</span></button>' : ""}
            ${exam.status === "ended" ? '<button type="button" class="question-action-row" id="cloneRealExam"><span><b>Copy Đợt thi</b><small>Tạo Đợt thi độc lập với mã 5 số mới</small></span><span>→</span></button>' : ""}
            ${exam.status === "ended" ? '<button type="button" class="question-action-row danger-row" id="hideRealExam"><span><b>Xóa Đợt thi</b><small>Giữ mã, nguồn đề và toàn bộ kết quả để tra cứu</small></span><span>→</span></button>' : ""}
            ${exam.status === "hidden" ? '<button type="button" class="question-action-row" id="unhideRealExam"><span><b>Bỏ ẩn Đợt thi</b><small>Hiển thị lại Đợt thi thật này cho tất cả Admin</small></span><span>→</span></button>' : ""}
          </div>
        </section>`}
        <footer class="question-wizard-footer"><button type="button" id="backToRealExamList">Quay lại danh sách</button><button type="button" data-close>Đóng</button></footer>
      </section>`;
      panel.querySelector("#backToRealExamList").onclick = () => renderNext({ view: "list", examId: null, message: "", hideStep: 0 });
      panel.querySelector("#openRealExamShare").onclick = () => renderNext({ view: "share", hideStep: 0 });
      const runningToggle = panel.querySelector("#realExamRunningToggle");
      if (runningToggle) runningToggle.onchange = async () => {
        const shouldRun = runningToggle.checked;
        runningToggle.disabled = true;
        try {
          const { error } = await client.rpc("set_real_exam_running", {
            target_real_exam_id: exam.id,
            should_run: shouldRun
          });
          if (error) throw error;
          await renderNext({
            message: shouldRun
              ? `Đã Start ${realExamDisplayName(exam)}. Học viên có thể tiếp tục vào thi.`
              : `Đã Stop ${realExamDisplayName(exam)}. Đợt thi đang tạm dừng.`
          });
        } catch (error) {
          runningToggle.checked = !shouldRun;
          runningToggle.disabled = false;
          showDialogError(error.message);
        }
      };
      const resultsButton = panel.querySelector("#manageRealExamResults");
      if (resultsButton) resultsButton.onclick = () => renderNext({ view: "results", message: "", revisionId: null });
      const editButton = panel.querySelector("#editRealExam");
      if (editButton) editButton.onclick = () => renderNext({ view: "form", clone: null, message: "" });
      const cloneButton = panel.querySelector("#cloneRealExam");
      if (cloneButton) cloneButton.onclick = () => renderNext({ view: "form", examId: null, clone: exam, message: "" });
      const regenerateButton = panel.querySelector("#regenerateRealExam");
      if (regenerateButton) regenerateButton.onclick = async () => {
        const restore = setButtonBusy(regenerateButton, "Đang tạo lại...");
        try {
          const { data, error } = await client.rpc("regenerate_real_exam_snapshot", { target_real_exam_id: exam.id });
          if (error) throw error;
          await renderNext({ message: `Đã tạo lại Đề thi gồm ${Number(data?.question_count || 0)} câu hỏi.` });
        } catch (error) {
          showDialogError(error.message);
        } finally {
          restore();
        }
      };
      const hideButton = panel.querySelector("#hideRealExam");
      if (hideButton) hideButton.onclick = () => renderNext({ hideStep: 1 });
      const cancelHide = panel.querySelector("#cancelHideRealExam");
      if (cancelHide) cancelHide.onclick = () => renderNext({ hideStep: 0 });
      const continueHide = panel.querySelector("#continueHideRealExam");
      if (continueHide) continueHide.onclick = () => renderNext({ hideStep: 2 });
      const confirmHide = panel.querySelector("#confirmHideRealExam");
      const confirmHideCode = panel.querySelector("#confirmHideRealExamCode");
      if (confirmHideCode && confirmHide) {
        confirmHideCode.oninput = () => {
          confirmHide.disabled = confirmHideCode.value.trim() !== String(exam.code).padStart(5, "0");
        };
        confirmHideCode.focus();
      }
      if (confirmHide) confirmHide.onclick = async () => {
        const restore = setButtonBusy(confirmHide, "Đang ẩn...");
        try {
          const { error } = await client.rpc("hide_real_exam", {
            target_real_exam_id: exam.id,
            confirmation_code: Number(confirmHideCode.value)
          });
          if (error) throw error;
          await renderRealExamSettings(panel, spaceId, space, { view: "list", message: `Đã xóa ${realExamDisplayName(exam)} vào Thùng rác. Nguồn đề và kết quả vẫn được giữ.` });
        } catch (error) {
          showDialogError(error.message);
        } finally {
          restore();
        }
      };
      const unhideExamButton = panel.querySelector("#unhideRealExam");
      if (unhideExamButton) unhideExamButton.onclick = async () => {
        const restore = setButtonBusy(unhideExamButton, "Đang khôi phục...");
        try {
          const { error } = await client.rpc("unhide_real_exam", {
            target_real_exam_id: exam.id
          });
          if (error) throw error;
          await renderRealExamSettings(panel, spaceId, space, { view: "list", message: `Đã khôi phục ${realExamDisplayName(exam)}.` });
        } catch (error) {
          showDialogError(error.message);
        } finally {
          restore();
        }
      };
      bindPanelCloseButtons(panel);
      return;
    }

    if (flow.view === "results" && exam) {
      const { data, error } = await client.rpc("list_real_exam_results", {
        target_real_exam_id: exam.id,
        result_limit: 20,
        target_revision_id: flow.revisionId || null
      });
      if (error) return showDialogError(error.message);
      const rows = Array.isArray(data) ? data : [];
      panel.innerHTML = `<section class="real-exam-wizard settings-pane">
        <header class="real-exam-list-header"><div><span class="settings-eyebrow">Kết quả Thi thật</span><h2>${esc(realExamDisplayName(exam))}</h2><p class="muted">20 kết quả nộp gần nhất.</p></div><button type="button" class="primary" id="exportRealExamV2Results" ${rows.length ? "" : "disabled"}>Xuất Excel</button></header>
        <label class="real-exam-revision-filter">Phiên bản đề<select id="realExamRevisionFilter">
          <option value="">Tất cả phiên bản</option>
          ${(exam.revisions || []).map((revision) => `<option value="${revision.id}" ${Number(flow.revisionId) === Number(revision.id) ? "selected" : ""}>Phiên bản ${revision.revision_no} · ${revision.question_count} câu · ${revision.result_count} kết quả</option>`).join("")}
        </select></label>
        <div class="real-results-list">${rows.length ? realExamRowsTable(rows) : '<div class="question-bank-empty"><b>Chưa có kết quả</b><span>Kết quả sẽ xuất hiện sau khi học viên nộp bài.</span></div>'}</div>
        <footer class="question-wizard-footer"><button type="button" id="backToRealExamDetail">Quay lại</button><button type="button" data-close>Đóng</button></footer>
      </section>`;
      panel.querySelector("#backToRealExamDetail").onclick = () => renderNext({ view: "detail" });
      panel.querySelector("#realExamRevisionFilter").onchange = (event) => {
        renderNext({
          view: "results",
          revisionId: event.target.value ? Number(event.target.value) : null
        });
      };
      const exportButton = panel.querySelector("#exportRealExamV2Results");
      if (exportButton) exportButton.onclick = async () => {
        if (!window.XLSX) return showDialogError("Không thể khởi tạo chức năng xuất Excel.");
        const restore = setButtonBusy(exportButton, "Đang tạo Excel...");
        try {
          const { data: allRows, error: exportError } = await client.rpc("list_real_exam_results", {
            target_real_exam_id: exam.id,
            result_limit: 5000,
            target_revision_id: flow.revisionId || null
          });
          if (exportError) throw exportError;
          const sheetRows = (allRows || []).map((row) => ({
            "ID Đợt thi": `#${String(exam.code).padStart(5, "0")}`,
            "Tên Đợt thi": exam.name,
            "Phiên bản đề": `V${Number(row.real_exam_revision_no || 1)}`,
            "Group": row.group_name || "Chưa phân nhóm",
            "Học viên": row.student_name,
            "Điểm": Number(row.score),
            "Đúng": Number(row.correct_count),
            "Sai": Number(row.wrong_count),
            "Tổng số câu": Number(row.total_questions),
            "Thời gian làm bài": formatExportDuration(row.duration_seconds),
            "Bắt đầu": formatExportDateTime(row.started_at),
            "Nộp bài": formatExportDateTime(row.submitted_at)
          }));
          const worksheet = XLSX.utils.json_to_sheet(sheetRows);
          worksheet["!cols"] = [
            { wch: 14 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 28 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 20 },
            { wch: 22 }, { wch: 22 }
          ];
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, "Kết quả");
          XLSX.writeFile(workbook, `ket-qua-thi-that-${String(exam.code).padStart(5, "0")}.xlsx`);
        } catch (exportError) {
          showDialogError(exportError.message);
        } finally {
          restore();
        }
      };
      bindPanelCloseButtons(panel);
      return;
    }

    const sourceExam = flow.clone || exam;
    let sets;
    try {
      sets = await loadQuestionSets(spaceId);
    } catch (error) {
      return showDialogError(error.message);
    }
    const selectedConfig = normalizeRealSetConfig(sets, sourceExam?.sources || []);
    const defaultName = flow.clone ? `Copy ${sourceExam.name}` : (sourceExam?.name || "");
    panel.innerHTML = `<form id="realExamV2Form" class="real-exam-wizard settings-pane">
      <header class="question-wizard-header"><div><span class="settings-eyebrow">${flow.clone ? "Copy Đợt thi" : exam ? "Sửa thông tin Đợt thi" : "Tạo Đợt thi thật"}</span><h2>${esc(exam ? realExamDisplayName(exam) : "Cấu hình Đợt thi mới")}</h2></div><p class="muted">${exam ? `Lưu thay đổi sẽ tạo Phiên bản ${Number(exam.current_revision_no || 1) + 1}, giữ nguyên ID và kết quả cũ.` : "Lưu biểu mẫu sẽ tạo một Đề thi hoàn chỉnh từ danh sách ID câu hỏi."}</p></header>
      ${notice}
      <section class="settings-section"><label>Tên Đợt thi thật<input name="name" value="${esc(defaultName)}" required></label></section>
      <section class="settings-section">
        <div><h3>Thời gian thi</h3><p class="muted">Admin có thể đặt lại thời gian không phụ thuộc thời điểm hiện tại. Thời gian bắt đầu vẫn phải trước thời gian kết thúc.</p></div>
        <div class="grid two real-exam-row">
          <label>Ngày bắt đầu<input name="start_date" type="date" value="${flow.clone ? "" : toLocalDateInput(sourceExam?.start_at)}" required></label>
          <label>Giờ bắt đầu<select name="start_time">${timeOptions(flow.clone ? "" : toLocalTimeText(sourceExam?.start_at))}</select></label>
          <label>Ngày kết thúc<input name="end_date" type="date" value="${flow.clone ? "" : toLocalDateInput(sourceExam?.end_at)}" required></label>
          <label>Giờ kết thúc<select name="end_time">${timeOptions(flow.clone ? "" : toLocalTimeText(sourceExam?.end_at))}</select></label>
        </div>
      </section>
      <section class="settings-section real-set-section">
        <div><h3>Nguồn câu hỏi</h3><p class="muted">Tổng tỷ lệ các ngân hàng được chọn phải bằng 100%.</p></div>
        <div class="real-set-list">${sets.map((set) => {
          const config = selectedConfig.find((item) => Number(item.id) === Number(set.id));
          return `<div class="real-set-item">
            <label class="switch"><input type="checkbox" data-real-set-check="${set.id}" ${config ? "checked" : ""}><span class="switch-track"></span><span>${esc(set.name)}</span></label>
            <span class="real-set-stats">${set.counts.total} câu · ${set.counts.multi} câu nhiều đáp án</span>
            <label>Tỷ lệ (%)<input type="number" min="0" max="100" data-real-set-percent="${set.id}" value="${Number(config?.percent || 0)}" ${config ? "" : "disabled"}></label>
          </div>`;
        }).join("")}</div>
        <p class="muted" id="realSetTotalHint"></p>
      </section>
      <section class="settings-section">
        <div><h3>Nguyên tắc tạo đề</h3><p class="muted">X là tổng số câu đề; Y là số câu nhiều đáp án trong X.</p></div>
        <div class="grid two real-exam-row">
          ${selectField("question_percent", "Số lượng câu hỏi", [30,50,70,100], sourceExam?.question_percent || 50, "%")}
          ${selectField("multi_percent", "Tỷ lệ câu nhiều đáp án", [30,50,70,100], sourceExam?.multi_percent || 50, "%")}
          ${selectField("timer_seconds", "Thời gian mỗi câu", [45,60,90,120], sourceExam?.timer_seconds || 60, "s")}
          ${selectField("max_attempts", "Số lần thi tối đa", [1,2,3,4,5], sourceExam?.max_attempts || 1, "")}
        </div>
        <div class="scoring-field-row">
          <label>Cách tính điểm<select name="scoring_method">
            <option value="1" ${Number(sourceExam?.scoring_method || 2) === 1 ? "selected" : ""}>Cách tính điểm 1</option>
            <option value="2" ${Number(sourceExam?.scoring_method || 2) === 2 ? "selected" : ""}>Cách tính điểm 2</option>
          </select></label>
          <div class="scoring-help">
            <button type="button" class="scoring-help-button" aria-label="Xem chi tiết cách tính điểm" aria-expanded="false">?</button>
            <div class="scoring-tooltip" role="tooltip">${scoringMethodTooltip(Number(sourceExam?.scoring_method || 2))}</div>
          </div>
        </div>
        <div id="realExamPoolPreview" class="real-exam-pool-preview" role="status" aria-live="polite"></div>
      </section>
      <footer class="question-wizard-footer"><button type="button" id="cancelRealExamForm">Quay lại</button><button class="primary">${exam ? `Tạo Phiên bản ${Number(exam.current_revision_no || 1) + 1}` : flow.clone ? "Tạo bản copy" : "Tạo Đợt thi"}</button></footer>
    </form>`;
    panel.querySelector("#cancelRealExamForm").onclick = () => {
      if (exam) renderNext({ view: "detail", clone: null });
      else renderNext({ view: "list", clone: null });
    };
    wireRealSetControls(panel);
    const updatePoolPreview = () => {
      const checkedIds = [...panel.querySelectorAll("[data-real-set-check]:checked")].map((input) => Number(input.dataset.realSetCheck));
      const total = sets.filter((set) => checkedIds.includes(Number(set.id))).reduce((sum, set) => sum + set.counts.total, 0);
      const percent = Number(panel.querySelector('[name="question_percent"]').value || 0);
      const multiPercent = Number(panel.querySelector('[name="multi_percent"]').value || 0);
      const target = total ? Math.max(1, Math.round(total * percent / 100)) : 0;
      const multi = Math.round(target * multiPercent / 100);
      panel.querySelector("#realExamPoolPreview").innerHTML = `<span><b>${total}</b> câu trong nguồn</span><span><b>${target}</b> câu trong Đề thi</span><span><b>${multi}</b> câu nhiều đáp án mục tiêu</span><span><b>${Math.max(0, target - multi)}</b> câu một đáp án</span>`;
    };
    panel.querySelectorAll("[data-real-set-check], [data-real-set-percent], [name='question_percent'], [name='multi_percent']").forEach((input) => input.addEventListener("change", updatePoolPreview));
    const scoringSelect = panel.querySelector('[name="scoring_method"]');
    const scoringHelp = panel.querySelector(".scoring-help");
    const scoringHelpButton = panel.querySelector(".scoring-help-button");
    const scoringTooltip = panel.querySelector(".scoring-tooltip");
    scoringSelect.onchange = () => { scoringTooltip.innerHTML = scoringMethodTooltip(Number(scoringSelect.value)); };
    scoringHelpButton.onclick = () => {
      const open = scoringHelp.classList.toggle("open");
      scoringHelpButton.setAttribute("aria-expanded", String(open));
    };
    panel.addEventListener("click", (event) => {
      if (event.target.closest(".scoring-help")) return;
      scoringHelp.classList.remove("open");
      scoringHelpButton.setAttribute("aria-expanded", "false");
    });
    updatePoolPreview();
    panel.querySelector("#realExamV2Form").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const form = new FormData(event.target);
      const payload = { name: String(form.get("name") || "").trim() };
      const startAt = parseLocalDateTime(form.get("start_date"), form.get("start_time"));
      const endAt = parseLocalDateTime(form.get("end_date"), form.get("end_time"));
      if (startAt === "invalid" || endAt === "invalid" || !startAt || !endAt || new Date(startAt) >= new Date(endAt)) {
        return showDialogError("Thời gian bắt đầu phải trước thời gian kết thúc.");
      }
      const sources = readRealQuestionSetConfig(panel);
      if (!sources?.length || sources.reduce((sum, item) => sum + Number(item.percent || 0), 0) !== 100) {
        return showDialogError("Chọn nguồn câu hỏi và bảo đảm tổng tỷ lệ bằng 100%.");
      }
      Object.assign(payload, {
        start_at: startAt,
        end_at: endAt,
        sources,
        question_percent: Number(form.get("question_percent")),
        multi_percent: Number(form.get("multi_percent")),
        timer_seconds: Number(form.get("timer_seconds")),
        max_attempts: Number(form.get("max_attempts")),
        scoring_method: Number(form.get("scoring_method") || 2)
      });
      const restore = setButtonBusy(button, exam ? "Đang lưu..." : "Đang tạo...");
      try {
        const rpcName = exam ? "update_real_exam" : "create_real_exam";
        const args = exam
          ? { target_real_exam_id: exam.id, payload }
          : { target_space_id: spaceId, payload };
        const { data, error } = await client.rpc(rpcName, args);
        if (error) throw error;
        await renderRealExamSettings(panel, spaceId, space, {
          view: "detail",
          examId: Number(data.id),
          message: exam
            ? `Đã tạo Phiên bản ${Number(data.current_revision_no)} và giữ nguyên ID #${String(data.code).padStart(5, "0")}.`
            : `Đã tạo ${realExamDisplayName(data)} với ${Number(data.question_count || 0)} câu hỏi.`
        });
      } catch (error) {
        showDialogError(error.message);
      } finally {
        restore();
      }
    };
  }

  function normalizeRealSetConfig(sets, config) {
    const valid = (config || [])
      .map((item) => ({ id: Number(item.id ?? item.question_set_id), percent: Number(item.percent) }))
      .filter((item) => sets.some((set) => Number(set.id) === item.id));
    const base = valid.length ? valid : sets.slice(0, 1).map((set) => ({ id: Number(set.id), percent: 100 }));
    return normalizePercentConfig(base);
  }

  function normalizePercentConfig(items, changedId = null) {
    if (!items.length) return [];
    const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    const normalized = items.map((item) => ({ ...item, percent: clampPercent(item.percent) }));
    if (normalized.length === 1) return [{ ...normalized[0], percent: 100 }];
    const locked = normalized.find((item) => Number(item.id) === Number(changedId));
    const flexible = locked ? normalized.filter((item) => Number(item.id) !== Number(changedId)) : normalized;
    const target = locked ? Math.max(0, 100 - locked.percent) : 100;
    const currentTotal = flexible.reduce((sum, item) => sum + item.percent, 0);
    let remaining = target;
    flexible.forEach((item, index) => {
      const isLast = index === flexible.length - 1;
      const next = isLast
        ? remaining
        : (currentTotal ? Math.round(target * item.percent / currentTotal) : Math.floor(target / flexible.length));
      item.percent = Math.min(100, Math.max(0, next));
      remaining -= item.percent;
    });
    return normalized;
  }

  async function renderResultSettings(panel, spaceId, space) {
    panel.innerHTML = `<section class="grid settings-pane">
      <h2>Thiết lập Database</h2>
      <form id="resultRetentionForm" class="settings-section">
        <div>
          <h3>Giới hạn kết quả Thi thử</h3>
          <p class="muted">Kết quả Thi thật được giữ vĩnh viễn theo ID Đợt thi và quản lý trong từng Đợt thi thật.</p>
        </div>
        <label>Giữ kết quả Thi thử trong số ngày
          <input name="mock_result_retention_days" type="number" min="3" max="15" step="1" value="${Number(space.mock_result_retention_days || 7)}" required>
        </label>
        <div class="retention-rules">
          <span>Thi thử: tối đa 500 bản ghi/Space.</span>
          <span>Thi thật: không tự động xóa.</span>
        </div>
        <div id="resultCleanupStatus" class="muted"></div>
        <div class="settings-save"><button class="primary">Lưu thay đổi</button><button type="button" data-close>Đóng</button></div>
      </form>
    </section>`;
    document.getElementById("resultRetentionForm").onsubmit = (event) => saveResultSettings(event, spaceId);
    bindPanelCloseButtons(panel);
  }

  function resultPeriodOptions(periods) {
    return periods.map((period) => {
      const name = period.real_exam_name || "Đợt thi thật chưa đặt tên";
      const date = period.real_exam_start_at ? ` · ${formatExportDateTime(period.real_exam_start_at)}` : "";
      return `<option value="${esc(period.real_exam_version)}">${esc(name)}${esc(date)} · ${Number(period.submitted_count || 0)} bản ghi</option>`;
    }).join("");
  }

  async function saveResultSettings(event, spaceId) {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = {
      mock_result_retention_days: Number(form.get("mock_result_retention_days")),
      updated_at: new Date().toISOString()
    };
    if (payload.mock_result_retention_days < 3 || payload.mock_result_retention_days > 15) return showDialogError("Số ngày lưu kết quả thi thử phải từ 3 đến 15.");
    const restoreButton = setButtonBusy(event.submitter, "Đang lưu...");
    try {
      const { error } = await client.from("spaces").update(payload).eq("id", spaceId);
      if (error) return showDialogError(error.message);
      const { data, error: cleanupError } = await client.rpc("cleanup_space_results", { target_space_id: spaceId });
      if (cleanupError) return showDialogError(cleanupError.message);
      const status = document.getElementById("resultCleanupStatus");
      if (status) {
        status.textContent = `Đã lưu và dọn ${Number(data?.mock_deleted_by_days || 0) + Number(data?.mock_deleted_by_cap || 0)} kết quả Thi thử. Kết quả Thi thật không bị thay đổi.`;
      }
      markSpaceSettingsClean();
      await renderSpaces();
    } finally {
      restoreButton();
    }
  }

  async function fetchSelectedRealExamRows(space) {
    const select = document.getElementById("resultExamPeriodSelect");
    const examVersion = select?.value;
    if (!examVersion) throw new Error("Chọn Tên đợt thi thật trước.");
    const { data, error } = await client.rpc("export_real_exam_results_by_version", {
      requested_slug: space.slug,
      requested_exam_version: examVersion
    });
    if (error) throw error;
    return data || [];
  }

  async function loadSelectedRealExamRows(space, button) {
    const target = document.getElementById("resultPeriodPreview");
    if (!target) return;
    const restoreButton = setButtonBusy(button, "Đang tải...");
    target.classList.add("muted");
    target.innerHTML = '<div class="loading-block">Đang tải 30 kết quả cao nhất...</div>';
    try {
      const rows = (await fetchSelectedRealExamRows(space)).slice(0, 30);
      if (!rows.length) {
        target.innerHTML = '<div class="empty-state">Đợt thi thật này chưa có kết quả.</div>';
        return;
      }
      target.classList.remove("muted");
      target.innerHTML = realExamRowsTable(rows);
    } catch (error) {
      target.innerHTML = `<div class="status error">${esc(error.message || "Không tải được dữ liệu.")}</div>`;
    } finally {
      restoreButton();
    }
  }

  async function exportSelectedRealExamRows(space, button) {
    if (!window.XLSX) return showDialogError("Không thể khởi tạo chức năng xuất Excel.");
    const restoreButton = setButtonBusy(button, "Đang tạo Excel...");
    try {
      const rows = await fetchSelectedRealExamRows(space);
      if (!rows.length) return showDialogError("Đợt thi thật này chưa có dữ liệu để tải.");
      const examName = rows[0]?.real_exam_name || "Đợt thi thật";
      const sheetRows = rows.map((row) => ({
        "Group": row.group_name || "Chưa phân nhóm",
        "Tên đợt Thi thật": row.real_exam_name || examName,
        "Học viên": row.student_name,
        "Điểm": Number(row.score),
        "Đúng": Number(row.correct_count),
        "Sai": Number(row.wrong_count),
        "Tổng số câu": Number(row.total_questions),
        "Thời gian làm bài": formatExportDuration(row.duration_seconds),
        "Bắt đầu làm bài": formatExportDateTime(row.started_at),
        "Nộp bài": formatExportDateTime(row.submitted_at)
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      worksheet["!cols"] = [
        { wch: 24 }, { wch: 34 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 22 }
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Kết quả Thi thật");
      XLSX.writeFile(workbook, `ket-qua-${safeExportFileName(space.slug)}-${safeExportFileName(examName)}.xlsx`);
      setStatus(`Đã xuất ${rows.length} kết quả của “${examName}”.`);
    } catch (error) {
      showDialogError(error.message || "Không thể tải dữ liệu Thi thật.");
    } finally {
      restoreButton();
    }
  }

  function realExamRowsTable(rows) {
    return `<table class="compact-results-table">
      <thead><tr><th>#</th><th>Phiên bản</th><th>Học viên</th><th>Group</th><th>Điểm</th><th>Đúng</th><th>Thời gian</th><th>Nộp bài</th></tr></thead>
      <tbody>${rows.map((row, index) => `<tr>
        <td>${index + 1}</td>
        <td>V${Number(row.real_exam_revision_no || 1)}</td>
        <td><b>${esc(row.student_name || "")}</b></td>
        <td>${esc(row.group_name || "Chưa phân nhóm")}</td>
        <td>${Number(row.score).toFixed(2)}</td>
        <td>${Number(row.correct_count || 0)}/${Number(row.total_questions || 0)}</td>
        <td>${formatExportDuration(row.duration_seconds)}</td>
        <td>${formatExportDateTime(row.submitted_at)}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  function wireRealSetControls(root = document) {
    const sync = (changedId = null) => {
      const checked = [...root.querySelectorAll("[data-real-set-check]:checked")].map((input) => ({
        id: Number(input.dataset.realSetCheck),
        percent: Number(root.querySelector(`[data-real-set-percent="${input.dataset.realSetCheck}"]`)?.value || 0)
      }));
      const normalized = normalizePercentConfig(checked, changedId);
      root.querySelectorAll("[data-real-set-percent]").forEach((input) => {
        const item = normalized.find((config) => Number(config.id) === Number(input.dataset.realSetPercent));
        input.disabled = !item;
        if (item) input.value = String(item.percent);
        else input.value = "0";
      });
      const total = normalized.reduce((sum, item) => sum + item.percent, 0);
      const hint = root.querySelector("#realSetTotalHint");
      if (hint) hint.textContent = normalized.length ? `Tổng tỷ lệ đang chọn: ${total}%` : "Chọn ít nhất một Bộ câu hỏi khi bật Thi thật.";
    };
    root.querySelectorAll("[data-real-set-check]").forEach((input) => {
      input.onchange = () => sync();
    });
    root.querySelectorAll("[data-real-set-percent]").forEach((input) => {
      input.oninput = () => sync(Number(input.dataset.realSetPercent));
    });
    sync();
  }

  function bindPanelCloseButtons(panel) {
    panel.querySelectorAll("[data-close]").forEach((button) => {
      button.onclick = requestSpaceSettingsClose;
    });
  }

  function setButtonBusy(button, label) {
    if (!button) return () => {};
    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return () => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.textContent = previousLabel;
    };
  }

  async function loadLatestRealExamResults(id) {
    const target = document.getElementById("realExamTopResults");
    const button = document.getElementById("viewRealExamResultsBtn");
    const space = state.spaces.find((item) => item.id === id);
    if (!target || !space) return;
    const restoreButton = setButtonBusy(button, "Đang tải...");
    target.classList.add("muted");
    target.innerHTML = '<div class="loading-block">Đang tải 15 kết quả cao nhất...</div>';
    try {
      const { data, error } = await client.rpc("export_real_exam_results", {
        requested_slug: space.slug,
        exam_limit: 1
      });
      if (error) throw error;
      const rows = (data || [])
        .filter((row) => Number(row.exam_rank || 1) === 1)
        .sort((a, b) =>
          Number(b.score) - Number(a.score)
          || Number(a.duration_seconds) - Number(b.duration_seconds)
          || new Date(b.submitted_at) - new Date(a.submitted_at)
        )
        .slice(0, 15);
      if (!rows.length) {
        target.innerHTML = '<div class="empty-state">Chưa có kết quả Thi thật gần nhất.</div>';
        return;
      }
      target.classList.remove("muted");
      target.innerHTML = `<table class="compact-results-table">
        <thead><tr><th>#</th><th>Học viên</th><th>Group</th><th>Điểm</th><th>Đúng</th><th>Thời gian</th><th>Nộp bài</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr>
          <td>${index + 1}</td>
          <td><b>${esc(row.student_name || "")}</b></td>
          <td>${esc(row.group_name || "Chưa phân nhóm")}</td>
          <td>${Number(row.score).toFixed(2)}</td>
          <td>${Number(row.correct_count || 0)}/${Number(row.total_questions || 0)}</td>
          <td>${formatExportDuration(row.duration_seconds)}</td>
          <td>${formatExportDateTime(row.submitted_at)}</td>
        </tr>`).join("")}</tbody>
      </table>`;
    } catch (error) {
      target.innerHTML = `<div class="status error">${esc(error.message || "Không thể tải kết quả Thi thật.")}</div>`;
    } finally {
      restoreButton();
    }
  }

  function wireRealExamForm(id) {
    const form = document.getElementById("realForm");
    const scoringSelect = form.querySelector('[name="scoring_method"]');
    const scoringHelp = form.querySelector(".scoring-help");
    const scoringHelpButton = form.querySelector(".scoring-help-button");
    const scoringTooltip = form.querySelector(".scoring-tooltip");
    scoringSelect.onchange = () => {
      scoringTooltip.innerHTML = scoringMethodTooltip(Number(scoringSelect.value));
    };
    scoringHelpButton.onclick = () => {
      const open = scoringHelp.classList.toggle("open");
      scoringHelpButton.setAttribute("aria-expanded", String(open));
    };
    form.onclick = (event) => {
      if (event.target.closest(".scoring-help")) return;
      scoringHelp.classList.remove("open");
      scoringHelpButton.setAttribute("aria-expanded", "false");
    };
    form.onsubmit = (event) => saveRealExam(event, id);
  }

  function openSpace(id) {
    const space = state.spaces.find((item) => item.id === id) || {
      name: "", slug: "", timer_seconds: 60, published: true
    };
    openDialog(`<form id="spaceForm" class="grid compact-dialog-form">
      <h2>${id ? "Sửa" : "Thêm"} Space</h2>
      <div class="grid two">
        <label>Tên Space<input name="name" value="${esc(space.name)}" required></label>
        <label>Timer mặc định<input name="timer_seconds" type="number" min="1" value="${space.timer_seconds}" required></label>
      </div>
      <div class="path-field-row">
        <label>Đường dẫn<input id="spaceSlugInput" name="slug" value="${esc(space.slug)}" pattern="[a-z0-9-]+" required></label>
        <div class="path-example"><span>Ví dụ</span><code>&lt;Đường dẫn của ứng dụng&gt;/&lt;Slug&gt;</code><small id="spaceUrlPreview">${esc(new URL(encodeURIComponent(space.slug || "slug"), quizBaseUrl).href)}</small></div>
      </div>
      <label class="switch publish-switch"><input name="published" type="checkbox" ${space.published ? "checked" : ""}><span class="switch-track"></span><span>Đã xuất bản</span></label>
      <div class="actions"><button class="primary">Lưu</button><button type="button" data-close>Hủy</button></div>
    </form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    document.getElementById("spaceSlugInput").oninput = (event) => {
      document.getElementById("spaceUrlPreview").textContent = new URL(
        encodeURIComponent(event.target.value || "slug"),
        quizBaseUrl
      ).href;
    };
    document.getElementById("spaceForm").onsubmit = (event) => saveSpace(event, id);
  }

  async function saveSpace(event, id) {
    event.preventDefault();
    const restoreButton = setButtonBusy(event.submitter, "Đang lưu...");
    const form = new FormData(event.target);
    const payload = {
      name: form.get("name").trim(),
      slug: form.get("slug").trim().toLowerCase(),
      timer_seconds: Number(form.get("timer_seconds")),
      published: form.has("published"),
      updated_at: new Date().toISOString()
    };
    try {
      let result;
      if (id) result = await client.from("spaces").update(payload).eq("id", id);
      else result = await client.from("spaces").insert(payload).select("id").single();
      if (result.error) return showDialogError(result.error.message);
      if (!id) {
        const { error } = await client.from("groups").insert({ space_id: result.data.id, name: payload.name });
        if (error) return showDialogError(error.message);
        const { error: setError } = await client.from("question_sets").insert({ space_id: result.data.id, name: "Mặc định" });
        if (setError) return showDialogError(setError.message);
      }
      closeDialog();
      await renderSpaces();
    } finally {
      restoreButton();
    }
  }

  async function deleteSpace(id) {
    if (!confirm("Xóa Space và toàn bộ Group/câu hỏi của Space này?")) return;
    const { error } = await client.from("spaces").delete().eq("id", id);
    if (error) return setStatus(error.message, true);
    await renderSpaces();
  }

  async function exportRealExamResults(id) {
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return setStatus("Space không tồn tại.", true);
    if (!window.XLSX) return setStatus("Không thể khởi tạo chức năng xuất Excel.", true);

    const button = document.querySelector(`[data-export-real="${id}"]`)
      || document.getElementById("exportRealExamBtn");
    const buttonLabel = button?.textContent || "Tải Excel dữ liệu Thi thật";
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tạo Excel...";
    }
    try {
      const { data, error } = await client.rpc("export_real_exam_results", {
        requested_slug: space.slug,
        exam_limit: 3
      });
      if (error) throw error;
      if (!data?.length) {
        setStatus(`Space “${space.name}” chưa có dữ liệu Thi thật để xuất.`, true);
        return;
      }

      const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
      const bestByStudentAndExam = new Map();
      data.forEach((row) => {
        const studentKey = String(row.student_name || "").trim().toLocaleLowerCase("vi");
        const key = `${row.real_exam_version}::${studentKey}`;
        const current = bestByStudentAndExam.get(key);
        if (
          !current
          || Number(row.score) > Number(current.score)
          || (Number(row.score) === Number(current.score) && Number(row.duration_seconds) < Number(current.duration_seconds))
          || (
            Number(row.score) === Number(current.score)
            && Number(row.duration_seconds) === Number(current.duration_seconds)
            && new Date(row.submitted_at) > new Date(current.submitted_at)
          )
        ) {
          bestByStudentAndExam.set(key, row);
        }
      });
      const rows = [...bestByStudentAndExam.values()].sort((a, b) =>
        collator.compare(a.group_name || "", b.group_name || "")
        || Number(a.exam_rank) - Number(b.exam_rank)
        || Number(b.score) - Number(a.score)
        || Number(a.duration_seconds) - Number(b.duration_seconds)
        || collator.compare(a.student_name || "", b.student_name || "")
        || new Date(a.submitted_at) - new Date(b.submitted_at)
      );
      const sheetRows = rows.map((row) => ({
        "Group": row.group_name || "Chưa phân nhóm",
        "Đợt Thi thật": formatExamPeriod(row),
        "Học viên": row.student_name,
        "Điểm": Number(row.score),
        "Đúng": Number(row.correct_count),
        "Sai": Number(row.wrong_count),
        "Tổng số câu": Number(row.total_questions),
        "Thời gian làm bài": formatExportDuration(row.duration_seconds),
        "Bắt đầu làm bài": formatExportDateTime(row.started_at),
        "Nộp bài": formatExportDateTime(row.submitted_at)
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      worksheet["!cols"] = [
        { wch: 24 }, { wch: 42 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 22 }
      ];
      const examFillColors = {
        1: "FFFF00",
        2: "FFC0CB",
        3: "D9D9D9"
      };
      rows.forEach((row, index) => {
        const fillColor = examFillColors[Number(row.exam_rank)];
        if (!fillColor) return;
        for (let column = 0; column < 10; column += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
          if (cell) {
            cell.s = {
              fill: { patternType: "solid", fgColor: { rgb: fillColor } }
            };
          }
        }
      });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Kết quả Thi thật");
      XLSX.writeFile(workbook, `ket-qua-thi-that-${safeExportFileName(space.slug)}.xlsx`);
      setStatus(`Đã xuất ${rows.length} kết quả Thi thật của Space “${space.name}”.`);
    } catch (error) {
      setStatus(`Không thể xuất Excel: ${error.message || "Lỗi không xác định"}`, true);
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = buttonLabel;
      }
    }
  }

  function formatExamPeriod(row) {
    const rank = Number(row.exam_rank);
    const label = rank === 1 ? "Đợt gần nhất" : `Đợt gần thứ ${rank}`;
    return `${label} · ${formatExportDateTime(row.real_exam_start_at)} - ${formatExportDateTime(row.real_exam_end_at)}`;
  }

  function formatExportDateTime(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("vi-VN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function formatExportDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(total / 60);
    const remainingSeconds = Math.floor(total % 60);
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function safeExportFileName(value) {
    return String(value || "space").replace(/[^a-zA-Z0-9_-]+/g, "-");
  }

  async function openGroups(spaceId) {
    const space = state.spaces.find((item) => item.id === spaceId);
    const { data, error } = await client.from("groups").select("*").eq("space_id", spaceId).order("name");
    if (error) return setStatus(error.message, true);
    openDialog(`<div class="grid"><h2>Group · ${esc(space.name)}</h2>
      <div id="groupList" class="grid">${data.map((group) => `<div class="space-between"><b>${esc(group.name)}</b><div class="actions"><button data-rename-group="${group.id}">Sửa</button><button class="danger" data-delete-group="${group.id}">Xóa</button></div></div>`).join("")}</div>
      <form id="addGroupForm" class="actions"><input name="name" placeholder="Tên Group mới" required><button class="primary">Thêm</button></form>
      <button data-close>Đóng</button>
    </div>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    document.getElementById("addGroupForm").onsubmit = async (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name").trim();
      const { error: insertError } = await client.from("groups").insert({ space_id: spaceId, name });
      if (insertError) return showDialogError(insertError.message);
      closeDialog();
      await openGroups(spaceId);
    };
    bind("[data-rename-group]", async (button) => {
      const group = data.find((item) => item.id === Number(button.dataset.renameGroup));
      const name = prompt("Tên Group mới", group.name)?.trim();
      if (!name) return;
      const { error: updateError } = await client.from("groups").update({ name }).eq("id", group.id);
      if (updateError) return showDialogError(updateError.message);
      closeDialog();
      await openGroups(spaceId);
    });
    bind("[data-delete-group]", async (button) => {
      if (data.length <= 1) return showDialogError("Space phải có ít nhất 1 Group.");
      if (!confirm("Xóa Group này?")) return;
      const { error: deleteError } = await client.from("groups").delete().eq("id", Number(button.dataset.deleteGroup));
      if (deleteError) return showDialogError(deleteError.message);
      closeDialog();
      await openGroups(spaceId);
    });
  }

  function openQuestions(spaceId) {
    const space = state.spaces.find((item) => item.id === spaceId);
    openDialog(`<div class="grid"><h2>Upload CSV · ${esc(space.name)}</h2>
      <p class="muted">CSV mới được nối thêm vào ngân hàng hiện tại.</p>
      <input id="csvFile" type="file" accept=".csv,text/csv">
      <div id="csvPreview" class="muted"></div>
      <div class="actions">
        <button class="primary" id="previewCsvBtn">Preview</button>
        <button id="importCsvBtn" disabled>Thêm dữ liệu</button>
        <button id="exportQuestionsBtn">Tải ngân hàng câu hỏi</button>
        <button class="danger" id="deleteQuestionsBtn">Xóa toàn bộ câu hỏi</button>
        <button data-close>Đóng</button>
      </div>
    </div>`);
    let parsedQuestions = [];
    document.querySelector("[data-close]").onclick = closeDialog;
    document.getElementById("previewCsvBtn").onclick = () => {
      const file = document.getElementById("csvFile").files[0];
      if (!file) return showDialogError("Chọn file CSV trước.");
      Papa.parse(file, {
        complete: (result) => {
          try {
            parsedQuestions = parseQuestions(result.data);
            document.getElementById("csvPreview").textContent = `Hợp lệ: ${parsedQuestions.length} câu hỏi.`;
            document.getElementById("importCsvBtn").disabled = false;
          } catch (error) {
            parsedQuestions = [];
            showDialogError(error.message);
          }
        }
      });
    };
    document.getElementById("importCsvBtn").onclick = () => importQuestions(spaceId, parsedQuestions);
    document.getElementById("exportQuestionsBtn").onclick = () => exportQuestions(spaceId, space.slug);
    document.getElementById("deleteQuestionsBtn").onclick = () => deleteAllQuestions(spaceId);
  }

  async function exportQuestions(spaceId, spaceSlug, questionSetId = null, options = {}) {
    const button = document.querySelector(`[data-export-questions="${spaceId}"]`)
      || document.getElementById("exportQuestionsBtn");
    const buttonLabel = button?.textContent || "Tải ngân hàng câu hỏi";
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tạo CSV...";
    }
    try {
      let query = client
        .from("questions")
        .select("order_no,type,content,options_json,correct_json")
        .eq("space_id", spaceId)
        .is("hidden_at", null)
        .order("order_no");
      if (questionSetId) query = query.eq("question_set_id", questionSetId);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) throw new Error("Space chưa có câu hỏi để tải.");

      const csvRows = data.map((question, index) => {
        const options = question.options_json || {};
        const correct = Array.isArray(question.correct_json) ? question.correct_json : [];
        return {
          "Số thứ tự": Number(question.order_no) || index + 1,
          "Loại câu hỏi": question.type === "multi" ? "Nhiều lựa chọn" : "Một lựa chọn",
          "Nội dung câu hỏi": question.content,
          "A": options.A || "",
          "B": options.B || "",
          "C": options.C || "",
          "D": options.D || "",
          "E": options.E || "",
          "Đáp án đúng": correct.join(", ")
        };
      });
      const csv = `\uFEFF${Papa.unparse(csvRows)}`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ngan-hang-cau-hoi-${safeExportFileName(spaceSlug)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (!options.preserveDialog) setStatus(`Đã tải ${data.length} câu hỏi.`);
      return data.length;
    } catch (error) {
      showDialogError(error.message || "Không thể tải ngân hàng câu hỏi.");
      return 0;
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = buttonLabel;
      }
    }
  }

  function parseQuestions(rows) {
    const clean = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
    if (clean.length < 2) throw new Error("CSV không có dữ liệu.");
    const headers = clean[0].map((cell) => String(cell || "").trim().toLowerCase());
    const find = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
    const columns = {
      type: find("loại câu hỏi", "loai cau hoi"),
      content: find("nội dung câu hỏi", "noi dung cau hoi"),
      a: find("a"), b: find("b"), c: find("c"), d: find("d"), e: find("e"),
      correct: find("đáp án đúng", "dap an dung")
    };
    if ([columns.type, columns.content, columns.a, columns.b, columns.correct].some((index) => index === undefined)) {
      throw new Error("Thiếu cột bắt buộc: Loại câu hỏi, Nội dung câu hỏi, A, B, Đáp án đúng.");
    }
    return clean.slice(1).map((row, index) => {
      const rawType = String(row[columns.type] || "").trim().toLowerCase();
      const type = rawType.includes("nhiều") || rawType.includes("nhieu") || rawType === "multi" ? "multi" : "single";
      const options = {};
      ["a", "b", "c", "d", "e"].forEach((letter) => {
        const column = columns[letter];
        const value = column === undefined ? "" : String(row[column] || "").trim();
        if (value) options[letter.toUpperCase()] = value;
      });
      if (!options.A || !options.B) throw new Error(`Dòng ${index + 2}: phải có ít nhất đáp án A và B.`);
      const correct = String(row[columns.correct] || "").trim().toUpperCase().split(/[,;|/ ]+/).filter(Boolean);
      if (!correct.length || correct.some((letter) => !options[letter])) throw new Error(`Dòng ${index + 2}: đáp án đúng không hợp lệ.`);
      return { type, content: String(row[columns.content] || "").trim(), options_json: options, correct_json: correct };
    });
  }

  function buildQuestionInsertRows(spaceId, questions, questionSetId, maxOrder) {
    return questions.map((question, index) => ({
      space_id: spaceId,
      question_set_id: questionSetId,
      order_no: maxOrder + index + 1,
      type: question.type,
      content: question.content,
      options_json: question.options_json,
      correct_json: question.correct_json
    }));
  }

  async function importQuestions(spaceId, questions, questionSetId = null, button = null, options = {}) {
    if (!questions.length) return 0;
    const restoreButton = setButtonBusy(button, `Đang thêm ${questions.length} câu...`);
    try {
      const { data: current } = await client.from("questions").select("order_no").eq("space_id", spaceId).order("order_no", { ascending: false }).limit(1);
      const maxOrder = current?.[0]?.order_no || 0;
      const rows = buildQuestionInsertRows(spaceId, questions, questionSetId, maxOrder);
      const { error } = await client.from("questions").insert(rows);
      if (error) {
        showDialogError(error.message);
        return 0;
      }
      if (!options.preserveDialog) {
        closeDialog();
        setStatus(`Đã thêm ${rows.length} câu hỏi.`);
        await renderSpaces();
      }
      return rows.length;
    } finally {
      restoreButton();
    }
  }

  async function deleteAllQuestions(spaceId, questionSetId = null, button = null, options = {}) {
    if (!options.confirmed && !confirm("Xóa toàn bộ câu hỏi của Ngân hàng đang chọn? Có thể khôi phục trong 30 ngày.")) return false;
    if (!questionSetId) {
      showDialogError("Hãy chọn một ngân hàng câu hỏi trước khi xóa.");
      return false;
    }
    const restoreButton = setButtonBusy(button, "Đang xóa...");
    try {
      const { error } = await client.rpc("clear_question_set_questions", {
        target_question_set_id: questionSetId
      });
      if (error) {
        showDialogError(error.message);
        return false;
      }
      if (!options.preserveDialog) {
        closeDialog();
        setStatus("Đã xóa toàn bộ câu hỏi vào Thùng rác trong 30 ngày.");
        await renderSpaces();
      }
      return true;
    } finally {
      restoreButton();
    }
  }

  function openRealExam(id) {
    const space = state.spaces.find((item) => item.id === id);
    openDialog(`<form id="realForm" class="grid compact-dialog-form real-exam-form">
      <div class="real-exam-header">
        <h2>Chế độ Thi thật</h2>
        <label class="switch"><input name="enabled" type="checkbox" ${space.real_exam_enabled ? "checked" : ""}><span class="switch-track"></span><span>Bật Thi thật</span></label>
      </div>
      <div class="grid two real-exam-row">
        ${selectField("question_percent", "Số lượng câu hỏi", [30,50,70,100], space.real_question_percent, "%")}
        ${selectField("timer_seconds", "Thời gian mỗi câu", [45,60,90,120], space.real_timer_seconds, "s")}
      </div>
      <div class="grid two real-exam-row">
        ${selectField("multi_percent", "Tỷ lệ câu nhiều đáp án", [30,50,70,100], space.real_multi_percent, "%")}
        ${selectField("max_attempts", "Số lần thi tối đa", [1,2,3,4,5], space.real_max_attempts, "")}
      </div>
      <div class="grid two real-exam-row">
        <label>Ngày giờ bắt đầu<input name="start_at" type="datetime-local" value="${toLocalInput(space.real_start_at)}"></label>
        <label>Ngày giờ kết thúc<input name="end_at" type="datetime-local" value="${toLocalInput(space.real_end_at)}"></label>
      </div>
      <div class="scoring-field-row">
        <label>Cách tính điểm<select name="scoring_method">
          <option value="1" ${Number(space.real_scoring_method || 1) === 1 ? "selected" : ""}>Cách tính điểm 1</option>
          <option value="2" ${Number(space.real_scoring_method || 1) === 2 ? "selected" : ""}>Cách tính điểm 2</option>
        </select></label>
        <div class="scoring-help">
          <button type="button" class="scoring-help-button" aria-label="Xem chi tiết cách tính điểm" aria-expanded="false">?</button>
          <div class="scoring-tooltip" role="tooltip">${scoringMethodTooltip(Number(space.real_scoring_method || 1))}</div>
        </div>
      </div>
      <div class="actions"><button class="primary">Lưu</button><button type="button" data-close>Hủy</button></div>
    </form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    wireRealExamForm(id);
  }

  function scoringMethodTooltip(method) {
    return method === 2
      ? `<b>Cách tính điểm 2</b><span>A = (số câu đúng / tổng câu) × 95. B = tổng câu × thời gian mỗi câu. C = ((B − thời gian làm bài) / B) × 5, tối đa 5. Điểm cuối = A + C.</span>`
      : `<b>Cách tính điểm 1</b><span>75 điểm kiến thức có tính gần đúng; 10 điểm quy mô đề; 10 điểm tốc độ; 5 điểm đúng giờ.</span>`;
  }

  function selectField(name, label, values, selected, suffix) {
    return `<label>${label}<select name="${name}">${values.map((value) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${value}${suffix}</option>`).join("")}</select></label>`;
  }

  function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function toLocalDateText(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function toLocalDateInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function toLocalTimeText(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function timeOptions(selectedValue) {
    const selected = selectedValue || "00:00";
    const options = [];
    for (let hour = 7; hour < 23; hour += 1) {
      for (let minute = 0; minute < 60; minute += 15) {
        const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        options.push(`<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`);
      }
    }
    return options.join("");
  }

  function parseLocalDateTime(dateValue, timeValue) {
    const dateText = String(dateValue || "").trim();
    const timeText = String(timeValue || "").trim();
    if (!dateText && !timeText) return null;
    const slashDate = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const isoDate = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const match = slashDate || (isoDate ? [isoDate[0], isoDate[3], isoDate[2], isoDate[1]] : null);
    if (!match || !/^\d{2}:\d{2}$/.test(timeText)) return "invalid";
    const [, day, month, year] = match;
    const [hour, minute] = timeText.split(":").map(Number);
    if (minute % 5 !== 0) return "invalid";
    const date = new Date(Number(year), Number(month) - 1, Number(day), hour, minute, 0, 0);
    if (
      date.getFullYear() !== Number(year)
      || date.getMonth() !== Number(month) - 1
      || date.getDate() !== Number(day)
    ) return "invalid";
    return Number.isFinite(date.getTime()) ? date.toISOString() : "invalid";
  }

  function readRealQuestionSetConfig(root = document) {
    if (!root.querySelector("[data-real-set-check]")) return null;
    const rows = [...root.querySelectorAll("[data-real-set-check]:checked")].map((input) => ({
      id: Number(input.dataset.realSetCheck),
      percent: Number(root.querySelector(`[data-real-set-percent="${input.dataset.realSetCheck}"]`)?.value || 0)
    }));
    return normalizePercentConfig(rows);
  }

  async function saveRealExam(event, id) {
    event.preventDefault();
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return showDialogError("Space không tồn tại.");
    const form = new FormData(event.target);
    const enabled = form.has("enabled");
    const startIso = form.has("start_date")
      ? parseLocalDateTime(form.get("start_date"), form.get("start_time"))
      : (form.get("start_at") ? new Date(form.get("start_at")).toISOString() : null);
    const endIso = form.has("end_date")
      ? parseLocalDateTime(form.get("end_date"), form.get("end_time"))
      : (form.get("end_at") ? new Date(form.get("end_at")).toISOString() : null);
    if (startIso === "invalid" || endIso === "invalid") return showDialogError("Ngày giờ Thi thật không hợp lệ. Phút phải là bội số của 5.");
    if (enabled && (!startIso || !endIso || new Date(startIso) >= new Date(endIso))) return showDialogError("Khoảng thời gian Thi thật không hợp lệ.");
    const realQuestionSets = readRealQuestionSetConfig();
    if (enabled && realQuestionSets && !realQuestionSets.length) return showDialogError("Chọn ít nhất một Bộ câu hỏi cho Thi thật.");
    const startsNewExam = enabled && (
      !space.real_exam_enabled
      || new Date(space.real_start_at || 0).getTime() !== new Date(startIso || 0).getTime()
      || new Date(space.real_end_at || 0).getTime() !== new Date(endIso || 0).getTime()
      || (realQuestionSets && JSON.stringify(realQuestionSets) !== JSON.stringify(space.real_question_sets || []))
    );
    const payload = {
      real_exam_name: form.get("real_exam_name")?.trim() || null,
      real_exam_enabled: enabled,
      real_scoring_method: Number(form.get("scoring_method")),
      real_question_percent: Number(form.get("question_percent")),
      real_timer_seconds: Number(form.get("timer_seconds")),
      real_multi_percent: Number(form.get("multi_percent")),
      real_max_attempts: Number(form.get("max_attempts")),
      ...(realQuestionSets ? { real_question_sets: realQuestionSets } : {}),
      real_exam_version: startsNewExam || !space.real_exam_version ? crypto.randomUUID() : space.real_exam_version,
      real_start_at: startIso,
      real_end_at: endIso,
      updated_at: new Date().toISOString()
    };
    const restoreButton = setButtonBusy(event.submitter, "Đang lưu...");
    try {
      const { error } = await client.from("spaces").update(payload).eq("id", id);
      if (error) return showDialogError(error.message);
      closeDialog();
      await renderSpaces();
    } finally {
      restoreButton();
    }
  }

  async function renderUsers() {
    const view = document.getElementById("view");
    const { data, error } = await client.from("profiles").select("*").order("created_at");
    if (error) return setStatus(error.message, true);
    view.innerHTML = `<header class="topbar"><div><h1>Quản lý Admin</h1><p class="muted">Tài khoản được quản lý qua Supabase Auth.</p></div><button class="primary" id="addUserBtn">Thêm Admin</button></header>
      <section class="panel table-wrap"><table><thead><tr><th>Email</th><th>Họ tên</th><th>Role</th><th>Active</th><th></th></tr></thead>
      <tbody>${data.map((user) => `<tr><td>${esc(user.email)}</td><td>${esc(user.fullname)}</td><td>${esc(user.role)}</td><td>${user.active ? "Có" : "Không"}</td><td><div class="actions"><button data-edit-user="${user.id}">Sửa</button><button data-reset-user="${user.id}">Cấp lại mật khẩu</button><button class="danger" data-delete-user="${user.id}">Xóa</button></div></td></tr>`).join("")}</tbody></table></section>`;
    document.getElementById("addUserBtn").onclick = () => openUser();
    bind("[data-edit-user]", (button) => openUser(data.find((user) => user.id === button.dataset.editUser)));
    bind("[data-reset-user]", (button) => openAdminPasswordReset(data.find((user) => user.id === button.dataset.resetUser)));
    bind("[data-delete-user]", async (button) => {
      if (!confirm("Xóa tài khoản Admin này?")) return;
      const { error: invokeError } = await client.functions.invoke("admin-users", {
        body: { action: "delete", id: button.dataset.deleteUser }
      });
      if (invokeError) return setStatus(invokeError.message, true);
      await renderUsers();
    });
  }

  function createAdminPassword() {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%&*?";
    const all = `${upper}${lower}${digits}${symbols}`;
    const pick = (source) => source[crypto.getRandomValues(new Uint32Array(1))[0] % source.length];
    const characters = [pick(upper), pick(lower), pick(digits), pick(symbols), ...Array.from({ length: 4 }, () => pick(all))];
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const next = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
      [characters[index], characters[next]] = [characters[next], characters[index]];
    }
    return characters.join("");
  }

  function openAdminPasswordReset(user) {
    if (!user) return;
    const generatedPassword = createAdminPassword();
    openDialog(`<form id="resetAdminPasswordForm" class="grid password-panel" aria-labelledby="resetAdminPasswordTitle"><div><span class="settings-eyebrow">${esc(user.email)}</span><h2 id="resetAdminPasswordTitle">Cấp lại mật khẩu</h2><p class="muted">Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt.</p></div><label for="resetAdminPassword">Mật khẩu mới<div class="password-field"><input id="resetAdminPassword" name="password" type="password" value="${esc(generatedPassword)}" minlength="8" autocomplete="new-password" required><button type="button" class="icon-button" id="toggleResetAdminPassword" aria-label="Hiện mật khẩu"><i data-lucide="eye"></i></button></div></label><p id="resetAdminPasswordError" class="question-editor-error" role="alert" hidden></p><div class="actions"><button type="button" data-close>Hủy</button><button class="primary">Update</button></div></form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    const passwordInput = document.getElementById("resetAdminPassword");
    const toggle = document.getElementById("toggleResetAdminPassword");
    toggle.onclick = () => {
      const visible = passwordInput.type === "text";
      passwordInput.type = visible ? "password" : "text";
      toggle.setAttribute("aria-label", visible ? "Hiện mật khẩu" : "Ẩn mật khẩu");
      toggle.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}"></i>`;
      window.lucide?.createIcons();
    };
    window.lucide?.createIcons();
    document.getElementById("resetAdminPasswordForm").onsubmit = async (event) => {
      event.preventDefault();
      const password = String(new FormData(event.target).get("password") || "");
      const error = document.getElementById("resetAdminPasswordError");
      if (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        error.textContent = "Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt.";
        error.hidden = false;
        return;
      }
      error.hidden = true;
      const restore = setButtonBusy(event.submitter, "Đang cập nhật...");
      try {
        const { error: invokeError } = await client.functions.invoke("admin-users", { body: { action: "reset_password", id: user.id, password } });
        if (invokeError) throw invokeError;
        closeDialog();
        setStatus(`Đã cấp lại mật khẩu cho ${user.email}.`);
      } catch (invokeError) {
        error.textContent = invokeError.message || "Không thể cấp lại mật khẩu.";
        error.hidden = false;
      } finally { restore(); }
    };
  }

  async function openUser(user = null) {
    const { data: assignments } = user
      ? await client.from("space_admins").select("space_id").eq("user_id", user.id)
      : { data: [] };
    const assigned = new Set((assignments || []).map((item) => item.space_id));
    openDialog(`<form id="userForm" class="grid"><h2>${user ? "Sửa" : "Thêm"} Admin</h2>
      <div class="grid two">
        <label>Email<input name="email" type="email" value="${esc(user?.email || "")}" ${user ? "disabled" : "required"}></label>
        <label>Họ tên<input name="fullname" value="${esc(user?.fullname || "")}" required></label>
        <label>Vai trò<select name="role"><option value="admin" ${user?.role === "admin" ? "selected" : ""}>admin</option><option value="superadmin" ${user?.role === "superadmin" ? "selected" : ""}>superadmin</option></select></label>
        ${user ? '<label class="switch"><input name="active" type="checkbox" ' + (user.active ? "checked" : "") + '><span class="switch-track"></span><span>Active</span></label>' : '<label>Mật khẩu ban đầu<input name="password" type="password" minlength="8" required></label>'}
      </div>
      <label>Phân quyền Space<select name="space_ids" multiple size="6">${state.spaces.map((space) => `<option value="${space.id}" ${assigned.has(space.id) ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label>
      <div class="actions"><button class="primary">Lưu</button><button type="button" data-close>Hủy</button></div>
    </form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    document.getElementById("userForm").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const body = user
        ? { action: "update", id: user.id, fullname: form.get("fullname"), role: form.get("role"), active: form.has("active") }
        : { action: "create", email: form.get("email"), fullname: form.get("fullname"), role: form.get("role"), password: form.get("password") };
      const { data: invokeData, error } = await client.functions.invoke("admin-users", { body });
      if (error) return showDialogError(error.message);
      const userId = user?.id || invokeData?.id;
      if (userId && body.role === "admin") {
        await client.from("space_admins").delete().eq("user_id", userId);
        const rows = form.getAll("space_ids").map((spaceId) => ({ user_id: userId, space_id: Number(spaceId) }));
        if (rows.length) {
          const { error: assignmentError } = await client.from("space_admins").insert(rows);
          if (assignmentError) return showDialogError(assignmentError.message);
        }
      }
      closeDialog();
      await renderUsers();
    };
  }

  function renderBackup() {
    const view = document.getElementById("view");
    view.innerHTML = `<header class="topbar"><div><h1>Backup & Restore</h1><p class="muted">Chỉ superadmin được phép thực hiện.</p></div></header>
      <section class="grid two">
        <div class="panel grid"><h2>Tạo backup</h2><p class="muted">Xuất Space, Group, câu hỏi, phân quyền và kết quả thành JSON.</p><button class="primary" id="backupBtn">Tải backup</button></div>
        <div class="panel grid"><h2>Restore</h2><input id="restoreFile" type="file" accept=".json,application/json"><label class="switch"><input id="replaceRestore" type="checkbox"><span class="switch-track"></span><span>Thay thế dữ liệu hiện tại</span></label><button class="danger" id="restoreBtn">Restore dữ liệu</button></div>
      </section>`;
    document.getElementById("backupBtn").onclick = createBackup;
    document.getElementById("restoreBtn").onclick = restoreBackup;
  }

  function renderPassword() {
    const view = document.getElementById("view");
    view.innerHTML = `<header class="topbar"><div><h1>Đổi mật khẩu</h1></div></header>
      <form class="panel grid password-panel" id="passwordForm">
        <label>Mật khẩu mới<input name="password" type="password" minlength="8" required></label>
        <button class="primary">Cập nhật mật khẩu</button>
      </form>`;
    document.getElementById("passwordForm").onsubmit = async (event) => {
      event.preventDefault();
      const password = new FormData(event.target).get("password");
      const { error } = await client.auth.updateUser({ password });
      setStatus(error ? error.message : "Đã đổi mật khẩu.", Boolean(error));
    };
  }

  async function createBackup() {
    const { data, error } = await client.rpc("backup_app_data");
    if (error) return setStatus(error.message, true);
    downloadBackup(data, "vn-quiz-backup");
    setStatus("Đã tạo backup.");
  }

  function downloadBackup(data, prefix) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function restoreBackup() {
    const file = document.getElementById("restoreFile").files[0];
    if (!file) return setStatus("Chọn file backup trước.", true);
    if (!confirm("Restore sẽ thay đổi dữ liệu ứng dụng. Tiếp tục?")) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      return setStatus("File backup không phải JSON hợp lệ.", true);
    }
    const { data: safetyBackup, error: backupError } = await client.rpc("backup_app_data");
    if (backupError) return setStatus(`Không tạo được backup an toàn: ${backupError.message}`, true);
    downloadBackup(safetyBackup, "vn-quiz-before-restore");
    const { data, error } = await client.rpc("restore_app_data", {
      payload,
      replace_existing: document.getElementById("replaceRestore").checked
    });
    setStatus(error ? error.message : `Restore thành công: ${JSON.stringify(data)}`, Boolean(error));
  }

  function clearDialogError() {
    if (dialogErrorTimer) {
      window.clearTimeout(dialogErrorTimer);
      dialogErrorTimer = null;
    }
    dialog.querySelector(".dialog-error-toast")?.remove();
  }

  function showDialogError(message) {
    clearDialogError();
    const body = dialog.querySelector(".dialog-body");
    if (!body) return;

    const error = document.createElement("div");
    error.className = "status error dialog-error-toast";
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "assertive");

    const text = document.createElement("span");
    text.className = "dialog-error-message";
    text.textContent = message;

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "dialog-error-dismiss";
    dismiss.setAttribute("aria-label", "Ẩn thông báo lỗi");
    dismiss.textContent = "×";
    dismiss.onclick = clearDialogError;

    error.append(text, dismiss);
    body.prepend(error);
    dialogErrorTimer = window.setTimeout(clearDialogError, 10000);
  }

  dialog.addEventListener("close", clearDialogError);
  boot();
  startAppVersionMonitoring();
})();
