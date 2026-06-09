(function () {
  const app = document.getElementById("app");
  const memberTokenKey = "alumniMemberToken";
  const storage = (() => {
    try {
      if (!window.localStorage) throw new Error("Storage unavailable");
      const testKey = "__member_storage_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch {
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    }
  })();

  const state = {
    data: null,
    authToken: storage.getItem(memberTokenKey),
    authUser: null,
    slide: 0,
    committeeYear: "",
    memberSearch: "",
    memberYear: "",
    memberPage: 1,
    memberPageSize: 10
  };

  /* ── Utilities ─────────────────────────────────────────── */
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const normalizePath = (path) => {
    let decoded = "/";
    try { decoded = decodeURIComponent(path || "/"); } catch { decoded = path || "/"; }
    decoded = decoded.split("?")[0].split("#")[0];
    if (!decoded.startsWith("/")) decoded = `/${decoded}`;
    if (decoded !== "/" && !decoded.endsWith("/")) decoded += "/";
    return decoded;
  };

  const formatDate = (date) => {
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" })
      .format(new Date(`${date}T00:00:00`));
  };

  const formatDateTime = (date) => {
    if (!date) return "";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat("bn-BD", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(parsed);
  };

  const paragraphs = (items = []) =>
    items.map((item) => `<p>${escapeHtml(item)}</p>`).join("");

  const categoryKey = (value) => String(value || "").trim().toLowerCase();

  const link = (item, className = "") =>
    `<a ${className ? `class="${className}"` : ""} href="${escapeHtml(item.path)}">${escapeHtml(item.label)}</a>`;

  const profileSlug = (value, fallback = "profile") =>
    encodeURIComponent(String(value || fallback).trim().toLowerCase().replace(/\s+/g, "-"));

  const yearScore = (year) => {
    const digits = String(year || "").replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));
    const value = Number(digits.replace(/[^\d]/g, ""));
    return Number.isFinite(value) ? value : 0;
  };

  const COMMITTEE_TYPE_OPTIONS = ["উপদেষ্টা কমিটি", "আহবায়ক কমিটি", "কার্যনির্বাহী কমিটি"];
  const COMMITTEE_TYPE_ALIASES = {
    "Advisory Committee": "উপদেষ্টা কমিটি",
    "Executive Committee": "আহবায়ক কমিটি"
  };
  const committeeTypeValue = (value) => {
    const type = String(value || "").trim();
    return COMMITTEE_TYPE_ALIASES[type] || type || "আহবায়ক কমিটি";
  };

  const committeeYears = () =>
    [...new Set(state.data.committee.map((p) => p.year || "২০২২"))].sort((a, b) => yearScore(b) - yearScore(a));

  const committeeSession = (person = {}) => String(person.year || "2026-2027").trim() || "2026-2027";
  const committeeType = (person = {}) => committeeTypeValue(person.type);
  const committeeStatus = (person = {}) => String(person.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
  const committeeRoleOrder = (role) => ({
    "আহবায়ক": 10,
    "সিনিয়র যুগ্ম আহবায়ক": 20,
    "যুগ্ম আহবায়ক": 30,
    "সদস্য সচিব": 40,
    "সিনিয়র যুগ্ম সদস্য সচিব": 50,
    "যুগ্ম সদস্য সচিব": 60,
    "উপদেষ্টা": 70,
    "সদস্য": 100,
    "Member": 100
  }[String(role || "").trim()] || 999);

  const committeeSortValue = (person, key, fallback) => {
    const number = Number(person?.[key]);
    return Number.isFinite(number) ? number : fallback;
  };

  const sortCommitteePeople = (people = []) =>
    [...people].sort((a, b) =>
      committeeSortValue(a, "designationOrder", committeeRoleOrder(a.role)) - committeeSortValue(b, "designationOrder", committeeRoleOrder(b.role)) ||
      committeeSortValue(a, "sortOrder", 9999) - committeeSortValue(b, "sortOrder", 9999) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );

  function committeeSessionOptions(activeOnly = false) {
    const people = activeOnly
      ? state.data.committee.filter((person) => committeeStatus(person) === "active")
      : state.data.committee;
    return [...new Set(people.map((person) => committeeSession(person)).filter(Boolean))]
      .sort((a, b) => yearScore(b) - yearScore(a));
  }

  function activeCommitteeYear() {
    const years = committeeSessionOptions(false);
    const activeYears = committeeSessionOptions(true);
    if (!state.committeeYear || !years.includes(state.committeeYear)) {
      state.committeeYear = activeYears[0] || years[0] || "";
    }
    return state.committeeYear;
  }

  function setTitle(title) {
    const suffix = state.data?.settings?.siteName || "প্রাক্তন শিক্ষার্থী ফোরাম";
    document.title = title ? `${title} | ${suffix}` : suffix;
  }

  function setAuth(token, user) {
    state.authToken = token || "";
    state.authUser = user || null;
    if (token) storage.setItem(memberTokenKey, token);
    else storage.removeItem(memberTokenKey);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }

  async function loadAuth() {
    if (!state.authToken) return;
    try {
      const result = await api("/api/auth/me");
      if (!result.user) {
        setAuth("", null);
        return;
      }
      state.authUser = result.user;
    } catch {
      setAuth("", null);
    }
  }

  async function refreshForum() {
    const result = await api("/api/forum?limit=20");
    state.data.forumPosts = result.posts || [];
  }

  /* ── Header ─────────────────────────────────────────────── */
  function header() {
    const { settings, navigation, topLinks } = state.data;
    return `
      <header class="site-header">
        <div class="topbar">
          <div class="container topbar-inner">
            <div class="topbar-left">
              <span>📧 ${escapeHtml(settings.email)}</span>
              <span>📞 ${escapeHtml(settings.phone)}</span>
            </div>
            <nav class="topbar-links" aria-label="Top links">
              ${topLinks.map((item) => link(item)).join("")}
              <button class="search-button" type="button" aria-label="Search">⌕</button>
            </nav>
          </div>
        </div>
        <div class="main-header">
          <div class="container header-inner">
            <a class="brand" href="/">
              <img src="${escapeHtml(settings.logo)}" alt="${escapeHtml(settings.siteName)}">
              <div class="brand-text">
                <span class="brand-title">${escapeHtml(settings.siteName)}</span>
                <span class="brand-sub">${escapeHtml(settings.siteNameBn || "")}</span>
              </div>
            </a>
            <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primaryMenu">☰</button>
            <nav id="primaryMenu" class="primary-menu" aria-label="Primary navigation">
              ${navigation.map((item) => link(item)).join("")}
            </nav>
            <a class="header-cta" href="/become-a-member/">সদস্য হোন</a>
          </div>
        </div>
        <div class="notice-line">
          <span>নোটিশ</span>
          <marquee>${escapeHtml(settings.noticeText)}</marquee>
        </div>
      </header>
    `;
  }

  /* ── Footer ─────────────────────────────────────────────── */
  function footer() {
    const { settings, navigation, topLinks } = state.data;
    const developerProfileUrl = "/committee-member/%E0%A6%87%E0%A6%9E%E0%A7%8D%E0%A6%9C%E0%A6%BF%E0%A6%83-%E0%A6%96%E0%A6%BE%E0%A6%B2%E0%A7%87%E0%A6%A6-%E0%A6%AE%E0%A6%BE%E0%A6%B8%E0%A7%81%E0%A6%A6-%E0%A6%AC%E0%A6%BE%E0%A6%AC%E0%A7%81/?id=89&ci=16";
    return `
      <footer class="site-footer">
        <div class="footer-overlay">
          <div class="container footer-grid">
            <div>
              <img class="footer-logo" src="${escapeHtml(settings.footerLogo || settings.logo)}" alt="${escapeHtml(settings.siteName)}">
              <p class="footer-intro">${escapeHtml(settings.siteNameBn || settings.siteName)}<br>${escapeHtml(settings.address)}</p>
            </div>
            <div>
              <h3>দ্রুত লিঙ্ক</h3>
              <div class="footer-links">${navigation.slice(0, 6).map((item) => link(item)).join("")}</div>
            </div>
            <div>
              <h3>পেজসমূহ</h3>
              <div class="footer-links">${topLinks.map((item) => link(item)).join("")}</div>
            </div>
            <div>
              <h3>যোগাযোগ</h3>
              <div class="footer-contact-item">📧 ${escapeHtml(settings.email)}</div>
              <div class="footer-contact-item">📞 ${escapeHtml(settings.phone)}</div>
              <div class="footer-contact-item">📍 ${escapeHtml(settings.address)}</div>
              <br>
              <a class="skew-button" href="/contacts/" style="font-size:13px;padding:8px 20px;">যোগাযোগ করুন</a>
            </div>
          </div>
        </div>
        <div class="copyright">
          Copyright © ${new Date().getFullYear()} ${escapeHtml(settings.siteName)} — সর্বস্বত্ব সংরক্ষিত
          <span class="footer-dev-credit">Developed by <a href="${escapeHtml(developerProfileUrl)}">KM Babu</a></span>
        </div>
      </footer>
    `;
  }

  /* ── Section Heading ─────────────────────────────────────── */
  function sectionHeading(title, subtitle = "", tag = "") {
    return `
      <div class="section-heading">
        ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
    `;
  }

  /* ── Page Hero ───────────────────────────────────────────── */
  function pageHero(page) {
    return `
      <section class="page-hero">
        <div class="container">
          <h1>${escapeHtml(page.title)}</h1>
          <div class="breadcrumb">
            <a href="/">প্রথম পাতা</a>
            <span>${escapeHtml(page.title)}</span>
          </div>
        </div>
      </section>
    `;
  }

  /* ── Hero Slider ─────────────────────────────────────────── */
  function hero() {
    const slides = state.data.heroSlides;
    const slide = slides[state.slide % slides.length];
    return `
      <section class="hero-slider" style="background-image: url('${escapeHtml(slide.image)}')">
        <div class="hero-shade"></div>
        <div class="hero-copy">
          <span class="eyebrow">${escapeHtml(slide.eyebrow)}</span>
          <h1>${escapeHtml(slide.title).replaceAll("\n", "<br>")}</h1>
          <a class="hero-cta" href="/about-us/">আরও জানুন →</a>
        </div>
        <div class="hero-dots">
          ${slides.map((_, i) =>
      `<button class="${i === state.slide ? "active" : ""}" data-slide="${i}" aria-label="Slide ${i + 1}"></button>`
    ).join("")}
        </div>
      </section>
    `;
  }

  /* ── Committee Cards ─────────────────────────────────────── */
  function committeeCards(limit, yearOrOptions = "", maybeOptions = {}) {
    const options = typeof yearOrOptions === "object"
      ? yearOrOptions
      : { ...maybeOptions, year: yearOrOptions };
    const year = options.year || "";
    const requestedType = options.type ? committeeTypeValue(options.type) : "";
    const scoped = sortCommitteePeople((state.data.committee || []).filter((person) => {
      if (year && committeeSession(person) !== year) return false;
      if (options.activeOnly && committeeStatus(person) !== "active") return false;
      if (requestedType && committeeType(person) !== requestedType) return false;
      return true;
    }));
    const people = limit ? scoped.slice(0, limit) : scoped;

    if (!people.length) {
      return `<div class="empty-state">${escapeHtml(options.emptyMessage || "এই বছরের কোন কমিটি পাওয়া যায়নি")}</div>`;
    }

    return `
      <div class="team-grid">
        ${people.map((person, idx) => {
      const slug = encodeURIComponent(person.name.trim().toLowerCase().replaceAll(" ", "-"));
      const profileUrl = `/committee-member/${slug}/?id=${encodeURIComponent(person.id || "")}&ci=${scoped.indexOf(person)}`;
      return `
            <article class="team-card" data-profile-url="${escapeHtml(profileUrl)}">
              <div class="team-photo">
                <img src="${escapeHtml(person.image || "/assets/forum-logo.png")}" 
                     alt="${escapeHtml(person.name)}"
                     onerror="this.src='/assets/forum-logo.png'">
              </div>
              <div class="team-info">
                <span class="team-year">${escapeHtml(committeeSession(person))}</span>
                <h3>${escapeHtml(person.name)}</h3>
                <p>${escapeHtml(person.role)}</p>
                <p class="team-detail">${escapeHtml(committeeType(person))}</p>
                ${person.passingYear ? `<p class="team-detail">ব্যাচ: ${escapeHtml(person.passingYear)}</p>` : ""}
              </div>
            </article>
          `;
    }).join("")}
      </div>
    `;
  }

  /* ── Committee Member Profile Page ──────────────────────── */
  function committeeMemberPage() {
    // Get member index from URL query param
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";
    const ci = parseInt(params.get("ci") ?? "0", 10);
    const year = activeCommitteeYear();
    const scopedPeople = sortCommitteePeople(state.data.committee.filter((p) => committeeSession(p) === year));
    const person = state.data.committee.find((p) => String(p.id || "") === String(id))
      || scopedPeople[ci]
      || state.data.committee[ci]
      || state.data.committee[0];

    if (!person) {
      return `
        ${pageHero({ title: "সদস্য পাওয়া যায়নি" })}
        <section class="content-section">
          <div class="container centered-copy">
            <p>এই সদস্যের তথ্য পাওয়া যায়নি।</p>
            <a class="skew-button" href="/committee/">ফিরে যান</a>
          </div>
        </section>
      `;
    }

    return `
      ${pageHero({ title: "কমিটি সদস্য পরিচিতি" })}
      <section class="profile-page">
        <div class="container">
          <div class="profile-back">
            <a class="skew-button" href="/committee/" style="font-size:13px;padding:8px 20px;">← কমিটি পাতায় ফিরুন</a>
          </div>
          <div class="profile-card">
            <div class="profile-photo-col">
              <img src="${escapeHtml(person.image || "/assets/forum-logo.png")}"
                   alt="${escapeHtml(person.name)}"
                   onerror="this.src='/assets/forum-logo.png'">
              <div class="profile-name">${escapeHtml(person.name)}</div>
              <div class="profile-role">${escapeHtml(person.role)}</div>
              <span class="profile-year-badge">${escapeHtml(committeeType(person))} ${escapeHtml(committeeSession(person))}</span>
              <div class="profile-contact">
                ${person.passingYear ? `<div class="profile-contact-item">🎓 ব্যাচ: ${escapeHtml(person.passingYear)}</div>` : ""}
                ${person.phone ? `<div class="profile-contact-item">📞 ${escapeHtml(person.phone)}</div>` : ""}
                ${person.email ? `<div class="profile-contact-item">📧 ${escapeHtml(person.email)}</div>` : ""}
                ${person.address ? `<div class="profile-contact-item">📍 ${escapeHtml(person.address)}</div>` : ""}
              </div>
            </div>
            <div class="profile-body-col">
              <h2>${escapeHtml(person.name)}</h2>
              <p><strong>পদবি:</strong> ${escapeHtml(person.role)}</p>
              <p><strong>কমিটি:</strong> ${escapeHtml(committeeType(person))}</p>
              <p><strong>সেশন:</strong> ${escapeHtml(committeeSession(person))}</p>
              ${person.passingYear ? `<p><strong>ব্যাচ:</strong> ${escapeHtml(person.passingYear)}</p>` : ""}
              ${person.phone ? `<p><strong>ফোন:</strong> ${escapeHtml(person.phone)}</p>` : ""}
              ${person.bio ? `<p>${escapeHtml(person.bio)}</p>` : `
                <p>
                  ${escapeHtml(person.name)} আমাদের ফোরামের একজন গুরুত্বপূর্ণ সদস্য এবং ${escapeHtml(person.role)} হিসেবে দায়িত্ব পালন করছেন। 
                  তিনি আমাদের প্রাক্তন শিক্ষার্থী ফোরামের কার্যক্রমে সক্রিয়ভাবে অংশগ্রহণ করেন এবং বিদ্যালয়ের উন্নয়নে অবদান রাখছেন।
                </p>
              `}
              ${person.message ? `
                <div class="profile-message-box">
                  <h3>বার্তা</h3>
                  <p>${escapeHtml(person.message)}</p>
                </div>
              ` : `
                <div class="profile-message-box">
                  <h3>ফোরাম সম্পর্কে</h3>
                  <p>
                    আমাদের প্রাক্তন শিক্ষার্থী ফোরাম বিদ্যালয়ের সকল প্রাক্তন শিক্ষার্থীদের একত্রিত করার প্ল্যাটফর্ম হিসেবে কাজ করে।
                    আমরা একতা, প্রগতি ও ঐতিহ্যের আদর্শ ধারণ করি।
                  </p>
                </div>
              `}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /* ── Post Cards ──────────────────────────────────────────── */
  function postCards(posts) {
    if (!posts.length) {
      return `<div class="empty-state">নতুন কোন পোস্ট নেই</div>`;
    }
    return `
      <div class="post-grid">
        ${posts.map((post) => `
          <article class="post-card">
            <a class="post-image" href="${escapeHtml(post.path)}">
              <img src="${escapeHtml(post.image || "/assets/forum-logo.png")}"
                   alt="${escapeHtml(post.title)}"
                   onerror="this.src='/assets/forum-logo.png'">
            </a>
            <div class="post-content">
              <div class="post-meta">
                <span>${escapeHtml(post.category)}</span>
                <span>${formatDate(post.date)}</span>
              </div>
              <h3><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></h3>
              <p>${escapeHtml(post.excerpt)}</p>
              <a class="read-more" href="${escapeHtml(post.path)}">বিস্তারিত পড়ুন</a>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  /* ── CTA Banner ────────────────────────────────────────── */
  function ctaBanner() {
    return `
      <section class="cta-banner">
        <a href="/become-a-member/" class="cta-box blue">
          <h2>অ্যালামনাই অ্যাসোসিয়েশন সদস্য হোন</h2>
          <span class="btn-cta">সদস্য হোন</span>
        </a>
        <a href="/contacts/" class="cta-box orange">
          <h2>প্রয়োজনে যোগাযোগ করুন</h2>
          <span class="btn-cta">যোগাযোগ</span>
        </a>
      </section>
    `;
  }

  /* ── Home Page ───────────────────────────────────────────── */
  function homeEventsSection() {
    const settings = state.data.settings || {};
    const events = state.data.posts.filter((post) => {
      const key = categoryKey(post.category);
      return key === "event" || key === "events" || key === "ইভেন্ট" || key === "ইভেন্টস";
    });
    return `
      <section class="content-section event-section">
        <div class="container">
          <div class="event-head">
            <span class="eyebrow">${escapeHtml(settings.homeEventsEyebrow || "অ্যালামনাই অ্যাসোসিয়েশন ইভেন্টস")}</span>
            <h2>${escapeHtml(settings.homeEventsTitle || "অ্যালামনাই অ্যাসোসিয়েশন ইভেন্টস")}</h2>
            <p>${escapeHtml(settings.homeEventsSubtitle || "অ্যালামনাই ইভেন্টস সম্পর্কে জানুন")}</p>
          </div>
          ${events.length ? postCards(events.slice(0, 3)) : `<div class="empty-state">${escapeHtml(settings.homeEventsEmptyText || "নতুন কোন ইভেন্ট নেই")}</div>`}
        </div>
      </section>
    `;
  }

  function homeQuoteSection() {
    const quotes = (state.data.quotes && state.data.quotes.length)
      ? state.data.quotes
      : [{
        name: "এন আর মুর্থি",
        quote: "প্রাক্তন শিক্ষার্থীদের চেয়ে বেশি কেউ একটি প্রতিষ্ঠান নিয়ে মাথা ঘামায় না"
      }];
    return `
      <section class="quote-band alumni-quote-band">
        <div class="container quote-grid">
          ${quotes.map((item) =>
      `<blockquote><p>${escapeHtml(item.quote)}</p><cite>${escapeHtml(item.name)}</cite></blockquote>`
    ).join("")}
        </div>
      </section>
    `;
  }

  function homePage() {
    const about = state.data.pages.find((p) => p.key === "about") || {};
    const recentPosts = state.data.posts.slice(0, 3);
    const year = activeCommitteeYear();
    return `
      ${hero()}
      <section class="content-section split-section">
        <div class="container split-grid">
          <div class="copy-block">
            <span class="eyebrow">আমাদের কথা</span>
            <h2>${escapeHtml(about.title || "")}</h2>
            <h3>${escapeHtml(about.subtitle || "")}</h3>
            ${paragraphs((about.body || []).slice(0, 3))}
            <a class="skew-button" href="/about-us/">বিস্তারিত জানুন</a>
          </div>
          <div class="image-panel">
            <img src="${escapeHtml(about.image || "/assets/about-school.jpg")}" alt="${escapeHtml(about.title || "")}">
          </div>
        </div>
      </section>
      <section class="content-section soft-band">
        <div class="container">
          ${sectionHeading("আহবায়ক কমিটি", `${year} সালের কমিটির সদস্যদের সাথে পরিচিত হোন`, "কমিটি")}
          ${committeeCards(8, { year, activeOnly: true, type: "আহবায়ক কমিটি" })}
          <div class="center-action"><a class="skew-button" href="/committee/">সব সদস্য দেখুন</a></div>
        </div>
      </section>
      ${homeEventsSection()}
      ${homeQuoteSection()}
      <section class="content-section">
        <div class="container">
          ${sectionHeading("সাম্প্রতিক সংবাদ", "ফোরামের সর্বশেষ কার্যক্রম সম্পর্কে জানুন", "সংবাদ")}
          ${postCards(recentPosts)}
          <div class="center-action"><a class="skew-button" href="/news/">সব খবর দেখুন</a></div>
        </div>
      </section>
      ${ctaBanner()}
    `;
  }

  /* ── About Page ──────────────────────────────────────────── */
  function aboutPage(page) {
    const year = activeCommitteeYear();
    return `
      ${pageHero(page)}
      <section class="content-section split-section">
        <div class="container split-grid">
          <div class="copy-block">
            <span class="eyebrow">আমাদের পরিচয়</span>
            <h2>${escapeHtml(page.title)}</h2>
            <h3>${escapeHtml(page.subtitle)}</h3>
            ${paragraphs(page.body)}
          </div>
          <div class="image-panel">
            <img src="${escapeHtml(page.image)}" alt="${escapeHtml(page.title)}">
          </div>
        </div>
      </section>
      <section class="content-section soft-band">
        <div class="container">
          ${sectionHeading("কার্যনির্বাহী কমিটি", `${year} সালের কার্যনির্বাহী কমিটির সদস্যগণ`)}
          ${committeeCards(8, { year, activeOnly: true, type: "কার্যনির্বাহী কমিটি" })}
          <div class="center-action"><a class="skew-button" href="/committee/">সব সদস্য দেখুন</a></div>
        </div>
      </section>
    `;
  }

  /* ── Simple Page ─────────────────────────────────────────── */
  function simplePage(page) {
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container narrow-copy">
          ${paragraphs(page.body)}
        </div>
      </section>
    `;
  }

  /* ── Committee Page ──────────────────────────────────────── */
  function committeePage(page) {
    const years = committeeSessionOptions(false);
    const year = activeCommitteeYear();
    const sessionPeople = (state.data.committee || []).filter((person) => committeeSession(person) === year);
    const hasActivePeople = sessionPeople.some((person) => committeeStatus(person) === "active");
    const scoped = sortCommitteePeople(hasActivePeople
      ? sessionPeople.filter((person) => committeeStatus(person) === "active")
      : sessionPeople);
    const typeOrder = COMMITTEE_TYPE_OPTIONS;
    const availableTypes = [...new Set(scoped.map((person) => committeeType(person)).filter(Boolean))];
    const types = [
      ...typeOrder.filter((type) => availableTypes.includes(type)),
      ...availableTypes.filter((type) => !typeOrder.includes(type))
    ];
    const groupedCommittee = types.length
      ? types.map((type) => `
          <section class="committee-type-section">
            <div class="committee-type-heading">
              <span>${escapeHtml(year)}</span>
              <h3>${escapeHtml(type)}</h3>
            </div>
            ${committeeCards(null, { year, type, activeOnly: hasActivePeople, emptyMessage: `এই ${type}র সদস্য এখনো যোগ করা হয়নি` })}
          </section>
        `).join("")
      : `<div class="empty-state">এই সেশনের কোনো কমিটি পাওয়া যায়নি</div>`;
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container">
          ${sectionHeading(page.title, page.subtitle)}
          <div class="intro-copy">${paragraphs(page.body)}</div>
          <div class="committee-filter">
            <label>
              <span>কমিটির বছর নির্বাচন করুন</span>
              <select data-committee-year>
                ${years.map((y) =>
      `<option value="${escapeHtml(y)}" ${y === year ? "selected" : ""}>${escapeHtml(y)}</option>`
    ).join("")}
              </select>
            </label>
          </div>
          ${groupedCommittee}
        </div>
      </section>
    `;
  }

  /* ── Members Page ────────────────────────────────────────── */
  function memberYearOptions() {
    return [...new Set((state.data.members || []).map((member) => member.batch || "").filter(Boolean))]
      .sort((a, b) => yearScore(b) - yearScore(a));
  }

  function filteredMembers() {
    const query = state.memberSearch.trim().toLowerCase();
    const year = state.memberYear;
    return (state.data.members || []).filter((member) => {
      if (year && String(member.batch || "") !== String(year)) return false;
      if (!query) return true;
      const haystack = [
        member.name,
        member.email,
        member.phone,
        member.address,
        member.batch,
        member.type
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  function memberDataTable() {
    const members = filteredMembers();
    const total = members.length;
    const pageSize = Number(state.memberPageSize) || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    state.memberPage = Math.min(Math.max(1, Number(state.memberPage) || 1), totalPages);
    const start = total ? (state.memberPage - 1) * pageSize : 0;
    const visible = members.slice(start, start + pageSize);
    const from = total ? start + 1 : 0;
    const to = Math.min(start + pageSize, total);
    const years = memberYearOptions();

    return `
      <div class="member-data-panel">
        <div class="member-data-toolbar">
          <label class="member-search-field">
            <span>সার্চ</span>
            <input data-member-table-search type="search" value="${escapeHtml(state.memberSearch)}" placeholder="নাম, ফোন, ই-মেইল, ঠিকানা">
          </label>
          <label>
            <span>ব্যাচ / বছর</span>
            <select data-member-table-year>
              <option value="">সব বছর</option>
              ${years.map((year) => `<option value="${escapeHtml(year)}" ${year === state.memberYear ? "selected" : ""}>${escapeHtml(year)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>প্রতি পেজ</span>
            <select data-member-table-page-size>
              ${[10, 25, 50, 100].map((size) => `<option value="${size}" ${Number(state.memberPageSize) === size ? "selected" : ""}>${size}</option>`).join("")}
            </select>
          </label>
          <button class="plain-button" data-member-table-reset type="button">রিসেট</button>
        </div>

        <div class="member-table-summary">
          <span>${escapeHtml(String(from))}-${escapeHtml(String(to))} / ${escapeHtml(String(total))} সদস্য</span>
          ${state.memberYear ? `<strong>ব্যাচ: ${escapeHtml(state.memberYear)}</strong>` : ""}
        </div>

        <div class="table-wrap member-data-table-wrap">
          <table class="members-table member-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ছবি</th>
                <th>নাম</th>
                <th>ই-মেইল</th>
                <th>ফোন</th>
                <th>ঠিকানা</th>
                <th>ব্যাচ</th>
                <th>ধরণ</th>
              </tr>
            </thead>
            <tbody>
              ${visible.length ? visible.map((member, i) => {
        const memberIndex = (state.data.members || []).indexOf(member);
        const profileUrl = `/member-profile/${profileSlug(member.name, "member")}/?id=${encodeURIComponent(member.id || "")}&mi=${memberIndex}`;
        return `<tr data-member-profile-url="${escapeHtml(profileUrl)}" tabindex="0" role="link" aria-label="${escapeHtml(member.name || "Member")} profile">
                  <td data-label="#">${start + i + 1}</td>
                  <td data-label="ছবি">
                    <img class="member-data-photo" src="${escapeHtml(member.image || "/assets/forum-logo.png")}" alt="${escapeHtml(member.name || "Member")}" onerror="this.src='/assets/forum-logo.png'">
                  </td>
                  <td data-label="নাম"><strong>${escapeHtml(member.name || "")}</strong></td>
                  <td data-label="ই-মেইল">${escapeHtml(member.email || "")}</td>
                  <td data-label="ফোন">${escapeHtml(member.phone || "")}</td>
                  <td data-label="ঠিকানা">${escapeHtml(member.address || "")}</td>
                  <td data-label="ব্যাচ">${escapeHtml(member.batch || "")}</td>
                  <td data-label="ধরণ">${escapeHtml(member.type || "")}</td>
                </tr>`;
      }
    ).join("") : `<tr><td colspan="8"><div class="empty-state">কোন সদস্য পাওয়া যায়নি।</div></td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="member-pagination">
          <button class="plain-button" data-member-table-page="${state.memberPage - 1}" ${state.memberPage <= 1 ? "disabled" : ""} type="button">পূর্ববর্তী</button>
          <span>পেজ ${escapeHtml(String(state.memberPage))} / ${escapeHtml(String(totalPages))}</span>
          <button class="plain-button" data-member-table-page="${state.memberPage + 1}" ${state.memberPage >= totalPages ? "disabled" : ""} type="button">পরবর্তী</button>
        </div>
      </div>
    `;
  }

  function membersPage(page) {
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container">
          ${sectionHeading(page.title, page.subtitle || "সদস্যদের তথ্য খুঁজুন ও ব্যাচ অনুযায়ী ফিল্টার করুন")}
          ${memberDataTable()}
        </div>
      </section>
    `;
  }

  /* ── Posts List Page ─────────────────────────────────────── */
  function publicMemberProfilePage() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";
    const mi = parseInt(params.get("mi") ?? "0", 10);
    const members = state.data.members || [];
    const member = members.find((item) => String(item.id || "") === String(id))
      || members[mi]
      || null;

    if (!member) {
      return `
        ${pageHero({ title: "সদস্য পাওয়া যায়নি" })}
        <section class="content-section">
          <div class="container centered-copy">
            <p>এই সদস্যের তথ্য পাওয়া যায়নি।</p>
            <a class="skew-button" href="/alumni-members-profiles/">ফিরে যান</a>
          </div>
        </section>
      `;
    }

    return `
      ${pageHero({ title: "সদস্য প্রোফাইল" })}
      <section class="profile-page member-public-profile-page">
        <div class="container">
          <div class="profile-back">
            <a class="skew-button" href="/alumni-members-profiles/" style="font-size:13px;padding:8px 20px;">← সদস্য তালিকায় ফিরুন</a>
          </div>
          <div class="profile-card member-public-profile-card">
            <div class="profile-photo-col">
              <img src="${escapeHtml(member.image || "/assets/forum-logo.png")}"
                   alt="${escapeHtml(member.name || "Member")}"
                   onerror="this.src='/assets/forum-logo.png'">
              <div class="profile-name">${escapeHtml(member.name || "Member")}</div>
              <div class="profile-role">${escapeHtml(member.type || "সদস্য")}</div>
              <span class="profile-year-badge">${member.batch ? `ব্যাচ ${escapeHtml(member.batch)}` : "সদস্য প্রোফাইল"}</span>
              <div class="profile-contact">
                ${member.email ? `<div class="profile-contact-item">ই-মেইল: ${escapeHtml(member.email)}</div>` : ""}
                ${member.phone ? `<div class="profile-contact-item">ফোন: ${escapeHtml(member.phone)}</div>` : ""}
                ${member.address ? `<div class="profile-contact-item">ঠিকানা: ${escapeHtml(member.address)}</div>` : ""}
              </div>
            </div>
            <div class="profile-body-col">
              <h2>${escapeHtml(member.name || "Member")}</h2>
              ${member.type ? `<p><strong>সদস্য ধরন:</strong> ${escapeHtml(member.type)}</p>` : ""}
              ${member.batch ? `<p><strong>ব্যাচ:</strong> ${escapeHtml(member.batch)}</p>` : ""}
              ${member.email ? `<p><strong>ই-মেইল:</strong> ${escapeHtml(member.email)}</p>` : ""}
              ${member.phone ? `<p><strong>ফোন:</strong> ${escapeHtml(member.phone)}</p>` : ""}
              ${member.address ? `<p><strong>ঠিকানা:</strong> ${escapeHtml(member.address)}</p>` : ""}
              <div class="profile-message-box">
                <h3>ফোরাম সদস্য</h3>
                <p>
                  ${escapeHtml(member.name || "এই সদস্য")} প্রাক্তন শিক্ষার্থী ফোরামের একজন সম্মানিত সদস্য।
                  সদস্য প্রোফাইল থেকে ব্যাচ, যোগাযোগ ও পরিচিতির তথ্য দেখা যাবে।
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function postsPage(page) {
    const posts = page.filter === "all"
      ? state.data.posts
      : state.data.posts.filter((p) => p.category === page.filter);
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container">${postCards(posts)}</div>
      </section>
    `;
  }

  function careerPage(page) {
    const careers = state.data.posts.filter((post) => post.category === "Career");
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container career-layout">
          <div class="career-intro">
            <span class="eyebrow">Career</span>
            <h2>${escapeHtml(page.subtitle || "চাকরি ও ক্যারিয়ার বিজ্ঞপ্তি")}</h2>
            ${paragraphs(page.body || [])}
          </div>
          <div class="career-list">
            ${careers.length ? careers.map((post) => `
              <article class="career-card">
                <div>
                  <span>${formatDate(post.date)}</span>
                  <h3><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></h3>
                  <p>${escapeHtml(post.excerpt)}</p>
                </div>
                <a class="plain-link" href="${escapeHtml(post.path)}">বিস্তারিত দেখুন</a>
              </article>
            `).join("") : `<div class="empty-state">এখনো কোনো চাকরির বিজ্ঞপ্তি নেই।</div>`}
          </div>
        </div>
      </section>
    `;
  }

  function loginForm(options = {}) {
    return `
      <form class="site-form auth-panel" data-auth-form="login">
        ${options.title === false ? "" : `<h3>${escapeHtml(options.title || "সদস্য লগইন")}</h3>`}
        ${options.note ? `<p>${escapeHtml(options.note)}</p>` : ""}
        <label>ই-মেইল<input name="email" type="email" required></label>
        <label>পাসওয়ার্ড<input name="password" type="password" required></label>
        <button class="skew-button" type="submit">প্রবেশ করুন</button>
        <p class="form-status" aria-live="polite"></p>
      </form>
    `;
  }

  function passwordChangePage(page = {}) {
    return `
      ${pageHero({ ...page, title: "পাসওয়ার্ড পরিবর্তন" })}
      <section class="content-section member-area-section">
        <div class="container account-layout">
          <form class="site-form auth-panel password-change-card" data-member-password-form>
            <span class="eyebrow">First login</span>
            <h3>নতুন পাসওয়ার্ড সেট করুন</h3>
            <p>নিরাপত্তার জন্য প্রথম লগইনের পরে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক। তারপর প্রোফাইল ও ফোরাম ব্যবহার করতে পারবেন।</p>
            <label>নতুন পাসওয়ার্ড<input name="newPassword" type="password" minlength="6" required></label>
            <label>পাসওয়ার্ড নিশ্চিত করুন<input name="confirmPassword" type="password" minlength="6" required></label>
            <button class="skew-button" type="submit">পাসওয়ার্ড আপডেট করুন</button>
            <button class="plain-button" data-member-logout type="button">লগআউট</button>
            <p class="form-status" aria-live="polite"></p>
          </form>
        </div>
      </section>
    `;
  }

  function forumComposer() {
    if (!state.authUser) {
      return `
        <div class="forum-auth forum-join-card forum-composer-card">
          <div>
            <span class="eyebrow">Member only</span>
            <h2>আপনার পোস্ট লিখুন</h2>
            <p>ফোরামে পোস্ট, লাইক বা মন্তব্য করতে সদস্য লগইন প্রয়োজন।</p>
          </div>
          <button class="skew-button" data-require-login="পোস্ট করতে সদস্য লগইন করুন।" type="button">লগইন করে পোস্ট করুন</button>
        </div>
      `;
    }

    if (state.authUser.mustChangePassword) {
      return `
        <div class="forum-auth forum-join-card forum-composer-card">
          <div>
            <span class="eyebrow">Password required</span>
            <h2>প্রথমে পাসওয়ার্ড পরিবর্তন করুন</h2>
            <p>ফোরামে পোস্ট, লাইক বা মন্তব্য করার আগে আপনার নতুন পাসওয়ার্ড সেট করতে হবে।</p>
          </div>
          <a class="skew-button" href="/login/">পাসওয়ার্ড পরিবর্তন করুন</a>
        </div>
      `;
    }

    const member = state.authUser.member || {};
    const displayName = member.name || state.authUser.email || "Member";
    const photo = member.image || "/assets/forum-logo.png";
    return `
      <form class="site-form forum-composer forum-composer-card" data-forum-post>
        <div class="forum-composer-user">
          <img src="${escapeHtml(photo)}" alt="${escapeHtml(displayName)}" onerror="this.src='/assets/forum-logo.png'">
          <div>
            <span>Posting as</span>
            <strong>${escapeHtml(displayName)}</strong>
            <small>${escapeHtml(state.authUser.email || "")}</small>
          </div>
          <button class="plain-button" data-member-logout type="button">লগআউট</button>
        </div>
        <label class="forum-title-input">
          <span>শিরোনাম</span>
          <input name="title" type="text" placeholder="আপনার আলোচনার শিরোনাম লিখুন" required>
        </label>
        <label class="forum-body-input">
          <span>লেখা</span>
          <textarea name="body" placeholder="ধারণা, প্রশ্ন, শিক্ষা বিষয়ক লেখা বা স্মৃতি লিখুন..." required></textarea>
        </label>
        <div class="forum-compose-actions">
          <label>
            <span>ধরণ</span>
            <select name="category">
              <option>Idea</option>
              <option>Education</option>
              <option>Question</option>
              <option>Notice</option>
              <option>Memory</option>
            </select>
          </label>
          <button class="skew-button" type="submit">পোস্ট করুন</button>
        </div>
        <p class="form-status" aria-live="polite"></p>
      </form>
    `;
  }

  function forumPostCard(post) {
    const comments = post.comments || [];
    const postUrl = `${window.location.origin}/forum/#post-${encodeURIComponent(post.id)}`;
    return `
      <article class="forum-card" id="post-${escapeHtml(post.id)}">
        <div class="forum-card-head">
          <div>
            <span>${escapeHtml(post.category || "General")}</span>
            <h3>${escapeHtml(post.title)}</h3>
          </div>
          <time>${formatDateTime(post.createdAt)}</time>
        </div>
        <p class="forum-author">${escapeHtml(post.authorName || "Member")}</p>
        <div class="forum-body">${escapeHtml(post.body).replace(/\n/g, "<br>")}</div>
        <div class="forum-actions">
          <button class="${post.likedByMe ? "active" : ""}" data-forum-like="${escapeHtml(post.id)}" type="button">
            ${post.likedByMe ? "লাইক করা" : "লাইক"} <span>${Number(post.likes || 0)}</span>
          </button>
          <button data-comment-toggle="${escapeHtml(post.id)}" type="button">মন্তব্য</button>
          <button data-forum-share="${escapeHtml(postUrl)}" type="button">শেয়ার</button>
        </div>
        <div class="comment-list">
          ${comments.map((comment) => `
            <div class="comment-item">
              <strong>${escapeHtml(comment.authorName || "Member")}</strong>
              <p>${escapeHtml(comment.body)}</p>
              <time>${formatDateTime(comment.createdAt)}</time>
            </div>
          `).join("")}
        </div>
        ${state.authUser ? `
          <form class="comment-form" data-forum-comment="${escapeHtml(post.id)}">
            <input name="body" type="text" placeholder="মন্তব্য লিখুন" required>
            <button class="plain-button" type="submit">মন্তব্য</button>
          </form>
        ` : `
          <div class="comment-form login-comment">
            <button class="plain-button" data-require-login="মন্তব্য করতে সদস্য লগইন করুন।" type="button">মন্তব্য করতে লগইন করুন</button>
          </div>
        `}
      </article>
    `;
  }

  function forumPage(page) {
    const posts = state.data.forumPosts || [];
    return `
      ${pageHero(page)}
      ${loginPrompt()}
      <section class="content-section forum-section">
        <div class="container forum-page-layout">
          ${forumComposer()}
          <div class="forum-feed">
            <div class="forum-feed-head">
              <div>
                <span class="eyebrow">Forum feed</span>
                <h2>সদস্যদের আলোচনা</h2>
              </div>
              <button class="plain-button" data-refresh-forum type="button">রিফ্রেশ</button>
            </div>
            ${posts.length ? posts.map(forumPostCard).join("") : `<div class="empty-state">এখনো কোনো ফোরাম পোস্ট নেই। প্রথম পোস্টটি লিখুন।</div>`}
          </div>
        </div>
      </section>
    `;
  }

  function loginPrompt() {
    return `
      <div class="forum-login-modal" data-login-modal hidden>
        <div class="forum-login-dialog">
          <button class="plain-button" data-close-login type="button">বন্ধ</button>
          ${loginForm({ title: "সদস্য লগইন", note: "এই কাজটি করতে সদস্য লগইন প্রয়োজন।" })}
        </div>
      </div>
    `;
  }

  /* ── Post Detail Page ────────────────────────────────────── */
  function postPage(post) {
    return `
      ${pageHero({ title: post.title })}
      <article class="content-section">
        <div class="container article-layout">
          ${post.image ? `<img class="article-image" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}">` : ""}
          <div class="post-meta">
            <span>${escapeHtml(post.category)}</span>
            <span>${formatDate(post.date)}</span>
          </div>
          <h2>${escapeHtml(post.title)}</h2>
          ${paragraphs(post.body)}
        </div>
      </article>
    `;
  }

  /* ── Download Page ───────────────────────────────────────── */
  function downloadPage(page) {
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container narrow-copy centered-copy">
          ${paragraphs(page.body)}
          <a class="skew-button" href="${escapeHtml(page.downloadUrl)}" target="_blank" rel="noreferrer">
            ${escapeHtml(page.downloadLabel)}
          </a>
        </div>
      </section>
    `;
  }

  /* ── Gallery Page ────────────────────────────────────────── */
  function galleryPage(page) {
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container gallery-grid">
          ${state.data.gallery.map((item) => `
            <figure class="gallery-item">
              <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">
              <figcaption>${escapeHtml(item.title)}</figcaption>
            </figure>
          `).join("")}
        </div>
      </section>
    `;
  }

  /* ── Member Application Form ─────────────────────────────── */
  function memberFormPage(page) {
    const fields = [
      ["nameBn", "আবেদনকারীর নাম (বাংলায়)"],
      ["nameEn", "ইংরেজিতে (Capital Letter)"],
      ["father", "পিতার নাম"],
      ["mother", "মাতার নাম"],
      ["currentAddress", "বর্তমান ঠিকানা"],
      ["permanentAddress", "স্থায়ী ঠিকানা"],
      ["religion", "ধর্ম"],
      ["nationality", "জাতীয়তা"],
      ["birthDate", "জন্ম তারিখ"],
      ["nid", "এন.আই. ডি"],
      ["passport", "পাসপোর্ট নম্বর (প্রবাসীদের জন্য)"],
      ["phone", "ফোন নম্বর"],
      ["mobile", "মোবাইল নাম্বার"],
      ["email", "ই-মেইল"],
      ["admissionYear", "বিদ্যালয়ে ভর্তি হওয়ার বছর"],
      ["passingYear", "এস.এস.সি / এইচ.এস.সি পাশের বছর"],
      ["leavingYear", "বিদ্যালয় ত্যাগের বছর"],
      ["education", "শিক্ষাগত যোগ্যতা"],
      ["profession", "পেশা"]
    ];
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container form-layout">
          <div class="bank-box">
            <h2>${escapeHtml(state.data.settings.bankTitle)}</h2>
            ${state.data.settings.bankLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
          </div>
          <form class="site-form" data-form="application">
            <p class="form-intro">${escapeHtml(page.body[0])}</p>
            <div class="form-grid">
              ${fields.map(([name, label]) =>
      `<label>${escapeHtml(label)}<input name="${name}" type="text"></label>`
    ).join("")}
              <label>সদস্যের ধরণ
                <select name="memberType">
                  <option>সাধারণ</option>
                  <option>আজীবন</option>
                </select>
              </label>
              <label>সদস্য চাঁদা পরিমান<input name="amount" type="text"></label>
              <label>পেমেন্ট মাধ্যম
                <select name="paymentMethod" required>
                  <option value="">নির্বাচন করুন</option>
                  <option value="bKash">bKash</option>
                  <option value="Nagad">Nagad</option>
                </select>
              </label>
              <label>যে নম্বর থেকে পেমেন্ট করা হয়েছে<input name="paymentMobile" type="text" placeholder="01XXXXXXXXX"></label>
              <label>Transaction ID<input name="transactionId" type="text"></label>
              <label>পেমেন্টের তারিখ<input name="paymentDate" type="date"></label>
              <label class="wide-field member-photo-field">সদস্যের ছবি
                <input name="memberImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-member-image-input>
                <small>JPG, PNG, WebP বা GIF ছবি দিন। সর্বোচ্চ 2MB।</small>
                <img class="member-photo-preview" data-member-image-preview alt="" hidden>
              </label>
              <label class="wide-field">অঙ্গীকার
                <textarea name="promise">আমি অঙ্গিকার করছি যে সংগঠনের সদস্য হিসাবে অন্তর্ভুক্ত হলে আমি সংগঠনের সকল আদর্শ, উদ্দেশ্য, নীতিমালা মেনে চলতে বাধ্য থাকব।</textarea>
              </label>
            </div>
            <button class="skew-button" type="submit">আবেদন করুন</button>
            <p class="form-status" aria-live="polite"></p>
          </form>
        </div>
      </section>
    `;
  }

  /* ── Contact Page ────────────────────────────────────────── */
  function contactPage(page) {
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container contact-grid">
          <div class="copy-block">
            <span class="eyebrow">${escapeHtml(page.subtitle)}</span>
            <h2>আমাদের লিখুন</h2>
            ${paragraphs(page.body)}
            <p>📧 ${escapeHtml(state.data.settings.email)}</p>
            <p>📞 ${escapeHtml(state.data.settings.phone)}</p>
            <p>📍 ${escapeHtml(state.data.settings.address)}</p>
          </div>
          <form class="site-form" data-form="message">
            <label>নাম<input name="name" type="text" required></label>
            <label>ই-মেইল<input name="email" type="email" required></label>
            <label>বিষয়<input name="subject" type="text"></label>
            <label>বার্তা<textarea name="message" required></textarea></label>
            <button class="skew-button" type="submit">পাঠান</button>
            <p class="form-status" aria-live="polite"></p>
          </form>
        </div>
      </section>
    `;
  }

  /* ── Restricted Page ─────────────────────────────────────── */
  function restrictedPage(page) {
    if (state.authUser?.mustChangePassword) return passwordChangePage(page);
    if (state.authUser) return memberProfilePage(page);
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container narrow-copy centered-copy">
          ${paragraphs(page.body)}
          <a class="skew-button" href="/login/">Login</a>
        </div>
      </section>
    `;
  }

  function memberProfilePage(page) {
    const user = state.authUser;
    const member = user?.member || {};
    const photo = member.image || "/assets/forum-logo.png";
    const displayName = member.name || user?.email || "Member";
    return `
      ${pageHero(page)}
      <section class="profile-page member-area-section">
        <div class="container">
          <div class="profile-card member-detail-card">
            <div class="profile-photo-col">
              <img src="${escapeHtml(photo)}"
                   alt="${escapeHtml(displayName)}"
                   onerror="this.src='/assets/forum-logo.png'">
              <div class="profile-name">${escapeHtml(displayName)}</div>
              <div class="profile-role">${escapeHtml(member.type || "সদস্য")}</div>
              <span class="profile-year-badge">${member.batch ? `ব্যাচ ${escapeHtml(member.batch)}` : "সদস্য প্রোফাইল"}</span>
              <div class="profile-contact">
                ${(member.email || user?.email) ? `<div class="profile-contact-item">ই-মেইল: ${escapeHtml(member.email || user?.email || "")}</div>` : ""}
                ${(member.phone || user?.phone) ? `<div class="profile-contact-item">ফোন: ${escapeHtml(member.phone || user?.phone || "")}</div>` : ""}
                ${member.address ? `<div class="profile-contact-item">ঠিকানা: ${escapeHtml(member.address)}</div>` : ""}
              </div>
              <div class="member-profile-actions">
                <a class="plain-button primary" href="/forum/">ফোরামে যান</a>
                <button class="plain-button" data-member-logout type="button">লগআউট</button>
              </div>
            </div>
            <div class="profile-body-col member-profile-body">
              <h2>আমার প্রোফাইল</h2>
              <p><strong>নাম:</strong> ${escapeHtml(displayName)}</p>
              ${(member.email || user?.email) ? `<p><strong>ই-মেইল:</strong> ${escapeHtml(member.email || user?.email || "")}</p>` : ""}
              ${(member.phone || user?.phone) ? `<p><strong>ফোন:</strong> ${escapeHtml(member.phone || user?.phone || "")}</p>` : ""}
              ${member.batch ? `<p><strong>ব্যাচ:</strong> ${escapeHtml(member.batch)}</p>` : ""}
              ${member.type ? `<p><strong>সদস্য ধরন:</strong> ${escapeHtml(member.type)}</p>` : ""}
              <div class="profile-message-box member-edit-box">
                <h3>তথ্য আপডেট করুন</h3>
                <form class="site-form member-profile-form" data-profile-form>
                  <div class="form-grid">
                    <label>নাম<input name="name" type="text" value="${escapeHtml(member.name || "")}" required></label>
                    <label>ই-মেইল<input name="email" type="email" value="${escapeHtml(member.email || user?.email || "")}" required></label>
                    <label>ফোন<input name="phone" type="text" value="${escapeHtml(member.phone || user?.phone || "")}"></label>
                    <label>ব্যাচ<input name="batch" type="text" value="${escapeHtml(member.batch || "")}"></label>
                    <label>ধরণ<input name="type" type="text" value="${escapeHtml(member.type || "")}"></label>
                    <label>ছবি পথ<input name="image" type="text" value="${escapeHtml(member.image || "")}" placeholder="/assets/members/name.jpg"></label>
                    <label class="wide-field member-photo-field profile-upload-field">প্রোফাইল ছবি আপলোড
                      <input name="memberImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-member-image-input>
                      <small>JPG, PNG, WebP বা GIF ছবি দিন। সর্বোচ্চ 2MB।</small>
                      <img class="member-photo-preview" data-member-image-preview alt="" hidden>
                    </label>
                    <label class="wide-field">ঠিকানা<input name="address" type="text" value="${escapeHtml(member.address || "")}"></label>
                  </div>
                  <div class="account-actions">
                    <button class="skew-button" type="submit">তথ্য আপডেট করুন</button>
                    <a class="plain-button" href="/forum/">ফোরামে যান</a>
                  </div>
                  <p class="form-status" aria-live="polite"></p>
                </form>
              </div>
              <div class="profile-message-box">
                <h3>সদস্য এলাকা</h3>
                <p>
                  এখানে আপনার সদস্য প্রোফাইল, যোগাযোগের তথ্য এবং ফোরাম কার্যক্রমের জন্য ব্যবহারযোগ্য অ্যাকাউন্ট তথ্য রাখা হয়েছে।
                  ছবি আপডেট করলে সেটি সদস্য তালিকা ও কমিটি প্রোফাইলেও দেখা যাবে।
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /* ── Account / Login Page ────────────────────────────────── */
  function accountPage(page) {
    const user = state.authUser;
    if (user?.mustChangePassword) return passwordChangePage(page);
    if (user) return memberProfilePage(page);
    return `
      ${pageHero(page)}
      <section class="content-section">
        <div class="container account-layout">
          ${loginForm({ note: "সদস্য অ্যাকাউন্ট থাকলে লগইন করুন। নতুন অ্যাকাউন্ট অ্যাডমিন প্যানেল থেকে তৈরি হবে।" })}
        </div>
      </section>
    `;
  }

  /* ── Not Found Page ──────────────────────────────────────── */
  function notFoundPage() {
    return `
      ${pageHero({ title: "পৃষ্ঠা পাওয়া যায়নি" })}
      <section class="content-section">
        <div class="container narrow-copy centered-copy">
          <p>আপনি যে পৃষ্ঠাটি খুঁজছেন সেটি পাওয়া যায়নি।</p>
          <br>
          <a class="skew-button" href="/">প্রথম পাতায় যান</a>
        </div>
      </section>
    `;
  }

  /* ── Router / Render ─────────────────────────────────────── */
  function renderPage(options = {}) {
    const path = normalizePath(window.location.pathname);
    const page = state.data.pages.find((item) => normalizePath(item.path) === path);
    const post = state.data.posts.find((item) => normalizePath(item.path) === path);

    // Committee/member profile pages (dynamic paths)
    const isProfilePage = path.startsWith("/committee-member/");
    const isMemberProfilePage = path.startsWith("/member-profile/");

    let content = "";

    if (isProfilePage) {
      setTitle("কমিটি সদস্য পরিচিতি");
      content = committeeMemberPage();
    } else if (isMemberProfilePage) {
      setTitle("সদস্য প্রোফাইল");
      content = publicMemberProfilePage();
    } else if (post) {
      setTitle(post.title);
      content = postPage(post);
    } else if (!page) {
      setTitle("পৃষ্ঠা পাওয়া যায়নি");
      content = notFoundPage();
    } else {
      setTitle(page.title);
      if (page.render === "home") content = homePage(page);
      if (page.render === "about") content = aboutPage(page);
      if (page.render === "simple") content = simplePage(page);
      if (page.render === "committee") content = committeePage(page);
      if (page.render === "members") content = membersPage(page);
      if (page.render === "posts") content = postsPage(page);
      if (page.render === "career") content = careerPage(page);
      if (page.render === "forum") content = forumPage(page);
      if (page.render === "download") content = downloadPage(page);
      if (page.render === "gallery") content = galleryPage(page);
      if (page.render === "memberForm") content = memberFormPage(page);
      if (page.render === "contact") content = contactPage(page);
      if (page.render === "restricted") content = restrictedPage(page);
      if (page.render === "account") content = accountPage(page);
    }

    app.innerHTML = `${header()}<main>${content}</main>${footer()}`;
    bindPageEvents();
    if (!options.preserveScroll) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  /* ── Form Submission ─────────────────────────────────────── */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function formPayload(form) {
    const payload = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      if (typeof File !== "undefined" && value instanceof File) {
        if (!value.name || !value.size) continue;
        if (!value.type.startsWith("image/")) throw new Error("শুধু ছবি ফাইল আপলোড করা যাবে।");
        if (value.size > 2 * 1024 * 1024) throw new Error("ছবির সাইজ 2MB বা কম হতে হবে।");
        const field = key.replace(/File$/, "");
        payload[`${field}Name`] = value.name;
        payload[`${field}Base64`] = await fileToBase64(value);
        continue;
      }
      payload[key] = value;
    }
    return payload;
  }

  async function submitJson(url, form) {
    const status = form.querySelector(".form-status");
    const payload = await formPayload(form);
    status.textContent = "পাঠানো হচ্ছে...";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(result.error || "Submit failed");
    form.reset();
    form.querySelectorAll("[data-member-image-preview]").forEach((preview) => {
      preview.hidden = true;
      preview.removeAttribute("src");
    });
    status.textContent = "সফলভাবে জমা হয়েছে।";
  }

  async function handleAuthForm(form) {
    const status = form.querySelector(".form-status");
    const payload = Object.fromEntries(new FormData(form).entries());
    status.textContent = "লগইন হচ্ছে...";
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuth(result.token, result.user);
    await loadAuth();
    if (state.authUser?.mustChangePassword) {
      if (normalizePath(window.location.pathname) !== "/login/") {
        history.pushState({}, "", "/login/");
      }
      renderPage({ preserveScroll: true });
      return;
    }
    if (normalizePath(window.location.pathname) === "/forum/") {
      await refreshForum().catch(() => {});
    }
    renderPage({ preserveScroll: true });
  }

  async function refreshForumAndRender() {
    await refreshForum();
    renderPage({ preserveScroll: true });
  }

  function showLoginPrompt(message = "এই কাজটি করতে সদস্য লগইন প্রয়োজন।") {
    const modal = app.querySelector("[data-login-modal]");
    if (!modal) {
      history.pushState({}, "", "/login/");
      renderPage();
      return;
    }
    modal.hidden = false;
    const note = modal.querySelector(".auth-panel p");
    if (note) note.textContent = message;
    const email = modal.querySelector("input[name='email']");
    if (email) email.focus();
  }

  function showPasswordChangePrompt() {
    if (normalizePath(window.location.pathname) !== "/login/") {
      history.pushState({}, "", "/login/");
    }
    renderPage({ preserveScroll: true });
  }

  function needsPasswordChange() {
    if (!state.authUser?.mustChangePassword) return false;
    showPasswordChangePrompt();
    return true;
  }

  /* ── Event Binding ───────────────────────────────────────── */
  function bindPageEvents() {
    // SPA link hijack
    app.querySelectorAll("a[href^='/']").forEach((anchor) => {
      anchor.addEventListener("click", async (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const href = anchor.getAttribute("href");
        if (href.includes(".")) return;
        event.preventDefault();
        history.pushState({}, "", href);
        if (normalizePath(window.location.pathname) === "/forum/") {
          await refreshForumAndRender().catch(() => renderPage());
          return;
        }
        renderPage();
      });
    });

    // Committee card click → profile page
    app.querySelectorAll(".team-card[data-profile-url]").forEach((card) => {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        const url = card.dataset.profileUrl;
        history.pushState({}, "", url);
        renderPage();
      });
    });

    app.querySelectorAll("[data-member-profile-url]").forEach((row) => {
      const openProfile = () => {
        const url = row.dataset.memberProfileUrl;
        if (!url) return;
        history.pushState({}, "", url);
        renderPage();
      };

      row.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, select, textarea")) return;
        openProfile();
      });

      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openProfile();
      });
    });

    // Mobile menu toggle
    const menuToggle = app.querySelector(".menu-toggle");
    const menu = app.querySelector(".primary-menu");
    if (menuToggle && menu) {
      menuToggle.addEventListener("click", () => {
        const open = menu.classList.toggle("open");
        menuToggle.setAttribute("aria-expanded", String(open));
      });
    }

    // Hero slide dots
    app.querySelectorAll("[data-slide]").forEach((button) => {
      button.addEventListener("click", () => {
        state.slide = Number(button.dataset.slide);
        renderPage({ preserveScroll: true });
      });
    });

    // Committee year filter
    const committeeYearSel = app.querySelector("[data-committee-year]");
    if (committeeYearSel) {
      committeeYearSel.addEventListener("change", () => {
        state.committeeYear = committeeYearSel.value;
        renderPage({ preserveScroll: true });
      });
    }

    const memberSearch = app.querySelector("[data-member-table-search]");
    if (memberSearch) {
      memberSearch.addEventListener("input", () => {
        state.memberSearch = memberSearch.value;
        state.memberPage = 1;
        renderPage({ preserveScroll: true });
        const nextSearch = app.querySelector("[data-member-table-search]");
        if (nextSearch) {
          nextSearch.focus();
          nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
        }
      });
    }

    const memberYear = app.querySelector("[data-member-table-year]");
    if (memberYear) {
      memberYear.addEventListener("change", () => {
        state.memberYear = memberYear.value;
        state.memberPage = 1;
        renderPage({ preserveScroll: true });
      });
    }

    const memberPageSize = app.querySelector("[data-member-table-page-size]");
    if (memberPageSize) {
      memberPageSize.addEventListener("change", () => {
        state.memberPageSize = Number(memberPageSize.value) || 10;
        state.memberPage = 1;
        renderPage({ preserveScroll: true });
      });
    }

    app.querySelectorAll("[data-member-table-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.memberPage = Number(button.dataset.memberTablePage) || 1;
        renderPage({ preserveScroll: true });
      });
    });

    const memberReset = app.querySelector("[data-member-table-reset]");
    if (memberReset) {
      memberReset.addEventListener("click", () => {
        state.memberSearch = "";
        state.memberYear = "";
        state.memberPage = 1;
        state.memberPageSize = 10;
        renderPage({ preserveScroll: true });
      });
    }

    app.querySelectorAll("[data-member-image-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const preview = input.closest(".member-photo-field")?.querySelector("[data-member-image-preview]");
        const file = input.files?.[0];
        if (!preview) return;
        if (!file) {
          preview.hidden = true;
          preview.removeAttribute("src");
          return;
        }
        preview.src = URL.createObjectURL(file);
        preview.hidden = false;
      });
    });

    // Forms
    app.querySelectorAll("form[data-form='application']").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try { await submitJson("/api/applications", form); }
        catch (error) { form.querySelector(".form-status").textContent = error.message || "জমা দেওয়া যায়নি।"; }
      });
    });

    app.querySelectorAll("form[data-form='message']").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try { await submitJson("/api/messages", form); }
        catch { form.querySelector(".form-status").textContent = "বার্তা পাঠানো যায়নি।"; }
      });
    });

    app.querySelectorAll("[data-member-logout]").forEach((button) => {
      button.addEventListener("click", () => {
        setAuth("", null);
        renderPage({ preserveScroll: true });
      });
    });

    app.querySelectorAll("form[data-auth-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await handleAuthForm(form);
        } catch (error) {
          form.querySelector(".form-status").textContent = error.message || "অনুরোধ সম্পন্ন হয়নি।";
        }
      });
    });

    app.querySelectorAll("form[data-member-password-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector(".form-status");
        const payload = Object.fromEntries(new FormData(form).entries());
        if (payload.newPassword !== payload.confirmPassword) {
          status.textContent = "পাসওয়ার্ড মিলছে না।";
          return;
        }
        if (String(payload.newPassword || "").length < 6) {
          status.textContent = "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।";
          return;
        }
        status.textContent = "পাসওয়ার্ড আপডেট হচ্ছে...";
        try {
          const result = await api("/api/auth/change-password", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          state.authUser = result.user;
          status.textContent = "পাসওয়ার্ড আপডেট হয়েছে।";
          renderPage({ preserveScroll: true });
        } catch (error) {
          status.textContent = error.message || "পাসওয়ার্ড আপডেট করা যায়নি।";
        }
      });
    });

    app.querySelectorAll("[data-close-login]").forEach((button) => {
      button.addEventListener("click", () => {
        const modal = button.closest("[data-login-modal]");
        if (modal) modal.hidden = true;
      });
    });

    app.querySelectorAll("[data-require-login]").forEach((button) => {
      button.addEventListener("click", () => {
        showLoginPrompt(button.dataset.requireLogin);
      });
    });

    app.querySelectorAll("form[data-profile-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector(".form-status");
        status.textContent = "আপডেট হচ্ছে...";
        try {
          const payload = await formPayload(form);
          const result = await api("/api/auth/me", { method: "PUT", body: JSON.stringify(payload) });
          state.authUser = result.user;
          if (result.user?.member) {
            const memberIndex = (state.data.members || []).findIndex((item) => String(item.id) === String(result.user.member.id));
            if (memberIndex >= 0) state.data.members[memberIndex] = result.user.member;
            else {
              if (!state.data.members) state.data.members = [];
              state.data.members.push(result.user.member);
            }
          }
          status.textContent = "তথ্য আপডেট হয়েছে।";
          renderPage({ preserveScroll: true });
        } catch (error) {
          status.textContent = error.message || "তথ্য আপডেট করা যায়নি।";
        }
      });
    });

    app.querySelectorAll("form[data-forum-post]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.authUser) {
          showLoginPrompt("পোস্ট করতে সদস্য লগইন করুন।");
          return;
        }
        if (needsPasswordChange()) return;
        const status = form.querySelector(".form-status");
        status.textContent = "পোস্ট প্রকাশ হচ্ছে...";
        try {
          const payload = Object.fromEntries(new FormData(form).entries());
          await api("/api/forum/posts", { method: "POST", body: JSON.stringify(payload) });
          form.reset();
          await refreshForumAndRender();
        } catch (error) {
          status.textContent = error.message || "পোস্ট করা যায়নি।";
        }
      });
    });

    app.querySelectorAll("form[data-forum-comment]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.authUser) {
          showLoginPrompt("মন্তব্য করতে সদস্য লগইন করুন।");
          return;
        }
        if (needsPasswordChange()) return;
        try {
          const payload = Object.fromEntries(new FormData(form).entries());
          await api(`/api/forum/posts/${encodeURIComponent(form.dataset.forumComment)}/comments`, {
            method: "POST",
            body: JSON.stringify(payload)
          });
          await refreshForumAndRender();
        } catch {
          const input = form.querySelector("input");
          if (input) input.placeholder = "মন্তব্য করা যায়নি";
        }
      });
    });

    app.querySelectorAll("[data-forum-like]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!state.authUser) {
          showLoginPrompt("লাইক দিতে সদস্য লগইন করুন।");
          return;
        }
        if (needsPasswordChange()) return;
        try {
          await api(`/api/forum/posts/${encodeURIComponent(button.dataset.forumLike)}/like`, { method: "POST" });
          await refreshForumAndRender();
        } catch {
          button.disabled = true;
        }
      });
    });

    app.querySelectorAll("[data-comment-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!state.authUser) {
          showLoginPrompt("মন্তব্য করতে সদস্য লগইন করুন।");
          return;
        }
        if (needsPasswordChange()) return;
        const form = app.querySelector(`form[data-forum-comment="${CSS.escape(button.dataset.commentToggle)}"]`);
        form?.querySelector("input")?.focus();
      });
    });

    app.querySelectorAll("[data-forum-share]").forEach((button) => {
      button.addEventListener("click", async () => {
        const url = button.dataset.forumShare;
        try {
          if (navigator.share) {
            await navigator.share({ title: document.title, url });
          } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            button.textContent = "লিংক কপি হয়েছে";
          }
        } catch {
          button.textContent = "শেয়ার করা যায়নি";
        }
      });
    });

    app.querySelectorAll("[data-refresh-forum]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.textContent = "রিফ্রেশ হচ্ছে...";
        try { await refreshForumAndRender(); }
        catch { button.textContent = "রিফ্রেশ করা যায়নি"; }
      });
    });
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function init() {
    const response = await fetch("/api/site");
    state.data = await response.json();
    state.data.forumPosts = state.data.forumPosts || [];
    await loadAuth();
    if (normalizePath(window.location.pathname) === "/forum/") {
      await refreshForum().catch(() => {});
    }
    renderPage();
    // Auto-advance hero slider on home page
    setInterval(() => {
      if (normalizePath(window.location.pathname) !== "/") return;
      state.slide = (state.slide + 1) % state.data.heroSlides.length;
      renderPage({ preserveScroll: true });
    }, 5000);
  }

  window.addEventListener("popstate", () => {
    if (normalizePath(window.location.pathname) === "/forum/") {
      refreshForumAndRender().catch(() => renderPage());
      return;
    }
    renderPage();
  });
  init().catch((error) => {
    console.error("Site load failed", error);
    app.innerHTML = `<div class="loading">সাইট লোড করা যায়নি।</div>`;
  });
})();
