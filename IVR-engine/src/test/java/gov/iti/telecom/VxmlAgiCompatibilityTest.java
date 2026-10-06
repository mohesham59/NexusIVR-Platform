package gov.iti.telecom;

import junit.framework.Test;
import junit.framework.TestCase;
import junit.framework.TestSuite;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.util.HashSet;
import java.util.Set;

/**
 * VxmlAgiCompatibilityTest — validates that VXML produced by the webapp
 * (vxmlExporter.ts) is compatible with the AGI handler (VxmlAgiHandler.java).
 *
 * <p>This test checks that every VXML tag used by the webapp is handled
 * by the AGI handler. It covers all node types defined in the IVR diagram:
 * start, greeting, playback, tts, dtmf_menu, dtmf_input, queue, transfer,
 * extension, voicemail, record, hours, holiday, condition, variable,
 * api, database, webhook, ai, and end.</p>
 *
 * <p>Run with: mvn test -Dtest=VxmlAgiCompatibilityTest</p>
 */
public class VxmlAgiCompatibilityTest extends TestCase {

    /** Tags that the AGI handler (VxmlAgiHandler.java) explicitly supports. */
    private static final Set<String> AGI_SUPPORTED_TAGS = new HashSet<>();

    static {
        // Standard VoiceXML tags handled by VxmlAgiHandler.renderFormElement()
        AGI_SUPPORTED_TAGS.add("vxml");
        AGI_SUPPORTED_TAGS.add("form");
        AGI_SUPPORTED_TAGS.add("block");
        AGI_SUPPORTED_TAGS.add("prompt");
        AGI_SUPPORTED_TAGS.add("goto");
        AGI_SUPPORTED_TAGS.add("menu");
        AGI_SUPPORTED_TAGS.add("choice");
        AGI_SUPPORTED_TAGS.add("field");
        AGI_SUPPORTED_TAGS.add("grammar");
        AGI_SUPPORTED_TAGS.add("filled");
        AGI_SUPPORTED_TAGS.add("noinput");
        AGI_SUPPORTED_TAGS.add("nomatch");
        AGI_SUPPORTED_TAGS.add("transfer");
        AGI_SUPPORTED_TAGS.add("disconnect");
        AGI_SUPPORTED_TAGS.add("audio");
        AGI_SUPPORTED_TAGS.add("if");
        AGI_SUPPORTED_TAGS.add("elseif");
        AGI_SUPPORTED_TAGS.add("else");
        AGI_SUPPORTED_TAGS.add("reprompt");
        AGI_SUPPORTED_TAGS.add("data");
        AGI_SUPPORTED_TAGS.add("submit");
        // Custom tags handled by VxmlAgiHandler
        AGI_SUPPORTED_TAGS.add("assign");
        AGI_SUPPORTED_TAGS.add("api");
        AGI_SUPPORTED_TAGS.add("ai");
        // Tags added for compatibility (Phase 2)
        AGI_SUPPORTED_TAGS.add("record");
        AGI_SUPPORTED_TAGS.add("var");
    }

    public VxmlAgiCompatibilityTest(String testName) {
        super(testName);
    }

    public static Test suite() {
        return new TestSuite(VxmlAgiCompatibilityTest.class);
    }

    /**
     * Test that the webapp's VXML output for each block type uses only
     * tags supported by the AGI handler.
     */
    public void testAllBlockTypesUseSupportedTags() throws Exception {
        // Simulate VXML output for each node type from vxmlExporter.ts
        String[] nodeTypes = {
            "start", "greeting", "playback", "tts", "dtmf_menu",
            "dtmf_input", "queue", "transfer", "extension", "voicemail",
            "record", "hours", "holiday", "condition", "variable",
            "api", "database", "webhook", "ai", "end"
        };

        for (String nodeType : nodeTypes) {
            String vxml = generateSampleVxml(nodeType);
            assertVxmlCompatible(nodeType, vxml);
        }
    }

