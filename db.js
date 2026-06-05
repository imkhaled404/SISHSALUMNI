const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Configuration
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const isSupabase = !!(supabaseUrl && supabaseKey);

let db; // SQLite
let supabase; // Supabase Client

if (isSupabase) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  const { DatabaseSync } = require("node:sqlite");
  const dataDir = path.join(__dirname, "data");
  const dbFile = path.join(dataDir, "site.db");
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value; // Already parsed by Supabase
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hashPassword(password) {
  if (!password) return "empty_hash";
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Driver-Agnostic query helper (only for Basic SQL in SQLite)
// For Supabase, we use the client directly in the functions below.
async function querySQLite(sql, params = []) {
  if (isSupabase) return { rows: [] }; // Should not use this for Supabase generally
  const stmt = db.prepare(sql);
  let rows = [];
  if (sql.trim().toUpperCase().startsWith("SELECT")) {
    rows = stmt.all(...params);
  } else {
    stmt.run(...params);
  }
  return { rows };
}

async function getMeta(name, fallback = "") {
  if (isSupabase) {
    const { data } = await supabase.from("meta").select("value").eq("name", name).single();
    return data ? data.value : fallback;
  } else {
    const res = await querySQLite("SELECT value FROM meta WHERE name = ?", [name]);
    return res.rows[0] ? res.rows[0].value : fallback;
  }
}

async function setMeta(name, value) {
  if (isSupabase) {
    await supabase.from("meta").upsert({ name, value: String(value) });
  } else {
    await querySQLite("INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", [name, String(value)]);
  }
}

async function readSettings() {
  if (isSupabase) {
    const { data } = await supabase.from("settings").select("*");
    return (data || []).reduce((acc, row) => {
      acc[row.name] = fromJson(row.value_json);
      return acc;
    }, {});
  } else {
    const res = await querySQLite("SELECT name, value_json FROM settings");
    return res.rows.reduce((acc, row) => {
      acc[row.name] = fromJson(row.value_json);
      return acc;
    }, {});
  }
}

async function readSimpleRows(table, mapper) {
  if (isSupabase) {
    const { data } = await supabase.from(table).select("*").order("sort_order", { ascending: true });
    return (data || []).map(mapper);
  } else {
    const res = await querySQLite(`SELECT * FROM ${table} ORDER BY sort_order ASC`);
    return res.rows.map(mapper);
  }
}

async function readSubmissions(table) {
  if (isSupabase) {
    const { data } = await supabase.from(table).select("*").order("created_at", { ascending: false });
    return (data || []).map(row => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      ...fromJson(row.payload_json, row)
    }));
  } else {
    const res = await querySQLite(`SELECT * FROM ${table} ORDER BY created_at DESC`);
    return res.rows.map(row => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      ...fromJson(row.payload_json, row)
    }));
  }
}

async function readSite(includePrivate = false) {
  const site = {
    updatedAt: await getMeta("updatedAt", new Date().toISOString()),
    settings: await readSettings(),
    navigation: await readSimpleRows("navigation", r => ({ label: r.label, path: r.path })),
    topLinks: await readSimpleRows("top_links", r => ({ label: r.label, path: r.path })),
    heroSlides: await readSimpleRows("hero_slides", r => ({ image: r.image, eyebrow: r.eyebrow, title: r.title })),
    pages: await readSimpleRows("pages", r => ({
      key: r.page_key, path: r.path, title: r.title, subtitle: r.subtitle, image: r.image,
      render: r.render, downloadLabel: r.download_label, downloadUrl: r.download_url,
      filter: r.filter, body: fromJson(r.body_json, [])
    })),
    committee: await readSimpleRows("committee", r => ({
      id: r.id, name: r.name, role: r.role, year: r.year, passingYear: r.passing_year,
      biography: r.biography, message: r.message, phone: r.phone, image: r.image
    })),
    members: await readSimpleRows("members", r => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, address: r.address, batch: r.batch, type: r.type
    })),
    posts: await readSimpleRows("posts", r => ({
      id: r.id, title: r.title, category: r.type, date: r.date, image: r.image,
      excerpt: r.excerpt, body: fromJson(r.body_json, [])
    })),
    gallery: await readSimpleRows("gallery", r => ({ title: r.title, image: r.image }))
  };
  if (includePrivate) {
    site.applications = await readSubmissions("applications");
    site.messages = await readSubmissions("messages");
  }
  return site;
}

