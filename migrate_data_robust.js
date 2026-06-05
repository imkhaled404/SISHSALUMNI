require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const db = new DatabaseSync(path.join(__dirname, "data", "site.db"));

async function safeUpsert(table, data) {
    const { error } = await supabase.from(table).upsert(data);
    if (error) {
        throw new Error(`Failed to upsert to ${table}: ${error.message}`);
    }
}

async function migrate() {
    console.log("=== Robust Data Migration ===");
    try {
        const tables = ["settings", "members", "users", "committee", "navigation", "pages", "posts", "hero_slides", "top_links", "gallery"];

        for (const table of tables) {
            console.log(`Checking table: ${table}...`);
            const { error: checkErr } = await supabase.from(table).select("count", { count: 'exact', head: true }).limit(1);
            if (checkErr) {
                console.error(`ERROR: Table '${table}' is missing or unreachable!`);
                console.error(`Message: ${checkErr.message}`);
                console.log(`TIP: You MUST run the code in 'supabase_schema.sql' in your Supabase SQL Editor first!`);
                return;
            }

            const rows = db.prepare(`SELECT * FROM ${table}`).all();
            console.log(`Migrating ${rows.length} rows to ${table}...`);
            for (const row of rows) {
                // Handle specific table mappings if needed
                let data = { ...row };
                if (table === "pages") {
                    data = {
                        page_key: row.page_key, path: row.path, title: row.title, subtitle: row.subtitle,
                        image: row.image, render: row.render, download_label: row.download_label,
                        download_url: row.download_url, filter: row.filter, body_json: row.body_json,
                        sort_order: row.sort_order
                    };
                }
                await safeUpsert(table, data);
            }
        }
        console.log("\nMigration completed successfully!");
    } catch (err) {
        console.error("\nMigration halted due to error:");
        console.error(err.message);
    }
}

migrate();
