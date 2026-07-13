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

  function setStatus(message, error = false) {
    state.status = message;
    state.error = error;
    render();
  }

  function showAppUpdateToast() {
    if (!state.updateAvailableVersion || document.querySelector(".app-update-toast")) return;
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "app-update-toast";
    toast.textContent = "Làm mới ứng dụng";
    toast.setAttribute("aria-label", "Có phiên bản mới. Làm mới ứng dụng");
    toast.onclick = forceRefreshApplication;
    document.body.appendChild(toast);
  }

  function forceRefreshApplication() {
    const target = new URL(window.location.href);
    target.searchParams.set("app_version", state.updateAvailableVersion || String(Date.now()));
    window.location.replace(target.href);
  }

  /**
   * Checks whether a newer deployed admin/frontend bundle is available.
   *
   * @returns {Promise<void>}
   */
  async function checkForAppUpdate() {
    try {
      const response = await fetch(APP_VERSION_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const latestVersion = typeof payload?.version === "string" ? payload.version.trim() : "";
      if (!latestVersion) throw new Error("Dữ liệu phiên bản không hợp lệ.");
      if (latestVersion !== APP_VERSION) {
        state.updateAvailableVersion = latestVersion;
        showAppUpdateToast();
      }
    } catch (error) {
      console.warn("Không thể kiểm tra phiên bản mới của trang quản trị.", error);
    }
  }

  function startAppVersionMonitoring() {
    checkForAppUpdate();
    window.setInterval(checkForAppUpdate, APP_VERSION_CHECK_INTERVAL_MS);
  }

  async function boot() {
    if (!client) {
      app.innerHTML = '<main class="login-screen"><section class="login-panel"><h1>Chưa cấu hình Supabase</h1></section></main>';
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
        <div><div class="brand">mquiz</div><div>Cloud Admin</div></div>
        <nav>
          <button class="${state.view === "spaces" ? "active" : ""}" data-view="spaces">Quản lý Space</button>
          ${state.profile.role === "superadmin" ? '<button class="' + (state.view === "users" ? "active" : "") + '" data-view="users">Quản lý Admin</button>' : ""}
          ${state.profile.role === "superadmin" ? '<button class="' + (state.view === "backup" ? "active" : "") + '" data-view="backup">Backup & Restore</button>' : ""}
          <button class="${state.view === "password" ? "active" : ""}" data-view="password">Đổi mật khẩu</button>
        </nav>
        <div class="sidebar-user"><b>${esc(state.profile.fullname)}</b><br><span>${esc(state.profile.email)}</span><br><small>${esc(state.profile.role)}</small></div>
        <button id="logoutBtn">Đăng xuất</button>
      </aside>
      <main class="workspace">
        ${state.status ? `<div class="status ${state.error ? "error" : ""}">${esc(state.status)}</div>` : ""}
        <div id="view"></div>
        <footer class="copyright">mquiz (C) 2026 | minhnd7</footer>
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
    app.innerHTML = `<main class="login-screen">
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
    app.innerHTML = `<main class="login-screen"><form class="login-panel" id="recoveryForm">
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
    view.innerHTML = '<div class="panel">Đang tải...</div>';
    const [{ data: spaces, error }, { data: questions }] = await Promise.all([
      client.from("spaces").select("*").order("updated_at", { ascending: false }),
      client.from("questions").select("id,space_id,type")
    ]);
    if (error) return setStatus(error.message, true);
    const counts = new Map();
    (questions || []).forEach((question) => {
      const current = counts.get(question.space_id) || { total: 0, multi: 0 };
      current.total += 1;
      if (question.type === "multi") current.multi += 1;
      counts.set(question.space_id, current);
    });
    state.spaces = (spaces || []).map((space) => ({ ...space, counts: counts.get(space.id) || { total: 0, multi: 0 } }));
    const summary = {
      total: state.spaces.length,
      published: state.spaces.filter((space) => space.published).length,
      real: state.spaces.filter((space) => space.real_exam_enabled).length,
      empty: state.spaces.filter((space) => Number(space.counts.total || 0) === 0).length
    };
    view.innerHTML = `<header class="topbar">
      <div><h1>Quản lý Space</h1><p class="muted">Dữ liệu được lưu trực tiếp trên Supabase.</p></div>
      <button class="primary" id="addSpaceBtn">Thêm Space</button>
    </header>
    <section class="space-summary-grid" aria-label="Tổng quan Space">
      <article class="metric-card"><span>Tổng Space</span><b>${summary.total}</b><small>Đang quản trị</small></article>
      <article class="metric-card"><span>Online</span><b>${summary.published}</b><small>${summary.total - summary.published} Offline</small></article>
      <article class="metric-card"><span>Bật Thi thật</span><b>${summary.real}</b><small>Đợt thi đang cấu hình</small></article>
      <article class="metric-card ${summary.empty ? "attention" : ""}"><span>Chưa có câu hỏi</span><b>${summary.empty}</b><small>Cần bổ sung ngân hàng</small></article>
    </section>
    <section class="panel table-wrap spaces-table"><table>
      <thead><tr><th>Space</th><th>Câu hỏi</th><th>Thi thật</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${state.spaces.map((space) => `<tr>
        <td><b>${esc(space.name)}</b><br><span class="muted">/${esc(space.slug)}</span></td>
        <td><span class="table-number">${space.counts.total}</span><br><span class="muted">${space.counts.multi} câu nhiều đáp án</span></td>
        <td><span class="badge ${space.real_exam_enabled ? "on" : ""}">${space.real_exam_enabled ? "Đang bật Thi thật" : "Đang tắt"}</span>${space.real_exam_name ? `<br><span class="muted">${esc(space.real_exam_name)}</span>` : ""}</td>
        <td><span class="status-pill ${space.published ? "published" : "draft"}">${space.published ? "Online" : "Offline"}</span></td>
        <td class="settings-cell"><div class="space-row-actions">
          <button class="row-primary-action" data-space-settings="${space.id}" title="Cấu hình Space" aria-label="Cấu hình Space"><i data-lucide="settings"></i></button>
          <button class="icon-button" data-share-space="${space.id}" title="Chia sẻ Space" aria-label="Chia sẻ Space"><i data-lucide="share-2"></i></button>
          ${state.profile.role === "superadmin" ? `<button class="icon-button danger" data-delete-space="${space.id}" title="Xóa Space" aria-label="Xóa Space"><i data-lucide="trash-2"></i></button>` : ""}
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
    dialog.className = className;
    dialog.innerHTML = `<div class="dialog-body">${content}</div>`;
    dialog.showModal();
  }

  function closeDialog() {
    dialog.close();
    dialog.innerHTML = "";
    dialog.className = "";
  }

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

  function openSpaceSettings(spaceId, activeTab = "info") {
    const space = state.spaces.find((item) => item.id === spaceId);
    if (!space) return setStatus("Space không tồn tại.", true);
    const tabs = [
      ["info", "Sửa thông tin Space"],
      ["groups", "Quản lý nhóm trong Space"],
      ["questions", "Quản lý Ngân hàng câu hỏi"],
      ["real", "Quản lý Đợt thi thật"],
      ["results", "Quản lý kết quả"]
    ];
    openDialog(`<section class="space-settings">
      <aside class="space-settings-nav">
        <div>
          <span class="settings-eyebrow">Cấu hình Space</span>
          <h2>${esc(space.name)}</h2>
          <p class="muted">/${esc(space.slug)}</p>
        </div>
        <nav>${tabs.map(([key, label]) => `<button type="button" class="${key === activeTab ? "active" : ""}" data-settings-tab="${key}">${label}</button>`).join("")}</nav>
      </aside>
      <main class="space-settings-main" id="spaceSettingsPanel"></main>
    </section>`, "space-settings-dialog");
    bind("[data-settings-tab]", (button) => renderSpaceSettingsPanel(spaceId, button.dataset.settingsTab));
    window.lucide?.createIcons();
    renderSpaceSettingsPanel(spaceId, activeTab);
  }

  async function renderSpaceSettingsPanel(spaceId, tab) {
    const space = state.spaces.find((item) => item.id === spaceId);
    const panel = document.getElementById("spaceSettingsPanel");
    if (!space || !panel) return;
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.settingsTab === tab);
    });
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
      <label class="switch publish-switch"><input name="published" type="checkbox" ${space.published ? "checked" : ""}><span class="switch-track"></span><span data-publish-status>${space.published ? "Online" : "Offline"}</span></label>
      <div class="settings-save"><button class="primary">Lưu thay đổi</button><button type="button" data-close>Đóng</button></div>
    </form>`;
    bindPanelCloseButtons(panel);
    wirePublishStatusLabel(panel);
    document.getElementById("spaceSlugInput").oninput = (event) => {
      document.getElementById("spaceUrlPreview").textContent = new URL(
        encodeURIComponent(event.target.value || "slug"),
        quizBaseUrl
      ).href;
    };
    document.getElementById("spaceForm").onsubmit = (event) => saveSpace(event, id);
  }

  async function renderGroupSettings(panel, spaceId, space) {
    panel.innerHTML = '<div class="panel">Đang tải nhóm...</div>';
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
    const [{ data: sets, error: setError }, { data: questions, error: questionError }] = await Promise.all([
      client.from("question_sets").select("*").eq("space_id", spaceId).order("name"),
      client.from("questions").select("id,type,question_set_id").eq("space_id", spaceId)
    ]);
    if (setError) throw setError;
    if (questionError) throw questionError;
    const counts = new Map();
    (questions || []).forEach((question) => {
      const key = question.question_set_id || 0;
      const current = counts.get(key) || { total: 0, multi: 0 };
      current.total += 1;
      if (question.type === "multi") current.multi += 1;
      counts.set(key, current);
    });
    return (sets || []).map((set) => ({ ...set, counts: counts.get(set.id) || { total: 0, multi: 0 } }));
  }

  function questionSetOptions(sets, selectedId) {
    return sets.map((set) => `<option value="${set.id}" ${Number(selectedId) === Number(set.id) ? "selected" : ""}>${esc(set.name)} (${set.counts.total} câu)</option>`).join("");
  }

  async function renderQuestionSettings(panel, spaceId, space, selectedSetId = null) {
    panel.innerHTML = '<div class="panel">Đang tải Bộ câu hỏi...</div>';
    let sets;
    try {
      sets = await loadQuestionSets(spaceId);
    } catch (error) {
      return showDialogError(error.message || "Không tải được Bộ câu hỏi.");
    }
    const activeSet = sets.find((set) => Number(set.id) === Number(selectedSetId)) || sets[0] || null;
    panel.innerHTML = `<section class="grid settings-pane">
      <h2>Quản lý Ngân hàng câu hỏi</h2>
      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h3>Quản lý danh mục Bộ câu hỏi</h3>
            <p class="muted">${sets.length} bộ câu hỏi trong Space này.</p>
          </div>
          <form id="addQuestionSetForm" class="inline-create-form">
            <input name="name" placeholder="Tên Bộ câu hỏi mới" required>
            <button class="primary">Thêm</button>
          </form>
        </div>
        <div class="question-set-list">${sets.map((set) => `<div class="question-set-item ${activeSet?.id === set.id ? "active" : ""}">
          <button type="button" class="question-set-main" data-select-question-set="${set.id}">
            <b>${esc(set.name)}</b>
            <span>${set.counts.total} câu · ${set.counts.multi} câu nhiều đáp án</span>
          </button>
          <div class="group-card-actions">
            <button type="button" class="link-button" data-rename-question-set="${set.id}">Sửa</button>
            <button type="button" class="link-button danger" data-delete-question-set="${set.id}">Xóa</button>
          </div>
        </div>`).join("") || '<p class="muted">Chưa có Bộ câu hỏi.</p>'}</div>
      </section>
      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h3>Quản lý Ngân hàng câu hỏi</h3>
            <p class="muted">${Number(space.counts?.total || 0)} câu hỏi · ${Number(space.counts?.multi || 0)} câu nhiều đáp án</p>
          </div>
          <button type="button" id="exportQuestionsBtn" ${activeSet ? "" : "disabled"}>Tải về ngân hàng câu hỏi</button>
        </div>
        <label>Bộ câu hỏi<select id="questionSetSelect" ${activeSet ? "" : "disabled"}>${questionSetOptions(sets, activeSet?.id)}</select></label>
      </section>
      <section class="settings-section">
        <h3>Upload câu hỏi</h3>
        <input id="csvFile" type="file" accept=".csv,text/csv" ${activeSet ? "" : "disabled"}>
        <div id="csvPreview" class="muted"></div>
        <div class="actions">
          <button type="button" id="previewCsvBtn" ${activeSet ? "" : "disabled"}>Preview</button>
        </div>
      </section>
      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h3>Xóa ngân hàng câu hỏi</h3>
            <p class="muted">Xóa toàn bộ câu hỏi hiện có trong Space này.</p>
          </div>
          <button type="button" class="danger" id="deleteQuestionsBtn" ${activeSet ? "" : "disabled"}>Xóa toàn bộ câu hỏi</button>
        </div>
      </section>
      <div class="settings-save"><button type="button" class="primary" id="importCsvBtn" disabled>Lưu câu hỏi</button><button type="button" data-close>Đóng</button></div>
    </section>`;
    let parsedQuestions = [];
    document.getElementById("addQuestionSetForm").onsubmit = async (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name").trim();
      const { data, error } = await client.from("question_sets").insert({ space_id: spaceId, name }).select("id").single();
      if (error) return showDialogError(error.message);
      await renderQuestionSettings(panel, spaceId, space, data.id);
    };
    bind("[data-select-question-set]", (button) => renderQuestionSettings(panel, spaceId, space, Number(button.dataset.selectQuestionSet)));
    bind("[data-rename-question-set]", async (button) => {
      const set = sets.find((item) => item.id === Number(button.dataset.renameQuestionSet));
      const name = prompt("Tên Bộ câu hỏi mới", set?.name || "")?.trim();
      if (!name || !set) return;
      const { error } = await client.from("question_sets").update({ name }).eq("id", set.id);
      if (error) return showDialogError(error.message);
      await renderQuestionSettings(panel, spaceId, space, set.id);
    });
    bind("[data-delete-question-set]", async (button) => {
      if (sets.length <= 1) return showDialogError("Space phải có ít nhất 1 Bộ câu hỏi.");
      const set = sets.find((item) => item.id === Number(button.dataset.deleteQuestionSet));
      if (!set || !confirm("Xóa Bộ câu hỏi này? Câu hỏi thuộc bộ này sẽ không còn phân loại.")) return;
      const { error } = await client.from("question_sets").delete().eq("id", set.id);
      if (error) return showDialogError(error.message);
      await renderQuestionSettings(panel, spaceId, space);
    });
    const select = document.getElementById("questionSetSelect");
    if (select) select.onchange = () => renderQuestionSettings(panel, spaceId, space, Number(select.value));
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
    document.getElementById("importCsvBtn").onclick = (event) => importQuestions(spaceId, parsedQuestions, activeSet?.id, event.currentTarget);
    document.getElementById("exportQuestionsBtn").onclick = () => exportQuestions(spaceId, space.slug, activeSet?.id);
    document.getElementById("deleteQuestionsBtn").onclick = (event) => deleteAllQuestions(spaceId, activeSet?.id, event.currentTarget);
    bindPanelCloseButtons(panel);
  }

  async function renderRealExamSettings(panel, id, space) {
    panel.innerHTML = '<div class="panel">Đang tải cấu hình Đợt thi thật...</div>';
    let sets;
    try {
      sets = await loadQuestionSets(id);
    } catch (error) {
      return showDialogError(error.message || "Không tải được Bộ câu hỏi.");
    }
    const savedConfig = Array.isArray(space.real_question_sets) ? space.real_question_sets : [];
    const selectedConfig = normalizeRealSetConfig(sets, savedConfig);
    panel.innerHTML = `<form id="realForm" class="grid compact-dialog-form real-exam-form settings-pane">
      <h2>Quản lý Đợt thi thật</h2>
      <section class="settings-section">
        <div class="real-exam-header">
          <div>
            <h3>Thông tin đợt thi</h3>
            <p class="muted">Tên và trạng thái mở Thi thật cho Space này.</p>
          </div>
          <label class="switch"><input name="enabled" type="checkbox" ${space.real_exam_enabled ? "checked" : ""}><span class="switch-track"></span><span>Bật Thi thật</span></label>
        </div>
        <label class="inline-required-field"><span>Tên của đợt thi thật <b aria-hidden="true">*</b></span><input name="real_exam_name" value="${esc(space.real_exam_name || "")}" placeholder="Ví dụ: Thi thật tháng 07/2026" required></label>
      </section>
      <section class="settings-section real-set-section">
        <div>
          <h3>Nguồn câu hỏi</h3>
          <p class="muted">Chọn một hoặc nhiều Bộ câu hỏi và tỷ lệ lấy câu cho bài Thi thật.</p>
        </div>
        <div class="real-set-list">${sets.map((set) => {
          const config = selectedConfig.find((item) => Number(item.id) === Number(set.id));
          const selected = Boolean(config);
          return `<div class="real-set-item">
            <div class="real-set-identity">
              <label class="switch real-set-toggle" title="Chọn Bộ câu hỏi ${esc(set.name)}"><input type="checkbox" data-real-set-check="${set.id}" aria-label="Chọn Bộ câu hỏi ${esc(set.name)}" ${selected ? "checked" : ""}><span class="switch-track"></span></label>
              <div class="real-set-copy"><strong>${esc(set.name)}</strong><span class="real-set-stats">${set.counts.total} câu · ${set.counts.multi} câu nhiều đáp án</span></div>
            </div>
            <label class="real-set-percent">Tỷ lệ câu (%)<input type="number" min="0" max="100" step="1" data-real-set-percent="${set.id}" value="${Number(config?.percent || 0)}" ${selected ? "" : "disabled"}></label>
          </div>`;
        }).join("") || '<p class="muted">Chưa có Bộ câu hỏi.</p>'}</div>
        <p class="muted" id="realSetTotalHint"></p>
      </section>
      <section class="settings-section">
        <div>
          <h3>Quy tắc tạo đề</h3>
          <p class="muted">Các tỷ lệ được tính trên những Bộ câu hỏi đã chọn ở vùng nguồn câu hỏi.</p>
        </div>
        <div class="grid two real-exam-row">
          ${selectField("question_percent", "Số lượng câu hỏi", [30,50,70,100], space.real_question_percent, "%")}
          ${selectField("timer_seconds", "Thời gian mỗi câu", [45,60,90,120], space.real_timer_seconds, "s")}
        </div>
        <div class="grid two real-exam-row">
          ${selectField("multi_percent", "Tỷ lệ câu nhiều đáp án", [30,50,70,100], space.real_multi_percent, "%")}
          ${selectField("max_attempts", "Số lần thi tối đa", [1,2,3,4,5], space.real_max_attempts, "")}
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
      </section>
      <section class="settings-section">
        <div>
          <h3>Thời gian thi</h3>
          <p class="muted">Ngày dùng calendar picker, giờ theo định dạng 24h và bước 15 phút.</p>
        </div>
        <div class="grid two real-exam-row">
          <label>Ngày bắt đầu<input name="start_date" type="date" value="${toLocalDateInput(space.real_start_at)}"></label>
          <label>Giờ bắt đầu<select name="start_time">${timeOptions(toLocalTimeText(space.real_start_at))}</select></label>
          <label>Ngày kết thúc<input name="end_date" type="date" value="${toLocalDateInput(space.real_end_at)}"></label>
          <label>Giờ kết thúc<select name="end_time">${timeOptions(toLocalTimeText(space.real_end_at))}</select></label>
        </div>
      </section>
      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h3>Kết quả đợt thi thật gần nhất</h3>
            <p class="muted">15 kết quả cao nhất của học viên.</p>
          </div>
          <div class="section-actions">
            <button type="button" id="exportRealExamBtn">Tải Dữ liệu đợt thi thật</button>
            <button type="button" class="primary" id="viewRealExamResultsBtn">Xem Kết quả thi thật</button>
          </div>
        </div>
        <div id="realExamTopResults" class="real-results-list muted">Bấm “Xem Kết quả thi thật” để tải dữ liệu.</div>
      </section>
      <div class="settings-save"><button class="primary">Lưu thay đổi</button><button type="button" data-close>Đóng</button></div>
    </form>`;
    wireRealExamForm(id);
    document.getElementById("exportRealExamBtn").onclick = () => exportRealExamResults(id);
    document.getElementById("viewRealExamResultsBtn").onclick = () => loadLatestRealExamResults(id);
    bindPanelCloseButtons(panel);
    wireRealSetControls();
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
    panel.innerHTML = '<div class="panel">Đang tải cấu hình kết quả...</div>';
    let periods = [];
    try {
      const { data, error } = await client.rpc("list_real_exam_periods", {
        requested_slug: space.slug
      });
      if (error) throw error;
      periods = data || [];
    } catch (error) {
      return showDialogError(error.message || "Không tải được danh sách đợt thi thật.");
    }
    panel.innerHTML = `<section class="grid settings-pane">
      <h2>Quản lý kết quả</h2>
      <form id="resultRetentionForm" class="settings-section">
        <div>
          <h3>Giới hạn lưu kết quả</h3>
          <p class="muted">Hệ thống tự dọn dữ liệu cũ khi có kết quả mới và khi bạn lưu cấu hình này.</p>
        </div>
        <div class="grid two">
          <label>Giữ kết quả thi thử trong số ngày
            <input name="mock_result_retention_days" type="number" min="3" max="15" step="1" value="${Number(space.mock_result_retention_days || 7)}" required>
          </label>
          <label>Giữ kết quả thi thật trong số đợt
            <input name="real_result_retention_exams" type="number" min="3" max="15" step="1" value="${Number(space.real_result_retention_exams || 7)}" required>
          </label>
        </div>
        <div class="retention-rules">
          <span>Thi thử: tối đa 500 bản ghi/Space.</span>
          <span>Thi thật: tối đa 1000 bản ghi/Space.</span>
        </div>
        <div id="resultCleanupStatus" class="muted"></div>
        <div class="settings-save"><button class="primary">Lưu thay đổi</button><button type="button" data-close>Đóng</button></div>
      </form>
      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h3>Quản lý dữ liệu thi thật</h3>
            <p class="muted">Chọn Tên đợt thi thật để xem 30 kết quả cao nhất hoặc tải Excel của đợt đó.</p>
          </div>
        </div>
        <div class="result-period-controls">
          <label>Tên đợt thi thật<select id="resultExamPeriodSelect" ${periods.length ? "" : "disabled"}>${resultPeriodOptions(periods)}</select></label>
          <button type="button" id="viewResultPeriodBtn" ${periods.length ? "" : "disabled"}>Xem dữ liệu</button>
          <button type="button" class="primary" id="exportResultPeriodBtn" ${periods.length ? "" : "disabled"}>Tải về dữ liệu</button>
        </div>
        <div id="resultPeriodPreview" class="real-results-list muted">${periods.length ? "Chọn đợt thi thật rồi bấm “Xem dữ liệu”." : "Chưa có dữ liệu Thi thật."}</div>
      </section>
    </section>`;
    document.getElementById("resultRetentionForm").onsubmit = (event) => saveResultSettings(event, spaceId);
    document.getElementById("viewResultPeriodBtn").onclick = (event) => loadSelectedRealExamRows(space, event.currentTarget);
    document.getElementById("exportResultPeriodBtn").onclick = (event) => exportSelectedRealExamRows(space, event.currentTarget);
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
      real_result_retention_exams: Number(form.get("real_result_retention_exams")),
      updated_at: new Date().toISOString()
    };
    if (payload.mock_result_retention_days < 3 || payload.mock_result_retention_days > 15) return showDialogError("Số ngày lưu kết quả thi thử phải từ 3 đến 15.");
    if (payload.real_result_retention_exams < 3 || payload.real_result_retention_exams > 15) return showDialogError("Số đợt lưu kết quả thi thật phải từ 3 đến 15.");
    const restoreButton = setButtonBusy(event.submitter, "Đang lưu...");
    try {
      const { error } = await client.from("spaces").update(payload).eq("id", spaceId);
      if (error) return showDialogError(error.message);
      const { data, error: cleanupError } = await client.rpc("cleanup_space_results", { target_space_id: spaceId });
      if (cleanupError) return showDialogError(cleanupError.message);
      const status = document.getElementById("resultCleanupStatus");
      if (status) {
        status.textContent = `Đã lưu và dọn ${Number(data?.mock_deleted_by_days || 0) + Number(data?.mock_deleted_by_cap || 0)} kết quả thi thử, ${Number(data?.real_deleted_by_exam_limit || 0) + Number(data?.real_deleted_by_cap || 0)} kết quả thi thật.`;
      }
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
        "Số lần rời màn hình": Number(row.focus_violation_count || 0),
        "Thời gian làm bài": formatExportDuration(row.duration_seconds),
        "Bắt đầu làm bài": formatExportDateTime(row.started_at),
        "Nộp bài": formatExportDateTime(row.submitted_at)
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      worksheet["!cols"] = [
        { wch: 24 }, { wch: 34 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 22 }
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
      <thead><tr><th>#</th><th>Học viên</th><th>Group</th><th>Điểm</th><th>Đúng</th><th>Rời màn hình</th><th>Thời gian</th><th>Nộp bài</th></tr></thead>
      <tbody>${rows.map((row, index) => `<tr>
        <td>${index + 1}</td>
        <td><b>${esc(row.student_name || "")}</b></td>
        <td>${esc(row.group_name || "Chưa phân nhóm")}</td>
        <td>${Number(row.score).toFixed(2)}</td>
        <td>${Number(row.correct_count || 0)}/${Number(row.total_questions || 0)}</td>
        <td class="${Number(row.focus_violation_count || 0) > 0 ? "violation-count" : ""}">${Number(row.focus_violation_count || 0)}</td>
        <td>${formatExportDuration(row.duration_seconds)}</td>
        <td>${formatExportDateTime(row.submitted_at)}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  function wireRealSetControls() {
    const sync = (changedId = null) => {
      const checked = [...document.querySelectorAll("[data-real-set-check]:checked")].map((input) => ({
        id: Number(input.dataset.realSetCheck),
        percent: Number(document.querySelector(`[data-real-set-percent="${input.dataset.realSetCheck}"]`)?.value || 0)
      }));
      const normalized = normalizePercentConfig(checked, changedId);
      document.querySelectorAll("[data-real-set-percent]").forEach((input) => {
        const item = normalized.find((config) => Number(config.id) === Number(input.dataset.realSetPercent));
        input.disabled = !item;
        if (item) input.value = String(item.percent);
        else input.value = "0";
      });
      const total = normalized.reduce((sum, item) => sum + item.percent, 0);
      const hint = document.getElementById("realSetTotalHint");
      if (hint) hint.textContent = normalized.length ? `Tổng tỷ lệ đang chọn: ${total}%` : "Chọn ít nhất một Bộ câu hỏi khi bật Thi thật.";
    };
    document.querySelectorAll("[data-real-set-check]").forEach((input) => {
      input.onchange = () => sync();
    });
    document.querySelectorAll("[data-real-set-percent]").forEach((input) => {
      input.oninput = () => sync(Number(input.dataset.realSetPercent));
    });
    sync();
  }

  function bindPanelCloseButtons(panel) {
    panel.querySelectorAll("[data-close]").forEach((button) => {
      button.onclick = closeDialog;
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
        <thead><tr><th>#</th><th>Học viên</th><th>Group</th><th>Điểm</th><th>Đúng</th><th>Rời màn hình</th><th>Thời gian</th><th>Nộp bài</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr>
          <td>${index + 1}</td>
          <td><b>${esc(row.student_name || "")}</b></td>
          <td>${esc(row.group_name || "Chưa phân nhóm")}</td>
          <td>${Number(row.score).toFixed(2)}</td>
          <td>${Number(row.correct_count || 0)}/${Number(row.total_questions || 0)}</td>
          <td class="${Number(row.focus_violation_count || 0) > 0 ? "violation-count" : ""}">${Number(row.focus_violation_count || 0)}</td>
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
      <label class="switch publish-switch"><input name="published" type="checkbox" ${space.published ? "checked" : ""}><span class="switch-track"></span><span data-publish-status>${space.published ? "Online" : "Offline"}</span></label>
      <div class="actions"><button class="primary">Lưu</button><button type="button" data-close>Hủy</button></div>
    </form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    wirePublishStatusLabel(dialog);
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

  /**
   * @param {HTMLElement} container
   * @returns {void}
   */
  function wirePublishStatusLabel(container) {
    const input = container.querySelector('[name="published"]');
    const label = container.querySelector("[data-publish-status]");
    if (!input || !label) return;
    const sync = () => { label.textContent = input.checked ? "Online" : "Offline"; };
    input.onchange = sync;
    sync();
  }

  /**
   * Opens the destructive confirmation flow for a Space.
   *
   * @param {number} id
   * @returns {void}
   */
  function deleteSpace(id) {
    if (state.profile?.role !== "superadmin") return setStatus("Chỉ superadmin được xóa Space.", true);
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return setStatus("Space không tồn tại.", true);
    openDialog(`<form id="deleteSpaceForm" class="grid destructive-confirmation" aria-labelledby="deleteSpaceTitle">
      <div>
        <span class="destructive-eyebrow">Thao tác không thể hoàn tác</span>
        <h2 id="deleteSpaceTitle">Xóa Space “${esc(space.name)}”</h2>
        <p>Toàn bộ dữ liệu thi thử, thi thật, Group, Bộ câu hỏi và ngân hàng câu hỏi của Space này sẽ bị xóa.</p>
      </div>
      <div class="delete-space-identity"><span>Slug cần xác nhận</span><code>${esc(space.slug)}</code></div>
      <label>Nhập chính xác slug để xác nhận<input id="deleteSpaceSlug" name="slug" autocomplete="off" spellcheck="false" required></label>
      <div class="actions"><button type="button" data-close>Hủy</button><button class="danger" id="confirmDeleteSpaceBtn" disabled>Xóa vĩnh viễn</button></div>
    </form>`, "destructive-dialog");
    const form = document.getElementById("deleteSpaceForm");
    const slugInput = document.getElementById("deleteSpaceSlug");
    const deleteButton = document.getElementById("confirmDeleteSpaceBtn");
    document.querySelector("[data-close]").onclick = closeDialog;
    slugInput.oninput = () => { deleteButton.disabled = slugInput.value !== space.slug; };
    form.onsubmit = (event) => confirmDeleteSpace(event, space);
    slugInput.focus();
  }

  /**
   * @param {SubmitEvent} event
   * @param {{ id: number, name: string, slug: string }} space
   * @returns {Promise<void>}
   */
  async function confirmDeleteSpace(event, space) {
    event.preventDefault();
    const form = new FormData(event.target);
    const confirmedSlug = String(form.get("slug") || "");
    if (confirmedSlug !== space.slug) return showDialogError("Slug xác nhận không khớp.");
    const restoreButton = setButtonBusy(event.submitter, "Đang xóa...");
    try {
      const { data, error } = await client.rpc("delete_space_cascade", {
        requested_space_id: space.id,
        requested_slug: confirmedSlug
      });
      if (error) return showDialogError(error.message);
      closeDialog();
      setStatus(`Đã xóa Space “${space.name}” và ${Number(data?.quiz_attempts_deleted || 0)} kết quả thi liên quan.`);
      await renderSpaces();
    } finally {
      restoreButton();
    }
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
        "Số lần rời màn hình": Number(row.focus_violation_count || 0),
        "Thời gian làm bài": formatExportDuration(row.duration_seconds),
        "Bắt đầu làm bài": formatExportDateTime(row.started_at),
        "Nộp bài": formatExportDateTime(row.submitted_at)
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      worksheet["!cols"] = [
        { wch: 24 }, { wch: 42 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 22 }
      ];
      const examFillColors = {
        1: "FFFF00",
        2: "FFC0CB",
        3: "D9D9D9"
      };
      rows.forEach((row, index) => {
        const fillColor = examFillColors[Number(row.exam_rank)];
        if (!fillColor) return;
        for (let column = 0; column < 11; column += 1) {
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

  async function exportQuestions(spaceId, spaceSlug, questionSetId = null) {
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
      setStatus(`Đã tải ${data.length} câu hỏi.`);
    } catch (error) {
      showDialogError(error.message || "Không thể tải ngân hàng câu hỏi.");
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

  async function importQuestions(spaceId, questions, questionSetId = null, button = null) {
    if (!questions.length) return;
    const restoreButton = setButtonBusy(button, "Đang lưu...");
    try {
      const { data: current } = await client.from("questions").select("order_no").eq("space_id", spaceId).order("order_no", { ascending: false }).limit(1);
      const maxOrder = current?.[0]?.order_no || 0;
      const rows = questions.map((question, index) => ({ ...question, space_id: spaceId, question_set_id: questionSetId, order_no: maxOrder + index + 1 }));
      const { error } = await client.from("questions").insert(rows);
      if (error) return showDialogError(error.message);
      closeDialog();
      setStatus(`Đã thêm ${rows.length} câu hỏi.`);
      await renderSpaces();
    } finally {
      restoreButton();
    }
  }

  async function deleteAllQuestions(spaceId, questionSetId = null, button = null) {
    if (!confirm("Xóa toàn bộ câu hỏi của Bộ câu hỏi đang chọn? Thao tác không thể hoàn tác.")) return;
    const restoreButton = setButtonBusy(button, "Đang xóa...");
    try {
      let query = client.from("questions").delete().eq("space_id", spaceId);
      if (questionSetId) query = query.eq("question_set_id", questionSetId);
      const { error } = await query;
      if (error) return showDialogError(error.message);
      closeDialog();
      setStatus("Đã xóa toàn bộ câu hỏi.");
      await renderSpaces();
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
      ? `<b>Cách tính điểm 2</b><span>95 điểm theo tỷ lệ câu đúng tuyệt đối; câu nhiều đáp án phải đúng toàn bộ. 5 điểm theo tốc độ. Không tính quy mô đề hoặc đúng giờ.</span>`
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

  function readRealQuestionSetConfig() {
    if (!document.querySelector("[data-real-set-check]")) return null;
    const rows = [...document.querySelectorAll("[data-real-set-check]:checked")].map((input) => ({
      id: Number(input.dataset.realSetCheck),
      percent: Number(document.querySelector(`[data-real-set-percent="${input.dataset.realSetCheck}"]`)?.value || 0)
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
      <tbody>${data.map((user) => `<tr><td>${esc(user.email)}</td><td>${esc(user.fullname)}</td><td>${esc(user.role)}</td><td>${user.active ? "Có" : "Không"}</td><td><div class="actions"><button data-edit-user="${user.id}">Sửa</button><button class="danger" data-delete-user="${user.id}">Xóa</button></div></td></tr>`).join("")}</tbody></table></section>`;
    document.getElementById("addUserBtn").onclick = () => openUser();
    bind("[data-edit-user]", (button) => openUser(data.find((user) => user.id === button.dataset.editUser)));
    bind("[data-delete-user]", async (button) => {
      if (!confirm("Xóa tài khoản Admin này?")) return;
      const { error: invokeError } = await client.functions.invoke("admin-users", {
        body: { action: "delete", id: button.dataset.deleteUser }
      });
      if (invokeError) return setStatus(invokeError.message, true);
      await renderUsers();
    });
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
        <div class="panel grid"><h2>Tạo backup</h2><p class="muted">Xuất toàn bộ hồ sơ quản trị, Space, phân quyền, Group, Bộ câu hỏi, ngân hàng câu hỏi và kết quả thi thành JSON. Mật khẩu đăng nhập do Supabase Auth quản lý và không được xuất.</p><button class="primary" id="backupBtn">Tải backup</button></div>
        <div class="panel grid"><h2>Restore</h2><p class="muted">Dữ liệu trong file sẽ thay thế toàn bộ dữ liệu ứng dụng hiện tại. Một bản backup an toàn sẽ được tải xuống trước khi restore.</p><input id="restoreFile" type="file" accept=".json,application/json"><button class="danger" id="restoreBtn">Thay thế toàn bộ dữ liệu</button></div>
      </section>`;
    document.getElementById("backupBtn").onclick = createBackup;
    document.getElementById("restoreBtn").onclick = restoreBackup;
  }

  function renderPassword() {
    const view = document.getElementById("view");
    view.innerHTML = `<header class="topbar"><div><h1>Đổi mật khẩu</h1></div></header>
      <form class="panel grid" id="passwordForm" style="max-width:520px">
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
    if (!confirm("Restore sẽ thay thế toàn bộ dữ liệu ứng dụng hiện tại. Tiếp tục?")) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      return setStatus("File backup không phải JSON hợp lệ.", true);
    }
    if (!isValidBackupPayload(payload)) return setStatus("File backup thiếu dữ liệu bắt buộc hoặc sai phiên bản schema.", true);
    const { data: safetyBackup, error: backupError } = await client.rpc("backup_app_data");
    if (backupError) return setStatus(`Không tạo được backup an toàn: ${backupError.message}`, true);
    downloadBackup(safetyBackup, "vn-quiz-before-restore");
    const { data, error } = await client.rpc("restore_app_data", {
      payload,
      replace_existing: true
    });
    setStatus(error ? error.message : `Restore thành công: ${JSON.stringify(data)}`, Boolean(error));
  }

  /**
   * @param {unknown} payload
   * @returns {boolean}
   */
  function isValidBackupPayload(payload) {
    const requiredCollections = ["profiles", "spaces", "space_admins", "groups", "question_sets", "questions", "quiz_attempts"];
    return payload !== null
      && typeof payload === "object"
      && Number(payload.schema_version) === 1
      && requiredCollections.every((key) => Array.isArray(payload[key]));
  }

  function showDialogError(message) {
    let error = dialog.querySelector(".status.error");
    if (!error) {
      error = document.createElement("div");
      error.className = "status error";
      dialog.querySelector(".dialog-body").prepend(error);
    }
    error.textContent = message;
  }

  boot();
  startAppVersionMonitoring();
})();
