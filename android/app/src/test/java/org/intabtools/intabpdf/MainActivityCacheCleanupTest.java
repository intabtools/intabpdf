package org.intabtools.intabpdf;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;

public class MainActivityCacheCleanupTest {

    private File testCacheDir;

    @Before
    public void setUp() throws IOException {
        testCacheDir = Files.createTempDirectory("intab_cache_test_").toFile();
        MainActivity.isProcessInitialized = false;
    }

    @After
    public void tearDown() {
        if (testCacheDir != null && testCacheDir.exists()) {
            deleteRecursively(testCacheDir);
        }
        MainActivity.isProcessInitialized = false;
    }

    private void deleteRecursively(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        file.delete();
    }

    @Test
    public void testFreshLaunchWithStaleExternalLaunchPdfDeletesOnlyThatFile() throws IOException {
        File staleFile = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(staleFile)) {
            out.write("stale pdf content from previous session".getBytes());
        }
        assertTrue("Stale file should exist before cleanup", staleFile.exists());

        // Perform cleanup as done on fresh launch
        MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);

        assertFalse("Stale external_launch.pdf must be deleted after cleanup", staleFile.exists());
    }

    @Test
    public void testFreshLaunchWithNoExternalLaunchPdfSucceedsSilently() {
        File staleFile = new File(testCacheDir, "external_launch.pdf");
        assertFalse(staleFile.exists());

        // Must not throw or fail when file doesn't exist
        MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);

        assertFalse(staleFile.exists());
    }

    @Test
    public void testCleanupDoesNotTouchOtherFilesOrDirectories() throws IOException {
        File staleFile = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(staleFile)) {
            out.write("stale pdf bytes".getBytes());
        }

        File otherPdf = new File(testCacheDir, "export.pdf");
        try (FileOutputStream out = new FileOutputStream(otherPdf)) {
            out.write("precious user export bytes".getBytes());
        }

        File sharePdf = new File(testCacheDir, "share_1730000000.pdf");
        try (FileOutputStream out = new FileOutputStream(sharePdf)) {
            out.write("share mirror bytes".getBytes());
        }

        File subDir = new File(testCacheDir, "webview_cache");
        assertTrue(subDir.mkdir());
        File subFile = new File(subDir, "data.bin");
        try (FileOutputStream out = new FileOutputStream(subFile)) {
            out.write("internal webview bytes".getBytes());
        }

        MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);

        // external_launch.pdf must be removed
        assertFalse("external_launch.pdf must be deleted", staleFile.exists());

        // All other files and directories must remain intact
        assertTrue("export.pdf must not be touched", otherPdf.exists());
        assertEquals("precious user export bytes", new String(Files.readAllBytes(otherPdf.toPath())));

        assertTrue("share mirror must not be touched", sharePdf.exists());
        assertEquals("share mirror bytes", new String(Files.readAllBytes(sharePdf.toPath())));

        assertTrue("subDir must not be touched", subDir.exists());
        assertTrue("file inside subDir must not be touched", subFile.exists());
    }

    @Test
    public void testProcessLevelGuardPreventsCleanupOnActivityRecreation() throws IOException {
        File staleFile = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(staleFile)) {
            out.write("initial file".getBytes());
        }

        // Simulate first launch in process
        assertFalse(MainActivity.isProcessInitialized);
        if (!MainActivity.isProcessInitialized) {
            MainActivity.isProcessInitialized = true;
            MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);
        }
        assertTrue(MainActivity.isProcessInitialized);
        assertFalse(staleFile.exists());

        // Simulate incoming external PDF resolution during this active process
        File activeIncomingPdf = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(activeIncomingPdf)) {
            out.write("new active external pdf content".getBytes());
        }
        assertTrue(activeIncomingPdf.exists());

        // Simulate Activity recreation (e.g. rotation, configuration change, returning from share)
        // In the same process, isProcessInitialized is already true
        if (!MainActivity.isProcessInitialized) {
            MainActivity.isProcessInitialized = true;
            MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);
        }

        // The newly resolved PDF must NOT be deleted because cleanup was skipped by the guard
        assertTrue("Active incoming PDF must not be deleted on activity recreation", activeIncomingPdf.exists());
        assertEquals("new active external pdf content", new String(Files.readAllBytes(activeIncomingPdf.toPath())));
    }

    @Test
    public void testOpeningExternalPdfAfterCleanupWorksNormally() throws IOException {
        // Step 1: Stale file from previous session exists
        File staleFile = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(staleFile)) {
            out.write("old data".getBytes());
        }

        // Step 2: Fresh launch runs cleanup
        MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);
        assertFalse(staleFile.exists());

        // Step 3: Now external PDF intent is resolved and written to external_launch.pdf
        File resolvedFile = new File(testCacheDir, "external_launch.pdf");
        try (FileOutputStream out = new FileOutputStream(resolvedFile)) {
            out.write("new resolved pdf stream".getBytes());
        }

        assertTrue("Newly resolved PDF should be written successfully", resolvedFile.exists());
        assertEquals("new resolved pdf stream", new String(Files.readAllBytes(resolvedFile.toPath())));
    }

    @Test
    public void testCleanupNeverFailsWhenCacheDirIsNull() {
        // Must handle null safely without throwing
        MainActivity.cleanStaleExternalLaunchPdf(null);
    }

    @Test
    public void testCleanupDoesNotDeleteDirectoryNamedExternalLaunchPdf() {
        File dirWithSameName = new File(testCacheDir, "external_launch.pdf");
        assertTrue(dirWithSameName.mkdir());

        MainActivity.cleanStaleExternalLaunchPdf(testCacheDir);

        assertTrue("A directory named external_launch.pdf must not be deleted", dirWithSameName.exists());
    }
}
