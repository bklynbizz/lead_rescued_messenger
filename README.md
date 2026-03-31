# Lead Rescued Messenger — AI Sales Flow

An automated lead capture and AI voice qualification pipeline that converts Facebook Lead Ad submissions into booked discovery calls, powered by n8n, VAPI, and MCP Server tooling.

## What It Does

1. **Lead submits a Facebook Lead Ad form** → form data arrives via Messenger → captured in Google Sheets Pipeline
2. **n8n sends a Messenger message** prompting the lead to reply "YES" (with SMS fallback number)
3. **2 minutes later, n8n sends an SMS** via Twilio to the lead's phone with the same "Reply YES" prompt
4. **Lead replies YES** (via Messenger or SMS) → n8n detects it, sends confirmation, waits 30 seconds
4. **VAPI AI calls the lead** — qualifies them (business type, missed calls/week, follow-up behavior)
5. **AI checks calendar availability** and books a discovery call with Curtis live on the phone
6. **AI sends confirmation email** to the lead and Slack summary to Curtis
7. **End-of-call report** triggers GPT-4o-mini analysis → updates Google Sheets Pipeline → emails Curtis

The entire flow — from Messenger reply to live AI phone call — happens in under 60 seconds.

## Architecture

```
Facebook Lead Ad (with Messenger integration)
    ↓  Form submission arrives as Messenger message
    ↓
Meta → Cloudflare Worker (meta-verify.bklynbizz.workers.dev) → POST to n8n
    ↓
    ↓  SMS replies also arrive here via Twilio Messaging Service
    ↓
WF2: Messenger Handler (o8ppK68l72hAbkQ7) [ACTIVE — 30 nodes]
    ↓
    ↓  Branch 0: Is SMS from Twilio? (has Body field)
    ↓    → Extract phone (From/To/Body) → Check YES → Lookup Client Config by To number
    ↓    → Get correct VAPI assistant ID → Lookup lead by phone → Update sheet
    ↓    → SMS confirmation → Wait 30s → VAPI call (dynamic assistant)
    ↓
    ↓  Branch 1: Form Submission (contains "full name:" + "phone number:" + "email:")
    ↓    → Parse form data → Log to Pipeline sheet → Send "Reply YES" Messenger message
    ↓    → Wait 2 min → Send SMS follow-up via Twilio (657-567-6219)
    ↓
    ↓  Branch 2: Messenger YES reply (exact "yes" or "call me")
    ↓    → Lookup lead by PSID → Limit to 1 → Send confirmation → Wait 30s → VAPI call
    ↓
VAPI Call (Assistant: 2f38f6d4-e432-436b-851e-c58e7499d06a)
    ↓  Uses MCP Server for live tools during call
    ↓
MCP Assistant (y7ETGVZgAUUv4CzP) [ACTIVE]
    ↓  Tools: date_time, Check Availability, Book Event,
    ↓  Query Lead Rescued KB, send_eocr (Slack),
    ↓  Send Email, Read Email, Lookup/Update/Delete Appointment
    ↓
VAPI end-of-call-report → POST to n8n
    ↓
WF3: VAPI Callback & Discovery Booked (jCqpuKEW4ba0czwD) [ACTIVE]
    ↓  Filters end-of-call-report → GPT-4o-mini analysis
    ↓  Updates Pipeline sheet → Emails Curtis
```

## Workflows

| ID | Name | Status | Webhook Path |
|----|------|--------|-------------|
| `avYJfDfznDmiCmE6` | LR Messenger - Lead Form to Messenger | **Deprecated** | `lr-messenger-lead` |
| `o8ppK68l72hAbkQ7` | LR Messenger - YES Reply Handler | **Active** (30 nodes) | `lr-messenger-reply` |
| `jCqpuKEW4ba0czwD` | LR Messenger - VAPI Callback & Discovery Booked | **Active** | `lr-messenger-vapi-callback` |
| `y7ETGVZgAUUv4CzP` | LR Messenger Assistant (MCP) | **Active** | `lr-messenger-mcp` (MCP path) |
| `vbzXwyaZFBMAuTvQ` | LR Messenger - SMS YES Handler | **Inactive** (replaced by WF2) | `lr-sms-reply` |
| `CL7Bg9YNwdLv7OP4` | Realtor - Simple YES to VAPI Call | **Inactive** (replaced by WF2) | `twilio-sms-simple` |

