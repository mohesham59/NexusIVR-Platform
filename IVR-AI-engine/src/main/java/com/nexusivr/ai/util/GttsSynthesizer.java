package com.nexusivr.ai.util;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/**
 * Shared Python gTTS invocation used by the AI engine.
 *
 * <p>This is the same synthesis command used by the IVR engine's
 * {@code gov.iti.telecom.TtsEngine} (real Asterisk calls), so the browser
 * simulator and voice-prompt generation produce the same gTTS voice.</p>
 *
 * <p>Text and language are passed as process arguments (sys.argv), never
 * interpolated into the Python script, so the payload cannot inject code.</p>
 */
public final class GttsSynthesizer {

    private static final String GTTS_SCRIPT =
        "import sys; from gtts import gTTS; tts=gTTS(sys.argv[1], lang=sys.argv[2]); tts.save(sys.argv[3])";

    private GttsSynthesizer() {
    }

    /**
     * Maps a UI/ISO language label ("en-US", "English (US)", "ar-SA", "Arabic")
     * to a gTTS language code.
     */
    public static String toLangCode(String language) {
        if (language == null) return "en";
        String l = language.trim().toLowerCase();
        if (l.startsWith("ar") || l.contains("arabic")) return "ar";
        if (l.startsWith("fr") || l.contains("french")) return "fr";
        if (l.startsWith("es") || l.contains("spanish")) return "es";
        return "en";
    }

    /**
     * Synthesizes {@code text} to an MP3 file using gTTS.
     *
     * @throws IOException if python3/gTTS is unavailable or synthesis fails
     */
    public static void synthesizeMp3(String text, String langCode, Path mp3File) throws IOException, InterruptedException {
        ProcessBuilder pb = new ProcessBuilder("python3", "-c", GTTS_SCRIPT, text, langCode, mp3File.toString());
        int exit = runAndWait(pb);
        if (exit != 0 || !Files.exists(mp3File) || Files.size(mp3File) == 0) {
            Files.deleteIfExists(mp3File);
            throw new IOException("Speech synthesis failed (exit=" + exit + "). Ensure python3 and gTTS are installed (pip install gTTS) and the container has internet access.");
        }
    }

    /**
     * Runs a process, draining stdout/stderr concurrently to avoid pipe-buffer
     * deadlocks, and enforces a timeout so a hung process cannot block a
     * servlet thread forever.
     */
    public static int runAndWait(ProcessBuilder pb) throws IOException, InterruptedException {
        Process p = pb.start();
        Thread outReader = new Thread(() -> consume(p.getInputStream()), "gtts-stdout");
        Thread errReader = new Thread(() -> consume(p.getErrorStream()), "gtts-stderr");
        outReader.setDaemon(true);
        errReader.setDaemon(true);
        outReader.start();
        errReader.start();

        boolean finished = p.waitFor(120, TimeUnit.SECONDS);
        if (!finished) {
            System.err.println("[GttsSynthesizer] Process timed out: " + String.join(" ", pb.command()));
            p.destroyForcibly();
            throw new IOException("Process timed out: " + pb.command().get(0));
        }
        return p.exitValue();
    }

    private static void consume(InputStream stream) {
        try (InputStream in = stream) {
            byte[] buffer = new byte[1024];
            while (in.read(buffer) != -1) {
                // discard output
            }
        } catch (Exception ignored) {
        }
    }
}
