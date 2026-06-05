(function () {
  const adminApp = document.getElementById("adminApp");
  const tokenKey = "alumniAdminToken";
  const state = {
    token: localStorage.getItem(tokenKey),
    user: JSON.parse(localStorage.getItem("alumniUser") || "{}"),
    data: null,
    users: [],
    tab: "settings",
    selected: {
      pages: 0,
      posts: 0,
      committee: 0,
      members: 0,
      gallery: 0
    }
  };

  function hasPerm(p) {
    if (state.user.isAdmin) return true;
    return Array.isArray(state.user.permissions) && state.user.permissions.includes(p);
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const multiline = (items = []) => items.join("\n\n");
  const splitLines = (value) => String(value || "").split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem(tokenKey);
        state.token = null;
        renderLogin("Session expired");
      }
      throw new Error("Request failed");
    }
    return response.json();
  }

  function field(label, name, value = "", type = "text") {
    const isImage = name.toLowerCase().includes("image") || name.toLowerCase().includes("logo");
    return `
      <label>
        ${escapeHtml(label)}
        <div class="field-with-action">
          <input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value)}">
          ${isImage ? `<button class="upload-trigger" type="button" data-for="${escapeHtml(name)}">Upload</button>` : ""}
        </div>
      </label>
    `;
  }

  async function uploadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = reader.result.split(",")[1];
        try {
          const result = await api("/api/admin/upload", {
            method: "POST",
            body: JSON.stringify({ filename: file.name, base64 })
          });
          resolve(result.path);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
    });
  }

  function textarea(label, name, value = "") {
    return `<label class="wide-field">${escapeHtml(label)}<textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea></label>`;
  }

  function selectEditor(name, items, selectedIndex) {
    return `
      <select data-select="${escapeHtml(name)}">
        ${items.map((item, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(item.title || item.name || item.label || `Item ${index + 1}`)}</option>`).join("")}
      </select>
    `;
  }

  function renderLogin(message = "") {
    adminApp.innerHTML = `
      <section class="admin-login">
        <form class="admin-card" id="loginForm">
          <div class="admin-login-brand">
            <img src="/assets/forum-logo.png" alt="প্রাক্তন শিক্ষার্থী ফোরাম">
            <div>
              <h1>Admin Panel</h1>
              <p>প্রাক্তন শিক্ষার্থী ফোরাম</p>
            </div>
          </div>
          <div class="admin-login-fields">
            ${field("Username", "username", "admin")}
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
          permissions: result.permissions,
          mustChangePassword: result.mustChangePassword
        };
        localStorage.setItem(tokenKey, state.token);
        localStorage.setItem("alumniUser", JSON.stringify(state.user));

        if (result.mustChangePassword) {
          renderChangePassword();
        } else {
          await loadAdmin();
        }
      } catch {
        renderLogin("Invalid credentials");
      }
    });
  }

  function renderChangePassword(message = "") {
    adminApp.innerHTML = `
      <section class="admin-login">
        <form class="admin-card" id="changePassForm">
          <h1>Change Password</h1>
          <p>Please set a new password for your first login.</p>
          <div class="admin-login-fields">
            ${field("New Password", "newPassword", "", "password")}
            ${field("Confirm Password", "confirmPassword", "", "password")}
          </div>
          <button class="skew-button admin-submit" type="submit">Update Password</button>
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
        state.user.mustChangePassword = false;
        localStorage.setItem("alumniUser", JSON.stringify(state.user));
        await loadAdmin();
      } catch {
        renderChangePassword("Failed to update password");
      }
    });
  }

  function tabButton(id, label, count = "") {
    return `
      <button class="${state.tab === id ? "active" : ""}" data-tab="${id}" type="button">
        <span>${label}</span>
        ${count !== "" ? `<small>${escapeHtml(count)}</small>` : ""}
      </button>
    `;
  }

  function adminCounts() {
    return {
      pages: state.data.pages.length,
      posts: state.data.posts.length,
      committee: state.data.committee.length,
      members: state.data.members.length,
      gallery: state.data.gallery.length,
      applications: (state.data.applications || []).length,
      messages: (state.data.messages || []).length
    };
  }

  function metricCards(counts) {
    return `
      <div class="admin-metrics">
        <div class="metric-card"><span>Pages</span><strong>${counts.pages}</strong></div>
        <div class="metric-card"><span>Committee</span><strong>${counts.committee}</strong></div>
        <div class="metric-card"><span>Members</span><strong>${counts.members}</strong></div>
        <div class="metric-card"><span>Inbox</span><strong>${counts.applications + counts.messages}</strong></div>
      </div>
    `;
  }

  function panelIntro(title, description) {
    return `
      <div class="panel-intro">
        <div>
          <span>Content Manager</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <p>${escapeHtml(description)}</p>
      </div>
    `;
  }

  function adminLayout(body) {
    const counts = adminCounts();
    adminApp.innerHTML = `
      <div class="admin-frame">
        <aside class="admin-sidebar">
          <div class="admin-brand">
            <img src="/assets/forum-logo.png" alt="প্রাক্তন শিক্ষার্থী ফোরাম">
            <div>
              <strong>Forum Admin</strong>
              <span>Website control</span>
            </div>
          </div>
          <nav class="admin-tabs" aria-label="Admin navigation">
            ${(state.user.isAdmin || hasPerm("edit_any")) ? tabButton("settings", "Settings") : ""}
            ${(state.user.isAdmin || hasPerm("edit_any")) ? tabButton("pages", "Pages", counts.pages) : ""}
            ${(state.user.isAdmin || hasPerm("add_post") || hasPerm("edit_any")) ? tabButton("posts", "News", counts.posts) : ""}
            ${(state.user.isAdmin || hasPerm("edit_any")) ? tabButton("committee", "Committee", counts.committee) : ""}
            ${(state.user.isAdmin || hasPerm("add_member") || hasPerm("edit_any")) ? tabButton("members", "Members", counts.members) : ""}
            ${(state.user.isAdmin || hasPerm("edit_any")) ? tabButton("gallery", "Gallery", counts.gallery) : ""}
            ${(state.user.isAdmin || hasPerm("view_submissions")) ? tabButton("applications", "Applications", counts.applications) : ""}
            ${(state.user.isAdmin || hasPerm("view_submissions")) ? tabButton("messages", "Messages", counts.messages) : ""}
            ${state.user.isAdmin ? tabButton("users", "Admin") : ""}
            ${tabButton("me", "My Profile")}
          </nav>
          <div class="admin-help">
            <strong>Tip</strong>
            <span>Save after editing any tab to publish changes.</span>
          </div>
        </aside>
        <section class="admin-workspace">
          <header class="admin-top">
            <div>
              <span class="admin-kicker">Dynamic Website</span>
              <h1>Admin Panel</h1>
              <p>Last update: ${escapeHtml(state.data.updatedAt || "")}</p>
            </div>
            <div class="admin-actions">
              <a class="plain-button" href="/" target="_blank">View Site</a>
              <button class="plain-button primary" id="saveAll" type="button">Save Changes</button>
              <button class="plain-button" id="logout" type="button">Logout</button>
            </div>
          </header>
          ${metricCards(counts)}
          <section class="admin-card">${body}<p class="admin-status" id="adminStatus"></p></section>
        </section>
      </div>
    `;
    adminApp.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        state.tab = button.dataset.tab;
        renderAdmin();
      });
    });
    document.getElementById("saveAll").addEventListener("click", save);
    document.getElementById("logout").addEventListener("click", () => {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem("alumniUser");
      state.token = null;
      state.user = {};
      renderLogin();
    });
  }

  function hasPerm(p) {
    if (state.user.isAdmin) return true;
    return Array.isArray(state.user.permissions) && state.user.permissions.includes(p);
  }

  function renderMe() {
    // Find the member record for the current user
    const member = state.data.members.find(m => m.id === state.user.member_id) || {};
    return `
      ${panelIntro("My Profile", "Update your own information as it appears in the members list.")}
      <form class="admin-form" id="meForm">
        <div class="form-grid">
          ${field("Name", "name", member.name)}
          ${field("Email", "email", member.email)}
          ${field("Phone", "phone", member.phone)}
          ${field("Address", "address", member.address)}
          ${field("Batch", "batch", member.batch)}
          ${field("Type", "type", member.type)}
        </div>
        <button class="skew-button admin-submit" type="submit" style="margin-top: 2rem">Update My Info</button>
      </form>
    `;
    // Event listener for meForm will be in bindAdmin
  }

  function renderUsers() {
    const PERMISSIONS = [
      { key: "add_member", label: "Add Member" },
      { key: "add_post", label: "Add News/Notice" },
      { key: "upload_image", label: "Upload Images" },
      { key: "view_submissions", label: "View Applications" },
      { key: "edit_any", label: "Edit Everything" }
    ];

    const rows = state.users.map(u => {
      const hasAccount = !!u.user_id;
      const permChecks = PERMISSIONS.map(p => `
        <label class="perm-check">
          <input type="checkbox" class="perm-cb"
            data-member-id="${escapeHtml(String(u.member_id))}"
            data-user-id="${escapeHtml(u.user_id || '')}"
            data-perm="${p.key}"
            ${hasAccount && u.permissions.includes(p.key) ? "checked" : ""}
            ${!hasAccount ? "disabled" : ""}>
          ${p.label}
        </label>`).join("");

      return `
        <tr class="${hasAccount ? "" : "no-account"}">
          <td><strong>${escapeHtml(u.name || "")}</strong></td>
          <td>
            <input class="email-inp" data-member-id="${escapeHtml(String(u.member_id))}" type="email" placeholder="Email" value="${escapeHtml(u.email || "")}" style="width:100%">
          </td>
          <td>${escapeHtml(u.phone || "—")}</td>
          <td>${hasAccount
          ? `<span class="badge badge-active">✔ Active</span>`
          : `<span class="badge badge-none">✗ No Account</span>`}
          </td>
          <td class="perm-checks">${permChecks}</td>
          <td>
            ${!hasAccount
          ? `<button class="plain-button create-user" data-member-id="${escapeHtml(String(u.member_id))}">Create Account</button>`
          : `<button class="plain-button save-perms" data-user-id="${escapeHtml(u.user_id)}" data-member-id="${escapeHtml(String(u.member_id))}">Save Perms</button>
                 <button class="plain-button" style="margin-top:4px" data-reset-user="${escapeHtml(u.user_id)}">Reset Pass</button>`
        }
          </td>
        </tr>`;
    });

    return `
      ${panelIntro("User Management", "Create accounts for members and assign permissions like Django admin.")}
      <style>
        .no-account { opacity: 0.7; background: #fafaf7; }
        .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
        .badge-active { background: #d4edda; color: #155724; }
        .badge-none { background: #f8d7da; color: #721c24; }
        .perm-checks { display: flex; flex-direction: column; gap: 4px; }
        .perm-check { display: flex; align-items: center; gap: 6px; font-size: 0.85em; cursor: pointer; }
        .admin-table td { vertical-align: middle; padding: 10px 8px; }
        .email-inp { border: 1px solid #ddd; border-radius: 4px; padding: 4px 6px; }
      </style>
      <div class="table-wrap" style="overflow-x:auto">
        <table class="members-table admin-table" style="min-width:900px">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Permissions</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  function renderSettings() {
    const settings = state.data.settings;
    return `
      ${panelIntro("Site Settings", "Update identity, contact details, logos, bank information, and the notice ticker.")}
      <form class="admin-form" data-editor="settings">
        <div class="form-grid">
          ${field("Site Name", "siteName", settings.siteName)}
          ${field("Bangla Site Name", "siteNameBn", settings.siteNameBn)}
          ${field("Short Name", "shortName", settings.shortName)}
          ${field("Email", "email", settings.email)}
          ${field("Phone", "phone", settings.phone)}
          ${field("Address", "address", settings.address)}
          ${field("Logo URL", "logo", settings.logo)}
          ${field("Footer Logo URL", "footerLogo", settings.footerLogo)}
          ${field("Footer Background URL", "footerBackground", settings.footerBackground)}
          ${field("Bank Title", "bankTitle", settings.bankTitle)}
          ${textarea("Notice Text", "noticeText", settings.noticeText)}
          ${textarea("Bank Lines", "bankLines", settings.bankLines.join("\n"))}
        </div>
      </form>
    `;
  }

  function renderPages() {
    const index = Math.min(state.selected.pages, state.data.pages.length - 1);
    const page = state.data.pages[index] || {};
    return `
      ${panelIntro("Pages", "Edit page titles, routes, content paragraphs, images, and page-specific display options.")}
      <div class="editor-toolbar">
        ${selectEditor("pages", state.data.pages, index)}
      </div>
      <form class="admin-form" data-editor="pages" data-index="${index}">
        <div class="form-grid">
          ${field("Key", "key", page.key)}
          ${field("Path", "path", page.path)}
          ${field("Title", "title", page.title)}
          ${field("Subtitle", "subtitle", page.subtitle || "")}
          ${field("Render Type", "render", page.render)}
          ${field("Image", "image", page.image || "")}
          ${field("Download Label", "downloadLabel", page.downloadLabel || "")}
          ${field("Download URL", "downloadUrl", page.downloadUrl || "")}
          ${field("Post Filter", "filter", page.filter || "")}
          ${textarea("Body Paragraphs", "body", multiline(page.body))}
        </div>
      </form>
    `;
  }

  function renderPosts() {
    const index = Math.min(state.selected.posts, state.data.posts.length - 1);
    const post = state.data.posts[index] || {};
    return `
      ${panelIntro("News & Notice", "Create and edit news or notice posts that appear on the public listing pages.")}
      <div class="editor-toolbar">
        ${selectEditor("posts", state.data.posts, index)}
        <button class="plain-button" data-add="posts" type="button">Add</button>
        <button class="plain-button danger" data-delete="posts" type="button">Delete</button>
      </div>
      <form class="admin-form" data-editor="posts" data-index="${index}">
        <div class="form-grid">
          ${field("Title", "title", post.title)}
          ${field("ID", "id", post.id)}
          ${field("Slug", "slug", post.slug)}
          ${field("Path", "path", post.path)}
          ${field("Category", "category", post.category)}
          ${field("Date", "date", post.date, "date")}
          ${field("Image", "image", post.image)}
          ${textarea("Excerpt", "excerpt", post.excerpt)}
          ${textarea("Body Paragraphs", "body", multiline(post.body))}
        </div>
      </form>
    `;
  }

  function renderCommittee() {
    const index = Math.min(state.selected.committee, state.data.committee.length - 1);
    const person = state.data.committee[index] || {};
    return `
      ${panelIntro("Committee", "Add members for any year. The public committee page automatically filters by this year field.")}
      <div class="editor-toolbar">
        ${selectEditor("committee", state.data.committee, index)}
        <button class="plain-button" data-add="committee" type="button">Add</button>
        <button class="plain-button danger" data-delete="committee" type="button">Delete</button>
      </div>
      <form class="admin-form" data-editor="committee" data-index="${index}">
        <div class="form-grid">
          ${field("Name", "name", person.name)}
          ${field("Role", "role", person.role)}
          ${field("Year", "year", person.year || "২০২২")}
          ${field("Batch", "passingYear", person.passingYear || "")}
          ${field("Mobile", "phone", person.phone || "")}
          ${field("Image", "image", person.image)}
        </div>
      </form>
    `;
  }

  function renderMembers() {
    const index = Math.min(state.selected.members, state.data.members.length - 1);
    const member = state.data.members[index] || {};
    return `
      ${panelIntro("Forum Members", "Maintain the public members table with batch, address, and membership type.")}
      <div class="editor-toolbar">
        ${selectEditor("members", state.data.members, index)}
        <button class="plain-button" data-add="members" type="button">Add</button>
        <button class="plain-button danger" data-delete="members" type="button">Delete</button>
      </div>
      <form class="admin-form" data-editor="members" data-index="${index}">
        <div class="form-grid">
          ${field("Name", "name", member.name)}
          ${field("Address", "address", member.address)}
          ${field("Batch", "batch", member.batch)}
          ${field("Type", "type", member.type)}
        </div>
      </form>
    `;
  }

  function renderGallery() {
    const index = Math.min(state.selected.gallery, state.data.gallery.length - 1);
    const item = state.data.gallery[index] || {};
    return `
      ${panelIntro("Gallery", "Manage gallery photos and captions shown on the gallery page.")}
      <div class="editor-toolbar">
        ${selectEditor("gallery", state.data.gallery, index)}
        <button class="plain-button" data-add="gallery" type="button">Add</button>
        <button class="plain-button danger" data-delete="gallery" type="button">Delete</button>
      </div>
      <form class="admin-form" data-editor="gallery" data-index="${index}">
        <div class="form-grid">
          ${field("Title", "title", item.title)}
          ${field("Image", "image", item.image)}
        </div>
      </form>
    `;
  }

  function renderSubmissions(type) {
    const items = state.data[type] || [];
    const columns = type === "applications"
      ? ["createdAt", "status", "nameBn", "mobile", "email", "memberType", "amount"]
      : ["createdAt", "status", "name", "email", "subject", "message"];
    return `
      ${panelIntro(type === "applications" ? "Applications" : "Messages", type === "applications" ? "Review membership applications submitted from the public form." : "Review contact messages submitted from the public form.")}
      <div class="table-wrap">
        <table class="members-table admin-table">
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}<th></th></tr></thead>
          <tbody>
            ${items
        .map(
          (item, index) => `
                  <tr>
                    ${columns
              .map((column) => `<td><input data-submission="${type}" data-index="${index}" data-key="${column}" value="${escapeHtml(item[column] || "")}"></td>`)
              .join("")}
                    <td><button class="plain-button danger" data-remove-submission="${type}" data-index="${index}" type="button">Delete</button></td>
                  </tr>
                `
        )
        .join("") || `<tr><td colspan="${columns.length + 1}">No records</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function collectCurrentForm() {
    const form = adminApp.querySelector("[data-editor]");
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
    if (editor === "pages") {
      state.data.pages[index] = {
        ...state.data.pages[index],
        ...values,
        body: splitLines(values.body)
      };
      return;
    }

    if (editor === "posts") {
      state.data.posts[index] = {
        ...state.data.posts[index],
        ...values,
        body: splitLines(values.body)
      };
      return;
    }

    state.data[editor][index] = {
      ...state.data[editor][index],
      ...values
    };
  }

  function bindAdmin() {
    adminApp.querySelectorAll("[data-select]").forEach((select) => {
      select.addEventListener("change", () => {
        collectCurrentForm();
        state.selected[select.dataset.select] = Number(select.value);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.add;
        const templates = {
          posts: { id: `post-${Date.now()}`, title: "নতুন পোস্ট", slug: "new-post", path: "/new-post/", category: "News", date: new Date().toISOString().slice(0, 10), image: "/assets/news-committee.jpg", excerpt: "", body: [""] },
          committee: { name: "নতুন সদস্য", role: "সদস্য", year: "২০২৬", passingYear: "", phone: "", image: "/assets/forum-logo.png" },
          members: { name: "নতুন সদস্য", address: "", batch: "", type: "সাধারণ" },
          gallery: { title: "Gallery", image: "/assets/gallery-01.jpg" }
        };
        state.data[type].push(templates[type]);
        state.selected[type] = state.data[type].length - 1;
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        collectCurrentForm();
        const type = button.dataset.delete;
        const index = state.selected[type];
        state.data[type].splice(index, 1);
        state.selected[type] = Math.max(0, index - 1);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll("[data-submission]").forEach((input) => {
      input.addEventListener("input", () => {
        const items = state.data[input.dataset.submission];
        items[Number(input.dataset.index)][input.dataset.key] = input.value;
      });
    });

    adminApp.querySelectorAll("[data-remove-submission]").forEach((button) => {
      button.addEventListener("click", () => {
        const items = state.data[button.dataset.removeSubmission];
        items.splice(Number(button.dataset.index), 1);
        renderAdmin();
      });
    });

    adminApp.querySelectorAll(".upload-trigger").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          if (!input.files[0]) return;
          const status = document.getElementById("adminStatus");
          status.textContent = "Uploading...";
          try {
            const path = await uploadImage(input.files[0]);
            const target = btn.parentNode.querySelector("input");
            target.value = path;
            status.textContent = "Uploaded. Remember to Save Changes.";
            // Trigger a change so collectCurrentForm gets the new value
            target.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {
            status.textContent = "Upload failed.";
          }
        };
        input.click();
      });
    });

    const meForm = adminApp.querySelector("#meForm");
    if (meForm) {
      meForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(meForm).entries());
        const status = document.getElementById("adminStatus");
        status.textContent = "Updating profile...";
        try {
          await api("/api/admin/me", { method: "PUT", body: JSON.stringify(data) });
          status.textContent = "Profile updated successfully.";
          // Update local data so it stays in sync
          const m = state.data.members.find(m => m.id === state.user.member_id);
          if (m) Object.assign(m, data);
        } catch {
          status.textContent = "Failed to update profile.";
        }
      });
    }

    // Save permissions (checkbox-based)
    adminApp.querySelectorAll(".save-perms").forEach(btn => {
      btn.addEventListener("click", async () => {
        const userId = btn.dataset.userId;
        const memberId = btn.dataset.memberId;
        const status = document.getElementById("adminStatus");
        const perms = [...adminApp.querySelectorAll(`.perm-cb[data-user-id="${userId}"]`)]
          .filter(cb => cb.checked).map(cb => cb.dataset.perm);
        status.textContent = "Saving permissions...";
        try {
          await api("/api/admin/users/permissions", {
            method: "POST",
            body: JSON.stringify({ userId, permissions: perms })
          });
          // Update local state
          const u = state.users.find(u => String(u.member_id) === String(memberId));
          if (u) u.permissions = perms;
          status.textContent = "✔ Permissions saved.";
        } catch {
          status.textContent = "Failed to save permissions.";
        }
      });
    });

    // Create account for member
    adminApp.querySelectorAll(".create-user").forEach(btn => {
      btn.addEventListener("click", async () => {
        const memberId = btn.dataset.memberId;
        const emailInput = adminApp.querySelector(`.email-inp[data-member-id="${memberId}"]`);
        const email = emailInput ? emailInput.value.trim() : "";
        const u = state.users.find(u => String(u.member_id) === String(memberId));
        const status = document.getElementById("adminStatus");
        if (!email) {
          status.textContent = "Please enter an email address first.";
          return;
        }
        status.textContent = "Creating account...";
        try {
          await api("/api/admin/users/create", {
            method: "POST",
            body: JSON.stringify({ memberId: Number(memberId), email, phone: u ? u.phone : null })
          });
          status.textContent = `✔ Account created. Initial password = ${u && u.phone ? u.phone : "12345678"}`;
          // Refresh users list
          state.users = await api("/api/admin/users");
          renderAdmin();
        } catch (e) {
          status.textContent = "Failed to create account.";
        }
      });
    });

    // Reset password
    adminApp.querySelectorAll("[data-reset-user]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const userId = btn.dataset.resetUser;
        const status = document.getElementById("adminStatus");
        if (!confirm("Reset password to phone number?")) return;
        status.textContent = "Resetting...";
        try {
          await api("/api/admin/users/reset-password", {
            method: "POST",
            body: JSON.stringify({ userId })
          });
          status.textContent = "✔ Password reset. User must change on next login.";
        } catch {
          status.textContent = "Failed to reset password.";
        }
      });
    });
  }

  function renderAdmin() {
    let body = "";
    if (state.tab === "settings") body = renderSettings();
    if (state.tab === "pages") body = renderPages();
    if (state.tab === "posts") body = renderPosts();
    if (state.tab === "committee") body = renderCommittee();
    if (state.tab === "members") body = renderMembers();
    if (state.tab === "gallery") body = renderGallery();
    if (state.tab === "applications") body = renderSubmissions("applications");
    if (state.tab === "messages") body = renderSubmissions("messages");
    if (state.tab === "me") body = renderMe();
    if (state.tab === "users") body = renderUsers();
    adminLayout(body);
    bindAdmin();
  }

  async function save() {
    collectCurrentForm();
    const status = document.getElementById("adminStatus");
    status.textContent = "Saving...";
    try {
      await api("/api/admin/site", {
        method: "PUT",
        body: JSON.stringify(state.data)
      });
      status.textContent = "Saved.";
    } catch {
      status.textContent = "Save failed.";
    }
  }

  async function loadAdmin() {
    try {
      // Always refresh user info from server (fixes stale localStorage state)
      const me = await api("/api/admin/whoami");
      state.user = me;
      localStorage.setItem("alumniUser", JSON.stringify(state.user));

      if (me.mustChangePassword) {
        renderChangePassword();
        return;
      }

      [state.data] = await Promise.all([api("/api/admin/site")]);

      if (state.user.isAdmin) {
        state.users = await api("/api/admin/users");
      }

      // Set default tab based on user role
      if (!state.user.isAdmin && !hasPerm("edit_any")) {
        // Member with limited permissions
        const tabAllowed = {
          settings: false,
          pages: false,
          posts: hasPerm("add_post"),
          committee: false,
          members: hasPerm("add_member"),
          gallery: false,
          applications: hasPerm("view_submissions"),
          messages: hasPerm("view_submissions"),
          users: false,
          me: true
        };
        if (!tabAllowed[state.tab]) state.tab = "me";
      }

      renderAdmin();
    } catch (err) {
      console.error(err);
      renderLogin("Please login again");
    }
  }

  if (state.token) {
    loadAdmin();
  } else {
    renderLogin();
  }
})();
