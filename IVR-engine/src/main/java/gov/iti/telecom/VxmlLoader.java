package gov.iti.telecom;

import org.w3c.dom.Document;
import org.xml.sax.SAXException;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * VxmlLoader — responsible for discovering, loading, and caching VXML files.
 *
 * <h2>HOW IT WORKS</h2>
 * <ol>
 *   <li>Discovers .vxml files in a configured resource directory (default: "scenarios/")</li>
 *   <li>Parses XML into W3C DOM documents for programmatic access</li>
 *   <li>Caches loaded documents to avoid repeated file I/O</li>
 *   <li>Provides thread-safe concurrent access via ConcurrentHashMap</li>
 *   <li>Supports loading from both filesystem and classpath</li>
 * </ol>
 *
 * <h2>USAGE EXAMPLE</h2>
 * <pre>{@code
 * VxmlLoader loader = new VxmlLoader("scenarios/");
 *
 * // Load a VXML document
 * Document helloDoc = loader.loadVxml("hello");
 *
 * // List available VXML files
 * List<String> scenarios = loader.listAvailableVxml();
 * System.out.println("Available: " + scenarios);
 *
 * // Get URI for a VXML (useful for JVoiceXML)
 * URI uri = loader.getVxmlUri("hello");
 * }</pre>
 *
 * <h2>THREAD SAFETY</h2>
 * <ul>
 *   <li>All public methods are thread-safe.</li>
 *   <li>Internal cache uses ConcurrentHashMap to avoid synchronized blocks.</li>
 *   <li>XML parsing is thread-local (DocumentBuilder is not shared).</li>
 *   <li>Safe for concurrent calls from multiple threads without external locking.</li>
 * </ul>
 *
 * <h2>RESOURCE DISCOVERY</h2>
 * <p>The loader searches for .vxml files in this order:</p>
 * <ol>
 *   <li>File system: {resourcePath}/{vxmlName}.vxml</li>
 *   <li>Classpath: classpath:{resourcePath}/{vxmlName}.vxml</li>
 * </ol>
 *
 * @author IVR Platform Team
 * @version 1.0
 * @see VxmlValidator
 * @see VxmlScenarioEngine
 */
public class VxmlLoader {

    private static final String VXML_NAMESPACE = "http://www.w3.org/2001/vxml";
    private static final String VXML_EXTENSION = ".vxml";

    // Cache: VXML name -> parsed DOM document (thread-safe)
    private final ConcurrentHashMap<String, Document> documentCache = new ConcurrentHashMap<>();

    // Directory where VXML files are located
    private final Path resourcePath;

    // Enable/disable caching (useful for development)
    private boolean cachingEnabled = true;

    /**
     * Creates a loader that reads VXML files from the specified directory.
     *
     * @param resourcePathStr the path to the directory containing VXML files (e.g., "scenarios/")
     *                        Can be relative or absolute.
     * @throws NullPointerException if resourcePathStr is null
     */
    public VxmlLoader(String resourcePathStr) {
        if (resourcePathStr == null) {
            throw new NullPointerException("Resource path cannot be null");
        }
        this.resourcePath = Paths.get(resourcePathStr);
        System.out.println("[VxmlLoader] Initialized with resource path: " +
                this.resourcePath.toAbsolutePath());
    }

