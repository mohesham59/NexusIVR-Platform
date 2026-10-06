package gov.iti.telecom;

import org.asteriskjava.fastagi.AgiChannel;
import org.asteriskjava.fastagi.AgiException;
import org.asteriskjava.fastagi.AgiRequest;
import org.asteriskjava.fastagi.BaseAgiScript;
import org.jvoicexml.ConnectionInformation;
import org.jvoicexml.Session;
import org.jvoicexml.event.ErrorEvent;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;
import gov.iti.telecom.dao.CallLogDao;

/**
 * VxmlAgiHandler — intelligent FastAGI handler for dynamic VXML execution.
 *
 * <h2>HOW IT WORKS</h2>
 * <ol>
 * <li>Receives FastAGI call from Asterisk (e.g.,
 * agi://127.0.0.1:4573/hello)</li>
 * <li>Extracts VXML name from:
 * <ul>
 * <li>VXML_FILE Asterisk variable (if set)</li>
 * <li>AGI request path (e.g., "/hello" → "hello.vxml")</li>
 * <li>Default fallback: "hello.vxml"</li>
 * </ul>
 * </li>
 * <li>Loads the VXML using VxmlLoader</li>
 * <li>Executes it via VxmlScenarioEngine</li>
 * <li>Collects results (DTMF input, form data) back to Asterisk variables</li>
 * </ol>
 *
 * <h2>USAGE FROM ASTERISK</h2>
 * 
 * <pre>
 * ; Simple: use path as VXML name
 * exten => 500,1,NoOp(Call hello.vxml)
 * same  => n,AGI(agi://127.0.0.1:4573/hello)
 * same  => n,Hangup()
 *
 * ; Advanced: override VXML name via variable
 * exten => 501,1,NoOp(Call any VXML)
 * same  => n,Set(VXML_FILE=menu-example)
 * same  => n,AGI(agi://127.0.0.1:4573/dynamic)
 * same  => n,Hangup()
 * </pre>
 *
 * <h2>ASTERISK VARIABLES SET BY THIS HANDLER</h2>
 * After execution, these variables are available for use in the dialplan:
 * <ul>
 * <li>VXML_SESSION_ID: Unique session identifier</li>
 * <li>VXML_STATE: Final session state (COMPLETED, ERROR, etc.)</li>
 * <li>VXML_ERROR: Error message (if any)</li>
 * <li>VXML_RESULT_*: Form results (e.g., VXML_RESULT_user_choice)</li>
 * </ul>
 *
 * <h2>EXAMPLE DIALPLAN USAGE</h2>
 * 
 * <pre>
 * exten => 500,1,Set(VXML_FILE=hello)
 * same  => n,AGI(agi://127.0.0.1:4573/hello)
 * same  => n,NoOp(Session: ${VXML_SESSION_ID} State: ${VXML_STATE})
 * same  => n,GotoIf($["${VXML_STATE}" = "COMPLETED"]?success:error)
 * same  => n(success),Playback(demo-thanks)
 * same  => n,Hangup()
 * same  => n(error),Playback(vm-goodbye)
 * same  => n,Hangup()
 * </pre>
 *
 * @author IVR Platform Team
 * @version 1.0
 * @see VxmlScenarioEngine
 * @see VxmlLoader
 */
public class VxmlAgiHandler extends BaseAgiScript {

    private static final org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger(VxmlAgiHandler.class);

    private static final java.net.http.HttpClient API_HTTP_CLIENT =
            java.net.http.HttpClient.newBuilder()
                    .connectTimeout(java.time.Duration.ofSeconds(10))
                    .build();

    // Shared VxmlScenarioEngine instance (initialized once)
    private static volatile VxmlScenarioEngine vxmlEngine;
    private static final Object ENGINE_LOCK = new Object();

    // Digit captured via barge-in during a prompt; consumed by the next <field>.
    private char bargeDigit = 0;

    @Override
    public void service(AgiRequest request, AgiChannel channel) throws AgiException {
        String callerId = "unknown";
        String vxmlName = "hello"; // Default VXML
        String sessionId = null;
        AnalyticsTracker tracker = null;
        UUID tenantId = UUID.fromString("11111111-1111-1111-1111-111111111111"); // Default tenant ID

        try {
            bargeDigit = 0;
            // Extract caller information
            callerId = request.getCallerId() != null ? request.getCallerId() : request.getCallerIdName();
            if (callerId == null || callerId.trim().isEmpty()) {
                callerId = "unknown";
            }
            System.out.println("\n[VxmlAgiHandler] *** New Call from: " + callerId + " ***");

            // Step 1: Determine which VXML to execute
            vxmlName = determineVxmlName(request, channel);
            System.out.println("[VxmlAgiHandler] VXML selected: " + vxmlName);

            // Step 2: Create session ID
            sessionId = createSessionId(callerId, request);
            System.out.println("[VxmlAgiHandler] Session ID: " + sessionId);

            // Initialize tracker and start recording
            tracker = new AnalyticsTracker(sessionId, callerId);
            String recordingPath = "/var/lib/asterisk/sounds/records/" + sessionId + ".wav";
            try {
                channel.exec("MixMonitor", recordingPath);
                tracker.setRecordingUrl("/records/" + sessionId + ".wav"); // Storing relative to sounds for frontend access
            } catch (Exception e) {
                System.out.println("[VxmlAgiHandler] Could not start MixMonitor: " + e.getMessage());
            }

            // Log call initialization to Database
            CallLogDao.saveNewCallLog(sessionId, tenantId, callerId, vxmlName);

            // Step 3: Initialize VXML engine if needed
            initializeEngine();

            // Step 4: Create connection information for this call
            ConnectionInformation connInfo = createConnectionInfo(request, callerId);

            // Step 5: Execute VXML scenario
            System.out.println("[VxmlAgiHandler] Executing VXML: " + vxmlName);
            VxmlSession vxmlSession = executeVxmlScenario(vxmlName, connInfo, sessionId, channel, tracker);

            // Step 6: Set Asterisk variables with results
            setAsteriskVariables(channel, vxmlSession);

            // Step 7: Handle post-execution logic (transfers, etc.)
            handlePostExecution(channel, vxmlSession);

            System.out.println("[VxmlAgiHandler] Call completed successfully");
            CallLogDao.updateCallStatus(sessionId, "ANSWERED", null);

        } catch (Exception e) {
            logger.error("[VxmlAgiHandler] Exception: " + e.getMessage(), e);
            CallLogDao.updateCallStatus(sessionId, "FAILED", null);
            handleError(channel, sessionId, e);
        } finally {
            if (tracker != null) {
                tracker.saveToDatabase();
            }
        }
    }

