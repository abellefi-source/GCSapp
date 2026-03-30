/**
 * GCS AI Receptionist — Phone-based intake agent
 * Uses Twilio Voice + Claude API for conversational job intake
 */
const Anthropic = require("@anthropic-ai/sdk");
const twilio = require("twilio");
const { query, run, getSetting, setSetting } = require("./db");

// In-memory call sessions (call SID → conversation state)
const callSessions = {};

// Session TTL: clean up after 30 minutes
const SESSION_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of Object.entries(callSessions)) {
    if (now - session.lastActivity > SESSION_TTL) {
      delete callSessions[sid];
    }
  }
}, 5 * 60 * 1000);

// ─── HELPERS ──────────────────────────────────────────────────────

function getConfig() {
  return {
    twilioAccountSid: getSetting("receptionistTwilioSid") || "",
    twilioAuthToken: getSetting("receptionistTwilioToken") || "",
    twilioPhoneNumber: getSetting("receptionistTwilioPhone") || "",
    anthropicApiKey: getSetting("receptionistAnthropicKey") || "",
    greeting: getSetting("receptionistGreeting") || "",
    companyName: getSetting("companyName") || "Good Car Solutions",
    enabled: getSetting("receptionistEnabled") === "true",
    voiceName: getSetting("receptionistVoice") || "Polly.Joanna",
    maxTurns: parseInt(getSetting("receptionistMaxTurns") || "12", 10),
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.twilioAccountSid && c.twilioAuthToken && c.anthropicApiKey && c.enabled);
}

function buildSystemPrompt(config) {
  const serviceTypes = [
    "ECU Programming", "ECU Tuning", "Key Programming", "Module Coding",
    "DTC Delete", "Immobilizer Bypass", "BCM Programming",
    "Electrical Diagnostics", "Other"
  ];

  return `You are a friendly, professional phone receptionist for ${config.companyName}, an automotive ECU programming and vehicle electrical services company based in Houston, TX.

Your job is to answer incoming calls and collect information to create a service intake request. Be warm, conversational, and helpful — like a real receptionist.

INFORMATION TO COLLECT (in natural conversation order):
1. Customer name (required) — their name or business name
2. Phone number (required) — confirm the number they're calling from or get a callback number
3. Vehicle info (optional but try to get) — year, make, model
4. VIN (optional) — only ask if they have it handy, don't push
5. Service type — what they need help with. Common services: ${serviceTypes.join(", ")}
6. Description — brief description of the issue or what they need
7. Preferred date/time (optional) — when they'd like to schedule
8. Service address (optional) — if they need mobile service, get the address

CONVERSATION RULES:
- Keep responses SHORT (1-3 sentences). This is a phone call, not a chat.
- Be natural and conversational — don't sound like a form or robot.
- Don't ask for everything at once. Have a natural back-and-forth.
- If the caller gives multiple pieces of info at once, acknowledge them all.
- If they're unsure about something, move on — don't push.
- Use the caller's name once you have it.
- If they ask about pricing, say you'll have a technician follow up with a quote.
- If they ask about services you don't understand, just note it in the description.

WHEN YOU HAVE ENOUGH INFO (at minimum: name and what they need):
End your message with the exact tag <INTAKE_COMPLETE> followed by a JSON object with the collected data:
<INTAKE_COMPLETE>{"customer_name":"...","phone":"...","vehicle_year":"...","vehicle_make":"...","vehicle_model":"...","vin":"...","service_type":"...","description":"...","preferred_date":"...","preferred_time":"...","service_address":"..."}

Only include fields you actually collected. Always include customer_name. Include the <INTAKE_COMPLETE> tag on the SAME message as your final goodbye to the caller.

IMPORTANT: Do NOT include the <INTAKE_COMPLETE> tag until you've said goodbye and the conversation is wrapping up. Confirm the details briefly before ending.`;
}

// ─── CLAUDE CONVERSATION ──────────────────────────────────────────

async function getClaudeResponse(callSid, userMessage) {
  const config = getConfig();
  if (!config.anthropicApiKey) throw new Error("Anthropic API key not configured");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Get or create session
  if (!callSessions[callSid]) {
    callSessions[callSid] = {
      messages: [],
      lastActivity: Date.now(),
      turnCount: 0,
    };
  }

  const session = callSessions[callSid];
  session.lastActivity = Date.now();
  session.turnCount++;

  // Add user message
  if (userMessage) {
    session.messages.push({ role: "user", content: userMessage });
  }

  // If we've hit max turns, force wrap-up
  if (session.turnCount >= config.maxTurns) {
    session.messages.push({
      role: "user",
      content: "[SYSTEM: This call has been going on a while. Please wrap up — summarize what you've collected, confirm with the caller, and end the call with <INTAKE_COMPLETE>.]"
    });
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: buildSystemPrompt(config),
    messages: session.messages,
  });

  const assistantText = response.content[0].text;
  session.messages.push({ role: "assistant", content: assistantText });

  return assistantText;
}