    /**
     * Loads and returns a parsed VXML document by name.
     *
     * <p>If the VXML was already loaded before, returns the cached copy (if caching is enabled).
     * If this is the first request, reads the file from disk and caches it for future use.</p>
     *
     * @param vxmlName the VXML file name without extension (e.g., "hello" for "hello.vxml")
     * @return a parsed W3C DOM Document representing the VXML
     * @throws IOException if the file cannot be read
     * @throws SAXException if the XML is malformed
     * @throws RuntimeException if the VXML file cannot be found in any search location
     *
     * @see #getVxmlUri(String)
     * @see #loadVxmlFromPath(Path)
     */
    public Document loadVxml(String vxmlName) throws IOException, SAXException {
        if (vxmlName == null || vxmlName.isEmpty()) {
            throw new IllegalArgumentException("VXML name cannot be null or empty");
        }

        String cleanName = cleanVxmlName(vxmlName);

        // Return cached copy if available and caching is enabled
        if (cachingEnabled) {
            Document cached = documentCache.get(cleanName);
            if (cached != null) {
                System.out.println("[VxmlLoader] Returning cached VXML: " + cleanName);
                return cached;
            }
        }

        // Load from file system
        Path filePath = resolveVxmlPath(cleanName);
        if (filePath != null && Files.exists(filePath)) {
            System.out.println("[VxmlLoader] Loading VXML from file: " + filePath.toAbsolutePath());
            Document doc = loadVxmlFromPath(filePath);
            if (cachingEnabled) {
                documentCache.put(cleanName, doc);
            }
            return doc;
        }

        // Load from classpath as fallback
        String resourceDir = resourcePath.toString().replace("\\", "/");
        if (resourceDir.endsWith("/")) {
            resourceDir = resourceDir.substring(0, resourceDir.length() - 1);
        }
        String classpathResource = resourceDir + "/" + cleanName + VXML_EXTENSION;
        InputStream inputStream = getClass().getClassLoader()
                .getResourceAsStream(classpathResource);
        if (inputStream != null) {
            System.out.println("[VxmlLoader] Loading VXML from classpath: " + classpathResource);
            Document doc = loadVxmlFromInputStream(inputStream, classpathResource);
            if (cachingEnabled) {
                documentCache.put(cleanName, doc);
            }
            return doc;
        }

        // Not found anywhere
        Path expectedPath = resourcePath.resolve(cleanName + VXML_EXTENSION);
        throw new RuntimeException(
                "VXML file not found: " + cleanName + VXML_EXTENSION +
                        " (searched: " + expectedPath.toAbsolutePath() + ", classpath:" + classpathResource + ")");
    }

    private String cleanVxmlName(String name) {
        if (name == null) return "hello";
        String trimmed = name.trim();
        if (trimmed.contains("?")) {
            trimmed = trimmed.substring(0, trimmed.indexOf('?'));
        }
        if (trimmed.toLowerCase().endsWith(".vxml")) {
            trimmed = trimmed.substring(0, trimmed.length() - 5);
        } else if (trimmed.toLowerCase().endsWith(".json")) {
            trimmed = trimmed.substring(0, trimmed.length() - 5);
        }
        return trimmed;
    }

    private Path resolveVxmlPath(String cleanName) {
        Path direct = resourcePath.resolve(cleanName + VXML_EXTENSION);
        if (Files.exists(direct)) {
            return direct;
        }
        String alias = resolveScenarioAlias(cleanName);
        if (alias != null) {
            Path aliasPath = resourcePath.resolve(alias + VXML_EXTENSION);
            if (Files.exists(aliasPath)) {
                return aliasPath;
            }
        }
        // Try hyphen to underscore conversion or vice versa
        String altName = cleanName.contains("-") ? cleanName.replace('-', '_') : cleanName.replace('_', '-');
        Path altPath = resourcePath.resolve(altName + VXML_EXTENSION);
        if (Files.exists(altPath)) {
            return altPath;
        }
        return null;
    }

    private String resolveScenarioAlias(String name) {
        if (name == null) return null;
        switch (name.toLowerCase()) {
            case "pizza_palace":
            case "pizza_palace_vxml":
            case "pizza":
                return "pizza_iv";
            case "charging":
                return "pizza_iv";
            case "hospital":
            case "hospital_main":
            case "hospital_ivr_main":
                return "hospital_ivr";
            case "healthcare":
            case "health":
                return "healthcare_iv";
            case "telecom":
                return "telecom_iv";
            case "banking":
                return "banking_iv";
            default:
                return null;
        }
    }

