require("dotenv").config();
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
const {
  getPublicSite,
  getAdminSite,
  replaceSite,
  saveSiteSections,
  addApplication,
  addMessage,
  getMemberById,
  getUserByEmail,
  updateUserPassword,
  updateUserAccount,
  updateUserPermissions,
  updateMemberProfile,
  getAllMembersWithUsers,
  createUserForMember,
  syncCommitteeMembersAndUsers,
  approveApplication,
  rejectApplication,
  resetUserPassword,
  updateSubmission,
  deleteSubmission,
  getForumPosts,
  createForumPost,
  addForumComment,
  toggleForumLike,
  hashPassword,
  fromJson,
  init
} = require("./db");

const root = __dirname;
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const sessions = new Map();
const assetUploadExts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);

const permissionAliases = {
  manage_posts: ["add_post"],
  manage_members: ["add_member"],
  manage_submissions: ["view_submissions"]
};

const siteSectionPermissions = [
  { keys: ["settings"], permission: "manage_settings" },
  { keys: ["navigation", "topLinks"], permission: "manage_menus" },
  { keys: ["heroSlides"], permission: "manage_slides" },
  { keys: ["pages"], permission: "manage_pages" },
  { keys: ["posts"], permission: "manage_posts" },
  { keys: ["committee"], permission: "manage_committee" },
  { keys: ["members"], permission: "manage_members" },
  { keys: ["gallery"], permission: "manage_gallery" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getToken(req) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  return type === "Bearer" ? token : "";
}

function isAuthed(req) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return true;
}

function getSession(req) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return session;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (session) {
    return session;
  }
  sendJson(res, 401, { error: "Unauthorized" });
  return false;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    user,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  });
  return token;
}

async function publicUserPayload(user) {
  const member = user?.member_id ? await getMemberById(user.member_id) : null;
  return {
    id: user.id,
    email: user.email,
    phone: member?.phone || "",
    memberId: user.member_id || null,
    isAdmin: !!user.is_admin,
    member: member ? {
      id: member.id,
      name: member.name || "",
      email: member.email || user.email || "",
      phone: member.phone || "",
      address: member.address || "",
      batch: member.batch || "",
      type: member.type || "",
      image: member.image || ""
    } : null
  };
}

function hasPermission(session, permission) {
  if (session.user.is_admin) return true;
  const perms = JSON.parse(session.user.permissions_json || "[]");
  const aliases = permissionAliases[permission] || [];
  return perms.includes(permission) || aliases.some((alias) => perms.includes(alias));
}

function userAdminPermissions(user) {
  return fromJson(user?.permissions_json, []);
}

function canAccessAdminUser(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  return userAdminPermissions(user).length > 0;
}

function canSaveSite(session) {
  if (session.user.is_admin || hasPermission(session, "edit_any")) return true;
  return siteSectionPermissions.some((section) => hasPermission(session, section.permission));
}

async function buildAllowedSitePayload(session, body) {
  const canEditAll = session.user.is_admin || hasPermission(session, "edit_any");
  const allowed = {};
  let changed = false;
  for (const section of siteSectionPermissions) {
    if (!canEditAll && !hasPermission(session, section.permission)) continue;
    for (const key of section.keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        allowed[key] = body[key];
        changed = true;
      }
    }
  }
  return changed ? allowed : null;
}

async function getAvailableAssetName(filename) {
  const ext = path.extname(filename).toLowerCase();
  const rawBase = path.basename(filename, ext) || "image";
  const base = rawBase.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "image";
  let cleanName = `${base}${ext}`;
  let filePath = path.join(publicDir, "assets", cleanName);

  try {
    await fs.access(filePath);
    cleanName = `${base}-${Date.now()}${ext}`;
    filePath = path.join(publicDir, "assets", cleanName);
  } catch {
    // Name is available.
  }

  return { cleanName, filePath };
}

function normalizeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = decoded.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(publicDir, clean));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

