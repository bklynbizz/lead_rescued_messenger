# Lead Rescued Messenger — AI Sales Flow

An automated lead capture and AI voice qualification pipeline that converts Facebook Lead Ad submissions into booked discovery calls, powered by n8n, VAPI, and MCP Server tooling.

## What It Does

1. **Lead submits a Facebook Lead Ad form** → captured in Google Sheets Pipeline
2. **n8n sends a Messenger message** prompting the lead to reply "YES"
3. **Lead replies YES** → n8n detects it, sends confirmation, waits 30 seconds
4. **VAPI AI calls the lead** — qualifies them (business type, missed calls/week, follow-up behavior)
5. **AI checks calendar availability** and books a discovery call with Curtis live on the phone
6. **AI sends confirmation email** to the lead and Slack summary to Curtis
7. **End-of-call report** triggers GPT-4o-mini analysis → updates Google Sheets Pipeline → emails Curtis

The entire flow — from Messenger reply to live AI phone call — happens in under 60 seconds.

## Architecture

```
Facebook Lead Ad
    ↓
WF1: Lead Form to Messenger (avYJfDfznDmiCmE6) [INACTIVE - activate for live ads]
    ↓  Logs lead → Sends Messenger message → 24hr/48hr follow-up
    ↓
Lead replies on Messenger
    ↓
Meta → Cloudflare Worker (meta-verify.bklynbizz.workers.dev) → POST to n8n
    ↓
WF2: YES Reply Handler (o8ppK68l72hAbkQ7) [ACTIVE]
    ↓  Detects YES → Looks up lead by PSID → Updates sheet
    ↓  Sends confirmation → Waits 30s → Triggers VAPI call
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
| `avYJfDfznDmiCmE6` | LR Messenger - Lead Form to Messenger | Inactive | `lr-messenger-lead` |
| `o8ppK68l72hAbkQ7` | LR Messenger - YES Reply Handler | **Active** | `lr-messenger-reply` |
| `jCqpuKEW4ba0czwD` | LR Messenger - VAPI Callback & Discovery Booked | **Active** | `lr-messenger-vapi-callback` |
| `y7ETGVZgAUUv4CzP` | LR Messenger Assistant (MCP) | **Active** | `lr-messenger-mcp` (MCP path) |

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

## Activating WF1 for Live Ads

When ready to run Facebook Lead Ads:

1. Open WF1 (`avYJfDfznDmiCmE6`) in n8n editor
2. Delete the existing webhook node and recreate it manually (POST, path: `lr-messenger-lead`, Respond: Immediately)
3. Reconnect to "Extract Lead Data" node
4. Save and activate
5. Configure your Facebook Lead Ad to POST lead data to the Cloudflare Worker or directly to n8n

## License

Proprietary — Hindsight X / Lead Rescued
