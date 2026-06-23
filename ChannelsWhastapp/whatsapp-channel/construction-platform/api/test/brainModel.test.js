import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initBrainModel } from '../src/brain/claudeClient.js';
import { modelAvailable, resetModelClient, callModel, setModelClient } from '../src/brain/model.js';

describe('brain model seam + Claude wiring', () => {
  beforeEach(() => resetModelClient());
  afterEach(() => { resetModelClient(); delete process.env.ANTHROPIC_API_KEY; });

  it('stays on the deterministic fallback when no API key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(initBrainModel()).toBe(false);
    expect(modelAvailable()).toBe(false);
  });

  it('installs a live client when ANTHROPIC_API_KEY is present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    expect(initBrainModel()).toBe(true);
    expect(modelAvailable()).toBe(true);
  });

  it('callModel returns null (not throw) when the client errors', async () => {
    setModelClient(async () => { throw new Error('network'); });
    expect(await callModel({ prompt: 'hi' })).toBeNull();
  });

  it('callModel passes through a string result', async () => {
    setModelClient(async ({ prompt }) => `echo: ${prompt}`);
    expect(await callModel({ prompt: 'hi' })).toBe('echo: hi');
  });
});
