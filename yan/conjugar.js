// Rumbo.wtf — daily generation script
// Calls Claude API (global + regional), renders one HTML file per region/language combination
// Run: node generate.js

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Load translations ─────────────────────────────────────────────────────────
const TRANSLATIONS = JSON.parse(fs.readFileSync("translations.json", "utf8"));

// ─── English string defaults ──────────────────────────────────────────────────
// Single source of truth for all UI strings.
// Non-English locales override selectively via translations.json.
// Nav and footer links intentionally stay in English for all locales.
const EN_STRINGS = {
  NAV_LATEST: "Brief",
  NAV_ABOUT: "About",
  NAV_SIGNUP: "Newsletter",
  META_UPDATED_LABEL: "Edition:",
  ITEMS_SUFFIX: "signals",
  LOCALE_LOCAL_CONTEXT: "Local news",
  FOOTER_LATEST: "Latest",
  FOOTER_ABOUT: "About",

};

// ─── Region config ────────────────────────────────────────────────────────────
const REGIONS = [
  { code: "es", name: "Spain",          file: "index-es.html"  },
  { code: "no", name: "Norway",         file: "index-no.html"  },
  { code: "uk", name: "United Kingdom", file: "index-uk.html"  },
  { code: "nl", name: "Netherlands",    file: "index-nl.html"  },
];

// ─── Prompts ──────────────────────────────────────────────────────────────────

// NOTE: Keep in sync with the prompt displayed in about.html
const GLOBAL_PROMPT = `Your task: select 3 to 4 world news items from the last 72 hours that change how large groups of people live. Search the web broadly across all regions. If fewer than 3 qualify, return fewer. Never fill slots with weak or stale stories.

Every item must pass all three rules. If it fails any one, drop it.

1. It already happened.
Report completed actions, not announcements, plans, proposals, forecasts, reviews, consultations, committees, or signed letters. A deal, ruling, or law that still depends on another party accepting, ratifying, implementing, or not rejecting it has not taken effect. Do not write "took effect", "now in force", or "must now" unless the outcome actually began and was not rejected or left pending. An advisory court opinion is not binding law.

2. It is fresh, and it is real.
The event itself, the vote, signing, ruling, attack, launch, or collapse, happened in the last 72 hours, and you found it in today's search results, not in your memory of past events. A recent article about an older event does not count. If a story feels familiar from a past year, it is almost certainly an old event resurfacing: check when it actually happened and drop it if the action was in a prior year. Set event_date to when the action physically happened.

3. It has a consequence beyond itself.
Complete this sentence before including the item: "This changes what happens next for [specific group] because [specific effect]." The effect must reach beyond the country where the event happened, moving markets, institutions, or norms elsewhere. Loud domestic politics with no outside effect does not qualify. "People will pay attention" is not an effect.

Skip entirely, however widely covered: sports, celebrity and royal news, single-company restructurings, credit-rating changes, and individual accidents unless they force a systemic response.

Writing:
- Two sentences per item, each 18 words or fewer. Sentence one: what happened. Sentence two: the consequence, not another fact. If you cannot name a real consequence, the item is not ready.
- Plain language any adult can follow. No jargon or acronyms. Lead with the country or institution, not a person, unless the person is the story.
- Neutral: describe what actors do, not whether they are right.

OUTPUT FORMAT
- Geo tag each item: Global / Europe / Asia / Africa / Americas / Oceania. Tag by the physical location of the event itself, not by the nationality of the primary actor and not by who is most affected diplomatically. Where did the event physically happen? Use Global only when the event has no single physical location (e.g. a UN resolution, an international court ruling, a multilateral treaty signing).
- The "sources" field is a single integer from 1 to 10 maximum. Cap at 10 even when more independent outlets have reported the story — never return a value higher than 10. Never a list, comma-separated values, or a string.
- The headline field contains ONLY the headline text — no source citations, outlet names, dates, or parenthetical metadata. Write headlines in sentence case (capitalise only the first word and proper nouns) and in active voice. Do not copy source headlines verbatim; rewrite them in plain language describing what happened. Avoid bureaucratic phrasings like "Secretary-General Welcomes" or "Government Calls For." Avoid encyclopaedia-style article titles like "2026 [Event]" — describe the event itself.
- The body field contains ONLY prose. Do not embed inline citation markers like "[1]" or "[2, 3]" or "[5, 9, 11]" in the body text.
- For each item provide three fields used by an automated freshness check. "event_date": the date the underlying event physically happened (the vote, signing, ruling, attack, launch), in YYYY-MM-DD format — NOT the article's publication date. If the core action happened in a prior year, event_date must show that prior year. "source_url": the full URL of the single most authoritative source for the event. "source_published": the date that source article was published, in YYYY-MM-DD format.
- "search_terms": three to six plain words a reader would type into a search engine to find this story, built from the main actor, the action, and the place. Do not reuse the headline; the headline is rewritten in plain language and will not match how outlets reported the event. No quotation marks, no search operators.
- Respond with ONLY the raw JSON object below. No thinking, no explanation, no markdown, no preamble. Start with { and end with }. No markdown formatting in any string values.

{
  "generated_at": "ISO timestamp",
  "sources": ["outlet1", "outlet2"],
  "items": [
    {
      "headline": "string",
      "body": "string — two sentences",
      "geo": "string",
      "sources": 4,
      "event_date": "YYYY-MM-DD",
      "source_url": "https://example.com/article",
      "source_published": "YYYY-MM-DD",
      "search_terms": "actor action place"
    }
  ]
}`;

