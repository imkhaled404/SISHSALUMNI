const { getAdminSite, getUsers } = require("./db");
const site = getAdminSite();
console.log("Members count:", site.members.length);
console.log("Users count:", getUsers().length);
console.log("First 2 Users:", getUsers().slice(0, 2));
