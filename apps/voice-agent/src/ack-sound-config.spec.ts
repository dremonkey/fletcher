import { describe, expect, it, mock } from 'bun:test';
import { resolveAckSound } from './ack-sound-config';

/** Minimal mock logger for testing. */
const mockLogger = {
  warn: mock(() => {}),
  info: mock(() => {}),
  debug: mock(() => {}),
  error: mock(() => {}),
  fatal: mock(() => {}),
  trace: mock(() => {}),
  child: mock(() => mockLogger),
  level: 'info',
} as any;

describe('resolveAckSound', () => {
  it('returns built-in tone when env is undefined', () => {
    const result = resolveAckSound(undefined, mockLogger);
    expect(result).toBeDefined();
    // Should be an AsyncIterable (the synthesized tone)
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe('function');
  });

  it('returns built-in tone when env is "builtin"', () => {
    const result = resolveAckSound('builtin', mockLogger);
    expect(result).toBeDefined();
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe('function');
  });

  it('returns built-in tone when env is "default"', () => {
    const result = resolveAckSound('default', mockLogger);
    expect(result).toBeDefined();
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe('function');
  });

  it('returns undefined when env is "disabled"', () => {
    expect(resolveAckSound('disabled', mockLogger)).toBeUndefined();
  });

  it('returns undefined when env is "off"', () => {
    expect(resolveAckSound('off', mockLogger)).toBeUndefined();
  });

  it('returns undefined when env is "none"', () => {
    expect(resolveAckSound('none', mockLogger)).toBeUndefined();
  });

  it('returns undefined when env is "false"', () => {
    expect(resolveAckSound('false', mockLogger)).toBeUndefined();
  });

  it('is case-insensitive for keywords', () => {
    expect(resolveAckSound('DISABLED', mockLogger)).toBeUndefined();
    expect(resolveAckSound('Builtin', mockLogger)).toBeDefined();
    expect(resolveAckSound('OFF', mockLogger)).toBeUndefined();
  });

  it('returns file path string when file exists', () => {
    // Use a file we know exists
    const result = resolveAckSound(import.meta.filename, mockLogger);
    expect(result).toBe(import.meta.filename);
  });

  it('falls back to built-in tone when file does not exist', () => {
    const result = resolveAckSound('/nonexistent/path/sound.ogg', mockLogger);
    expect(result).toBeDefined();
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe('function');
  });

  it('warns when file does not exist', () => {
    const warnMock = mock(() => {});
    const logger = { ...mockLogger, warn: warnMock } as any;
    resolveAckSound('/nonexistent/path/sound.ogg', logger);
    expect(warnMock).toHaveBeenCalled();
  });

  it('trims whitespace from env value', () => {
    expect(resolveAckSound('  disabled  ', mockLogger)).toBeUndefined();
    const result = resolveAckSound('  builtin  ', mockLogger);
    expect(result).toBeDefined();
  });
});
