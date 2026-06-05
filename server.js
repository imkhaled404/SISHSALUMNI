require("dotenv").config();
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
  getPublicSite,
  getAdminSite,
  replaceSite,
  addApplication,
  addMessage,
  getUserByEmail,
  updateUserPassword,
  updateUserPermissions,
  updateMemberProfile,
  getAllMembersWithUsers,
  createUserForMember,
  resetUserPassword,
  getUsers,
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

function requireAuth(req, res) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (session && Date.now() < session.expiresAt) {
    session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    return session;
  }
  sendJson(res, 401, { error: "Unauthorized" });
  return false;
}

function hasPermission(session, permission) {
  if (session.user.is_admin) return true;
  const perms = JSON.parse(session.user.permissions_json || "[]");
  return perms.includes(permission);
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
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, {
        user: {
          id: "admin",
          email: adminUser,
          is_admin: 1,
          must_change_password: 0,
          permissions_json: "[]"
        },
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      });
      sendJson(res, 200, { token, mustChangePassword: false, isAdmin: true, permissions: [] });
      return;
    }

    // Fall back to database users
    const user = await getUserByEmail(username);
    if (user && user.password_hash === hashPassword(password)) {
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, {
        user,
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      });
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

  // Auth required for all endpoints below
  const session = requireAuth(req, res);
  if (!session) return;

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
    const result = await createUserForMember(body.memberId, body.email, body.phone);
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
    await updateUserPermissions(body.userId, body.permissions);
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
    if (!session.user.is_admin && !hasPermission(session, "edit_any")) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const result = await replaceSite(body);
    sendJson(res, 200, { ok: true, updatedAt: result.updatedAt });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/upload") {
    if (!session.user.is_admin && !hasPermission(session, "upload_image")) {
      sendJson(res, 403, { error: "Permission denied" });
      return;
    }
    const body = await readBody(req);
    const imgbbKey = process.env.IMGBB_API_KEY;

    if (imgbbKey) {
      // Proxy to ImgBB for Cloud
      try {
        const formData = new URLSearchParams();
        formData.append("image", body.base64);
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
          method: "POST",
          body: formData
        });
        const data = await response.json();
        if (data.success) {
          sendJson(res, 200, { ok: true, path: data.data.url });
        } else {
          sendJson(res, 500, { error: "ImgBB upload failed" });
        }
      } catch (e) {
        sendJson(res, 500, { error: "Cloud upload error" });
      }
    } else {
      // Local fallback
      const cleanName = path.basename(body.filename).replace(/[^a-z0-9.-]/gi, "_");
      const filePath = path.join(publicDir, "assets", cleanName);
      await fs.mkdir(path.join(publicDir, "assets"), { recursive: true });
      await fs.writeFile(filePath, Buffer.from(body.base64, "base64"));
      sendJson(res, 200, { ok: true, path: `/assets/${cleanName}` });
    }
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
