const companyRows = document.getElementById("companyRows");
const companyEmpty = document.getElementById("companyEmpty");
const companyCount = document.getElementById("companyCount");
const companyActiveFilter = document.getElementById("companyActiveFilter");
const overviewVisibleCount = document.getElementById("overviewVisibleCount");
const overviewTopScore = document.getElementById("overviewTopScore");
const overviewTopDomain = document.getElementById("overviewTopDomain");
const companyTabs = document.getElementById("companyTabs");
const companyTabPrev = document.getElementById("companyTabPrev");
const companyTabNext = document.getElementById("companyTabNext");
const autoFeedbackButton = document.getElementById("autoFeedbackButton");
const filtersForm = document.getElementById("companyFilters");
const assistantModal = document.getElementById("assistantModal");
const assistantModalTitle = document.getElementById("assistantModalTitle");
const assistantModalLabel = document.getElementById("assistantModalLabel");
const assistantModalBody = document.getElementById("assistantModalBody");
const assistantModalClose = document.getElementById("assistantModalClose");
const landingForm = document.getElementById("landingForm");
const landingFileInput = landingForm?.querySelector('input[type="file"][name="cv"]');
const uploadStatus = document.getElementById("uploadStatus");
const processingOverlay = document.getElementById("processingOverlay");
const processingMessage = document.getElementById("processingMessage");
const landingError = document.getElementById("landingError");
const sessionId = document.body?.dataset?.sessionId || "";

const UPLOAD_TIMEOUT_MS = 45000;
const COMPANY_TABS = {
  all: { label: "All", minScore: 0 },
  top: { label: "Top Matches", minScore: 4 },
  strong: { label: "Strong", minScore: 2 },
  draft: { label: "Draft", status: "Draft", minScore: 0 },
  active: { label: "Active", status: "Active", minScore: 0 },
  remote: { label: "Remote", location: "Remote", minScore: 0 },
  india: { label: "India", location: "India", minScore: 0 }
};

let activeCompanyTab = "all";
let currentCompanyDetails = null;
let companyFilterDebounceId = null;
let processingMessageTimer = null;

const PROCESSING_MESSAGES = [
  "Finding your strongest matches and preparing AI insights.",
  "Reading your CV and mapping it to relevant roles.",
  "Almost there. Shortlisting companies that fit your profile."
];

const setLandingError = (message) => {
  if (!landingError) return;
  landingError.textContent = message || "";
  landingError.hidden = !message;
};

const updateUploadStatus = () => {
  if (!landingFileInput || !uploadStatus) return;
  const hasFile = Boolean(landingFileInput.files && landingFileInput.files.length);
  uploadStatus.hidden = !hasFile;
  uploadStatus.classList.toggle("is-visible", hasFile);
  if (hasFile) {
    const fileName = landingFileInput.files[0]?.name || "file";
    const textNode = uploadStatus.querySelector(".upload-status-text");
    if (textNode) textNode.textContent = `${fileName} uploaded`;
  }
};

const startProcessingMessageRotation = () => {
  if (!processingMessage) return;

  let index = 0;
  processingMessage.textContent = PROCESSING_MESSAGES[index];
  window.clearInterval(processingMessageTimer);
  processingMessageTimer = window.setInterval(() => {
    index = (index + 1) % PROCESSING_MESSAGES.length;
    processingMessage.textContent = PROCESSING_MESSAGES[index];
  }, 1800);
};

