/** Fake ElevenLabs: streams PCM in dribs, records requests, can fail with quota/auth. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { synthTone } from "@plus1/liveavatar";

export class MockElevenLabs {
  readonly requests: { path: string; headers: Record<string, string | string[] | undefined>; body: any }[] = [];
  status = 200;
  /** ms of audio per character. */
  msPerChar = 60;
  chunkDelayMs = 15;
  /** Emit an odd number of bytes per chunk to test alignment. */
  oddChunks = false;
  stallFirstByteMs = 0;
  private server!: Server;
  private port = 0;

  get baseUrl() { return `http://127.0.0.1:${this.port}`; }

  async start() {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString();
      this.requests.push({ path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      if (req.headers["xi-api-key"] !== "el-key") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ detail: { status: "invalid_api_key" } })); }
      if (req.url === "/v1/voices") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ voices: [{ voice_id: "v1", name: "Daniel", category: "premade", labels: { accent: "british" } }] })); }
      if (this.status !== 200) { res.writeHead(this.status, { "content-type": "application/json" }); return res.end(JSON.stringify({ detail: { status: "quota_exceeded", message: "nope" } })); }
      const text: string = this.requests.at(-1)!.body.text;
      const pcm = Buffer.from(synthTone(Math.max(50, text.length * this.msPerChar)));
      if (this.stallFirstByteMs) await new Promise((r) => setTimeout(r, this.stallFirstByteMs));
      res.writeHead(200, { "content-type": "audio/pcm", "transfer-encoding": "chunked" });
      const size = this.oddChunks ? 4801 : 4800;
      for (let o = 0; o < pcm.length; o += size) {
        if (res.destroyed) return;
        res.write(pcm.subarray(o, o + size));
        await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      }
      res.end();
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }
  async stop() { this.server.closeAllConnections?.(); await new Promise<void>((r) => this.server.close(() => r())); }
}
