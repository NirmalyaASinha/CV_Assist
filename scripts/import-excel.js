import "dotenv/config";
import path from "path";
import pg from "pg";
import xlsx from "xlsx";
import { buildSearchDocument, inferCompanyDomain } from "../lib/matching.js";

const { Client } = pg;

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing NEON_DATABASE_URL or DATABASE_URL in .env");
  process.exit(1);
}

const files = [
  "Hidden_Gems_Startup_Search.xlsx",
  "Internship_Contacts_Master_List.xlsx",
  "Networking Outreach Strategy for Professionals.xlsx"
];

const tableName = "company_contacts";

const headerMap = {
  companyname: "company_name",
  company: "company_name",
  city: "location",
  domainfocus: "company_focus_brief",
  fundingstatus: "status",
  whyitfitsyourprofile: "why_relevant_to_you",
  companystagenotes: "company_focus_brief",
  foundercontactinfo: "contact_name",
  whyhiddengem: "outreach_approach",
  priority: "status",
  contactname: "contact_name",
  contact: "contact_name",
  nameofperson: "contact_name",
  emailid: "email_id",
  email: "email_id",
  emailaddress: "email_id",
  phone: "phone",
  role: "role",
  whatworktheydo: "role",
  whyrelevanttoyou: "why_relevant_to_you",
  companyfocusbrief: "company_focus_brief",
  companyfocusandbrief: "company_focus_brief",
  companyfocusbriefs: "company_focus_brief",
  whatworktheircompanydoes: "company_focus_brief",
  howshouldiapproachthem: "outreach_approach",
  whatshouldiapproachthembywhattowrite: "outreach_message",
  location: "location",
  status: "status"
};

const normalizeHeader = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const mapRow = (row, headerKeys) => {
  const record = {
    company_name: null,
    contact_name: null,
    email_id: null,
    phone: null,
    role: null,
    why_relevant_to_you: null,
    company_focus_brief: null,
    location: null,
    status: null,
    outreach_approach: null,
    outreach_message: null
  };

  for (const header of headerKeys) {
    const normalized = normalizeHeader(header);
    const target = headerMap[normalized];
    if (!target) continue;
    const value = row[header];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      record[target] = String(value).trim();
    }
  }

  const hasData = Object.values(record).some((value) => value);
  return hasData ? record : null;
};

const ensureTableSql = `
create table if not exists ${tableName} (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email_id text,
  phone text,
  role text,
  why_relevant_to_you text,
  company_focus_brief text,
  location text,
  status text,
  outreach_approach text,
  outreach_message text,
  normalized_domain_key text,
  normalized_domain_label text,
  domain_keywords text[] not null default '{}',
  search_document text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

const alterTableSql = `
alter table ${tableName} add column if not exists outreach_approach text;
alter table ${tableName} add column if not exists outreach_message text;
alter table ${tableName} add column if not exists normalized_domain_key text;
alter table ${tableName} add column if not exists normalized_domain_label text;
alter table ${tableName} add column if not exists domain_keywords text[] not null default '{}';
alter table ${tableName} add column if not exists search_document text;
`;

const insertSql = `
insert into ${tableName} (
  company_name,
  contact_name,
  email_id,
  phone,
  role,
  why_relevant_to_you,
  company_focus_brief,
  location,
  status,
  outreach_approach,
  outreach_message,
  normalized_domain_key,
  normalized_domain_label,
  domain_keywords,
  search_document
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15);
`;

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

const run = async () => {
  await client.connect();
  await client.query(ensureTableSql);
  await client.query(alterTableSql);
  await client.query(`truncate table ${tableName};`);

  let totalInserted = 0;

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    const workbook = xlsx.readFile(filePath, { cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    const headerKeys = rows.length ? Object.keys(rows[0]) : [];

    let inserted = 0;
    await client.query("begin");
    try {
      for (const row of rows) {
        const record = mapRow(row, headerKeys);
        if (!record) continue;
        if (!record.company_name) continue;
        const domainMeta = inferCompanyDomain(record);
        const enrichedRecord = {
          ...record,
          ...domainMeta,
          search_document: buildSearchDocument({
            ...record,
            ...domainMeta
          })
        };
        const values = [
          enrichedRecord.company_name,
          enrichedRecord.contact_name,
          enrichedRecord.email_id,
          enrichedRecord.phone,
          enrichedRecord.role,
          enrichedRecord.why_relevant_to_you,
          enrichedRecord.company_focus_brief,
          enrichedRecord.location,
          enrichedRecord.status,
          enrichedRecord.outreach_approach,
          enrichedRecord.outreach_message,
          enrichedRecord.domain_key,
          enrichedRecord.domain_label,
          enrichedRecord.domain_keywords,
          enrichedRecord.search_document
        ];
        await client.query(insertSql, values);
        inserted += 1;
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      console.error(`Import failed for ${file}:`, error.message);
      throw error;
    }

    totalInserted += inserted;
    console.log(`${file}: inserted ${inserted} rows`);
  }

  console.log(`Total inserted: ${totalInserted}`);
  await client.end();
};

run().catch((error) => {
  const details = {
    name: error?.name,
    code: error?.code,
    message: error?.message
  };
  console.error("Import failed:", details);
  process.exit(1);
});
