import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  ToolInterceptor,
  createToolInterceptor,
  createReadFileArtifact,
  createEditArtifact,
  createSearchArtifact,
  createErrorArtifact,
  createArtifactFromToolResult,
  type ToolCall,
  type ToolResult,
  type EventEmitter,
} from './tool-interceptor.js';
import type { StatusEvent, ArtifactEvent } from './events.js';

describe('ToolInterceptor', () => {
  let emittedEvents: (StatusEvent | ArtifactEvent)[];
  let emitter: EventEmitter;

  beforeEach(() => {
    emittedEvents = [];
    emitter = (event) => emittedEvents.push(event);
  });

  describe('constructor', () => {
    it('accepts an EventEmitter function directly', () => {
      const interceptor = new ToolInterceptor(emitter);
      expect(interceptor).toBeInstanceOf(ToolInterceptor);
    });

    it('accepts a config object', () => {
      const interceptor = new ToolInterceptor({
        onEvent: emitter,
        emitStatus: true,
        emitArtifacts: true,
      });
      expect(interceptor).toBeInstanceOf(ToolInterceptor);
    });
  });

  describe('execute', () => {
    it('emits status event before execution', async () => {
      const interceptor = new ToolInterceptor(emitter);
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'src/index.ts' },
      };
      const executor = mock(() =>
        Promise.resolve({ content: 'file content', success: true }),
      );

      await interceptor.execute(toolCall, executor);

      expect(emittedEvents.length).toBeGreaterThanOrEqual(1);
      const statusEvent = emittedEvents[0] as StatusEvent;
      expect(statusEvent.type).toBe('status');
      expect(statusEvent.action).toBe('reading_file');
      expect(statusEvent.detail).toBe('src/index.ts');
    });

    it('emits artifact event after execution for read_file', async () => {
      const interceptor = new ToolInterceptor(emitter);
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'src/index.ts' },
      };
      const executor = mock(() =>
        Promise.resolve({ content: 'console.log("hello")', success: true }),
      );

      await interceptor.execute(toolCall, executor);

      expect(emittedEvents.length).toBe(2);
      const artifactEvent = emittedEvents[1] as ArtifactEvent;
      expect(artifactEvent.type).toBe('artifact');
      expect(artifactEvent.artifact_type).toBe('code');
    });

    it('emits error artifact on execution failure', async () => {
      const interceptor = new ToolInterceptor(emitter);
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'nonexistent.ts' },
      };
      const executor = mock(() => Promise.reject(new Error('File not found')));

      const result = await interceptor.execute(toolCall, executor);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');

      // Should have status + error artifact
      expect(emittedEvents.length).toBe(2);
      const errorArtifact = emittedEvents[1] as ArtifactEvent;
      expect(errorArtifact.artifact_type).toBe('error');
      expect((errorArtifact as any).message).toBe('File not found');
    });

    it('skips status events when emitStatus is false', async () => {
      const interceptor = new ToolInterceptor({
        onEvent: emitter,
        emitStatus: false,
        emitArtifacts: true,
      });
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'src/index.ts' },
      };
      const executor = mock(() =>
        Promise.resolve({ content: 'content', success: true }),
      );

      await interceptor.execute(toolCall, executor);

      // Should only have artifact, no status
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].type).toBe('artifact');
    });

    it('skips artifact events when emitArtifacts is false', async () => {
      const interceptor = new ToolInterceptor({
        onEvent: emitter,
        emitStatus: true,
        emitArtifacts: false,
      });
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'src/index.ts' },
      };
      const executor = mock(() =>
        Promise.resolve({ content: 'content', success: true }),
      );

      await interceptor.execute(toolCall, executor);

      // Should only have status, no artifact
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].type).toBe('status');
    });

    it('returns the executor result', async () => {
      const interceptor = new ToolInterceptor(emitter);
      const toolCall: ToolCall = {
        name: 'read_file',
        args: { path: 'test.ts' },
      };
      const expectedResult: ToolResult = {
        content: 'test content',
        success: true,
      };
      const executor = mock(() => Promise.resolve(expectedResult));

      const result = await interceptor.execute(toolCall, executor);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('wrap', () => {
    it('creates a wrapped executor', async () => {
      const interceptor = new ToolInterceptor(emitter);
      const originalExecutor = mock(() =>
        Promise.resolve({ content: 'result', success: true }),
      );

      const wrappedExecutor = interceptor.wrap(originalExecutor);
      const toolCall: ToolCall = { name: 'Read', args: { file_path: 'test.ts' } };

      await wrappedExecutor(toolCall);

      expect(originalExecutor).toHaveBeenCalledWith(toolCall);
      expect(emittedEvents.length).toBe(2); // status + artifact
    });
  });
});

