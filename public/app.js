const companyRows = document.getElementById("companyRows");
const companyEmpty = document.getElementById("companyEmpty");
const companyCount = document.getElementById("companyCount");
const companyActiveFilter = document.getElementById("companyActiveFilter");
const companyTabs = document.getElementById("companyTabs");
const companyTabPrev = document.getElementById("companyTabPrev");
const companyTabNext = document.getElementById("companyTabNext");
const filtersForm = document.getElementById("companyFilters");
const feedbackForm = document.getElementById("feedbackForm");
const feedbackResult = document.getElementById("feedbackResult");
const landingForm = document.getElementById("landingForm");
const processingOverlay = document.getElementById("processingOverlay");
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

const setLandingError = (message) => {
  if (!landingError) return;
  landingError.textContent = message || "";
  landingError.hidden = !message;
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

const renderCompanies = (companies) => {
  if (!companyRows) return;
  companyRows.innerHTML = "";

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
    card.className = "company-card";

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

    const details = document.createElement("div");
    details.className = "company-details";
    [
      ["Role", company.role],
      ["Contact", company.contact_name],
      ["Email", company.email_id],
      ["Phone", company.phone],
      ["Why it fits", company.why_relevant_to_you],
      ["Company focus", company.company_focus_brief],
      ["Approach", company.outreach_approach],
      ["Suggested message", company.outreach_message]
    ].forEach(([label, value]) => {
      if (!value) return;
      const item = document.createElement("p");
      item.className = "company-detail";
      const strong = document.createElement("strong");
      strong.textContent = `${label}:`;
      item.appendChild(strong);
      item.append(` ${value}`);
      details.appendChild(item);
    });

    const reasons = document.createElement("div");
    reasons.className = "chip-row";
    (company.match_reasons || []).forEach((reason) => {
      const chip = document.createElement("span");
      chip.className = "chip subtle";
      chip.textContent = reason;
      reasons.appendChild(chip);
    });

    card.appendChild(header);
    card.appendChild(details);
    if ((company.match_reasons || []).length) {
      card.appendChild(reasons);
    }
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
  if (companyCount) companyCount.textContent = "Loading matches...";
  const response = await fetch(`/api/companies?${query.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    if (companyRows) companyRows.innerHTML = "";
    if (companyEmpty) companyEmpty.textContent = payload.error || "Failed to load companies.";
    if (companyCount) companyCount.textContent = "Unavailable";
    return;
  }

  let companies = Array.isArray(payload.data) ? payload.data : [];

  if (tab.minScore > 0) {
    companies = companies.filter((company) => Number(company.relevance_score || 0) >= tab.minScore);
  }

  renderCompanies(companies);
};

if (filtersForm) {
  filtersForm.addEventListener("submit", (event) => {
    event.preventDefault();
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

if (feedbackForm) {
  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(feedbackForm);
    const text = formData.get("cvText");
    if (!text || !text.trim()) {
      feedbackResult.textContent = "Paste your CV text to get feedback.";
      return;
    }

    feedbackResult.textContent = "Generating feedback...";

    const response = await fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    const payload = await response.json();
    if (!response.ok) {
      feedbackResult.textContent = payload.error?.message || payload.error || "Failed to fetch feedback.";
      return;
    }

    // Expect payload.result to be an object with keys: next_steps, improvements, tone_and_skills
    const data = payload.result;
    if (!data || typeof data !== "object") {
      feedbackResult.textContent = typeof data === "string" ? data : "No structured feedback returned.";
      return;
    }

    const mkList = (items) => {
      if (!Array.isArray(items) || !items.length) return "<p class=\"hint\">No suggestions.</p>";
      return ` <ul class="insight-list">${items.map((it) => `<li>${escapeHtml(String(it))}</li>`).join("")}</ul>`;
    };

    feedbackResult.innerHTML = `
      <div class="feedback-section-rendered">
        <h3>1. What should I do next?</h3>
        ${mkList(data.next_steps)}
        <h3>2. What should I do better?</h3>
        ${mkList(data.improvements)}
        <h3>3. Skills / Language / Tone to add</h3>
        ${mkList(data.tone_and_skills)}
      </div>
    `;
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
  landingForm.addEventListener("submit", async (event) => {
    const fileInput = landingForm.querySelector('input[type="file"][name="cv"]');
    if (!fileInput?.files?.length) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setLandingError("");
    if (processingOverlay) processingOverlay.hidden = false;

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
      if (processingOverlay) processingOverlay.hidden = true;
    }
  });
}
