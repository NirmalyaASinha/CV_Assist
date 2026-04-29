export const DOMAIN_TAXONOMY = [
  {
    key: "vlsi-semiconductor",
    label: "VLSI & Semiconductor",
    keywords: [
      "vlsi",
      "semiconductor",
      "asic",
      "fpga",
      "soc",
      "risc-v",
      "rtl",
      "verilog",
      "systemverilog",
      "physical design",
      "chip design",
      "osat",
      "eda",
      "tape-out"
    ],
    roles: ["design engineer", "verification engineer", "physical design engineer", "rtl engineer"]
  },
  {
    key: "embedded-iot",
    label: "Embedded Systems & IoT",
    keywords: [
      "embedded",
      "firmware",
      "microcontroller",
      "microcontrollers",
      "iot",
      "rtos",
      "bare metal",
      "device driver",
      "sensor",
      "edge device",
      "wireless",
      "5g",
      "bluetooth"
    ],
    roles: ["embedded engineer", "firmware engineer", "iot engineer", "systems engineer"]
  },
  {
    key: "ai-ml",
    label: "AI / ML",
    keywords: [
      "ai",
      "ml",
      "machine learning",
      "deep learning",
      "llm",
      "computer vision",
      "nlp",
      "neural network",
      "edge ai",
      "data modeling"
    ],
    roles: ["ml engineer", "ai engineer", "data scientist", "research engineer"]
  },
  {
    key: "data-analytics",
    label: "Data Science & Analytics",
    keywords: [
      "data science",
      "analytics",
      "data analysis",
      "python",
      "sql",
      "dashboard",
      "bi",
      "statistics",
      "visualization",
      "reporting"
    ],
    roles: ["data analyst", "business analyst", "data scientist", "analytics engineer"]
  },
  {
    key: "software-web",
    label: "Software & Web Development",
    keywords: [
      "web",
      "frontend",
      "backend",
      "full stack",
      "javascript",
      "node",
      "react",
      "api",
      "software engineer",
      "platform"
    ],
    roles: ["software engineer", "frontend developer", "backend developer", "full stack developer"]
  },
  {
    key: "cybersecurity-networking",
    label: "Cybersecurity & Networking",
    keywords: [
      "cybersecurity",
      "network security",
      "cloud security",
      "networking",
      "sase",
      "security",
      "infrastructure",
      "threat",
      "firewall",
      "siem"
    ],
    roles: ["security analyst", "network engineer", "security engineer", "soc analyst"]
  },
  {
    key: "cloud-devops",
    label: "Cloud & DevOps",
    keywords: [
      "cloud",
      "devops",
      "aws",
      "azure",
      "gcp",
      "kubernetes",
      "docker",
      "ci/cd",
      "infrastructure",
      "platform engineering"
    ],
    roles: ["devops engineer", "cloud engineer", "site reliability engineer", "platform engineer"]
  },
  {
    key: "product-business",
    label: "Product, Operations & Business",
    keywords: [
      "product",
      "operations",
      "business",
      "marketing",
      "sales",
      "strategy",
      "growth",
      "customer success",
      "program",
      "partnership"
    ],
    roles: ["product analyst", "operations associate", "business analyst", "program manager"]
  }
];

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeDomain = (value, extraTerms = []) => {
  const text = normalizeText(value);
  const combined = [text, ...extraTerms.map(normalizeText)].join(" ").trim();

  let best = DOMAIN_TAXONOMY[0];
  let bestScore = 0;

  for (const domain of DOMAIN_TAXONOMY) {
    let score = 0;
    for (const keyword of domain.keywords) {
      if (combined.includes(normalizeText(keyword))) {
        score += keyword.includes(" ") ? 3 : 2;
      }
    }
    for (const role of domain.roles) {
      if (combined.includes(normalizeText(role))) {
        score += 3;
      }
    }
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }

  return {
    key: bestScore > 0 ? best.key : "general",
    label: bestScore > 0 ? best.label : "General Opportunities",
    confidence: bestScore
  };
};

export const inferCompanyDomain = (record) => {
  const textParts = [
    record.company_name,
    record.role,
    record.why_relevant_to_you,
    record.company_focus_brief,
    record.outreach_approach,
    record.outreach_message
  ].filter(Boolean);
  const normalized = normalizeDomain(textParts.join(" "), textParts);
  const matched = DOMAIN_TAXONOMY.find((domain) => domain.key === normalized.key);

  return {
    domain_key: normalized.key,
    domain_label: normalized.label,
    domain_keywords: matched ? matched.keywords.slice(0, 8) : []
  };
};

export const buildSearchDocument = (record) =>
  [
    record.company_name,
    record.contact_name,
    record.email_id,
    record.phone,
    record.role,
    record.why_relevant_to_you,
    record.company_focus_brief,
    record.location,
    record.status,
    record.outreach_approach,
    record.outreach_message,
    record.domain_label
  ]
    .filter(Boolean)
    .join(" ");

export const scoreCompanyMatch = (company, analysis, filters = {}) => {
  const haystack = normalizeText(
    buildSearchDocument({
      ...company,
      domain_label: company.normalized_domain_label
    })
  );

  let score = 0;
  const matchedReasons = [];
  const addMatch = (points, reason) => {
    score += points;
    if (reason && !matchedReasons.includes(reason)) {
      matchedReasons.push(reason);
    }
  };

  if (analysis?.normalizedDomainKey && company.normalized_domain_key === analysis.normalizedDomainKey) {
    addMatch(45, `Matches your domain: ${analysis.normalizedDomainLabel}`);
  }

  if (analysis?.normalizedDomainLabel && haystack.includes(normalizeText(analysis.normalizedDomainLabel))) {
    addMatch(18, "Company description mentions your detected specialization");
  }

  for (const keyword of analysis?.keywords || []) {
    if (haystack.includes(normalizeText(keyword))) {
      addMatch(10, `Keyword match: ${keyword}`);
    }
  }

  for (const role of analysis?.suggestedRoles || []) {
    if (haystack.includes(normalizeText(role))) {
      addMatch(12, `Role alignment: ${role}`);
    }
  }

  const query = String(filters.q || "").trim();
  if (query && haystack.includes(normalizeText(query))) {
    addMatch(8, `Search match: ${query}`);
  }

  const status = String(company.status || "").toLowerCase();
  if (status === "draft") {
    addMatch(4, "Fresh outreach candidate");
  }

  return {
    relevance_score: score,
    match_reasons: matchedReasons.slice(0, 4)
  };
};