const stopProcessingMessageRotation = () => {
  window.clearInterval(processingMessageTimer);
  processingMessageTimer = null;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = UPLOAD_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const setAssistantModalContent = (title, label, contentNode) => {
  if (!assistantModal || !assistantModalTitle || !assistantModalLabel || !assistantModalBody) return;
  assistantModalTitle.textContent = title;
  assistantModalLabel.textContent = label;
  assistantModalBody.innerHTML = "";
  if (contentNode) assistantModalBody.appendChild(contentNode);
  assistantModal.hidden = false;
};

const hideAssistantModal = () => {
  if (!assistantModal) return;
  assistantModal.hidden = true;
};

const createMetaList = (entries) => {
  const list = document.createElement("div");
  list.className = "company-modal-list";
  entries.forEach(([label, value]) => {
    if (!value) return;
    const row = document.createElement("p");
    row.className = "company-modal-item";
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    row.appendChild(strong);
    row.append(` ${value}`);
    list.appendChild(row);
  });
  return list;
};

const openCompanyModal = (company) => {
  currentCompanyDetails = company;
  const wrapper = document.createElement("div");
  wrapper.className = "company-modal-content";

  const top = document.createElement("div");
  top.className = "company-modal-top";
  const title = document.createElement("h3");
  title.className = "company-modal-title";
  title.textContent = company.company_name || "Company details";
  const subtitle = document.createElement("p");
  subtitle.className = "company-modal-subtitle";
  subtitle.textContent = [company.normalized_domain_label, company.location, company.status]
    .filter(Boolean)
    .join(" • ");
  top.appendChild(title);
  top.appendChild(subtitle);

  const score = document.createElement("div");
  score.className = "score-pill";
  score.textContent = `${company.relevance_score || 0} pts`;

  const reasons = document.createElement("div");
  reasons.className = "chip-row";
  (company.match_reasons || []).forEach((reason) => {
    const chip = document.createElement("span");
    chip.className = "chip subtle";
    chip.textContent = reason;
    reasons.appendChild(chip);
  });

  wrapper.appendChild(top);
  wrapper.appendChild(score);
  wrapper.appendChild(createMetaList([
    ["Role", company.role],
    ["Contact", company.contact_name],
    ["Email", company.email_id],
    ["Phone", company.phone],
    ["Why it fits", company.why_relevant_to_you],
    ["Company focus", company.company_focus_brief],
    ["Approach", company.outreach_approach],
    ["Suggested message", company.outreach_message]
  ]));
  if ((company.match_reasons || []).length) wrapper.appendChild(reasons);

  setAssistantModalContent("Company details", "Company Assistant", wrapper);
};

const renderFeedbackResult = (data) => {
  const container = document.createElement("div");
  container.className = "feedback-section-rendered";

  const mkList = (items) => {
    if (!Array.isArray(items) || !items.length) return "<p class=\"hint\">No suggestions.</p>";
    return `<ul class=\"insight-list\">${items.map((it) => `<li>${escapeHtml(String(it))}</li>`).join("")}</ul>`;
  };

  container.innerHTML = `
    <h3>1. What should I do next?</h3>
    ${mkList(data.next_steps)}
    <h3>2. What should I do better?</h3>
    ${mkList(data.improvements)}
    <h3>3. Skills / Language / Tone to add</h3>
    ${mkList(data.tone_and_skills)}
  `;
  return container;
};

const openFeedbackAssistant = async () => {
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "Loading AI feedback from your uploaded CV...";
  setAssistantModalContent("Get AI Feedback", "AI Assistant", loading);

  try {
    const analysisResponse = await fetch(`/api/cv-analysis?session=${encodeURIComponent(sessionId)}`);
    const analysisPayload = await analysisResponse.json();
    if (!analysisResponse.ok) {
      throw new Error(analysisPayload.error || "Unable to load saved CV analysis.");
    }

    const cvText = analysisPayload?.data?.extractedText || "";
    if (!cvText.trim()) {
      throw new Error("No saved CV text found for this session.");
    }

    const response = await fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cvText })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.error || "Failed to fetch feedback.");
    }

    const data = payload.result;
    if (!data || typeof data !== "object") {
      throw new Error("No structured feedback returned.");
    }

    setAssistantModalContent("Get AI Feedback", "AI Assistant", renderFeedbackResult(data));
  } catch (error) {
    const failure = document.createElement("div");
    failure.className = "feedback-section-rendered";
    failure.innerHTML = `<p class=\"error-banner\">${escapeHtml(error?.message || "Failed to fetch feedback.")}</p>`;
    setAssistantModalContent("Get AI Feedback", "AI Assistant", failure);
  }
};

const updateCompanyOverview = (companies) => {
  if (overviewVisibleCount) {
    overviewVisibleCount.textContent = String(companies.length || 0);
  }

  if (overviewTopScore) {
    const topScore = companies.reduce((max, company) => Math.max(max, Number(company.relevance_score || 0)), 0);
    overviewTopScore.textContent = `${topScore} pts`;
  }

  if (overviewTopDomain) {
    const domainCounts = new Map();
    companies.forEach((company) => {
      const domain = String(company.normalized_domain_label || "").trim();
      if (!domain) return;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    });

    const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    overviewTopDomain.textContent = topDomain || "Waiting for results";
  }
};

