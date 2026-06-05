const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Configuration
const isPostgres = !!process.env.DATABASE_URL;
let db; // For SQLite
let pool; // For Postgres

if (isPostgres) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  const { DatabaseSync } = require("node:sqlite");
  const dataDir = path.join(__dirname, "data");
  const dbFile = path.join(dataDir, "site.db");
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
}

// Uniform Query Helper
async function query(sql, params = []) {
  if (isPostgres) {
    // Convert ? to $1, $2 for Postgres
    let count = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++count}`);
    const res = await pool.query(pgSql, params);
    return {
      rows: res.rows,
      changes: res.rowCount,
      lastInsertRowid: res.rows.length > 0 ? res.rows[0].id : null
    };
  } else {
    const stmt = db.prepare(sql);
    let rows = [];
    let changes = 0;
    let lastRowid = null;

    if (sql.trim().toUpperCase().startsWith("SELECT") || sql.includes("RETURNING")) {
      rows = stmt.all(...params);
    } else {
      const result = stmt.run(...params);
      changes = result.changes;
      lastRowid = result.lastInsertRowid;
    }
    return { rows, changes, lastInsertRowid: lastRowid };
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
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

async function getMeta(name, fallback = "") {
  const res = await query("SELECT value FROM meta WHERE name = ?", [name]);
  return res.rows[0] ? res.rows[0].value : fallback;
}

async function setMeta(name, value) {
  if (isPostgres) {
    await query(`
      INSERT INTO meta (name, value) VALUES ($1, $2)
      ON CONFLICT(name) DO UPDATE SET value = EXCLUDED.value
    `, [name, String(value)]);
  } else {
    await query(`
      INSERT INTO meta (name, value) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET value = excluded.value
    `, [name, String(value)]);
  }
}

async function ensureSchema() {
  const isPg = isPostgres;
  const pkey = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";

  await query(`CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value_json TEXT NOT NULL)`);
  await query(`CREATE TABLE IF NOT EXISTS navigation (id ${pkey}, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS top_links (id ${pkey}, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS hero_slides (id ${pkey}, image TEXT NOT NULL, eyebrow TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS pages (id ${pkey}, page_key TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, image TEXT, render TEXT NOT NULL, download_label TEXT, download_url TEXT, filter TEXT, body_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS committee (id ${pkey}, name TEXT NOT NULL, role TEXT NOT NULL, year TEXT NOT NULL, passing_year TEXT, biography TEXT, message TEXT, phone TEXT, image TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS posts (id ${pkey}, type TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, body_json TEXT NOT NULL, image TEXT, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS gallery (id ${pkey}, image TEXT NOT NULL, title TEXT, sort_order INTEGER NOT NULL DEFAULT 0)`);
  await query(`CREATE TABLE IF NOT EXISTS applications (id ${pkey}, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, batch TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'new', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await query(`CREATE TABLE IF NOT EXISTS messages (id ${pkey}, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await query(`CREATE TABLE IF NOT EXISTS members (id ${pkey}, name TEXT, email TEXT, phone TEXT, address TEXT, batch TEXT, type TEXT, image TEXT)`);
  await query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, password_hash TEXT NOT NULL, permissions_json TEXT, is_admin INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, member_id INTEGER)`);

  await ensureColumn("committee", "message", "TEXT");
  await ensureColumn("committee", "phone", "TEXT");
  await ensureColumn("users", "is_admin", "INTEGER DEFAULT 0");
  await ensureColumn("users", "member_id", "INTEGER");
  await ensureColumn("members", "email", "TEXT");
  await ensureColumn("members", "phone", "TEXT");

  await hydrateCommitteeProfiles();
  await syncUsersFromMembers();
}

async function ensureColumn(table, column, definition) {
  if (isPostgres) {
    const res = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`, [table, column]);
    if (res.rows.length === 0) {
      await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } else {
    const res = await query(`PRAGMA table_info(${table})`);
    const columnNames = res.rows.map(r => r.name);
    if (!columnNames.includes(column)) {
      await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function committeeFallback(person = {}) {
  const name = person.name || "কমিটি সদস্য";
  const role = person.role || "সদস্য";
  return {
    passingYear: person.passingYear || "হালনাগাদ হবে",
    biography: person.biography || `${name} প্রাক্তন শিক্ষার্থী ফোরাম, শান্তিরহাট ইসলামিয়া মাধ্যমিক বিদ্যালয়, শান্তিরহাট, ভোলা-এর ${role} হিসেবে দায়িত্ব পালন করছেন। বিদ্যালয়, প্রাক্তন শিক্ষার্থী এবং সমাজের কল্যাণে তাঁর অবদান ও বিস্তারিত জীবনী এখানে সংরক্ষণ করা হবে।`,
    message: person.message || "প্রাক্তন শিক্ষার্থীদের ঐক্য, সহযোগিতা ও বিদ্যালয়ের উন্নয়নে আমরা একসাথে কাজ করতে চাই।"
  };
}

const seedFile = path.join(__dirname, "data", "site.json");
async function readCommitteeSeed() {
  if (!fs.existsSync(seedFile)) return [];
  try {
    const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    return Array.isArray(seed.committee) ? seed.committee : [];
  } catch {
    return [];
  }
}

async function hydrateCommitteeProfiles() {
  const res = await query("SELECT id, name, role, passing_year, biography, message, phone, sort_order FROM committee ORDER BY sort_order ASC, id ASC");
  const rows = res.rows;
  if (!rows.length) return;
  const seed = await readCommitteeSeed();
  for (const [index, row] of rows.entries()) {
    if (row.passing_year && row.biography && row.message) continue;
    const seedPerson = seed[index] || {};
    const fallback = committeeFallback({ name: row.name, role: row.role, ...seedPerson });
    await query("UPDATE committee SET passing_year = ?, biography = ?, message = ? WHERE id = ?", [
      row.passing_year || fallback.passingYear,
      row.biography || fallback.biography,
      row.message || fallback.message,
      row.id
    ]);
  }
}

async function readSettings() {
  const res = await query("SELECT name, value_json FROM settings ORDER BY name");
  return res.rows.reduce((settings, row) => {
    settings[row.name] = fromJson(row.value_json);
    return settings;
  }, {});
}

async function readSimpleRows(table, mapper) {
  const res = await query(`SELECT * FROM ${table} ORDER BY sort_order ASC, id ASC`);
  return res.rows.map(mapper);
}

async function readSubmissions(table) {
  const res = await query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
  return res.rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    ...fromJson(row.payload_json, row)
  }));
}

async function readSite(includePrivate = false) {
  const site = {
    updatedAt: await getMeta("updatedAt", new Date().toISOString()),
    settings: await readSettings(),
    navigation: await readSimpleRows("navigation", (row) => ({ label: row.label, path: row.path })),
    topLinks: await readSimpleRows("top_links", (row) => ({ label: row.label, path: row.path })),
    heroSlides: await readSimpleRows("hero_slides", (row) => ({ image: row.image, eyebrow: row.eyebrow, title: row.title })),
    pages: await readSimpleRows("pages", (row) => ({
      key: row.page_key,
      path: row.path,
      title: row.title,
      subtitle: row.subtitle || undefined,
      image: row.image || undefined,
      render: row.render,
      downloadLabel: row.download_label || undefined,
      downloadUrl: row.download_url || undefined,
      filter: row.filter || undefined,
      body: fromJson(row.body_json, [])
    })),
    committee: await readSimpleRows("committee", (row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      year: row.year,
      passingYear: row.passing_year || "",
      biography: row.biography || "",
      message: row.message || "",
      phone: row.phone || "",
      image: row.image
    })),
    members: await readSimpleRows("members", (row) => ({
      id: row.id,
      name: row.name,
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      batch: row.batch || "",
      type: row.type || ""
    })),
    posts: await readSimpleRows("posts", (row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug || "",
      path: row.path || "/",
      category: row.type || "News",
      date: row.date,
      image: row.image || "",
      excerpt: row.excerpt || "",
      body: fromJson(row.body_json, [])
    })),
    gallery: await readSimpleRows("gallery", (row) => ({
      title: row.title,
      image: row.image
    }))
  };

  if (includePrivate) {
    site.applications = await readSubmissions("applications");
    site.messages = await readSubmissions("messages");
  }

  return site;
}

async function clearEditableTables() {
  const tables = [
    "settings", "navigation", "top_links", "hero_slides", "pages",
    "committee", "members", "posts", "gallery", "applications", "messages"
  ];
  for (const table of tables) {
    await query(`DELETE FROM ${table}`);
  }
}

async function insertSettings(settings = {}) {
  for (const [name, value] of Object.entries(settings)) {
    await query("INSERT INTO settings (name, value_json) VALUES (?, ?)", [name, toJson(value)]);
  }
}

async function insertNavigation(table, items = []) {
  for (const [index, item] of items.entries()) {
    await query(`INSERT INTO ${table} (label, path, sort_order) VALUES (?, ?, ?)`, [item.label || "", item.path || "/", index]);
  }
}

async function insertHeroSlides(items = []) {
  for (const [index, item] of items.entries()) {
    await query("INSERT INTO hero_slides (image, eyebrow, title, sort_order) VALUES (?, ?, ?, ?)", [item.image || "", item.eyebrow || "", item.title || "", index]);
  }
}

async function insertPages(items = []) {
  for (const [index, item] of items.entries()) {
    await query(`
      INSERT INTO pages (
        page_key, path, title, subtitle, image, render, download_label, download_url, filter, body_json, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.key || `page-${index + 1}`,
      item.path || "/",
      item.title || "",
      item.subtitle || null,
      item.image || null,
      item.render || "simple",
      item.downloadLabel || null,
      item.downloadUrl || null,
      item.filter || null,
      toJson(Array.isArray(item.body) ? item.body : []),
      index
    ]);
  }
}

async function insertCommittee(items = []) {
  for (const [index, item] of items.entries()) {
    const fallback = committeeFallback(item);
    await query(`
      INSERT INTO committee (name, role, year, passing_year, biography, message, phone, image, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.name || "",
      item.role || "",
      item.year || "২০২২",
      item.passingYear || fallback.passingYear,
      item.biography || fallback.biography,
      item.message || fallback.message,
      item.phone || "",
      item.image || "",
      index
    ]);
  }
}

async function insertMembers(items = []) {
  for (const [index, item] of items.entries()) {
    await query("INSERT INTO members (name, email, phone, address, batch, type) VALUES (?, ?, ?, ?, ?, ?)", [item.name || "", item.email || "", item.phone || "", item.address || "", item.batch || "", item.type || ""]);
  }
}

async function insertPosts(items = []) {
  for (const [index, item] of items.entries()) {
    await query(`
      INSERT INTO posts (type, date, title, excerpt, body_json, image, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      item.type || "News",
      item.date || new Date().toISOString().slice(0, 10),
      item.title || "",
      item.excerpt || "",
      toJson(Array.isArray(item.body) ? item.body : []),
      item.image || "",
      index
    ]);
  }
}

async function insertGallery(items = []) {
  for (const [index, item] of items.entries()) {
    await query("INSERT INTO gallery (title, image, sort_order) VALUES (?, ?, ?)", [item.title || "", item.image || "", index]);
  }
}

async function insertQuotes(items = []) {
  for (const [index, item] of items.entries()) {
    await query("INSERT INTO quotes (name, quote, sort_order) VALUES (?, ?, ?)", [item.name || "", item.quote || "", index]);
  }
}

function splitSubmission(item = {}) {
  const { id, status, createdAt, ...payload } = item;
  return {
    id: id || crypto.randomUUID(),
    status: status || "নতুন",
    createdAt: createdAt || new Date().toISOString(),
    payload
  };
}

async function addSubmission(table, body) {
  const submission = splitSubmission(body);
  const sql = `INSERT INTO ${table} (name, email, phone, status, created_at, message) VALUES (?, ?, ?, ?, ?, ?)`; // Simple version
  // For simplicity handle specifically
  if (table === "applications") {
    await query("INSERT INTO applications (name, email, phone, batch, message, status) VALUES (?, ?, ?, ?, ?, ?)",
      [body.name, body.email, body.phone, body.batch, body.message, "new"]);
  } else {
    await query("INSERT INTO messages (name, email, phone, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)",
      [body.name, body.email, body.phone, body.subject, body.message, "new"]);
  }
  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true };
}

async function replaceSite(data) {
  const updatedAt = new Date().toISOString();
  await clearEditableTables();
  await insertSettings(data.settings);
  await insertNavigation("navigation", data.navigation);
  await insertNavigation("top_links", data.topLinks);
  await insertHeroSlides(data.heroSlides);
  await insertPages(data.pages);
  await insertCommittee(data.committee);
  await insertMembers(data.members);
  await insertPosts(data.posts);
  await insertGallery(data.gallery);
  await setMeta("updatedAt", updatedAt);
  return { updatedAt };
}

async function syncUsersFromMembers() {
  const adminEmail = process.env.ADMIN_USER || "admin";
  const existingAdmin = await query("SELECT id FROM users WHERE email = ?", [adminEmail]);
  if (existingAdmin.rows.length === 0) {
    await query("INSERT INTO users (id, email, password_hash, must_change_password, is_admin) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), adminEmail, hashPassword(process.env.ADMIN_PASSWORD || "admin123"), 0, 1]);
  }

  const res = await query("SELECT id, email, phone FROM members WHERE email IS NOT NULL AND email != ''");
  for (const member of res.rows) {
    const initialPass = member.phone || "12345678";
    await query(isPostgres
      ? "INSERT INTO users (id, email, phone, password_hash, must_change_password, member_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING"
      : "INSERT OR IGNORE INTO users (id, email, phone, password_hash, must_change_password, member_id) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), member.email, member.phone, hashPassword(initialPass), 1, member.id]);
  }
}

async function getUserByEmail(email) {
  const res = await query("SELECT * FROM users WHERE email = ?", [email]);
  return res.rows[0];
}

async function updateUserPassword(userId, newPassword) {
  await query("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hashPassword(newPassword), userId]);
}

async function updateUserPermissions(userId, permissions) {
  await query("UPDATE users SET permissions_json = ? WHERE id = ?", [toJson(permissions), userId]);
}

async function getAllMembersWithUsers() {
  const res = await query(`
    SELECT m.id as member_id, m.name, m.email, m.phone, m.type, m.batch,
           u.id as user_id, u.permissions_json, u.is_admin, u.must_change_password
    FROM members m
    LEFT JOIN users u ON u.member_id = m.id
    ORDER BY m.name
  `);
  return res.rows.map(m => ({
    ...m,
    permissions: fromJson(m.permissions_json, [])
  }));
}

async function createUserForMember(memberId, email, phone) {
  const existing = await query("SELECT id FROM users WHERE member_id = ?", [memberId]);
  if (existing.rows.length > 0) return { error: "User already exists for this member" };
  if (!email) return { error: "Email is required to create a user" };
  const initialPass = phone || "12345678";
  const id = crypto.randomUUID();
  await query("INSERT INTO users (id, email, phone, password_hash, must_change_password, member_id) VALUES (?, ?, ?, ?, 1, ?)", [
    id, email, phone || null, hashPassword(initialPass), memberId
  ]);
  return { ok: true, id };
}

async function resetUserPassword(userId) {
  const res = await query("SELECT phone FROM users WHERE id = ?", [userId]);
  const user = res.rows[0];
  if (!user) return { error: "User not found" };
  const newPass = user.phone || "12345678";
  await query("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", [hashPassword(newPass), userId]);
  return { ok: true };
}

async function updateMemberProfile(memberId, data) {
  await query("UPDATE members SET name = ?, email = ?, phone = ?, address = ?, batch = ?, type = ? WHERE id = ?", [
    data.name || "", data.email || "", data.phone || "", data.address || "", data.batch || "", data.type || "", memberId
  ]);
}

async function seedIfNeeded() {
  const seeded = await getMeta("seeded", "");
  if (seeded) return;
  if (fs.existsSync(seedFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    await replaceSite(seed);
  }
}

async function init() {
  await ensureSchema();
  await seedIfNeeded();
}
init().catch(err => console.error("Database initialization failed:", err));

module.exports = {
  getPublicSite: () => readSite(false),
  getAdminSite: () => readSite(true),
  replaceSite,
  addApplication: (body) => addSubmission("applications", body),
  addMessage: (body) => addSubmission("messages", body),
  getUserByEmail,
  updateUserPassword,
  updateUserPermissions,
  updateMemberProfile,
  getAllMembersWithUsers,
  createUserForMember,
  resetUserPassword,
  getUsers: async () => {
    const res = await query("SELECT id, email, phone, must_change_password, permissions_json, is_admin, member_id FROM users");
    return res.rows.map(u => ({ ...u, permissions: fromJson(u.permissions_json, []) }));
  },
  hashPassword,
  fromJson
};
