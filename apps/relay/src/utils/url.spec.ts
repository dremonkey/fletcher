import { describe, expect, it } from "bun:test";
import { wsUrlToHttp } from "./url";

describe("wsUrlToHttp", () => {
  it("converts ws:// to http://", () => {
    expect(wsUrlToHttp("ws://localhost:7880")).toBe("http://localhost:7880");
  });

  it("converts wss:// to https://", () => {
    expect(wsUrlToHttp("wss://livekit.example.com")).toBe("https://livekit.example.com");
  });

  it("leaves http:// unchanged", () => {
    expect(wsUrlToHttp("http://localhost:7880")).toBe("http://localhost:7880");
  });

  it("leaves https:// unchanged", () => {
    expect(wsUrlToHttp("https://livekit.example.com")).toBe("https://livekit.example.com");
  });

  it("only replaces the first occurrence of ws://", () => {
    expect(wsUrlToHttp("ws://host/ws://path")).toBe("http://host/ws://path");
  });
});