const renderCompanies = (companies) => {
  if (!companyRows) return;
  companyRows.innerHTML = "";
  updateCompanyOverview(companies);

  if (!companies.length) {
    if (companyEmpty) companyEmpty.textContent = "No companies found for the selected view.";
    if (companyCount) companyCount.textContent = "0 ranked matches";
    if (companyActiveFilter) companyActiveFilter.textContent = getCompanyViewLabel();
    return;
  }

  if (companyEmpty) companyEmpty.textContent = "";
  if (companyCount) companyCount.textContent = `${companies.length} ranked matches`;
  if (companyActiveFilter) companyActiveFilter.textContent = getCompanyViewLabel();

  companies.forEach((company) => {
    const card = document.createElement("article");
    card.className = "company-card company-card--tile";
    card.dataset.companyName = String(company.company_name || "").toLowerCase();
    card.dataset.companyStatus = String(company.status || "").toLowerCase();
    card.dataset.companyLocation = String(company.location || "").toLowerCase();
    card.dataset.companyScore = String(company.relevance_score || 0);
    card.tabIndex = 0;
    card.role = "button";

    const header = document.createElement("div");
    header.className = "company-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "company-title";
    title.textContent = company.company_name || "Untitled";

    const meta = document.createElement("p");
    meta.className = "company-meta";
    meta.textContent = [company.normalized_domain_label, company.location, company.status]
      .filter(Boolean)
      .join(" • ");

    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const score = document.createElement("div");
    score.className = "score-pill";
    score.textContent = `${company.relevance_score || 0} pts`;

    header.appendChild(titleWrap);
    header.appendChild(score);

    const summary = document.createElement("div");
    summary.className = "company-summary-line";
    summary.textContent = company.role || "Role not specified";

    const kicker = document.createElement("p");
    kicker.className = "company-kicker";
    kicker.textContent = company.why_relevant_to_you ? "Recommended for you" : "Opportunity snapshot";

    const roleDetail = document.createElement("p");
    roleDetail.className = "company-role";
    roleDetail.textContent =
      company.why_relevant_to_you ||
      company.company_focus_brief ||
      "Open this card to review contact context, fit reasons, and outreach guidance.";

    const highlights = document.createElement("div");
    highlights.className = "company-highlights";

    const addHighlight = (label, value) => {
      if (!value) return;

      const item = document.createElement("div");
      item.className = "company-highlight-item";

      const itemLabel = document.createElement("p");
      itemLabel.className = "company-highlight-label";
      itemLabel.textContent = label;

      const itemValue = document.createElement("p");
      itemValue.className = "company-highlight-value";
      itemValue.textContent = value;

      item.appendChild(itemLabel);
      item.appendChild(itemValue);
      highlights.appendChild(item);
    };

    addHighlight("Location", company.location || "Not listed");
    addHighlight("Status", company.status || "Unknown");
    addHighlight("Best contact", company.contact_name || company.email_id || company.phone || "");

    const reasons = document.createElement("div");
    reasons.className = "chip-row";
    (company.match_reasons || []).forEach((reason) => {
      const chip = document.createElement("span");
      chip.className = "chip subtle";
      chip.textContent = reason;
      reasons.appendChild(chip);
    });

    const footer = document.createElement("div");
    footer.className = "company-footer";

    const footerText = document.createElement("span");
    footerText.className = "company-footer-text";
    footerText.textContent = (company.match_reasons || []).length
      ? `${company.match_reasons.length} match signal${company.match_reasons.length === 1 ? "" : "s"} found`
      : "Open for match details and outreach guidance";

    const footerLink = document.createElement("span");
    footerLink.className = "company-footer-link";
    footerLink.textContent = "View details";

    card.appendChild(header);
    card.appendChild(kicker);
    card.appendChild(summary);
    card.appendChild(roleDetail);
    if (highlights.childNodes.length) {
      card.appendChild(highlights);
    }
    if ((company.match_reasons || []).length) {
      card.appendChild(reasons);
    }
    footer.appendChild(footerText);
    footer.appendChild(footerLink);
    card.appendChild(footer);

    const openDetails = () => openCompanyModal(company);
    card.addEventListener("click", openDetails);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetails();
      }
    });

    companyRows.appendChild(card);
  });
};

const getCompanyViewLabel = () => {
  const tab = COMPANY_TABS[activeCompanyTab] || COMPANY_TABS.all;
  const parts = [tab.label || "All"];
  if (filtersForm) {
    const formData = new FormData(filtersForm);
    const q = String(formData.get("q") || "").trim();
    const location = String(formData.get("location") || "").trim();
    const status = String(formData.get("status") || "").trim();
    if (q) parts.push(`Search: ${q}`);
    if (location) parts.push(`Location: ${location}`);
    if (status) parts.push(`Status: ${status}`);
  }
  return `Showing ${parts.join(" • ")}`;
};