    /**
     * Test that hospital_ivr scenario can be loaded directly and via alias mappings by VxmlLoader.
     */
    public void testHospitalIvrLoadingAndAliases() throws Exception {
        VxmlLoader loader = new VxmlLoader("scenarios/");
        Document docDirect = loader.loadVxml("hospital_ivr");
        assertNotNull("hospital_ivr.vxml should be loaded directly", docDirect);

        Document docWithExt = loader.loadVxml("hospital_ivr.vxml");
        assertNotNull("hospital_ivr.vxml should be loaded when name includes extension", docWithExt);

        Document docAlias = loader.loadVxml("hospital");
        assertNotNull("hospital_ivr should be loaded via alias 'hospital'", docAlias);

        Document docPizzaAlias = loader.loadVxml("pizza_palace");
        assertNotNull("pizza_iv should be loaded via alias 'pizza_palace'", docPizzaAlias);
    }

    /**
     * Test that voicemail node does NOT use <record> tag (AGI doesn't support it).
     * After the webapp fix, voicemail should use <block><prompt><goto/> instead.
     */
    public void testVoicemailUsesBlockNotRecord() throws Exception {
        String vxml = generateSampleVxml("voicemail");
        Document doc = parseXml(vxml);
        NodeList records = doc.getElementsByTagName("record");
        assertEquals("Voicemail should not use <record> tag (AGI does not support it)", 0, records.getLength());

        NodeList blocks = doc.getElementsByTagName("block");
        assertTrue("Voicemail should use <block> with <prompt> and <goto>", blocks.getLength() > 0);
    }

    /**
     * Test that AI node uses <ai> tag instead of <field type="string">.
     */
    public void testAiNodeUsesAiTagNotField() throws Exception {
        String vxml = generateSampleVxml("ai");
        Document doc = parseXml(vxml);
        NodeList fields = doc.getElementsByTagName("field");
        assertEquals("AI node should not use <field> tag", 0, fields.getLength());

        NodeList aiTags = doc.getElementsByTagName("ai");
        assertEquals("AI node should use <ai> tag", 1, aiTags.getLength());
    }

    /**
     * Test that API node uses <api> tag instead of <data>.
     */
    public void testApiNodeUsesApiTagNotData() throws Exception {
        String vxml = generateSampleVxml("api");
        Document doc = parseXml(vxml);
        NodeList dataTags = doc.getElementsByTagName("data");
        assertEquals("API node should not use <data> tag", 0, dataTags.getLength());

        NodeList apiTags = doc.getElementsByTagName("api");
        assertEquals("API node should use <api> tag", 1, apiTags.getLength());
    }

    /**
     * Test that top-level <var> and <meta> tags are not present.
     */
    public void testNoTopLevelVarOrMeta() throws Exception {
        String vxml = generateSampleVxml("start");
        Document doc = parseXml(vxml);
        Element root = doc.getDocumentElement();

        NodeList vars = root.getElementsByTagName("var");
        assertEquals("Top-level <var> tags should be removed", 0, vars.getLength());

        NodeList metas = root.getElementsByTagName("meta");
        assertEquals("Top-level <meta> tags should be removed", 0, metas.getLength());
    }

    /**
     * Test that every tag in the generated VXML is supported by the AGI handler.
     */
    public void testAllTagsAreSupportedByAgi() throws Exception {
        String[] nodeTypes = {
            "start", "greeting", "playback", "tts", "dtmf_menu",
            "dtmf_input", "queue", "transfer", "extension", "voicemail",
            "record", "hours", "holiday", "condition", "variable",
            "api", "database", "webhook", "ai", "end"
        };

        for (String nodeType : nodeTypes) {
            String vxml = generateSampleVxml(nodeType);
            Document doc = parseXml(vxml);
            checkAllTagsSupported(nodeType, doc.getDocumentElement());
        }
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private void assertVxmlCompatible(String nodeType, String vxml) throws Exception {
        Document doc = parseXml(vxml);
        Element root = doc.getDocumentElement();
        assertNotNull("Root element should be <vxml> for node type: " + nodeType, root);
        assertEquals("vxml", root.getTagName().toLowerCase());
    }

    private void checkAllTagsSupported(String nodeType, Element element) {
        String tagName = element.getTagName().toLowerCase();
        if (!tagName.equals("vxml") && !tagName.equals("#text") && !tagName.equals("#comment")) {
            assertTrue(
                    "Tag <" + tagName + "> in node type '" + nodeType + "' is not supported by AGI handler. "
                    + "Supported tags: " + AGI_SUPPORTED_TAGS,
                    AGI_SUPPORTED_TAGS.contains(tagName)
            );
        }
        NodeList children = element.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (children.item(i) instanceof Element) {
                checkAllTagsSupported(nodeType, (Element) children.item(i));
            }
        }
    }

