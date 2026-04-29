import "dotenv/config";
import path from "path";
import { MongoClient } from "mongodb";
import xlsx from "xlsx";
import { buildSearchDocument, inferCompanyDomain } from "../lib/matching.js";

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!mongoUri) {
  console.error("Missing MONGODB_URI (or DATABASE_URL) in .env");
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

const run = async () => {
  const client = new MongoClient(mongoUri, { serverApi: { version: "1" } });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "cv_assist");
  const coll = db.collection(tableName);

  // clear existing collection for fresh import
  await coll.deleteMany({});

  let totalInserted = 0;

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    const workbook = xlsx.readFile(filePath, { cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    const headerKeys = rows.length ? Object.keys(rows[0]) : [];

    let inserted = 0;
    for (const row of rows) {
      const record = mapRow(row, headerKeys);
      if (!record) continue;
      if (!record.company_name) continue;
      const domainMeta = inferCompanyDomain(record);
      const enrichedRecord = {
        ...record,
        normalized_domain_key: domainMeta.domain_key,
        normalized_domain_label: domainMeta.domain_label,
        domain_keywords: domainMeta.domain_keywords || [],
        search_document: buildSearchDocument({ ...record, ...domainMeta }),
        created_at: new Date(),
        updated_at: new Date()
      };
      await coll.insertOne(enrichedRecord);
      inserted += 1;
    }

    totalInserted += inserted;
    console.log(`${file}: inserted ${inserted} rows`);
  }

  console.log(`Total inserted: ${totalInserted}`);
  await client.close();
};

run().catch((error) => {
  console.error("Import failed:", error?.message || error);
  process.exit(1);
});
