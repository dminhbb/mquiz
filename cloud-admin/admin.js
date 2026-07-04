(function () {
  const app = document.getElementById("adminApp");
  const dialog = document.getElementById("adminDialog");
  const adminBaseUrl = new URL("./", location.href);
  const quizBaseUrl = new URL("../", adminBaseUrl);
  const config = window.__SQ_SUPABASE__ || {};
  const client = window.supabase?.createClient(config.url, config.anonKey);
  const state = {
    session: null,
    profile: null,
    view: "spaces",
    spaces: [],
    passwordRecovery: false,
    status: "",
    error: false
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  function setStatus(message, error = false) {
    state.status = message;
    state.error = error;
    render();
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
        <div><div class="brand">vn.Quiz</div><div>Cloud Admin</div></div>
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
        <footer class="copyright">vn.Quiz (C) 2026 | minhnd7</footer>
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
        <div><div class="brand">vn.Quiz</div><p class="muted">Đăng nhập quản trị cloud</p></div>
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
      <div><div class="brand">vn.Quiz</div><p class="muted">Đặt mật khẩu mới</p></div>
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
    view.innerHTML = `<header class="topbar">
      <div><h1>Quản lý Space</h1><p class="muted">Dữ liệu được lưu trực tiếp trên Supabase.</p></div>
      <button class="primary" id="addSpaceBtn">Thêm Space</button>
    </header>
    <section class="panel table-wrap spaces-table"><table>
      <thead><tr><th>Space</th><th>Câu hỏi</th><th>Thi thật</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${state.spaces.map((space) => `<tr>
        <td><b>${esc(space.name)}</b><br><span class="muted">/${esc(space.slug)}</span></td>
        <td>${space.counts.total}<br><span class="muted">${space.counts.multi} câu nhiều đáp án</span></td>
        <td><span class="badge ${space.real_exam_enabled ? "on" : ""}">${space.real_exam_enabled ? "Đang bật" : "Đang tắt"}</span></td>
        <td>${space.published ? "Published" : "Draft"}</td>
        <td class="settings-cell"><div class="space-row-actions">
          <button class="icon-button" data-share-space="${space.id}" title="Chia sẻ Space" aria-label="Chia sẻ Space"><i data-lucide="share-2"></i></button>
          <details class="settings-menu">
          <summary title="Cài đặt Space" aria-label="Cài đặt Space"><i data-lucide="settings"></i></summary>
          <div class="settings-popover">
            <button data-edit-space="${space.id}">Sửa thông tin space</button>
            <button data-groups="${space.id}">Quản lý nhóm trong Space</button>
            <button data-questions="${space.id}">Quản lý ngân hàng câu hỏi</button>
            <button data-real="${space.id}">Chế độ thi thật</button>
            <button data-export-real="${space.id}">Tải Excel dữ liệu Thi thật</button>
            <button class="danger menu-delete" data-delete-space="${space.id}">Xóa space</button>
          </div>
          </details>
        </div></td>
      </tr>`).join("")}</tbody>
    </table></section>`;
    document.getElementById("addSpaceBtn").onclick = () => openSpace();
    bind("[data-share-space]", (button) => openShare(Number(button.dataset.shareSpace)));
    bind("[data-edit-space]", (button) => openSpace(Number(button.dataset.editSpace)));
    bind("[data-groups]", (button) => openGroups(Number(button.dataset.groups)));
    bind("[data-questions]", (button) => openQuestions(Number(button.dataset.questions)));
    bind("[data-real]", (button) => openRealExam(Number(button.dataset.real)));
    bind("[data-export-real]", (button) => exportRealExamResults(Number(button.dataset.exportReal)));
    bind("[data-delete-space]", (button) => deleteSpace(Number(button.dataset.deleteSpace)));
    window.lucide?.createIcons();
    document.querySelectorAll(".settings-menu").forEach((menu) => {
      menu.ontoggle = () => {
        if (!menu.open) return;
        document.querySelectorAll(".settings-menu[open]").forEach((other) => {
          if (other !== menu) other.removeAttribute("open");
        });
        const trigger = menu.querySelector("summary");
        const popover = menu.querySelector(".settings-popover");
        const triggerBox = trigger.getBoundingClientRect();
        const menuHeight = popover.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, triggerBox.right - popover.offsetWidth));
        const hasRoomBelow = window.innerHeight - triggerBox.bottom >= menuHeight + 8;
        popover.style.left = `${left}px`;
        popover.style.top = `${hasRoomBelow ? triggerBox.bottom + 6 : Math.max(8, triggerBox.top - menuHeight - 6)}px`;
      };
    });
    document.onclick = (event) => {
      if (event.target.closest(".settings-menu")) return;
      document.querySelectorAll(".settings-menu[open]").forEach((menu) => menu.removeAttribute("open"));
    };
  }

  function bind(selector, handler) {
    document.querySelectorAll(selector).forEach((element) => {
      element.onclick = () => handler(element);
    });
  }

  function openDialog(content) {
    dialog.innerHTML = `<div class="dialog-body">${content}</div>`;
    dialog.showModal();
  }

  function closeDialog() {
    dialog.close();
    dialog.innerHTML = "";
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
      <label class="switch publish-switch"><input name="published" type="checkbox" ${space.published ? "checked" : ""}><span class="switch-track"></span><span>Published</span></label>
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
    const form = new FormData(event.target);
    const payload = {
      name: form.get("name").trim(),
      slug: form.get("slug").trim().toLowerCase(),
      timer_seconds: Number(form.get("timer_seconds")),
      published: form.has("published"),
      updated_at: new Date().toISOString()
    };
    let result;
    if (id) result = await client.from("spaces").update(payload).eq("id", id);
    else result = await client.from("spaces").insert(payload).select("id").single();
    if (result.error) return showDialogError(result.error.message);
    if (!id) {
      const { error } = await client.from("groups").insert({ space_id: result.data.id, name: payload.name });
      if (error) return showDialogError(error.message);
    }
    closeDialog();
    await renderSpaces();
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

    const button = document.querySelector(`[data-export-real="${id}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tạo Excel...";
    }
    document.querySelectorAll(".settings-menu[open]").forEach((menu) => menu.removeAttribute("open"));

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
      rows.forEach((row, index) => {
        const segment = `${row.group_name || ""}::${row.exam_rank}`;
        const previous = index > 0 ? `${rows[index - 1].group_name || ""}::${rows[index - 1].exam_rank}` : "";
        if (index > 0 && segment === previous) return;
        for (let column = 0; column < 10; column += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
          if (cell) {
            cell.s = {
              fill: { patternType: "solid", fgColor: { rgb: "FFFF00" } },
              font: { bold: true }
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
        button.textContent = "Tải Excel dữ liệu Thi thật";
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
    document.getElementById("deleteQuestionsBtn").onclick = () => deleteAllQuestions(spaceId);
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

  async function importQuestions(spaceId, questions) {
    if (!questions.length) return;
    const { data: current } = await client.from("questions").select("order_no").eq("space_id", spaceId).order("order_no", { ascending: false }).limit(1);
    const maxOrder = current?.[0]?.order_no || 0;
    const rows = questions.map((question, index) => ({ ...question, space_id: spaceId, order_no: maxOrder + index + 1 }));
    const { error } = await client.from("questions").insert(rows);
    if (error) return showDialogError(error.message);
    closeDialog();
    setStatus(`Đã thêm ${rows.length} câu hỏi.`);
    await renderSpaces();
  }

  async function deleteAllQuestions(spaceId) {
    if (!confirm("Xóa toàn bộ câu hỏi của Space? Thao tác không thể hoàn tác.")) return;
    const { error } = await client.from("questions").delete().eq("space_id", spaceId);
    if (error) return showDialogError(error.message);
    closeDialog();
    setStatus("Đã xóa toàn bộ câu hỏi.");
    await renderSpaces();
  }

  function openRealExam(id) {
    const space = state.spaces.find((item) => item.id === id);
    openDialog(`<form id="realForm" class="grid compact-dialog-form"><h2>Chế độ Thi thật</h2>
      <label class="switch"><input name="enabled" type="checkbox" ${space.real_exam_enabled ? "checked" : ""}><span class="switch-track"></span><span>Bật Thi thật</span></label>
      <div class="grid two">
        ${selectField("question_percent", "Số lượng câu hỏi", [30,50,70,100], space.real_question_percent, "%")}
        ${selectField("timer_seconds", "Thời gian mỗi câu", [45,60,90,120], space.real_timer_seconds, "s")}
        ${selectField("multi_percent", "Tỷ lệ câu nhiều đáp án", [30,50,70,100], space.real_multi_percent, "%")}
        ${selectField("max_attempts", "Số lần thi tối đa", [1,2,3,4,5], space.real_max_attempts, "")}
        <label>Ngày giờ bắt đầu<input name="start_at" type="datetime-local" value="${toLocalInput(space.real_start_at)}"></label>
        <label>Ngày giờ kết thúc<input name="end_at" type="datetime-local" value="${toLocalInput(space.real_end_at)}"></label>
      </div>
      <p class="muted">${Math.min(space.counts.multi, Math.round((space.counts.multi * space.real_multi_percent / 100) / 2) * 2)} / ${space.counts.multi} câu nhiều đáp án</p>
      <div class="actions"><button class="primary">Lưu</button><button type="button" data-close>Hủy</button></div>
    </form>`);
    document.querySelector("[data-close]").onclick = closeDialog;
    document.getElementById("realForm").onsubmit = (event) => saveRealExam(event, id);
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

  async function saveRealExam(event, id) {
    event.preventDefault();
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return showDialogError("Space không tồn tại.");
    const form = new FormData(event.target);
    const enabled = form.has("enabled");
    const start = form.get("start_at");
    const end = form.get("end_at");
    if (enabled && (!start || !end || new Date(start) >= new Date(end))) return showDialogError("Khoảng thời gian Thi thật không hợp lệ.");
    const startIso = start ? new Date(start).toISOString() : null;
    const endIso = end ? new Date(end).toISOString() : null;
    const startsNewExam = enabled && (
      !space.real_exam_enabled
      || new Date(space.real_start_at || 0).getTime() !== new Date(startIso || 0).getTime()
      || new Date(space.real_end_at || 0).getTime() !== new Date(endIso || 0).getTime()
    );
    const payload = {
      real_exam_enabled: enabled,
      real_question_percent: Number(form.get("question_percent")),
      real_timer_seconds: Number(form.get("timer_seconds")),
      real_multi_percent: Number(form.get("multi_percent")),
      real_max_attempts: Number(form.get("max_attempts")),
      real_exam_version: startsNewExam || !space.real_exam_version ? crypto.randomUUID() : space.real_exam_version,
      real_start_at: startIso,
      real_end_at: endIso,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from("spaces").update(payload).eq("id", id);
    if (error) return showDialogError(error.message);
    closeDialog();
    await renderSpaces();
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
        <div class="panel grid"><h2>Tạo backup</h2><p class="muted">Xuất Space, Group, câu hỏi, phân quyền và kết quả thành JSON.</p><button class="primary" id="backupBtn">Tải backup</button></div>
        <div class="panel grid"><h2>Restore</h2><input id="restoreFile" type="file" accept=".json,application/json"><label class="switch"><input id="replaceRestore" type="checkbox"><span class="switch-track"></span><span>Thay thế dữ liệu hiện tại</span></label><button class="danger" id="restoreBtn">Restore dữ liệu</button></div>
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
})();
