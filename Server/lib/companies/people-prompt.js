/**
 * Prompt + schema for extracting a company's Management and Board of Directors
 * from the text of its own website (team / management / board pages).
 */

const SYSTEM_PROMPT = `You extract the leadership of junior mining / exploration companies from the text of their OWN corporate website (e.g. "Management", "Leadership", "Our Team", "Board of Directors", "Corporate Governance" pages).

You are given the visible text of one or more pages from a single company's website. Return the people who are part of the company's MANAGEMENT (executive officers) or its BOARD OF DIRECTORS.

CLASSIFICATION (the "kind" field):
- "director"  = members of the Board of Directors: Director, Non-Executive Director, Independent Director, Executive Chairman, Chairman / Chair / Chairperson of the Board, Lead Director.
- "manager"   = executive management / officers: CEO, President, CFO, COO, CTO, EVP/SVP/VP, Corporate Secretary, Treasurer, Controller, General Manager, VP Exploration, Chief Geologist (when listed as an officer), etc.

COMBINED ROLES — IMPORTANT:
- If ONE person holds BOTH an executive role AND a board seat (e.g. "Chairman & CEO", "President and Director", "CEO & Director", "Executive Chairman" who is also CEO), output TWO separate entries for that person: one with kind "manager" (their executive title) and one with kind "director" (their board title). Use the same name for both.
- A plain "Executive Chairman" with no other executive title is a single "director" entry (Chairman of the board) unless the text also names them CEO/President.

role_code (short code, or null if unclear): CEO, PRES (President), CFO, COO, CTO, VP, SEC (Corporate Secretary), TREAS (Treasurer), CHM (Chair/Chairman of the board), LEAD (Lead Director), DIR (Director), GM (General Manager).

RULES:
- Only include people EXPLICITLY presented as management or board/directors. Do NOT include advisory board members, technical/strategic advisors, IR/media contacts, or general staff unless they are clearly named as an officer or director.
- Do NOT fabricate. Use names and titles exactly as written (you may drop honorifics like Mr/Ms/Dr). If a section clearly isn't a leadership listing, don't invent one.
- "found_team_page" = true only if the text actually contained a management and/or board listing.
- "confidence" (0.0-1.0): how confident you are that this is a correct and reasonably complete extraction of the company's real leadership. A clear, labelled "Management" and/or "Board of Directors" listing = high (0.8-1.0). A few scattered names with unclear roles = low (0.2-0.5). No real listing = 0.0-0.2 with found_team_page=false and people=[].

Respond with ONLY valid JSON, no markdown fences, matching:

{
  "found_team_page": boolean,
  "confidence": number,
  "people": [
    { "name": string, "title": string, "kind": "manager" | "director", "role_code": string | null }
  ]
}`;

function smartTruncate(text, limit = 45000) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[... truncated for length ...]`;
}

function buildUserPrompt(company, pages) {
  // pages: [{ url, text }]
  const body = pages
    .map((p) => `----- PAGE: ${p.url} -----\n${p.text}`)
    .join('\n\n');
  return `COMPANY: ${company.name}${company.exchange ? ` (${company.exchange}:${company.ticker || '?'})` : ''}
WEBSITE: ${company.website || '(unknown)'}

Extract the company's Management and Board of Directors from the page text below. Respond with JSON only.

${smartTruncate(body)}`;
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt, smartTruncate };