const REGIONAL_PROMPT = (regionName, globalJson) =>
  `You are the regional editor for Rumbo.wtf covering ${regionName}.

Here is today's global edition. Do not repeat any story, entity, or angle already in it:
${globalJson}

Your task: find the single most consequential development in ${regionName} from the last 72 hours that is not already in the global edition. Add a second item only if it is clearly distinct, equally fresh, and genuinely significant. Zero items is better than a weak or stale one.

Every item must pass all three rules. If it fails any one, drop it.

1. It already happened.
Report completed actions, not announcements, plans, proposals, forecasts, reviews, consultations, committees, or signed letters. A deal, ruling, or law that still depends on another party accepting, ratifying, implementing, or not rejecting it has not taken effect. Do not write "took effect", "now in force", or "must now" unless the outcome actually began and was not rejected or left pending. An advisory court opinion is not binding law.

2. It is fresh, and it is real.
The event itself, the vote, signing, ruling, attack, launch, or collapse, happened in the last 72 hours, and you found it in today's search results, not in your memory of past events. A recent article about an older event does not count. If a story feels familiar from a past year, it is almost certainly an old event resurfacing: check when it actually happened and drop it if the action was in a prior year. Set event_date to when the action physically happened.

3. It matters beyond its own domain.
Complete this sentence before including the item: "This shifts what happens next for [specific group in ${regionName}] because [specific effect]." A policy change affecting daily life, an economic move with cross-sector effects, or a social development with structural reach qualifies. Loud domestic controversy with no second-order effect does not. "People will pay attention" is not an effect.

Skip entirely, however widely covered: sports, celebrity and royal news, single-company restructurings, credit-rating changes, single regulatory licenses.

Writing:
- Two sentences per item, each 18 words or fewer. Sentence one: what happened. Sentence two: the consequence, not another fact. If you cannot name a real consequence, the item is not ready.
- Plain language any adult can follow. No jargon or acronyms. Lead with the institution or dynamic, not a person, unless the person is the story.
- Neutral: describe what actors do, not whether they are right.

OUTPUT FORMAT
- The headline field contains ONLY the headline text. Do not append source citations, outlet names, dates, or parenthetical metadata to the headline. Write headlines in sentence case (capitalise only the first word and proper nouns) and in active voice. Do not copy source headlines verbatim; rewrite them in plain language describing what happened.
- The "sources" field is a single integer from 1 to 10 maximum. Cap at 10 even when more independent outlets have reported the story.
- The body field contains ONLY prose. Do not embed inline citation markers like "[1]" or "[2, 3]" or "[5, 9, 11]" in the body text. Body must read as natural prose without any bracketed numbers.
- For each item provide three fields used by an automated freshness check. "event_date": the date the underlying event physically happened, in YYYY-MM-DD format — NOT the article's publication date. If the core action happened in a prior year, event_date must show that prior year. "source_url": the full URL of the single most authoritative source. "source_published": the date that source article was published, in YYYY-MM-DD format.
- "search_terms": three to six plain words a reader would type to find this story in ${regionName}, built from the main actor, the action, and the place. Do not reuse the headline. No quotation marks, no search operators.

CRITICAL: Your response must be ONLY the raw JSON object. Start with { and end with }. No other text. No markdown formatting in any string values.
{
  "items": [
    {
      "headline": "string",
      "body": "string — two sentences",
      "geo": "${regionName}",
      "sources": 2,
      "event_date": "YYYY-MM-DD",
      "source_url": "https://example.com/article",
      "source_published": "YYYY-MM-DD",
      "search_terms": "actor action place"
    }
  ]
}`;

// ─── API calls ────────────────────────────────────────────────────────────────

// Two-step call: search pass then format pass. Used for global edition.
// Pass 1 uses a short search-only prompt to avoid exceeding the 200k token limit.
// Pass 2 receives the full editorial prompt + capped search results for formatting.
async function callClaude(prompt, deduplicationHint = "") {
  const timeout = 600000; // 10 minutes

  const searchPrompt = `Search the web broadly for the most consequential global developments from the last 72 hours. Cover all regions without regional bias. Return a detailed summary of what you find.${deduplicationHint}`;

  const searchResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: searchPrompt }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (search)")), timeout)
    ),
  ]);

  const searchText = searchResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 30000); // cap at 30k chars (~7-8k tokens)

  const formatResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: "You are a JSON formatter. Output only raw valid JSON. Start with { and end with }. No other text.",
      messages: [
        {
          role: "user",
          content: `Format this content as the required JSON structure:\n\n${searchText}\n\n${prompt}`,
        },
      ],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (format)")), timeout)
    ),
  ]);
  const textBlock = formatResponse.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text in Claude response");
  const su = searchResponse.usage || {};
  const fu = formatResponse.usage || {};
  console.log(`[tokens] global search — in:${su.input_tokens ?? '?'} out:${su.output_tokens ?? '?'}`);
  console.log(`[tokens] global format — in:${fu.input_tokens ?? '?'} out:${fu.output_tokens ?? '?'}`);
  return textBlock.text.trim();
}

