const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const isSupabase = !!(supabaseUrl && supabaseKey);

let db;
let supabase;

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

const EDITABLE_TABLES = [
  "settings",
  "navigation",
  "top_links",
  "hero_slides",
  "pages",
  "committee",
  "members",
  "posts",
  "gallery"
];

const OPTIONAL_COLUMNS = {
  committee: ["member_id"],
  posts: ["slug", "path"],
  applications: ["payload_json"],
  messages: ["payload_json"],
  users: ["phone"]
};

const SITE_SECTION_TABLES = {
  settings: ["settings"],
  navigation: ["navigation"],
  topLinks: ["top_links"],
  heroSlides: ["hero_slides"],
  pages: ["pages"],
  committee: ["committee"],
  members: ["members"],
  posts: ["posts"],
  gallery: ["gallery"]
};

function isMissingTable(error) {
  return /does not exist|schema cache|relation .* not found|Could not find the table/i.test(error.message || "");
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
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

function cleanRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  );
}

function maybeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function maybeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function committeeType(value) {
  const type = String(value || "").trim();
  return type || "Executive Committee";
}

function committeeStatus(value) {
  return String(value || "").toLowerCase() === "inactive" ? "inactive" : "active";
}

function committeeDesignationOrder(person, fallback = 9999) {
  return maybeInteger(person.designationOrder ?? person.designation_order ?? person.sortOrder ?? person.sort_order, fallback);
}

function normalizePath(value, fallback = "/") {
  let next = String(value || fallback).trim();
  if (!next.startsWith("/")) next = `/${next}`;
  if (next !== "/" && !next.endsWith("/")) next += "/";
  return next;
}

