package com.nexusivr.ai.controller;

import com.nexusivr.ai.dao.VoicePromptDao;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

@WebServlet(urlPatterns = {"/api/v1/voice-prompts/generate"})
public class VoicePromptsGenerateServlet extends BaseAiServlet {

    private static final String[] BASE_SOUND_DIRS = com.nexusivr.ai.util.SoundDirs.resolveBaseSoundDirs();

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            req.setCharacterEncoding("UTF-8");
            String requestBody = new BufferedReader(new InputStreamReader(req.getInputStream(), java.nio.charset.StandardCharsets.UTF_8)).lines().collect(Collectors.joining("\n"));
            JsonObject json = new Gson().fromJson(requestBody, JsonObject.class);
            
            String fileName = json.has("fileName") ? json.get("fileName").getAsString().trim() : "";
            String language = json.has("language") ? json.get("language").getAsString() : "English (US)";
            String text = json.has("text") ? json.get("text").getAsString().trim() : "";

            if (fileName.isEmpty() || text.isEmpty()) {
                sendJsonResponse(resp, HttpServletResponse.SC_BAD_REQUEST, "Missing fileName or text");
                return;
            }

            // Sanitize fileName to prevent path traversal (absolute paths or "..").
            String baseName = new File(fileName).getName().trim();
            if (baseName.isEmpty() || baseName.contains("/") || baseName.contains("\\") || baseName.contains("..")) {
                sendJsonResponse(resp, HttpServletResponse.SC_BAD_REQUEST, "Invalid fileName");
                return;
            }
            fileName = baseName;

            if (!fileName.toLowerCase().endsWith(".wav")) {
                fileName += ".wav";
            }

            String langCode = "en";
            if (language.toLowerCase().contains("arabic") || language.toLowerCase().contains("ar")) {
                langCode = "ar";
            } else if (language.toLowerCase().contains("french") || language.toLowerCase().contains("fr")) {
                langCode = "fr";
            } else if (language.toLowerCase().contains("spanish") || language.toLowerCase().contains("es")) {
                langCode = "es";
            }

            Path targetDir = null;
            for (String baseDirStr : BASE_SOUND_DIRS) {
                File baseDir = new File(baseDirStr);
                if (baseDir.exists() && baseDir.canWrite()) {
                    File langDir = new File(baseDir, langCode);
                    if (!langDir.exists()) {
                        langDir.mkdirs();
                    }
                    if (langDir.exists() && langDir.canWrite()) {
                        targetDir = langDir.toPath();
                        break;
                    }
                }
            }

            if (targetDir == null) {
                throw new IOException("Could not find a writable directory for saving the audio file.");
            }

            Path targetWavFile = targetDir.resolve(fileName);
            String mp3File = targetWavFile.toString().replace(".wav", ".mp3");

            // Python gTTS generation (shared with the browser TTS preview endpoint).
            boolean ttsOk;
            try {
                com.nexusivr.ai.util.GttsSynthesizer.synthesizeMp3(text, langCode, Paths.get(mp3File));
                ttsOk = true;
            } catch (IOException ttsError) {
                ttsOk = false;
            }

            if (ttsOk && Files.exists(Paths.get(mp3File))) {
                // Convert to WAV using ffmpeg
                ProcessBuilder pbFfmpeg = new ProcessBuilder(
                    "ffmpeg", "-y", "-i", mp3File, "-ar", "8000", "-ac", "1", "-codec:a", "pcm_s16le", targetWavFile.toString()
                );
                int exitFfmpeg = runAndWait(pbFfmpeg);

                Files.deleteIfExists(Paths.get(mp3File));

                if (exitFfmpeg != 0 || !Files.exists(targetWavFile)) {
                    throw new IOException("Failed to convert synthesized audio to WAV format");
                }
            } else {
                throw new IOException("Speech synthesis failed for text. Ensure gTTS is installed (pip install gTTS).");
            }

            long fileSize = Files.size(targetWavFile);
            String durationStr = "0:00";
            try (javax.sound.sampled.AudioInputStream ais = javax.sound.sampled.AudioSystem.getAudioInputStream(targetWavFile.toFile())) {
                javax.sound.sampled.AudioFormat format = ais.getFormat();
                long frames = ais.getFrameLength();
                double durSecs = (frames + 0.0) / format.getFrameRate();
                int totalSeconds = (int) Math.ceil(durSecs);
                if (totalSeconds == 0 && durSecs > 0) totalSeconds = 1;
                durationStr = String.format("%d:%02d", totalSeconds / 60, totalSeconds % 60);
            } catch (Exception ignored) {}

            String username = "Tenant Admin"; // Mock logic for demo

            new VoicePromptDao().upsert(fileName, language, durationStr, "AI Generated", username, targetWavFile.toString(), fileSize, text);

            Map<String, Object> responseData = new LinkedHashMap<>();
            responseData.put("success", true);
            responseData.put("name", fileName);
            responseData.put("type", "AI Generated");
            responseData.put("createdBy", username);

            sendJsonResponse(resp, HttpServletResponse.SC_OK, responseData);

        } catch (Exception e) {
            handleError(resp, e);
        }
    }

    private static int runAndWait(ProcessBuilder pb) throws IOException, InterruptedException {
        return com.nexusivr.ai.util.GttsSynthesizer.runAndWait(pb);
    }
}
