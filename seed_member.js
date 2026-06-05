const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "data", "site.db"));

// Add a test member with email and phone
db.prepare("INSERT INTO members (name, email, phone, address, batch, type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("Khaled", "khaled@example.com", "01700000000", "Dhaka", "2010", "Life", 99);

console.log("Member seeded. Now restart the server or run users sync.");
