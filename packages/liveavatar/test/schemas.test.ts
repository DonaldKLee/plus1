import { describe, expect, it } from "vitest";
import { ClientCommand, LiteSessionTokenRequest, SessionTokenResponse, StartSessionResponse, parseServerEvent } from "../src/schemas.js";

describe("REST schemas", () => {
  it("accepts the documented start response and tolerates extra fields", () => {
    const r = StartSessionResponse.parse({
      code: 100, message: "ok",
      data: { session_id: "s", livekit_url: "wss://x", livekit_client_token: "t", livekit_agent_token: "a", max_session_duration: 600, ws_url: "wss://y", future_field: { a: 1 } },
    });
    expect(r.data.ws_url).toBe("wss://y");
    expect((r.data as any).future_field.a).toBe(1);
  });
  it("accepts FULL-style start (no ws_url) at the schema level", () => {
    expect(() => StartSessionResponse.parse({ code: 100, data: { session_id: "s", livekit_url: "u", livekit_client_token: "t" } })).not.toThrow();
  });
  it("rejects a token response without a token", () => {
    expect(() => SessionTokenResponse.parse({ code: 100, data: { session_id: "s" } })).toThrow();
  });
  it("token request is strict", () => {
    expect(() => LiteSessionTokenRequest.parse({ mode: "LITE", avatar_id: "a", voice_id: "nope" })).toThrow();
    expect(() => LiteSessionTokenRequest.parse({ mode: "FULL", avatar_id: "a" })).toThrow();
    expect(LiteSessionTokenRequest.parse({ mode: "LITE", avatar_id: "a", video_settings: { encoding: "H264" } }).video_settings?.encoding).toBe("H264");
  });
});

describe("socket schemas", () => {
  it("parses every documented server event", () => {
    const types = ["agent.speak_started", "agent.speak_ended", "agent.speak_interrupted", "agent.audio_buffer_appended", "agent.audio_buffer_committed", "agent.audio_buffer_cleared"];
    for (const t of types) expect(parseServerEvent(JSON.stringify({ type: t, event_id: "e", source_event_id: null })).type).toBe(t);
    const st = parseServerEvent('{"type":"session.state_updated","state":"connected"}');
    expect(st.type === "session.state_updated" && st.state).toBe("connected");
    const ag = parseServerEvent('{"type":"agent.state_updated","previous_state":"idle","new_state":"talking"}');
    expect(ag.type === "agent.state_updated" && ag.new_state).toBe("talking");
    const err = parseServerEvent('{"type":"error","error":{"type":"video_starvation","message":"slow","event_id":"x"}}');
    expect(err.type === "error" && err.error.type).toBe("video_starvation");
    const warn = parseServerEvent('{"type":"warning","warning":{"type":"w","message":"m"}}');
    expect(warn.type).toBe("warning");
  });
  it("tolerates unknown enum values and unknown event types", () => {
    const st = parseServerEvent('{"type":"agent.state_updated","new_state":"thinking_hard"}');
    expect(st.type === "agent.state_updated" && st.new_state).toBe("thinking_hard");
    const u = parseServerEvent('{"type":"agent.pose_changed","event_id":"abc","pose":"x"}');
    expect(u.type).toBe("unknown");
    expect(u.type === "unknown" && u.rawType).toBe("agent.pose_changed");
    expect(u.event_id).toBe("abc");
  });
  it("validates commands strictly", () => {
    expect(() => ClientCommand.parse({ type: "agent.speak", event_id: "e" })).toThrow();
    expect(() => ClientCommand.parse({ type: "agent.speak", event_id: "e", audio: "AAAA", extra: 1 })).toThrow();
    expect(ClientCommand.parse({ type: "agent.speak_end", event_id: "e" }).type).toBe("agent.speak_end");
    expect(ClientCommand.parse({ type: "session.keep_alive", event_id: "e" }).type).toBe("session.keep_alive");
  });
});