// Two-pass call for regional editions — mirrors global approach to cap token usage.
// Pass 1: short search prompt with web tool, capped at 30k chars.
// Pass 2: format pass with capped results + full editorial prompt, no web tool.
async function callClaudeSinglePass(prompt, regionName = "regional") {
  const timeout = 600000;

  const searchPrompt = `Search the web for the single most consequential news development in ${regionName} from the last 72 hours. Return a detailed summary of what you find.`;

  const searchResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: searchPrompt }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (search)")), timeout)
    ),
  ]);

  const searchText = searchResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 30000);

  const formatResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: "You are a JSON formatter. Output only raw valid JSON. Start with { and end with }. No other text.",
      messages: [{ role: "user", content: `Format this content as the required JSON structure:\n\n${searchText}\n\n${prompt}` }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (format)")), timeout)
    ),
  ]);

  const textBlock = formatResponse.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text in response");
  const su = searchResponse.usage || {};
  const fu = formatResponse.usage || {};
  console.log(`[tokens] ${regionName} search — in:${su.input_tokens ?? '?'} out:${su.output_tokens ?? '?'}`);
  console.log(`[tokens] ${regionName} format — in:${fu.input_tokens ?? '?'} out:${fu.output_tokens ?? '?'}`);
  return textBlock.text.trim();
}

// ─── JSON parse ───────────────────────────────────────────────────────────────

function parseJson(raw) {
  const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  if (clean.startsWith("{")) return JSON.parse(clean);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}

// ─── Event-date gate ──────────────────────────────────────────────────────────
// Structural freshness check applied to model output before rendering. Targets the
// anniversary failure mode: grounded search returns current-dated articles about
// events from prior years, and the model presents the old event as fresh news.
// Two independent rejection signals: (1) the model's own event_date is too old, and
// (2) the body text references a prior year outside a quotation.

// Prior years that, if mentioned in body prose, signal an anniversary/retrospective.
// Limited to the most recent two years (e.g. 2026 -> [2025, 2024]) so legitimate
// historical references far in the past ("worst since 2008") do not trip the check,
// and so it advances automatically each calendar year.
const PRIOR_YEARS = (() => {
  const y = new Date().getFullYear();
  return [y - 1, y - 2];
})();

// Returns the first prior year found in body prose outside any quoted span, or null.
function priorYearOutsideQuotes(body) {
  if (typeof body !== "string") return null;
  // Blank out quoted spans (straight and curly double quotes, single-quoted spans)
  // so a year inside a direct quotation is not treated as the article's own claim.
  const unquoted = body
    .replace(/"[^"]*"/g, " ")
    .replace(/[\u201C\u201D][^\u201C\u201D]*[\u201C\u201D]/g, " ")
    .replace(/'[^']*'/g, " ");
  for (const y of PRIOR_YEARS) {
    if (new RegExp(`\\b${y}\\b`).test(unquoted)) return String(y);
  }
  return null;
}