async function serveFile(res, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream"
    });
    res.end(body);
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => cleanup(reject, new Error("SMTP response timed out")), 15000);

    function cleanup(done, value) {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      done(value);
    }

    function onError(error) {
      cleanup(reject, error);
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) {
        cleanup(resolve, buffer);
      }
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(socket, command, expected) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  const code = Number(response.slice(0, 3));
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(code)) {
    throw new Error(`SMTP command failed: ${response.trim()}`);
  }
  return response;
}

function connectSmtp(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP connection timed out"));
    }, 15000);
    socket.once(secure ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function upgradeSmtpTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

function mailAddress(value) {
  return String(value || "").trim().replace(/[<>\r\n]/g, "");
}

function dotEscape(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

async function sendSmtpMail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  if (!host) return { sent: false, skipped: "SMTP_HOST is not configured" };

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const startTls = !secure && String(process.env.SMTP_STARTTLS || "true").toLowerCase() !== "false";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = mailAddress(process.env.SMTP_FROM || process.env.MAIL_FROM || adminUser);
  const recipient = mailAddress(to);
  if (!recipient) return { sent: false, skipped: "Recipient email is empty" };

  let socket = await connectSmtp(host, port, secure);
  try {
    await smtpCommand(socket, "", 220);
    await smtpCommand(socket, "EHLO localhost", 250);
    if (startTls) {
      await smtpCommand(socket, "STARTTLS", 220);
      socket = await upgradeSmtpTls(socket, host);
      await smtpCommand(socket, "EHLO localhost", 250);
    }
    if (user || pass) {
      await smtpCommand(socket, "AUTH LOGIN", 334);
      await smtpCommand(socket, Buffer.from(user).toString("base64"), 334);
      await smtpCommand(socket, Buffer.from(pass).toString("base64"), 235);
    }

    await smtpCommand(socket, `MAIL FROM:<${from}>`, 250);
    await smtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await smtpCommand(socket, "DATA", 354);

    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
    const body = [
      `From: ${from}`,
      `To: ${recipient}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      dotEscape(text),
      "."
    ].join("\r\n");
    socket.write(`${body}\r\n`);
    await smtpCommand(socket, "", 250);
    await smtpCommand(socket, "QUIT", 221).catch(() => {});
    return { sent: true };
  } finally {
    socket.destroy();
  }
}

async function sendApprovalEmail(req, approval) {
  const loginUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/login/`;
  const passwordLine = approval.initialPassword
    ? `Password: ${approval.initialPassword}\nPlease change this password after first login.`
    : "Your account already exists. Please use your existing password.";
  return sendSmtpMail({
    to: approval.email,
    subject: "Membership approved",
    text: [
      "Your membership application has been approved.",
      "",
      `Login: ${loginUrl}`,
      `Email: ${approval.email}`,
      passwordLine,
      "",
      "You can use your account for your profile and the forum. Admin access is only available if a site administrator assigns permissions."
    ].join("\n")
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/site") {
    sendJson(res, 200, await getPublicSite());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readBody(req);
    const username = body.username || "";
    const password = body.password || "";

    // Check env-var super admin first
    if (username === adminUser && password === adminPassword) {
      const token = createSession({
        id: "admin",
        email: adminUser,
        is_admin: 1,
        must_change_password: 0,
        permissions_json: "[]"
      });
      sendJson(res, 200, { token, mustChangePassword: false, isAdmin: true, permissions: [] });
      return;
    }

    // Fall back to database users
    const user = await getUserByEmail(username);
    if (user && user.password_hash === hashPassword(password)) {
      if (!canAccessAdminUser(user)) {
        sendJson(res, 403, { error: "This account does not have admin access" });
        return;
      }
      const token = createSession(user);
      sendJson(res, 200, {
        token,
        mustChangePassword: !!user.must_change_password,
        isAdmin: !!user.is_admin,
        permissions: fromJson(user.permissions_json, [])
      });
      return;
    }
    sendJson(res, 401, { error: "Invalid credentials" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const user = await getUserByEmail(String(body.email || body.username || "").trim().toLowerCase());
    if (!user || user.password_hash !== hashPassword(body.password || "")) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return;
    }
    const token = createSession(user);
    sendJson(res, 200, {
      token,
      user: await publicUserPayload(user)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const session = getSession(req);
    sendJson(res, 200, {
      user: session ? await publicUserPayload(session.user) : null
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/auth/me") {
    const session = requireAuth(req, res);
    if (!session) return;
    if (!session.user.member_id) {
      sendJson(res, 400, { error: "This login is not linked to a member profile" });
      return;
    }
    const body = await readBody(req);
    const accountResult = await updateUserAccount(session.user.id, {
      email: body.email
    });
    if (accountResult.error) {
      sendJson(res, 400, accountResult);
      return;
    }
    await updateMemberProfile(session.user.member_id, body);
    if (body.email !== undefined) session.user.email = String(body.email || "").trim().toLowerCase();
    sendJson(res, 200, { ok: true, user: await publicUserPayload(session.user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications") {
    const body = await readBody(req);
    const result = await addApplication(body);
    sendJson(res, 201, { ok: true, id: result.id });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    const body = await readBody(req);
    const result = await addMessage(body);
    sendJson(res, 201, { ok: true, id: result.id });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forum") {
    const session = getSession(req);
    sendJson(res, 200, { posts: await getForumPosts(session?.user?.id || "") });
    return;
  }

  const forumCommentMatch = url.pathname.match(/^\/api\/forum\/posts\/([^/]+)\/comments$/);
  if (req.method === "POST" && forumCommentMatch) {
    const session = requireAuth(req, res);
    if (!session) return;
    const result = await addForumComment(session.user, forumCommentMatch[1], await readBody(req));
    sendJson(res, result.error ? 400 : 201, result);
    return;
  }

  const forumLikeMatch = url.pathname.match(/^\/api\/forum\/posts\/([^/]+)\/like$/);
  if (req.method === "POST" && forumLikeMatch) {
    const session = requireAuth(req, res);
    if (!session) return;
    const result = await toggleForumLike(session.user, forumLikeMatch[1]);
    sendJson(res, result.error ? 400 : 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/forum/posts") {
    const session = requireAuth(req, res);
    if (!session) return;
    const result = await createForumPost(session.user, await readBody(req));
    sendJson(res, result.error ? 400 : 201, result);
    return;
  }

  // Auth required for admin endpoints below
  const session = requireAuth(req, res);
  if (!session) return;
  if (!canAccessAdminUser(session.user)) {
    sendJson(res, 403, { error: "This account does not have admin access" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/whoami") {
    sendJson(res, 200, {
      id: session.user.id,
      email: session.user.email,
      isAdmin: !!session.user.is_admin,
      mustChangePassword: !!session.user.must_change_password,
      permissions: fromJson(session.user.permissions_json, []),
      member_id: session.user.member_id || null
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/change-password") {
    const body = await readBody(req);
    if (!body.newPassword) {
      sendJson(res, 400, { error: "Missing new password" });
      return;
    }
    await updateUserPassword(session.user.id, body.newPassword);
    session.user.must_change_password = 0;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    if (!session.user.is_admin) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    sendJson(res, 200, await getAllMembersWithUsers());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users/create") {
    if (!session.user.is_admin) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const body = await readBody(req);
    const memberId = body.memberId ? Number(body.memberId) : null;
    const result = await createUserForMember(memberId, body.email, body.phone, {
      password: body.password,
      permissions: body.permissions || [],
      isAdmin: !!body.isAdmin
    });
    sendJson(res, result.error ? 400 : 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users/sync-committee") {
    if (!session.user.is_admin) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const result = await syncCommitteeMembersAndUsers();
    sendJson(res, result.error ? 400 : 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users/reset-password") {
    if (!session.user.is_admin) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const body = await readBody(req);
    const result = await resetUserPassword(body.userId);
    sendJson(res, result.error ? 400 : 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users/permissions") {
    if (!session.user.is_admin) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const body = await readBody(req);
    await updateUserPermissions(body.userId, body.permissions, body.isAdmin);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/me") {
    if (!session.user.member_id) {
      sendJson(res, 400, { error: "User is not linked to a member profile" });
      return;
    }
    const body = await readBody(req);
    await updateMemberProfile(session.user.member_id, body);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/site") {
    sendJson(res, 200, await getAdminSite());
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/site") {
    const body = await readBody(req);
    if (!canSaveSite(session)) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const allowedPayload = await buildAllowedSitePayload(session, body);
    if (!allowedPayload) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const result = await saveSiteSections(allowedPayload);
    sendJson(res, 200, { ok: true, updatedAt: result.updatedAt });
    return;
  }

  const applicationActionMatch = url.pathname.match(/^\/api\/admin\/applications\/([^/]+)\/(approve|reject)$/);
  if (applicationActionMatch && req.method === "POST") {
    if (!session.user.is_admin && !hasPermission(session, "manage_submissions")) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }

    const [, id, action] = applicationActionMatch;
    if (action === "reject") {
      const result = await rejectApplication(id);
      sendJson(res, result.error ? 400 : 200, result);
      return;
    }

    const approval = await approveApplication(id);
    if (approval.error) {
      sendJson(res, 400, approval);
      return;
    }

    let mail = { sent: false };
    try {
      mail = await sendApprovalEmail(req, approval);
    } catch (error) {
      mail = { sent: false, error: error.message || "Email send failed" };
    }
    sendJson(res, 200, { ...approval, mail });
    return;
  }

  const submissionMatch = url.pathname.match(/^\/api\/admin\/(applications|messages)\/([^/]+)$/);
  if (submissionMatch && (req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE")) {
    if (!session.user.is_admin && !hasPermission(session, "manage_submissions")) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }

    const [, table, id] = submissionMatch;
    const result = req.method === "DELETE"
      ? await deleteSubmission(table, id)
      : await updateSubmission(table, id, await readBody(req));
    sendJson(res, result.error ? 400 : 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/upload") {
    if (!session.user.is_admin && !hasPermission(session, "upload_image")) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const body = await readBody(req);
    const ext = path.extname(String(body.filename || "")).toLowerCase();

    if (!assetUploadExts.has(ext)) {
      sendJson(res, 400, { error: "Only image files are allowed" });
      return;
    }

    const buffer = Buffer.from(String(body.base64 || ""), "base64");
    if (!buffer.length) {
      sendJson(res, 400, { error: "Missing image data" });
      return;
    }
    if (buffer.length > 6 * 1024 * 1024) {
      sendJson(res, 400, { error: "Image must be 6MB or smaller" });
      return;
    }

    await fs.mkdir(path.join(publicDir, "assets"), { recursive: true });
    const { cleanName, filePath } = await getAvailableAssetName(body.filename);
    await fs.writeFile(filePath, buffer);
    sendJson(res, 200, { ok: true, path: `/assets/${cleanName}` });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      await serveFile(res, path.join(publicDir, "admin.html"));
      return;
    }

    const staticPath = normalizeStaticPath(url.pathname);
    const ext = staticPath ? path.extname(staticPath) : "";
    if (ext) {
      await serveFile(res, staticPath);
      return;
    }

    await serveFile(res, path.join(publicDir, "index.html"));
  } catch (error) {
    console.error("API Error at " + req.url + ":", error);
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

async function startServer() {
  try {
    console.log("Initializing database...");
    await init();
    http.createServer(handleRequest).listen(port, () => {
      console.log(`Alumni site running at http://localhost:${port}`);
      console.log(`Admin panel: http://localhost:${port}/admin`);
    });
  } catch (err) {
    console.error("Critical: Server failed to start:", err);
    process.exit(1);
  }
}

startServer();
