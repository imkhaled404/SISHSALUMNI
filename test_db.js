require("dotenv").config();
const { Client } = require("pg");

console.log("=== Database Connection Tester ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Defined (Hidden for security)" : "MISSING!");

async function test() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Attempting to connect...");
        await client.connect();
        console.log("SUCCESS: Connected to database!");
        const res = await client.query("SELECT NOW()");
        console.log("Server time:", res.rows[0].now);
        await client.end();
    } catch (err) {
        console.error("CONNECTION FAILED!");
        console.error("Error Code:", err.code);
        console.error("Message:", err.message);

        if (err.message.includes("ENETUNREACH")) {
            console.log("\n--- DIAGNOSIS ---");
            console.log("Your network cannot reach the database server.");
            console.log("This usually means it is trying to use IPv6 but your network only supports IPv4.");
            console.log("FIX: Please go to Supabase -> Settings -> Database -> Connection String.");
            console.log("Copy the string from the 'Pooling' tab and use Port 6543.");
        }
    }
}

test();
