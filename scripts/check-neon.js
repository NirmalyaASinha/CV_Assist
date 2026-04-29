import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing NEON_DATABASE_URL or DATABASE_URL in .env");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  const result = await client.query("select 1 as ok");
  console.log("Neon connectivity OK:", result.rows[0]);
  await client.end();
} catch (error) {
  const details = {
    name: error?.name,
    code: error?.code,
    message: error?.message
  };
  console.error("Neon connectivity failed:", details);
  console.error("If the connection string is quoted, remove the quotes in .env.");
  process.exit(1);
}