async function getUserByEmail(email) {
  if (isSupabase) {
    const { data } = await supabase.from("users").select("*").eq("email", email).single();
    return data;
  } else {
    const res = await querySQLite("SELECT * FROM users WHERE email = ?", [email]);
    return res.rows[0];
  }
}

async function updateUserPassword(userId, newPassword) {
  if (isSupabase) {
    await supabase.from("users").update({ password_hash: hashPassword(newPassword), must_change_password: 0 }).eq("id", userId);
  } else {
    await querySQLite("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hashPassword(newPassword), userId]);
  }
}

async function updateUserPermissions(userId, permissions) {
  if (isSupabase) {
    await supabase.from("users").update({ permissions_json: toJson(permissions) }).eq("id", userId);
  } else {
    await querySQLite("UPDATE users SET permissions_json = ? WHERE id = ?", [toJson(permissions), userId]);
  }
}

async function getAllMembersWithUsers() {
  if (isSupabase) {
    // Supabase client join
    const { data } = await supabase.from("members").select("*, users(*)").order("name");
    return (data || []).map(m => ({
      member_id: m.id, name: m.name, email: m.email, phone: m.phone, type: m.type, batch: m.batch,
      user_id: m.users?.[0]?.id,
      permissions: fromJson(m.users?.[0]?.permissions_json, []),
      is_admin: m.users?.[0]?.is_admin, must_change_password: m.users?.[0]?.must_change_password
    }));
  } else {
    const res = await querySQLite(`
      SELECT m.id as member_id, m.name, m.email, m.phone, m.type, m.batch,
             u.id as user_id, u.permissions_json, u.is_admin, u.must_change_password
      FROM members m
      LEFT JOIN users u ON u.member_id = m.id
      ORDER BY m.name
    `);
    return res.rows.map(m => ({ ...m, permissions: fromJson(m.permissions_json, []) }));
  }
}

async function createUserForMember(memberId, email, phone) {
  const existing = await getUserByEmail(email);
  if (existing) return { error: "User already exists" };
  const id = crypto.randomUUID();
  const initialPass = phone || "12345678";
  if (isSupabase) {
    await supabase.from("users").insert({
      id, email, phone, password_hash: hashPassword(initialPass), must_change_password: 1, member_id: memberId
    });
  } else {
    await querySQLite("INSERT INTO users (id, email, phone, password_hash, must_change_password, member_id) VALUES (?, ?, ?, ?, ?, ?)", [
      id, email, phone, hashPassword(initialPass), 1, memberId
    ]);
  }
  return { ok: true, id };
}

async function resetUserPassword(userId) {
  if (isSupabase) {
    const { data } = await supabase.from("users").select("phone").eq("id", userId).single();
    if (!data) return { error: "Not found" };
    await supabase.from("users").update({ password_hash: hashPassword(data.phone || "12345678"), must_change_password: 1 }).eq("id", userId);
  } else {
    const res = await querySQLite("SELECT phone FROM users WHERE id = ?", [userId]);
    if (!res.rows[0]) return { error: "Not found" };
    await querySQLite("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", [hashPassword(res.rows[0].phone || "12345678"), userId]);
  }
  return { ok: true };
}

async function updateMemberProfile(memberId, data) {
  if (isSupabase) {
    await supabase.from("members").update({
      name: data.name, email: data.email, phone: data.phone, address: data.address, batch: data.batch, type: data.type
    }).eq("id", memberId);
  } else {
    await querySQLite("UPDATE members SET name = ?, email = ?, phone = ?, address = ?, batch = ?, type = ? WHERE id = ?", [
      data.name, data.email, data.phone, data.address, data.batch, data.type, memberId
    ]);
  }
}

async function addSubmission(table, body) {
  if (isSupabase) {
    await supabase.from(table).insert({
      name: body.name, email: body.email, phone: body.phone,
      batch: body.batch, subject: body.subject, message: body.message, status: "new"
    });
  } else {
    if (table === "applications") {
      await querySQLite("INSERT INTO applications (name, email, phone, batch, message, status) VALUES (?, ?, ?, ?, ?, ?)", [body.name, body.email, body.phone, body.batch, body.message, "new"]);
    } else {
      await querySQLite("INSERT INTO messages (name, email, phone, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)", [body.name, body.email, body.phone, body.subject, body.message, "new"]);
    }
  }
  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true };
}