> **Note:** WF2 handles ALL inbound traffic: Messenger messages (via Cloudflare Worker), SMS replies (via Twilio Messaging Service), and form submissions. The SMS YES Handler and Iron Maiden workflows are deactivated — WF2's dynamic Client Config routing replaces both.

### Shared Subworkflows (called by MCP Assistant)

| ID | Name | Purpose |
|----|------|---------|
| `uUmob21uwpMFmTGu` | Check Availability | Cal.com calendar slot check |
| `6OQqSgufBvVUnc8R` | Book Event | Cal.com calendar booking |
| `U7ApVDQQovkRhoxP` | Query Lead Rescued KB | Pinecone vector DB knowledge base |
| `0Y1Vi98gh9VCqvrC` | Send Email | Confirmation emails to leads |
| `4isATxmwJOVqJLam` | Read Email | Check email history |
| `BaC0wcXsDGCInGmi` | Lookup Appointment | Find existing appointments |
| `G6aeyvH9Pxig0mzP` | Update Appointment | Reschedule appointments |
| `PbBQ8Io93kXH3Mev` | Delete Appointment | Cancel appointments |

## Google Sheets Pipeline

**Sheet ID:** `1mpGfdMwTq89SwmEmyDoMcrkzJbBxfkr52SKvHuWBPGk`
**Tab:** "Lead Rescued Pipeline" (tab ID: `69234750`)

| Column | Description | Updated By |
|--------|-------------|-----------|
| Timestamp | Lead submission time | WF1 |
| First Name | Lead's first name | WF1 |
| Last Name | Lead's last name | WF1 |
| Email | Lead's email | WF1 |
| Phone | Lead's phone number | WF1 |
| Is Licensed Agent | From lead form | WF1 |
| Messenger PSID | Facebook Page-Scoped ID | WF1 |
| Initial Message Sent | TRUE/FALSE | WF1 |
| YES Reply Received | TRUE/FALSE | WF2 |
| YES Reply Time | Timestamp of YES reply | WF2 |
| AI Call Initiated | TRUE/FALSE | WF2 |
| Business Type | Extracted by AI from call | WF3 |
| Missed Calls Per Week | Extracted by AI from call | WF3 |
| Current Follow-up Behavior | Extracted by AI from call | WF3 |
| Call Summary | AI-generated summary | WF3 |
| Discovery Call Booked | TRUE/FALSE | WF3 |
| Discovery Call Date/Time | Booked slot | WF3 |
| Lead Status | New → Contacted → AI Called → Call Booked / Cold | WF1/WF2/WF3 |
| Notes | Manual notes | Manual |

## VAPI Configuration

**Assistant:** Lead Rescued Messenger Sales (`2f38f6d4-e432-436b-851e-c58e7499d06a`)
**Phone Number:** LR Test Number (`cc3db95e-12fa-4ea7-9e9f-dc15abbcbb20` / `+16575676219`)
**Model:** GPT-4o-mini (OpenAI)
**Voice:** ElevenLabs `eleven_turbo_v2_5`

**Two URLs configured in VAPI:**
- **Server URL:** `https://n8n.hindsightx.com/webhook/lr-messenger-vapi-callback` (end-of-call reports → WF3)
- **MCP Tool:** `https://n8n.hindsightx.com/mcp/lr-messenger-mcp` (live tools during calls → MCP Assistant)

