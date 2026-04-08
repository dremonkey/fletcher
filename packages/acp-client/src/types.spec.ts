/**
 * Tests for ContentPart and ToolCallContent discriminated unions.
 *
 * These tests verify type narrowing behavior — that TypeScript narrows
 * correctly on `type` discriminants, and that all expected fields are
 * accessible after narrowing.
 */

import { describe, test, expect } from "bun:test";
import type {
  ContentPart,
  TextContentPart,
  ImageContentPart,
  AudioContentPart,
  ResourceContentPart,
  ResourceLinkContentPart,
  ToolCallContent,
  ToolCallContentItem,
  ToolCallDiffItem,
  ToolCallTerminalItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers — type-safe narrowing functions used by tests
// ---------------------------------------------------------------------------

/** Narrows ContentPart to TextContentPart. Returns null if type !== "text". */
function narrowText(part: ContentPart): TextContentPart | null {
  if (part.type === "text") return part;
  return null;
}

/** Narrows ContentPart to ImageContentPart. Returns null if type !== "image". */
function narrowImage(part: ContentPart): ImageContentPart | null {
  if (part.type === "image") return part;
  return null;
}

/** Narrows ContentPart to AudioContentPart. Returns null if type !== "audio". */
function narrowAudio(part: ContentPart): AudioContentPart | null {
  if (part.type === "audio") return part;
  return null;
}

/** Narrows ContentPart to ResourceContentPart. Returns null if type !== "resource". */
function narrowResource(part: ContentPart): ResourceContentPart | null {
  if (part.type === "resource") return part;
  return null;
}

/** Narrows ContentPart to ResourceLinkContentPart. Returns null if type !== "resource_link". */
function narrowResourceLink(part: ContentPart): ResourceLinkContentPart | null {
  if (part.type === "resource_link") return part;
  return null;
}

/** Narrows ToolCallContent to ToolCallContentItem. */
function narrowToolContent(item: ToolCallContent): ToolCallContentItem | null {
  if (item.type === "content") return item;
  return null;
}

/** Narrows ToolCallContent to ToolCallDiffItem. */
function narrowToolDiff(item: ToolCallContent): ToolCallDiffItem | null {
  if (item.type === "diff") return item;
  return null;
}

/** Narrows ToolCallContent to ToolCallTerminalItem. */
function narrowToolTerminal(item: ToolCallContent): ToolCallTerminalItem | null {
  if (item.type === "terminal") return item;
  return null;
}

// ---------------------------------------------------------------------------
// ContentPart — construction and narrowing
// ---------------------------------------------------------------------------

describe("ContentPart discriminated union", () => {
  test("TextContentPart has required text field and optional annotations", () => {
    const part: ContentPart = { type: "text", text: "hello world" };

    expect(part.type).toBe("text");
    const narrowed = narrowText(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.text).toBe("hello world");
    expect(narrowed!.annotations).toBeUndefined();
  });

  test("TextContentPart accepts optional annotations", () => {
    const part: ContentPart = {
      type: "text",
      text: "hello",
      annotations: { role: "user" },
    };

    const narrowed = narrowText(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.annotations).toEqual({ role: "user" });
  });

  test("ImageContentPart narrows correctly and exposes data + mimeType", () => {
    const part: ContentPart = {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      mimeType: "image/png",
    };

    expect(narrowText(part)).toBeNull();
    const narrowed = narrowImage(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.data).toBe("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
    expect(narrowed!.mimeType).toBe("image/png");
    expect(narrowed!.uri).toBeUndefined();
  });

  test("ImageContentPart accepts optional uri", () => {
    const part: ContentPart = {
      type: "image",
      data: "abc123",
      mimeType: "image/jpeg",
      uri: "https://example.com/img.jpg",
    };

    const narrowed = narrowImage(part);
    expect(narrowed!.uri).toBe("https://example.com/img.jpg");
  });

  test("AudioContentPart narrows correctly and exposes data + mimeType", () => {
    const part: ContentPart = {
      type: "audio",
      data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB",
      mimeType: "audio/wav",
    };

    expect(narrowText(part)).toBeNull();
    expect(narrowImage(part)).toBeNull();
    const narrowed = narrowAudio(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.data).toBe("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB");
    expect(narrowed!.mimeType).toBe("audio/wav");
  });

  test("ResourceContentPart narrows correctly and exposes text resource", () => {
    const part: ContentPart = {
      type: "resource",
      resource: {
        uri: "file:///home/user/script.py",
        mimeType: "text/x-python",
        text: "def hello():\n    print('Hello, world!')",
      },
    };

    expect(narrowText(part)).toBeNull();
    const narrowed = narrowResource(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.resource.uri).toBe("file:///home/user/script.py");
    expect(narrowed!.resource.mimeType).toBe("text/x-python");
    expect(narrowed!.resource.text).toBe("def hello():\n    print('Hello, world!')");
    expect(narrowed!.resource.blob).toBeUndefined();
  });

  test("ResourceContentPart supports blob resource", () => {
    const part: ContentPart = {
      type: "resource",
      resource: {
        uri: "file:///data/image.bin",
        blob: "base64encodeddata",
        mimeType: "application/octet-stream",
      },
    };

    const narrowed = narrowResource(part);
    expect(narrowed!.resource.blob).toBe("base64encodeddata");
    expect(narrowed!.resource.text).toBeUndefined();
  });

  test("ResourceLinkContentPart narrows correctly with required uri and name", () => {
    const part: ContentPart = {
      type: "resource_link",
      uri: "file:///home/user/document.pdf",
      name: "document.pdf",
      mimeType: "application/pdf",
      size: 1024000,
    };

    expect(narrowText(part)).toBeNull();
    expect(narrowResource(part)).toBeNull();
    const narrowed = narrowResourceLink(part);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.uri).toBe("file:///home/user/document.pdf");
    expect(narrowed!.name).toBe("document.pdf");
    expect(narrowed!.mimeType).toBe("application/pdf");
    expect(narrowed!.size).toBe(1024000);
  });

  test("ResourceLinkContentPart accepts optional title and description", () => {
    const part: ContentPart = {
      type: "resource_link",
      uri: "https://example.com/readme",
      name: "README.md",
      title: "Project README",
      description: "Main documentation file",
    };

    const narrowed = narrowResourceLink(part);
    expect(narrowed!.title).toBe("Project README");
    expect(narrowed!.description).toBe("Main documentation file");
  });

  test("switch on ContentPart.type provides exhaustive narrowing", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "hello" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "audio", data: "def", mimeType: "audio/mp3" },
      { type: "resource", resource: { uri: "file:///foo" } },
      { type: "resource_link", uri: "file:///bar", name: "bar.txt" },
    ];

    const seen: string[] = [];
    for (const part of parts) {
      switch (part.type) {
        case "text":
          seen.push(`text:${part.text}`);
          break;
        case "image":
          seen.push(`image:${part.mimeType}`);
          break;
        case "audio":
          seen.push(`audio:${part.mimeType}`);
          break;
        case "resource":
          seen.push(`resource:${part.resource.uri}`);
          break;
        case "resource_link":
          seen.push(`resource_link:${part.name}`);
          break;
      }
    }

    expect(seen).toEqual([
      "text:hello",
      "image:image/png",
      "audio:audio/mp3",
      "resource:file:///foo",
      "resource_link:bar.txt",
    ]);
  });
});

