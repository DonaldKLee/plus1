/**
 * Public PDF hosting on Appwrite Storage.
 *
 * Meet chat cannot use localhost:8787 — each participant resolves that to their
 * own machine. Appwrite gives a real https URL anyone in the room can open,
 * without tunnelling the unauthenticated backend.
 *
 * The bucket must allow Role.any() read (Console → Storage → bucket → Settings →
 * Permissions). With fileSecurity off, file-level read(any) alone is not enough.
 */
import { Client, ID, Permission, Role, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { envOptional } from "./env.js";

export function appwriteConfigured(): boolean {
  return Boolean(
    envOptional("APPWRITE_ENDPOINT") &&
      envOptional("APPWRITE_PROJECT_ID") &&
      envOptional("APPWRITE_API_KEY") &&
      envOptional("APPWRITE_BUCKET_ID"),
  );
}

function client(): { storage: Storage; endpoint: string; projectId: string; bucketId: string } {
  const endpoint = envOptional("APPWRITE_ENDPOINT")!.replace(/\/+$/, "");
  const projectId = envOptional("APPWRITE_PROJECT_ID")!;
  const apiKey = envOptional("APPWRITE_API_KEY")!;
  const bucketId = envOptional("APPWRITE_BUCKET_ID")!;
  const storage = new Storage(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
  return { storage, endpoint, projectId, bucketId };
}

/** Public view URL — no login. The file must be created with read(any). */
export function appwriteViewUrl(fileId: string): string {
  const endpoint = envOptional("APPWRITE_ENDPOINT")!.replace(/\/+$/, "");
  const projectId = envOptional("APPWRITE_PROJECT_ID")!;
  const bucketId = envOptional("APPWRITE_BUCKET_ID")!;
  return `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${encodeURIComponent(projectId)}`;
}

/**
 * Upload a PDF and return a publicly readable URL. Returns undefined when
 * Appwrite isn't configured; throws if it is configured and the upload fails.
 */
export async function uploadPublicPdf(bytes: Uint8Array, filename: string): Promise<string | undefined> {
  if (!appwriteConfigured()) return undefined;
  const { storage, bucketId } = client();
  const fileId = ID.unique();
  const safeName = filename.replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "") || "document.pdf";
  await storage.createFile({
    bucketId,
    fileId,
    file: InputFile.fromBuffer(Buffer.from(bytes), safeName),
    permissions: [Permission.read(Role.any())],
  });
  return appwriteViewUrl(fileId);
}
