const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "data", "site.db"));

function hashPassword(password) {
    if (!password) return "empty_hash";
    return crypto.createHash("sha256").update(password).digest("hex");
}

const users = db.prepare("SELECT id, email, phone, password_hash, must_change_password, is_admin FROM users").all();
console.log("All users in DB:");
users.forEach(u => {
    console.log(`  email: ${u.email}`);
    console.log(`  phone: ${u.phone}`);
    console.log(`  is_admin: ${u.is_admin}`);
    console.log(`  must_change_password: ${u.must_change_password}`);
    console.log(`  stored hash: ${u.password_hash}`);
    console.log(`  hash('admin123'): ${hashPassword('admin123')}`);
    console.log(`  match admin123: ${u.password_hash === hashPassword('admin123')}`);
    if (u.phone) {
        console.log(`  hash(phone): ${hashPassword(u.phone)}`);
        console.log(`  match phone: ${u.password_hash === hashPassword(u.phone)}`);
    }
    console.log("---");
});