// Age of an ISO (YYYY-MM-DD) event date in days relative to `now`, or null if the
// value is missing/unparseable (date-only, treated as UTC midnight).
function eventDateAgeDays(eventDate, now) {
  if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(eventDate)) return null;
  const d = new Date(eventDate.slice(0, 10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / 86400000;
}

// Filters items by event freshness. Returns { kept, rejected }.
// rejected entries are { headline, reason, event_date }.
// A missing/unparseable event_date is NOT a rejection on its own (we cannot prove
// staleness) — it is logged as a warning and the item still runs the prior-year body
// check. This keeps the gate conservative while we observe its behaviour in production.
function applyEventDateGate(items, label, now) {
  const kept = [];
  const rejected = [];
  // 72-hour window plus a 24-hour grace margin, because event_date is date-only and
  // the run happens in a single timezone — avoids false rejects at the boundary.
  const MAX_AGE_DAYS = 4;
  for (const item of items || []) {
    if (item.isNote) { kept.push(item); continue; }

    const ageDays = eventDateAgeDays(item.event_date, now);
    if (ageDays !== null && ageDays > MAX_AGE_DAYS) {
      const reason = `event_date ${item.event_date} is ${ageDays.toFixed(1)} days old (older than 72h window)`;
      rejected.push({ headline: item.headline, reason, event_date: item.event_date ?? null });
      console.warn(`[date-gate ${label}] REJECT — ${item.headline} :: ${reason}`);
      continue;
    }

    const py = priorYearOutsideQuotes(item.body);
    if (py) {
      const reason = `body references prior year ${py} outside a quote`;
      rejected.push({ headline: item.headline, reason, event_date: item.event_date ?? null });
      console.warn(`[date-gate ${label}] REJECT — ${item.headline} :: ${reason}`);
      continue;
    }

    if (ageDays === null) {
      console.warn(`[date-gate ${label}] WARN — ${item.headline} :: missing/unparseable event_date "${item.event_date ?? ""}", kept`);
    }
    kept.push(item);
  }
  return { kept, rejected };
}

// Synthetic "no global signal" edition — reused by both the model-refusal path and
// the date-gate path (fewer than 2 global items survive). renderHtml/renderEmail
// already special-case items[].isNote.
function buildNoSignalNote() {
  return {
    generated_at: new Date().toISOString(),
    sources: [],
    items: [{
      headline: "No global signal",
      body: "Today no global items met Rumbo's editorial bar. Rumbo prefers to say so rather than fill the slot. Regional items below ran as normal.",
      geo: "Global",
      sources: 0,
      isNote: true,
    }],
  };
}

// ─── Gemini Flash (parallel test) ─────────────────────────────────────────────

async function callGemini(prompt, label = "global") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4000,
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  // Token usage logging
  const usage = response.usageMetadata || {};
  const inTokens = usage.promptTokenCount ?? "?";
  const outTokens = usage.candidatesTokenCount ?? "?";
  const totalTokens = usage.totalTokenCount ?? "?";
  console.log(`[gemini tokens] ${label} — in:${inTokens} out:${outTokens} total:${totalTokens}`);

  // Extract grounding metadata for diagnostics (diagnostic only — does not affect output).
  // webSearchQueries: what Gemini actually searched. groundingChunks: the URLs/titles it
  // grounded against. groundingSupports: which text spans map to which source chunks.
  const candidate = response.candidates?.[0];
  const gm = (candidate && candidate.groundingMetadata) || {};
  const grounding = {
    webSearchQueries: gm.webSearchQueries || [],
    groundingChunks: (gm.groundingChunks || []).map((c) => ({
      uri: c?.web?.uri ?? null,
      title: c?.web?.title ?? null,
    })),
    groundingSupports: (gm.groundingSupports || []).map((s) => ({
      text: s?.segment?.text ?? null,
      startIndex: s?.segment?.startIndex ?? null,
      endIndex: s?.segment?.endIndex ?? null,
      chunkIndices: s?.groundingChunkIndices ?? [],
    })),
  };
  console.log(`[gemini grounding] ${label} — ${grounding.webSearchQueries.length} queries, ${grounding.groundingChunks.length} sources`);

  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Parse JSON
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    // Strip Gemini grounding citation markers from body and headline.
    // Gemini sometimes leaks "[1, 2]" or "[5, 9, 11]" style markers into text.
    const stripCitations = (str) => {
      if (typeof str !== "string") return str;
      return str.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "").replace(/\s{2,}/g, " ").trim();
    };
    if (Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map((item) => ({
        ...item,
        headline: stripCitations(item.headline),
        body: stripCitations(item.body),
      }));
    }

    return { json: parsed, raw: text, usage, grounding };
  }
  // Save raw response for diagnosis when JSON parse fails
  try {
    const today = new Date().toISOString().split("T")[0];
    const errorFile = `gemini-error-${today}-${label}.txt`;
    fs.writeFileSync(errorFile, `Label: ${label}\nUsage: ${JSON.stringify(usage)}\n\nRaw response:\n${text}`, "utf8");
    console.error(`Raw response saved to ${errorFile} for diagnosis.`);
  } catch (e) {
    console.error("Could not save error diagnostic:", e.message);
  }

  // Detect editorial refusal (model judged nothing in search met the criteria).
  // Signals: short textual response (not JSON) containing characteristic
  // refusal language. Treat this as a legitimate editorial signal, not an error.
  const refusalSignals = [
    "could not identify",
    "do not qualify",
    "could not find",
    "no items",
    "no events",
    "no qualifying",
    "did not find",
    "meet your specific criteria",
    "meet the criteria",
    "meet the prompt",
  ];
  const lower = text.toLowerCase();
  const looksLikeRefusal = text.length < 2000 && refusalSignals.some((s) => lower.includes(s));
  if (looksLikeRefusal) {
    console.log(`Gemini refusal detected for ${label} — no items met the editorial bar.`);
    return { json: null, raw: text, usage, refusal: true, grounding };
  }

  throw new Error("No JSON object found in Gemini response");
}

// ─── Translations ─────────────────────────────────────────────────────────────

function getTranslations(locale) {
  return EN_STRINGS;
}

// ─── HTML rendering ───────────────────────────────────────────────────────────

function ddgUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function renderItem(item, t, locale = 'en') {
  // Editorial note (e.g. "no global signal today") — render in italics, no pills, dashed dot
  if (item.isNote) {
    return `  <div class="item">
    <div class="dot" style="background:transparent;border:1px dashed #a0aaa0;"></div>
    <div class="item-body">
      <div class="item-head" style="font-style:italic;color:#6a6a68;">${item.headline}</div>
      <div class="item-text" style="font-style:italic;color:#6a6a68;">${item.body}</div>
    </div>
  </div>`;
  }

  const regionalGeos = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
  const geo = item.geo || "Global";
  const isRegional = regionalGeos.includes(geo);
  const pillClass = isRegional ? "geo-pill regional" : "geo-pill";
  const dotClass = isRegional ? "dot dot-regional" : "dot dot-global";
  const searchQuery = item.search_terms
    ? encodeURIComponent(item.search_terms)
    : isRegional
      ? encodeURIComponent(item.headline + " " + geo)
      : encodeURIComponent(item.headline);
  const geoLabel = geo;

  return `  <div class="item">
    <div class="${dotClass}"></div>
    <div class="item-body">
      <div class="item-head">${item.headline}</div>
      <div class="item-text">${item.body}</div>
      <div class="item-foot">
        <span class="${pillClass}">${geoLabel}</span>
        <a class="search-link" href="https://duckduckgo.com/?q=${searchQuery}" target="_blank">↗</a>
      </div>
    </div>
  </div>`;
}