const getCompanyFilterParams = () => {
  if (!filtersForm) return {};
  return Object.fromEntries(new FormData(filtersForm).entries());
};

const setActiveCompanyTab = (tabKey) => {
  activeCompanyTab = COMPANY_TABS[tabKey] ? tabKey : "all";

  if (companyTabs) {
    companyTabs.querySelectorAll(".tab-chip").forEach((button) => {
      const isActive = button.dataset.tab === activeCompanyTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  return loadCompanies(getCompanyFilterParams());
};

const loadCompanies = async (params = {}) => {
  const query = new URLSearchParams(params);
  if (sessionId) {
    query.set("session", sessionId);
  }
  const tab = COMPANY_TABS[activeCompanyTab] || COMPANY_TABS.all;
  const sortMode = String(params.sort || "relevance");
  if (companyCount) companyCount.textContent = "Loading matches...";
  const response = await fetch(`/api/companies?${query.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    if (companyRows) companyRows.innerHTML = "";
    if (companyEmpty) companyEmpty.textContent = payload.error || "Failed to load companies.";
    if (companyCount) companyCount.textContent = "Unavailable";
    updateCompanyOverview([]);
    return;
  }

  let companies = Array.isArray(payload.data) ? payload.data : [];

  if (tab.minScore > 0) {
    companies = companies.filter((company) => Number(company.relevance_score || 0) >= tab.minScore);
  }

  if (sortMode === "points-desc") {
    companies.sort((a, b) => Number(b.relevance_score || 0) - Number(a.relevance_score || 0));
  } else if (sortMode === "points-asc") {
    companies.sort((a, b) => Number(a.relevance_score || 0) - Number(b.relevance_score || 0));
  } else if (sortMode === "name-asc") {
    companies.sort((a, b) => String(a.company_name || "").localeCompare(String(b.company_name || "")));
  } else if (sortMode === "name-desc") {
    companies.sort((a, b) => String(b.company_name || "").localeCompare(String(a.company_name || "")));
  }

  renderCompanies(companies);
};

if (filtersForm) {
  filtersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadCompanies(getCompanyFilterParams());
  });

  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      loadCompanies(getCompanyFilterParams());
    }, 0);
  });

  filtersForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    window.clearTimeout(companyFilterDebounceId);
    companyFilterDebounceId = window.setTimeout(() => {
      loadCompanies(getCompanyFilterParams());
    }, 180);
  });

  filtersForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    loadCompanies(getCompanyFilterParams());
  });
}

if (companyTabs) {
  companyTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab-chip");
    if (!button) return;
    setActiveCompanyTab(button.dataset.tab || "all");
  });
}

if (companyTabPrev) {
  companyTabPrev.addEventListener("click", () => {
    companyTabs?.scrollBy({ left: -260, behavior: "smooth" });
  });
}

if (companyTabNext) {
  companyTabNext.addEventListener("click", () => {
    companyTabs?.scrollBy({ left: 260, behavior: "smooth" });
  });
}

if (autoFeedbackButton) {
  autoFeedbackButton.addEventListener("click", () => {
    openFeedbackAssistant();
  });
}

if (assistantModalClose) {
  assistantModalClose.addEventListener("click", hideAssistantModal);
}

if (assistantModal) {
  assistantModal.addEventListener("click", (event) => {
    if (event.target === assistantModal) {
      hideAssistantModal();
    }
  });
}

// Simple HTML escape helper
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

if (filtersForm) {
  loadCompanies(getCompanyFilterParams());
}

if (landingForm) {
  updateUploadStatus();

  if (landingFileInput) {
    landingFileInput.addEventListener("change", updateUploadStatus);
  }

  landingForm.addEventListener("submit", async (event) => {
    const fileInput = landingForm.querySelector('input[type="file"][name="cv"]');
    if (!fileInput?.files?.length) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setLandingError("");
    if (processingOverlay) processingOverlay.hidden = false;
    startProcessingMessageRotation();

    try {
      const formData = new FormData(landingForm);
      const response = await fetchWithTimeout(landingForm.action, {
        method: "POST",
        body: formData
      });

      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const message = doc.getElementById("landingError")?.textContent?.trim();
      setLandingError(message || "Failed to process the uploaded CV.");
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "Processing timed out. Please try again."
          : "Failed to process the uploaded CV.";
      setLandingError(message);
    } finally {
      stopProcessingMessageRotation();
      if (processingOverlay) processingOverlay.hidden = true;
    }
  });
}
