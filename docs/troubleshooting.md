# Troubleshooting

## Common Issues

### Webhook returns 404 even though workflow is active

**Cause:** n8n webhooks created or activated via API don't register in n8n's internal routing table.

**Fix:** Open the workflow in the n8n editor UI, delete the webhook node, add a brand new one from scratch with the same path and settings, save, and activate from the editor. This forces proper webhook registration.

### Meta sends duplicate messages / VAPI makes duplicate calls

**Cause:** Meta retries webhook delivery every ~20 seconds if it doesn't receive a quick response. If the workflow takes too long before responding, Meta fires again.

**Fix:** Set the webhook node to "Respond Immediately" or use a "Respond to Webhook" node on a parallel branch so the 200 response goes back to Meta instantly while the rest of the workflow processes asynchronously.

### VAPI custom tools fail silently or return errors

**Cause:** VAPI's native custom function tools are unreliable, especially with external APIs and complex payloads.

**Fix:** Use the MCP Server pattern instead. Create an n8n workflow with an MCP Server Trigger, connect tool nodes (Call Workflow, Slack, DateTime, etc.) via ai_tool connections, and configure the VAPI assistant with the MCP tool URL. This is the same pattern used by the LR Assistant (`yogUhOOssD2SF0TS`).

### VAPI call reports "I can't access the calendar right now"

**Cause:** The VAPI assistant is using custom tools instead of MCP, or the MCP URL is misconfigured.

**Fix:** Verify VAPI assistant has:
- MCP Tool URL: `https://n8n.hindsightx.com/mcp/lr-messenger-mcp`
- Server URL: `https://n8n.hindsightx.com/webhook/lr-messenger-vapi-callback`
- Both must be set separately. MCP handles live tools, Server URL handles end-of-call reports.

### Phone number format causes VAPI call failure

**Cause:** Google Sheets stores phone numbers as plain numbers (e.g., `2019696773`). VAPI requires E.164 format with `+` prefix.

**Fix:** Use `+1{{ expression }}` in the VAPI Call node's JSON body — prefix with `+1` directly in the expression, not in the Sheets data.

### WF3 doesn't update the Google Sheet after a call

**Cause:** VAPI sends many intermediate webhook events during calls (speech-update, transcript, etc.). If the filter node isn't strict, these events bypass the filter and cause issues.

**Fix:** The "Filter: End of Call Only" node must check `message.type === "end-of-call-report"` strictly. Only the end-of-call-report contains the full transcript needed for analysis.

### GET webhooks don't work on this n8n instance

**Cause:** n8n is behind a Cloudflare Tunnel which doesn't forward GET requests to webhook paths.

**Fix:** Use a Cloudflare Worker as a proxy for any service that requires GET verification (like Meta). The worker handles GET challenges and forwards POST messages to n8n. See the Cloudflare Worker section in the architecture docs.

### Google Sheets lookup returns empty and workflow stops

**Cause:** By default, Google Sheets lookup nodes terminate the workflow if no matching row is found.

**Fix:** Set `alwaysOutputData: true` on the Google Sheets lookup node so the workflow continues even with empty results. Then handle the empty case with an IF node downstream.

### Facebook Lead Ad form submissions are dropped / not captured

**Cause:** Facebook Lead Ads with Messenger integration deliver form data as Messenger messages, not as separate webhook POSTs. If WF2 only checks for "yes"/"call me", form submissions get routed to the false branch and discarded.

**Fix:** WF2 now has a form detection branch before the YES check. It looks for "full name:" AND "phone number:" AND "email:" in the message. If all three are present, it's a form submission and gets parsed, logged to the Pipeline sheet, and the lead receives a "Reply YES" message. This was added after Irma Quintero's form submission was lost.

### VAPI makes multiple calls for a single YES reply

**Cause:** The PSID lookup in Google Sheets returned multiple rows (duplicate PSIDs from test data), and the VAPI Call node processed every row — calling every phone number found.

**Fix:** A "Limit to 1 Lead" node was added between the PSID lookup and the update chain. Even if duplicates exist in the sheet, only the first match gets processed. Also: regularly clean up test data from the Pipeline sheet to prevent duplicate PSIDs.