// ─── INTAKE CREATION ──────────────────────────────────────────────

function createIntakeFromCall(data, callSid) {
  const id = "INT-" + Date.now().toString(36).toUpperCase();
  run(
    `INSERT INTO intake_submissions (id, customer_name, phone, email, vehicle_year, vehicle_make, vehicle_model, vin, service_type, description, preferred_date, preferred_time, service_address)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      data.customer_name || "",
      data.phone || "",
      data.email || "",
      data.vehicle_year || "",
      data.vehicle_make || "",
      data.vehicle_model || "",
      data.vin || "",
      data.service_type || "",
      (data.description || "") + (callSid ? `\n[Via AI Receptionist — Call ${callSid}]` : ""),
      data.preferred_date || "",
      data.preferred_time || "",
      data.service_address || "",
    ]
  );

  // Notify admins
  const admins = query("SELECT id FROM users WHERE role = 'admin' AND active = 1");
  admins.forEach((a) => {
    run(
      "INSERT INTO notifications (user_id, type, title, message, link) VALUES (?,?,?,?,?)",
      [
        a.id,
        "intake",
        "New intake (AI Receptionist)",
        `${data.customer_name || "Caller"} — ${data.vehicle_year || ""} ${data.vehicle_make || ""} ${data.vehicle_model || ""}`.trim(),
        id,
      ]
    );
  });

  // Log the call
  run(
    `INSERT INTO receptionist_calls (id, call_sid, caller_phone, customer_name, intake_id, status, duration, transcript, created_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
    [
      "RC-" + Date.now().toString(36).toUpperCase(),
      callSid || "",
      data.phone || "",
      data.customer_name || "",
      id,
      "completed",
      0,
      JSON.stringify(callSessions[callSid]?.messages || []),
    ]
  );

  return id;
}

// ─── TWILIO WEBHOOK HANDLERS ──────────────────────────────────────

function buildTwiml(text, config, gather = true) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (gather) {
    const g = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/receptionist/respond",
      method: "POST",
      language: "en-US",
    });
    g.say({ voice: config.voiceName }, text);
  } else {
    twiml.say({ voice: config.voiceName }, text);
    twiml.hangup();
  }

  return twiml.toString();
}

