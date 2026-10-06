package com.nexusivr.ai.controller;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.nexusivr.ai.util.GttsSynthesizer;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.stream.Collectors;

/**
 * Browser TTS preview for the IVR Builder Test Simulator.
 *
 * <p>POST {@code /api/v1/tts/preview} with {@code {"text": "...", "language": "en-US"}}
 * returns the synthesized speech as {@code audio/mpeg}.</p>
 *
 * <p>Uses the same Python gTTS synthesis as the real IVR path
 * ({@code TtsEngine} in IVR-engine). Unlike {@code /voice-prompts/generate},
 * it does NOT write into the Asterisk sounds directory and does NOT create
 * Voice Prompt library rows — test runs must not change production data.
 * Results are cached on disk by content hash so replays/restarts are instant.</p>
 */
@WebServlet(urlPatterns = {"/api/v1/tts/preview"})
public class TtsPreviewServlet extends BaseAiServlet {

    private static final int MAX_TEXT_LENGTH = 2000;
    private static final Path CACHE_DIR = Paths.get(System.getProperty("java.io.tmpdir"), "nexusivr-tts-preview");

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        String text;
        String language;
        try {
            req.setCharacterEncoding("UTF-8");
            String body = new BufferedReader(new InputStreamReader(req.getInputStream(), StandardCharsets.UTF_8))
                .lines().collect(Collectors.joining("\n"));
            JsonObject json = JsonParser.parseString(body).getAsJsonObject();
            text = json.has("text") && !json.get("text").isJsonNull() ? json.get("text").getAsString().trim() : "";
            language = json.has("language") && !json.get("language").isJsonNull() ? json.get("language").getAsString() : "en-US";
        } catch (Exception e) {
            sendJsonResponse(resp, HttpServletResponse.SC_BAD_REQUEST, "Invalid JSON body. Expected {\"text\": \"...\", \"language\": \"en-US\"}");
            return;
        }

        if (text.isEmpty()) {
            sendJsonResponse(resp, HttpServletResponse.SC_BAD_REQUEST, "Missing text");
            return;
        }
        if (text.length() > MAX_TEXT_LENGTH) {
            sendJsonResponse(resp, HttpServletResponse.SC_BAD_REQUEST, "Text too long (max " + MAX_TEXT_LENGTH + " characters)");
            return;
        }

        String langCode = GttsSynthesizer.toLangCode(language);

        try {
            Files.createDirectories(CACHE_DIR);
            Path cached = CACHE_DIR.resolve("tts-" + langCode + "-" + sha256(langCode + "|" + text) + ".mp3");

            if (!Files.exists(cached) || Files.size(cached) == 0) {
                // Synthesize to a temp file then atomically move, so concurrent
                // requests never serve a half-written MP3.
                Path tmp = Files.createTempFile(CACHE_DIR, "gen-", ".mp3");
                try {
                    GttsSynthesizer.synthesizeMp3(text, langCode, tmp);
                    Files.move(tmp, cached, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } finally {
                    Files.deleteIfExists(tmp);
                }
                logger.info("[TTS Preview] Synthesized {} bytes (lang={}) for text: {}", Files.size(cached), langCode, abbreviate(text));
            } else {
                logger.info("[TTS Preview] Cache hit (lang={}) for text: {}", langCode, abbreviate(text));
            }

            resp.setStatus(HttpServletResponse.SC_OK);
            resp.setContentType("audio/mpeg");
            resp.setHeader("Cache-Control", "private, max-age=3600");
            resp.setContentLengthLong(Files.size(cached));
            try (OutputStream out = resp.getOutputStream()) {
                Files.copy(cached, out);
            }
        } catch (Exception e) {
            logger.error("[TTS Preview] Synthesis failed: {}", e.getMessage());
            // Real error status (not 200) so the browser never treats this as audio.
            sendJsonResponse(resp, HttpServletResponse.SC_BAD_GATEWAY,
                "TTS synthesis failed: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        }
    }

    private static String sha256(String s) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.substring(0, 24);
    }

    private static String abbreviate(String s) {
        return s.length() <= 60 ? s : s.substring(0, 57) + "...";
    }
}