describe('createToolInterceptor', () => {
  it('creates a ToolInterceptor instance', () => {
    const interceptor = createToolInterceptor(() => {});
    expect(interceptor).toBeInstanceOf(ToolInterceptor);
  });
});

describe('createReadFileArtifact', () => {
  it('creates CodeArtifact for TypeScript files', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'src/utils.ts' },
    };
    const result: ToolResult = {
      content: 'export function foo() {}',
      success: true,
    };

    const artifact = createReadFileArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('code');
    expect((artifact as any).language).toBe('typescript');
    expect((artifact as any).file).toBe('src/utils.ts');
    expect((artifact as any).content).toBe('export function foo() {}');
  });

  it('creates CodeArtifact for Python files', () => {
    const toolCall: ToolCall = {
      name: 'Read',
      args: { file_path: 'script.py' },
    };
    const result: ToolResult = {
      content: 'def main(): pass',
      success: true,
    };

    const artifact = createReadFileArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('code');
    expect((artifact as any).language).toBe('python');
  });

  it('creates FileArtifact for unknown file types', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'README' },
    };
    const result: ToolResult = {
      content: 'This is a readme',
      success: true,
    };

    const artifact = createReadFileArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('file');
    expect((artifact as any).path).toBe('README');
  });

  it('returns undefined for failed results', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'test.ts' },
    };
    const result: ToolResult = {
      content: '',
      success: false,
      error: 'File not found',
    };

    const artifact = createReadFileArtifact(toolCall, result);

    expect(artifact).toBeUndefined();
  });

  it('returns undefined when file path is missing', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: {},
    };
    const result: ToolResult = {
      content: 'some content',
      success: true,
    };

    const artifact = createReadFileArtifact(toolCall, result);

    expect(artifact).toBeUndefined();
  });
});

describe('createEditArtifact', () => {
  it('creates DiffArtifact with old and new strings', () => {
    const toolCall: ToolCall = {
      name: 'Edit',
      args: {
        file_path: 'src/index.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
      },
    };
    const result: ToolResult = { content: 'success', success: true };

    const artifact = createEditArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('diff');
    expect(artifact!.file).toBe('src/index.ts');
    expect(artifact!.diff).toContain('-const x = 1;');
    expect(artifact!.diff).toContain('+const x = 2;');
  });

  it('creates fallback DiffArtifact without old/new strings', () => {
    const toolCall: ToolCall = {
      name: 'edit_file',
      args: { path: 'config.json' },
    };
    const result: ToolResult = { content: 'edited', success: true };

    const artifact = createEditArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('diff');
    expect(artifact!.diff).toContain('Edit applied');
  });

  it('returns undefined when file path is missing', () => {
    const toolCall: ToolCall = {
      name: 'Edit',
      args: {},
    };
    const result: ToolResult = { content: '', success: true };

    const artifact = createEditArtifact(toolCall, result);

    expect(artifact).toBeUndefined();
  });
});

