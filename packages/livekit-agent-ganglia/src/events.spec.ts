import { describe, it, expect } from 'bun:test';
import {
  isStatusEvent,
  isArtifactEvent,
  isContentEvent,
  statusFromToolCall,
  type StatusEvent,
  type ArtifactEvent,
  type ContentEvent,
} from './events.js';

describe('type guards', () => {
  const statusEvent: StatusEvent = {
    type: 'status',
    action: 'reading_file',
    detail: 'src/index.ts',
  };

  const artifactEvent: ArtifactEvent = {
    type: 'artifact',
    artifact_type: 'code',
    content: 'console.log("hello")',
    language: 'typescript',
  };

  const contentEvent: ContentEvent = {
    type: 'content',
    delta: 'Hello, world!',
  };

  describe('isStatusEvent', () => {
    it('returns true for status events', () => {
      expect(isStatusEvent(statusEvent)).toBe(true);
    });

    it('returns false for other events', () => {
      expect(isStatusEvent(artifactEvent)).toBe(false);
      expect(isStatusEvent(contentEvent)).toBe(false);
    });
  });

  describe('isArtifactEvent', () => {
    it('returns true for artifact events', () => {
      expect(isArtifactEvent(artifactEvent)).toBe(true);
    });

    it('returns false for other events', () => {
      expect(isArtifactEvent(statusEvent)).toBe(false);
      expect(isArtifactEvent(contentEvent)).toBe(false);
    });
  });

  describe('isContentEvent', () => {
    it('returns true for content events', () => {
      expect(isContentEvent(contentEvent)).toBe(true);
    });

    it('returns false for other events', () => {
      expect(isContentEvent(statusEvent)).toBe(false);
      expect(isContentEvent(artifactEvent)).toBe(false);
    });
  });
});

describe('statusFromToolCall', () => {
  it('maps read_file to reading_file action', () => {
    const status = statusFromToolCall('read_file', { path: 'src/index.ts' });
    expect(status.action).toBe('reading_file');
    expect(status.detail).toBe('src/index.ts');
  });

  it('maps Read to reading_file action', () => {
    const status = statusFromToolCall('Read', { file_path: 'src/index.ts' });
    expect(status.action).toBe('reading_file');
    expect(status.detail).toBe('src/index.ts');
  });

  it('maps write_file to writing_file action', () => {
    const status = statusFromToolCall('write_file', { path: 'output.txt' });
    expect(status.action).toBe('writing_file');
    expect(status.detail).toBe('output.txt');
  });

  it('maps grep/Grep to searching_files action', () => {
    const status = statusFromToolCall('grep', { pattern: 'TODO' });
    expect(status.action).toBe('searching_files');
    expect(status.detail).toBe('TODO');

    const status2 = statusFromToolCall('Grep', { pattern: 'FIXME' });
    expect(status2.action).toBe('searching_files');
    expect(status2.detail).toBe('FIXME');
  });

  it('maps web_search to web_search action', () => {
    const status = statusFromToolCall('web_search', { query: 'typescript best practices' });
    expect(status.action).toBe('web_search');
    expect(status.detail).toBe('typescript best practices');
  });

  it('maps bash/Bash to executing_command action', () => {
    const status = statusFromToolCall('bash', { command: 'ls -la' });
    expect(status.action).toBe('executing_command');
    expect(status.detail).toBe('ls -la');
  });

  it('defaults to thinking for unknown tools', () => {
    const status = statusFromToolCall('unknown_tool', {});
    expect(status.action).toBe('thinking');
    expect(status.detail).toBeUndefined();
  });

  it('includes startedAt timestamp', () => {
    const before = Date.now();
    const status = statusFromToolCall('read_file', { path: 'test.ts' });
    const after = Date.now();

    expect(status.startedAt).toBeGreaterThanOrEqual(before);
    expect(status.startedAt).toBeLessThanOrEqual(after);
  });
});
