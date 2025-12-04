"use strict";
// ==UserScript==
// @name         redDeleteIt UI
// @version      1.0
// @description  Configure and run filtered Reddit deletions with UI, include lists, and dry-run support
// @author       CryptoDragonLady <https://github.com/CryptoDragonLady>
// @match        https://www.reddit.com/user/*
// @match        https://new.reddit.com/user/*
// @match        https://old.reddit.com/user/*
// @match        https://www.reddit.com/u/*
// @match        https://new.reddit.com/u/*
// @grant        none
// @license      GPL V3
// ==/UserScript==
//
//
const UI_DELAY = 800;
const UI_MAX_EMPTY_RUNS = 5;
const UI_SESSION_KEY = "redDeleteItUIConfig";
const UI_RUN_COUNT_KEY = "redDeleteItUIRunCount";
const UI_SCROLL_BURSTS = 3;
let uiIsRunning = false;
let uiDeletedCount = 0;
const defaultConfig = {
    mode: "all",
    thresholdMs: 0,
    summary: "all submissions",
    dryRun: true,
    nsfwOnly: false,
    includeSubreddits: [],
    persistence: "session",
    runOnLoad: false,
};
window.addEventListener("unhandledrejection", (event) => {
    console.warn("redDeleteIt UI: ignored unhandled promise rejection", event.reason);
    event.preventDefault();
});
window.addEventListener("error", (event) => {
    console.warn("redDeleteIt UI: ignored error", event.error || event.message);
}, true);
bootstrap();
async function bootstrap() {
    const saved = loadConfigUI();
    if (saved?.runOnLoad) {
        startRun(saved);
    }
    injectLauncher();
}
function injectLauncher() {
    if (document.getElementById("reddeleteit-launcher")) {
        return;
    }
    const btn = document.createElement("button");
    btn.id = "reddeleteit-launcher";
    btn.textContent = "redDeleteIt";
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: "99999",
        padding: "10px 14px",
        borderRadius: "8px",
        border: "1px solid #b93c2a",
        background: "#e34f2f",
        color: "#fff",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "600",
        lineHeight: "1.2",
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
    });
    btn.addEventListener("click", () => openModal());
    document.body.appendChild(btn);
}
function openModal() {
    if (document.getElementById("reddeleteit-modal")) {
        return;
    }
    const saved = loadConfigUI() ?? defaultConfig;
    const overlay = document.createElement("div");
    overlay.id = "reddeleteit-modal";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.45)",
        zIndex: "99998",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    });
    const modal = document.createElement("div");
    Object.assign(modal.style, {
        background: "#fff",
        color: "#111",
        padding: "16px",
        borderRadius: "10px",
        width: "420px",
        maxHeight: "80vh",
        overflow: "auto",
        boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
        fontSize: "14px",
        lineHeight: "1.4",
    });
    modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;font-size:16px;">redDeleteIt Configuration</h3>
      <button id="rdi-close" aria-label="Close" style="border:none;background:none;font-size:18px;cursor:pointer;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label>Mode:
        <div>
          <label><input type="radio" name="rdi-mode" value="all"> All</label>
          <label><input type="radio" name="rdi-mode" value="older"> Older than</label>
          <label><input type="radio" name="rdi-mode" value="newer"> Newer than</label>
        </div>
      </label>
      <div id="rdi-age-row" style="display:flex;gap:8px;align-items:center;">
        <input id="rdi-amount" type="number" min="1" style="width:80px;" value="30">
        <select id="rdi-unit">
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days" selected>days</option>
          <option value="months">months</option>
        </select>
      </div>
      <label>Include subreddits (only these will be processed):</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="rdi-load-subs" type="button" style="padding:6px 10px;cursor:pointer;">Load my subs</button>
        <span id="rdi-load-status" style="font-size:12px;color:#555;">Idle</span>
      </div>
      <select id="rdi-subs" multiple size="8" style="width:100%;"></select>
      <label><input id="rdi-nsfw" type="checkbox"> NSFW only</label>
      <label><input id="rdi-dryrun" type="checkbox" checked> Dry run (simulate only)</label>
      <label>Persist settings:
        <select id="rdi-persist">
          <option value="session">Session (clears on tab close)</option>
          <option value="local">Local (reopen to reuse)</option>
        </select>
      </label>
      <button id="rdi-start" type="button" style="padding:10px;cursor:pointer;background:#e34f2f;color:#fff;border:none;border-radius:6px;">Start run</button>
    </div>
  `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const closeBtn = modal.querySelector("#rdi-close");
    const modeInputs = Array.from(modal.querySelectorAll("input[name='rdi-mode']"));
    const ageRow = modal.querySelector("#rdi-age-row");
    const amountInput = modal.querySelector("#rdi-amount");
    const unitSelect = modal.querySelector("#rdi-unit");
    const loadSubsBtn = modal.querySelector("#rdi-load-subs");
    const loadStatus = modal.querySelector("#rdi-load-status");
    const subsSelect = modal.querySelector("#rdi-subs");
    const nsfwCheckbox = modal.querySelector("#rdi-nsfw");
    const dryRunCheckbox = modal.querySelector("#rdi-dryrun");
    const persistSelect = modal.querySelector("#rdi-persist");
    const startBtn = modal.querySelector("#rdi-start");
    // populate from saved
    (modeInputs.find(i => i.value === saved.mode) ?? modeInputs[0]).checked = true;
    amountInput.value = saved.thresholdMs ? String(saved.thresholdMs / unitToMsUI(unitSelect.value)) : "30";
    nsfwCheckbox.checked = saved.nsfwOnly;
    dryRunCheckbox.checked = saved.dryRun;
    persistSelect.value = saved.persistence;
    ageRow.style.display = saved.mode === "all" ? "none" : "flex";
    modeInputs.forEach(input => {
        input.addEventListener("change", () => {
            ageRow.style.display = input.value === "all" ? "none" : "flex";
        });
    });
    closeBtn.addEventListener("click", () => overlay.remove());
    loadSubsBtn.addEventListener("click", async () => {
        loadStatus.textContent = "Loading…";
        const subs = await loadCommunities();
        if (subs.length === 0) {
            loadStatus.textContent = "No subs found";
            return;
        }
        loadStatus.textContent = `Loaded ${subs.length}`;
        populateSubs(subsSelect, subs, saved.includeSubreddits);
    });
    // if saved subs exist, populate
    if (saved.includeSubreddits.length > 0) {
        populateSubs(subsSelect, saved.includeSubreddits, saved.includeSubreddits);
    }
    startBtn.addEventListener("click", () => {
        const mode = (modeInputs.find(i => i.checked)?.value ?? "all");
        const unit = unitSelect.value;
        const amount = Number(amountInput.value) || 0;
        const thresholdMs = mode === "all" ? 0 : amount * unitToMsUI(unit);
        const summaryParts = mode === "all" ? ["all submissions"] : [`${mode} than ${amount} ${unit}`];
        const selectedSubs = Array.from(subsSelect.selectedOptions).map(o => o.value);
        if (selectedSubs.length > 0) {
            summaryParts.push(`only in ${selectedSubs.length} sub(s)`);
        }
        if (nsfwCheckbox.checked)
            summaryParts.push("NSFW only");
        if (dryRunCheckbox.checked)
            summaryParts.push("dry run");
        const config = {
            mode,
            thresholdMs,
            summary: summaryParts.join(", "),
            dryRun: dryRunCheckbox.checked,
            nsfwOnly: nsfwCheckbox.checked,
            includeSubreddits: selectedSubs,
            persistence: persistSelect.value,
            runOnLoad: true,
        };
        saveConfigUI(config);
        const profileUrl = getProfileUrl();
        if (profileUrl) {
            window.open(profileUrl, "_blank");
        }
        else {
            startRun(config);
        }
        overlay.remove();
        alert("redDeleteIt: Launching run. If a new tab opened, it will start automatically.");
    });
}
function populateSubs(select, subs, selected) {
    const normalizedSelected = new Set(selected.map(s => s.toLowerCase()));
    select.innerHTML = "";
    subs
        .map(s => s.replace(/^r\//i, ""))
        .sort((a, b) => a.localeCompare(b))
        .forEach(sub => {
        const opt = document.createElement("option");
        opt.value = sub;
        opt.textContent = sub;
        opt.selected = normalizedSelected.has(sub.toLowerCase());
        select.appendChild(opt);
    });
}
function getProfileUrl() {
    const match = window.location.pathname.match(/\/(user|u)\/([^/]+)/);
    if (!match)
        return null;
    const username = match[2];
    return `${window.location.origin}/user/${username}/`;
}
async function startRun(config) {
    if (uiIsRunning)
        return;
    uiIsRunning = true;
    uiDeletedCount = getRunCountUI();
    const token = getCSRFTokenUI();
    if (token === null) {
        alert("Failed to get csrf_token. Unable to continue.");
        uiIsRunning = false;
        return;
    }
    await waitForItemsUI();
    let emptyRuns = 0;
    while (emptyRuns <= UI_MAX_EMPTY_RUNS) {
        const deleted = await deleteNextUI(config, token);
        if (deleted) {
            emptyRuns = 0;
            uiDeletedCount += 1;
            setRunCountUI(uiDeletedCount);
        }
        else {
            const navigated = await loadMoreUI();
            if (navigated) {
                uiIsRunning = false;
                return;
            }
            emptyRuns += 1;
        }
        window.scrollTo(0, document.body.scrollHeight);
        await sleepUI(UI_DELAY);
    }
    const persisted = loadConfigUI();
    if (persisted) {
        persisted.runOnLoad = false;
        saveConfigUI(persisted);
    }
    clearRunCountUI();
    alert(`No more matching submissions found. Total affected: ${uiDeletedCount}. Filter used: ${config.summary}`);
    uiIsRunning = false;
}
function getCSRFTokenUI() {
    const match = document.cookie.match(RegExp('(?:^|;\\s*)csrf_token=([^;]*)'));
    if (match === null) {
        return null;
    }
    return match[1];
}
async function deleteNextUI(config, token) {
    const target = findNextTargetUI(config);
    if (target === null) {
        return false;
    }
    const { element, operation, input } = target;
    if (config.dryRun) {
        console.log(`[DRY RUN] Would delete ${operation}:`, input, element);
        element.setAttribute("data-delete-dry-run-visited", "true");
        return true;
    }
    const data = {
        operation: operation,
        variables: {
            input: input
        },
        csrf_token: token
    };
    const res = await graphqlPostRequestUI(JSON.stringify(data));
    if (res.status !== 200) {
        alert(`Error: Bad http response ${res.status}:\n${res.statusText}`);
        return false;
    }
    element.remove();
    return true;
}
async function graphqlPostRequestUI(body) {
    const response = await fetch("/svc/shreddit/graphql", {
        "credentials": "include",
        "headers": {
            "User-Agent": navigator.userAgent,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/json",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Priority": "u=1"
        },
        "referrer": window.location.href,
        "body": body,
        "method": "POST",
        "mode": "cors"
    });
    return response;
}
function findNextTargetUI(config) {
    const candidates = document.querySelectorAll("shreddit-post, shreddit-profile-comment, [data-fullname]");
    const now = Date.now();
    for (const item of Array.from(candidates)) {
        const element = item;
        if (config.dryRun && element.getAttribute("data-delete-dry-run-visited") === "true") {
            continue;
        }
        if (config.nsfwOnly && !isNsfwUI(element)) {
            continue;
        }
        const subreddit = extractSubreddit(element);
        if (config.includeSubreddits.length > 0) {
            const normalized = subreddit?.toLowerCase();
            const allowed = config.includeSubreddits.map(s => s.toLowerCase());
            if (!normalized || !allowed.includes(normalized)) {
                continue;
            }
        }
        const timestamp = extractTimestampUI(element);
        if (!isTimestampEligibleUI(timestamp, now, config)) {
            continue;
        }
        const target = buildTargetUI(element);
        if (target !== null) {
            return target;
        }
    }
    return null;
}
function buildTargetUI(element) {
    switch (element.tagName) {
        case "SHREDDIT-POST":
            return {
                element,
                operation: "DeletePost",
                input: { postId: element.getAttribute("id") }
            };
        case "SHREDDIT-PROFILE-COMMENT":
            return {
                element,
                operation: "DeleteComment",
                input: { commentId: element.getAttribute("comment-id") }
            };
        default:
            break;
    }
    const fullname = element.getAttribute("data-fullname") || element.getAttribute("fullname") || "";
    if (fullname.startsWith("t3_")) {
        return {
            element,
            operation: "DeletePost",
            input: { postId: fullname }
        };
    }
    if (fullname.startsWith("t1_")) {
        return {
            element,
            operation: "DeleteComment",
            input: { commentId: fullname }
        };
    }
    return null;
}
function extractTimestampUI(element) {
    const timeElement = element.querySelector("time");
    const candidateValues = [
        timeElement?.getAttribute("datetime"),
        timeElement?.getAttribute("data-timestamp"),
        element.getAttribute("data-timestamp"),
        element.getAttribute("data-timestamp-era"),
        element.getAttribute("timestamp"),
        element.getAttribute("created-timestamp"),
    ];
    for (const value of candidateValues) {
        const parsed = parseTimestampUI(value);
        if (parsed !== null) {
            return parsed;
        }
    }
    return null;
}
function parseTimestampUI(value) {
    if (!value) {
        return null;
    }
    if (/^\d+$/.test(value)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        return value.length <= 11 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        return null;
    }
    return parsed;
}
function isTimestampEligibleUI(timestamp, now, config) {
    if (config.mode === "all") {
        return true;
    }
    if (timestamp === null) {
        return false;
    }
    const ageMs = now - timestamp;
    if (config.mode === "older") {
        return ageMs >= config.thresholdMs;
    }
    return ageMs <= config.thresholdMs;
}
function isNsfwUI(element) {
    const attrNames = ["nsfw", "data-nsfw", "data-is-nsfw", "data-subreddit-nsfw", "data-over-18", "over18"];
    if (hasTruthyAttrUI(element, attrNames))
        return true;
    if (element.classList.contains("over18") || element.classList.contains("nsfw"))
        return true;
    const ancestor = element.closest(".over18, .nsfw, [data-over-18], [data-nsfw], [data-is-nsfw], [data-subreddit-nsfw], [over18]");
    if (ancestor && hasTruthyAttrUI(ancestor, attrNames))
        return true;
    if (ancestor && (ancestor.classList.contains("over18") || ancestor.classList.contains("nsfw")))
        return true;
    const pill = element.querySelector('[data-testid*="nsfw" i], [data-testid="post-top-meta-nsfw"], [aria-label="nsfw" i], [data-click-id="nsfw"], .nsfw-stamp, .label-nsfw, .over18, .nsfw');
    if (pill !== null) {
        return true;
    }
    const reloadUrl = element.getAttribute("reload-url") || "";
    if (reloadUrl.includes("isNsfw=true") || reloadUrl.includes("isNsfwProfile=true")) {
        return true;
    }
    const href = element.getAttribute("href") || "";
    if (href.includes("isNsfw=true") || href.includes("isNsfwProfile=true")) {
        return true;
    }
    const text = element.textContent?.toLowerCase() ?? "";
    if (text.includes("nsfw")) {
        return true;
    }
    return false;
}
function hasTruthyAttrUI(element, names) {
    if (!element)
        return false;
    for (const name of names) {
        const value = element.getAttribute(name);
        if (value !== null && isTruthyStringUI(value)) {
            return true;
        }
    }
    return false;
}
function isTruthyStringUI(value) {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}
async function waitForItemsUI(timeoutMs = 8000, intervalMs = 400) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const candidates = document.querySelectorAll("shreddit-post, shreddit-profile-comment, [data-fullname]");
        if (candidates.length > 0) {
            return;
        }
        await sleepUI(intervalMs);
    }
}
async function loadMoreUI() {
    const nextLink = document.querySelector(".next-button a, a[rel~='next']");
    if (nextLink?.href) {
        const url = new URL(nextLink.href);
        url.searchParams.set("count", String(getRunCountUI()));
        window.location.href = url.toString();
        return true; // navigation
    }
    for (let i = 0; i < UI_SCROLL_BURSTS; i++) {
        window.scrollBy(0, window.innerHeight * 0.8);
        await sleepUI(400);
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleepUI(800);
    await waitForItemsUI(3000, 300);
    return false;
}
function sleepUI(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function loadConfigUI() {
    try {
        const rawSession = sessionStorage.getItem(UI_SESSION_KEY);
        const rawLocal = localStorage.getItem(UI_SESSION_KEY);
        const raw = rawSession ?? rawLocal;
        if (!raw)
            return null;
        return { ...defaultConfig, ...JSON.parse(raw) };
    }
    catch {
        return null;
    }
}
function saveConfigUI(config) {
    const storage = config.persistence === "local" ? localStorage : sessionStorage;
    storage.setItem(UI_SESSION_KEY, JSON.stringify(config));
}
function getRunCountUI() {
    const raw = sessionStorage.getItem(UI_RUN_COUNT_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}
function setRunCountUI(count) {
    sessionStorage.setItem(UI_RUN_COUNT_KEY, String(count));
}
function clearRunCountUI() {
    sessionStorage.removeItem(UI_RUN_COUNT_KEY);
}
async function loadCommunities() {
    const subs = [];
    try {
        let after = null;
        do {
            const url = new URL("https://www.reddit.com/subreddits/mine.json");
            url.searchParams.set("limit", "100");
            if (after)
                url.searchParams.set("after", after);
            url.searchParams.set("raw_json", "1");
            const res = await fetch(url.toString(), { credentials: "include" });
            if (!res.ok)
                break;
            const data = await res.json();
            const children = data?.data?.children ?? [];
            for (const child of children) {
                const name = child?.data?.display_name;
                if (name)
                    subs.push(name);
            }
            after = data?.data?.after ?? null;
        } while (after);
    }
    catch {
        // ignore; fallback to scrape
    }
    if (subs.length === 0) {
        const anchors = Array.from(document.querySelectorAll("a[href*='/r/']"));
        anchors.forEach(a => {
            const href = a.href;
            const match = href.match(/\/r\/([^\/?#]+)/);
            if (match)
                subs.push(match[1]);
        });
    }
    return Array.from(new Set(subs));
}
function extractSubreddit(element) {
    const attrNames = ["data-subreddit", "data-subreddit-prefixed"];
    for (const name of attrNames) {
        const value = element.getAttribute(name);
        if (value) {
            return value.replace(/^r\//i, "");
        }
    }
    const fullname = element.getAttribute("data-subreddit-fullname");
    if (fullname && fullname.startsWith("t5_")) {
        const val = element.getAttribute("data-subreddit") || element.getAttribute("data-subreddit-prefixed");
        if (val)
            return val.replace(/^r\//i, "");
    }
    const subredditLink = element.querySelector("a[data-click-id='subreddit'], a[href*='/r/']");
    if (subredditLink?.href) {
        const match = subredditLink.href.match(/\/r\/([^\/?#]+)/);
        if (match) {
            return match[1];
        }
    }
    return null;
}
function unitToMsUI(unit) {
    switch (unit) {
        case "minutes":
            return 60 * 1000;
        case "hours":
            return 60 * 60 * 1000;
        case "days":
            return 24 * 60 * 60 * 1000;
        case "months":
            return 30 * 24 * 60 * 60 * 1000;
    }
}
