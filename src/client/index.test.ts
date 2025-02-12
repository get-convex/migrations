import { describe, test, expect } from 'vitest';
import { Migrations, DEFAULT_BATCH_SIZE } from './index.js';

describe('Migrations class', () => {
  test('can instantiate without error', () => {
    const dummyComponent: any = {};
    expect(() => new Migrations(dummyComponent)).not.toThrow();
  });
});

describe('DEFAULT_BATCH_SIZE', () => {
  test('should equal 100', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(100);
  });
});