/**
 * Diagnostic: check if macOS Screen Recording permission is granted to Chrome.
 *
 *   npx tsx apps/backend/src/checkScreenRecording.ts
 */

import { checkMacScreenRecordingPermission } from "./meetPresent.js";

console.log("Checking macOS Screen Recording permission for Chrome...\n");

const result = checkMacScreenRecordingPermission();

if (process.platform !== "darwin") {
  console.log("✓ Not on macOS — Screen Recording TCC check skipped.\n");
  process.exit(0);
}

if (result.ok) {
  console.log("✓ Screen Recording permission appears to be GRANTED to Chrome.\n");
  console.log("If screensharing still doesn't work, try:");
  console.log("  1. Quit all Chrome instances completely");
  console.log("  2. Re-run the work-cam script");
  console.log("");
} else {
  console.log("✗ Screen Recording permission NOT GRANTED to Chrome.\n");
  console.log(result.hint ?? "");
  console.log("");
  console.log("After granting permission:");
  console.log("  1. Quit all Chrome instances completely");
  console.log("  2. Re-run the work-cam script");
  console.log("");
  process.exit(1);
}
