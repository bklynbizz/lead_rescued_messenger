# Workflow Details

## WF1: Lead Form to Messenger (`avYJfDfznDmiCmE6`)

**Status:** Inactive (activate when Facebook Lead Ads go live)
**Path:** `lr-messenger-lead`
**Trigger:** POST webhook from Facebook Lead Ad submission

### Node Flow

```
Facebook Lead Ads Trigger (POST webhook)
  ├── Respond OK (immediate 200)
  └── Extract Lead Data (first_name, last_name, email, phone, is_licensed, psid)
      └── Log Lead to Pipeline (append row to Google Sheet)
          └── Send Initial Messenger Message (Graph API v25.0)
              └── Update: Message Sent (Initial Message Sent = TRUE, Status = Contacted)
                  └── Wait 24 Hours
                      └── Check YES Reply (24hr) (lookup by PSID)
                          └── Still No YES? (IF node)
                              ├── TRUE → Send Follow-Up Message
                              │   └── Wait 24 More Hours
                              │       └── Check YES Reply (48hr)
                              │           └── Still No YES (48hr)?
                              │               ├── TRUE → Mark as Cold Lead
                              │               └── FALSE → (already replied, do nothing)
                              └── FALSE → (already replied, do nothing)
```

### Messenger Messages

**Initial:** "Hey {first_name}, thanks for reaching out about Lead Rescued. Reply YES right now and our AI assistant will call you back in about 30 seconds to walk you through everything."

**24hr Follow-up:** "Hey {first_name}, still here if you want to see Lead Rescued in action. Reply YES and our AI will call you right back."

**48hr no-reply:** Lead status updated to "Cold"

---

## WF2: YES Reply Handler (`o8ppK68l72hAbkQ7`)

**Status:** Active
**Path:** `lr-messenger-reply`
**Trigger:** POST from Cloudflare Worker (forwarded from Meta)

### Node Flow

```
Webhook (POST, Respond Immediately)
  ├── Respond OK ("EVENT_RECEIVED")
  └── Extract Message (psid, message text lowercased)
      └── Check if YES (regex: ^(yes|call me)$)
          ├── TRUE → Lookup Lead in Pipeline (by Messenger PSID)
          │   └── Update: YES Received (YES Reply = TRUE, Status = AI Called)
          │       └── Send Confirmation via Messenger
          │           └── Wait 30s
          │               └── VAPI Call (outbound phone call)
          │                   └── Update: AI Call Initiated (TRUE)
          └── FALSE → (ignore non-YES messages)
```

### Key Configuration

- **YES detection:** Regex `^(yes|call me)$` — only exact matches trigger the flow. This prevents accidental triggers during ongoing conversations.
- **Respond Immediately:** Critical to prevent Meta retry loops. Meta retries every ~20s if it doesn't get a quick response.
- **Phone format:** `+1{{ $('Lookup Lead in Pipeline').item.json.Phone }}` — must prefix with `+1` because Sheets stores phone as a number without country code.
- **VAPI Call payload:** Includes `assistantOverrides.variableValues` with `first_name` and `email` so the AI can greet the lead by name.

---

## WF3: VAPI Callback & Discovery Booked (`jCqpuKEW4ba0czwD`)

**Status:** Active
**Path:** `lr-messenger-vapi-callback`
**Trigger:** POST from VAPI (all webhook events including end-of-call-report)

### Node Flow

```
VAPI Callback Webhook (POST, Respond to Webhook Node)
  ├── Respond to VAPI (immediate 200)
  └── Parse Call Data (Code node: extracts call_id, phone, transcript, timestamps)
      └── Filter: End of Call Only (message.type === "end-of-call-report")
          ├── TRUE → AI Analyze Call (GPT-4o-mini via OpenAI API)
          │   └── Parse AI Analysis (Code node: extracts structured data)
          │       └── Lookup Lead by Phone (Google Sheets)
          │           └── Update Pipeline with Call Results
          │               └── Notify Curtis via Email (Gmail)
          └── FALSE → (ignore intermediate VAPI events)
```

### AI Analysis Extraction

GPT-4o-mini extracts from the call transcript:
- `business_type` — what industry the lead is in (plumbing, HVAC, legal, etc.)
- `missed_calls_per_week` — estimated missed calls
- `current_followup` — what they currently do when they miss calls
- `discovery_call_booked` — true/false
- `discovery_call_datetime` — when the call is booked
- `summary` — 2-3 sentence call summary
- `score` — HOT / WARM / COLD
- `next_action` — recommended next step

### Email Notification

Subject: "Lead Rescued: {SCORE} Lead - {First Name} {Last Name}"
Contains: name, phone, email, score, business type, missed calls, follow-up behavior, call summary, discovery call status, next action.

---

## MCP Assistant (`y7ETGVZgAUUv4CzP`)

**Status:** Active
**Path:** `lr-messenger-mcp` (MCP Server Trigger)
**Purpose:** Serves tools to VAPI during live phone calls

### Connected Tools (10 total)

| Tool | Type | Subworkflow | Purpose |
|------|------|-------------|---------|
| date_time | n8n DateTime Tool | — | Get current date/time before scheduling |
| Check Availability | Call Workflow | `uUmob21uwpMFmTGu` | Check Cal.com calendar slots |
| Book Event | Call Workflow | `6OQqSgufBvVUnc8R` | Book discovery call on Cal.com |
| Query Lead Rescued KB | Call Workflow | `U7ApVDQQovkRhoxP` | Search Pinecone vector DB |
| send_eocr | Slack Tool | — | Send call summary to Slack |
| Send Email | Call Workflow | `0Y1Vi98gh9VCqvrC` | Send confirmation to lead |
| Read Email | Call Workflow | `4isATxmwJOVqJLam` | Check email history |
| Lookup Appointment | Call Workflow | `BaC0wcXsDGCInGmi` | Find existing appointments |
| Update Appointment | Call Workflow | `G6aeyvH9Pxig0mzP` | Reschedule appointments |
| Delete Appointment | Call Workflow | `PbBQ8Io93kXH3Mev` | Cancel appointments |

All tools connect to the MCP Server Trigger via `ai_tool` connections. The subworkflows are shared with the original LR Assistant (`yogUhOOssD2SF0TS`) — they're stateless utility workflows that don't care who calls them.

---

## Cloudflare Worker (`meta-verify.bklynbizz.workers.dev`)

**Purpose:** Bridge between Meta webhooks and n8n behind Cloudflare Tunnel

### Behavior

- **GET requests:** Handles Meta's one-time webhook verification challenge. Checks `hub.verify_token` matches `leadrescued2026`, returns `hub.challenge` value.
- **POST requests:** Forwards the entire request body to `https://n8n.hindsightx.com/webhook/lr-messenger-reply` (WF2).

### Why It's Needed

n8n behind Cloudflare Tunnel cannot receive GET requests on webhook paths. Meta requires a GET verification handshake before accepting a callback URL. The worker handles this verification and transparently proxies all subsequent POST messages to n8n.

This worker is a permanent part of the infrastructure — do not remove it.
