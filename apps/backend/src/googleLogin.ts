/**
 * Headed Chrome on the plus1 screenshare profile — sign into Google here.
 *   npm run backend:google-login
 */

import { openGoogleLogin } from "./meetPresent.js";

const result = await openGoogleLogin({ timeoutMs: 300_000 });
console.log(JSON.stringify(result, null, 2));
if (!result.signedIn) {
  console.log("Window stays open — finish Google sign-in, then say when to join Meet.");
}
await new Promise(() => {});
