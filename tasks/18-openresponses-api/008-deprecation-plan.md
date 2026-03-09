# Task 008: Chat Completions Deprecation Plan

**Epic:** 18 - OpenResponses API Integration  
**Status:** 📋 Planned (Phase 1 infrastructure complete; rollout pending field testing)
**Depends on:** 007 (Integration Testing)

## Objective

Plan and execute the gradual deprecation of the `/v1/chat/completions` endpoint in favor of the native `/v1/responses` (OpenResponses) endpoint.

## Deprecation Strategy

### Phase 1: Dual Support (Current)

**Status:** Implementation in progress

- Both `chat()` and `respond()` methods available
- `chat()` is default (backward compatibility)
- `respond()` available via flag: `USE_OPENRESPONSES=true`
- No code removal

**Duration:** 2-4 weeks (field testing)

### Phase 2: OpenResponses Default

**Status:** Planned

- Switch default to `respond()` method
- Keep `chat()` available as fallback
- Environment variable: `USE_CHAT_COMPLETIONS=true` (for rollback)
- Add deprecation warnings in logs

**Duration:** 2-4 weeks (monitor for issues)

### Phase 3: Remove Chat Completions

**Status:** Future

- Remove `chat()` method entirely
- Remove Chat Completions support from `OpenClawClient`
- Update all documentation
- Final migration complete

**Duration:** After Phase 2 completes successfully

## Migration Timeline

```
Week 1-2:  Implementation (Tasks 002-006)
Week 3-4:  Integration Testing (Task 007)
Week 5-8:  Phase 1 (Dual Support, opt-in)
Week 9-12: Phase 2 (OpenResponses default, opt-out)
Week 13+:  Phase 3 (Remove Chat Completions)
```

## Code Changes

### Phase 1: Current

```typescript
// Both methods available
const client = new OpenClawClient({ baseUrl, apiKey });

// Default
const stream = client.chat({ messages });

// Opt-in
const stream = client.respond({ input });
```

### Phase 2: OpenResponses Default

```typescript
// Deprecation warning
async *chat(options: OpenClawChatOptions) {
  logger.warn('chat() is deprecated. Use respond() instead. Set USE_CHAT_COMPLETIONS=true to suppress this warning.');
  
  // Redirect to respond() unless explicitly requested
  if (process.env.USE_CHAT_COMPLETIONS !== 'true') {
    return this.respondAsChat(options);
  }

  // Old path (for rollback)
  return this.chatViaCompletions(options);
}
```

### Phase 3: Removal

```typescript
// Remove chat() method entirely
// Remove chatViaCompletions() internal method
// Remove ChatCompletions types and interfaces
// Update all consumers to use respond()
```

## Rollback Plan

If OpenResponses has critical issues in Phase 2:

### Immediate Rollback

```bash
# Set environment variable
export USE_CHAT_COMPLETIONS=true

# Restart voice agent
docker compose restart voice-agent
```

### Code Rollback

```bash
# Revert to Phase 1 commit
git revert <phase-2-commit>
git push origin main

# Redeploy
docker compose up -d --build
```

## Monitoring

Track metrics during migration:

### Key Metrics

- **Error rate:** Compare Chat Completions vs OpenResponses
- **Latency:** TTFT (time to first token)
- **Session drops:** Count of interrupted streams
- **User complaints:** Feedback via bug reports

### Alerting

Set up alerts for:
- Error rate spike (>5% increase)
- TTFT regression (>200ms slower)
- Session drop rate increase

### Logging

Add migration tracking:

```typescript
logger.info({
  endpoint: 'openresponses',  // or 'chat_completions'
  user: sessionUser,
  success: true,
  latency: ttft,
}, 'LLM request completed');
```

## Documentation Updates

### Phase 1

- Add OpenResponses section to README
- Document `USE_OPENRESPONSES` flag
- Keep Chat Completions docs

### Phase 2

- Mark Chat Completions as deprecated
- Recommend OpenResponses for new projects
- Document rollback procedure

### Phase 3

- Remove Chat Completions docs entirely
- Update all examples to use OpenResponses
- Archive migration guide

## Communication

### Internal Team

- Announce Phase 1 completion (dual support available)
- Share early testing results
- Announce Phase 2 switch (default change)
- Share rollback plan

### Users (if applicable)

- Blog post: "Migrating to OpenResponses"
- Changelog entry
- Deprecation timeline

## Risks & Mitigations

### Risk: Silent Failures

**Mitigation:**
- Comprehensive error handling (Task 006)
- Integration tests (Task 007)
- Gradual rollout with monitoring

### Risk: Performance Regression

**Mitigation:**
- Latency benchmarks before/after
- Field testing in Phase 1
- Easy rollback in Phase 2

### Risk: Session Routing Bugs

**Mitigation:**
- Unit tests for session key derivation
- Integration tests for multi-turn conversations
- Monitor session drop rate

## Success Criteria

### Phase 1
- [ ] Both endpoints work
- [ ] No regressions in voice pipeline
- [ ] Integration tests passing

### Phase 2
- [ ] OpenResponses is default
- [ ] Error rate stable
- [ ] TTFT within acceptable range
- [ ] No critical bugs

### Phase 3
- [ ] Chat Completions removed
- [ ] All consumers updated
- [ ] Documentation updated
- [ ] Clean codebase

## Files Modified

- `packages/livekit-agent-ganglia/src/client.ts` (deprecation warnings)
- `packages/livekit-agent-ganglia/README.md` (migration guide)
- `apps/voice-agent/README.md` (environment variables)

## Next Steps

After Phase 3 completion:
- Evaluate other OpenResponses features (images, files, etc.)
- Explore reasoning content parts for "pondering" status
- Consider OpenResponses for other OpenClaw integrations