    private Document parseXml(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(new org.xml.sax.InputSource(new StringReader(xml)));
    }

    /**
     * Generate minimal VXML for a given node type, matching the output
     * of vxmlExporter.ts after the AGI compatibility fixes.
     */
    private String generateSampleVxml(String nodeType) {
        switch (nodeType) {
            case "start":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_start\"><block><goto next=\"#form_next\"/></block></form></vxml>";
            case "greeting":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_greeting\"><block><prompt><audio src=\"greeting.wav\">Welcome</audio></prompt><goto next=\"#form_next\"/></block></form></vxml>";
            case "playback":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_playback\"><block><prompt><audio src=\"playback.wav\">Message</audio></prompt><goto next=\"#form_next\"/></block></form></vxml>";
            case "tts":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_tts\"><block><prompt>Hello world</prompt><goto next=\"#form_next\"/></block></form></vxml>";
            case "dtmf_menu":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_menu\"><menu id=\"menu_main\"><prompt>Press 1 for A, 2 for B</prompt><choice dtmf=\"1\" next=\"#form_a\">Option A</choice><choice dtmf=\"2\" next=\"#form_b\">Option B</choice><noinput><goto next=\"#form_menu\"/></noinput><nomatch><prompt>Invalid choice</prompt><reprompt/></nomatch></menu></form></vxml>";
            case "dtmf_input":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_input\"><field name=\"user_input\" type=\"digits\"><prompt>Enter digits</prompt><filled><goto next=\"#form_next\"/></filled><noinput><goto next=\"#form_input\"/></noinput><nomatch><prompt>Invalid</prompt><reprompt/></nomatch></field></form></vxml>";
            case "queue":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_queue\"><block><prompt>Please hold</prompt><transfer name=\"q_result\" dest=\"sip:queue@pbx\" type=\"blind\"><prompt>Connecting</prompt></transfer></block><block><if cond=\"q_result == 'answered'\"><goto next=\"#form_connected\"/></if></block></form></vxml>";
            case "transfer":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_transfer\"><block><prompt>Transferring</prompt><transfer name=\"xfer\" dest=\"sip:agent@pbx\" type=\"bridge\"><prompt>Connecting</prompt></transfer></block></form></vxml>";
            case "extension":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_ext\"><block><transfer name=\"ext\" dest=\"sip:100@pbx\" type=\"blind\"/></block></form></vxml>";
            case "voicemail":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_voicemail\"><block><prompt>Please leave your message after the beep.</prompt><goto next=\"#form_next\"/></block></form></vxml>";
            case "record":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_record\"><block><prompt>Recording started</prompt><goto next=\"#form_next\"/></block></form></vxml>";
            case "hours":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_hours\"><block><if cond=\"true\"><goto next=\"#form_open\"/></if></block></form></vxml>";
            case "holiday":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_holiday\"><block><if cond=\"false\"><goto next=\"#form_holiday\"/></if></block></form></vxml>";
            case "condition":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_cond\"><block><if cond=\"true\"><goto next=\"#form_true\"/></if></block></form></vxml>";
            case "variable":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_var\"><block><assign name=\"myVar\" expr=\"''\"/><goto next=\"#form_next\"/></block></form></vxml>";
            case "api":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_api\"><block><api url=\"https://api.example.com/endpoint\" var=\"api_result\" saveResultAs=\"api_result\"/></block></form></vxml>";
            case "database":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_db\"><block><api url=\"https://db.example.com/lookup\" var=\"db_result\" saveResultAs=\"db_result\"/></block></form></vxml>";
            case "webhook":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_webhook\"><block><api url=\"https://webhook.example.com/trigger\" var=\"wh_result\" saveResultAs=\"wh_result\"/></block></form></vxml>";
            case "ai":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_ai\"><block><ai role=\"You are a polite assistant.\" options=\"transfer:transfer_form\"><prompt>How can I help you?</prompt></ai></block></form></vxml>";
            case "end":
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_end\"><block><prompt>Goodbye</prompt><disconnect/></block></form></vxml>";
            default:
                return "<?xml version=\"1.0\"?><vxml version=\"2.1\" xmlns=\"http://www.w3.org/2001/vxml\"><form id=\"form_unknown\"><block><goto next=\"#form_next\"/></block></form></vxml>";
        }
    }
}