The assistant uses the **MCP Server pattern** — all tools (calendar, KB, email, Slack) are served through n8n's MCP Server Trigger, not VAPI's native custom tools. This is significantly more reliable.

## Facebook / Meta Configuration

**App:** Lead Rescued Messenger (App ID: `2003949973891229`) — **Live Mode**
**Page:** Lead Rescued (Page ID: `1085315251324887`)
**Graph API:** v25.0

**Webhook Flow:**
Meta → Cloudflare Worker (`meta-verify.bklynbizz.workers.dev`) → n8n

The Cloudflare Worker handles Meta's GET verification challenge (n8n behind Cloudflare Tunnel can't receive GET requests) and forwards all POST messages to n8n's webhook.

## Key Learnings

1. **n8n webhook registration bug:** Workflows created/activated via API don't register webhooks. Must create webhook nodes manually in the n8n UI editor and toggle activation from the editor.

2. **Cloudflare Tunnel blocks GET:** n8n behind Cloudflare Tunnel only receives POST. Solved with a Cloudflare Worker for Meta's one-time GET verification.

3. **Meta retry loops:** If n8n takes too long to respond, Meta retries every ~20s causing duplicate messages/calls. Fixed by setting WF2 webhook to "Respond Immediately."

4. **VAPI custom tools unreliable:** Custom function tools in VAPI consistently fail. MCP Server approach via n8n works perfectly.

5. **Phone format:** Google Sheets returns phone as number type. Must prefix with `+1` directly in expression: `+1{{ $('Lookup Lead in Pipeline').item.json.Phone }}`

6. **VAPI serverUrl:** Must be set at the assistant level in the VAPI dashboard — passing it in individual API requests causes errors.

7. **VAPI prompt structure:** Must front-load "ask one question at a time" rules prominently. The AI reverts to rapid-fire questioning without explicit, prominent instructions.

8. **MCP vs Server URL:** The MCP tool URL handles live tools during calls. The Server URL receives all webhook events including end-of-call reports. Both must be configured separately in VAPI.

9. **Facebook Lead Ads + Messenger:** When using Messenger integration on Lead Ads, form submissions arrive as Messenger messages (not separate webhook POSTs). The form data comes as a multi-line text message with field labels like "full name:", "phone number:", "email:". WF2 must detect and handle both form submissions and YES replies.

10. **Form detection guardrail:** Check for ALL THREE labels ("full name:", "phone number:", "email:") to distinguish form submissions from regular conversation. A single field match (e.g., someone texting just a phone number) won't trigger the form branch.

11. **Duplicate PSID protection:** Always add a Limit node after PSID lookups to prevent duplicate rows from triggering multiple VAPI calls. Without this, if a PSID appears in multiple sheet rows, the VAPI Call node fires for each match.

12. **Wait node data loss:** Data from upstream nodes is lost after a Wait node resumes. Use a Set node ("Prepare SMS Data") before the Wait to explicitly capture any values needed downstream (phone, first_name, etc.). References like `$('Parse Form Data').item.json.phone` will fail after a Wait.

13. **Twilio API format:** Twilio requires form-urlencoded with keypair body parameters, not JSON. Use `contentType: form-urlencoded`, `specifyBody: keypair` in the HTTP Request node.

14. **Twilio Messaging Service overrides webhooks:** When a phone number is assigned to a Twilio Messaging Service, the service's webhook configuration takes priority over the individual phone number's webhook URL. Always check/update the Messaging Service settings, not just the phone number settings.

15. **VAPI "SMS Enabled" intercepts texts:** If "SMS Enabled" is toggled on for a VAPI phone number, VAPI intercepts all inbound SMS before Twilio's webhook fires. Disable this in VAPI Dashboard when routing SMS through n8n instead.

16. **Dynamic assistant routing via Client Config:** Instead of hardcoding VAPI assistant IDs, use a lookup table (Client Config sheet) keyed on the Twilio `To` number. This allows multiple clients to share one webhook and one Messaging Service while each getting their own AI assistant.

