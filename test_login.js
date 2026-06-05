// Test password hashing and login with new async DB
const crypto = require("crypto");
function hashPassword(password) {
    if (!password) return "empty_hash";
    return crypto.createHash("sha256").update(password).digest("hex");
}

const http = require("http");

function testLogin(username, password) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ username, password });
        const options = {
            hostname: "localhost",
            port: 3000,
            path: "/api/admin/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            }
        };
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", (e) => resolve({ error: e.message }));
        req.write(payload);
        req.end();
    });
}

(async () => {
    console.log("\n=== Testing Login API (Async) ===");
    try {
        const r1 = await testLogin("admin", "admin123");
        console.log(`admin/admin123 → ${r1.status}: ${r1.body}`);

        const r2 = await testLogin("khaled@example.com", "khaled123");
        console.log(`khaled/khaled123 → ${r2.status}: ${r2.body}`);
    } catch (e) {
        console.error("Test failed:", e);
    }
})();