    /**
     * Determines which VXML file to execute.
     *
     * Priority:
     * 1. VXML_FILE Asterisk variable (if caller set it)
     * 2. AGI request path (e.g., "/hello" from "agi://127.0.0.1:4573/hello")
     * 3. Default: "hello"
     *
     * The resolved name is sanitized to prevent path traversal.
     *
     * @param request AGI request from Asterisk
     * @param channel AGI channel
     * @return VXML name without extension (e.g., "hello", "menu-example")
     */
    /**
     * Determines which VXML file to execute.
     *
     * Priority:
     * 1. VXML_FILE Asterisk variable (if caller set it)
     * 2. business_name Asterisk variable
     * 3. Query string parameter from AGI URL (e.g., ?business_name=... or ?vxml_file=...)
     * 4. AGI request path (e.g., "/hello" from "agi://127.0.0.1:4573/hello")
     * 5. Default: "hello"
     *
     * @param request AGI request from Asterisk
     * @param channel AGI channel
     * @return VXML name without extension
     */
    private String determineVxmlName(AgiRequest request, AgiChannel channel)
            throws AgiException {

        // 1. Check VXML_FILE variable first
        try {
            String vxmlFile = channel.getVariable("VXML_FILE");
            if (vxmlFile != null && !vxmlFile.trim().isEmpty() && !vxmlFile.equals("0")) {
                System.out.println("[VxmlAgiHandler] Using VXML_FILE variable: " + vxmlFile);
                return sanitizeVxmlName(vxmlFile);
            }
        } catch (AgiException e) {
            System.out.println("[VxmlAgiHandler] Could not read VXML_FILE variable: " + e.getMessage());
        }

        // 2. Check business_name variable
        try {
            String busName = channel.getVariable("business_name");
            if (busName != null && !busName.trim().isEmpty() && !busName.equals("0")) {
                System.out.println("[VxmlAgiHandler] Using business_name variable: " + busName);
                return sanitizeVxmlName(busName);
            }
        } catch (AgiException e) {
            System.out.println("[VxmlAgiHandler] Could not read business_name variable: " + e.getMessage());
        }

        // 3. Extract query params from request URL (e.g. agi://127.0.0.1:4573/ivr_platform?business_name=...)
        String requestPath = request.getRequestURL();
        if (requestPath != null && requestPath.contains("?")) {
            String queryString = requestPath.substring(requestPath.indexOf('?') + 1);
            for (String param : queryString.split("&")) {
                String[] pair = param.split("=", 2);
                if (pair.length == 2) {
                    String key = pair[0].trim();
                    if ("business_name".equalsIgnoreCase(key) || "vxml_file".equalsIgnoreCase(key) || "vxml".equalsIgnoreCase(key)) {
                        String val = pair[1].trim();
                        if (!val.isEmpty()) {
                            System.out.println("[VxmlAgiHandler] Using URL query parameter " + key + ": " + val);
                            return sanitizeVxmlName(val);
                        }
                    }
                }
            }
        }

        // 4. Extract path component from request URL
        if (requestPath != null) {
            String pathOnly = requestPath.contains("?") ? requestPath.substring(0, requestPath.indexOf('?')) : requestPath;
            int lastSlash = pathOnly.lastIndexOf('/');
            if (lastSlash >= 0 && lastSlash < pathOnly.length() - 1) {
                String pathVxml = pathOnly.substring(lastSlash + 1).trim();
                if (!pathVxml.isEmpty() && !pathVxml.equalsIgnoreCase("default") && !pathVxml.equalsIgnoreCase("ivr_platform")) {
                    System.out.println("[VxmlAgiHandler] Using path-derived VXML: " + pathVxml);
                    return sanitizeVxmlName(pathVxml);
                }
            }
        }

        // 5. Check script path
        String script = request.getScript();
        if (script != null && !script.trim().isEmpty() && !script.equalsIgnoreCase("default") && !script.equalsIgnoreCase("ivr_platform")) {
            String cleanScript = script.contains("?") ? script.substring(0, script.indexOf('?')) : script;
            System.out.println("[VxmlAgiHandler] Using script path: " + cleanScript);
            return sanitizeVxmlName(cleanScript);
        }

        // Default fallback
        System.out.println("[VxmlAgiHandler] Using default VXML: hello");
        return "hello";
    }

    /**
     * Restricts a VXML scenario name to a safe identifier so callers cannot
     * traverse out of the scenarios directory (e.g. "../../etc/passwd").
     * Strips .vxml and .json extensions if present.
     */
    private String sanitizeVxmlName(String name) {
        if (name == null) {
            return "hello";
        }
        String trimmed = name.trim();
        if (trimmed.contains("?")) {
            trimmed = trimmed.substring(0, trimmed.indexOf('?'));
        }
        if (trimmed.toLowerCase().endsWith(".vxml")) {
            trimmed = trimmed.substring(0, trimmed.length() - 5);
        } else if (trimmed.toLowerCase().endsWith(".json")) {
            trimmed = trimmed.substring(0, trimmed.length() - 5);
        }
        if (trimmed.isEmpty() || trimmed.contains("/") || trimmed.contains("\\") || trimmed.contains("..")) {
            return "hello";
        }
        if (!trimmed.matches("[A-Za-z0-9_-]+")) {
            return "hello";
        }
        return trimmed;
    }

    /**
     * Creates a unique session ID for this call.
     *
     * Format: {callerId}_{timestamp}_{random}
     * Example: 1001_1719239400_8371
     *
     * @param callerId caller's extension/number
     * @param request  AGI request
     * @return session ID
     */
    private String createSessionId(String callerId, AgiRequest request) {
        long timestamp = System.currentTimeMillis() / 1000;
        int random = (int) (Math.random() * 10000);
        String sessionId = callerId + "_" + timestamp + "_" + random;
        return sessionId;
    }

