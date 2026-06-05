import { hashPassword } from "../api/auth.js";

const password = process.argv[2];
if (!password) {
  console.error("usage: pnpm hash-password <password>");
  process.exit(1);
}
console.log(hashPassword(password));
console.error("\nSet this as POOL_PASSWORD_HASH in the api environment.");