// Called when a new call comes in
async function handleIncomingCall(req, res) {
  const config = getConfig();
  if (!config.enabled || !config.anthropicApiKey) {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say("Sorry, our automated receptionist is currently unavailable. Please try again later or leave a message.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  const callSid = req.body.CallSid;
  const callerPhone = req.body.From || "";

  // Initialize session with caller's phone
  callSessions[callSid] = {
    messages: [],
    lastActivity: Date.now(),
    turnCount: 0,
    callerPhone,
  };

  // Build greeting
  const greeting = config.greeting ||
    `Thank you for calling ${config.companyName}! This is our AI assistant. I can help you schedule a service or get information. How can I help you today?`;

  // Get Claude's first response with context about the caller
  try {
    const firstMessage = `[SYSTEM: New incoming call from ${callerPhone}. Greet the caller warmly.]`;
    callSessions[callSid].messages.push({ role: "user", content: firstMessage });

    const response = await getClaudeResponse(callSid, null);
    const spokenText = response.replace(/<INTAKE_COMPLETE>[\s\S]*/, "").trim();

    res.type("text/xml").send(buildTwiml(spokenText || greeting, config));
  } catch (err) {
    console.error("[Receptionist] Error on incoming call:", err.message);
    res.type("text/xml").send(buildTwiml(greeting, config));
  }

  // Log the call start
  run(
    `INSERT INTO receptionist_calls (id, call_sid, caller_phone, customer_name, intake_id, status, duration, transcript, created_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
    [
      "RC-" + Date.now().toString(36).toUpperCase(),
      callSid,
      callerPhone,
      "",
      "",
      "in_progress",
      0,
      "[]",
    ]
  );
}

// Called each time the caller speaks
async function handleResponse(req, res) {
  const config = getConfig();
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";

  if (!speechResult.trim()) {
    // No speech detected — prompt again
    return res.type("text/xml").send(
      buildTwiml("I'm sorry, I didn't catch that. Could you repeat that?", config)
    );
  }

  try {
    const claudeResponse = await getClaudeResponse(callSid, speechResult);

    // Check if intake is complete
    const completeMatch = claudeResponse.match(/<INTAKE_COMPLETE>([\s\S]*)/);
    if (completeMatch) {
      try {
        const intakeData = JSON.parse(completeMatch[1].trim());
        // Add caller phone if not explicitly given
        if (!intakeData.phone && callSessions[callSid]?.callerPhone) {
          intakeData.phone = callSessions[callSid].callerPhone;
        }
        const intakeId = createIntakeFromCall(intakeData, callSid);

        // Update call log
        run(
          "UPDATE receptionist_calls SET status = 'completed', customer_name = ?, intake_id = ?, transcript = ? WHERE call_sid = ? AND status = 'in_progress'",
          [
            intakeData.customer_name || "",
            intakeId,
            JSON.stringify(callSessions[callSid]?.messages || []),
            callSid,
          ]
        );

        // Say goodbye and hang up
        const goodbyeText = claudeResponse.replace(/<INTAKE_COMPLETE>[\s\S]*/, "").trim();
        return res.type("text/xml").send(buildTwiml(goodbyeText || "Thank you for calling! We'll be in touch soon. Goodbye!", config, false));
      } catch (parseErr) {
        console.error("[Receptionist] Failed to parse intake data:", parseErr.message);
        // Continue conversation if parse failed
      }
    }

    // Normal conversation turn — keep gathering
    const spokenText = claudeResponse.replace(/<INTAKE_COMPLETE>[\s\S]*/, "").trim();
    res.type("text/xml").send(buildTwiml(spokenText, config));
  } catch (err) {
    console.error("[Receptionist] Error in response:", err.message);
    res.type("text/xml").send(
      buildTwiml("I'm sorry, I'm having a little trouble. Could you repeat that?", config)
    );
  }
}

// Called when the call ends
function handleCallStatus(req, res) {
  const callSid = req.body.CallSid;
  const duration = req.body.CallDuration || 0;
  const status = req.body.CallStatus || "completed";

  // Update call log
  run(
    "UPDATE receptionist_calls SET duration = ?, status = ? WHERE call_sid = ? AND status = 'in_progress'",
    [parseInt(duration, 10), status === "completed" ? "completed" : "missed", callSid]
  );

  // Update transcript
  if (callSessions[callSid]) {
    run(
      "UPDATE receptionist_calls SET transcript = ? WHERE call_sid = ?",
      [JSON.stringify(callSessions[callSid].messages || []), callSid]
    );
  }

  // Clean up session
  delete callSessions[callSid];
  res.sendStatus(200);
}

// ─── SETTINGS & CALL LOG API ──────────────────────────────────────

function getReceptionistSettings() {
  return {
    twilioAccountSid: getSetting("receptionistTwilioSid") || "",
    twilioAuthToken: getSetting("receptionistTwilioToken") ? "••••••••" : "",
    twilioPhoneNumber: getSetting("receptionistTwilioPhone") || "",
    anthropicApiKey: getSetting("receptionistAnthropicKey") ? "••••••••" : "",
    greeting: getSetting("receptionistGreeting") || "",
    voiceName: getSetting("receptionistVoice") || "Polly.Joanna",
    maxTurns: parseInt(getSetting("receptionistMaxTurns") || "12", 10),
    enabled: getSetting("receptionistEnabled") === "true",
  };
}

function updateReceptionistSettings(data) {
  if (data.twilioAccountSid !== undefined) setSetting("receptionistTwilioSid", data.twilioAccountSid);
  if (data.twilioAuthToken !== undefined && data.twilioAuthToken !== "••••••••") setSetting("receptionistTwilioToken", data.twilioAuthToken);
  if (data.twilioPhoneNumber !== undefined) setSetting("receptionistTwilioPhone", data.twilioPhoneNumber);
  if (data.anthropicApiKey !== undefined && data.anthropicApiKey !== "••••••••") setSetting("receptionistAnthropicKey", data.anthropicApiKey);
  if (data.greeting !== undefined) setSetting("receptionistGreeting", data.greeting);
  if (data.voiceName !== undefined) setSetting("receptionistVoice", data.voiceName);
  if (data.maxTurns !== undefined) setSetting("receptionistMaxTurns", String(data.maxTurns));
  if (data.enabled !== undefined) setSetting("receptionistEnabled", String(data.enabled));
}

function getCallLog(limit = 50, offset = 0) {
  return query(
    "SELECT * FROM receptionist_calls ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );
}

function getCallDetail(id) {
  const rows = query("SELECT * FROM receptionist_calls WHERE id = ? OR call_sid = ?", [id, id]);
  return rows.length > 0 ? rows[0] : null;
}

// ─── TWILIO PHONE NUMBER SETUP ────────────────────────────────────

async function configureWebhooks(baseUrl) {
  const config = getConfig();
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    throw new Error("Twilio credentials and phone number required");
  }

  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

  // Find the phone number SID
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: config.twilioPhoneNumber });
  if (numbers.length === 0) throw new Error(`Phone number ${config.twilioPhoneNumber} not found in your Twilio account`);

  // Update the phone number webhooks
  await client.incomingPhoneNumbers(numbers[0].sid).update({
    voiceUrl: `${baseUrl}/receptionist/incoming`,
    voiceMethod: "POST",
    statusCallback: `${baseUrl}/receptionist/status`,
    statusCallbackMethod: "POST",
  });

  return { success: true, phoneNumber: config.twilioPhoneNumber };
}

module.exports = {
  handleIncomingCall,
  handleResponse,
  handleCallStatus,
  getReceptionistSettings,
  updateReceptionistSettings,
  getCallLog,
  getCallDetail,
  configureWebhooks,
  isConfigured,
  getConfig,
};
