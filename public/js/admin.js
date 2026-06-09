(function () {
  const adminApp = document.getElementById("adminApp");
  const tokenKey = "alumniAdminToken";
  const userKey = "alumniUser";
  const storage = (() => {
    try {
      if (!window.localStorage) throw new Error("Storage unavailable");
      const testKey = "__admin_storage_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch {
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    }
  })();

  const PERMISSIONS = [
    { key: "manage_settings", label: "Settings" },
    { key: "manage_menus", label: "Menus" },
    { key: "manage_slides", label: "Hero slides" },
    { key: "manage_pages", label: "Pages" },
    { key: "manage_posts", label: "News and notices" },
    { key: "manage_committee", label: "Committee" },
    { key: "manage_members", label: "Members" },
    { key: "manage_gallery", label: "Gallery" },
    { key: "view_submissions", label: "Applications and messages" },
    { key: "upload_image", label: "Asset uploads" },
    { key: "edit_any", label: "Everything" }
  ];

  const LEGACY_PERMISSIONS = {
    add_post: "manage_posts",
    add_member: "manage_members"
  };

  const TAB_PERMISSIONS = {
    settings: "manage_settings",
    menus: "manage_menus",
    slides: "manage_slides",
    pages: "manage_pages",
    posts: "manage_posts",
    committee: "manage_committee",
    members: "manage_members",
    gallery: "manage_gallery",
    applications: "view_submissions",
    messages: "view_submissions"
  };

  const SAVE_TABS = new Set(["settings", "menus", "slides", "pages", "posts", "committee", "members", "gallery"]);

  const state = {
    token: storage.getItem(tokenKey),
    user: JSON.parse(storage.getItem(userKey) || "{}"),
    data: null,
    users: [],
    usersLoaded: false,
    usersLoading: false,
    usersSearch: "",
    usersPage: 1,
    usersPageSize: 10,
    tab: "dashboard",
    selected: {
      pages: 0,
      posts: 0,
      committee: 0,
      members: 0,
      gallery: 0
    }
  };

  const COMMITTEE_TYPE_OPTIONS = ["উপদেষ্টা কমিটি", "আহবায়ক কমিটি", "কার্যনির্বাহী কমিটি"];
  const COMMITTEE_TYPE_ALIASES = {
    "Advisory Committee": "উপদেষ্টা কমিটি",
    "Executive Committee": "আহবায়ক কমিটি"
  };
  const committeeTypeValue = (value) => {
    const type = String(value || "").trim();
    return COMMITTEE_TYPE_ALIASES[type] || type || "আহবায়ক কমিটি";
  };
  const COMMITTEE_STATUS_OPTIONS = ["active", "inactive"];
  const COMMITTEE_ROLE_OPTIONS = [
    "আহবায়ক",
    "সিনিয়র যুগ্ম আহবায়ক",
    "যুগ্ম আহবায়ক",
    "সদস্য সচিব",
    "সিনিয়র যুগ্ম সদস্য সচিব",
    "যুগ্ম সদস্য সচিব",
    "উপদেষ্টা",
    "সদস্য",
    "Member"
  ];
  const COMMITTEE_ROLE_ORDER = {
    "আহবায়ক": 10,
    "সিনিয়র যুগ্ম আহবায়ক": 20,
    "যুগ্ম আহবায়ক": 30,
    "সদস্য সচিব": 40,
    "সিনিয়র যুগ্ম সদস্য সচিব": 50,
    "যুগ্ম সদস্য সচিব": 60,
    "উপদেষ্টা": 70,
    "সদস্য": 100,
    "Member": 100
  };

  function normalizePermissions(permissions) {
    const set = new Set(Array.isArray(permissions) ? permissions : []);
    for (const [legacy, modern] of Object.entries(LEGACY_PERMISSIONS)) {
      if (set.has(legacy)) set.add(modern);
    }
    return set;
  }

  function hasPerm(permission) {
    if (state.user.isAdmin) return true;
    const perms = normalizePermissions(state.user.permissions);
    return perms.has("edit_any") || perms.has(permission);
  }

  function canOpenTab(tab) {
    if (tab === "dashboard" || tab === "me") return true;
    if (tab === "users") return !!state.user.isAdmin;
    const permission = TAB_PERMISSIONS[tab];
    return permission ? hasPerm(permission) : false;
  }

  function canSaveCurrentTab() {
    if (!SAVE_TABS.has(state.tab)) return false;
    if (state.user.isAdmin || hasPerm("edit_any")) return true;
    const permission = TAB_PERMISSIONS[state.tab];
    return permission ? hasPerm(permission) : false;
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const multiline = (items = []) => (Array.isArray(items) ? items : []).join("\n\n");
  const splitParagraphs = (value) => String(value || "").split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  const today = () => new Date().toISOString().slice(0, 10);

  const committeeRoleOrder = (role) => COMMITTEE_ROLE_ORDER[String(role || "").trim()] || 999;

  function committeeSession(person = {}) {
    return String(person.year || "2026-2027").trim() || "2026-2027";
  }

  function normalizeCommitteePerson(person = {}, index = 0) {
    const role = person.role || "সদস্য";
    return {
      ...person,
      type: committeeTypeValue(person.type),
      status: String(person.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
      year: committeeSession(person),
      designationOrder: Number.isFinite(Number(person.designationOrder)) ? Number(person.designationOrder) : committeeRoleOrder(role),
      sortOrder: Number.isFinite(Number(person.sortOrder)) ? Number(person.sortOrder) : index
    };
  }

  function normalizeCommitteeList() {
    state.data.committee = (state.data.committee || []).map((person, index) => normalizeCommitteePerson(person, index));
  }

  function slugify(value, fallback = "item") {
    const slug = String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || `${fallback}-${Date.now()}`;
  }

  function normalizePath(value) {
    let next = String(value || "/").trim();
    if (!next.startsWith("/")) next = `/${next}`;
    if (next !== "/" && !next.endsWith("/")) next += "/";
    return next;
  }

  async function api(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      }
    }).finally(() => clearTimeout(timer));
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      if (response.status === 401) {
        storage.removeItem(tokenKey);
        storage.removeItem(userKey);
        state.token = null;
        state.user = {};
        renderLogin("Session expired. Please login again.");
      }
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function loadUsers(force = false) {
    if (!state.user.isAdmin) return;
    if (state.usersLoaded && !force) return;
    state.usersLoading = true;
    try {
      state.users = await api("/api/admin/users", { timeoutMs: 60000 });
      state.usersLoaded = true;
    } finally {
      state.usersLoading = false;
    }
  }

  function setStatus(message, tone = "info") {
    const status = document.getElementById("adminStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function field(label, name, value = "", type = "text", options = {}) {
    const upload = options.upload || /image|logo|background/i.test(name);
    const wide = options.wide ? " wide-field" : "";
    const inputAttrs = [
      `name="${escapeHtml(name)}"`,
      `type="${escapeHtml(type)}"`,
      `value="${escapeHtml(value)}"`,
      options.readonly ? "readonly" : "",
      options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""
    ].filter(Boolean).join(" ");

    return `
      <label class="admin-field${wide}">
        <span>${escapeHtml(label)}</span>
        <div class="${upload ? "field-with-action" : ""}">
          <input ${inputAttrs}>
          ${upload ? `<button class="plain-button upload-trigger" type="button" data-for="${escapeHtml(name)}">Choose</button>` : ""}
        </div>
        ${upload && value ? `<img class="asset-preview" src="${escapeHtml(value)}" alt="">` : ""}
      </label>
    `;
  }

  function textarea(label, name, value = "", options = {}) {
    return `
      <label class="admin-field${options.wide === false ? "" : " wide-field"}">
        <span>${escapeHtml(label)}</span>
        <textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  function selectField(label, name, value, options) {
    return `
      <label class="admin-field">
        <span>${escapeHtml(label)}</span>
        <select name="${escapeHtml(name)}">
          ${options.map((option) => `<option value="${escapeHtml(option)}" ${String(option) === String(value || "") ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function optionsWithCurrent(options, current) {
    const list = [...options];
    const value = String(current || "").trim();
    if (value && !list.some((item) => String(item) === value)) list.push(value);
    return list;
  }

  function committeeSessionOptions(current = "") {
    const sessions = [...new Set((state.data.committee || []).map((person) => committeeSession(person)).filter(Boolean))];
    return optionsWithCurrent(sessions.length ? sessions : ["2026-2027"], current).sort().reverse();
  }

  function memberLabel(member) {
    if (!member) return "Select approved member";
    const parts = [
      member.name || "Member",
      member.email ? `(${member.email})` : "",
      member.batch ? `Batch ${member.batch}` : ""
    ].filter(Boolean);
    return parts.join(" ");
  }

  function banglaSearchAlias(value) {
    const map = {
      "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
      "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
      "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng", "চ": "ch", "ছ": "ch", "জ": "j", "ঝ": "jh", "ঞ": "n",
      "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n", "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
      "প": "p", "ফ": "f", "ব": "b", "ভ": "v", "ম": "m", "য": "j", "য়": "y", "র": "r", "ল": "l",
      "শ": "sh", "ষ": "sh", "স": "s", "হ": "h", "ড়": "r", "ঢ়": "rh", "ৎ": "t", "ং": "ng", "ঃ": "h", "ঁ": "",
      "ৃ": "ri", "্": "", "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9"
    };
    return String(value || "").split("").map((char) => map[char] ?? char).join("");
  }

  function memberSearchText(member) {
    const values = [member.name, member.email, member.phone, member.batch, member.id];
    return [...values, ...values.map(banglaSearchAlias)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function memberById(memberId) {
    return (state.data.members || []).find((member) => String(member.id || "") === String(memberId || "")) || null;
  }

  function usedCommitteeMemberIds(session = "") {
    return new Set((state.data.committee || [])
      .filter((person) => !session || committeeSession(person) === session)
      .map((person) => String(person.memberId || ""))
      .filter(Boolean));
  }

  function availableCommitteeMembers(session = "") {
    const usedIds = usedCommitteeMemberIds(session);
    return (state.data.members || []).filter((member) => {
      const memberId = String(member.id || "");
      return memberId && !usedIds.has(memberId);
    });
  }

  function memberPicker(person = {}) {
    const selectedMemberId = person.memberId || "";
    const session = committeeSession(person);
    const members = availableCommitteeMembers(session);
    const selectedMember = memberById(selectedMemberId);
    const placeholder = selectedMember
      ? `Search unused member for ${session} to replace current member`
      : `Search unused member for ${session}`;
    return `
      <label class="admin-field wide-field committee-member-picker">
        <span>Search and select member</span>
        <div class="select2-lite" data-member-picker data-session="${escapeHtml(session)}">
          <input data-member-search value="" autocomplete="off" placeholder="${escapeHtml(placeholder)}">
          <div class="select2-lite-menu" data-member-results hidden>
            ${members.length
      ? members.map((member) => `
                <button type="button" data-member-option="${escapeHtml(member.id || "")}" data-search="${escapeHtml(memberSearchText(member))}">
                  <strong>${escapeHtml(member.name || "Member")}</strong>
                  <span>${escapeHtml([member.email, member.phone, member.batch ? `Batch ${member.batch}` : ""].filter(Boolean).join(" | "))}</span>
                </button>
              `).join("") + `<p data-member-empty hidden>No matching unused members found.</p>`
      : `<p>No unused members available for ${escapeHtml(session)}.</p>`}
          </div>
        </div>
        <input type="hidden" name="memberId" value="${escapeHtml(selectedMemberId || "")}">
      </label>
    `;
  }

  function committeeMemberSummary(member, person = {}) {
    if (!member) {
      const legacyName = person.name || person.email || "";
      return `
        <div class="linked-member-card wide-field">
          <strong>${escapeHtml(legacyName || "No member selected")}</strong>
          <span>${legacyName ? "Legacy committee entry. Select an approved member to link it." : "Committee entries must link to an approved member."}</span>
        </div>
      `;
    }

    return `
      <div class="linked-member-card wide-field">
        ${member.image ? `<img src="${escapeHtml(member.image)}" alt="">` : ""}
        <div>
          <strong>${escapeHtml(member.name || "Member")}</strong>
          <span>${escapeHtml([member.email, member.phone, member.batch ? `Batch ${member.batch}` : ""].filter(Boolean).join(" | "))}</span>
        </div>
      </div>
    `;
  }

  async function uploadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = String(reader.result || "").split(",")[1];
          const result = await api("/api/admin/upload", {
            method: "POST",
            body: JSON.stringify({ filename: file.name, base64 })
          });
          resolve(result.path);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function panelIntro(title, description) {
    return `
      <div class="panel-intro">
        <div>
          <span>Admin workspace</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <p>${escapeHtml(description)}</p>
      </div>
    `;
  }

  function sectionSave(label = "Save this section") {
    if (!canSaveCurrentTab()) return "";
    return `
      <div class="section-save-row">
        <button class="plain-button primary" data-save-section type="button">${escapeHtml(label)}</button>
      </div>
    `;
  }

  function adminCounts() {
    const data = state.data || {};
    return {
      pages: (data.pages || []).length,
      posts: (data.posts || []).length,
      committee: (data.committee || []).length,
      members: (data.members || []).length,
      gallery: (data.gallery || []).length,
      applications: (data.applications || []).length,
      messages: (data.messages || []).length,
      users: state.usersLoaded ? (state.users || []).filter((user) => user.user_id).length : ""
    };
  }

  function metricCards(counts) {
    return `
      <div class="admin-metrics">
        <div class="metric-card"><span>Pages</span><strong>${counts.pages}</strong></div>
        <div class="metric-card"><span>Members</span><strong>${counts.members}</strong></div>
        <div class="metric-card"><span>Posts</span><strong>${counts.posts}</strong></div>
        <div class="metric-card"><span>Inbox</span><strong>${counts.applications + counts.messages}</strong></div>
      </div>
    `;
  }

  function tabButton(id, label, count = "") {
    return `
      <button class="${state.tab === id ? "active" : ""}" data-tab="${id}" type="button">
        <span>${escapeHtml(label)}</span>
        ${count !== "" ? `<small>${escapeHtml(count)}</small>` : ""}
      </button>
    `;
  }

  function availableTabs() {
    const counts = adminCounts();
    const tabs = [
      ["dashboard", "Dashboard", ""],
      ["settings", "Settings", ""],
      ["menus", "Menus", ""],
      ["slides", "Slides", (state.data.heroSlides || []).length],
      ["pages", "Pages", counts.pages],
      ["posts", "News", counts.posts],
      ["committee", "Committee", counts.committee],
      ["members", "Members", counts.members],
      ["gallery", "Gallery", counts.gallery],
      ["applications", "Applications", counts.applications],
      ["messages", "Messages", counts.messages],
      ["users", "Users", counts.users],
      ["me", "My Profile", ""]
    ];
    return tabs.filter(([id]) => canOpenTab(id));
  }

  function adminLayout(body) {
    const counts = adminCounts();
    if (!canOpenTab(state.tab)) {
      state.tab = availableTabs()[0]?.[0] || "dashboard";
    }
    const activeTab = availableTabs().find(([id]) => id === state.tab);
    const activeLabel = activeTab?.[1] || "Dashboard";

    adminApp.innerHTML = `
      <div class="admin-frame">
        <aside class="admin-sidebar">
          <div class="admin-brand">
            <img src="/assets/forum-logo.png" alt="">
            <div>
              <strong>Forum Admin</strong>
              <span>${state.user.isAdmin ? "Super administrator" : "Assigned access"}</span>
            </div>
          </div>
          <nav class="admin-tabs" aria-label="Admin navigation">
            ${availableTabs().map(([id, label, count]) => tabButton(id, label, count)).join("")}
          </nav>
          <div class="admin-help">
            <strong>Signed in</strong>
            <span>${escapeHtml(state.user.email || "admin")}</span>
          </div>
        </aside>
        <section class="admin-workspace">
          <header class="admin-top">
            <div>
              <span class="admin-kicker">Dynamic website</span>
              <h1>${escapeHtml(state.tab === "dashboard" ? "Admin Dashboard" : activeLabel)}</h1>
              <p>Last update: ${escapeHtml(state.data.updatedAt || "")}</p>
            </div>
            <div class="admin-actions">
              <a class="plain-button" href="/" target="_blank" rel="noreferrer">View site</a>
              <button class="plain-button" id="logout" type="button">Logout</button>
            </div>
          </header>
          ${state.tab === "dashboard" ? metricCards(counts) : ""}
          <section class="admin-card">${body}<p class="admin-status" id="adminStatus" aria-live="polite"></p></section>
        </section>
      </div>
    `;

    adminApp.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", async () => {
        collectCurrentForm();
        state.tab = button.dataset.tab;
        if (state.tab === "users" && state.user.isAdmin && !state.usersLoaded) {
          state.usersLoading = true;
          renderAdmin();
          try {
            await loadUsers();
            renderAdmin();
          } catch (error) {
            renderAdmin();
            setStatus(error.message || "Users could not be loaded.", "error");
          }
          return;
        }
        renderAdmin();
      });
    });

    document.getElementById("logout").addEventListener("click", () => {
      storage.removeItem(tokenKey);
      storage.removeItem(userKey);
      state.token = null;
      state.user = {};
      state.data = null;
      state.users = [];
      state.usersLoaded = false;
      state.usersLoading = false;
      renderLogin();
    });
  }

  function renderLogin(message = "") {
    adminApp.innerHTML = `
      <section class="admin-login">
        <form class="admin-card" id="loginForm">
          <div class="admin-login-brand">
            <img src="/assets/forum-logo.png" alt="">
            <div>
              <h1>Admin login</h1>
              <p>Prakton Sikkharthi Forum</p>
            </div>
          </div>
          <div class="admin-login-fields">
            ${field("Username or email", "username", "")}
            ${field("Password", "password", "", "password")}
          </div>
          <button class="skew-button admin-submit" type="submit">Login</button>
          <span class="admin-status">${escapeHtml(message)}</span>
        </form>
      </section>
    `;

    document.getElementById("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      try {
        const result = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        state.token = result.token;
        state.user = {
          isAdmin: result.isAdmin,
          permissions: result.permissions || [],
          mustChangePassword: result.mustChangePassword
        };
        storage.setItem(tokenKey, state.token);
        storage.setItem(userKey, JSON.stringify(state.user));
        if (result.mustChangePassword) {
          renderChangePassword();
          return;
        }
        await loadAdmin();
      } catch (error) {
        renderLogin(error.message || "Invalid credentials");
      }
    });
  }

  function renderChangePassword(message = "") {
    adminApp.innerHTML = `
      <section class="admin-login">
        <form class="admin-card" id="changePassForm">
          <h1>Change password</h1>
          <p>Please set a new password before continuing.</p>
          <div class="admin-login-fields">
            ${field("New password", "newPassword", "", "password")}
            ${field("Confirm password", "confirmPassword", "", "password")}
          </div>
          <button class="skew-button admin-submit" type="submit">Update password</button>
          <span class="admin-status">${escapeHtml(message)}</span>
        </form>
      </section>
    `;

    document.getElementById("changePassForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (data.newPassword !== data.confirmPassword) {
        renderChangePassword("Passwords do not match");
        return;
      }
      try {
        await api("/api/admin/change-password", {
          method: "POST",
          body: JSON.stringify({ newPassword: data.newPassword })
        });
        await loadAdmin();
      } catch (error) {
        renderChangePassword(error.message || "Failed to update password");
      }
    });
  }

  function renderDashboard() {
    const counts = adminCounts();
    return `
      <div class="admin-dashboard-hero">
        <div>
          <span>Website control center</span>
          <h2>Manage content, members, applications, and user access.</h2>
          <p>Each editor has its own save button, so updates stay scoped to the section you are working on.</p>
        </div>
        <strong>${counts.pages + counts.posts + counts.committee + counts.members + counts.gallery}</strong>
      </div>
      <div class="dashboard-grid">
        <article class="dashboard-panel"><span>Pages</span><strong>${counts.pages}</strong><p>Includes Career and Forum pages.</p></article>
        <article class="dashboard-panel"><span>Posts</span><strong>${counts.posts}</strong><p>News, Notice, Career, and Event posts.</p></article>
        <article class="dashboard-panel"><span>Members</span><strong>${counts.members}</strong><p>Registered profiles and account links.</p></article>
        <article class="dashboard-panel"><span>Inbox</span><strong>${counts.applications + counts.messages}</strong><p>Applications and contact messages.</p></article>
        <article class="dashboard-panel"><span>Storage</span><strong>GitHub uploads</strong><p>Images upload to the configured GitHub repo and return public raw image URLs.</p></article>
      </div>
      <div class="quick-actions">
        ${availableTabs()
        .filter(([id]) => !["dashboard", "me"].includes(id))
        .map(([id, label]) => `<button class="plain-button" data-tab="${id}" type="button">${escapeHtml(label)}</button>`)
        .join("")}
      </div>
    `;
  }

  function renderSettings() {
    const settings = state.data.settings || {};
    return `
      ${panelIntro("Site settings", "Manage identity, contact details, logos, footer artwork, and notice text.")}
      <form class="admin-form" data-editor="settings">
        <div class="form-grid">
          ${field("Site name", "siteName", settings.siteName)}
          ${field("Bangla site name", "siteNameBn", settings.siteNameBn)}
          ${field("Short name", "shortName", settings.shortName)}
          ${field("Email", "email", settings.email, "email")}
          ${field("Phone", "phone", settings.phone)}
          ${field("Address", "address", settings.address)}
          ${field("Logo path", "logo", settings.logo)}
          ${field("Footer logo path", "footerLogo", settings.footerLogo)}
          ${field("Footer background", "footerBackground", settings.footerBackground)}
          ${field("Bank/contact title", "bankTitle", settings.bankTitle)}
          ${field("Home events eyebrow", "homeEventsEyebrow", settings.homeEventsEyebrow)}
          ${field("Home events title", "homeEventsTitle", settings.homeEventsTitle)}
          ${field("Home events subtitle", "homeEventsSubtitle", settings.homeEventsSubtitle)}
          ${field("Home events empty text", "homeEventsEmptyText", settings.homeEventsEmptyText)}
          ${textarea("Notice text", "noticeText", settings.noticeText)}
          ${textarea("Bank/contact lines", "bankLines", (settings.bankLines || []).join("\n"))}
        </div>
      </form>
      ${sectionSave("Save settings")}
    `;
  }

  function listRow(type, item, index, fields) {
    return `
      <div class="list-row" data-list-row="${escapeHtml(type)}" data-index="${index}">
        <div class="list-row-fields">
          ${fields.map((spec) => {
      const isImage = /image|logo|background/i.test(spec.key);
      return `
              <label class="admin-field">
                <span>${escapeHtml(spec.label)}</span>
                <div class="${isImage ? "field-with-action" : ""}">
                  <input data-list="${escapeHtml(type)}" data-index="${index}" data-key="${escapeHtml(spec.key)}" value="${escapeHtml(item[spec.key] || "")}">
                  ${isImage ? `<button class="plain-button upload-trigger" type="button">Choose</button>` : ""}
                </div>
              </label>
            `;
    }).join("")}
        </div>
        <div class="row-actions">
          <button class="plain-button" data-move-list="${escapeHtml(type)}" data-index="${index}" data-direction="-1" type="button">Up</button>
          <button class="plain-button" data-move-list="${escapeHtml(type)}" data-index="${index}" data-direction="1" type="button">Down</button>
          <button class="plain-button danger" data-remove-list="${escapeHtml(type)}" data-index="${index}" type="button">Delete</button>
        </div>
      </div>
    `;
  }

  function editableList(title, description, type, fields) {
    const items = state.data[type] || [];
    return `
      <section class="nested-panel">
        <div class="nested-panel-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>
          <button class="plain-button" data-add-list="${escapeHtml(type)}" type="button">Add item</button>
        </div>
        <div class="admin-list">
          ${items.map((item, index) => listRow(type, item, index, fields)).join("") || `<p class="empty-admin">No items yet.</p>`}
        </div>
      </section>
    `;
  }

  function renderMenus() {
    return `
      ${panelIntro("Menus", "Create, edit, reorder, and delete primary navigation and top bar links.")}
      <div class="stacked-panels">
        ${editableList("Primary navigation", "Main website menu shown in the header.", "navigation", [
      { key: "label", label: "Label" },
      { key: "path", label: "Path" }
    ])}
        ${editableList("Top links", "Secondary links shown in the top bar and footer.", "topLinks", [
      { key: "label", label: "Label" },
      { key: "path", label: "Path" }
      ])}
      </div>
      ${sectionSave("Save menus")}
    `;
  }

  function renderSlides() {
    return `
      ${panelIntro("Hero slides", "Manage the home page hero images and headline text.")}
      ${editableList("Slides", "Each slide can use an uploaded image URL or a local /assets path.", "heroSlides", [
      { key: "image", label: "Image path" },
      { key: "eyebrow", label: "Eyebrow" },
      { key: "title", label: "Title" }
    ])}
      ${sectionSave("Save slides")}
    `;
  }

  function itemLabel(item, index) {
    if (item.memberId) {
      const memberName = memberById(item.memberId)?.name || item.name || `Committee ${index + 1}`;
      return `${memberName} - ${item.role || "Member"} (${committeeSession(item)})`;
    }
    return item.title || item.name || item.label || item.key || `Item ${index + 1}`;
  }

  function selectEditor(type, selectedIndex) {
    const items = state.data[type] || [];
    if (!items.length) {
      return `<select disabled><option>No items</option></select>`;
    }
    return `
      <select data-select="${escapeHtml(type)}">
        ${items.map((item, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(itemLabel(item, index))}</option>`).join("")}
      </select>
    `;
  }

  function selectedIndex(type) {
    const items = state.data[type] || [];
    if (!items.length) return 0;
    const next = Math.min(state.selected[type] || 0, items.length - 1);
    state.selected[type] = Math.max(0, next);
    return state.selected[type];
  }

  function editorToolbar(type) {
    const index = selectedIndex(type);
    return `
      <div class="editor-toolbar">
        ${selectEditor(type, index)}
        <button class="plain-button" data-add="${escapeHtml(type)}" type="button">Add</button>
        <button class="plain-button" data-duplicate="${escapeHtml(type)}" type="button">Duplicate</button>
        <button class="plain-button danger" data-delete="${escapeHtml(type)}" type="button">Delete</button>
      </div>
    `;
  }

  function renderPages() {
    const index = selectedIndex("pages");
    const page = (state.data.pages || [])[index] || {};
    return `
      ${panelIntro("Pages", "Insert, update, and delete site pages, routes, render modes, images, downloads, and body content.")}
      ${editorToolbar("pages")}
      <form class="admin-form" data-editor="pages" data-index="${index}">
        <div class="form-grid">
          ${field("Database id", "id", page.id || "", "text", { readonly: true })}
          ${field("Key", "key", page.key)}
          ${field("Path", "path", page.path)}
          ${field("Title", "title", page.title)}
          ${field("Subtitle", "subtitle", page.subtitle || "")}
          ${selectField("Render type", "render", page.render, ["home", "about", "simple", "committee", "members", "posts", "career", "forum", "download", "gallery", "memberForm", "contact", "restricted", "account"])}
          ${field("Image path", "image", page.image || "")}
          ${field("Download label", "downloadLabel", page.downloadLabel || "")}
          ${field("Download URL", "downloadUrl", page.downloadUrl || "")}
          ${field("Post filter", "filter", page.filter || "")}
          ${textarea("Body paragraphs", "body", multiline(page.body))}
        </div>
      </form>
      ${sectionSave("Save page")}
    `;
  }

  function renderPosts() {
    const index = selectedIndex("posts");
    const post = (state.data.posts || [])[index] || {};
    return `
      ${panelIntro("News, notices, careers, and events", "Create, edit, and delete posts. Category Event posts appear in the home events section.")}
      ${editorToolbar("posts")}
      <form class="admin-form" data-editor="posts" data-index="${index}">
        <div class="form-grid">
          ${field("Database id", "id", post.id || "", "text", { readonly: true })}
          ${field("Title", "title", post.title)}
          ${field("Slug", "slug", post.slug)}
          ${field("Path", "path", post.path)}
          ${selectField("Category", "category", post.category, ["News", "Notice", "Career", "Event"])}
          ${field("Date", "date", post.date, "date")}
          ${field("Image path", "image", post.image)}
          ${textarea("Excerpt", "excerpt", post.excerpt, { wide: true })}
          ${textarea("Body paragraphs", "body", multiline(post.body))}
        </div>
      </form>
      ${sectionSave("Save post")}
    `;
  }

  function renderCommittee() {
    const index = selectedIndex("committee");
    const person = normalizeCommitteePerson((state.data.committee || [])[index] || {}, index);
    const member = memberById(person.memberId);
    return `
      ${panelIntro("Committee", "Manage committee sessions, types, active status, designation order, and member assignments.")}
      ${editorToolbar("committee")}
      <form class="admin-form" data-editor="committee" data-index="${index}">
        <div class="form-grid">
          ${field("Database id", "id", person.id || "", "text", { readonly: true })}
          ${selectField("Session", "year", person.year, committeeSessionOptions(person.year))}
          ${selectField("Status", "status", person.status, COMMITTEE_STATUS_OPTIONS)}
          ${selectField("Committee type", "type", person.type, optionsWithCurrent(COMMITTEE_TYPE_OPTIONS, person.type))}
          ${memberPicker(person)}
          ${committeeMemberSummary(member, person)}
          ${selectField("Role / designation", "role", person.role, optionsWithCurrent(COMMITTEE_ROLE_OPTIONS, person.role))}
          ${field("Designation order", "designationOrder", person.designationOrder, "number")}
          ${field("Display order", "sortOrder", person.sortOrder, "number")}
          ${field("Batch", "passingYear", person.passingYear || "")}
          ${textarea("Biography", "biography", person.biography || "")}
          ${textarea("Message", "message", person.message || "")}
        </div>
      </form>
      ${sectionSave("Save committee")}
    `;
  }

  function renderMembers() {
    const index = selectedIndex("members");
    const member = (state.data.members || [])[index] || {};
    return `
      ${panelIntro("Members", "Create, update, and delete member profiles used by the public members table and user accounts.")}
      ${editorToolbar("members")}
      <form class="admin-form" data-editor="members" data-index="${index}">
        <div class="form-grid">
          ${field("Database id", "id", member.id || "", "text", { readonly: true })}
          ${field("Name", "name", member.name)}
          ${field("Email", "email", member.email || "", "email")}
          ${field("Phone", "phone", member.phone || "")}
          ${field("Address", "address", member.address || "")}
          ${field("Batch", "batch", member.batch || "")}
          ${field("Type", "type", member.type || "")}
          ${field("Image path", "image", member.image || "")}
        </div>
      </form>
      ${sectionSave("Save member")}
    `;
  }

  function renderGallery() {
    const index = selectedIndex("gallery");
    const item = (state.data.gallery || [])[index] || {};
    return `
      ${panelIntro("Gallery", "Upload local image paths and captions for the public gallery page.")}
      ${editorToolbar("gallery")}
      <form class="admin-form" data-editor="gallery" data-index="${index}">
        <div class="form-grid">
          ${field("Database id", "id", item.id || "", "text", { readonly: true })}
          ${field("Title", "title", item.title)}
          ${field("Image path", "image", item.image)}
        </div>
      </form>
      ${sectionSave("Save gallery")}
    `;
  }

  function submissionColumns(type) {
    return type === "applications"
      ? [
        ["status", "Status"],
        ["name", "Name"],
        ["nameBn", "Bangla name"],
        ["nameEn", "English name"],
        ["email", "Email"],
        ["phone", "Phone"],
        ["mobile", "Mobile"],
        ["batch", "Batch"],
        ["memberType", "Member type"],
        ["image", "Member image"],
        ["amount", "Amount"],
        ["paymentMethod", "Payment method"],
        ["paymentMobile", "Payment number"],
        ["transactionId", "Transaction ID"],
        ["paymentDate", "Payment date"],
        ["message", "Message"]
      ]
      : [
        ["status", "Status"],
        ["name", "Name"],
        ["email", "Email"],
        ["phone", "Phone"],
        ["subject", "Subject"],
        ["message", "Message"]
      ];
  }

  function statusSelect(value) {
    const statuses = ["new", "reviewed", "approved", "rejected", "archived"];
    return `<select data-submission-field="status">${statuses.map((status) => `<option ${value === status ? "selected" : ""}>${status}</option>`).join("")}</select>`;
  }

  function renderSubmissions(type) {
    const items = state.data[type] || [];
    const columns = submissionColumns(type);
    const title = type === "applications" ? "Applications" : "Messages";
    const description = type === "applications"
      ? "Review, update, and delete membership applications."
      : "Review, update, and delete contact messages.";

    return `
      ${panelIntro(title, description)}
      <div class="table-wrap">
        <table class="members-table admin-table submission-table">
          <thead>
            <tr>
              <th>Created</th>
              ${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, index) => `
              <tr data-submission-row="${escapeHtml(type)}" data-id="${escapeHtml(item.id || "")}" data-index="${index}">
                <td>${escapeHtml(item.createdAt || item.created_at || "")}</td>
                ${columns.map(([key]) => key === "status"
        ? `<td>${statusSelect(item.status || "new")}</td>`
        : `<td><input data-submission-field="${key}" value="${escapeHtml(item[key] || "")}"></td>`
      ).join("")}
                <td class="row-action-cell">
                  <button class="plain-button" data-save-submission="${escapeHtml(type)}" type="button">Save</button>
                  ${type === "applications" ? `
                    <button class="plain-button primary" data-approve-application type="button">Approve</button>
                    <button class="plain-button" data-reject-application type="button">Reject</button>
                  ` : ""}
                  <button class="plain-button danger" data-delete-submission="${escapeHtml(type)}" type="button">Delete</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="${columns.length + 2}">No records</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function permissionChecks(permissions = [], prefix = "perm", disabled = false) {
    const normalized = normalizePermissions(permissions);
    return `
      <div class="permission-grid">
        ${PERMISSIONS.map((permission) => `
          <label class="perm-check">
            <input type="checkbox" class="${prefix}-cb" value="${escapeHtml(permission.key)}" ${normalized.has(permission.key) ? "checked" : ""} ${disabled ? "disabled" : ""}>
            <span>${escapeHtml(permission.label)}</span>
          </label>
        `).join("")}
      </div>
    `;
  }

  function userRole(user = {}) {
    if (user._role) return user._role;
    if (user.is_admin) return "admin";
    return normalizePermissions(user.permissions || []).size ? "custom" : "member";
  }

  function roleSelect(value, options = {}) {
    const disabled = options.disabled ? "disabled" : "";
    const attrs = [
      `class="role-select${options.newUser ? " new-user-role" : ""}"`,
      options.userId ? `data-user-id="${escapeHtml(options.userId)}"` : "",
      options.userKey ? `data-user-key="${escapeHtml(options.userKey)}"` : "",
      options.memberId ? `data-member-id="${escapeHtml(options.memberId)}"` : "",
      disabled
    ].filter(Boolean).join(" ");
    return `
      <select ${attrs} name="${options.newUser ? "role" : ""}">
        <option value="member" ${value === "member" ? "selected" : ""}>Normal member</option>
        <option value="custom" ${value === "custom" ? "selected" : ""}>Custom admin menu</option>
        <option value="admin" ${value === "admin" ? "selected" : ""}>Full admin</option>
      </select>
    `;
  }

  function roleHelp(role) {
    if (role === "admin") return "Can access every admin menu.";
    if (role === "custom") return "Can access only selected admin menus.";
    return "Website login only. The member can update their own profile from the member login page.";
  }

  function renderUsers() {
    if (state.usersLoading) {
      return `
        ${panelIntro("Users and permissions", "Loading users only when this tab is opened.")}
        <p class="empty-admin">Loading users...</p>
      `;
    }

    const usedMemberIds = new Set(
      (state.users || [])
        .filter((user) => user.user_id && user.member_id)
        .map((user) => String(user.member_id))
    );
    const memberOptions = (state.data.members || [])
      .filter((member) => !usedMemberIds.has(String(member.id || "")))
      .map((member) => `<option value="${escapeHtml(member.id || "")}">${escapeHtml(member.name || "Member")} ${member.email ? `(${escapeHtml(member.email)})` : ""}</option>`)
      .join("");

    const query = state.usersSearch.trim().toLowerCase();
    const filteredUsers = (state.users || []).filter((user) => {
      if (!query) return true;
      return [
        user.name,
        user.email,
        user.phone,
        user.member_id,
        user.user_id,
        user.batch,
        user.type
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
    const pageSize = Number(state.usersPageSize) || 10;
    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
    state.usersPage = Math.min(Math.max(1, Number(state.usersPage) || 1), totalPages);
    const start = (state.usersPage - 1) * pageSize;
    const visibleUsers = filteredUsers.slice(start, start + pageSize);
    const summary = filteredUsers.length
      ? `Showing ${start + 1}-${Math.min(start + pageSize, filteredUsers.length)} of ${filteredUsers.length}`
      : "No users found";

    const rows = visibleUsers.map((user, index) => {
      const hasAccount = !!user.user_id;
      const rowKey = hasAccount ? String(user.user_id) : `member-${user.member_id || index}`;
      const role = userRole(user);
      const showPermissions = role === "custom";
      const permissionsHtml = showPermissions
        ? permissionChecks(user.permissions || [], `perm-${rowKey}`, !hasAccount && role !== "custom")
          .replaceAll(`class="perm-${rowKey}-cb"`, `class="perm-cb" data-user-key="${escapeHtml(rowKey)}"`)
        : `<div class="role-note">${escapeHtml(roleHelp(role))}</div>`;
      return `
        <tr class="${hasAccount ? "" : "no-account"}" data-user-row data-user-key="${escapeHtml(rowKey)}">
          <td>
            <strong>${escapeHtml(user.name || user.email || "")}</strong>
            <small>${user.member_id ? `Member #${escapeHtml(user.member_id)}` : "Standalone user"}</small>
            ${user.phone ? `<small>${escapeHtml(user.phone)}</small>` : ""}
          </td>
          <td>
            <label class="admin-field compact-field">
              <span>Login email</span>
              <input class="email-inp" data-user-key="${escapeHtml(rowKey)}" data-user-id="${escapeHtml(user.user_id || "")}" data-member-id="${escapeHtml(user.member_id || "")}" value="${escapeHtml(user.email || "")}">
            </label>
            <label class="admin-field compact-field">
              <span>${hasAccount ? "New password" : "Initial password"}</span>
              <input class="password-inp" data-user-key="${escapeHtml(rowKey)}" type="password" placeholder="${hasAccount ? "Leave blank to keep" : "Default: phone or 12345678"}">
            </label>
            <small>${hasAccount ? `User ID: ${escapeHtml(user.user_id)}` : "Account not created yet"}</small>
          </td>
          <td>${hasAccount ? `<span class="badge badge-active">Active</span>` : `<span class="badge badge-none">No account</span>`}</td>
          <td>
            ${roleSelect(role, { userId: user.user_id || "", userKey: rowKey, memberId: user.member_id || "" })}
            <small>${escapeHtml(roleHelp(role))}</small>
          </td>
          <td>
            ${permissionsHtml}
          </td>
          <td class="row-action-cell">
            ${hasAccount
          ? `<button class="plain-button primary save-user" data-user-id="${escapeHtml(user.user_id)}" data-user-key="${escapeHtml(rowKey)}" data-member-id="${escapeHtml(user.member_id || "")}" type="button">Save user</button>
                 <button class="plain-button" data-reset-user="${escapeHtml(user.user_id)}" type="button">Reset password</button>`
          : `<button class="plain-button create-user" data-member-id="${escapeHtml(user.member_id || "")}" data-user-key="${escapeHtml(rowKey)}" type="button">Create account</button>`}
          </td>
        </tr>
      `;
    }).join("");

    return `
      ${panelIntro("Users and permissions", "Create user accounts, reset passwords, and assign permissions for each admin menu.")}
      <div class="admin-form">
        <div class="nested-panel-head">
          <div>
            <h3>Sync committee members</h3>
            <p>Create missing member/user links from committee records. Khaled becomes system administrator; everyone else stays member only.</p>
          </div>
          <button class="plain-button primary" data-sync-committee-users type="button">Sync now</button>
        </div>
      </div>
      <form class="admin-form new-user-form" id="newUserForm">
        <div class="nested-panel-head">
          <div>
            <h3>Create user</h3>
            <p>Create a standalone admin user or link the user to an existing member profile.</p>
          </div>
          <button class="plain-button primary" type="submit">Create user</button>
        </div>
        <div class="form-grid">
          <label class="admin-field">
            <span>Linked member</span>
            <select name="memberId">
              <option value="">Standalone account</option>
              ${memberOptions}
            </select>
          </label>
          ${field("Email", "email", "", "email")}
          ${field("Phone", "phone", "")}
          ${field("Initial password", "password", "", "password")}
          <label class="admin-field wide-field">
            <span>Role</span>
            ${roleSelect("member", { newUser: true })}
          </label>
          <div class="wide-field" data-new-user-permissions hidden>${permissionChecks([], "new-perm")}</div>
        </div>
      </form>
      <div class="users-toolbar">
        <label>
          <span>Search users</span>
          <input data-users-search value="${escapeHtml(state.usersSearch)}" placeholder="Name, email, phone, member ID">
        </label>
        <label>
          <span>Rows per page</span>
          <select data-users-page-size>
            ${[10, 25, 50, 100].map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`).join("")}
          </select>
        </label>
        <div class="users-pagination">
          <span>${escapeHtml(summary)}</span>
          <button class="plain-button" data-users-page="${state.usersPage - 1}" type="button" ${state.usersPage <= 1 ? "disabled" : ""}>Prev</button>
          <button class="plain-button" data-users-page="${state.usersPage + 1}" type="button" ${state.usersPage >= totalPages ? "disabled" : ""}>Next</button>
        </div>
      </div>
      <div class="table-wrap users-wrap">
        <table class="members-table admin-table users-table">
          <thead>
            <tr><th>Member</th><th>Login</th><th>Status</th><th>Role</th><th>Permissions</th><th>Actions</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">No users or members found.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  function renderMe() {
    const member = (state.data.members || []).find((item) => String(item.id) === String(state.user.member_id));
    if (!member) {
      return `
        ${panelIntro("My profile", "This account is not linked to a member profile.")}
        <p class="empty-admin">Ask a super administrator to link this user to a member record.</p>
      `;
    }

    return `
      ${panelIntro("My profile", "Update the member information linked to your user account.")}
      <form class="admin-form" id="meForm">
        <div class="form-grid">
          ${field("Name", "name", member.name)}
          ${field("Email", "email", member.email || "", "email")}
          ${field("Phone", "phone", member.phone || "")}
          ${field("Address", "address", member.address || "")}
          ${field("Batch", "batch", member.batch || "")}
          ${field("Type", "type", member.type || "")}
          ${field("Image path", "image", member.image || "")}
        </div>
        <button class="skew-button admin-submit" type="submit">Update profile</button>
      </form>
    `;
  }

  function collectCurrentForm(form = adminApp.querySelector("[data-editor]")) {
    if (!form) return;

    const editor = form.dataset.editor;
    const values = Object.fromEntries(new FormData(form).entries());

    if (editor === "settings") {
      state.data.settings = {
        ...state.data.settings,
        ...values,
        bankLines: String(values.bankLines || "").split("\n").map((line) => line.trim()).filter(Boolean)
      };
      return;
    }

    const index = Number(form.dataset.index);
    if (!Number.isInteger(index) || index < 0 || !state.data[editor] || !state.data[editor][index]) return;

    const next = { ...state.data[editor][index], ...values };
    if (editor === "pages" || editor === "posts") {
      next.body = splitParagraphs(values.body);
      if (editor === "posts") {
        next.slug = values.slug || slugify(values.title, "post");
        next.path = normalizePath(values.path || next.slug);
      }
    }
    if (editor === "committee") {
      const member = memberById(values.memberId);
      next.memberId = values.memberId || "";
      next.type = committeeTypeValue(values.type);
      next.status = String(values.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
      next.year = values.year || "2026-2027";
      next.designationOrder = Number.isFinite(Number(values.designationOrder))
        ? Number(values.designationOrder)
        : committeeRoleOrder(values.role);
      next.sortOrder = Number.isFinite(Number(values.sortOrder)) ? Number(values.sortOrder) : index;
      if (member) {
        next.passingYear = values.passingYear || member.batch || "";
      }
    }
    state.data[editor][index] = next;
  }

  function templateFor(type) {
    const now = Date.now();
    if (type === "navigation") return { label: "New menu", path: "/new-page/" };
    if (type === "topLinks") return { label: "New link", path: "/new-link/" };
    if (type === "heroSlides") return { image: "/assets/forum-logo.png", eyebrow: "Welcome", title: "New slide" };
    if (type === "pages") return { key: `page-${now}`, path: `/page-${now}/`, title: "New page", subtitle: "", render: "simple", image: "", body: [""] };
    if (type === "posts") return { slug: `post-${now}`, path: `/post-${now}/`, title: "New post", category: "News", date: today(), image: "/assets/forum-logo.png", excerpt: "", body: [""] };
    if (type === "committee") {
      const session = committeeSessionOptions()[0] || "2026-2027";
      return { memberId: "", role: "সদস্য", type: "আহবায়ক কমিটি", status: "active", year: session, designationOrder: 100, sortOrder: (state.data.committee || []).length, passingYear: "", biography: "", message: "" };
    }
    if (type === "members") return { name: "New member", email: "", phone: "", address: "", batch: "", type: "General", image: "" };
    if (type === "gallery") return { title: "Gallery image", image: "/assets/forum-logo.png" };
    return {};
  }

  function moveItem(list, index, direction) {
    const items = state.data[list] || [];
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  }

  function bindAdmin() {
    adminApp.querySelectorAll("[data-select]").forEach((select) => {
      select.addEventListener("change", () => {
        collectCurrentForm();
        state.selected[select.dataset.select] = Number(select.value);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-list]").forEach((input) => {
      input.addEventListener("input", () => {
        const items = state.data[input.dataset.list] || [];
        const item = items[Number(input.dataset.index)];
        if (item) item[input.dataset.key] = input.value;
      });
    });

    adminApp.querySelectorAll("[data-member-picker]").forEach((picker) => {
      const input = picker.querySelector("[data-member-search]");
      const menu = picker.querySelector("[data-member-results]");
      const options = [...picker.querySelectorAll("[data-member-option]")];

      const updateResults = () => {
        const query = input.value.trim().toLowerCase();
        let visibleCount = 0;
        options.forEach((option) => {
          const visible = !query || (option.dataset.search || "").includes(query);
          option.hidden = !visible;
          if (visible) visibleCount += 1;
        });
        const empty = menu.querySelector("[data-member-empty]");
        if (empty) empty.hidden = visibleCount > 0;
        menu.hidden = false;
      };

      input.addEventListener("focus", updateResults);
      input.addEventListener("input", updateResults);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") menu.hidden = true;
      });

      options.forEach((option) => {
        option.addEventListener("click", () => {
          const form = picker.closest("form");
          const hidden = form?.querySelector("input[name='memberId']");
          const member = memberById(option.dataset.memberOption);
          if (!member || !hidden) return;
          hidden.value = member.id || "";
          input.value = "";
          collectCurrentForm(form);
          renderAdmin();
          setStatus(`${member.name || "Member"} selected for committee.`, "success");
        });
      });
    });

    adminApp.querySelectorAll('form[data-editor="committee"] select[name="year"], form[data-editor="committee"] select[name="type"], form[data-editor="committee"] select[name="status"]').forEach((select) => {
      select.addEventListener("change", () => {
        collectCurrentForm(select.closest("form"));
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-add-list]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.addList;
        state.data[type] = state.data[type] || [];
        state.data[type].push(templateFor(type));
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-remove-list]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.removeList;
        state.data[type].splice(Number(button.dataset.index), 1);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-move-list]").forEach((button) => {
      button.addEventListener("click", () => {
        moveItem(button.dataset.moveList, Number(button.dataset.index), Number(button.dataset.direction));
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.add;
        state.data[type] = state.data[type] || [];
        state.data[type].push(templateFor(type));
        state.selected[type] = state.data[type].length - 1;
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-duplicate]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.duplicate;
        const index = selectedIndex(type);
        const copy = JSON.parse(JSON.stringify(state.data[type][index] || templateFor(type)));
        delete copy.id;
        if (copy.title) copy.title = `${copy.title} copy`;
        if (copy.key) copy.key = `${copy.key}-${Date.now()}`;
        if (copy.slug) copy.slug = `${copy.slug}-${Date.now()}`;
        if (copy.path) copy.path = normalizePath(`${copy.path.replace(/\/$/, "")}-${Date.now()}`);
        state.data[type].splice(index + 1, 0, copy);
        state.selected[type] = index + 1;
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.delete;
        const index = selectedIndex(type);
        if (!state.data[type]?.length) return;
        state.data[type].splice(index, 1);
        state.selected[type] = Math.max(0, index - 1);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll(".upload-trigger").forEach((button) => {
      button.addEventListener("click", () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.onchange = async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          setStatus("Uploading image...");
          try {
            const assetPath = await uploadImage(file);
            const target = button.parentNode.querySelector("input");
            target.value = assetPath;
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
            setStatus(`Uploaded to ${assetPath}. Use this section's save button to publish the path.`, "success");
          } catch (error) {
            setStatus(error.message || "Upload failed.", "error");
          }
        };
        fileInput.click();
      });
    });

    adminApp.querySelectorAll("[data-save-submission]").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest("[data-submission-row]");
        const type = button.dataset.saveSubmission;
        const id = row.dataset.id;
        const payload = {};
        row.querySelectorAll("[data-submission-field]").forEach((input) => {
          payload[input.dataset.submissionField] = input.value;
        });
        setStatus("Saving submission...");
        try {
          await api(`/api/admin/${type}/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });
          const item = state.data[type][Number(row.dataset.index)];
          Object.assign(item, payload);
          setStatus("Submission saved.", "success");
        } catch (error) {
          setStatus(error.message || "Submission save failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll("[data-approve-application]").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest("[data-submission-row]");
        const id = row.dataset.id;
        setStatus("Approving application...");
        try {
          const result = await api(`/api/admin/applications/${encodeURIComponent(id)}/approve`, { method: "POST" });
          state.data = await api("/api/admin/site");
          if (state.user.isAdmin) state.users = await api("/api/admin/users");
          renderAdmin();
          const passwordText = result.initialPassword ? ` Initial password: ${result.initialPassword}.` : "";
          const mailText = result.mail?.sent ? " Confirmation email sent." : ` Confirmation email not sent (${result.mail?.skipped || result.mail?.error || "not configured"}).`;
          setStatus(`Application approved.${passwordText}${mailText}`, result.mail?.sent ? "success" : "info");
        } catch (error) {
          setStatus(error.message || "Approval failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll("[data-reject-application]").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest("[data-submission-row]");
        const id = row.dataset.id;
        setStatus("Rejecting application...");
        try {
          await api(`/api/admin/applications/${encodeURIComponent(id)}/reject`, { method: "POST" });
          state.data = await api("/api/admin/site");
          renderAdmin();
          setStatus("Application rejected.", "success");
        } catch (error) {
          setStatus(error.message || "Reject failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll("[data-delete-submission]").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest("[data-submission-row]");
        const type = button.dataset.deleteSubmission;
        const id = row.dataset.id;
        setStatus("Deleting submission...");
        try {
          await api(`/api/admin/${type}/${encodeURIComponent(id)}`, { method: "DELETE" });
          state.data[type].splice(Number(row.dataset.index), 1);
          renderAdmin();
        } catch (error) {
          setStatus(error.message || "Delete failed.", "error");
        }
      });
    });

    const meForm = adminApp.querySelector("#meForm");
    if (meForm) {
      meForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(meForm).entries());
        setStatus("Updating profile...");
        try {
          await api("/api/admin/me", { method: "PUT", body: JSON.stringify(payload) });
          const member = state.data.members.find((item) => String(item.id) === String(state.user.member_id));
          if (member) Object.assign(member, payload);
          setStatus("Profile updated.", "success");
        } catch (error) {
          setStatus(error.message || "Profile update failed.", "error");
        }
      });
    }

    adminApp.querySelectorAll("[data-sync-committee-users]").forEach((button) => {
      button.addEventListener("click", async () => {
        setStatus("Syncing committee members and users...");
        try {
          const result = await api("/api/admin/users/sync-committee", { method: "POST" });
          state.data = await api("/api/admin/site");
          await loadUsers(true);
          renderAdmin();
          setStatus(
            `Sync complete. Members created: ${result.membersCreated || 0}, users created: ${result.usersCreated || 0}, Khaled admins: ${(result.khaledAdmins || []).length}.`,
            "success"
          );
        } catch (error) {
          setStatus(error.message || "Sync failed.", "error");
        }
      });
    });

    const usersSearch = adminApp.querySelector("[data-users-search]");
    if (usersSearch) {
      usersSearch.addEventListener("input", () => {
        state.usersSearch = usersSearch.value;
        state.usersPage = 1;
        renderAdmin();
      });
    }

    const usersPageSize = adminApp.querySelector("[data-users-page-size]");
    if (usersPageSize) {
      usersPageSize.addEventListener("change", () => {
        state.usersPageSize = Number(usersPageSize.value) || 10;
        state.usersPage = 1;
        renderAdmin();
      });
    }

    adminApp.querySelectorAll("[data-users-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.usersPage = Number(button.dataset.usersPage) || 1;
        renderAdmin();
      });
    });

    adminApp.querySelectorAll(".role-select:not(.new-user-role)").forEach((select) => {
      select.addEventListener("change", () => {
        const userKey = select.dataset.userKey;
        const user = state.users.find((item) => String(item.user_id || `member-${item.member_id || ""}`) === String(userKey));
        if (user) {
          user._role = select.value;
          user.is_admin = select.value === "admin" ? 1 : 0;
          if (select.value !== "custom") user.permissions = [];
        }
        renderAdmin();
      });
    });

    const newUserForm = adminApp.querySelector("#newUserForm");
    if (newUserForm) {
      const newUserRole = newUserForm.querySelector(".new-user-role");
      const newUserPermissions = newUserForm.querySelector("[data-new-user-permissions]");
      if (newUserRole && newUserPermissions) {
        newUserRole.addEventListener("change", () => {
          newUserPermissions.hidden = newUserRole.value !== "custom";
        });
      }

      newUserForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(newUserForm).entries());
        const role = payload.role || "member";
        payload.permissions = role === "custom"
          ? [...newUserForm.querySelectorAll(".new-perm-cb:checked")].map((input) => input.value)
          : [];
        payload.isAdmin = role === "admin";
        if (role === "custom" && !payload.permissions.length) {
          setStatus("Select at least one admin menu for a custom admin user.", "error");
          return;
        }
        setStatus("Creating user...");
        try {
          const result = await api("/api/admin/users/create", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          await loadUsers(true);
          renderAdmin();
          setStatus(`User created. Initial password: ${result.initialPassword || payload.password || payload.phone || "12345678"}`, "success");
        } catch (error) {
          setStatus(error.message || "User create failed.", "error");
        }
      });
    }

    adminApp.querySelectorAll(".create-user").forEach((button) => {
      button.addEventListener("click", async () => {
        const memberId = button.dataset.memberId;
        const userKey = button.dataset.userKey;
        const emailInput = adminApp.querySelector(`.email-inp[data-user-key="${CSS.escape(userKey)}"]`);
        const passwordInput = adminApp.querySelector(`.password-inp[data-user-key="${CSS.escape(userKey)}"]`);
        const role = adminApp.querySelector(`.role-select[data-user-key="${CSS.escape(userKey)}"]`)?.value || "member";
        const permissions = role === "custom"
          ? [...adminApp.querySelectorAll(`.perm-cb[data-user-key="${CSS.escape(userKey)}"]:checked`)].map((input) => input.value)
          : [];
        if (role === "custom" && !permissions.length) {
          setStatus("Select at least one admin menu before creating a custom admin account.", "error");
          return;
        }
        const row = state.users.find((user) => String(user.member_id || "") === String(memberId || ""));
        const email = emailInput ? emailInput.value.trim() : "";
        if (!email) {
          setStatus("Enter an email address before creating the account.", "error");
          return;
        }
        setStatus("Creating account...");
        try {
          const result = await api("/api/admin/users/create", {
            method: "POST",
            body: JSON.stringify({
              memberId,
              email,
              phone: row?.phone || "",
              password: passwordInput?.value || "",
              permissions,
              isAdmin: role === "admin"
            })
          });
          await loadUsers(true);
          renderAdmin();
          setStatus(`Account created. Initial password: ${result.initialPassword || passwordInput?.value || row?.phone || "12345678"}`, "success");
        } catch (error) {
          setStatus(error.message || "Account create failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll(".save-user").forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.userId;
        const userKey = button.dataset.userKey;
        const memberId = button.dataset.memberId;
        const email = adminApp.querySelector(`.email-inp[data-user-key="${CSS.escape(userKey)}"]`)?.value.trim() || "";
        const password = adminApp.querySelector(`.password-inp[data-user-key="${CSS.escape(userKey)}"]`)?.value || "";
        const role = adminApp.querySelector(`.role-select[data-user-key="${CSS.escape(userKey)}"]`)?.value || "member";
        const permissions = role === "custom"
          ? [...adminApp.querySelectorAll(`.perm-cb[data-user-key="${CSS.escape(userKey)}"]:checked`)].map((input) => input.value)
          : [];
        const isAdmin = role === "admin";
        if (role === "custom" && !permissions.length) {
          setStatus("Select at least one admin menu before saving a custom admin user.", "error");
          return;
        }
        setStatus("Saving user...");
        try {
          await api("/api/admin/users/account", {
            method: "POST",
            body: JSON.stringify({ userId, memberId, email, password })
          });
          await api("/api/admin/users/permissions", {
            method: "POST",
            body: JSON.stringify({ userId, permissions, isAdmin })
          });
          const user = state.users.find((item) => String(item.user_id) === String(userId));
          if (user) {
            user.email = email;
            user.permissions = permissions;
            user.is_admin = isAdmin ? 1 : 0;
            user._role = role;
          }
          const member = (state.data.members || []).find((item) => String(item.id || "") === String(memberId || ""));
          if (member && email) member.email = email;
          await loadUsers(true);
          renderAdmin();
          setStatus("User saved.", "success");
        } catch (error) {
          setStatus(error.message || "User save failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll("[data-reset-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        setStatus("Resetting password...");
        try {
          await api("/api/admin/users/reset-password", {
            method: "POST",
            body: JSON.stringify({ userId: button.dataset.resetUser })
          });
          setStatus("Password reset. User must change it on next login.", "success");
        } catch (error) {
          setStatus(error.message || "Password reset failed.", "error");
        }
      });
    });

    adminApp.querySelectorAll("[data-save-section]").forEach((button) => {
      button.addEventListener("click", save);
    });
  }

  function renderAdmin() {
    let body = "";
    if (state.tab === "dashboard") body = renderDashboard();
    if (state.tab === "settings") body = renderSettings();
    if (state.tab === "menus") body = renderMenus();
    if (state.tab === "slides") body = renderSlides();
    if (state.tab === "pages") body = renderPages();
    if (state.tab === "posts") body = renderPosts();
    if (state.tab === "committee") body = renderCommittee();
    if (state.tab === "members") body = renderMembers();
    if (state.tab === "gallery") body = renderGallery();
    if (state.tab === "applications") body = renderSubmissions("applications");
    if (state.tab === "messages") body = renderSubmissions("messages");
    if (state.tab === "users") body = renderUsers();
    if (state.tab === "me") body = renderMe();
    adminLayout(body);
    bindAdmin();
  }

  async function save() {
    if (!canSaveCurrentTab()) {
      setStatus("You do not have permission to save this section.", "error");
      return;
    }
    collectCurrentForm();
    setStatus("Saving changes...");
    try {
      const result = await api("/api/admin/site", {
        method: "PUT",
        body: JSON.stringify(payloadForCurrentTab()),
        timeoutMs: 600000
      });
      state.data.updatedAt = result.updatedAt;
      setStatus("Changes saved.", "success");
    } catch (error) {
      setStatus(error.message || "Save failed.", "error");
    }
  }

  function payloadForCurrentTab() {
    if (state.tab === "settings") return { settings: state.data.settings };
    if (state.tab === "menus") return { navigation: state.data.navigation, topLinks: state.data.topLinks };
    if (state.tab === "slides") return { heroSlides: state.data.heroSlides };
    if (["pages", "posts", "committee", "members", "gallery"].includes(state.tab)) {
      return { [state.tab]: state.data[state.tab] };
    }
    return {};
  }

  async function loadAdmin() {
    try {
      const me = await api("/api/admin/whoami");
      state.user = me;
      storage.setItem(userKey, JSON.stringify(state.user));

      if (me.mustChangePassword) {
        renderChangePassword();
        return;
      }

      state.data = await api("/api/admin/site");
      if (!state.data.navigation) state.data.navigation = [];
      if (!state.data.topLinks) state.data.topLinks = [];
      if (!state.data.heroSlides) state.data.heroSlides = [];
      if (!state.data.pages) state.data.pages = [];
      if (!state.data.posts) state.data.posts = [];
      if (!state.data.committee) state.data.committee = [];
      normalizeCommitteeList();
      if (!state.data.members) state.data.members = [];
      if (!state.data.gallery) state.data.gallery = [];
      if (!state.data.applications) state.data.applications = [];
      if (!state.data.messages) state.data.messages = [];

      state.users = [];
      state.usersLoaded = false;
      state.usersLoading = false;

      if (!canOpenTab(state.tab)) {
        state.tab = availableTabs()[0]?.[0] || "dashboard";
      }
      renderAdmin();
    } catch (error) {
      console.error(error);
      renderLogin(error.message || "Please login again");
    }
  }

  if (state.token) {
    loadAdmin();
  } else {
    renderLogin();
  }

  setTimeout(() => {
    const stuck = adminApp.textContent && adminApp.textContent.trim() === "লোড হচ্ছে...";
    if (stuck) renderLogin("Admin could not finish loading. Please login again.");
  }, 6000);
})();