### VAPI call fails with "customer.number must be a valid phone number in E.164 format"

**Cause:** The phone number from the Google Sheet is missing the `+1` country code prefix, or the sheet contains a fake/invalid test number.

**Fix:** The VAPI Call node uses `+1{{ expression }}` to prefix the country code. Ensure test rows use real phone numbers in 10-digit format. Clean up test data after testing.

### SMS replies trigger the wrong VAPI assistant

**Cause 1 — Twilio Messaging Service:** If the phone number is assigned to a Twilio Messaging Service, the service's webhook configuration overrides the individual phone number's webhook URL. The SMS may be routing to a different n8n workflow (e.g., the old Iron Maiden `twilio-sms-simple` path) even though the phone number's webhook shows the correct URL.

**Fix:** Check the Messaging Service settings (Twilio → Messaging → Services → [service name] → Integration → Incoming Messages) and update the webhook URL there.

**Cause 2 — VAPI SMS Enabled:** If "SMS Enabled" is toggled on in the VAPI Dashboard for the phone number, VAPI intercepts all inbound SMS before Twilio's webhook fires.

**Fix:** Disable "SMS Enabled" in VAPI Dashboard → Phone Numbers → [number] so Twilio routes SMS to n8n instead.

**Cause 3 — Wrong workflow intercepting:** Another active workflow may have a webhook that Twilio is still pointing to. Check all active workflows for Twilio webhook paths.

**Fix:** Use the n8n workflow list to identify which workflow is actually receiving executions. The `twilio-sms-simple` path belonged to the Iron Maiden workflow (`CL7Bg9YNwdLv7OP4`), which has been deactivated.

### Wait node loses upstream data — Twilio SMS or VAPI call fails after Wait

**Cause:** n8n Wait nodes resume as a new execution context. References to upstream nodes like `$('Parse Form Data').item.json.phone` return empty after the Wait resumes.

**Fix:** Add a Set node ("Prepare SMS Data" or "SMS Prepare VAPI") immediately before the Wait node that explicitly captures all needed values into `$json` fields. After the Wait, reference `$json.phone` instead of upstream node names.

### Twilio SMS returns empty body or "A 'To' phone number is required"

**Cause:** The HTTP Request node is configured with the wrong content type. Twilio requires form-urlencoded with keypair parameters, not JSON or multipart-form-data.

**Fix:** Set the HTTP Request node to: `contentType: form-urlencoded`, `specifyBody: keypair`, then add From, To, and Body as keypair parameters.

### n8n webhook returns 404 on API-created workflows even after manual recreation

**Cause:** Some n8n instances (particularly behind Cloudflare Tunnel) fail to register webhooks on workflows originally created via the API, even when the webhook node is manually recreated in the editor.

**Fix:** Add the functionality to an existing workflow that already has a working webhook. WF2 (`lr-messenger-reply`) was created in the editor and works reliably. The SMS handling was added to WF2 instead of a separate workflow for this reason.

### VAPI assistant asks for name even though it was passed in

**Cause:** The `first_name` variable was passed via `assistantOverrides.variableValues` but the prompt doesn't reference `{{first_name}}` in the opening line, or the variable name doesn't match.

**Fix:** Ensure the prompt uses `{{first_name}}` (matching the exact key in variableValues) and that WF2's VAPI Call node includes the overrides in the JSON body.

## Monitoring

### Check workflow executions
- **n8n dashboard:** Open each workflow → Executions tab
- **Slack:** The `send_eocr` tool sends call summaries to the `vapi-broker-assistant` Slack channel during every call
- **Email:** WF3 sends a detailed email to `info@hindsightx.com` after every completed call
- **Google Sheets:** The Pipeline sheet shows the progressive state of every lead

### Rate limits
- **Meta Graph API:** Monitored at developers.facebook.com → App Dashboard. Current usage should stay well under 1% for normal lead volumes.
- **VAPI:** Check dashboard.vapi.ai for call costs and usage.
- **Cal.com:** No hard rate limits for booking operations.
