require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const db = new DatabaseSync(path.join(__dirname, "data", "site.db"));

function fromJson(v, fallback = []) {
    try { return JSON.parse(v); } catch { return fallback; }
}

async function migrate() {
    console.log("Starting Data Migration from SQLite to Supabase...");

    try {
        // 1. Settings
        const settings = db.prepare("SELECT * FROM settings").all();
        console.log(`Migrating ${settings.length} settings...`);
        for (const s of settings) {
            await supabase.from("settings").upsert({ name: s.name, value_json: s.value_json });
        }

        // 2. Members
        const members = db.prepare("SELECT * FROM members").all();
        console.log(`Migrating ${members.length} members...`);
        for (const m of members) {
            // Supabase uses 'id' serial; we ignore old id if it was serial, but here it's likely fine to keep.
            await supabase.from("members").upsert(m);
        }

        // 3. Users
        const users = db.prepare("SELECT * FROM users").all();
        console.log(`Migrating ${users.length} users...`);
        for (const u of users) {
            await supabase.from("users").upsert(u);
        }

        // 4. Committee
        const committee = db.prepare("SELECT * FROM committee").all();
        console.log(`Migrating ${committee.length} committee members...`);
        for (const c of committee) {
            await supabase.from("committee").upsert(c);
        }

        // 5. Posts
        const posts = db.prepare("SELECT * FROM posts").all();
        console.log(`Migrating ${posts.length} posts...`);
        for (const p of posts) {
            await supabase.from("posts").upsert(p);
        }

        // 6. Navigation
        const navs = db.prepare("SELECT * FROM navigation").all();
        console.log(`Migrating ${navs.length} navigation items...`);
        for (const n of navs) {
            await supabase.from("navigation").upsert(n);
        }

        // 7. Pages
        const pages = db.prepare("SELECT * FROM pages").all();
        console.log(`Migrating ${pages.length} pages...`);
        for (const pg of pages) {
            await supabase.from("pages").upsert(pg);
        }

        // 8. Gallery
        const galleryItems = db.prepare("SELECT * FROM gallery").all();
        console.log(`Migrating ${galleryItems.length} gallery items...`);
        for (const gi of galleryItems) {
            await supabase.from("gallery").upsert(gi);
        }

        console.log("\nSUCCESS! All data migrated to the cloud.");
    } catch (err) {
        console.error("\nMIGRATION FAILED!");
        console.error(err.message);
        console.log("\nTIP: Make sure you ran the SQL in supabase_schema.sql first!");
    }
}

migrate();
