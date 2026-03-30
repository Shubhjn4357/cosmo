import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const localPath = process.env.WHISPER_DB_PATH ?? "./data/db/whisper.db";
const url = process.env.TURSO_DATABASE_URL || `file:${localPath.replace(/\\/g, "/")}`;

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  strict: true,
  verbose: true,
});