function slugify(value, fallback = "item") {
  const ascii = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `${fallback}-${Date.now()}`;
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asciiDigits(value) {
  return String(value || "").replace(/[\u09E6-\u09EF\u06F0-\u06F9\u0660-\u0669]/g, (digit) => {
    const code = digit.charCodeAt(0);
    if (code >= 0x09E6 && code <= 0x09EF) return String(code - 0x09E6);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return digit;
  });
}

function normalizedPhoneKey(value) {
  return asciiDigits(value).replace(/[^\d]/g, "");
}

function isUsableEmail(value) {
  const email = normalizedEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email !== "n/a";
}

function placeholderEmailForMember(member, prefix = "member") {
  const stableId = String(member?.id || "").replace(/[^\w-]/g, "");
  const stable = stableId || normalizedPhoneKey(member?.phone);
  if (stable) return `${prefix}-${stable}@members.local`;
  const hash = crypto.createHash("sha1").update(JSON.stringify(member || {})).digest("hex").slice(0, 12);
  return `${prefix}-${hash}@members.local`;
}

function loginEmailForMember(member) {
  return isUsableEmail(member?.email) ? normalizedEmail(member.email) : placeholderEmailForMember(member);
}

function isKhaledMember(member) {
  const haystack = `${member?.name || ""} ${member?.email || ""}`.toLowerCase();
  return haystack.includes("khaled") || haystack.includes("\u0996\u09be\u09b2\u09c7\u09a6");
}

function normalizedPhone(value) {
  return String(value || "").replace(/[^\d০-৯]/g, "");
}

function findPayloadMember(data, memberId) {
  const id = String(memberId || "");
  if (!id) return null;
  return (data.members || []).find((member) => String(member.id || "") === id) || null;
}

function committeeFallback(person, member) {
  return {
    name: member?.name || person.name || "Committee member",
    email: normalizedEmail(member?.email || person.email || ""),
    phone: member?.phone || person.phone || "",
    image: member?.image || person.image || "/assets/forum-logo.png",
    passingYear: person.passingYear || member?.batch || ""
  };
}

function assertSupabase(result, action) {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  return result.data;
}

function isMissingColumn(error) {
  return /column .* does not exist|Could not find .* column|schema cache/i.test(error.message || "");
}

function isTransientSupabaseError(error) {
  const cause = error?.cause ? `${error.cause.code || ""} ${error.cause.message || ""}` : "";
  return /fetch failed|network|timeout|timed out|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(`${error?.message || ""} ${cause}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransient(action, actionName, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await action();
      if (result?.error && isTransientSupabaseError(result.error)) {
        throw result.error;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseError(error) || attempt === attempts) break;
      await wait(350 * attempt);
    }
  }
  throw new Error(`${actionName}: ${lastError?.message || lastError}`);
}

async function insertSupabase(table, row, action = `insert ${table}`) {
  const payload = cleanRow(row);
  let result = await supabase.from(table).insert(payload);
  if (result.error && OPTIONAL_COLUMNS[table]?.length && isMissingColumn(result.error)) {
    const fallback = { ...payload };
    for (const key of OPTIONAL_COLUMNS[table]) delete fallback[key];
    result = await supabase.from(table).insert(fallback);
  }
  return assertSupabase(result, action);
}

async function upsertSupabase(table, row, action = `upsert ${table}`) {
  const payload = cleanRow(row);
  let result = await supabase.from(table).upsert(payload);
  if (result.error && OPTIONAL_COLUMNS[table]?.length && isMissingColumn(result.error)) {
    const fallback = { ...payload };
    for (const key of OPTIONAL_COLUMNS[table]) delete fallback[key];
    result = await supabase.from(table).upsert(fallback);
  }
  return assertSupabase(result, action);
}

async function querySQLite(sql, params = []) {
  const stmt = db.prepare(sql);
  if (sql.trim().toUpperCase().startsWith("SELECT")) {
    return { rows: stmt.all(...params) };
  }
  stmt.run(...params);
  return { rows: [] };
}

async function getMeta(name, fallback = "") {
  if (isSupabase) {
    const result = await supabase.from("meta").select("value").eq("name", name).maybeSingle();
    const data = assertSupabase(result, `read meta ${name}`);
    return data ? data.value : fallback;
  }
  const res = await querySQLite("SELECT value FROM meta WHERE name = ?", [name]);
  return res.rows[0] ? res.rows[0].value : fallback;
}

async function setMeta(name, value) {
  if (isSupabase) {
    await upsertSupabase("meta", { name, value: String(value) }, `save meta ${name}`);
    return;
  }
  await querySQLite(
    "INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    [name, String(value)]
  );
}

async function readSettings() {
  if (isSupabase) {
    const result = await supabase.from("settings").select("*");
    const rows = assertSupabase(result, "read settings") || [];
    return rows.reduce((acc, row) => {
      acc[row.name] = fromJson(row.value_json);
      return acc;
    }, {});
  }
  const res = await querySQLite("SELECT name, value_json FROM settings");
  return res.rows.reduce((acc, row) => {
    acc[row.name] = fromJson(row.value_json);
    return acc;
  }, {});
}

async function readSimpleRows(table, mapper) {
  if (isSupabase) {
    const result = await supabase.from(table).select("*").order("sort_order", { ascending: true });
    const rows = assertSupabase(result, `read ${table}`) || [];
    return rows.map(mapper);
  }
  const res = await querySQLite(`SELECT * FROM ${table} ORDER BY sort_order ASC`);
  return res.rows.map(mapper);
}

async function readSubmissions(table) {
  if (isSupabase) {
    const result = await supabase.from(table).select("*").order("created_at", { ascending: false });
    const rows = assertSupabase(result, `read ${table}`) || [];
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      ...row,
      ...fromJson(row.payload_json, {})
    }));
  }
  const res = await querySQLite(`SELECT * FROM ${table} ORDER BY created_at DESC`);
  return res.rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    ...row,
    ...fromJson(row.payload_json, {})
  }));
}

function ensureDefaultContent(site) {
  site.settings = site.settings || {};
  site.pages = site.pages || [];
  site.navigation = site.navigation || [];
  site.topLinks = site.topLinks || [];
  site.posts = site.posts || [];
  site.forumPosts = site.forumPosts || [];

  site.settings.homeEventsEyebrow = site.settings.homeEventsEyebrow || "অ্যালামনাই অ্যাসোসিয়েশন ইভেন্টস";
  site.settings.homeEventsTitle = site.settings.homeEventsTitle || "অ্যালামনাই অ্যাসোসিয়েশন ইভেন্টস";
  site.settings.homeEventsSubtitle = site.settings.homeEventsSubtitle || "অ্যালামনাই ইভেন্টস সম্পর্কে জানুন";
  site.settings.homeEventsEmptyText = site.settings.homeEventsEmptyText || "নতুন কোন ইভেন্ট নেই";

  const hasPage = (pathValue) => site.pages.some((page) => normalizePath(page.path) === normalizePath(pathValue));
  const hasNav = (pathValue) => site.navigation.some((item) => normalizePath(item.path) === normalizePath(pathValue));
  const hasTopLink = (pathValue) => site.topLinks.some((item) => normalizePath(item.path) === normalizePath(pathValue));

  if (!hasPage("/career/")) {
    site.pages.push({
      key: "career",
      path: "/career/",
      title: "ক্যারিয়ার",
      subtitle: "প্রাক্তন শিক্ষার্থী ও সদস্যদের জন্য চাকরির বিজ্ঞপ্তি এবং ক্যারিয়ার সুযোগ",
      render: "career",
      filter: "Career",
      body: ["অ্যাডমিন প্যানেলের News/Career পোস্ট থেকে এখানে চাকরির বিজ্ঞপ্তি প্রকাশ করুন।"]
    });
  }

  if (!hasPage("/forum/")) {
    site.pages.push({
      key: "forum",
      path: "/forum/",
      title: "ফোরাম",
      subtitle: "নিবন্ধিত সদস্যদের ধারণা, প্রশ্ন, শিক্ষা বিষয়ক লেখা এবং আলোচনার স্থান",
      render: "forum",
      body: ["নিবন্ধিত সদস্যরা পোস্ট লিখতে, মন্তব্য করতে, লাইক দিতে এবং আলোচনা শেয়ার করতে পারবেন।"]
    });
  }

  if (!hasNav("/career/")) site.navigation.push({ label: "ক্যারিয়ার", path: "/career/" });
  if (!hasNav("/forum/")) site.navigation.push({ label: "ফোরাম", path: "/forum/" });
  if (!hasTopLink("/forum/")) site.topLinks.push({ label: "ফোরাম", path: "/forum/" });
}

async function readSite(includePrivate = false) {
  const [
    updatedAt,
    settings,
    navigation,
    topLinks,
    heroSlides,
    pages,
    members,
    committeeRows,
    posts,
    gallery
  ] = await Promise.all([
    getMeta("updatedAt", new Date().toISOString()),
    readSettings(),
    readSimpleRows("navigation", (r) => ({ id: r.id, label: r.label, path: r.path })),
    readSimpleRows("top_links", (r) => ({ id: r.id, label: r.label, path: r.path })),
    readSimpleRows("hero_slides", (r) => ({
      id: r.id,
      image: r.image,
      eyebrow: r.eyebrow,
      title: r.title
    })),
    readSimpleRows("pages", (r) => ({
      id: r.id,
      key: r.page_key,
      path: r.path,
      title: r.title,
      subtitle: r.subtitle,
      image: r.image,
      render: r.render,
      downloadLabel: r.download_label,
      downloadUrl: r.download_url,
      filter: r.filter,
      body: fromJson(r.body_json, [])
    })),
    readSimpleRows("members", (r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      address: r.address,
      batch: r.batch,
      type: r.type,
      image: r.image
    })),
    readSimpleRows("committee", (r) => r),
    readSimpleRows("posts", (r) => {
      const slug = r.slug || slugify(r.title, `post-${r.id || Date.now()}`);
      return {
        id: r.id,
        slug,
        path: r.path || normalizePath(slug),
        title: r.title,
        category: r.type,
        date: r.date,
        image: r.image,
        excerpt: r.excerpt,
        body: fromJson(r.body_json, [])
      };
    }),
    readSimpleRows("gallery", (r) => ({ id: r.id, title: r.title, image: r.image }))
  ]);
  const membersById = new Map(members.map((member) => [String(member.id), member]));
  const committeeMeta = settings.committeeMeta || {};

  const site = {
    updatedAt,
    settings,
    navigation,
    topLinks,
    heroSlides,
    pages,
    committee: committeeRows.map((r) => ({
      id: r.id,
      memberId: r.member_id || "",
      name: membersById.get(String(r.member_id || ""))?.name || r.name || "",
      email: membersById.get(String(r.member_id || ""))?.email || r.email || "",
      role: r.role,
      year: r.year,
      type: committeeType(r.type || committeeMeta[String(r.id)]?.type),
      status: committeeStatus(r.status || committeeMeta[String(r.id)]?.status),
      designationOrder: committeeDesignationOrder({
        designationOrder: r.designation_order ?? committeeMeta[String(r.id)]?.designationOrder,
        sortOrder: r.sort_order
      }, r.sort_order ?? 9999),
      sortOrder: r.sort_order ?? 9999,
      passingYear: r.passing_year || membersById.get(String(r.member_id || ""))?.batch || "",
      biography: r.biography,
      message: r.message,
      phone: membersById.get(String(r.member_id || ""))?.phone || r.phone || "",
      address: membersById.get(String(r.member_id || ""))?.address || "",
      image: membersById.get(String(r.member_id || ""))?.image || r.image || "/assets/forum-logo.png"
    })),
    members,
    posts,
    gallery,
    forumPosts: []
  };

  if (includePrivate) {
    const [applications, messages] = await Promise.all([
      readSubmissions("applications"),
      readSubmissions("messages")
    ]);
    site.applications = applications;
    site.messages = messages;
  }

  ensureDefaultContent(site);
  return site;
}

async function getUserByEmail(email) {
  if (!email) return null;
  if (isSupabase) {
    const result = await supabase.from("users").select("*").eq("email", email).maybeSingle();
    return assertSupabase(result, "read user by email");
  }
  const res = await querySQLite("SELECT * FROM users WHERE email = ?", [email]);
  return res.rows[0] || null;
}

async function updateUserPassword(userId, newPassword) {
  if (isSupabase) {
    assertSupabase(
      await supabase.from("users").update({ password_hash: hashPassword(newPassword), must_change_password: 0 }).eq("id", userId),
      "update password"
    );
    return;
  }
  await querySQLite("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [
    hashPassword(newPassword),
    userId
  ]);
}

async function updateUserPermissions(userId, permissions, isAdmin) {
  const updates = { permissions_json: toJson(Array.isArray(permissions) ? permissions : []) };
  if (isAdmin !== undefined) updates.is_admin = isAdmin ? 1 : 0;

  if (isSupabase) {
    assertSupabase(await supabase.from("users").update(updates).eq("id", userId), "update user permissions");
    return;
  }

  if (isAdmin !== undefined) {
    await querySQLite("UPDATE users SET permissions_json = ?, is_admin = ? WHERE id = ?", [
      updates.permissions_json,
      updates.is_admin,
      userId
    ]);
  } else {
    await querySQLite("UPDATE users SET permissions_json = ? WHERE id = ?", [updates.permissions_json, userId]);
  }
}

async function getAllMembersWithUsers() {
  if (isSupabase) {
    const membersResult = await supabase.from("members").select("*").order("name", { ascending: true });
    const usersResult = await supabase.from("users").select("*").order("email", { ascending: true });
    const members = assertSupabase(membersResult, "read members for users") || [];
    const users = assertSupabase(usersResult, "read users") || [];
    const usersByMember = new Map(users.filter((u) => u.member_id).map((u) => [String(u.member_id), u]));
    const seen = new Set();

    const rows = members.map((member) => {
      const user = usersByMember.get(String(member.id));
      if (user) seen.add(user.id);
      return {
        member_id: member.id,
        name: member.name,
        email: user?.email || member.email,
        phone: member.phone || "",
        type: member.type,
        batch: member.batch,
        user_id: user?.id,
        permissions: fromJson(user?.permissions_json, []),
        is_admin: user?.is_admin || 0,
        must_change_password: user?.must_change_password || 0
      };
    });

    for (const user of users) {
      if (seen.has(user.id)) continue;
      if (user.member_id) continue;
      rows.push({
        member_id: null,
        name: user.email,
        email: user.email,
        phone: user.phone || "",
        type: "User",
        batch: "",
        user_id: user.id,
        permissions: fromJson(user.permissions_json, []),
        is_admin: user.is_admin || 0,
        must_change_password: user.must_change_password || 0
      });
    }

    return rows;
  }

  const res = await querySQLite(`
    SELECT m.id as member_id, m.name, COALESCE(u.email, m.email) as email,
           m.phone as phone, m.type, m.batch,
           u.id as user_id, u.permissions_json, u.is_admin, u.must_change_password
    FROM members m
    LEFT JOIN users u ON u.member_id = m.id
    ORDER BY m.name
  `);
  const rows = res.rows.map((m) => ({ ...m, permissions: fromJson(m.permissions_json, []) }));
  const standalone = await querySQLite("SELECT * FROM users WHERE member_id IS NULL OR member_id = '' ORDER BY email");
  for (const user of standalone.rows) {
    rows.push({
      member_id: null,
      name: user.email,
      email: user.email,
      phone: user.phone,
      type: "User",
      batch: "",
      user_id: user.id,
      permissions: fromJson(user.permissions_json, []),
      is_admin: user.is_admin,
      must_change_password: user.must_change_password
    });
  }
  return rows;
}

async function getMemberById(memberId) {
  if (!memberId) return null;
  if (isSupabase) {
    const result = await supabase.from("members").select("*").eq("id", memberId).maybeSingle();
    return assertSupabase(result, "read member");
  }
  const res = await querySQLite("SELECT * FROM members WHERE id = ?", [memberId]);
  return res.rows[0] || null;
}

async function getUserByMemberId(memberId) {
  if (!memberId) return null;
  if (isSupabase) {
    const result = await supabase.from("users").select("*").eq("member_id", memberId).maybeSingle();
    return assertSupabase(result, "read user by member");
  }
  const res = await querySQLite("SELECT * FROM users WHERE member_id = ?", [memberId]);
  return res.rows[0] || null;
}

async function getMemberByEmail(email) {
  const finalEmail = normalizedEmail(email);
  if (!finalEmail) return null;
  if (isSupabase) {
    const result = await supabase.from("members").select("*").eq("email", finalEmail).maybeSingle();
    return assertSupabase(result, "read member by email");
  }
  const res = await querySQLite("SELECT * FROM members WHERE lower(email) = lower(?)", [finalEmail]);
  return res.rows[0] || null;
}

async function createMember(row) {
  const member = {
    name: row.name || "Member",
    email: normalizedEmail(row.email),
    phone: row.phone || "",
    address: row.address || "",
    batch: row.batch || "",
    type: row.type || "General",
    image: row.image || "",
    sort_order: row.sort_order ?? 9999
  };

  if (isSupabase) {
    let result = await supabase.from("members").insert(member).select("id").single();
    if (result.error && /duplicate key value.*members_pkey|members_pkey/i.test(result.error.message || "")) {
      const maxResult = await supabase.from("members").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
      const maxRow = assertSupabase(maxResult, "read max member id");
      result = await supabase.from("members").insert({ ...member, id: Number(maxRow?.id || 0) + 1 }).select("id").single();
    }
    const created = assertSupabase(result, "create member");
    return { ...member, id: created.id };
  }

  const result = db.prepare(
    "INSERT INTO members (name, email, phone, address, batch, type, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(member.name, member.email, member.phone, member.address, member.batch, member.type, member.image, member.sort_order);
  return { ...member, id: Number(result.lastInsertRowid) };
}

async function createUserForMember(memberId, email, phone, options = {}) {
  const member = await getMemberById(memberId);
  const finalEmail = normalizedEmail(email || member?.email || "");
  const finalPhone = String(phone || member?.phone || "").trim();

  if (!finalEmail) return { error: "Email is required" };
  if (await getUserByEmail(finalEmail)) return { error: "User already exists" };
  if (memberId && await getUserByMemberId(memberId)) return { error: "Member already has a user account" };

  const id = crypto.randomUUID();
  const initialPass = options.password || finalPhone || "12345678";
  const row = {
    id,
    email: finalEmail,
    phone: finalPhone,
    password_hash: hashPassword(initialPass),
    permissions_json: toJson(options.permissions || []),
    is_admin: options.isAdmin ? 1 : 0,
    must_change_password: options.mustChangePassword === false ? 0 : 1,
    member_id: memberId || null
  };

  if (isSupabase) {
    await insertSupabase("users", row, "create user");
  } else {
    await querySQLite(
      "INSERT INTO users (id, email, password_hash, permissions_json, is_admin, must_change_password, member_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [row.id, row.email, row.password_hash, row.permissions_json, row.is_admin, row.must_change_password, row.member_id]
    );
  }

  return { ok: true, id, initialPassword: initialPass };
}

async function updateUserAccount(userId, data) {
  const updates = {};
  if (data.email !== undefined) {
    const email = normalizedEmail(data.email);
    if (!email) return { error: "Email is required" };
    const existing = await getUserByEmail(email);
    if (existing && String(existing.id) !== String(userId)) return { error: "Email already exists" };
    updates.email = email;
  }
  if (data.phone !== undefined) updates.phone = String(data.phone || "").trim();
  if (!Object.keys(updates).length) return { ok: true };

  if (isSupabase) {
    let result = await supabase.from("users").update(updates).eq("id", userId);
    if (result.error && isMissingColumn(result.error) && updates.phone !== undefined) {
      const fallback = { ...updates };
      delete fallback.phone;
      result = Object.keys(fallback).length
        ? await supabase.from("users").update(fallback).eq("id", userId)
        : { data: null, error: null };
    }
    assertSupabase(result, "update user account");
  } else {
    const user = (await querySQLite("SELECT * FROM users WHERE id = ?", [userId])).rows[0];
    if (!user) return { error: "User not found" };
    await querySQLite("UPDATE users SET email = ? WHERE id = ?", [
      updates.email ?? user.email,
      userId
    ]);
  }
  return { ok: true };
}

async function linkUserToMember(userId, memberId, phone = "") {
  if (!userId || !memberId) return { error: "User and member are required" };

  if (isSupabase) {
    const updates = { member_id: memberId };
    if (phone) updates.phone = phone;
    let result = await supabase.from("users").update(updates).eq("id", userId);
    if (result.error && isMissingColumn(result.error) && updates.phone !== undefined) {
      delete updates.phone;
      result = await supabase.from("users").update(updates).eq("id", userId);
    }
    assertSupabase(result, "link user to member");
    return { ok: true };
  }

  const user = (await querySQLite("SELECT * FROM users WHERE id = ?", [userId])).rows[0];
  if (!user) return { error: "User not found" };
  await querySQLite("UPDATE users SET member_id = ? WHERE id = ?", [
    memberId,
    userId
  ]);
  return { ok: true };
}

function memberNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findCommitteeMemberMatch(person, members) {
  const directId = maybeNumber(person.memberId);
  if (directId) {
    const direct = members.find((member) => String(member.id) === String(directId));
    if (direct) return direct;
  }

  const email = normalizedEmail(person.email);
  if (isUsableEmail(email)) {
    const byEmail = members.find((member) => normalizedEmail(member.email) === email);
    if (byEmail) return byEmail;
  }

  const phone = normalizedPhoneKey(person.phone);
  if (phone) {
    const byPhone = members.find((member) => normalizedPhoneKey(member.phone) === phone);
    if (byPhone) return byPhone;
  }

  const name = memberNameKey(person.name);
  if (!name) return null;
  const nameMatches = members.filter((member) => memberNameKey(member.name) === name);
  if (nameMatches.length === 1) return nameMatches[0];

  const batch = normalizedPhoneKey(person.passingYear || person.batch);
  if (batch && nameMatches.length > 1) {
    return nameMatches.find((member) => normalizedPhoneKey(member.batch) === batch) || null;
  }

  return null;
}

function committeePersonToMember(person, existing = {}) {
  const realEmail = isUsableEmail(person.email)
    ? normalizedEmail(person.email)
    : (isUsableEmail(existing.email) ? normalizedEmail(existing.email) : "");

  return {
    name: existing.name || person.name || "Member",
    email: realEmail,
    phone: person.phone || existing.phone || "",
    address: existing.address || person.address || "",
    batch: person.passingYear || existing.batch || "",
    type: existing.type || "Member",
    image: existing.image || person.image || "/assets/forum-logo.png",
    sort_order: existing.sort_order ?? 9999
  };
}

async function updateCommitteeMemberLink(committeeId, memberId) {
  if (!committeeId || !memberId) return { skipped: true };

  if (isSupabase) {
    let result = await retryTransient(
      () => supabase.from("committee").update({ member_id: memberId }).eq("id", committeeId),
      "link committee member"
    );
    if (result.error && isMissingColumn(result.error)) return { skipped: true };
    assertSupabase(result, "link committee member");
    return { ok: true };
  }

  await querySQLite(
    "UPDATE committee SET member_id = ? WHERE id = ?",
    [memberId, committeeId]
  );
  return { ok: true };
}

async function ensureMemberUser(member) {
  const admin = isKhaledMember(member);
  const permissions = admin ? ["edit_any"] : [];
  let user = await getUserByMemberId(member.id);
  let linked = false;
  let created = false;
  let initialPassword = "";

  if (!user) {
    let email = loginEmailForMember(member);
    const existingEmailUser = await getUserByEmail(email);
    if (existingEmailUser) {
      if (!existingEmailUser.member_id || String(existingEmailUser.member_id) === String(member.id)) {
        const linkResult = await linkUserToMember(existingEmailUser.id, member.id, member.phone);
        if (linkResult.error) return linkResult;
        user = { ...existingEmailUser, member_id: member.id, phone: member.phone || existingEmailUser.phone };
        linked = !existingEmailUser.member_id;
      } else {
        email = placeholderEmailForMember({ ...member, id: member.id }, "member");
      }
    }

    if (!user) {
      let createdUser;
      try {
        createdUser = await createUserForMember(member.id, email, member.phone, {
          permissions,
          isAdmin: admin
        });
      } catch (error) {
        if (!isTransientSupabaseError(error)) throw error;
        user = await getUserByMemberId(member.id);
        if (!user) {
          await wait(500);
          createdUser = await createUserForMember(member.id, email, member.phone, {
            permissions,
            isAdmin: admin
          });
        }
      }
      if (createdUser?.error) return createdUser;
      if (createdUser?.ok) {
        created = true;
        initialPassword = createdUser.initialPassword || "";
        user = await getUserByMemberId(member.id);
      }
    }
  }

  if (user) {
    const currentEmail = normalizedEmail(user.email);
    const realEmail = isUsableEmail(member.email) ? normalizedEmail(member.email) : "";
    if (realEmail && currentEmail.endsWith("@members.local") && currentEmail !== realEmail) {
      const updateResult = await retryTransient(
        () => updateUserAccount(user.id, { email: realEmail, phone: member.phone || user.phone || "" }),
        "update user account"
      );
      if (!updateResult.error) user.email = realEmail;
    } else if (member.phone && member.phone !== user.phone) {
      await retryTransient(() => updateUserAccount(user.id, { phone: member.phone }), "update user account");
    }
    await retryTransient(() => updateUserPermissions(user.id, permissions, admin), "update user permissions");
  }

  return {
    ok: true,
    userId: user?.id || "",
    email: user?.email || "",
    admin,
    linked,
    created,
    initialPassword
  };
}

async function syncCommitteeMembersAndUsers() {
  const result = {
    committeeChecked: 0,
    committeeLinked: 0,
    membersCreated: 0,
    membersUpdated: 0,
    usersChecked: 0,
    usersCreated: 0,
    usersLinked: 0,
    khaledAdmins: [],
    initialPasswords: []
  };

  const readMembers = () => readSimpleRows("members", (r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    batch: r.batch,
    type: r.type,
    image: r.image,
    sort_order: r.sort_order
  }));

  let members = await readMembers();
  const committee = await readSimpleRows("committee", (r) => ({
    id: r.id,
    memberId: r.member_id,
    name: r.name,
    email: r.email,
    role: r.role,
    year: r.year,
    passingYear: r.passing_year,
    biography: r.biography,
    message: r.message,
    phone: r.phone,
    image: r.image,
    sort_order: r.sort_order
  }));

  for (const person of committee) {
    result.committeeChecked += 1;
    let member = findCommitteeMemberMatch(person, members);
    const memberData = committeePersonToMember(person, member || {});

    if (!member) {
      try {
        member = await createMember(memberData);
      } catch (error) {
        if (!isTransientSupabaseError(error)) throw error;
        members = await readMembers();
        member = findCommitteeMemberMatch(person, members);
        if (!member) {
          await wait(500);
          member = await createMember(memberData);
        }
      }
      if (!members.some((item) => String(item.id) === String(member.id))) {
        members.push(member);
      }
      result.membersCreated += 1;
    } else {
      const nextMember = {
        ...member,
        ...memberData,
        email: isUsableEmail(member.email) ? normalizedEmail(member.email) : memberData.email,
        image: member.image || memberData.image
      };
      await retryTransient(() => updateMemberProfile(member.id, nextMember), "update member profile");
      member = { ...member, ...nextMember };
      const index = members.findIndex((item) => String(item.id) === String(member.id));
      if (index >= 0) members[index] = member;
      result.membersUpdated += 1;
    }

    const linkResult = await updateCommitteeMemberLink(person.id, member.id);
    if (linkResult.ok) result.committeeLinked += 1;
  }

  members = await readMembers();
  for (const member of members) {
    result.usersChecked += 1;
    const ensured = await ensureMemberUser(member);
    if (ensured.error) return ensured;
    if (ensured.created) result.usersCreated += 1;
    if (ensured.linked) result.usersLinked += 1;
    if (ensured.admin) result.khaledAdmins.push({ memberId: member.id, userId: ensured.userId, name: member.name });
    if (ensured.initialPassword) {
      result.initialPasswords.push({
        memberId: member.id,
        userId: ensured.userId,
        email: ensured.email,
        initialPassword: ensured.initialPassword
      });
    }
  }

  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true, ...result };
}

async function registerMemberUser(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();

  if (!name) return { error: "Name is required" };
  if (!email) return { error: "Email is required" };
  if (password.length < 6) return { error: "Password must be at least 6 characters" };
  if (await getUserByEmail(email)) return { error: "User already exists" };

  let memberId;
  const member = {
    name,
    email,
    phone,
    address: body.address || "",
    batch: body.batch || "",
    type: body.type || "Registered Member",
    image: "",
    sort_order: 9999
  };

  if (isSupabase) {
    const result = await supabase.from("members").insert(member).select("id").single();
    const row = assertSupabase(result, "create member");
    memberId = row.id;
  } else {
    const result = db.prepare(
      "INSERT INTO members (name, email, phone, address, batch, type, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(member.name, member.email, member.phone, member.address, member.batch, member.type, member.image, member.sort_order);
    memberId = Number(result.lastInsertRowid);
  }

  const created = await createUserForMember(memberId, email, phone, {
    password,
    permissions: [],
    isAdmin: false,
    mustChangePassword: false
  });

  if (created.error) return created;
  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true, memberId, userId: created.id };
}

async function resetUserPassword(userId) {
  if (isSupabase) {
    const result = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
    const user = assertSupabase(result, "read user for password reset");
    if (!user) return { error: "Not found" };
    const member = user.member_id ? await getMemberById(user.member_id) : null;
    assertSupabase(
      await supabase.from("users").update({
        password_hash: hashPassword(member?.phone || user.phone || "12345678"),
        must_change_password: 1
      }).eq("id", userId),
      "reset password"
    );
    return { ok: true };
  }

  const res = await querySQLite("SELECT * FROM users WHERE id = ?", [userId]);
  if (!res.rows[0]) return { error: "Not found" };
  const member = res.rows[0].member_id ? await getMemberById(res.rows[0].member_id) : null;
  await querySQLite("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", [
    hashPassword(member?.phone || res.rows[0].phone || "12345678"),
    userId
  ]);
  return { ok: true };
}

async function updateMemberProfile(memberId, data) {
  const row = cleanRow({
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    batch: data.batch,
    type: data.type,
    image: data.image
  });
  if (!Object.keys(row).length) return;

  if (isSupabase) {
    assertSupabase(await supabase.from("members").update(row).eq("id", memberId), "update member profile");
    return;
  }

  const columns = Object.keys(row);
  const assignments = columns.map((key) => `${key} = ?`).join(", ");
  await querySQLite(
    `UPDATE members SET ${assignments} WHERE id = ?`,
    [...columns.map((key) => row[key]), memberId]
  );
}

function normalizeApplication(body) {
  const payload = { ...body };
  const name = body.name || body.nameBn || body.nameEn || "Unknown applicant";
  const phone = body.phone || body.mobile || "N/A";
  const batch = body.batch || body.passingYear || body.admissionYear || "N/A";
  const paymentSummary = [
    body.paymentMethod ? `Payment method: ${body.paymentMethod}` : "",
    body.amount ? `Amount: ${body.amount}` : "",
    body.paymentMobile ? `Payment number: ${body.paymentMobile}` : "",
    body.transactionId ? `Transaction ID: ${body.transactionId}` : "",
    body.paymentDate ? `Payment date: ${body.paymentDate}` : ""
  ].filter(Boolean).join(" | ");
  const message = body.message || paymentSummary || body.payment || body.promise || "";
  return {
    row: {
      name,
      email: body.email || "N/A",
      phone,
      batch,
      message,
      status: body.status || "new",
      payload_json: toJson(payload)
    },
    payload
  };
}

function normalizeMessage(body) {
  const payload = { ...body };
  return {
    row: {
      name: body.name || "Unknown sender",
      email: body.email || "N/A",
      phone: body.phone || "",
      subject: body.subject || "Message",
      message: body.message || "",
      status: body.status || "new",
      payload_json: toJson(payload)
    },
    payload
  };
}

async function addSubmission(table, body) {
  const normalized = table === "applications" ? normalizeApplication(body) : normalizeMessage(body);
  if (isSupabase) {
    await insertSupabase(table, normalized.row, `create ${table}`);
  } else {
    if (table === "applications") {
      await querySQLite(
        "INSERT INTO applications (name, email, phone, batch, message, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          normalized.row.name,
          normalized.row.email,
          normalized.row.phone,
          normalized.row.batch,
          normalized.row.message,
          normalized.row.status,
          normalized.row.payload_json
        ]
      );
    } else {
      await querySQLite(
        "INSERT INTO messages (name, email, phone, subject, message, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          normalized.row.name,
          normalized.row.email,
          normalized.row.phone,
          normalized.row.subject,
          normalized.row.message,
          normalized.row.status,
          normalized.row.payload_json
        ]
      );
    }
  }
  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true };
}

async function updateSubmission(table, id, body) {
  if (!["applications", "messages"].includes(table)) {
    return { error: "Invalid submission type" };
  }

  const normalized = table === "applications" ? normalizeApplication(body) : normalizeMessage(body);
  const row = { ...normalized.row, status: body.status || normalized.row.status };

  if (isSupabase) {
    let result = await supabase.from(table).update(cleanRow(row)).eq("id", id);
    if (result.error && isMissingColumn(result.error)) {
      const fallback = { ...row };
      delete fallback.payload_json;
      result = await supabase.from(table).update(cleanRow(fallback)).eq("id", id);
    }
    assertSupabase(result, `update ${table}`);
  } else {
    if (table === "applications") {
      await querySQLite(
        "UPDATE applications SET name = ?, email = ?, phone = ?, batch = ?, message = ?, status = ?, payload_json = ? WHERE id = ?",
        [row.name, row.email, row.phone, row.batch, row.message, row.status, row.payload_json, id]
      );
    } else {
      await querySQLite(
        "UPDATE messages SET name = ?, email = ?, phone = ?, subject = ?, message = ?, status = ?, payload_json = ? WHERE id = ?",
        [row.name, row.email, row.phone, row.subject, row.message, row.status, row.payload_json, id]
      );
    }
  }

  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true };
}

async function getSubmissionById(table, id) {
  if (!["applications", "messages"].includes(table)) return null;

  if (isSupabase) {
    const result = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    const row = assertSupabase(result, `read ${table} ${id}`);
    return row ? {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      ...row,
      ...fromJson(row.payload_json, {})
    } : null;
  }

  const res = await querySQLite(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  const row = res.rows[0];
  return row ? {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    ...row,
    ...fromJson(row.payload_json, {})
  } : null;
}

function applicationToMember(application) {
  return {
    name: application.nameBn || application.nameEn || application.name || "Member",
    email: normalizedEmail(application.email),
    phone: application.mobile || application.phone || "",
    address: application.currentAddress || application.permanentAddress || application.address || "",
    batch: application.passingYear || application.batch || application.admissionYear || "",
    type: application.memberType || application.type || "General",
    image: application.image || application.memberImage || application.photo || ""
  };
}

async function approveApplication(id) {
  const application = await getSubmissionById("applications", id);
  if (!application) return { error: "Application not found" };

  const memberData = applicationToMember(application);
  if (!memberData.email || memberData.email === "n/a") return { error: "Application email is required" };

  let member = await getMemberByEmail(memberData.email);
  let createdMember = false;
  if (!member) {
    member = await createMember(memberData);
    createdMember = true;
  } else {
    await updateMemberProfile(member.id, {
      ...member,
      ...memberData,
      image: member.image || memberData.image
    });
    member = await getMemberById(member.id);
  }

  let user = await getUserByMemberId(member.id);
  const existingEmailUser = await getUserByEmail(memberData.email);
  let createdUser = false;
  let initialPassword = "";

  if (!user && existingEmailUser) {
    if (existingEmailUser.member_id && String(existingEmailUser.member_id) !== String(member.id)) {
      return { error: "Email already belongs to another member account" };
    }
    const linkResult = await linkUserToMember(existingEmailUser.id, member.id, memberData.phone);
    if (linkResult.error) return linkResult;
    user = { ...existingEmailUser, member_id: member.id, phone: memberData.phone || existingEmailUser.phone };
  }

  if (!user) {
    const created = await createUserForMember(member.id, memberData.email, memberData.phone, {
      permissions: [],
      isAdmin: false
    });
    if (created.error) return created;
    createdUser = true;
    initialPassword = created.initialPassword;
    user = await getUserByEmail(memberData.email);
  }

  await updateSubmission("applications", id, { ...application, status: "approved" });
  return {
    ok: true,
    memberId: member.id,
    userId: user?.id || "",
    email: memberData.email,
    initialPassword,
    createdMember,
    createdUser
  };
}

async function rejectApplication(id) {
  const application = await getSubmissionById("applications", id);
  if (!application) return { error: "Application not found" };
  await updateSubmission("applications", id, { ...application, status: "rejected" });
  return { ok: true };
}

async function deleteSubmission(table, id) {
  if (!["applications", "messages"].includes(table)) {
    return { error: "Invalid submission type" };
  }

  if (isSupabase) {
    assertSupabase(await supabase.from(table).delete().eq("id", id), `delete ${table}`);
  } else {
    await querySQLite(`DELETE FROM ${table} WHERE id = ?`, [id]);
  }

  await setMeta("updatedAt", new Date().toISOString());
  return { ok: true };
}

async function forumAuthor(user) {
  if (!user) return "Member";
  const member = user.member_id ? await getMemberById(user.member_id) : null;
  return member?.name || user.email || "Member";
}

async function getForumAuthorMap(userIds) {
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
  const authors = new Map();
  if (!ids.length) return authors;

  if (isSupabase) {
    const usersResult = await supabase.from("users").select("id,email,member_id").in("id", ids);
    const users = assertSupabase(usersResult, "read forum users") || [];
    const memberIds = [...new Set(users.map((user) => user.member_id).filter(Boolean).map(String))];
    let members = [];
    if (memberIds.length) {
      const membersResult = await supabase.from("members").select("*").in("id", memberIds);
      members = assertSupabase(membersResult, "read forum members") || [];
    }
    const membersById = new Map(members.map((member) => [String(member.id), member]));
    for (const user of users) {
      const member = membersById.get(String(user.member_id || ""));
      authors.set(String(user.id), {
        name: member?.name || user.email || "Member",
        memberId: user.member_id || null
      });
    }
    return authors;
  }

  const placeholders = ids.map(() => "?").join(",");
  const users = (await querySQLite(`
    SELECT u.id, u.email, u.member_id, m.name
    FROM users u
    LEFT JOIN members m ON m.id = u.member_id
    WHERE u.id IN (${placeholders})
  `, ids)).rows;
  for (const user of users) {
    authors.set(String(user.id), {
      name: user.name || user.email || "Member",
      memberId: user.member_id || null
    });
  }
  return authors;
}

async function getForumPosts(userId = "", options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 20), 1), 50);
  if (isSupabase) {
    const postsResult = await supabase.from("forum_posts").select("*").order("created_at", { ascending: false }).limit(limit);
    if (postsResult.error) {
      if (isMissingTable(postsResult.error)) return [];
      throw new Error(`read forum posts: ${postsResult.error.message}`);
    }

    const posts = postsResult.data || [];
    if (!posts.length) return [];

    const postIds = posts.map((post) => post.id);
    const commentsResult = await supabase.from("forum_comments").select("*").in("post_id", postIds).order("created_at", { ascending: true });
    if (commentsResult.error && !isMissingTable(commentsResult.error)) {
      throw new Error(`read forum comments: ${commentsResult.error.message}`);
    }

    const likesResult = await supabase.from("forum_likes").select("*").in("post_id", postIds);
    if (likesResult.error && !isMissingTable(likesResult.error)) {
      throw new Error(`read forum likes: ${likesResult.error.message}`);
    }

    const authorIds = [
      ...(postsResult.data || []).map((post) => post.user_id),
      ...(commentsResult.data || []).map((comment) => comment.user_id)
    ];
    const authors = await getForumAuthorMap(authorIds);
    return mapForumRows(posts, commentsResult.data || [], likesResult.data || [], userId, authors);
  }

  const posts = (await querySQLite("SELECT * FROM forum_posts ORDER BY created_at DESC LIMIT ?", [limit])).rows;
  if (!posts.length) return [];
  const placeholders = posts.map(() => "?").join(",");
  const postIds = posts.map((post) => post.id);
  const comments = (await querySQLite(`SELECT * FROM forum_comments WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`, postIds)).rows;
  const likes = (await querySQLite(`SELECT * FROM forum_likes WHERE post_id IN (${placeholders})`, postIds)).rows;
  const authors = await getForumAuthorMap([...posts.map((post) => post.user_id), ...comments.map((comment) => comment.user_id)]);
  return mapForumRows(posts, comments, likes, userId, authors);
}

function mapForumRows(posts, comments, likes, userId = "", authors = new Map()) {
  const commentsByPost = new Map();
  for (const comment of comments) {
    const key = String(comment.post_id);
    if (!commentsByPost.has(key)) commentsByPost.set(key, []);
    commentsByPost.get(key).push({
      id: comment.id,
      postId: comment.post_id,
      userId: comment.user_id,
      authorName: authors.get(String(comment.user_id))?.name || comment.author_name || "Member",
      body: comment.body,
      createdAt: comment.created_at
    });
  }

  const likesByPost = new Map();
  const likedByMe = new Set();
  for (const like of likes) {
    const key = String(like.post_id);
    likesByPost.set(key, (likesByPost.get(key) || 0) + 1);
    if (userId && String(like.user_id) === String(userId)) likedByMe.add(key);
  }

  return posts.map((post) => ({
    id: post.id,
    userId: post.user_id,
    authorName: authors.get(String(post.user_id))?.name || post.author_name || "Member",
    title: post.title,
    category: post.category,
    body: post.body,
    createdAt: post.created_at,
    comments: commentsByPost.get(String(post.id)) || [],
    likes: likesByPost.get(String(post.id)) || 0,
    likedByMe: likedByMe.has(String(post.id))
  }));
}

async function createForumPost(user, body) {
  const title = String(body.title || "").trim();
  const text = String(body.body || "").trim();
  if (!title) return { error: "Title is required" };
  if (!text) return { error: "Post body is required" };

  const row = {
    user_id: user.id,
    author_name: "",
    title,
    category: body.category || "General",
    body: text
  };

  if (isSupabase) {
    const result = await supabase.from("forum_posts").insert(row).select("id").single();
    if (result.error) return { error: result.error.message };
    return { ok: true, id: result.data.id };
  }

  const result = db.prepare("INSERT INTO forum_posts (user_id, author_name, title, category, body) VALUES (?, ?, ?, ?, ?)")
    .run(row.user_id, row.author_name, row.title, row.category, row.body);
  return { ok: true, id: Number(result.lastInsertRowid) };
}

async function addForumComment(user, postId, body) {
  const text = String(body.body || "").trim();
  if (!text) return { error: "Comment is required" };

  const row = {
    post_id: Number(postId),
    user_id: user.id,
    author_name: "",
    body: text
  };

  if (isSupabase) {
    const result = await supabase.from("forum_comments").insert(row).select("id").single();
    if (result.error) return { error: result.error.message };
    return { ok: true, id: result.data.id };
  }

  const result = db.prepare("INSERT INTO forum_comments (post_id, user_id, author_name, body) VALUES (?, ?, ?, ?)")
    .run(row.post_id, row.user_id, row.author_name, row.body);
  return { ok: true, id: Number(result.lastInsertRowid) };
}

async function toggleForumLike(user, postId) {
  const numericPostId = Number(postId);
  if (isSupabase) {
    const existing = await supabase.from("forum_likes").select("*")
      .eq("post_id", numericPostId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing.error) return { error: existing.error.message };
    if (existing.data) {
      const removed = await supabase.from("forum_likes").delete().eq("post_id", numericPostId).eq("user_id", user.id);
      if (removed.error) return { error: removed.error.message };
      return { ok: true, liked: false };
    }
    const added = await supabase.from("forum_likes").insert({ post_id: numericPostId, user_id: user.id });
    if (added.error) return { error: added.error.message };
    return { ok: true, liked: true };
  }

  const existing = db.prepare("SELECT post_id FROM forum_likes WHERE post_id = ? AND user_id = ?").get(numericPostId, user.id);
  if (existing) {
    db.prepare("DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?").run(numericPostId, user.id);
    return { ok: true, liked: false };
  }
  db.prepare("INSERT INTO forum_likes (post_id, user_id) VALUES (?, ?)").run(numericPostId, user.id);
  return { ok: true, liked: true };
}

async function clearTable(table) {
  if (isSupabase) {
    const query = table === "settings"
      ? supabase.from(table).delete().neq("name", "__never__")
      : supabase.from(table).delete().neq("id", -1);
    assertSupabase(await query, `clear ${table}`);
    return;
  }

  await querySQLite(`DELETE FROM ${table}`);
}

async function clearEditableTables() {
  for (const table of EDITABLE_TABLES) {
    await clearTable(table);
  }
}

function payloadSectionKeys(data) {
  return Object.keys(SITE_SECTION_TABLES).filter((key) => Object.prototype.hasOwnProperty.call(data || {}, key));
}

async function clearSiteSections(keys) {
  const tables = [...new Set(keys.flatMap((key) => SITE_SECTION_TABLES[key] || []))];
  for (const table of tables) {
    if (table === "members") continue;
    await clearTable(table);
  }
}

async function saveMembersSection(members = []) {
  const incomingIds = new Set(members.map((member) => maybeNumber(member.id)).filter(Boolean).map(String));

  if (isSupabase) {
    const existingResult = await supabase.from("members").select("id");
    const existingRows = assertSupabase(existingResult, "read members for save") || [];

    let sort = 0;
    for (const member of members) {
      const row = {
        id: maybeNumber(member.id),
        name: member.name || "Member",
        email: member.email || "",
        phone: member.phone || "",
        address: member.address || "",
        batch: member.batch || "",
        type: member.type || "",
        image: member.image || "",
        sort_order: sort++
      };
      if (row.id) {
        await upsertSupabase("members", row, "save member");
      } else {
        const created = await createMember(row);
        await updateMemberProfile(created.id, { ...row, id: created.id });
        incomingIds.add(String(created.id));
      }
    }

    for (const existing of existingRows) {
      if (!incomingIds.has(String(existing.id))) {
        assertSupabase(await supabase.from("members").delete().eq("id", existing.id), "delete removed member");
      }
    }
    return;
  }

  const existingRows = (await querySQLite("SELECT id FROM members")).rows;
  let sort = 0;
  for (const member of members) {
    const id = maybeNumber(member.id);
    const row = [
      member.name || "Member",
      member.email || "",
      member.phone || "",
      member.address || "",
      member.batch || "",
      member.type || "",
      member.image || "",
      sort++
    ];
    if (id) {
      await querySQLite(
        `INSERT INTO members (id, name, email, phone, address, batch, type, image, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           email = excluded.email,
           phone = excluded.phone,
           address = excluded.address,
           batch = excluded.batch,
           type = excluded.type,
           image = excluded.image,
           sort_order = excluded.sort_order`,
        [id, ...row]
      );
    } else {
      const result = db.prepare(
        "INSERT INTO members (name, email, phone, address, batch, type, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(...row);
      incomingIds.add(String(Number(result.lastInsertRowid)));
    }
  }

  for (const existing of existingRows) {
    if (!incomingIds.has(String(existing.id))) {
      await querySQLite("DELETE FROM members WHERE id = ?", [existing.id]);
    }
  }
}

async function insertSupabaseReturningId(table, row, action = `insert ${table}`) {
  const payload = cleanRow(row);
  let result = await supabase.from(table).insert(payload).select("id").single();
  if (result.error && OPTIONAL_COLUMNS[table]?.length && isMissingColumn(result.error)) {
    const fallback = { ...payload };
    for (const key of OPTIONAL_COLUMNS[table]) delete fallback[key];
    result = await supabase.from(table).insert(fallback).select("id").single();
  }
  if (result.error && /duplicate key value.*_pkey|duplicate key value/i.test(result.error.message || "")) {
    const maxResult = await supabase.from(table).select("id").order("id", { ascending: false }).limit(1).maybeSingle();
    const maxRow = assertSupabase(maxResult, `read max ${table} id`);
    result = await supabase.from(table).insert({ ...payload, id: Number(maxRow?.id || 0) + 1 }).select("id").single();
  }
  const created = assertSupabase(result, action);
  return created.id;
}

async function deleteSupabaseRowsNotIn(table, keepIds) {
  const existingResult = await supabase.from(table).select("id");
  const existingRows = assertSupabase(existingResult, `read ${table} for cleanup`) || [];
  for (const row of existingRows) {
    if (!keepIds.has(String(row.id))) {
      assertSupabase(await supabase.from(table).delete().eq("id", row.id), `delete removed ${table}`);
    }
  }
}

async function saveSupabaseRows(table, rows, action = `save ${table}`) {
  const keepIds = new Set();
  for (const row of rows) {
    if (row.id) {
      await upsertSupabase(table, row, action);
      keepIds.add(String(row.id));
    } else {
      const id = await insertSupabaseReturningId(table, row, action);
      keepIds.add(String(id));
    }
  }
  await deleteSupabaseRowsNotIn(table, keepIds);
}

function committeeMetaFromRows(rows = []) {
  return Object.fromEntries(rows
    .filter((row) => row.id)
    .map((row) => [String(row.id), {
      type: committeeType(row.type),
      status: committeeStatus(row.status),
      designationOrder: committeeDesignationOrder(row)
    }]));
}

function stripCommitteeSchemaFields(row) {
  const next = { ...row };
  delete next.type;
  delete next.status;
  delete next.designation_order;
  return next;
}

async function writeSupabaseCommitteeRows(rows, stripSchemaFields = false) {
  const keepIds = new Set();
  for (const row of rows) {
    const payload = stripSchemaFields ? stripCommitteeSchemaFields(row) : row;
    if (payload.id) {
      await upsertSupabase("committee", payload, "save committee");
      keepIds.add(String(payload.id));
    } else {
      const id = await insertSupabaseReturningId("committee", payload, "save committee");
      row.id = id;
      keepIds.add(String(id));
    }
  }
  await deleteSupabaseRowsNotIn("committee", keepIds);
}

async function saveSupabaseCommitteeRows(rows) {
  let usedMetaFallback = false;
  try {
    await writeSupabaseCommitteeRows(rows, false);
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    usedMetaFallback = true;
    await writeSupabaseCommitteeRows(rows, true);
  }

  if (usedMetaFallback || rows.some((row) => row.type || row.status || row.designation_order !== undefined)) {
    await upsertSupabase("settings", {
      name: "committeeMeta",
      value_json: toJson(committeeMetaFromRows(rows))
    }, "save committee metadata");
  }
}

async function saveSupabaseSettings(settings = {}) {
  const keepNames = new Set(Object.keys(settings));
  for (const [name, value] of Object.entries(settings)) {
    await upsertSupabase("settings", { name, value_json: toJson(value) }, `save setting ${name}`);
  }
  const existingResult = await supabase.from("settings").select("name");
  const existingRows = assertSupabase(existingResult, "read settings for cleanup") || [];
  for (const row of existingRows) {
    if (!keepNames.has(row.name)) {
      assertSupabase(await supabase.from("settings").delete().eq("name", row.name), "delete removed setting");
    }
  }
}

async function saveSiteSections(data, keys = payloadSectionKeys(data)) {
  const updatedAt = new Date().toISOString();
  const sectionKeys = [...new Set(keys)].filter((key) => SITE_SECTION_TABLES[key]);
  if (!sectionKeys.length) return { updatedAt };

  if (isSupabase) {
    if (sectionKeys.includes("settings")) {
      await saveSupabaseSettings(data.settings || {});
    }

    if (sectionKeys.includes("navigation")) {
      let sort = 0;
      await saveSupabaseRows("navigation", (data.navigation || []).map((item) => ({
          id: maybeNumber(item.id),
          label: item.label || "Menu item",
          path: normalizePath(item.path),
          sort_order: sort++
      })), "save navigation");
    }

    if (sectionKeys.includes("topLinks")) {
      let sort = 0;
      await saveSupabaseRows("top_links", (data.topLinks || []).map((item) => ({
          id: maybeNumber(item.id),
          label: item.label || "Top link",
          path: normalizePath(item.path),
          sort_order: sort++
      })), "save top links");
    }

    if (sectionKeys.includes("heroSlides")) {
      let sort = 0;
      await saveSupabaseRows("hero_slides", (data.heroSlides || []).map((slide) => ({
          id: maybeNumber(slide.id),
          image: slide.image || "/assets/forum-logo.png",
          eyebrow: slide.eyebrow || "",
          title: slide.title || "Welcome",
          sort_order: sort++
      })), "save hero slides");
    }

    if (sectionKeys.includes("pages")) {
      let sort = 0;
      await saveSupabaseRows("pages", (data.pages || []).map((page) => ({
          id: maybeNumber(page.id),
          page_key: page.key || slugify(page.title, "page"),
          path: normalizePath(page.path),
          title: page.title || "Untitled page",
          subtitle: page.subtitle || "",
          image: page.image || "",
          render: page.render || "simple",
          download_label: page.downloadLabel || "",
          download_url: page.downloadUrl || "",
          filter: page.filter || "",
          body_json: toJson(page.body || []),
          sort_order: sort++
      })), "save pages");
    }

    if (sectionKeys.includes("committee")) {
      let sort = 0;
      await saveSupabaseCommitteeRows((data.committee || []).map((person) => ({
        id: maybeNumber(person.id),
        member_id: maybeNumber(person.memberId),
        role: person.role || "Member",
        year: person.year || "",
        type: committeeType(person.type),
        status: committeeStatus(person.status),
        designation_order: committeeDesignationOrder(person, sort),
        passing_year: person.passingYear || "",
        biography: person.biography || "",
        message: person.message || "",
        sort_order: maybeInteger(person.sortOrder, sort++)
      })));
    }

    if (sectionKeys.includes("members")) {
      await saveMembersSection(data.members || []);
    }

    if (sectionKeys.includes("posts")) {
      let sort = 0;
      await saveSupabaseRows("posts", (data.posts || []).map((post) => {
        const slug = post.slug || slugify(post.title, "post");
        return {
          id: maybeNumber(post.id),
          type: post.category || "News",
          date: post.date || new Date().toISOString().slice(0, 10),
          title: post.title || "Untitled post",
          slug,
          path: normalizePath(post.path || slug),
          image: post.image || "",
          excerpt: post.excerpt || "",
          body_json: toJson(post.body || []),
          sort_order: sort++
        };
      }), "save posts");
    }

    if (sectionKeys.includes("gallery")) {
      let sort = 0;
      await saveSupabaseRows("gallery", (data.gallery || []).map((item) => ({
          id: maybeNumber(item.id),
          image: item.image || "/assets/forum-logo.png",
          title: item.title || "",
          sort_order: sort++
      })), "save gallery");
    }
  } else {
    await clearSiteSections(sectionKeys);
    if (sectionKeys.includes("settings")) {
      for (const [name, value] of Object.entries(data.settings || {})) {
        await querySQLite("INSERT INTO settings (name, value_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json", [
          name,
          toJson(value)
        ]);
      }
    }

    if (sectionKeys.includes("navigation")) {
      let sort = 0;
      for (const item of data.navigation || []) {
        await querySQLite("INSERT INTO navigation (label, path, sort_order) VALUES (?, ?, ?)", [
          item.label || "Menu item",
          normalizePath(item.path),
          sort++
        ]);
      }
    }

    if (sectionKeys.includes("topLinks")) {
      let sort = 0;
      for (const item of data.topLinks || []) {
        await querySQLite("INSERT INTO top_links (label, path, sort_order) VALUES (?, ?, ?)", [
          item.label || "Top link",
          normalizePath(item.path),
          sort++
        ]);
      }
    }

    if (sectionKeys.includes("heroSlides")) {
      let sort = 0;
      for (const slide of data.heroSlides || []) {
        await querySQLite("INSERT INTO hero_slides (image, eyebrow, title, sort_order) VALUES (?, ?, ?, ?)", [
          slide.image || "/assets/forum-logo.png",
          slide.eyebrow || "",
          slide.title || "Welcome",
          sort++
        ]);
      }
    }

    if (sectionKeys.includes("pages")) {
      let sort = 0;
      for (const page of data.pages || []) {
        await querySQLite(
          "INSERT INTO pages (page_key, path, title, subtitle, image, render, download_label, download_url, filter, body_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            page.key || slugify(page.title, "page"),
            normalizePath(page.path),
            page.title || "Untitled page",
            page.subtitle || "",
            page.image || "",
            page.render || "simple",
            page.downloadLabel || "",
            page.downloadUrl || "",
            page.filter || "",
            toJson(page.body || []),
            sort++
          ]
        );
      }
    }

    if (sectionKeys.includes("committee")) {
      let sort = 0;
      for (const person of data.committee || []) {
        const sortOrder = maybeInteger(person.sortOrder, sort++);
        await querySQLite(
          "INSERT INTO committee (id, member_id, role, year, type, status, designation_order, passing_year, biography, message, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            maybeNumber(person.id) || null,
            maybeNumber(person.memberId) || null,
            person.role || "Member",
            person.year || "",
            committeeType(person.type),
            committeeStatus(person.status),
            committeeDesignationOrder(person, sortOrder),
            person.passingYear || "",
            person.biography || "",
            person.message || "",
            sortOrder
          ]
        );
      }
    }

    if (sectionKeys.includes("members")) {
      await saveMembersSection(data.members || []);
    }

    if (sectionKeys.includes("posts")) {
      let sort = 0;
      for (const post of data.posts || []) {
        const slug = post.slug || slugify(post.title, "post");
        await querySQLite(
          "INSERT INTO posts (slug, path, type, date, title, excerpt, body_json, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            slug,
            normalizePath(post.path || slug),
            post.category || "News",
            post.date || new Date().toISOString().slice(0, 10),
            post.title || "Untitled post",
            post.excerpt || "",
            toJson(post.body || []),
            post.image || "",
            sort++
          ]
        );
      }
    }

    if (sectionKeys.includes("gallery")) {
      let sort = 0;
      for (const item of data.gallery || []) {
        await querySQLite("INSERT INTO gallery (image, title, sort_order) VALUES (?, ?, ?)", [
          item.image || "/assets/forum-logo.png",
          item.title || "",
          sort++
        ]);
      }
    }
  }

  await setMeta("updatedAt", updatedAt);
  return { updatedAt };
}

async function replaceSite(data) {
  const updatedAt = new Date().toISOString();
  await clearEditableTables();

  if (isSupabase) {
    const settings = data.settings || {};
    for (const [name, value] of Object.entries(settings)) {
      await insertSupabase("settings", { name, value_json: toJson(value) }, `save setting ${name}`);
    }

    let sort = 0;
    for (const item of data.navigation || []) {
      await insertSupabase("navigation", {
        id: maybeNumber(item.id),
        label: item.label || "Menu item",
        path: normalizePath(item.path),
        sort_order: sort++
      });
    }

    sort = 0;
    for (const item of data.topLinks || []) {
      await insertSupabase("top_links", {
        id: maybeNumber(item.id),
        label: item.label || "Top link",
        path: normalizePath(item.path),
        sort_order: sort++
      });
    }

    sort = 0;
    for (const slide of data.heroSlides || []) {
      await insertSupabase("hero_slides", {
        id: maybeNumber(slide.id),
        image: slide.image || "/assets/forum-logo.png",
        eyebrow: slide.eyebrow || "",
        title: slide.title || "Welcome",
        sort_order: sort++
      });
    }

    sort = 0;
    for (const page of data.pages || []) {
      await insertSupabase("pages", {
        id: maybeNumber(page.id),
        page_key: page.key || slugify(page.title, "page"),
        path: normalizePath(page.path),
        title: page.title || "Untitled page",
        subtitle: page.subtitle || "",
        image: page.image || "",
        render: page.render || "simple",
        download_label: page.downloadLabel || "",
        download_url: page.downloadUrl || "",
        filter: page.filter || "",
        body_json: toJson(page.body || []),
        sort_order: sort++
      });
    }

    sort = 0;
    await saveSupabaseCommitteeRows((data.committee || []).map((person) => {
      const member = findPayloadMember(data, person.memberId);
      const fallback = committeeFallback(person, member);
      const sortOrder = maybeInteger(person.sortOrder, sort++);
      return {
        id: maybeNumber(person.id),
        member_id: maybeNumber(person.memberId),
        role: person.role || "Member",
        year: person.year || "",
        type: committeeType(person.type),
        status: committeeStatus(person.status),
        designation_order: committeeDesignationOrder(person, sortOrder),
        passing_year: fallback.passingYear || "",
        biography: person.biography || "",
        message: person.message || "",
        sort_order: sortOrder
      };
    }));

    sort = 0;
    for (const member of data.members || []) {
      await insertSupabase("members", {
        id: maybeNumber(member.id),
        name: member.name || "Member",
        email: member.email || "",
        phone: member.phone || "",
        address: member.address || "",
        batch: member.batch || "",
        type: member.type || "",
        image: member.image || "",
        sort_order: sort++
      });
    }

    sort = 0;
    for (const post of data.posts || []) {
      const slug = post.slug || slugify(post.title, "post");
      await insertSupabase("posts", {
        id: maybeNumber(post.id),
        type: post.category || "News",
        date: post.date || new Date().toISOString().slice(0, 10),
        title: post.title || "Untitled post",
        slug,
        path: normalizePath(post.path || slug),
        image: post.image || "",
        excerpt: post.excerpt || "",
        body_json: toJson(post.body || []),
        sort_order: sort++
      });
    }

    sort = 0;
    for (const item of data.gallery || []) {
      await insertSupabase("gallery", {
        id: maybeNumber(item.id),
        image: item.image || "/assets/forum-logo.png",
        title: item.title || "",
        sort_order: sort++
      });
    }
  } else {
    await replaceSiteSQLite(data);
  }

  await setMeta("updatedAt", updatedAt);
  return { updatedAt };
}

async function replaceSiteSQLite(data) {
  const settings = data.settings || {};
  for (const [name, value] of Object.entries(settings)) {
    await querySQLite("INSERT INTO settings (name, value_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json", [
      name,
      toJson(value)
    ]);
  }

  let sort = 0;
  for (const item of data.navigation || []) {
    await querySQLite("INSERT INTO navigation (label, path, sort_order) VALUES (?, ?, ?)", [
      item.label || "Menu item",
      normalizePath(item.path),
      sort++
    ]);
  }

  sort = 0;
  for (const item of data.topLinks || []) {
    await querySQLite("INSERT INTO top_links (label, path, sort_order) VALUES (?, ?, ?)", [
      item.label || "Top link",
      normalizePath(item.path),
      sort++
    ]);
  }

  sort = 0;
  for (const slide of data.heroSlides || []) {
    await querySQLite("INSERT INTO hero_slides (image, eyebrow, title, sort_order) VALUES (?, ?, ?, ?)", [
      slide.image || "/assets/forum-logo.png",
      slide.eyebrow || "",
      slide.title || "Welcome",
      sort++
    ]);
  }

  sort = 0;
  for (const page of data.pages || []) {
    await querySQLite(
      "INSERT INTO pages (page_key, path, title, subtitle, image, render, download_label, download_url, filter, body_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        page.key || slugify(page.title, "page"),
        normalizePath(page.path),
        page.title || "Untitled page",
        page.subtitle || "",
        page.image || "",
        page.render || "simple",
        page.downloadLabel || "",
        page.downloadUrl || "",
        page.filter || "",
        toJson(page.body || []),
        sort++
      ]
    );
  }

  sort = 0;
  for (const person of data.committee || []) {
    const member = findPayloadMember(data, person.memberId);
    const fallback = committeeFallback(person, member);
    const sortOrder = maybeInteger(person.sortOrder, sort++);
    await querySQLite(
      "INSERT INTO committee (id, member_id, role, year, type, status, designation_order, passing_year, biography, message, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        maybeNumber(person.id) || null,
        maybeNumber(person.memberId) || null,
        person.role || "Member",
        person.year || "",
        committeeType(person.type),
        committeeStatus(person.status),
        committeeDesignationOrder(person, sortOrder),
        fallback.passingYear || "",
        person.biography || "",
        person.message || "",
        sortOrder
      ]
    );
  }

  sort = 0;
  for (const member of data.members || []) {
    await querySQLite(
      "INSERT INTO members (id, name, email, phone, address, batch, type, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        maybeNumber(member.id) || null,
        member.name || "Member",
        member.email || "",
        member.phone || "",
        member.address || "",
        member.batch || "",
        member.type || "",
        member.image || "",
        sort++
      ]
    );
  }

  sort = 0;
  for (const post of data.posts || []) {
    const slug = post.slug || slugify(post.title, "post");
    await querySQLite(
      "INSERT INTO posts (slug, path, type, date, title, excerpt, body_json, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        slug,
        normalizePath(post.path || slug),
        post.category || "News",
        post.date || new Date().toISOString().slice(0, 10),
        post.title || "Untitled post",
        post.excerpt || "",
        toJson(post.body || []),
        post.image || "",
        sort++
      ]
    );
  }

  sort = 0;
  for (const item of data.gallery || []) {
    await querySQLite("INSERT INTO gallery (image, title, sort_order) VALUES (?, ?, ?)", [
      item.image || "/assets/forum-logo.png",
      item.title || "",
      sort++
    ]);
  }
}

async function init() {
  if (isSupabase) {
    console.log("Supabase client active.");
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS navigation (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS top_links (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hero_slides (id INTEGER PRIMARY KEY AUTOINCREMENT, image TEXT NOT NULL, eyebrow TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, page_key TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, image TEXT, render TEXT NOT NULL, download_label TEXT, download_url TEXT, filter TEXT, body_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS committee (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, role TEXT NOT NULL, year TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Executive Committee', status TEXT NOT NULL DEFAULT 'active', designation_order INTEGER NOT NULL DEFAULT 9999, passing_year TEXT, biography TEXT, message TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, path TEXT, type TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, body_json TEXT NOT NULL, image TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, image TEXT NOT NULL, title TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, batch TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'new', payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, batch TEXT, type TEXT, image TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, permissions_json TEXT, is_admin INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, member_id INTEGER);
    CREATE TABLE IF NOT EXISTS forum_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, author_name TEXT, title TEXT NOT NULL, category TEXT, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS forum_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id TEXT NOT NULL, author_name TEXT, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS forum_likes (post_id INTEGER NOT NULL, user_id TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (post_id, user_id));
  `);

  try {
    db.exec("ALTER TABLE committee ADD COLUMN member_id INTEGER");
  } catch {
    // Column already exists in newer local databases.
  }

  try {
    db.exec("ALTER TABLE committee ADD COLUMN type TEXT NOT NULL DEFAULT 'Executive Committee'");
  } catch {
    // Column already exists in newer local databases.
  }

  try {
    db.exec("ALTER TABLE committee ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  } catch {
    // Column already exists in newer local databases.
  }

  try {
    db.exec("ALTER TABLE committee ADD COLUMN designation_order INTEGER NOT NULL DEFAULT 9999");
  } catch {
    // Column already exists in newer local databases.
  }

  const settings = await readSettings();
  if (!Object.keys(settings).length) {
    const seedPath = path.join(__dirname, "data", "site.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      await replaceSite(seed);
    }
  }
}

module.exports = {
  getPublicSite: () => readSite(false),
  getAdminSite: () => readSite(true),
  getMemberById,
  getUserByEmail,
  updateUserPassword,
  updateUserAccount,
  updateUserPermissions,
  updateMemberProfile,
  getAllMembersWithUsers,
  createUserForMember,
  syncCommitteeMembersAndUsers,
  registerMemberUser,
  approveApplication,
  rejectApplication,
  resetUserPassword,
  updateSubmission,
  deleteSubmission,
  getForumPosts,
  createForumPost,
  addForumComment,
  toggleForumLike,
  getUsers: async () => {
    if (isSupabase) {
      const result = await supabase.from("users").select("*");
      const rows = assertSupabase(result, "read users") || [];
      return rows.map((u) => ({ ...u, permissions: fromJson(u.permissions_json, []) }));
    }
    const res = await querySQLite("SELECT * FROM users");
    return res.rows.map((u) => ({ ...u, permissions: fromJson(u.permissions_json, []) }));
  },
  replaceSite,
  saveSiteSections,
  addApplication: (body) => addSubmission("applications", body),
  addMessage: (body) => addSubmission("messages", body),
  hashPassword,
  fromJson,
  init
};