describe('createSearchArtifact', () => {
  it('parses ripgrep-style output', () => {
    const toolCall: ToolCall = {
      name: 'Grep',
      args: { pattern: 'TODO' },
    };
    const result: ToolResult = {
      content: 'src/index.ts:10:// TODO: fix this\nsrc/utils.ts:25:// TODO: refactor',
      success: true,
    };

    const artifact = createSearchArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('search_results');
    expect(artifact!.query).toBe('TODO');
    expect(artifact!.results).toHaveLength(2);
    expect(artifact!.results[0]).toEqual({
      file: 'src/index.ts',
      line: 10,
      content: '// TODO: fix this',
    });
  });

  it('handles pre-structured results', () => {
    const toolCall: ToolCall = {
      name: 'grep',
      args: { pattern: 'error' },
    };
    const result: ToolResult = {
      content: [
        { file: 'src/error.ts', line: 5, content: 'throw new Error()' },
      ],
      success: true,
    };

    const artifact = createSearchArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.results).toHaveLength(1);
    expect(artifact!.results[0].file).toBe('src/error.ts');
  });

  it('uses query from pattern or query args', () => {
    const toolCall: ToolCall = {
      name: 'Glob',
      args: { path: '**/*.ts' },
    };
    const result: ToolResult = {
      content: 'src/index.ts\nsrc/utils.ts',
      success: true,
    };

    const artifact = createSearchArtifact(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.query).toBe('**/*.ts');
  });

  it('returns undefined for failed results', () => {
    const toolCall: ToolCall = {
      name: 'grep',
      args: { pattern: 'test' },
    };
    const result: ToolResult = {
      content: '',
      success: false,
      error: 'Search failed',
    };

    const artifact = createSearchArtifact(toolCall, result);

    expect(artifact).toBeUndefined();
  });
});

describe('createErrorArtifact', () => {
  it('creates an ErrorArtifact with message', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'missing.ts' },
    };

    const artifact = createErrorArtifact(toolCall, 'File not found');

    expect(artifact.type).toBe('artifact');
    expect(artifact.artifact_type).toBe('error');
    expect(artifact.message).toBe('File not found');
    expect(artifact.title).toBe('Error: read_file');
  });

  it('includes stack trace when provided', () => {
    const toolCall: ToolCall = {
      name: 'bash',
      args: { command: 'exit 1' },
    };

    const artifact = createErrorArtifact(
      toolCall,
      'Command failed',
      'Error: Command failed\n    at execute (/app/executor.ts:10:5)',
    );

    expect(artifact.stack).toContain('executor.ts');
  });
});

describe('createArtifactFromToolResult', () => {
  it('routes read_file to createReadFileArtifact', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'test.ts' },
    };
    const result: ToolResult = {
      content: 'code here',
      success: true,
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('code');
  });

  it('routes Read to createReadFileArtifact', () => {
    const toolCall: ToolCall = {
      name: 'Read',
      args: { file_path: 'test.py' },
    };
    const result: ToolResult = {
      content: 'print("hello")',
      success: true,
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('code');
  });

  it('routes Edit to createEditArtifact', () => {
    const toolCall: ToolCall = {
      name: 'Edit',
      args: { file_path: 'test.ts', old_string: 'a', new_string: 'b' },
    };
    const result: ToolResult = { content: '', success: true };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('diff');
  });

  it('routes Grep to createSearchArtifact', () => {
    const toolCall: ToolCall = {
      name: 'Grep',
      args: { pattern: 'test' },
    };
    const result: ToolResult = {
      content: 'test.ts:1:test',
      success: true,
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('search_results');
  });

  it('routes Glob to createSearchArtifact', () => {
    const toolCall: ToolCall = {
      name: 'Glob',
      args: { pattern: '*.ts' },
    };
    const result: ToolResult = {
      content: 'index.ts\nutils.ts',
      success: true,
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('search_results');
  });

  it('creates ErrorArtifact for failed results', () => {
    const toolCall: ToolCall = {
      name: 'read_file',
      args: { path: 'missing.ts' },
    };
    const result: ToolResult = {
      content: '',
      success: false,
      error: 'File not found',
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeDefined();
    expect(artifact!.artifact_type).toBe('error');
  });

  it('returns undefined for tools without artifact mapping', () => {
    const toolCall: ToolCall = {
      name: 'unknown_tool',
      args: {},
    };
    const result: ToolResult = {
      content: 'something',
      success: true,
    };

    const artifact = createArtifactFromToolResult(toolCall, result);

    expect(artifact).toBeUndefined();
  });

  it('returns undefined for bash/write_file tools', () => {
    const bashCall: ToolCall = {
      name: 'bash',
      args: { command: 'ls' },
    };
    const writeCall: ToolCall = {
      name: 'Write',
      args: { file_path: 'out.txt', content: 'data' },
    };
    const result: ToolResult = { content: '', success: true };

    expect(createArtifactFromToolResult(bashCall, result)).toBeUndefined();
    expect(createArtifactFromToolResult(writeCall, result)).toBeUndefined();
  });
});
