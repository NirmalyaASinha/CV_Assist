import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { DOMAIN_TAXONOMY, normalizeDomain, scoreCompanyMatch } from "./lib/matching.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

const maskConnectionString = (s) => {
  try {
    if (!s) return "(empty)";
    // hide password if present
    return s.replace(/:(?:[^:@]+)@/, ':*****@');
  } catch (e) {
    return "(invalid)";
  }
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection (preferred). Read MONGODB_URI first, otherwise try to use DATABASE_URL only if it looks like a Mongo URI.
const mongoUriRaw = process.env.MONGODB_URI || process.env.MONGO_URI || "";
let mongoUri = mongoUriRaw ? String(mongoUriRaw).trim().replace(/^['"]|['"]$/g, "") : "";
if (!mongoUri && databaseUrl && String(databaseUrl).toLowerCase().startsWith("mongodb")) {
  mongoUri = String(databaseUrl).trim();
}

let mongoClient = null;
let mongoDb = null;

if (!mongoUri) {
  console.warn("DB: No MongoDB URI found in MONGODB_URI (or DATABASE_URL). Using in-memory fallback.");
}

const dbState = {
  available: false,
  checked: false,
  errorMessage: databaseUrl
    ? "Database connection has not been established yet."
    : "DATABASE_URL is missing. Add your Neon connection string to .env."
};

// Simple in-memory fallback for CV analyses when no database is configured.
const inMemoryDb = {
  analyses: new Map(),
  nextId: 1
};

let useInMemoryFallback = false;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const DOMAIN_OPTIONS_TEXT = DOMAIN_TAXONOMY.map((domain) => domain.label).join(", ");
const CV_EXTRACTION_TIMEOUT_MS = 20000;
const AI_REQUEST_TIMEOUT_MS = 30000;
const MODELS = [
  'gemini-2.5-pro',           // best quality
  'gemini-2.5-flash',         // fast + smart
  'gemini-2.5-flash-lite',    // lighter 2.5
  'gemini-3.1-pro-preview',   // next gen pro
  'gemini-3.1-flash-lite-preview', // next gen lite
  'gemini-3-flash-preview',   // next gen flash
  'gemini-2.0-flash',         // reliable fallback
  'gemini-2.0-flash-001',     // stable 2.0
  'gemini-2.0-flash-lite',    // high quota fallback
  'gemini-2.0-flash-lite-001',// stable lite
  'gemini-flash-latest',      // alias — always latest flash
  'gemini-flash-lite-latest', // alias — always latest lite
];

const getDbErrorMessage = (error) => {
  if (!databaseUrl) {
    return "DATABASE_URL is missing. Add your Neon connection string to .env.";
  }

  if (error?.code === "ETIMEDOUT" || error?.code === "ENETUNREACH") {
    return "Database server is unreachable right now. Check your internet connection, Neon status, and whether the host allows outbound Postgres traffic.";
  }

  return error?.message || "Database is currently unavailable.";
};

const markDatabaseUnavailable = (error) => {
  dbState.available = false;
  dbState.checked = true;
  dbState.errorMessage = getDbErrorMessage(error);
};

const initializeDatabaseIfAvailable = async () => {
  if (!mongoUri || dbState.available || dbState.checked) return;

  console.log("DB: attempting to initialize. connection=", maskConnectionString(mongoUri));
  try {
    mongoClient = new MongoClient(mongoUri, {
      serverApi: { version: "1" },
      connectTimeoutMS: 5000
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DB_NAME || "cv_assist");

    // Ensure light-weight indexes for search_document and normalized_domain_key
    try {
      await mongoDb.collection("company_contacts").createIndex({ search_document: "text" }, { default_language: "english" });
    } catch (e) {
      // index creation may fail if running with restricted permissions; continue
      console.warn("DB: could not create text index on company_contacts.search_document:", e?.message || e);
    }

    dbState.available = true;
    dbState.checked = true;
    console.log("DB: connected and ready (MongoDB)");
  } catch (error) {
    console.error("DB: initialization error:", error?.message || error);
    markDatabaseUnavailable(error);
  }
};

const ensureDatabaseReady = async () => {
  // If no mongoUri is configured, allow execution using in-memory fallback.
  if (!mongoUri) {
    useInMemoryFallback = true;
    return;
  }

  if (dbState.available) return;

  await initializeDatabaseIfAvailable();

  if (!dbState.available) {
    useInMemoryFallback = true;
    return;
  }
};

const analyzeCvDomain = async (text) => {
  const apiKey = process.env.GOOGLE_AI_KEY;

  // Fallback heuristic when Google AI key is not configured.
  if (!apiKey) {
    const lower = String(text || "").toLowerCase();

    // Try to guess domain by label presence
    let guessed = null;
    for (const d of DOMAIN_TAXONOMY) {
      const label = String(d.label || "").toLowerCase();
      if (!label) continue;
      if (lower.includes(label)) {
        guessed = d.label;
        break;
      }
    }

    // Lightweight keyword extraction using common technical terms
    const techs = [
      "python",
      "javascript",
      "react",
      "node",
      "sql",
      "postgres",
      "machine learning",
      "ml",
      "data",
      "tensorflow",
      "java",
      "c++",
      "c#",
      "html",
      "css",
      "django",
      "flask",
      "express",
      "aws",
      "docker",
      "kubernetes"
    ];

    const found = techs.filter((t) => lower.includes(t)).slice(0, 6);

    const normalized = normalizeDomain(guessed || "", [
      ...found,
      text.slice(0, 2000)
    ]);

    const suggestedRoles = (() => {
      if (found.some((f) => f.includes("machine") || f === "ml")) return ["Machine Learning Intern", "Data Analyst"];
      if (found.includes("react") || found.includes("javascript")) return ["Frontend Intern", "Full-Stack Intern"];
      if (found.includes("python") || found.includes("django") || found.includes("flask")) return ["Backend Intern", "Software Engineer Intern"];
      return ["Intern"];
    })();

    const summary = `Your CV appears to align with ${normalized.label}.`;
    const feedbackHighlights = [
      found.length ? `Highlight projects using ${found[0]}` : "Add concrete project examples with outcomes.",
      "Use role-specific keywords near the top of your CV.",
      "Include measurable results (percentages, numbers) where possible."
    ];

    return {
      originalDomain: guessed || normalized.label,
      normalizedDomainKey: normalized.key,
      normalizedDomainLabel: normalized.label,
      keywords: found,
      suggestedRoles: suggestedRoles.slice(0, 4),
      summary,
      feedbackHighlights
    };
  }

  const { payload } = await callGeminiWithFallback({
    systemInstruction: {
      parts: [
        {
          text:
            `You analyze student CVs for internship matching. Choose the best matching domain from this list only: ${DOMAIN_OPTIONS_TEXT}. Respond with JSON only using keys "domain", "keywords", "suggested_roles", "summary", and "feedback_highlights". "domain" must be one exact domain label from the list. "keywords" must be an array of up to 6 technical or role terms. "suggested_roles" must be an array of up to 4 role titles. "summary" must be one sentence. "feedback_highlights" must be an array of 3 concise bullet-style strings.`
        }
      ]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Analyze this CV text for student opportunity matching.\\n\\nCV:\\n${text.slice(0, 16000)}`
          }
        ]
      }
    ]
  });

  const reply = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJsonFromText(reply);
  const normalized = normalizeDomain(parsed.domain, [
    ...(cleanStringArray(parsed.keywords, 6)),
    ...(cleanStringArray(parsed.suggested_roles, 4)),
    text.slice(0, 2000)
  ]);

  return {
    originalDomain: String(parsed.domain || "").trim() || normalized.label,
    normalizedDomainKey: normalized.key,
    normalizedDomainLabel: normalized.label,
    keywords: cleanStringArray(parsed.keywords, 6),
    suggestedRoles: cleanStringArray(parsed.suggested_roles, 4),
    summary:
      String(parsed.summary || "").trim() ||
      `Your CV aligns most strongly with ${normalized.label}.`,
    feedbackHighlights: cleanStringArray(parsed.feedback_highlights, 4)
  };
};

const renderLanding = (res, overrides = {}) => {
  return res.status(overrides.status || 200).render("index", {
    title: overrides.title || "CV Assist",
    subtitle: overrides.subtitle || "Simple dashboard for students to upload CVs and discover opportunities",
    errorMessage: overrides.errorMessage || ""
  });
};

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS) => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });

  const payload = await response.json();
  return { response, payload };
};

const isGeminiQuotaError = (response, payload, error) => {
  if (response?.status === 429) return true;

  const message = String(payload?.error?.message || error?.message || "").toLowerCase();
  return message.includes("quota exceeded") || message.includes("resource_exhausted");
};

const callGeminiWithFallback = async (prompt, timeoutMs = AI_REQUEST_TIMEOUT_MS) => {
  const apiKey = process.env.GOOGLE_AI_KEY;

  for (const model of MODELS) {
    console.log("Using model:", model);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const { response, payload } = await fetchJsonWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(prompt)
        },
        timeoutMs
      );

      if (!response.ok) {
        if (isGeminiQuotaError(response, payload)) {
          console.log(`Model quota failed: ${model}`);
          continue;
        }

        throw new Error(payload?.error?.message || "Google AI request failed.");
      }

      return { response, payload };
    } catch (error) {
      if (isGeminiQuotaError(null, null, error)) {
        console.log(`Model quota failed: ${model}`);
        continue;
      }

      throw error;
    }
  }

  throw new Error("All Gemini models quota exceeded. Try again later.");
};

const decodeXmlText = (value) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const extractPdfText = async (fileBuffer) => {
  const data = await pdfParse(fileBuffer);
  return String(data.text || "").trim();
};

const extractDocxText = async (fileBuffer) => {
  const tempPath = path.join(os.tmpdir(), `cv-assist-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`);

  try {
    await fs.writeFile(tempPath, fileBuffer);
    const { stdout } = await execFileAsync("unzip", ["-p", tempPath, "word/document.xml"], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: CV_EXTRACTION_TIMEOUT_MS
    });
    return decodeXmlText(stdout);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
};

const extractCvText = async (file) => {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (extension === ".pdf") {
    return extractPdfText(file.buffer);
  }

  if (extension === ".docx") {
    return extractDocxText(file.buffer);
  }

  if (extension === ".txt" || extension === ".md") {
    const contents = Buffer.from(file.buffer || "").toString("utf8");
    return String(contents || "").trim();
  }

  if (extension === ".doc") {
    throw new Error("Legacy .doc files are not supported yet. Please upload a PDF or DOCX file.");
  }

  throw new Error("Unsupported file format. Please upload a PDF or DOCX file.");
};

const parseJsonFromText = (text) => {
  const trimmed = String(text || "").trim();
  const direct = trimmed.match(/\{[\s\S]*\}/);
  if (!direct) {
    throw new Error("No JSON object found in AI response.");
  }

  return JSON.parse(direct[0]);
};

const cleanStringArray = (value, limit = 6) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
};



const saveCvAnalysis = async (analysis) => {
  if (!mongoDb || useInMemoryFallback) {
    const id = String(inMemoryDb.nextId++);
    inMemoryDb.analyses.set(id, {
      id,
      originalDomain: analysis.originalDomain,
      normalizedDomainKey: analysis.normalizedDomainKey,
      normalizedDomainLabel: analysis.normalizedDomainLabel,
      keywords: analysis.keywords || [],
      suggestedRoles: analysis.suggestedRoles || [],
      summary: analysis.summary || "",
      feedbackHighlights: analysis.feedbackHighlights || [],
      searchQuery: analysis.searchQuery || "",
      extractedText: analysis.extractedText || "",
      createdAt: new Date().toISOString()
    });
    return id;
  }

  await ensureDatabaseReady();
  const doc = {
    original_domain: analysis.originalDomain,
    normalized_domain_key: analysis.normalizedDomainKey,
    normalized_domain_label: analysis.normalizedDomainLabel,
    keywords: analysis.keywords || [],
    suggested_roles: analysis.suggestedRoles || [],
    summary: analysis.summary || "",
    feedback_highlights: analysis.feedbackHighlights || [],
    search_query: analysis.searchQuery || "",
    extracted_text: analysis.extractedText || "",
    created_at: new Date()
  };

  const result = await mongoDb.collection("cv_analyses").insertOne(doc);
  return result.insertedId?.toString();
};

const getCvAnalysis = async (id) => {
  if (!id) return null;

  if (!mongoDb || useInMemoryFallback) {
    const row = inMemoryDb.analyses.get(String(id));
    if (!row) return null;
    return {
      id: row.id,
      originalDomain: row.originalDomain,
      normalizedDomainKey: row.normalizedDomainKey,
      normalizedDomainLabel: row.normalizedDomainLabel,
      keywords: row.keywords || [],
      suggestedRoles: row.suggestedRoles || [],
      summary: row.summary || "",
      feedbackHighlights: row.feedbackHighlights || [],
      searchQuery: row.searchQuery || "",
      createdAt: row.createdAt
    };
  }

  await ensureDatabaseReady();

  let row = null;
  try {
    if (ObjectId.isValid(id)) {
      row = await mongoDb.collection("cv_analyses").findOne({ _id: new ObjectId(id) });
    } else {
      // If id is not a valid ObjectId, attempt to find by string id field (legacy fallback)
      row = await mongoDb.collection("cv_analyses").findOne({ _id: id });
    }
  } catch (e) {
    // ignore and return null
    row = null;
  }

  if (!row) return null;

  return {
    id: row._id?.toString(),
    originalDomain: row.original_domain,
    normalizedDomainKey: row.normalized_domain_key,
    normalizedDomainLabel: row.normalized_domain_label,
    keywords: row.keywords || [],
    suggestedRoles: row.suggested_roles || [],
    summary: row.summary || "",
    feedbackHighlights: row.feedback_highlights || [],
    searchQuery: row.search_query || "",
    extractedText: row.extracted_text || "",
    createdAt: row.created_at
  };
};

const fetchCompanies = async (filters, analysis) => {
  await ensureDatabaseReady();
  if (!mongoDb || useInMemoryFallback) return [];

  // Build MongoDB query using $and groups to match SQL semantics
  const ands = [];

  if (filters.q) {
    const qRegex = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    ands.push({ $or: [{ search_document: { $regex: qRegex } }, { company_name: { $regex: qRegex } }] });
  }

  if (filters.location) {
    const locRegex = new RegExp(filters.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    ands.push({ location: { $regex: locRegex } });
  }

  if (filters.status) {
    const statusRegex = new RegExp(filters.status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    ands.push({ status: { $regex: statusRegex } });
  }

  if (analysis?.normalizedDomainKey && analysis.normalizedDomainKey !== "general") {
    const orDomain = [];
    orDomain.push({ normalized_domain_key: analysis.normalizedDomainKey });

    for (const term of [...(analysis.keywords || []), ...(analysis.suggestedRoles || [])].slice(0, 6)) {
      const t = String(term || "").trim();
      if (!t) continue;
      orDomain.push({ search_document: { $regex: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } });
    }

    if (orDomain.length) {
      ands.push({ $or: orDomain });
    }
  }

  const query = ands.length ? { $and: ands } : {};

  const cursor = mongoDb.collection("company_contacts").find(query).sort({ company_name: 1 }).limit(250);
  const rows = await cursor.toArray();
  return rows;
};

app.get("/", (req, res) => renderLanding(res));

app.get("/dashboard", (req, res) => {
  res.redirect("/results");
});

app.get("/results", async (req, res) => {
  const sessionId = typeof req.query.session === "string" ? req.query.session : "";
  let analysis = null;

  try {
    analysis = await getCvAnalysis(sessionId);
  } catch (error) {
    markDatabaseUnavailable(error);
  }

  const searchQuery = analysis?.searchQuery || (typeof req.query.q === "string" ? req.query.q : "");

  res.render("results", {
    title: "Results",
    companies: [],
    sessionId,
    searchQuery,
    detectedDomain: analysis?.normalizedDomainLabel || "Upload a CV to detect your domain",
    detectedSummary: analysis?.summary || "Your filtered results will appear here after CV analysis.",
    detectedKeywords: analysis?.keywords || [],
    suggestedRoles: analysis?.suggestedRoles || [],
    feedbackHighlights: analysis?.feedbackHighlights || [],
    dbErrorMessage: dbState.available ? "" : dbState.errorMessage
  });
});

app.get("/api/cv-analysis", async (req, res) => {
  try {
    const analysis = await getCvAnalysis(typeof req.query.session === "string" ? req.query.session : "");
    if (!analysis) {
      return res.status(404).json({ error: "No CV analysis found for that session." });
    }

    return res.json({
      data: analysis
    });
  } catch (error) {
    markDatabaseUnavailable(error);
    return res.status(503).json({ error: dbState.errorMessage });
  }
});

app.post("/upload", upload.single("cv"), async (req, res) => {
  if (!req.file) {
    return renderLanding(res, {
      status: 400,
      errorMessage: "Please upload a CV file before searching."
    });
  }

  try {
    await ensureDatabaseReady();
    const cvText = await extractCvText(req.file);
    if (!cvText) {
      return renderLanding(res, {
        status: 400,
        errorMessage: "We could not extract text from that CV. Try a clearer PDF or DOCX file."
      });
    }

    const searchQuery = typeof req.body.q === "string" ? req.body.q.trim() : "";
    const analysis = await analyzeCvDomain(cvText);
    const sessionId = await saveCvAnalysis({
      ...analysis,
      searchQuery,
      extractedText: cvText.slice(0, 30000)
    });

    const query = new URLSearchParams({ session: sessionId });
    if (searchQuery) {
      query.set("q", searchQuery);
    }

    return res.redirect(`/results?${query.toString()}`);
  } catch (error) {
    const message =
      error?.name === "TimeoutError"
        ? "Request timed out while processing the CV. Please try again."
        : error?.message || "Failed to process the uploaded CV.";
    return renderLanding(res, {
      status: 400,
      errorMessage: message
    });
  } finally {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
});

app.get("/api/companies", async (req, res) => {
  try {
    const analysis = await getCvAnalysis(typeof req.query.session === "string" ? req.query.session : "");
    const filters = {
      q: String(req.query.q || "").trim(),
      location: String(req.query.location || "").trim(),
      status: String(req.query.status || "").trim()
    };

    const companies = await fetchCompanies(filters, analysis);
    const ranked = companies
      .map((company) => ({
        ...company,
        ...scoreCompanyMatch(company, analysis, filters)
      }))
      .filter((company) => !analysis || company.relevance_score > 0 || !analysis.normalizedDomainKey)
      .sort((left, right) => {
        if (right.relevance_score !== left.relevance_score) {
          return right.relevance_score - left.relevance_score;
        }
        return String(left.company_name).localeCompare(String(right.company_name));
      });

    return res.json({
      data: ranked,
      meta: {
        count: ranked.length,
        detectedDomain: analysis?.normalizedDomainLabel || null
      }
    });
  } catch (error) {
    markDatabaseUnavailable(error);
    return res.status(503).json({ error: dbState.errorMessage });
  }
});

app.post("/api/ai/feedback", async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing CV text." });
  }
  const apiKey = process.env.GOOGLE_AI_KEY;

  // Desired structured response keys
  // - next_steps: array of 3 concise suggestions for next life/career steps
  // - improvements: array of 3 actionable improvements
  // - tone_and_skills: array of 3 suggestions for skills, language or tone to add to CV

  if (!apiKey) {
    // Fallback heuristic: extract some keywords and propose generic suggestions
    const lower = String(text || "").toLowerCase();
    const techs = [
      "python",
      "javascript",
      "react",
      "node",
      "sql",
      "postgres",
      "machine learning",
      "data",
      "java",
      "c++",
      "html",
      "css",
      "django",
      "flask",
      "aws",
      "docker"
    ];

    const found = techs.filter((t) => lower.includes(t)).slice(0, 6);

    const next_steps = [];
    if (found.length) {
      next_steps.push(`Pursue internships or projects using ${found[0]}`);
      if (found.length > 1) next_steps.push(`Build a small project combining ${found.slice(0, 2).join(" and ")}`);
    } else {
      next_steps.push("Gather a short list of recent projects or coursework to showcase.");
    }
    next_steps.push("Apply to 3 relevant internships in the next month.");
    if (next_steps.length > 3) next_steps.splice(3);

    const improvements = [
      found.length ? `Quantify impact in projects (e.g. performance, users, numbers) — e.g. ${found[0] || "your project"}` : "Add measurable outcomes to each project or role.",
      "Tailor your CV summary to the role you want (one-sentence focus).",
      "Shorten verbose descriptions and use bullet points with results."
    ];

    const tone_and_skills = [
      found.length ? `Emphasize ${found[0]} and related libraries/frameworks.` : "Highlight tools and languages used in projects.",
      "Use active verbs (developed, improved, implemented) and concise language.",
      "Adopt a professional, confident tone focused on outcomes and responsibilities."
    ];

    return res.json({ result: { next_steps, improvements, tone_and_skills } });
  }

  try {
    const { payload } = await callGeminiWithFallback({
      systemInstruction: {
        parts: [
          {
            text:
              `You are an expert career coach. Given a student's CV text, respond with a JSON object only containing keys: "next_steps", "improvements", "tone_and_skills". Each value must be an array of up to 3 concise bullet strings. "next_steps" should list personal/career actions they can take next. "improvements" should list actionable CV improvements. "tone_and_skills" should list skills, language, or tone changes to add to the CV.`
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text }]
        }
      ]
    });

    const reply = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed = null;
    try {
      parsed = parseJsonFromText(reply);
    } catch (e) {
      return res.status(500).json({ error: "AI did not return valid JSON." });
    }

    // Normalize and ensure arrays
    const next_steps = Array.isArray(parsed.next_steps) ? parsed.next_steps.slice(0, 3) : [];
    const improvements = Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 3) : [];
    const tone_and_skills = Array.isArray(parsed.tone_and_skills) ? parsed.tone_and_skills.slice(0, 3) : [];

    return res.json({ result: { next_steps, improvements, tone_and_skills } });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "AI feedback request timed out." : "Google AI request failed.";
    return res.status(500).json({ error: message });
  }
});

const start = async () => {
  try {
    if (mongoUri) {
      await initializeDatabaseIfAvailable();
    }
  } catch (error) {
    markDatabaseUnavailable(error);
  }

  if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
      console.log(`Running on http://localhost:${port}`);
    });
  }
};

start().catch((error) => {
  console.error("Failed to start server:", error?.message || error);
  process.exit(1);
});

export default app;
