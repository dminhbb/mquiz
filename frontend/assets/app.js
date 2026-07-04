(function () {
  const app = document.getElementById("app");
  const basePath = window.__SQ_BASE_PATH__ || "";
  const state = {
    theme: localStorage.getItem("sq-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    space: null,
    cloud: false,
    dataToken: null,
    slug: "",
    answers: null,
    mode: "mock",
    percent: 50,
    timerSeconds: 60,
    studentName: localStorage.getItem("sq_student_name") || "",
    groupName: "",
    selectedIds: [],
    current: 0,
    selections: {},
    locked: {},
    correctness: {},
    remaining: {},
    timeLeft: 0,
    timerId: null,
    startedAt: null,
    started: false,
    done: false,
    resultSaveStatus: "",
    scoreBreakdown: null,
    leaderboardVisible: false,
    leaderboardStatus: "",
    leaderboardRows: [],
    expandedDays: {}
  };

  document.documentElement.dataset.theme = state.theme;
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sorted = (letters) => [...new Set(letters || [])].sort();
  const currentQuestion = () => state.space.questions.find((question) => question.id === state.selectedIds[state.current]);
  let supabaseClient = null;

  async function sha256(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function boot() {
    renderShell("<div class='center'><div class='muted'>Đang tải...</div></div>");
    let pathname = location.pathname;
    if (basePath && pathname.startsWith(`${basePath}/`)) {
      pathname = pathname.slice(basePath.length);
    } else if (pathname === basePath) {
      pathname = "/";
    }
    pathname = pathname.replace(/^\/preview(?=\/|$)/, "");
    const slug = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ""));
    if (!slug) return renderWelcome();
    state.slug = slug;
    const cloudStatus = await getCloudSpaceStatus(slug);
    if (cloudStatus?.exists && !cloudStatus.published) {
      renderNotFound();
      return;
    }
    if (await loadCloudSpace(slug)) {
      configureLoadedSpace();
      renderSetup();
      return;
    }
    const index = window.__SQ_INDEX__ || {};
    const slugHash = await sha256(slug);
    const dataToken = index[slugHash];
    if (!dataToken) return renderWelcome();
    try {
      await loadScript(`${basePath}/data/${dataToken}.data.js`);
      state.space = window.__SQ_SPACE__;
      state.dataToken = dataToken;
      configureLoadedSpace();
      renderSetup();
    } catch (error) {
      renderWelcome();
    }
  }

  async function getCloudSpaceStatus(slug) {
    const client = getSupabaseClient();
    if (!client) return null;
    try {
      const { data, error } = await client.rpc("get_space_public_status", { requested_slug: slug });
      return error ? null : data;
    } catch {
      return null;
    }
  }

  async function loadCloudSpace(slug) {
    const client = getSupabaseClient();
    if (!client) return false;
    try {
      const { data: space, error } = await client
        .from("spaces")
        .select("*")
        .eq("slug", slug)
        .eq("published", true)
        .maybeSingle();
      if (error || !space) return false;
      const [{ data: groups, error: groupError }, { data: questions, error: questionError }] = await Promise.all([
        client.from("groups").select("name").eq("space_id", space.id).order("name"),
        client.from("questions").select("id,type,content,options_json,order_no").eq("space_id", space.id).order("order_no")
      ]);
      if (groupError || questionError || !questions?.length) return false;
      state.cloud = true;
      state.space = {
        id: space.id,
        name: space.name,
        timer_seconds: space.timer_seconds,
        exam_start_time: space.exam_start_time,
        allowed_late_minutes: space.allowed_late_minutes,
        groups: (groups || []).map((group) => group.name),
        questions: questions.map((question) => ({
          id: question.id,
          type: question.type,
          content: question.content,
          options: question.options_json
        })),
        real_exam: {
          enabled: Boolean(space.real_exam_enabled),
          question_percent: space.real_question_percent,
          timer_seconds: space.real_timer_seconds,
          multi_percent: space.real_multi_percent,
          max_attempts: space.real_max_attempts,
          version: space.real_exam_version,
          start_at: space.real_start_at,
          end_at: space.real_end_at
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  function configureLoadedSpace() {
    const groups = Array.isArray(state.space.groups) ? state.space.groups : [];
    const savedGroup = localStorage.getItem(`sq_group_${state.slug}`) || "";
    state.groupName = groups.includes(savedGroup) ? savedGroup : (groups[0] || "");
    if (state.space.real_exam?.enabled) {
      state.mode = "real";
      state.percent = Number(state.space.real_exam.question_percent || 50);
      state.timerSeconds = Number(state.space.real_exam.timer_seconds || 60);
    } else {
      state.mode = "mock";
      state.timerSeconds = Number(state.space.timer_seconds || 60);
    }
  }

  function renderShell(content) {
    app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">vn.Quiz</div><button class="ghost" id="themeBtn">${state.theme === "dark" ? "Light" : "Dark"}</button></header><main>${content}</main><footer class="app-copyright">vn.Quiz (C) 2026 | minhnd7</footer></div>`;
    document.getElementById("themeBtn").onclick = toggleTheme;
  }

  function showToast(message, tone = "info") {
    document.querySelectorAll(".toast").forEach((item) => item.remove());
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function confirmDialog({ title, message, details = "", confirmText = "Tiếp tục", cancelText = "Hủy", danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "dialog-backdrop";
      overlay.innerHTML = `<div class="dialog-panel" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(message)}</p>
        ${details}
        <div class="actions dialog-actions">
          <button class="ghost" data-cancel>${esc(cancelText)}</button>
          <button class="${danger ? "danger" : "primary"}" data-confirm>${esc(confirmText)}</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector("[data-cancel]").onclick = () => close(false);
      overlay.querySelector("[data-confirm]").onclick = () => close(true);
      overlay.onclick = (event) => {
        if (event.target === overlay) close(false);
      };
    });
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem("sq-theme", state.theme);
    const btn = document.getElementById("themeBtn");
    if (btn) btn.textContent = state.theme === "dark" ? "Light" : "Dark";
  }

  function renderWelcome() {
    stopTimer();
    renderShell(`<section class="screen center"><div><h1>Chào mừng tới hệ thống vn.Quiz</h1><p class="muted">Vui lòng sử dụng đường dẫn quiz đã được cung cấp.</p></div></section>`);
  }

  function renderNotFound() {
    stopTimer();
    renderShell(`<section class="screen center"><div style="text-align:center"><h1>404 error</h1><p class="muted">Space chưa được phát hành hoặc không thể truy cập.</p></div></section>`);
  }

  function calcQuestionCount(total, percent) {
    const raw = total * percent / 100;
    return Math.min(total, Math.max(5, Math.round(raw / 5) * 5));
  }

  function normalizeStudentName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function studentNameKey(value) {
    return normalizeStudentName(value).toLocaleLowerCase("vi-VN");
  }

  function isSupabaseConfigured() {
    const config = window.__SQ_SUPABASE__ || {};
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function getSupabaseClient() {
    if (!isSupabaseConfigured()) return null;
    if (!supabaseClient) {
      const config = window.__SQ_SUPABASE__;
      supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "vn-quiz-public-auth"
        }
      });
    }
    return supabaseClient;
  }

  function renderSetup() {
    stopTimer();
    const total = state.space.questions.length;
    const timerOptions = [15, 30, 45, 60, 90, 120];
    const realExam = Boolean(state.space.real_exam?.enabled);
    if (realExam) {
      state.mode = "real";
      state.percent = Number(state.space.real_exam.question_percent || 50);
      state.timerSeconds = Number(state.space.real_exam.timer_seconds || 60);
    }
    if (state.mode === "mock" && state.timerSeconds === null) {
      state.timerSeconds = Number(state.space.timer_seconds || 60);
    }
    const savedName = normalizeStudentName(state.studentName);
    const realAttempts = getRealAttemptCount(savedName);
    const maxRealAttempts = Number(state.space.real_exam?.max_attempts || 1);
    const realExhausted = realExam && savedName && realAttempts >= maxRealAttempts;
    const realWindow = getRealExamWindow();
    const realTimeClosed = realExam && !realWindow.isOpen;
    const realBlocked = realExhausted || realTimeClosed;
    renderShell(`<section class="leaderboard-shell setup-dashboard">
      <aside class="setup-sidebar">
        <div class="setup-logo"><span>vQ</span><b>vn.Quiz</b></div>
        <nav class="setup-nav">
          ${realBlocked ? "" : `<button class="active" type="button"><span></span>Làm bài</button>`}
          <button id="leaderboardBtn" class="${realBlocked ? "active" : ""}" type="button"><span></span>Kết quả</button>
        </nav>
        <div class="setup-student-card">
          <p>Học viên</p>
          <b>${esc(normalizeStudentName(state.studentName) || "Chưa nhập tên")}</b>
        </div>
      </aside>
      <main class="leaderboard-workspace setup-workspace">
        <header class="leaderboard-topbar">
          <div>
            <p class="setup-kicker">${esc(state.space?.name || "")}</p>
            <h1>Cấu hình bài thi</h1>
          </div>
        </header>
        ${realTimeClosed ? `<section class="attempts-exhausted"><strong>Hết thời gian thi</strong><p>Bắt đầu: ${esc(formatWindowDateTime(realWindow.start))}</p><p>Kết thúc: ${esc(formatWindowDateTime(realWindow.end))}</p></section>` : realExhausted ? `<section class="attempts-exhausted"><strong>Bạn đã hết số lượt thi !</strong><p>Số lượt thi là: ${maxRealAttempts}</p></section>` : `<section class="setup-actionbar">
          <div class="mode-control">
            <b>Chế độ làm bài</b>
            ${realExam ? `<span class="real-mode-label">Chế độ thi thật</span>` : `<div class="mode-toggle" role="group" aria-label="Chế độ làm bài">
              <button class="${state.mode === "mock" ? "active" : ""}" data-mode="mock">Thi thử</button>
              <button class="${state.mode === "practice" ? "active" : ""}" data-mode="practice">Luyện tập</button>
            </div>`}
            <p>${state.mode === "real" ? "Cấu hình do Admin thiết lập; lượt thi và kết quả được ghi nhận." : state.mode === "mock" ? "Thi thử và lưu kết quả hợp lệ vào bảng xếp hạng." : "Xem đánh giá đúng hoặc sai ngay sau mỗi câu trả lời."}</p>
          </div>
          <button class="danger start-btn" id="startBtn">Bắt đầu</button>
        </section>
        <div class="setup-board">
          <section class="setup-widget">
            <div class="widget-title"><h2>Tên học viên</h2><p>Dùng để lưu kết quả và xếp hạng.</p></div>
            <label class="student-field">
              <input id="studentName" maxlength="80" value="${esc(state.studentName)}" placeholder="Nhập tên học viên">
            </label>
          </section>
          <section class="setup-widget">
            <div class="widget-title"><h2>Group</h2><p>Chọn Group của bạn trong Space này.</p></div>
            <label class="student-field">
              <select id="groupName" required>
                ${(state.space.groups || []).map((group) => `<option value="${esc(group)}" ${state.groupName === group ? "selected" : ""}>${esc(group)}</option>`).join("")}
              </select>
            </label>
          </section>
          <section class="setup-widget">
            <div class="widget-title"><h2>Số lượng câu hỏi</h2><p>Lấy ngẫu nhiên, không lặp câu.</p></div>
            <div class="choice-grid compact">${[30, 50, 70, 100].map((percent) => `<button class="${state.percent === percent ? "active" : ""}" data-percent="${percent}" ${realExam ? "disabled" : ""}><b>${percent}%</b><span>${calcQuestionCount(total, percent)} câu</span></button>`).join("")}</div>
          </section>
          <section class="setup-widget">
            <div class="widget-title"><h2>Thời gian mỗi câu</h2><p>Áp dụng riêng cho từng câu hỏi.</p></div>
            <div class="choice-grid timer-grid">
              ${timerOptions.map((seconds) => `<button class="${Number(state.timerSeconds) === seconds ? "active" : ""}" data-timer="${seconds}" ${realExam ? "disabled" : ""}><b>${seconds}s</b></button>`).join("")}
              ${state.mode === "practice" ? `<button class="${state.timerSeconds === null ? "active" : ""}" data-timer="none"><b>Không giới hạn</b></button>` : ""}
            </div>
          </section>
        </div>`}
      </main>
    </section>`);
    document.querySelectorAll("[data-percent]").forEach((btn) => btn.onclick = () => { state.percent = Number(btn.dataset.percent); renderSetup(); });
    document.querySelectorAll("[data-mode]").forEach((btn) => btn.onclick = () => { state.mode = btn.dataset.mode; renderSetup(); });
    document.querySelectorAll("[data-timer]").forEach((btn) => btn.onclick = () => { state.timerSeconds = btn.dataset.timer === "none" ? null : Number(btn.dataset.timer); renderSetup(); });
    const studentNameInput = document.getElementById("studentName");
    if (studentNameInput) studentNameInput.oninput = (event) => {
      state.studentName = event.target.value;
      const name = normalizeStudentName(state.studentName);
      if (name) localStorage.setItem("sq_student_name", name);
    };
    const groupNameSelect = document.getElementById("groupName");
    if (groupNameSelect) groupNameSelect.onchange = (event) => {
      state.groupName = event.target.value;
      localStorage.setItem(`sq_group_${state.slug}`, state.groupName);
    };
    const startButton = document.getElementById("startBtn");
    if (startButton) startButton.onclick = startQuiz;
    document.getElementById("leaderboardBtn").onclick = () => showLeaderboard();
  }

  function realAttemptStorageKey(studentName) {
    const instance = state.space.real_exam?.version
      || `${state.space.real_exam?.start_at || "no-start"}_${state.space.real_exam?.end_at || "no-end"}`;
    return `sq_real_attempts_${state.slug}_${instance}_${studentNameKey(studentName)}`;
  }

  function getRealExamWindow() {
    const start = state.space?.real_exam?.start_at ? new Date(state.space.real_exam.start_at) : null;
    const end = state.space?.real_exam?.end_at ? new Date(state.space.real_exam.end_at) : null;
    const valid = start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start < end;
    const now = new Date();
    return { start, end, isOpen: Boolean(valid && now >= start && now <= end) };
  }

  function formatWindowDateTime(value) {
    if (!value || !Number.isFinite(value.getTime())) return "Chưa cấu hình";
    return value.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function getRealAttemptCount(studentName) {
    if (!studentName) return 0;
    return Math.max(0, Number(localStorage.getItem(realAttemptStorageKey(studentName)) || 0));
  }

  function selectRealExamQuestionIds(questionCount) {
    const multiQuestions = state.space.questions.filter((question) => question.type === "multi");
    const singleQuestions = state.space.questions.filter((question) => question.type !== "multi");
    const multiPercent = Number(state.space.real_exam?.multi_percent || 50);
    const roundedMultiTarget = Math.round((multiQuestions.length * multiPercent / 100) / 2) * 2;
    const multiTarget = Math.min(multiQuestions.length, questionCount, roundedMultiTarget);
    const selectedMulti = shuffle(multiQuestions).slice(0, multiTarget);
    const selectedSingle = shuffle(singleQuestions).slice(0, questionCount - selectedMulti.length);
    const remaining = questionCount - selectedMulti.length - selectedSingle.length;
    const selectedIds = new Set([...selectedMulti, ...selectedSingle].map((question) => question.id));
    const fillers = shuffle(state.space.questions.filter((question) => !selectedIds.has(question.id))).slice(0, remaining);
    return shuffle([...selectedMulti, ...selectedSingle, ...fillers].map((question) => question.id));
  }

  function shuffle(items) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [next[index], next[other]] = [next[other], next[index]];
    }
    return next;
  }

  async function startQuiz() {
    const name = normalizeStudentName(state.studentName);
    if (!name) {
      showToast("Vui lòng nhập tên học viên.", "warning");
      return;
    }
    const groupSelect = document.getElementById("groupName");
    if (groupSelect?.value) state.groupName = groupSelect.value;
    if (!state.groupName || !(state.space.groups || []).includes(state.groupName)) {
      showToast("Vui lòng chọn Group.", "warning");
      return;
    }
    if (state.mode === "real" && !getRealExamWindow().isOpen) {
      renderSetup();
      return;
    }
    state.studentName = name;
    localStorage.setItem("sq_student_name", name);
    localStorage.setItem(`sq_group_${state.slug}`, state.groupName);
    const questionCount = calcQuestionCount(state.space.questions.length, state.percent);
    if (state.mode === "real" && getRealAttemptCount(name) >= Number(state.space.real_exam?.max_attempts || 1)) {
      renderSetup();
      return;
    }
    const timeLabel = state.timerSeconds === null ? "Không giới hạn" : `${state.timerSeconds} giây/câu`;
    const confirmed = await confirmDialog({
      title: "Xác nhận làm bài",
      message: "Vui lòng kiểm tra thông tin trước khi bắt đầu.",
      confirmText: "Bắt đầu làm bài",
      details: `<dl class="quiz-confirm-details">
        <div class="confirm-space"><dt>Space</dt><dd>${esc(state.space.name)}</dd></div>
        <div><dt>Group</dt><dd>${esc(state.groupName)}</dd></div>
        <div><dt>Học viên</dt><dd>${esc(name)}</dd></div>
        <div><dt>Chế độ</dt><dd>${state.mode === "real" ? "Thi thật" : state.mode === "mock" ? "Thi thử" : "Luyện tập"}</dd></div>
        <div><dt>Số câu hỏi</dt><dd>${questionCount} câu</dd></div>
        <div><dt>Thời gian mỗi câu</dt><dd>${timeLabel}</dd></div>
      </dl>`
    });
    if (!confirmed) return;
    if (state.mode === "real") {
      const attempts = getRealAttemptCount(name);
      localStorage.setItem(realAttemptStorageKey(name), String(attempts + 1));
      state.selectedIds = selectRealExamQuestionIds(questionCount);
    } else {
      state.selectedIds = shuffle(state.space.questions.map((question) => question.id)).slice(0, questionCount);
    }
    state.current = 0;
    state.selections = {};
    state.locked = {};
    state.correctness = {};
    state.remaining = {};
    state.answers = null;
    state.done = false;
    state.resultSaveStatus = "";
    state.scoreBreakdown = null;
    state.leaderboardVisible = false;
    state.startedAt = Date.now();
    state.started = true;
    renderQuestion(true);
  }

  async function showLeaderboard() {
    state.leaderboardVisible = true;
    state.leaderboardStatus = "Đang tải bảng xếp hạng...";
    renderLeaderboard();
    const client = getSupabaseClient();
    if (!client) {
      state.leaderboardRows = [];
      state.leaderboardStatus = "Chưa cấu hình Supabase. Hãy điền URL và anon key trong assets/supabase-config.js.";
      renderLeaderboard();
      return;
    }

    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let query = client
        .from("quiz_attempts")
        .select("id, space_slug, student_name, student_name_key, group_name, mode, score, total_questions, correct_count, wrong_count, duration_seconds, started_at, submitted_at")
        .eq("space_slug", state.slug);
      const realWindow = getRealExamWindow();
      if (state.space.real_exam?.enabled && realWindow.start && realWindow.end) {
        query = query
          .eq("mode", "real")
          .gte("started_at", realWindow.start.toISOString())
          .lte("started_at", realWindow.end.toISOString());
      } else {
        query = query.gte("submitted_at", cutoff);
      }
      const { data, error } = await query.order("submitted_at", { ascending: false }).limit(1000);
      if (error) throw error;
      state.leaderboardRows = data || [];
      state.leaderboardStatus = state.leaderboardRows.length
        ? ""
        : state.space.real_exam?.enabled
          ? "Chưa có kết quả Thi thật trong khoảng thời gian đã cấu hình."
          : "Chưa có kết quả thi.";
    } catch (error) {
      state.leaderboardRows = [];
      state.leaderboardStatus = `Không tải được bảng xếp hạng: ${error.message || "Lỗi không xác định"}`;
    }
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const days = buildLeaderboardDays(state.leaderboardRows).slice(0, 3);
    const best = days[0]?.rows?.[0];
    renderShell(`<section class="leaderboard-shell">
      <aside class="setup-sidebar">
        <div class="setup-logo"><span>vQ</span><b>vn.Quiz</b></div>
        <nav class="setup-nav">
          <button id="backBtn" type="button"><span></span>Làm bài</button>
          <button class="active" type="button"><span></span>Kết quả</button>
        </nav>
        <div class="setup-student-card">
          <p>Space</p>
          <b>${esc(state.space?.name || "")}</b>
        </div>
      </aside>
      <main class="leaderboard-workspace">
        <header class="leaderboard-topbar">
          <div>
            <p class="setup-kicker">Trung tâm Hỗ trợ Tín dụng</p>
            <h1>Bảng xếp hạng</h1>
            <p class="muted">${esc(state.space?.name || "")} · ${state.space.real_exam?.enabled ? "Kết quả trong kỳ Thi thật" : "3 ngày có kết quả gần nhất"}</p>
          </div>
          <button class="primary" id="backTopBtn">Quay lại</button>
        </header>
        <div class="setup-summary">
          <div><span>Số ngày có dữ liệu</span><b>${days.length}</b></div>
          <div><span>Lượt thi hiển thị</span><b>${days.reduce((sum, day) => sum + day.rows.length, 0)}</b></div>
          <div><span>Dẫn đầu gần nhất</span><b>${best ? best.score : "-"}</b></div>
        </div>
        ${state.leaderboardStatus ? `<div class="status-panel">${esc(state.leaderboardStatus)}</div>` : ""}
        <div class="grid leaderboard-days">${days.map(renderLeaderboardDay).join("")}</div>
      </main>
    </section>`);
    document.getElementById("backBtn").onclick = () => {
      state.leaderboardVisible = false;
      state.done ? renderResults() : renderSetup();
    };
    document.getElementById("backTopBtn").onclick = document.getElementById("backBtn").onclick;
    document.querySelectorAll("[data-expand-day]").forEach((button) => {
      button.onclick = () => {
        const day = button.dataset.expandDay;
        state.expandedDays[day] = !state.expandedDays[day];
        renderLeaderboard();
      };
    });
  }

  function buildLeaderboardDays(rows) {
    const byDay = new Map();
    (rows || []).forEach((row) => {
      const day = new Date(row.submitted_at).toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(row);
    });

    return [...byDay.entries()].map(([day, dayRows]) => {
      const bestByStudent = new Map();
      dayRows.forEach((row) => {
        const key = row.student_name_key || studentNameKey(row.student_name);
        const current = bestByStudent.get(key);
        if (!current || compareAttempt(row, current) < 0) bestByStudent.set(key, row);
      });
      const rows = [...bestByStudent.values()].sort(compareAttempt);
      return { day, rows, totalRaw: dayRows.length };
    }).sort((a, b) => dateFromVi(b.day) - dateFromVi(a.day));
  }

  function compareAttempt(a, b) {
    return Number(b.score) - Number(a.score);
  }

  function dateFromVi(day) {
    const [date, month, year] = day.split("/");
    return new Date(`${year}-${month}-${date}T00:00:00`);
  }

  function renderLeaderboardDay(dayData) {
    const expanded = Boolean(state.expandedDays[dayData.day]);
    const visibleRows = expanded ? dayData.rows : dayData.rows.slice(0, 15);
    return `<div class="panel leaderboard-day">
      <div class="space-between">
        <div><h2>${esc(dayData.day)}</h2><p class="muted">${dayData.rows.length} học viên · ${dayData.totalRaw} lượt thi</p></div>
        ${dayData.rows.length > 15 ? `<button class="ghost" data-expand-day="${esc(dayData.day)}">${expanded ? "Thu gọn" : "Xem toàn bộ"}</button>` : ""}
      </div>
      <div class="leaderboard-table">
        <div class="leaderboard-row leaderboard-head"><span>#</span><span>Tên học viên</span><span>Group</span><span>Chế độ</span><span>Thời gian làm bài</span><span>Giờ làm bài</span><span>Đúng</span><span>Sai</span><span>Tổng</span><span>Điểm</span></div>
        ${visibleRows.map((row, index) => renderLeaderboardRow(row, index)).join("")}
      </div>
    </div>`;
  }

  function renderLeaderboardRow(row, index) {
    const stars = ["★★★", "★★", "★"];
    const medalNames = ["Vàng", "Bạc", "Đồng"];
    const rank = index < 3
      ? `<span class="rank-stars rank-${index + 1}" title="${medalNames[index]}" aria-label="${medalNames[index]}">${stars[index]}</span>`
      : esc(String(index + 1));
    return `<div class="leaderboard-row ${index < 3 ? "top-rank" : ""}">
      <span class="rank">${rank}</span>
      <span>${esc(row.student_name)}</span>
      <span>${esc(row.group_name || "Chưa phân nhóm")}</span>
      <span>${row.mode === "real" ? "Thi thật" : row.mode === "practice" ? "Luyện tập" : "Thi thử"}</span>
      <span>${formatDuration(row.duration_seconds)}</span>
      <span>${formatAttemptDateTime(row.started_at || row.submitted_at)}</span>
      <span>${row.correct_count}</span>
      <span>${row.wrong_count}</span>
      <span>${row.total_questions}</span>
      <span><b>${row.score}</b></span>
    </div>`;
  }

  function formatAttemptDateTime(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    });
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(total / 60);
    const remain = total % 60;
    return `${minutes}:${String(remain).padStart(2, "0")}`;
  }

  function renderQuestion(resetTimer) {
    if (state.done) return renderResults();
    const question = currentQuestion();
    if (!question) return submitQuiz();
    if (resetTimer && !state.locked[question.id]) startTimer(question.id);
    const selection = state.selections[question.id] || [];
    const locked = Boolean(state.locked[question.id]);
    const correct = state.correctness[question.id];
    const answerLetters = state.answers?.answers?.[question.id] || [];
    const progress = Math.round((Object.keys(state.locked).length / state.selectedIds.length) * 100);
    const showTimer = state.timerSeconds !== null;
    renderShell(`<section class="screen grid">
      <div class="space-between">
        <div><b>Câu ${state.current + 1}/${state.selectedIds.length}</b><div class="muted">${state.mode === "real" ? "Thi thật" : state.mode === "mock" ? "Thi thử" : "Luyện tập"}</div></div>
        ${showTimer ? `<div class="timer ${locked ? "expired" : ""}" id="timer">${timerLabel(locked)}</div>` : ""}
      </div>
      <div class="progress" style="--value:${progress}%"><div></div></div>
      <div class="panel grid quiz-panel">
        <div class="type-pill ${question.type === "multi" ? "multi" : ""}">${question.type === "single" ? "Một đáp án" : "Nhiều lựa chọn"}</div>
        <div class="large-question">${esc(question.content)}</div>
        <div class="grid options-grid">${Object.entries(question.options).map(([letter, text]) => {
          const isSelected = selection.includes(letter);
          const isCorrect = answerLetters.includes(letter);
          const isWrongChoice = locked && isSelected && !isCorrect;
          const cls = ["choice", isSelected ? "selected" : "", locked ? "locked" : "", locked && isCorrect ? "correct" : "", isWrongChoice ? "wrong" : ""].filter(Boolean).join(" ");
          return `<label class="${cls}">
            <input class="choice-control" type="${question.type === "single" ? "radio" : "checkbox"}" name="question-${question.id}" value="${letter}" data-choice="${letter}" ${isSelected ? "checked" : ""} ${locked ? "disabled" : ""}>
            <b>${letter}</b><span>${esc(text)}</span>
          </label>`;
        }).join("")}</div>
        ${locked ? reviewHtml(question, correct, answerLetters) : ""}
        <div class="question-footer">
          <div class="actions">
            <button id="prevBtn" ${state.current === 0 ? "disabled" : ""}>Prev</button>
            <button class="primary" id="nextBtn">${state.mode === "practice" && !locked ? "Kiểm tra đáp án" : state.current === state.selectedIds.length - 1 ? "Nộp bài" : "Next"}</button>
          </div>
          <button class="ghost" id="finishBtn">Kết thúc làm bài</button>
        </div>
      </div>
    </section>`);
    document.querySelectorAll("[data-choice]").forEach((input) => input.onchange = () => toggleChoice(question, input.dataset.choice));
    document.getElementById("prevBtn").onclick = () => move(-1);
    document.getElementById("nextBtn").onclick = handleNext;
    document.getElementById("finishBtn").onclick = requestFinishEarly;
  }

  async function handleNext() {
    const question = currentQuestion();
    if (!question) return;
    const selection = state.selections[question.id] || [];
    if (!state.locked[question.id]) {
      if (!selection.length) {
        const continueWithoutAnswer = await confirmDialog({
          title: "Chưa chọn đáp án",
          message: "Bạn chưa chọn đáp án nào. Câu này sẽ được tính là chưa trả lời.",
          cancelText: "Quay lại",
          confirmText: "Vẫn chuyển"
        });
        if (!continueWithoutAnswer) return;
      }
      else if (question.type === "multi" && selection.length < 2) {
        const continueWithOneAnswer = await confirmDialog({
          title: "Câu hỏi nhiều lựa chọn",
          message: "Bạn mới chọn một đáp án cho câu hỏi nhiều lựa chọn.",
          cancelText: "Quay lại",
          confirmText: "Vẫn chuyển"
        });
        if (!continueWithOneAnswer) return;
      }
      const lockedSuccessfully = await lockCurrent(false);
      if (!lockedSuccessfully) return;
      if (state.mode === "practice") {
        return;
      }
    }
    if (state.current === state.selectedIds.length - 1) await submitQuiz();
    else move(1);
  }

  function timerLabel(locked) {
    return locked && state.mode === "practice" ? "Review" : formatTime(state.timeLeft);
  }

  function reviewHtml(question, correct, answers) {
    if (state.mode !== "practice" && !state.done) return "";
    const answerText = answers.length ? answers.map((letter) => `${letter}. ${question.options[letter]}`).join("; ") : "Đang tải đáp án...";
    return `<div class="review ${correct ? "correct" : "wrong"}"><b>${correct ? "Đúng" : "Sai"}</b><div>Đáp án đúng: ${esc(answerText)}</div></div>`;
  }

  function toggleChoice(question, letter) {
    const current = state.selections[question.id] || [];
    if (question.type === "single") {
      state.selections[question.id] = [letter];
    } else {
      state.selections[question.id] = current.includes(letter) ? current.filter((item) => item !== letter) : [...current, letter];
    }
    renderQuestion(false);
  }

  async function lockCurrent(autoAdvance) {
    const question = currentQuestion();
    if (!question) return false;
    if (state.locked[question.id]) return true;
    state.locked[question.id] = true;
    stopTimer();
    delete state.remaining[question.id];
    const selection = sorted(state.selections[question.id] || []);
    if (state.cloud) {
      if (state.mode === "practice") {
        const client = getSupabaseClient();
        const { data, error } = await client.functions.invoke("quiz-evaluate", {
          body: { action: "check", slug: state.slug, question_id: question.id, selected: selection }
        });
        if (error || data?.error) {
          state.locked[question.id] = false;
          showToast(data?.error || error?.message || "Không kiểm tra được đáp án.", "warning");
          return false;
        }
        state.correctness[question.id] = Boolean(data.is_correct);
        state.answers = state.answers || { answers: {} };
        state.answers.answers[question.id] = data.correct;
      } else {
        state.correctness[question.id] = false;
      }
    } else {
      const hash = await sha256(`${selection.join(",")}${question.salt}`);
      state.correctness[question.id] = hash === question.check;
      if (state.mode === "practice") await ensureAnswers();
    }
    if (autoAdvance && state.mode !== "practice") {
      if (state.current === state.selectedIds.length - 1) submitQuiz();
      else { state.current += 1; renderQuestion(true); }
    } else {
      renderQuestion(false);
    }
    return true;
  }

  function move(delta) {
    const next = state.current + delta;
    if (next < 0 || next >= state.selectedIds.length) return;
    pauseCurrentTimer();
    state.current = next;
    const question = currentQuestion();
    renderQuestion(!state.locked[question.id]);
  }

  function startTimer(questionId) {
    stopTimer();
    if (state.timerSeconds === null) {
      state.timeLeft = null;
      return;
    }
    state.timeLeft = state.remaining[questionId] ?? Number(state.timerSeconds || 60);
    state.timerId = setInterval(() => {
      state.timeLeft -= 1;
      state.remaining[questionId] = state.timeLeft;
      const timer = document.getElementById("timer");
      if (timer) timer.textContent = formatTime(state.timeLeft);
      if (state.timeLeft <= 0) lockCurrent(state.mode !== "practice");
    }, 1000);
  }

  function pauseCurrentTimer() {
    const question = currentQuestion();
    if (question && !state.locked[question.id] && state.timerSeconds !== null) {
      state.remaining[question.id] = Math.max(0, state.timeLeft);
    }
    stopTimer();
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function formatTime(seconds) {
    return `${Math.max(0, seconds)}s`;
  }

  async function ensureAnswers() {
    if (state.answers) return state.answers;
    if (state.cloud) {
      const client = getSupabaseClient();
      const { data, error } = await client.functions.invoke("quiz-evaluate", {
        body: { action: "answers", slug: state.slug, question_ids: state.selectedIds }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Không tải được đáp án.");
      state.answers = { answers: data.answers || {} };
      return state.answers;
    }
    const keyToken = await sha256(`${state.dataToken}${state.space.key_salt}`);
    await loadScript(`${basePath}/data/${keyToken}.key.js`);
    state.answers = window.__SQ_ANSWERS__;
    return state.answers;
  }

  async function requestFinishEarly() {
    const understood = await confirmDialog({
      title: "Kết thúc sớm",
      message: "Các câu chưa làm sẽ được tính là sai.",
      confirmText: "Tôi đã hiểu"
    });
    if (!understood) return;
    const confirmed = await confirmDialog({
      title: "Xác nhận lần cuối",
      message: "Bạn chắc chắn muốn kết thúc làm bài?",
      confirmText: "Kết thúc làm bài",
      danger: true
    });
    if (!confirmed) return;
    await submitQuiz({ includeUnanswered: false, saveResult: false });
  }

  async function submitQuiz(options = {}) {
    const includeUnanswered = options.includeUnanswered !== false;
    const shouldSaveResult = options.saveResult !== false;
    pauseCurrentTimer();
    if (includeUnanswered) {
      for (const id of state.selectedIds) {
        if (!state.locked[id]) {
          state.current = state.selectedIds.indexOf(id);
          await lockCurrent(false);
        }
      }
    }
    await ensureAnswers();
    updateCorrectnessFromAnswers();
    state.scoreBreakdown = calculateCompositeScore();
    state.done = true;
    state.resultSaveStatus = "";
    if (shouldSaveResult) {
      await saveExamAttempt();
    }
    renderResults();
  }

  function updateCorrectnessFromAnswers() {
    state.selectedIds.forEach((id) => {
      const selected = sorted(state.selections[id] || []);
      const correct = sorted(state.answers?.answers?.[id] || []);
      state.correctness[id] = selected.length === correct.length
        && selected.every((letter, index) => letter === correct[index]);
    });
  }

  async function saveExamAttempt() {
    if (state.mode === "practice") return;
    if (state.selectedIds.some((id) => !state.locked[id])) return;
    const client = getSupabaseClient();
    if (!client) {
      state.resultSaveStatus = "Chưa cấu hình Supabase nên kết quả chưa được lưu.";
      return;
    }

    const total = state.selectedIds.length;
    const correctCount = state.selectedIds.filter((id) => state.correctness[id]).length;
    const wrongCount = total - correctCount;
    const breakdown = state.scoreBreakdown || calculateCompositeScore();
    const score = breakdown.score;
    const durationSeconds = Math.max(0, Math.round((Date.now() - (state.startedAt || Date.now())) / 1000));
    const studentName = normalizeStudentName(state.studentName);

    try {
      const { error } = await client.from("quiz_attempts").insert({
        space_slug: state.slug,
        student_name: studentName,
        student_name_key: studentNameKey(studentName),
        group_name: state.groupName,
        mode: state.mode,
        started_at: new Date(state.startedAt || Date.now()).toISOString(),
        score,
        total_questions: total,
        bank_question_count: state.space.questions.length,
        correct_count: correctCount,
        wrong_count: wrongCount,
        multi_correct_count: breakdown.multiCorrectCount,
        multi_similarity_score: breakdown.multiSimilarityScore,
        duration_seconds: durationSeconds,
        timer_seconds: Number(state.timerSeconds || state.space.timer_seconds || 0),
        knowledge_score: breakdown.knowledgeScore,
        coverage_score: breakdown.coverageScore,
        duration_score: breakdown.durationScore,
        punctuality_score: breakdown.punctualityScore
      });
      if (error) throw error;
      state.resultSaveStatus = "Đã lưu kết quả thi.";
    } catch (error) {
      const message = error.message || "Lỗi không xác định";
      state.resultSaveStatus = message.includes("row-level security")
        ? "Không lưu được kết quả: Supabase từ chối quyền ghi. Hãy chạy supabase/fix_quiz_attempt_policy.sql."
        : `Không lưu được kết quả: ${message}`;
    }
  }

  function calculateCompositeScore() {
    const roundScore = (value) => Math.round(value * 100) / 100;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    let earnedWeight = 0;
    let totalWeight = 0;
    let multiCorrectCount = 0;
    let multiSimilarityScore = 0;

    state.selectedIds.forEach((id) => {
      const question = state.space.questions.find((item) => item.id === id);
      const selected = new Set(state.selections[id] || []);
      const correct = new Set(state.answers?.answers?.[id] || []);
      const isMulti = question?.type === "multi";
      const weight = isMulti ? Math.min(2, 1 + 0.25 * Math.max(0, correct.size - 1)) : 1;
      let similarity = 0;

      if (isMulti) {
        const truePositive = [...selected].filter((letter) => correct.has(letter)).length;
        const falsePositive = [...selected].filter((letter) => !correct.has(letter)).length;
        const falseNegative = [...correct].filter((letter) => !selected.has(letter)).length;
        const denominator = 2 * truePositive + falsePositive + falseNegative;
        similarity = denominator ? (2 * truePositive) / denominator : 0;
        multiSimilarityScore += similarity;
        if (falsePositive === 0 && falseNegative === 0) multiCorrectCount += 1;
      } else {
        similarity = selected.size === correct.size && [...selected].every((letter) => correct.has(letter)) ? 1 : 0;
      }

      earnedWeight += similarity * weight;
      totalWeight += weight;
    });

    const totalQuestions = state.selectedIds.length;
    const bankQuestionCount = state.space.questions.length;
    const durationSeconds = Math.max(0, Math.round((Date.now() - (state.startedAt || Date.now())) / 1000));
    const timerSeconds = Number(state.timerSeconds || state.space.timer_seconds || 0);
    const maximumDuration = totalQuestions * timerSeconds;
    const minimumReasonableDuration = maximumDuration * 0.3;
    const knowledgeScore = totalWeight ? 75 * earnedWeight / totalWeight : 0;
    const coverageScore = bankQuestionCount ? 10 * totalQuestions / bankQuestionCount : 0;
    const durationScore = maximumDuration > minimumReasonableDuration
      ? 10 * clamp((maximumDuration - durationSeconds) / (maximumDuration - minimumReasonableDuration), 0, 1)
      : 10;
    const punctualityScore = calculatePunctualityScore(state.startedAt);

    return {
      score: roundScore(clamp(knowledgeScore + coverageScore + durationScore + punctualityScore, 0, 100)),
      knowledgeScore: roundScore(knowledgeScore),
      coverageScore: roundScore(coverageScore),
      durationScore: roundScore(durationScore),
      punctualityScore: roundScore(punctualityScore),
      multiCorrectCount,
      multiSimilarityScore: roundScore(multiSimilarityScore)
    };
  }

  function calculatePunctualityScore(startedAt) {
    const configuredTime = state.space.exam_start_time;
    if (!configuredTime) return 5;
    const [hours, minutes] = configuredTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 5;
    const started = new Date(startedAt || Date.now());
    const startedMinutes = started.getHours() * 60 + started.getMinutes();
    const scheduledMinutes = hours * 60 + minutes;
    const lateness = Math.max(0, startedMinutes - scheduledMinutes);
    const allowance = Math.max(1, Number(state.space.allowed_late_minutes || 30));
    return 5 * Math.max(0, 1 - lateness / allowance);
  }

  function renderResults() {
    stopTimer();
    const total = state.selectedIds.length;
    const correctCount = state.selectedIds.filter((id) => state.correctness[id]).length;
    const breakdown = state.scoreBreakdown || calculateCompositeScore();
    const score = breakdown.score;
    const questionsById = new Map(state.space.questions.map((question) => [question.id, question]));
    renderShell(`<section class="screen grid">
      <div class="panel result-panel" style="text-align:center"><div class="score" style="--score:${score}"><span>${score}</span></div><h1>${score} điểm</h1><p class="muted">${correctCount}/${total} câu đúng</p><p class="muted">Kiến thức ${breakdown.knowledgeScore}/75 · Quy mô ${breakdown.coverageScore}/10 · Thời gian ${breakdown.durationScore}/10 · Đúng giờ ${breakdown.punctualityScore}/5</p>${state.resultSaveStatus ? `<p class="muted">${esc(state.resultSaveStatus)}</p>` : ""}<div class="actions center-actions"><button class="primary" id="retryBtn">Làm lại</button><button class="ghost" id="resultLeaderboardBtn">Bảng xếp hạng</button></div></div>
      <div class="grid">${state.selectedIds.map((id, index) => {
        const question = questionsById.get(id);
        const selected = state.selections[id] || [];
        const answers = state.answers?.answers?.[id] || [];
        return `<div class="panel review ${state.correctness[id] ? "correct" : "wrong"}">
          <h3>Câu ${index + 1}. ${esc(question.content)}</h3>
          <p><b>Bạn chọn:</b> ${esc(selected.length ? selected.map((letter) => `${letter}. ${question.options[letter]}`).join("; ") : "Chưa trả lời")}</p>
          <p><b>Đáp án đúng:</b> ${esc(answers.map((letter) => `${letter}. ${question.options[letter]}`).join("; "))}</p>
        </div>`;
      }).join("")}</div>
    </section>`);
    document.getElementById("retryBtn").onclick = renderSetup;
    document.getElementById("resultLeaderboardBtn").onclick = () => showLeaderboard();
  }

  boot();
})();