    /**
     * Creates connection information for JVoiceXML.
     *
     * @param request  AGI request
     * @param callerId caller identifier
     * @return ConnectionInformation for VXML execution
     */
    private ConnectionInformation createConnectionInfo(AgiRequest request, String callerId) {
        try {
            return new gov.iti.telecom.platform.AsteriskConnectionInformation(
                    "default", // profile
                    "asterisk-output", // system output
                    "asterisk-input", // user input
                    "asterisk-call-control", // call control
                    new URI("sip:" + callerId), // called device (caller)
                    new URI("sip:ivr@asterisk"), // calling device (IVR)
                    "SIP", // protocol
                    "2.0" // protocol version
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to create connection info", e);
        }
    }

    /**
     * Initializes the shared VXML execution engine.
     *
     * Uses double-checked locking for thread-safe singleton initialization.
     *
     * @throws Exception if engine initialization fails
     */
    private void initializeEngine() throws Exception {
        if (vxmlEngine == null) {
            synchronized (ENGINE_LOCK) {
                if (vxmlEngine == null) {
                    System.out.println("[VxmlAgiHandler] Initializing VXML engine...");
                    vxmlEngine = new VxmlScenarioEngine();
                    vxmlEngine.initialize();
                    System.out.println("[VxmlAgiHandler] VXML engine initialized successfully");
                }
            }
        }
    }

    /**
     * Executes a VXML scenario and renders prompts & DTMF interactions
     * interactively to the channel.
     */
    private VxmlSession executeVxmlScenario(String vxmlName,
            ConnectionInformation connInfo,
            String sessionId,
            AgiChannel channel,
            AnalyticsTracker tracker) throws Exception {
        try {
            System.out.println("[VxmlAgiHandler] Starting VXML execution: " + vxmlName);
            VxmlSession session = vxmlEngine.executeVxml(vxmlName, connInfo);

            if (session != null) {
                session.setVariable("agi_session_id", sessionId);
                session.setTracker(tracker);
            }

            // Render VXML Document prompts & DTMF input interactively
            try {
                VxmlLoader loader = new VxmlLoader("scenarios/");
                org.w3c.dom.Document doc = loader.loadVxml(vxmlName);

                org.w3c.dom.NodeList menus = doc.getElementsByTagName("menu");
                org.w3c.dom.NodeList forms = doc.getElementsByTagName("form");

                if (menus.getLength() > 0) {
                    org.w3c.dom.Element menu = (org.w3c.dom.Element) menus.item(0);
                    renderMenuElement(menu, channel, session);
                } else if (forms.getLength() > 0) {
                    org.w3c.dom.Element initialForm = (org.w3c.dom.Element) forms.item(0);
                    renderFormElement(initialForm, channel, session);
                }
            } catch (Exception e) {
                System.out.println("[VxmlAgiHandler] Note rendering VXML: " + e.getMessage());
            }

            return session;
        } catch (Exception e) {
            System.err.println("[VxmlAgiHandler] VXML execution error: " + e.getMessage());
            throw e;
        }
    }

    private void renderDialogById(org.w3c.dom.Document doc, String dialogId, AgiChannel channel, VxmlSession session)
            throws Exception {
        org.w3c.dom.NodeList forms = doc.getElementsByTagName("form");
        for (int i = 0; i < forms.getLength(); i++) {
            org.w3c.dom.Element form = (org.w3c.dom.Element) forms.item(i);
            if (dialogId.equals(form.getAttribute("id"))) {
                renderFormElement(form, channel, session);
                return;
            }
        }

        org.w3c.dom.NodeList menus = doc.getElementsByTagName("menu");
        for (int i = 0; i < menus.getLength(); i++) {
            org.w3c.dom.Element menu = (org.w3c.dom.Element) menus.item(i);
            if (dialogId.equals(menu.getAttribute("id"))) {
                renderMenuElement(menu, channel, session);
                return;
            }
        }
    }

    private void renderMenuElement(org.w3c.dom.Element menu, AgiChannel channel, VxmlSession session) throws Exception {
        java.util.List<org.w3c.dom.Element> prompts = getDirectChildElements(menu, "prompt");
        char choice = 0;
        for (int p = 0; p < prompts.size(); p++) {
            choice = processPromptElementAndGetDigit(prompts.get(p), channel, session);
            if (choice != 0 && choice != '\0') {
                break;
            }
        }

        if (choice == 0 || choice == '\0') {
            choice = channel.waitForDigit(10000);
        }

        if (choice != 0 && choice != '\0') {
            String choiceStr = String.valueOf(choice);
            if (session != null) {
                session.setVariable("user_choice", choiceStr);
                if (session.getTracker() != null) {
                    session.getTracker().addEvent("MENU_CHOICE", choiceStr);
                }
            }
            System.out.println("[VxmlAgiHandler] DTMF choice received: " + choiceStr);

            org.w3c.dom.NodeList choices = menu.getElementsByTagName("choice");
            String targetFormId = null;
            for (int c = 0; c < choices.getLength(); c++) {
                org.w3c.dom.Element ch = (org.w3c.dom.Element) choices.item(c);
                if (choiceStr.equals(ch.getAttribute("dtmf"))) {
                    String next = ch.getAttribute("next");
                    if (next != null && next.startsWith("#")) {
                        targetFormId = next.substring(1);
                    }
                    break;
                }
            }

            if (targetFormId != null) {
                CallLogDao.logMenuSelection(session != null ? (String) session.getVariable("agi_session_id") : null, targetFormId);
                renderDialogById(menu.getOwnerDocument(), targetFormId, channel, session);
            } else {
                if (session != null && session.getTracker() != null) {
                    session.getTracker().addEvent("INVALID_INPUT", choiceStr);
                }
                org.w3c.dom.Element nomatch = findChildElement(menu, "nomatch");
                if (nomatch != null) {
                    renderFormElement(nomatch, channel, session);
                    if (findChildElement(nomatch, "reprompt") != null) {
                        renderMenuElement(menu, channel, session);
                        return;
                    }
                }
            }
        } else {
            if (session != null && session.getTracker() != null) {
                session.getTracker().addEvent("TIMEOUT", null);
            }
            org.w3c.dom.Element noinput = findChildElement(menu, "noinput");
            if (noinput != null) {
                renderFormElement(noinput, channel, session);
                if (findChildElement(noinput, "reprompt") != null) {
                    renderMenuElement(menu, channel, session);
                    return;
                }
            }
        }
    }

    private boolean renderFormElement(org.w3c.dom.Element form, AgiChannel channel, VxmlSession session) throws Exception {
        org.w3c.dom.NodeList children = form.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node node = children.item(i);
            if (node.getNodeType() != org.w3c.dom.Node.ELEMENT_NODE) {
                continue;
            }
            org.w3c.dom.Element child = (org.w3c.dom.Element) node;
            String tagName = child.getTagName();

            if ("block".equals(tagName)) {
                if (renderFormElement(child, channel, session)) {
                    return true;
                }
            } else if ("prompt".equals(tagName)) {
                char digit = processPromptElementAndGetDigit(child, channel, session);
                if (digit != 0 && digit != '\0') {
                    bargeDigit = digit;
                    System.out.println("[VxmlAgiHandler] Barge-in digit captured during prompt: " + digit);
                }
            } else if ("audio".equals(tagName)) {
                renderAudioElement(child, channel, session);
            } else if ("goto".equals(tagName)) {
                String next = child.getAttribute("next");
                if (next != null && next.startsWith("#")) {
                    String targetFormId = next.substring(1);
                    System.out.println("[VxmlAgiHandler] <goto> jumping to dialog: " + targetFormId);
                    renderDialogById(form.getOwnerDocument(), targetFormId, channel, session);
                    return true;
                }
            } else if ("assign".equals(tagName)) {
                String name = child.getAttribute("name");
                String expr = child.getAttribute("expr");
                if (name != null && !name.isEmpty() && expr != null && session != null) {
                    if (expr.startsWith("'") && expr.endsWith("'")) {
                        expr = expr.substring(1, expr.length() - 1);
                    }
                    session.setVariable(name, expr);
                    System.out.println("[VxmlAgiHandler] <assign> " + name + " = " + expr);
                }
            } else if ("api".equals(tagName)) {
                String url = child.getAttribute("url");
                String varName = child.getAttribute("var");
                String saveResultAs = child.getAttribute("saveResultAs");
                String jsonPath = child.getAttribute("jsonPath"); // Optional: for extracting a specific field

                try {
                    String fullUrl = url;
                    if (varName != null && !varName.isEmpty() && session != null) {
                        Object val = session.getVariable(varName);
                        if (val != null) {
                            fullUrl += (url.contains("?") ? "&" : "?") + varName + "=" + val.toString();
                        }
                    }

                    // Restrict <api> to http/https to avoid SSRF via arbitrary schemes
                    if (fullUrl == null || !(fullUrl.startsWith("http://") || fullUrl.startsWith("https://"))) {
                        throw new IllegalArgumentException("Unsupported <api> URL scheme: " + fullUrl);
                    }

                    System.out.println("[VxmlAgiHandler] <api> Calling URL: " + fullUrl);
                    java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
                            .uri(URI.create(fullUrl))
                            .timeout(java.time.Duration.ofSeconds(15))
                            .GET()
                            .build();
                    java.net.http.HttpResponse<String> response = API_HTTP_CLIENT.send(req,
                            java.net.http.HttpResponse.BodyHandlers.ofString());
                    String responseBody = response.body();
                    System.out.println("[VxmlAgiHandler] <api> Response: " + responseBody);

                    String extractedResult = responseBody;
                    if (jsonPath != null && !jsonPath.isEmpty()) {
                        try {
                            // Support top-level fields and dot-nested paths,
                            // e.g. "current_weather.temperature".
                            com.google.gson.JsonElement element = com.google.gson.JsonParser
                                    .parseString(responseBody);
                            boolean found = true;
                            for (String part : jsonPath.split("\\.")) {
                                if (element == null || !element.isJsonObject()
                                        || !element.getAsJsonObject().has(part)) {
                                    found = false;
                                    break;
                                }
                                element = element.getAsJsonObject().get(part);
                            }
                            if (found && element != null && element.isJsonPrimitive()) {
                                extractedResult = element.getAsString();
                            }
                        } catch (Exception e) {
                            System.err.println("[VxmlAgiHandler] <api> Failed to parse JSON path: " + jsonPath);
                        }
                    }

                    if (saveResultAs != null && !saveResultAs.isEmpty() && session != null) {
                        session.setVariable(saveResultAs, extractedResult);
                        System.out.println("[VxmlAgiHandler] <api> Saved " + saveResultAs + " = " + extractedResult);
                    }
                } catch (Exception e) {
                    System.err.println("[VxmlAgiHandler] <api> request failed: " + e.getMessage());
                }
            } else if ("field".equals(tagName)) {
                String fieldName = child.getAttribute("name");
                String fieldType = child.getAttribute("type");
                java.util.List<org.w3c.dom.Element> fieldPrompts = getDirectChildElements(child, "prompt");

                // Parse <grammar> children for DTMF tokens
                java.util.List<String> grammarTokens = new java.util.ArrayList<>();
                org.w3c.dom.NodeList grammars = child.getElementsByTagName("grammar");
                for (int g = 0; g < grammars.getLength(); g++) {
                    org.w3c.dom.Element grammarEl = (org.w3c.dom.Element) grammars.item(g);
                    org.w3c.dom.NodeList items = grammarEl.getElementsByTagName("item");
                for (int j = 0; j < items.getLength(); j++) {
                    grammarTokens.add(items.item(j).getTextContent().trim());
                }
                    // Also check for inline text content
                    if (items.getLength() == 0) {
                        String grammarText = grammarEl.getTextContent().trim();
                        if (!grammarText.isEmpty()) {
                            grammarTokens.add(grammarText);
                        }
                    }
                }

                StringBuilder inputStr = new StringBuilder();
                char firstDigit = 0;

                int maxLen = -1;
                String maxLenAttr = child.getAttribute("maxlen");
                if (maxLenAttr != null && !maxLenAttr.trim().isEmpty()) {
                    try {
                        maxLen = Integer.parseInt(maxLenAttr.trim());
                    } catch (NumberFormatException e) {
                        maxLen = -1;
                    }
                }

                if (bargeDigit != 0 && bargeDigit != '\0') {
                    firstDigit = bargeDigit;
                    bargeDigit = 0;
                    System.out.println("[VxmlAgiHandler] Field " + fieldName + " consumed barge-in digit: " + firstDigit);
                }

                if (firstDigit == 0 || firstDigit == '\0') {
                    for (int fp = 0; fp < fieldPrompts.size(); fp++) {
                        firstDigit = processPromptElementAndGetDigit(fieldPrompts.get(fp), channel, session);
                        if (firstDigit != 0 && firstDigit != '\0') {
                            break;
                        }
                    }
                }

                if (firstDigit == 0 || firstDigit == '\0') {
                    firstDigit = channel.waitForDigit(10000);
                }

                if (firstDigit != 0 && firstDigit != '\0') {
                    if (firstDigit != '#') {
                        inputStr.append(firstDigit);
                    }
                    while (maxLen < 0 || inputStr.length() < maxLen) {
                        char nextDigit = channel.waitForDigit(5000); // 5s timeout between digits
                        if (nextDigit == 0 || nextDigit == '\0' || nextDigit == '#') {
                            break;
                        }
                        inputStr.append(nextDigit);
                    }
                }

                if (inputStr.length() > 0) {
                    String varKey = (fieldName != null && !fieldName.isEmpty()) ? fieldName : "user_input";
                    if (session != null) {
                        session.setVariable(varKey, inputStr.toString());
                        if (session.getTracker() != null) {
                            session.getTracker().addEvent("FIELD_INPUT", inputStr.toString());
                        }
                    }
                    System.out.println("[VxmlAgiHandler] Field " + varKey + " input: " + inputStr.toString());

                    // Run the field's <filled> branch (e.g. confirmation prompt or <goto>)
                    org.w3c.dom.Element followUp = findChildElement(child, "filled");
                    if (followUp != null) {
                        renderFormElement(followUp, channel, session);
                        return true;
                    }
                }
            } else if ("ai".equals(tagName)) {
                String role = child.getAttribute("role");
                String options = child.getAttribute("options");

                String callerLang = resolveSessionLanguage(session);
                String callerLangName = (callerLang != null && callerLang.startsWith("ar")) ? "Arabic" : "English";

                String systemPrompt = role + " You must help the user choose one of these options: " + options + ". " +
                        "If the user's choice is clear, make a final decision immediately without asking for additional confirmation. If their choice is unclear, ask them to clarify. "
                        +
                        "The caller's spoken language is " + callerLangName + ". Always answer the caller in " + callerLangName
                        + ", never in any other language. Keep your reply extremely short and simple. "
                        +
                        "Respond ONLY in valid JSON format: {\"status\": \"CONFIRMING\" or \"FINAL\", \"reply\": \"What you say to user\", \"action\": \"The exact destination ID (the part after the colon) if FINAL\"}";

                String conversationHistory = "";
                boolean isFinal = false;
                String finalAction = null;

                // 1. Play initial prompts inside <ai>
                org.w3c.dom.NodeList aiPrompts = child.getElementsByTagName("prompt");
                for (int p = 0; p < aiPrompts.getLength(); p++) {
                    String text = aiPrompts.item(p).getTextContent().trim();
                    processPromptElement((org.w3c.dom.Element) aiPrompts.item(p), channel, session);
                    if (!text.isEmpty()) {
                        conversationHistory += "AI: " + text + "\n";
                    }
                }

                int silentAttempts = 0;
                int maxAiSilentAttempts = 3;
                while (!isFinal) {
                    // Flush DTMF buffer before beep and recording
                    char flushDigit;
                    do {
                        flushDigit = channel.waitForDigit(10);
                    } while (flushDigit != 0 && flushDigit != '\0');

                    // Beep before recording
                    channel.streamFile("beep");

                    // Record audio in /dev/shm to bypass systemd PrivateTmp isolation
                    String recordPath = "/dev/shm/ai_audio_" + System.currentTimeMillis() + "_"
                            + (int) (Math.random() * 100000);
                    try {
                        // Use 2 seconds for maxSilence so the recording stops shortly after the caller finishes speaking
                        channel.recordFile(recordPath, "wav", "#", 5000, 0, false, 2);

                        // Convert to text
                        String lang = resolveSessionLanguage(session);
                        String text = convertAudioToText(recordPath + ".wav", lang);
                        System.out.println("[VxmlAgiHandler] <ai> User said: " + text);

                        if (text == null || text.trim().isEmpty()) {
                            silentAttempts++;
                            if (silentAttempts >= maxAiSilentAttempts) {
                                speakLocalized(channel, session, "I couldn't hear you. Let's move on.",
                                        "لم أتمكن من سماعك. لننتقل إلى أمر آخر.");
                                break;
                            }
                            speakLocalized(channel, session, "I didn't hear anything. Please try again.",
                                    "لم أسمع شيئاً. يرجى المحاولة مرة أخرى.");
                            continue;
                        }
                        silentAttempts = 0;

                        conversationHistory += "User: " + text + "\n";

                        // Get decision from Ollama
                        com.google.gson.JsonObject llmResponse = OllamaAgent.chatJson(systemPrompt, conversationHistory);
                        String status = llmResponse.has("status") ? llmResponse.get("status").getAsString() : "CONFIRMING";
                        String reply = llmResponse.has("reply") ? llmResponse.get("reply").getAsString()
                                : (callerLangName.equals("Arabic") ? "أنا غير متأكد." : "I am not sure.");

                        System.out.println("[VxmlAgiHandler] <ai> LLM Response: " + llmResponse.toString());

                        if ("FINAL".equalsIgnoreCase(status)) {
                            isFinal = true;
                            finalAction = llmResponse.has("action") ? llmResponse.get("action").getAsString() : null;
                            // Override the LLM's reply for FINAL status to prevent hallucinations
                            // and ensure a smooth, professional transition to the requested form.
                            reply = callerLangName.equals("Arabic") ? "حسناً، لحظة من فضلك." : "Okay, one moment please.";
                        }

                        speakPrompt(channel, reply, session);
                        conversationHistory += "AI: " + reply + "\n";
                    } catch (Exception e) {
                        System.err.println("[VxmlAgiHandler] <ai> interaction failed: " + e.getMessage());
                        speakLocalized(channel, session, "Sorry, I could not understand that. Let's move on.",
                                "عذراً، لم أستطع فهم ذلك. لننتقل إلى أمر آخر.");
                        break;
                    } finally {
                        try {
                            Files.deleteIfExists(Paths.get(recordPath + ".wav"));
                        } catch (Exception ignored) {
                        }
                    }
                }

                if (finalAction != null && !finalAction.trim().isEmpty()) {
                    if (options != null) {
                        for (String opt : options.split(";")) {
                            String[] parts = opt.split(":");
                            if (parts.length == 2 && parts[0].trim().equalsIgnoreCase(finalAction)) {
                                finalAction = parts[1].trim();
                                break;
                            }
                        }
                    }
                    if (finalAction.contains(":")) {
                        finalAction = finalAction.split(":")[1].trim();
                    }
                    System.out.println("[VxmlAgiHandler] <ai> Jumping to dialog: " + finalAction);
                    renderDialogById(form.getOwnerDocument(), finalAction, channel, session);
                    return true;
                } else {
                    System.out.println("[VxmlAgiHandler] <ai> No final action, ending session.");
                    // You could optionally jump to a default form here.
                }
            } else if ("record".equals(tagName)) {
                String recordName = child.getAttribute("name");
                String maxTime = child.getAttribute("maxtime");
                String beep = child.getAttribute("beep");
                String dtmfterm = child.getAttribute("dtmfterm");
                String dest = child.getAttribute("dest");

                System.out.println("[VxmlAgiHandler] <record> Recording started: name=" + recordName
                        + " maxtime=" + maxTime + " beep=" + beep + " dtmfterm=" + dtmfterm);

                String recordPath = "/dev/shm/voicemail_" + System.currentTimeMillis() + "_"
                        + (int) (Math.random() * 100000);
                boolean doBeep = (beep != null && beep.equalsIgnoreCase("true"));

                // Flush DTMF buffer before recording so leftover '#' doesn't instantly abort it
                char flushDigit;
                do {
                    flushDigit = channel.waitForDigit(10);
                } while (flushDigit != 0 && flushDigit != '\0');

                int maxTimeMs = 120000;
                if (maxTime != null && !maxTime.isEmpty()) {
                    try {
                        maxTimeMs = Integer.parseInt(maxTime.replaceAll("[^0-9]", "")) * 1000;
                    } catch (NumberFormatException nfe) {
                        System.err.println("[VxmlAgiHandler] <record> invalid maxtime '" + maxTime
                                + "', defaulting to 120s.");
                    }
                }

                // Use 3 seconds for voicemail maxSilence
                channel.recordFile(recordPath, "wav", "#", maxTimeMs, 0, doBeep, 3);

                String recordedWav = recordPath + ".wav";
                String playableWav = convertToPlayableWav(recordedWav);

                if (session != null && recordName != null && !recordName.isEmpty()) {
                    session.setVariable(recordName, playableWav != null ? playableWav : recordedWav);
                }

                if (dest != null && !dest.isEmpty()) {
                    System.out.println("[VxmlAgiHandler] <record> Saving voicemail to: " + dest);
                }
            } else if ("var".equals(tagName)) {
                String varName = child.getAttribute("name");
                String expr = child.getAttribute("expr");
                if (varName != null && !varName.isEmpty() && expr != null && session != null) {
                    String value = expr;
                    if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length() - 1);
                    }
                    session.setVariable(varName, value);
                    System.out.println("[VxmlAgiHandler] <var> " + varName + " = " + value);
                }
            } else if ("transfer".equals(tagName)) {
                String dest = child.getAttribute("dest");
                if (dest == null || dest.isEmpty()) {
                    dest = child.getAttribute("destexpr");
                }
                dest = substituteVariables(dest != null ? dest : "", session).trim();
                System.out.println("[VxmlAgiHandler] <transfer> to: " + dest);

                if (dest.isEmpty()) {
                    System.out.println("[VxmlAgiHandler] <transfer> has no destination, skipping.");
                    continue;
                }

                String dialTarget = dest;
                if (dialTarget.startsWith("sip:")) {
                    dialTarget = dialTarget.substring(4);
                }
                if (!dialTarget.contains("/") && !dialTarget.contains("@")) {
                    dialTarget = "PJSIP/" + dialTarget;
                }

                boolean answered = false;
                try {
                    channel.exec("Dial", dialTarget, "30000");
                    String dialStatus = channel.getVariable("DIALSTATUS");
                    answered = "ANSWER".equalsIgnoreCase(dialStatus);
                    System.out.println("[VxmlAgiHandler] <transfer> DIALSTATUS: " + dialStatus);
                } catch (Exception e) {
                    System.err.println("[VxmlAgiHandler] <transfer> dial failed: " + e.getMessage());
                }

                org.w3c.dom.Element followUp = null;
                if (answered) {
                    followUp = findChildElement(child, "filled");
                } else {
                    followUp = findChildElement(child, "catch");
                }
                if (followUp != null) {
                    renderFormElement(followUp, channel, session);
                }
                return true;
            } else if ("disconnect".equals(tagName)) {
                System.out.println("[VxmlAgiHandler] <disconnect> hanging up call.");
                channel.hangup();
                return true;
            } else if ("filled".equals(tagName) || "catch".equals(tagName)) {
                renderFormElement(child, channel, session);
            } else if ("if".equals(tagName)) {
                String cond = child.getAttribute("cond");
                boolean result = evaluateCondition(cond, session);
                System.out.println("[VxmlAgiHandler] <if> cond=\"" + cond + "\" => " + result);
                org.w3c.dom.Element branch = findChildElement(child, result ? "then" : "else");
                if (branch != null) {
                    renderFormElement(branch, channel, session);
                }
            } else if ("noinput".equals(tagName) || "nomatch".equals(tagName)) {
                renderFormElement(child, channel, session);
            }
        }
        return false;
    }

    private org.w3c.dom.Element findChildElement(org.w3c.dom.Element parent, String tagName) {
        org.w3c.dom.NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node node = children.item(i);
            if (node.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE
                    && tagName.equals(((org.w3c.dom.Element) node).getTagName())) {
                return (org.w3c.dom.Element) node;
            }
        }
        return null;
    }

    private java.util.List<org.w3c.dom.Element> getDirectChildElements(org.w3c.dom.Element parent, String tagName) {
        java.util.List<org.w3c.dom.Element> result = new java.util.ArrayList<>();
        org.w3c.dom.NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node node = children.item(i);
            if (node.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE
                    && tagName.equals(((org.w3c.dom.Element) node).getTagName())) {
                result.add((org.w3c.dom.Element) node);
            }
        }
        return result;
    }

    /**
     * Evaluates a simple VXML {@code cond} expression such as
     * {@code ${var} == 'value'} or {@code ${var} != ''}. Complex ECMAScript
     * expressions are not supported and evaluate to false.
     */
    private boolean evaluateCondition(String cond, VxmlSession session) {
        if (cond == null || cond.isEmpty()) {
            return false;
        }
        String expr = cond.trim();
        if (expr.contains("${") && session != null) {
            expr = substituteVariables(expr, session);
        }
        expr = expr.replaceAll("^['\"]|['\"]$", "").trim();
        int opIdx = -1;
        String operator = null;
        for (String op : new String[]{"==", "!=", ">=", "<=", ">", "<"}) {
            int idx = expr.indexOf(op);
            if (idx >= 0 && (opIdx < 0 || idx < opIdx)) {
                opIdx = idx;
                operator = op;
            }
        }
        if (operator == null) {
            return !expr.isEmpty() && !"false".equalsIgnoreCase(expr);
        }
        String left = expr.substring(0, opIdx).trim().replaceAll("^['\"]|['\"]$", "");
        String right = expr.substring(opIdx + operator.length()).trim().replaceAll("^['\"]|['\"]$", "");
        try {
            switch (operator) {
                case "==": return left.equals(right);
                case "!=": return !left.equals(right);
                case ">": return Double.parseDouble(left) > Double.parseDouble(right);
                case "<": return Double.parseDouble(left) < Double.parseDouble(right);
                case ">=": return Double.parseDouble(left) >= Double.parseDouble(right);
                case "<=": return Double.parseDouble(left) <= Double.parseDouble(right);
                default: return false;
            }
        } catch (NumberFormatException e) {
            return left.equals(right);
        }
    }

    private String convertAudioToText(String wavFilePath, String langCode) throws Exception {
        String googleLang = "en-US";
        if (langCode != null && langCode.startsWith("ar")) {
            googleLang = "ar-EG";
        } else if (langCode != null && !langCode.trim().isEmpty() && !langCode.equals("en")) {
            googleLang = langCode;
        }

        // Language code is passed as a process argument (no shell/string interpolation)
        String pythonScript = "import speech_recognition as sr\n" +
                "import sys\n" +
                "r = sr.Recognizer()\n" +
                "with sr.AudioFile(sys.argv[1]) as source:\n" +
                "    audio = r.record(source)\n" +
                "try:\n" +
                "    print(r.recognize_google(audio, language=sys.argv[2]))\n" +
                "except Exception as e:\n" +
                "    import traceback\n" +
                "    traceback.print_exc(file=sys.stderr)\n" +
                "    sys.exit(1)\n";

        Path scriptPath = Paths.get("/dev/shm/asr_" + System.currentTimeMillis() + "_" + (int) (Math.random() * 100000) + ".py");
        try {
            Files.writeString(scriptPath, pythonScript);

            ProcessBuilder pb = new ProcessBuilder("python3", scriptPath.toString(), wavFilePath, googleLang);
            pb.redirectErrorStream(true); // capture stderr with stdout
            Process p = pb.start();

            String output;
            try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                output = sb.toString();
            }
            boolean finished = p.waitFor(60, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
            }
            int exitCode = p.exitValue();
            String trimmed = output.trim();

            if (exitCode != 0) {
                System.err
                        .println("[VxmlAgiHandler] Python ASR failed with exit code " + exitCode + ". Output:\n" + trimmed);
                return "";
            }

            return trimmed;
        } finally {
            try {
                Files.deleteIfExists(scriptPath);
            } catch (Exception ignored) {
            }
        }
    }

    private String substituteVariables(String text, VxmlSession session) {
        if (session == null || text == null || !text.contains("${"))
            return text;
        for (Map.Entry<String, Object> entry : session.getAllVariables().entrySet()) {
            String placeholder = "${" + entry.getKey() + "}";
            if (text.contains(placeholder) && entry.getValue() != null) {
                text = text.replace(placeholder, entry.getValue().toString());
            }
        }
        return text;
    }

    private String resolveSessionLanguage(VxmlSession session) {
        if (session != null) {
            Object lang = session.getVariable("language");
            if (lang != null && !lang.toString().trim().isEmpty()) {
                return lang.toString();
            }
        }
        return VxmlConfig.loadFromClasspath().getTtsLanguage();
    }

    /**
     * Converts a recorded WAV (often 16kHz from G.722 channels) to an 8kHz
     * mono PCM WAV that Asterisk's format_wav can play back natively.
     *
     * @param sourceWav full path to the recorded file
     * @return the 8kHz WAV path, or the original path if conversion fails
     */
    private String convertToPlayableWav(String sourceWav) {
        try {
            if (sourceWav == null || !Files.exists(Paths.get(sourceWav))) {
                return sourceWav;
            }
            String targetWav = sourceWav.replaceFirst("\\.wav$", "_8k.wav");
            ProcessBuilder pb = new ProcessBuilder("ffmpeg", "-y", "-loglevel", "error",
                    "-i", sourceWav, "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", targetWav);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            try (java.io.BufferedReader br = new java.io.BufferedReader(
                    new java.io.InputStreamReader(p.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) {
                    System.out.println("[VxmlAgiHandler] ffmpeg: " + line);
                }
            }
            boolean finished = p.waitFor(60, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                return sourceWav;
            }
            if (p.exitValue() == 0 && Files.exists(Paths.get(targetWav))) {
                System.out.println("[VxmlAgiHandler] Recording converted for playback: " + targetWav);
                return targetWav;
            }
            System.err.println("[VxmlAgiHandler] ffmpeg conversion failed (rc=" + p.exitValue() + ") for "
                    + sourceWav + ", keeping original.");
        } catch (Exception e) {
            System.err.println("[VxmlAgiHandler] ffmpeg conversion error for " + sourceWav + ": " + e.getMessage());
        }
        return sourceWav;
    }

    private boolean isLanguageFilterActive(VxmlSession session) {
        if (session == null) {
            return false;
        }
        Object lang = session.getVariable("language");
        return lang != null && !lang.toString().trim().isEmpty();
    }

    private boolean langMatches(String xmlLang, String sessionLang) {
        if (xmlLang == null || xmlLang.trim().isEmpty()) {
            return true;
        }
        if (sessionLang == null || sessionLang.trim().isEmpty()) {
            return true;
        }
        String a = xmlLang.trim().toLowerCase();
        String b = sessionLang.trim().toLowerCase();
        if (a.startsWith("ar") && b.startsWith("ar")) {
            return true;
        }
        if (a.startsWith("ar") || b.startsWith("ar")) {
            return false;
        }
        return a.startsWith("en") && b.startsWith("en") || a.equals(b);
    }

    private boolean promptShouldSpeak(org.w3c.dom.Element promptElement, String promptLang, VxmlSession session) {
        String xmlLang = promptElement.getAttribute("xml:lang");
        if (xmlLang != null && !xmlLang.trim().isEmpty() && isLanguageFilterActive(session)) {
            if (!langMatches(xmlLang, resolveSessionLanguage(session))) {
                System.out.println("[VxmlAgiHandler] Skipping prompt (xml:lang=" + xmlLang
                        + ", session language=" + resolveSessionLanguage(session) + ")");
                return false;
            }
        }
        return true;
    }

    private boolean audioShouldSpeak(String audioLang, VxmlSession session) {
        if (audioLang == null || audioLang.trim().isEmpty() || !isLanguageFilterActive(session)) {
            return true;
        }
        return langMatches(audioLang, resolveSessionLanguage(session));
    }

    private char speakPromptAndGetDigit(AgiChannel channel, String text, VxmlSession session) {
        return speakPromptAndGetDigit(channel, text, session, resolveSessionLanguage(session));
    }

    private char speakPromptAndGetDigit(AgiChannel channel, String text, VxmlSession session, String lang) {
        if (text == null || text.trim().isEmpty()) {
            return 0;
        }
        text = substituteVariables(text, session);
        try {
            System.out.println("[VxmlAgiHandler] Speaking prompt with DTMF listen: " + text);
            String streamPath = TtsEngine.getOrSynthesizeAudio(text, lang);
            if (streamPath != null) {
                char digit = channel.streamFile(streamPath, "0123456789*#");
                if (digit != 0 && digit != '\0') {
                    System.out.println("[VxmlAgiHandler] DTMF keypress during audio playback: " + digit);
                    return digit;
                }
            }
        } catch (Exception e) {
            System.err.println("[VxmlAgiHandler] Audio playback exception: " + e.getMessage());
        }
        return 0;
    }

    private void speakPrompt(AgiChannel channel, String text, VxmlSession session) {
        speakPrompt(channel, text, session, resolveSessionLanguage(session));
    }

    private void speakPrompt(AgiChannel channel, String text, VxmlSession session, String lang) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }
        text = substituteVariables(text, session);
        try {
            System.out.println("[VxmlAgiHandler] Speaking prompt: " + text);
            TtsEngine.sayText(channel, text, lang);
        } catch (Exception e) {
            System.err.println("[VxmlAgiHandler] Audio playback exception: " + e.getMessage());
        }
    }

    /**
     * Speaks a bilingual message choosing EN/AR text based on the session language.
     */
    private void speakLocalized(AgiChannel channel, VxmlSession session, String enText, String arText) {
        String lang = resolveSessionLanguage(session);
        boolean arabic = lang != null && lang.startsWith("ar");
        speakPrompt(channel, arabic ? arText : enText, session, arabic ? lang : null);
    }

    /**
     * Processes a {@code <prompt>} element, handling both plain text and {@code <audio>} tags.
     *
     * <p>VXML usage:</p>
     * <pre>{@code
     * <prompt>
     *   <audio src="welcome.wav">Fallback TTS text if file not found</audio>
     *   Additional text rendered via TTS.
     * </prompt>
     * }</pre>
     *
     * <p>Audio files are resolved from {@code /var/lib/asterisk/sounds/ivr-custom/}.
     * If the audio file is not found, the inner text of the {@code <audio>} tag is
     * used as fallback for TTS synthesis.</p>
     *
     * @param promptElement the {@code <prompt>} DOM element
     * @param channel       Asterisk AGI channel for audio playback
     * @param session       current VXML session for variable substitution
     */
    private void processPromptElement(org.w3c.dom.Element promptElement, AgiChannel channel, VxmlSession session) {
        String promptLang = promptElement.getAttribute("xml:lang");
        if (promptLang == null || promptLang.trim().isEmpty()) {
            promptLang = resolveSessionLanguage(session);
        }

        if (!promptShouldSpeak(promptElement, promptLang, session)) {
            return;
        }

        org.w3c.dom.NodeList children = promptElement.getChildNodes();
        StringBuilder textBuffer = new StringBuilder();

        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node child = children.item(i);

            if (child.getNodeType() == org.w3c.dom.Node.TEXT_NODE) {
                textBuffer.append(child.getTextContent());
            } else if (child.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE
                    && "audio".equals(child.getNodeName())) {
                // Flush any accumulated text before playing audio
                String accumulatedText = textBuffer.toString().trim();
                if (!accumulatedText.isEmpty()) {
                    speakPrompt(channel, accumulatedText, session, promptLang);
                    textBuffer.setLength(0);
                }

                org.w3c.dom.Element audioEl = (org.w3c.dom.Element) child;
                String audioLang = audioEl.getAttribute("xml:lang");
                if (audioLang == null || audioLang.trim().isEmpty()) {
                    audioLang = promptLang;
                }

                if (!audioShouldSpeak(audioLang, session)) {
                    System.out.println("[VxmlAgiHandler] Skipping audio element (xml:lang=" + audioLang + ")");
                    continue;
                }

                String src = audioEl.getAttribute("src");
                if (src != null && session != null) {
                    src = substituteVariables(src, session);
                }
                String streamPath = TtsEngine.resolveAudioSrc(src);

                if (streamPath != null) {
                    try {
                        System.out.println("[VxmlAgiHandler] Playing custom audio: " + streamPath);
                        channel.streamFile(streamPath);
                    } catch (Exception e) {
                        System.err.println("[VxmlAgiHandler] Error playing custom audio '" + src + "': " + e.getMessage());
                    }
                } else {
                    // Fallback: use inner text content for TTS
                    String fallbackText = audioEl.getTextContent().trim();
                    if (!fallbackText.isEmpty()) {
                        System.out.println("[VxmlAgiHandler] Audio file not found, using TTS fallback for: " + src);
                        speakPrompt(channel, fallbackText, session, audioLang);
                    } else {
                        System.err.println("[VxmlAgiHandler] <audio src=\"" + src + "\"> not found and no fallback text");
                    }
                }
            }
        }

        // Flush remaining text
        String remainingText = textBuffer.toString().trim();
        if (!remainingText.isEmpty()) {
            speakPrompt(channel, remainingText, session, promptLang);
        }
    }

    /**
     * Processes a {@code <prompt>} element with DTMF listening,
     * handling both plain text and {@code <audio>} tags.
     *
     * <p>Returns the first DTMF digit pressed during any segment of the prompt.
     * Each segment (text or audio) is played with DTMF interruptibility.</p>
     *
     * @param promptElement the {@code <prompt>} DOM element
     * @param channel       Asterisk AGI channel for audio playback
     * @param session       current VXML session for variable substitution
     * @return the DTMF digit pressed, or 0 if no digit was pressed
     */
    private char processPromptElementAndGetDigit(org.w3c.dom.Element promptElement, AgiChannel channel, VxmlSession session) {
        String promptLang = promptElement.getAttribute("xml:lang");
        if (promptLang == null || promptLang.trim().isEmpty()) {
            promptLang = resolveSessionLanguage(session);
        }

        if (!promptShouldSpeak(promptElement, promptLang, session)) {
            return 0;
        }

        org.w3c.dom.NodeList children = promptElement.getChildNodes();
        StringBuilder textBuffer = new StringBuilder();

        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node child = children.item(i);

            if (child.getNodeType() == org.w3c.dom.Node.TEXT_NODE) {
                textBuffer.append(child.getTextContent());
            } else if (child.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE
                    && "audio".equals(child.getNodeName())) {
                // Flush any accumulated text before playing audio
                String accumulatedText = textBuffer.toString().trim();
                if (!accumulatedText.isEmpty()) {
                    char digit = speakPromptAndGetDigit(channel, accumulatedText, session, promptLang);
                    if (digit != 0 && digit != '\0') return digit;
                    textBuffer.setLength(0);
                }

                org.w3c.dom.Element audioEl = (org.w3c.dom.Element) child;
                String audioLang = audioEl.getAttribute("xml:lang");
                if (audioLang == null || audioLang.trim().isEmpty()) {
                    audioLang = promptLang;
                }

                if (!audioShouldSpeak(audioLang, session)) {
                    System.out.println("[VxmlAgiHandler] Skipping audio element (xml:lang=" + audioLang + ")");
                    continue;
                }

                String src = audioEl.getAttribute("src");
                if (src != null && session != null) {
                    src = substituteVariables(src, session);
                }
                String streamPath = TtsEngine.resolveAudioSrc(src);

                if (streamPath != null) {
                    try {
                        System.out.println("[VxmlAgiHandler] Playing custom audio (DTMF-aware): " + streamPath);
                        char digit = channel.streamFile(streamPath, "0123456789*#");
                        if (digit != 0 && digit != '\0') return digit;
                    } catch (Exception e) {
                        System.err.println("[VxmlAgiHandler] Error playing custom audio '" + src + "': " + e.getMessage());
                    }
                } else {
                    // Fallback: use inner text content for TTS
                    String fallbackText = audioEl.getTextContent().trim();
                    if (!fallbackText.isEmpty()) {
                        System.out.println("[VxmlAgiHandler] Audio file not found, using TTS fallback for: " + src);
                        char digit = speakPromptAndGetDigit(channel, fallbackText, session, audioLang);
                        if (digit != 0 && digit != '\0') return digit;
                    } else {
                        System.err.println("[VxmlAgiHandler] <audio src=\"" + src + "\"> not found and no fallback text");
                    }
                }
            }
        }

        // Flush remaining text
        String remainingText = textBuffer.toString().trim();
        if (!remainingText.isEmpty()) {
            return speakPromptAndGetDigit(channel, remainingText, session, promptLang);
        }

        return 0;
    }

    /**
     * Renders a standalone {@code <audio>} element that appears outside a
     * {@code <prompt>} (e.g. a recorded message replay inside a {@code <then>}).
     * Supports session-variable substitution in the {@code src} attribute and a
     * TTS fallback via the element's text content.
     */
    private void renderAudioElement(org.w3c.dom.Element audioEl, AgiChannel channel, VxmlSession session) {
        String audioLang = audioEl.getAttribute("xml:lang");
        if (audioLang == null || audioLang.trim().isEmpty()) {
            audioLang = resolveSessionLanguage(session);
        }

        if (!audioShouldSpeak(audioLang, session)) {
            System.out.println("[VxmlAgiHandler] Skipping audio element (xml:lang=" + audioLang + ")");
            return;
        }

        String src = audioEl.getAttribute("src");
        if (src != null && session != null) {
            src = substituteVariables(src, session);
        }

        String streamPath = TtsEngine.resolveAudioSrc(src);
        if (streamPath != null) {
            try {
                System.out.println("[VxmlAgiHandler] Playing custom audio: " + streamPath);
                channel.streamFile(streamPath);
            } catch (Exception e) {
                System.err.println("[VxmlAgiHandler] Error playing custom audio '" + src + "': " + e.getMessage());
            }
        } else {
            String fallbackText = audioEl.getTextContent().trim();
            if (!fallbackText.isEmpty()) {
                System.out.println("[VxmlAgiHandler] Audio file not found, using TTS fallback for: " + src);
                speakPrompt(channel, fallbackText, session, audioLang);
            } else {
                System.err.println("[VxmlAgiHandler] <audio src=\"" + src + "\"> not found and no fallback text");
            }
        }
    }

    /**
     * Sets Asterisk variables with VXML execution results.
     */
    private void setAsteriskVariables(AgiChannel channel, VxmlSession vxmlSession)
            throws AgiException {

        if (vxmlSession == null) {
            return;
        }

        try {
            channel.setVariable("VXML_SESSION_ID", vxmlSession.getSessionId());
            channel.setVariable("VXML_STATE", vxmlSession.getState().toString());

            if (vxmlSession.getLastError() != null) {
                channel.setVariable("VXML_ERROR", vxmlSession.getLastError());
            }

            for (Map.Entry<String, Object> entry : vxmlSession.getAllVariables().entrySet()) {
                String key = "VXML_RESULT_" + entry.getKey();
                String value = entry.getValue() != null ? entry.getValue().toString() : "";
                channel.setVariable(key, value);
                System.out.println("[VxmlAgiHandler] Set: " + key + " = " + value);
            }

            System.out.println("[VxmlAgiHandler] Asterisk variables set successfully");

        } catch (AgiException e) {
            System.err.println("[VxmlAgiHandler] Error setting Asterisk variables: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Handles post-execution logic.
     */
    private void handlePostExecution(AgiChannel channel, VxmlSession vxmlSession)
            throws AgiException {
        if (vxmlSession == null) {
            return;
        }

        switch (vxmlSession.getState()) {
            case COMPLETED:
                System.out.println("[VxmlAgiHandler] VXML scenario completed successfully");
                break;

            case ERROR:
                System.err.println("[VxmlAgiHandler] VXML scenario ended with error: " + vxmlSession.getLastError());
                break;

            case TIMEOUT:
                System.err.println("[VxmlAgiHandler] VXML scenario timed out");
                break;

            default:
                System.out.println("[VxmlAgiHandler] VXML scenario state: " + vxmlSession.getState());
        }
    }

    /**
     * Handles execution errors gracefully.
     *
     * @param channel   AGI channel
     * @param sessionId session identifier
     * @param error     exception that occurred
     */
    private void handleError(AgiChannel channel, String sessionId, Exception error) {
        try {
            System.err.println("[VxmlAgiHandler] Handling error for session: " + sessionId);
            System.err.println("[VxmlAgiHandler] Error: " + error.getMessage());
            error.printStackTrace();

            // Set error variables
            channel.setVariable("VXML_SESSION_ID", sessionId != null ? sessionId : "unknown");
            channel.setVariable("VXML_STATE", "ERROR");
            channel.setVariable("VXML_ERROR", error.getMessage());

            // Play error message
            try {
                channel.streamFile("vm-goodbye");
            } catch (AgiException e) {
                System.err.println("[VxmlAgiHandler] Could not play error message: " + e.getMessage());
            }
        } catch (Exception e) {
            System.err.println("[VxmlAgiHandler] Error handling failed: " + e.getMessage());
        }
    }

    /**
     * Shuts down the shared VXML engine.
     *
     * Call this when the application is shutting down.
     */
    public static void shutdownEngine() {
        synchronized (ENGINE_LOCK) {
            if (vxmlEngine != null) {
                try {
                    System.out.println("[VxmlAgiHandler] Shutting down VXML engine...");
                    vxmlEngine.shutdown();
                    vxmlEngine = null;
                    System.out.println("[VxmlAgiHandler] VXML engine shut down successfully");
                } catch (Exception e) {
                    System.err.println("[VxmlAgiHandler] Error shutting down engine: " + e.getMessage());
                }
            }
        }
    }
}