    /**
     * Loads a VXML document from a file path.
     *
     * @param filePath the path to the VXML file
     * @return a parsed DOM Document
     * @throws IOException if the file cannot be read
     * @throws SAXException if the XML is malformed
     */
    private Document loadVxmlFromPath(Path filePath) throws IOException, SAXException {
        try (InputStream inputStream = Files.newInputStream(filePath)) {
            return loadVxmlFromInputStream(inputStream, filePath.toString());
        }
    }

    /**
     * Loads a VXML document from an input stream.
     *
     * @param inputStream the stream to read from
     * @param source      descriptive source name (for logging)
     * @return a parsed DOM Document
     * @throws IOException if the stream cannot be read
     * @throws SAXException if the XML is malformed
     */
    private Document loadVxmlFromInputStream(InputStream inputStream, String source)
            throws IOException, SAXException {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);

            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(inputStream);
            System.out.println("[VxmlLoader] Successfully parsed VXML from: " + source);
            return doc;
        } catch (ParserConfigurationException e) {
            throw new RuntimeException("XML parser configuration error", e);
        }
    }

    /**
     * Lists all available VXML files in the resource directory.
     *
     * @return a list of VXML names (without extension) available to load
     * @throws RuntimeException if the resource directory cannot be accessed
     *
     * @example
     * <pre>{@code
     * List<String> scenarios = loader.listAvailableVxml();
     * // Returns: ["hello", "menu-example", "transfer-example"]
     * }</pre>
     */
    public List<String> listAvailableVxml() {
        List<String> vxmlFiles = new ArrayList<>();

        try {
            // Search in filesystem directory
            if (Files.isDirectory(resourcePath)) {
                try (Stream<Path> paths = Files.list(resourcePath)) {
                    vxmlFiles.addAll(
                            paths.filter(p -> p.toString().endsWith(VXML_EXTENSION))
                                    .map(p -> p.getFileName().toString()
                                            .replaceFirst("\\" + VXML_EXTENSION + "$", ""))
                                    .collect(Collectors.toList())
                    );
                }
            }
        } catch (IOException e) {
            System.err.println("[VxmlLoader] Could not list directory: " + e.getMessage());
        }

        // Also search classpath (optional enhancement)
        // This would require ClassPathResource or similar Spring utilities

        System.out.println("[VxmlLoader] Found " + vxmlFiles.size() + " VXML files: " + vxmlFiles);
        return vxmlFiles;
    }

    /**
     * Gets the URI for a VXML file, suitable for passing to JVoiceXML.
     *
     * @param vxmlName the VXML name without extension
     * @return the file:// URI of the VXML file
     * @throws RuntimeException if the VXML file does not exist
     *
     * @example
     * <pre>{@code
     * URI uri = loader.getVxmlUri("hello");
     * // Returns: file:///home/user/scenarios/hello.vxml
     * }</pre>
     */
    public URI getVxmlUri(String vxmlName) throws RuntimeException {
        String cleanName = cleanVxmlName(vxmlName);
        Path filePath = resolveVxmlPath(cleanName);
        if (filePath == null || !Files.exists(filePath)) {
            filePath = resourcePath.resolve(cleanName + VXML_EXTENSION);
            throw new RuntimeException("VXML file not found: " + filePath.toAbsolutePath());
        }
        try {
            return filePath.toAbsolutePath().toUri();
        } catch (Exception e) {
            throw new RuntimeException("Failed to create URI for: " + filePath, e);
        }
    }

    /**
     * Clears the document cache. Useful for reloading VXML files during development.
     */
    public void clearCache() {
        documentCache.clear();
        System.out.println("[VxmlLoader] Document cache cleared");
    }

    /**
     * Enables or disables caching of loaded VXML documents.
     *
     * @param enabled true to cache, false to reload from disk every time
     */
    public void setCachingEnabled(boolean enabled) {
        this.cachingEnabled = enabled;
        System.out.println("[VxmlLoader] Caching " + (enabled ? "enabled" : "disabled"));
    }

    /**
     * Returns the current cache size (number of cached VXML documents).
     *
     * @return the number of VXML documents currently in cache
     */
    public int getCacheSize() {
        return documentCache.size();
    }
}