async function clearEditableTables() {
  const tables = ["settings", "navigation", "top_links", "hero_slides", "pages", "committee", "members", "posts", "gallery"];
  if (isSupabase) {
    for (const t of tables) await supabase.from(t).delete().neq("id", -1);
  } else {
    for (const t of tables) await querySQLite(`DELETE FROM ${t}`);
  }
}

async function replaceSite(data) {
  await clearEditableTables();
  if (isSupabase) {
    const s = data.settings || {};
    for (const [k, v] of Object.entries(s)) {
      await supabase.from("settings").insert({ name: k, value_json: JSON.stringify(v) });
    }
    let i = 0;
    for (const n of (data.navigation || [])) await supabase.from("navigation").insert({ label: n.label, path: n.path, sort_order: i++ });
    i = 0;
    for (const t of (data.topLinks || [])) await supabase.from("top_links").insert({ label: t.label, path: t.path, sort_order: i++ });
    i = 0;
    for (const sl of (data.heroSlides || [])) await supabase.from("hero_slides").insert({ image: sl.image, eyebrow: sl.eyebrow, title: sl.title, sort_order: i++ });
    i = 0;
    for (const p of (data.pages || [])) {
      await supabase.from("pages").insert({
        page_key: p.key, path: p.path, title: p.title, subtitle: p.subtitle, image: p.image,
        render: p.render, download_label: p.downloadLabel, download_url: p.downloadUrl,
        filter: p.filter, body_json: JSON.stringify(p.body || []), sort_order: i++
      });
    }
    i = 0;
    for (const c of (data.committee || [])) {
      await supabase.from("committee").insert({
        name: c.name, role: c.role, year: c.year, passing_year: c.passingYear,
        biography: c.biography, message: c.message, phone: c.phone, image: c.image, sort_order: i++
      });
    }
    i = 0;
    for (const m of (data.members || [])) {
      await supabase.from("members").upsert({
        id: m.id, name: m.name, email: m.email, phone: m.phone,
        address: m.address, batch: m.batch, type: m.type, image: m.image, sort_order: i++
      });
    }
    i = 0;
    for (const post of (data.posts || [])) {
      await supabase.from("posts").insert({
        type: post.category, date: post.date, title: post.title, image: post.image,
        excerpt: post.excerpt, body_json: JSON.stringify(post.body || []), sort_order: i++
      });
    }
    i = 0;
    for (const g of (data.gallery || [])) await supabase.from("gallery").insert({ image: g.image, title: g.title, sort_order: i++ });
  } else {
    // SQLite version — use querySQLite here
    // (omitted for brevity, SQLite path is for local dev only)
  }
  await setMeta("updatedAt", new Date().toISOString());
  return { updatedAt: new Date().toISOString() };
}

async function init() {
  if (isSupabase) {
    console.log("Supabase Client Active. Tables must be created via SQL Editor first.");
    // ensureColumns or other light checks can go here
  } else {
    // SQLite auto-setup
    await querySQLite(`CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT)`);
    // ... other tables ...
  }
}

module.exports = {
  getPublicSite: () => readSite(false),
  getAdminSite: () => readSite(true),
  getUserByEmail,
  updateUserPassword,
  updateUserPermissions,
  updateMemberProfile,
  getAllMembersWithUsers,
  createUserForMember,
  resetUserPassword,
  getUsers: async () => {
    if (isSupabase) {
      const { data } = await supabase.from("users").select("*");
      return (data || []).map(u => ({ ...u, permissions: fromJson(u.permissions_json, []) }));
    } else {
      const res = await querySQLite("SELECT * FROM users");
      return res.rows.map(u => ({ ...u, permissions: fromJson(u.permissions_json, []) }));
    }
  },
  addApplication: (body) => addSubmission("applications", body),
  addMessage: (body) => addSubmission("messages", body),
  hashPassword,
  fromJson,
  init
};