// ---------------------------------------------------------------------------
// ToolCallContent — construction and narrowing
// ---------------------------------------------------------------------------

describe("ToolCallContent discriminated union", () => {
  test("ToolCallContentItem wraps a ContentPart", () => {
    const item: ToolCallContent = {
      type: "content",
      content: { type: "text", text: "Found 3 configuration files..." },
    };

    expect(item.type).toBe("content");
    const narrowed = narrowToolContent(item);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.content.type).toBe("text");

    // Further narrow the wrapped ContentPart
    const inner = narrowText(narrowed!.content);
    expect(inner!.text).toBe("Found 3 configuration files...");
  });

  test("ToolCallContentItem can wrap non-text ContentPart", () => {
    const item: ToolCallContent = {
      type: "content",
      content: {
        type: "image",
        data: "abc123",
        mimeType: "image/png",
      },
    };

    const narrowed = narrowToolContent(item);
    expect(narrowed!.content.type).toBe("image");
    expect(narrowImage(narrowed!.content)!.mimeType).toBe("image/png");
  });

  test("ToolCallDiffItem narrows correctly and exposes path and newText", () => {
    const item: ToolCallContent = {
      type: "diff",
      path: "/home/user/project/src/config.json",
      oldText: '{"debug": false}',
      newText: '{"debug": true}',
    };

    expect(narrowToolContent(item)).toBeNull();
    const narrowed = narrowToolDiff(item);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.path).toBe("/home/user/project/src/config.json");
    expect(narrowed!.oldText).toBe('{"debug": false}');
    expect(narrowed!.newText).toBe('{"debug": true}');
  });

  test("ToolCallDiffItem allows absent oldText for new files", () => {
    const item: ToolCallContent = {
      type: "diff",
      path: "/home/user/newfile.ts",
      newText: "export const x = 1;",
    };

    const narrowed = narrowToolDiff(item);
    expect(narrowed!.oldText).toBeUndefined();
    expect(narrowed!.newText).toBe("export const x = 1;");
  });

  test("ToolCallTerminalItem narrows correctly and exposes terminalId", () => {
    const item: ToolCallContent = {
      type: "terminal",
      terminalId: "term_xyz789",
    };

    expect(narrowToolContent(item)).toBeNull();
    expect(narrowToolDiff(item)).toBeNull();
    const narrowed = narrowToolTerminal(item);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.terminalId).toBe("term_xyz789");
  });

  test("switch on ToolCallContent.type provides exhaustive narrowing", () => {
    const items: ToolCallContent[] = [
      { type: "content", content: { type: "text", text: "output" } },
      { type: "diff", path: "/foo.ts", newText: "x" },
      { type: "terminal", terminalId: "t1" },
    ];

    const seen: string[] = [];
    for (const item of items) {
      switch (item.type) {
        case "content":
          seen.push(`content:${item.content.type}`);
          break;
        case "diff":
          seen.push(`diff:${item.path}`);
          break;
        case "terminal":
          seen.push(`terminal:${item.terminalId}`);
          break;
      }
    }

    expect(seen).toEqual([
      "content:text",
      "diff:/foo.ts",
      "terminal:t1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// SessionPromptParams compatibility — ContentPart[] used in prompts
// ---------------------------------------------------------------------------

describe("ContentPart in SessionPromptParams.prompt", () => {
  test("prompt array accepts mixed content types", () => {
    // This verifies the widened ContentPart is compatible with SessionPromptParams.prompt
    const prompt: ContentPart[] = [
      { type: "text", text: "Analyze this image:" },
      { type: "image", data: "abc123", mimeType: "image/png" },
    ];

    // Verify we can filter by type
    const textParts = prompt.filter((p): p is TextContentPart => p.type === "text");
    const imageParts = prompt.filter((p): p is ImageContentPart => p.type === "image");

    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe("Analyze this image:");
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0].mimeType).toBe("image/png");
  });
});
