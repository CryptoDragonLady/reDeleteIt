"use strict";
// ==UserScript==
// @name         redDeleteIt
// @version      1.1
// @description  Deletes submissions on your userpage, now with filters
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
const DELAY = 800;
const MAX_EMPTY_RUNS = 5;
const SESSION_CONFIG_KEY = "redDeleteItConfig";
const RUN_COUNT_KEY = "redDeleteItCount";
const SCROLL_BURSTS = 3;
let runtimeConfig = null;
let csrfToken = null;
// For debugging after config is set
window.deleteNext = () => {
    if (runtimeConfig === null || csrfToken === null) {
        alert("Config or token unavailable; rerun the script.");
        return Promise.resolve(false);
    }
    return deleteNext(runtimeConfig, csrfToken);
};
// Program begins here
(async () => {
    window.addEventListener("unhandledrejection", (event) => {
        console.warn("redDeleteIt: ignored unhandled promise rejection", event.reason);
        event.preventDefault();
    });
    window.addEventListener("error", (event) => {
        console.warn("redDeleteIt: ignored error", event.error || event.message);
    }, true);
    const existingConfig = loadSavedConfig();
    let config = null;
    if (existingConfig !== null) {
        config = existingConfig;
        console.info(`redDeleteIt: resuming with saved filters (${config.summary}).`);
    }
    else {
        const deleteConfirmation = confirm("Reddit Delete: configure a delete run? This will ask for filters—nothing is deleted until you finish the prompts.");
        if (!deleteConfirmation) {
            return;
        }
        config = promptForConfig();
        if (config === null) {
            alert("Cancelled; no submissions were deleted.");
            return;
        }
        saveConfig(config);
    }
    // Get API token
    const token = getCSRFToken();
    if (token === null) {
        alert("Failed to get csrf_token. Unable to continue.");
        return;
    }
    runtimeConfig = config;
    csrfToken = token;
    if (existingConfig === null) {
        setRunCount(0); // fresh run
    }
    await waitForItems();
    let emptyRuns = 0;
    while (emptyRuns <= MAX_EMPTY_RUNS) {
        const deleted = await deleteNext(config, token);
        if (deleted) {
            emptyRuns = 0;
        }
        else {
            const navigated = await loadMore();
            if (navigated) {
                return;
            }
            emptyRuns += 1;
        }
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(DELAY);
    }
    clearSavedConfig();
    clearRunCount();
    const total = getRunCount();
    alert(`No more matching submissions found. Total affected: ${total}. Filter used: ${config.summary}`);
})();
function getCSRFToken() {
    const match = document.cookie.match(RegExp('(?:^|;\\s*)csrf_token=([^;]*)'));
    if (match === null) {
        return null;
    }
    return match[1];
}
async function deleteNext(config, token) {
    const target = findNextTarget(config);
    if (target === null) {
        return false;
    }
    const { element, operation, input } = target;
    if (config.dryRun) {
        console.log(`[DRY RUN] Would delete ${operation}:`, input, element);
        element.setAttribute("data-delete-dry-run-visited", "true");
        incrementRunCount();
        return true;
    }
    const data = {
        operation: operation,
        variables: {
            input: input
        },
        csrf_token: token
    };
    const res = await graphqlPostRequest(JSON.stringify(data));
    if (res.status !== 200) {
        alert(`Error: Bad http response ${res.status}:\n${res.statusText}`);
        return false;
    }
    element.remove();
    incrementRunCount();
    return true;
}
async function graphqlPostRequest(body) {
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
function findNextTarget(config) {
    const candidates = document.querySelectorAll("shreddit-post, shreddit-profile-comment, [data-fullname]");
    const now = Date.now();
    let scanned = 0;
    let nsfwSkipped = 0;
    let timeSkipped = 0;
    let nsfwDebugLogged = 0;
    for (const item of Array.from(candidates)) {
        const element = item;
        scanned += 1;
        if (config.dryRun && element.getAttribute("data-delete-dry-run-visited") === "true") {
            continue;
        }
        if (config.nsfwOnly && !isNsfw(element)) {
            nsfwSkipped += 1;
            if (config.dryRun && nsfwDebugLogged < 5) {
                logDebugElement(element, "nsfw-skip");
                nsfwDebugLogged += 1;
            }
            continue;
        }
        const timestamp = extractTimestamp(element);
        if (!isTimestampEligible(timestamp, now, config)) {
            timeSkipped += 1;
            continue;
        }
        const target = buildTarget(element);
        if (target !== null) {
            return target;
        }
    }
    if (config.dryRun) {
        console.info(`[DRY RUN] No eligible items found. Scanned=${scanned}, nsfwSkipped=${nsfwSkipped}, timeSkipped=${timeSkipped}`);
    }
    return null;
}
function buildTarget(element) {
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
function promptForConfig() {
    const modeInput = prompt("Delete which submissions? Type 'all', 'older', or 'newer'.", "all");
    if (modeInput === null) {
        return null;
    }
    const mode = normalizeMode(modeInput);
    if (mode === null) {
        alert("Invalid option. Please rerun and choose all / older / newer.");
        return null;
    }
    let thresholdMs = 0;
    const summaryParts = [];
    if (mode === "all") {
        summaryParts.push("all submissions");
    }
    else {
        const amountInput = prompt(`Delete submissions ${mode} than how many time units? Enter a positive number.`, "30");
        if (amountInput === null) {
            return null;
        }
        const amount = Number(amountInput);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert("Invalid number provided. Please rerun with a positive value.");
            return null;
        }
        const unitInput = prompt("Time unit? Choose minutes, hours, days, or months.", "days");
        if (unitInput === null) {
            return null;
        }
        const unit = normalizeUnit(unitInput);
        if (unit === null) {
            alert("Invalid unit provided. Please rerun with minutes/hours/days/months.");
            return null;
        }
        thresholdMs = amount * unitToMs(unit);
        summaryParts.push(`${mode} than ${amount} ${unit}`);
    }
    const nsfwInput = prompt("Only delete NSFW submissions? Type yes or no.", "no");
    if (nsfwInput === null) {
        return null;
    }
    const nsfwOnly = isYes(nsfwInput);
    if (nsfwOnly) {
        summaryParts.push("NSFW only");
    }
    const dryRunInput = prompt("Dry run? Type yes to simulate without deleting.", "yes");
    if (dryRunInput === null) {
        return null;
    }
    const dryRun = isYes(dryRunInput);
    if (dryRun) {
        summaryParts.push("dry run");
    }
    const summary = summaryParts.join(", ");
    return { mode, thresholdMs, summary, dryRun, nsfwOnly };
}
function normalizeMode(input) {
    const value = input.trim().toLowerCase();
    if (value === "all" || value === "older" || value === "newer") {
        return value;
    }
    return null;
}
function normalizeUnit(input) {
    const value = input.trim().toLowerCase();
    if (value === "minutes" || value === "hours" || value === "days" || value === "months") {
        return value;
    }
    if (value === "minute")
        return "minutes";
    if (value === "hour")
        return "hours";
    if (value === "day")
        return "days";
    if (value === "month")
        return "months";
    return null;
}
function isYes(input) {
    const value = input.trim().toLowerCase();
    return value === "y" || value === "yes" || value === "true" || value === "1";
}
function unitToMs(unit) {
    switch (unit) {
        case "minutes":
            return 60 * 1000;
        case "hours":
            return 60 * 60 * 1000;
        case "days":
            return 24 * 60 * 60 * 1000;
        case "months":
            return 30 * 24 * 60 * 60 * 1000; // approximate month for filtering
    }
}
function extractTimestamp(element) {
    const timeElement = element.querySelector("time");
    const candidateValues = [
        timeElement?.getAttribute("datetime"),
        timeElement?.getAttribute("data-timestamp"),
        element.getAttribute("data-timestamp"), // old reddit containers
        element.getAttribute("data-timestamp-era"),
        element.getAttribute("timestamp"),
        element.getAttribute("created-timestamp"),
    ];
    for (const value of candidateValues) {
        const parsed = parseTimestamp(value);
        if (parsed !== null) {
            return parsed;
        }
    }
    return null;
}
function parseTimestamp(value) {
    if (!value) {
        return null;
    }
    if (/^\d+$/.test(value)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        return value.length <= 11 ? numeric * 1000 : numeric; // handle seconds vs ms
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        return null;
    }
    return parsed;
}
function isTimestampEligible(timestamp, now, config) {
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
function isNsfw(element) {
    const attrNames = ["nsfw", "data-nsfw", "data-is-nsfw", "data-subreddit-nsfw", "data-over-18", "over18"];
    if (hasTruthyAttr(element, attrNames))
        return true;
    if (element.classList.contains("over18") || element.classList.contains("nsfw"))
        return true;
    const ancestor = element.closest(".over18, .nsfw, [data-over-18], [data-nsfw], [data-is-nsfw], [data-subreddit-nsfw], [over18]");
    if (ancestor && hasTruthyAttr(ancestor, attrNames))
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
function hasTruthyAttr(element, names) {
    if (!element)
        return false;
    for (const name of names) {
        const value = element.getAttribute(name);
        if (value !== null && isTruthyString(value)) {
            return true;
        }
    }
    return false;
}
function isTruthyString(value) {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}
function saveConfig(config) {
    sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
}
function loadSavedConfig() {
    try {
        const raw = sessionStorage.getItem(SESSION_CONFIG_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function clearSavedConfig() {
    sessionStorage.removeItem(SESSION_CONFIG_KEY);
}
function getRunCount() {
    const value = sessionStorage.getItem(RUN_COUNT_KEY);
    if (!value)
        return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function setRunCount(value) {
    sessionStorage.setItem(RUN_COUNT_KEY, String(value));
}
function incrementRunCount() {
    setRunCount(getRunCount() + 1);
}
function clearRunCount() {
    sessionStorage.removeItem(RUN_COUNT_KEY);
}
function logDebugElement(element, reason) {
    const attrs = {};
    for (const attr of Array.from(element.attributes)) {
        attrs[attr.name] = attr.value;
    }
    const textSnippet = (element.textContent || "").trim().slice(0, 120);
    console.info(`[DRY RUN DEBUG] ${reason}`, {
        tag: element.tagName,
        classList: Array.from(element.classList),
        attrs,
        textSnippet
    });
}
async function waitForItems(timeoutMs = 8000, intervalMs = 400) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const candidates = document.querySelectorAll("shreddit-post, shreddit-profile-comment, [data-fullname]");
        if (candidates.length > 0) {
            return;
        }
        await sleep(intervalMs);
    }
}
async function loadMore() {
    const nextLink = document.querySelector(".next-button a, a[rel~='next']");
    if (nextLink && nextLink.href) {
        const url = new URL(nextLink.href);
        url.searchParams.set("count", String(getRunCount()));
        window.location.href = url.toString();
        return true; // will navigate
    }
    for (let i = 0; i < SCROLL_BURSTS; i++) {
        window.scrollBy(0, window.innerHeight * 0.8);
        await sleep(400);
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(800);
    await waitForItems(3000, 300);
    return false;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