function renderHtml(data, date, locale = "en") {
  const t = getTranslations(locale);
  // If this rendering contains a note and no other items, adjust the body
  // text so it doesn't promise regional items that aren't there.
  const allItems = data.items.map((item) => {
    if (item.isNote && data.items.filter(i => !i.isNote).length === 0) {
      return {
        ...item,
        body: "Today no global items met Rumbo's editorial bar. Rumbo prefers to say so rather than fill the slot. Regional items did not qualify today either. Check back tomorrow.",
      };
    }
    return item;
  });
  const itemCount = allItems.filter(i => !i.isNote).length;
  const utcTime = new Date();
  const isoString = utcTime.toISOString();

  let html = fs.readFileSync("template.html", "utf8");

  // Inject feed
  const feedStart = html.indexOf("<!-- FEED:START -->");
  const feedEnd = html.indexOf("<!-- FEED:END -->") + "<!-- FEED:END -->".length;
  html =
    html.slice(0, feedStart) +
    `<!-- FEED:START -->\n<div class="feed">\n${allItems.map((item) => renderItem(item, t, locale)).join("\n")}\n</div>\n` +
    "<!-- FEED:END -->" +
    html.slice(feedEnd);

  // Clear Meanwhile region if template still has the markers — feature removed
  const mwStart = html.indexOf("<!-- MEANWHILE:START -->");
  const mwEnd = html.indexOf("<!-- MEANWHILE:END -->") + "<!-- MEANWHILE:END -->".length;
  if (mwStart !== -1 && mwEnd !== -1) {
    html = html.slice(0, mwStart) + `<!-- MEANWHILE:START -->\n<!-- MEANWHILE:END -->` + html.slice(mwEnd);
  }

  // Update date — keep token in place so replaceAll picks it up at the end
  html = html.replace(/\{\{META_UPDATED_LABEL\}\} [^<&]+/, `{{META_UPDATED_LABEL}} ${date}`);

  // Update item count — keep token in place
  html = html.replace(/>\d+\s+\{\{ITEMS_SUFFIX\}\}</, `>${itemCount} {{ITEMS_SUFFIX}}<`);

  // Update UTC timestamp for client-side timezone localisation
  html = html.replace(
    /var utc = new Date\('[^']+'\)/,
    `var utc = new Date('${isoString}')`
  );

  // Hardcode timestamp locale per file — not dependent on localStorage lang
  const jsLocaleMap = { en: "en-GB" };
  html = html.replace("{{JS_LOCALE}}", jsLocaleMap[locale] || "en-GB");

  // Apply all flat string tokens from translations
  for (const [key, val] of Object.entries(t)) {
    if (typeof val === "string") {
      html = html.replaceAll(`{{${key}}}`, val);
    }
  }

  return html;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Email rendering ──────────────────────────────────────────────────────────

function renderEmail(data, date, locale, unsubscribeUrl) {
  const t = getTranslations(locale);
  // If this email contains a note and no other items, adjust the body so it
  // doesn't promise regional items that aren't there.
  const items = data.items.map((item) => {
    if (item.isNote && data.items.filter(i => !i.isNote).length === 0) {
      return {
        ...item,
        body: "Today no global items met Rumbo's editorial bar. Rumbo prefers to say so rather than fill the slot. Regional items did not qualify today either. Check back tomorrow.",
      };
    }
    return item;
  });
  const geoStyle = (geo) => {
    const regional = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
    return regional.includes(geo)
      ? "display:inline-block;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:#555;background:#f0ede6;border:1px solid #d0ccc4;padding:2px 8px;border-radius:3px;margin-right:6px;"
      : "display:inline-block;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:#7a5c0a;background:#f5ead0;border:1px solid #e0c87a;padding:2px 8px;border-radius:3px;margin-right:6px;";
  };

  const itemsHtml = items.map((item) => {
    // Editorial note (e.g. "no global signal today") — italic, no pills
    if (item.isNote) {
      return `
    <tr><td class="rp" style="padding:20px 28px 0;">
      <div style="font-family:Georgia,serif;font-size:17px;color:#6a6a68;line-height:1.35;margin-bottom:8px;font-style:italic;">${item.headline}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#6a6a68;line-height:1.65;margin-bottom:10px;font-style:italic;">${item.body}</div>
    </td></tr>
    <tr><td class="rp" style="padding:12px 28px 0;"><hr style="border:none;border-top:1px solid #e8e4de;margin:0;"></td></tr>`;
    }

    const geo = item.geo || "Global";
    const emailSearch = item.search_terms ? encodeURIComponent(item.search_terms) : encodeURIComponent(item.headline + (geo !== 'Global' ? ' ' + geo : ''));
    return `
    <tr><td class="rp" style="padding:20px 28px 0;">
      <div style="font-family:Georgia,serif;font-size:17px;color:#1a1a18;line-height:1.35;margin-bottom:8px;">${item.headline}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#444;line-height:1.65;margin-bottom:10px;">${item.body}</div>
      <div>
        <span style="${geoStyle(geo)}">${geo}</span>
        <a href="https://duckduckgo.com/?q=${emailSearch}" style="font-family:'Courier New',monospace;font-size:11px;color:#c8a84a;text-decoration:none;margin-right:8px;" target="_blank">&#x2197;</a>
      </div>
    </td></tr>
    <tr><td class="rp" style="padding:12px 28px 0;"><hr style="border:none;border-top:1px solid #e8e4de;margin:0;"></td></tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rumbo · ${date}</title>
  <style>
    @media only screen and (max-width:600px) {
      .rp { padding-left:16px !important; padding-right:16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;">
<tr><td align="center" style="padding:24px 16px;">
<table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#faf9f6;border-radius:4px;border:1px solid #e0dcd4;">

  <!-- Header -->
  <tr><td class="rp" style="background:#1a1a18;padding:16px 28px;border-radius:4px 4px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><a href="https://rumbo.wtf/index.html" style="text-decoration:none;"><span style="font-family:Georgia,serif;font-size:20px;color:#f5f3ee;letter-spacing:-0.5px;">Rumbo<span style="color:#c8a84a;">.wtf</span></span></a></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:10px;color:#888;letter-spacing:1px;">${date}</span></td>
    </tr>
    </table>
  </td></tr>

  <!-- Spacer -->
  <tr><td style="padding:8px 0 0;"></td></tr>

  <!-- Items -->
  ${itemsHtml}

  <!-- Footer -->
  <tr><td class="rp" style="padding:28px 28px 20px;text-align:center;">
    <p style="font-family:'Courier New',monospace;font-size:10px;color:#aaa;line-height:1.8;margin:0;">
      <a href="https://rumbo.wtf" style="color:#c8a84a;text-decoration:none;">rumbo.wtf</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#aaa;text-decoration:underline;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Rumbo generator starting...");

  // Current date anchor — injected into every prompt so the model has a hard
  // reference for the 72-hour window and can reject anniversaries of old events.
  const todayFull = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const DATE_PREAMBLE = `Today's date is ${todayFull}. The last 72 hours means the three days ending today. Any event from a previous year is out of scope no matter how closely its month and day match today.\n\n`;

  // Per-run diagnostics: grounding metadata + date-gate rejections for each Gemini
  // call (global + each region). Written to grounding-YYYY-MM-DD.json. Diagnostic only.
  const diagnostics = [];

  // Step 1: load recent run context (last 14 days) to avoid repetition
  let previousContext = "";
  try {
    let lastRunHeadlines = [];
    // Load rolling history file (up to 14 days)
    let recentHistory = [];
    try {
      recentHistory = JSON.parse(fs.readFileSync("recent_headlines.json", "utf8"));
    } catch (e) {
      // No history yet — start fresh
    }

    // Also load last_output.json as the most recent run
    let lastRunDate = "today's previous run";
    try {
      const lastOutput = JSON.parse(fs.readFileSync("last_output.json", "utf8"));
      lastRunHeadlines = lastOutput.items.map(i => i.headline);
    } catch (e) {}

    // Build dated entries so the model can reason about "how long ago" each story ran
    const datedEntries = [];
    if (lastRunHeadlines.length > 0) {
      datedEntries.push({ date: lastRunDate, headlines: lastRunHeadlines });
    }
    for (const r of recentHistory) {
      const headlines = [...(r.headlines || []), ...(r.regional_headlines || [])];
      if (headlines.length > 0) {
        datedEntries.push({ date: r.date, headlines });
      }
    }

    if (datedEntries.length > 0) {
      const blocks = datedEntries.map(e => `[${e.date}]\n${e.headlines.map(h => `- ${h}`).join("\n")}`).join("\n\n");
      previousContext = `\nThe following stories appeared in recent editions. Each block is dated so you can judge how long ago each story ran.\n\n${blocks}\n\nDedup rule: for each candidate story, check whether it shares the underlying event, named actors, or policy thread with any item above. If yes, treat as already covered unless a substantive new development has occurred since the date of prior coverage. Same story with a different angle, fresh framing, or new commentary does not qualify — only a concrete new development that on its own merits would be worth including. Older coverage (more than 7 days back) may be repeated only if circumstances have measurably changed.\n`;
    }

    console.log(`Loaded deduplication context: ${datedEntries.reduce((n, e) => n + e.headlines.length, 0)} headlines from ${datedEntries.length} runs.`);
  } catch (e) {
    console.log("No previous run context found — first run.");
  }

  // Step 2: global call — Gemini Pro is now primary
  console.log("Calling Gemini Pro for global edition...");
  let globalData;
  try {
    const deduplicationHint = previousContext;
    const geminiResult = await callGemini(DATE_PREAMBLE + GLOBAL_PROMPT + deduplicationHint, "global");
    if (geminiResult.refusal) {
      // Model judged nothing in the search met the editorial bar.
      // Render an explicit note rather than falling back to yesterday's content.
      console.log("Rendering 'no global signal' note in place of items.");
      globalData = buildNoSignalNote();
      diagnostics.push({ label: "global", refusal: true, grounding: geminiResult.grounding || null, kept_count: 0, rejected: [] });
    } else if ((geminiResult.grounding?.webSearchQueries?.length ?? 0) === 0) {
      // Search-presence gate (global only). When the global call issues zero
      // webSearchQueries, the model did not search at all and may have generated
      // from memory rather than from search, which is the documented failure mode
      // behind stale "anniversary" items (e.g. 2024 events stamped with today's date).
      // Untrusted: render the no-signal note instead. Regionals are unaffected.
      console.log("Global: 0 web search queries issued — model did not search, rendering 'no global signal' note.");
      globalData = buildNoSignalNote();
      diagnostics.push({ label: "global", refusal: false, grounding: geminiResult.grounding || null, kept_count: 0, rejected: [], ungrounded: true });
    } else {
      // Event-date gate: drop items whose underlying event is outside the 72h window
      // before rendering. If fewer than 2 survive, fall back to the no-signal note
      // rather than publishing a thin edition.
      const { kept, rejected } = applyEventDateGate(geminiResult.json.items, "global", new Date());
      diagnostics.push({ label: "global", refusal: false, grounding: geminiResult.grounding || null, kept_count: kept.length, rejected });
      if (kept.length < 2) {
        console.log(`Global: only ${kept.length} item(s) survived the date gate (${rejected.length} rejected) — rendering 'no global signal' note.`);
        globalData = buildNoSignalNote();
      } else {
        globalData = { ...geminiResult.json, items: kept };
        console.log(`Global: ${kept.length} items after date gate (${rejected.length} rejected).`);
      }
    }
  } catch (e) {
    console.error("Global call failed:", e.message);
    diagnostics.push({ label: "global", error: e.message, grounding: null, kept_count: 0, rejected: [] });
    // Genuine failure (parse error not matching refusal pattern). Fall back to
    // last run's output rather than killing the whole process.
    try {
      globalData = JSON.parse(fs.readFileSync("last_output.json", "utf8"));
      console.warn("Using last_output.json as fallback — today's content may be stale.");
    } catch (e2) {
      console.error("No fallback available:", e2.message);
      process.exit(1);
    }
  }

  // Step 2b (optional): parallel Claude comparison — runs only when RUN_CLAUDE_COMPARISON=true
  // Writes comparison JSON AND renders to index-claude.html for visual side-by-side
  if (process.env.RUN_CLAUDE_COMPARISON === "true") {
    console.log("Calling Claude for parallel comparison...");
    try {
      const deduplicationHint = previousContext;
      const claudeRaw = await callClaude(DATE_PREAMBLE + GLOBAL_PROMPT + deduplicationHint, deduplicationHint);
      const claudeData = parseJson(claudeRaw);
      const today = new Date().toISOString().split("T")[0];
      const comparisonFile = `claude-comparison-${today}.json`;
      fs.writeFileSync(comparisonFile, JSON.stringify({
        date: today,
        gemini_output: globalData,
        claude_output: claudeData,
      }, null, 2));
      console.log(`Claude comparison written to ${comparisonFile}`);
      console.log(`Claude items: ${claudeData.items?.length ?? 0}`);

      // Render Claude's output as parallel index-claude.html for inspection
      try {
        const dateStrForClaude = new Date().toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric",
        });
        const claudeHtml = renderHtml({ ...claudeData }, dateStrForClaude, "en");
        fs.writeFileSync("index-claude.html", claudeHtml);
        console.log("index-claude.html written.");
      } catch (e) {
        console.error("Claude HTML render failed:", e.message);
      }
    } catch (e) {
      console.error("Claude comparison failed:", e.message);
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Step 3: render global EN edition
  console.log("Rendering index.html (global, EN)...");
  const globalHtml = renderHtml({ ...globalData }, dateStr, "en");
  fs.writeFileSync("index.html", globalHtml, "utf8");
  console.log("index.html written.");

  // Step 4: regional editions
  const allRegionalItems = {}; // { regionCode: [items] } — used by Step 7

  for (const region of REGIONS) {
    console.log(`Calling Gemini for ${region.name} regional top-up...`);
    try {
      const regionalResult = await callGemini(
        DATE_PREAMBLE + REGIONAL_PROMPT(region.name, JSON.stringify(globalData, null, 2)) + previousContext,
        region.name
      );

      // Event-date gate on regional items. Empty result is fine — we never pad with
      // rejected items; the edition simply falls back to global-only content.
      const rawRegionalItems = (regionalResult.json && Array.isArray(regionalResult.json.items))
        ? regionalResult.json.items
        : [];
      const { kept: regionalItems, rejected } = applyEventDateGate(rawRegionalItems, region.name, new Date());
      diagnostics.push({ label: region.name, refusal: !!regionalResult.refusal, grounding: regionalResult.grounding || null, kept_count: regionalItems.length, rejected });

      // Merge: global items + surviving regional items
      const mergedData =
        regionalItems.length > 0
          ? { ...globalData, items: [...globalData.items, ...regionalItems] }
          : { ...globalData };

      if (regionalItems.length > 0) {
        console.log(`Added ${regionalItems.length} regional items for ${region.name} (${rejected.length} rejected by date gate).`);
        allRegionalItems[region.code] = regionalItems;
      } else {
        console.log(`No regional items for ${region.name} (${rejected.length} rejected by date gate), using global-only content.`);
      }

      // Render EN version
      const regionalHtml = renderHtml(mergedData, dateStr, "en");
      fs.writeFileSync(region.file, regionalHtml, "utf8");
      console.log(`${region.file} written.`);

    } catch (e) {
      console.error(`Regional call failed for ${region.name}:`, e.message);
      diagnostics.push({ label: region.name, error: e.message, grounding: null, kept_count: 0, rejected: [] });
      console.log(`Writing global-only EN fallback for ${region.name}.`);
      fs.writeFileSync(region.file, globalHtml, "utf8");
    }
  }

  // Write per-run diagnostics (grounding metadata + date-gate rejections). Diagnostic
  // only — does not affect today's output. Reviewed over several runs before deciding
  // whether to act on it.
  try {
    const todayIso = new Date().toISOString().split("T")[0];
    const groundingFile = `grounding-${todayIso}.json`;
    fs.writeFileSync(groundingFile, JSON.stringify({ date: todayIso, calls: diagnostics }, null, 2), "utf8");
    console.log(`Grounding + date-gate diagnostics written to ${groundingFile}.`);
  } catch (e) {
    console.error("Failed to write grounding diagnostics:", e.message);
  }

  // Step 6: save JSON outputs
  fs.writeFileSync("last_output.json", JSON.stringify(globalData, null, 2), "utf8");
  console.log("Raw JSON saved to last_output.json");

  // Update rolling 14-day headline history
  try {
    let recentHistory = [];
    try {
      recentHistory = JSON.parse(fs.readFileSync("recent_headlines.json", "utf8"));
    } catch (e) {}
    // Collect regional headlines across all regions
    const regionalHeadlines = Object.values(allRegionalItems).flatMap(items => items.map(i => i.headline));
    const newEntry = {
      date: dateStr,
      headlines: globalData.items.filter(i => !i.isNote).map(i => i.headline),
      regional_headlines: regionalHeadlines
    };
    recentHistory.unshift(newEntry);
    recentHistory = recentHistory.slice(0, 7); // keep last 7 runs
    fs.writeFileSync("recent_headlines.json", JSON.stringify(recentHistory, null, 2), "utf8");
    console.log(`Rolling headline history updated (${recentHistory.length} runs stored).`);
  } catch (e) {
    console.error("Failed to update recent_headlines.json:", e.message);
  }

  const allOutput = { date: dateStr, global: globalData, regional_items: allRegionalItems };
  fs.writeFileSync("all_output.json", JSON.stringify(allOutput, null, 2), "utf8");
  console.log("all_output.json saved.");

  // Step 7: send newsletter
  if (process.env.SEND_NEWSLETTER === "false") {
    console.log("Newsletter send skipped (SEND_NEWSLETTER=false).");
  } else {
  console.log("Starting newsletter send...");
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const dayCodes = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const todayCode = dayCodes[new Date().getDay()];
    console.log(`Today is: ${todayCode}`);

    const { data: subscribers, error: subError } = await supabase
      .from("subscribers")
      .select("*")
      .eq("active", true)
      .eq("confirmed", true);

    if (subError) throw new Error(`Supabase query failed: ${subError.message}`);
    console.log(`${subscribers.length} confirmed active subscribers found.`);

    let skipped = 0;

    // Build batch payload — one object per eligible subscriber
    const batch = [];
    for (const sub of subscribers) {
      if (!sub.days || !sub.days.includes(todayCode)) {
        skipped++;
        continue;
      }

      // Build merged item list for this subscriber
      const regionalItems = [];
      for (const regionCode of (sub.regions || [])) {
        if (allRegionalItems[regionCode]) {
          regionalItems.push(...allRegionalItems[regionCode]);
        }
      }
      const mergedData = { ...globalData, items: [...globalData.items, ...regionalItems] };

      const unsubUrl = `https://rumbo.wtf/api/unsubscribe?token=${sub.unsubscribe_token}`;
      const emailHtml = renderEmail(mergedData, dateStr, "en", unsubUrl);

      batch.push({
        from: "Rumbo <brief@rumbo.wtf>",
        to: sub.email,
        subject: `Rumbo · ${dateStr}`,
        html: emailHtml,
      });
    }

    if (batch.length === 0) {
      console.log(`Newsletter done. Sent: 0, skipped (wrong day): ${skipped}.`);
    } else {
      const sendRes = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.text();
        console.error(`Resend batch failed: ${errBody}`);
      } else {
        const resJson = await sendRes.json();
        console.log(`Resend batch accepted. IDs: ${resJson.data?.map(r => r.id).join(", ") ?? "n/a"}`);
      }

      console.log(`Newsletter done. Sent: ${batch.length}, skipped (wrong day): ${skipped}.`);
    }
  } catch (e) {
    console.error("Newsletter send failed:", e.message);
  }
  } // end SEND_NEWSLETTER check

  // Keepalive ping to prevent Supabase free-tier auto-pause
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from("subscribers").select("id", { count: "exact", head: true });
    console.log("Supabase keepalive ping sent.");
  } catch (e) {
    console.error("Keepalive ping failed:", e.message);
  }

  console.log("Done.");
}

main();