## Client Config — Dynamic Assistant Routing

**Sheet Tab:** "Client Config" (in the same Google Sheet)

| Twilio Number | Client Name | VAPI Assistant ID | VAPI Phone Number ID | Knowledge Base |
|---|---|---|---|---|
| 6575676219 | Lead Rescued Demo | 2f38f6d4-... | cc3db95e-... | lead-rescued-kb |
| 8667934155 | Iron Maiden Realty | 46ab4def-... | e9e39c0d-... | iron-maiden-kb |

When an SMS arrives, WF2 extracts the `To` number from Twilio's payload and looks it up in this table. The matching row provides the correct VAPI assistant ID and phone number ID, which are passed dynamically to the VAPI Call node. This means multiple clients can share the same Twilio Messaging Service and the same n8n workflow — each gets their own AI assistant experience.

**To add a new client:** Buy a local Twilio number, add it to the "Lead Rescued Notify" Messaging Service, and add a row to the Client Config sheet. No workflow changes needed.

## Twilio Messaging Service

**Service Name:** "Lead Rescued Notify"
**Webhook URL:** `https://n8n.hindsightx.com/webhook/lr-messenger-reply` (same as WF2)

All client phone numbers live in this Messaging Service. It provides instant A2P/10DLC compliance for new local numbers. The service's incoming message webhook points to WF2, which routes based on the `To` number via Client Config.

Toll-free numbers (like the 866 Iron Maiden number) cannot be added to a Messaging Service — they require separate A2P approval. Local numbers can be added instantly.

## Scaling Roadmap

The current Google Sheets setup works for the initial client base but has known scaling limitations. When the client count grows to 20-30+, the plan is to migrate to **Airtable** as a CRM backend where each client gets their own base/table for lead pipeline data, call logs, and configuration. This would provide better per-client reporting (end-of-call reports, monthly summaries), cleaner data isolation, and more robust querying than a single shared spreadsheet. The n8n workflow nodes would swap from Google Sheets to Airtable — the overall architecture and flow logic stays the same.

## Credentials Reference

| Name | Type | n8n ID | Used By |
|------|------|--------|---------|
| Iron Maiden (Google Sheets OAuth2) | OAuth2 | `ATtrpsPy2QfGopOi` | WF1, WF2, WF3 |
| Lead Rescued FB Page Token | httpQueryAuth | `fYQr4QUECId4uP5t` | WF1, WF2 |
| Vapi Auth | httpHeaderAuth | `T8spfXyA14CaXGET` | WF2 |
| Open AI HTTP | httpHeaderAuth | `OyP4FFc3x45mMbXE` | WF3 |
| Iron M Gmail | Gmail OAuth2 | `11gYzUMEI8zepPgp` | WF3 |
| Hindsight X (Slack) | Slack OAuth2 | `zVtQzNM35hjCi74m` | MCP Assistant |
| Pinecone HTTP Auth | httpHeaderAuth | `FZcg38lsPEvJOJPe` | KB Subworkflow |
| Cal.com Calendar | Cal API | `6hbxKH0r3buvlQZI` | Booking Subworkflows |
| Twilio Auth | httpBasicAuth | `ekgqR0Hfg8pCnZdJ` | WF2 (SMS Follow-Up) |

## WF1 Deprecation Note

WF1 (`avYJfDfznDmiCmE6`) was originally designed to receive lead form data via a separate webhook. However, Facebook Lead Ads with Messenger integration deliver form submissions as Messenger messages to the page, which route through the Cloudflare Worker to WF2. WF2 now detects form submissions (by checking for "full name:", "phone number:", and "email:" in the message) and handles them directly — parsing the data, logging to the Pipeline sheet, and sending the "Reply YES" message. WF1 never fires and can remain inactive or be deactivated.

## License

Proprietary — Hindsight X / Lead Rescued
