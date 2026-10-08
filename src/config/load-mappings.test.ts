import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadApiMappings } from './load-mappings';
import { parse } from 'yaml';

vi.mock('fs');
vi.mock('path');
vi.mock('yaml');

const VALID_MAPPING = {
  source_api: 'openai',
  target_api: 'gemini',
  proxy_path_prefix: '/v1/chat/completions',
  target_base_url_env_var: 'GEMINI_API_BASE_URL',
  target_api_key_env_var: 'GEMINI_API_KEY',
};

describe('loadApiMappings', () => {
  const mockYamlContent = `
mappings:
  - source_api: openai
    target_api: gemini
    proxy_path_prefix: /v1/chat/completions
    target_base_url_env_var: GEMINI_API_BASE_URL
    target_api_key_env_var: GEMINI_API_KEY
  `;

  beforeEach(() => {
    vi.mocked(path.join).mockReturnValue('/mock/path/api-mappings.yaml');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should load and parse valid API mappings', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({ mappings: [VALID_MAPPING] });

    const result = loadApiMappings();

    expect(fs.readFileSync).toHaveBeenCalledWith(
      '/mock/path/api-mappings.yaml',
      'utf8'
    );
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].source_api).toBe('openai');
    expect(result.mappings[0].target_api).toBe('gemini');
  });

  it('should throw an error for invalid mappings structure', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('something_else: []');
    vi.mocked(parse).mockReturnValue({
      something_else: [{ not_a_mapping: true }],
    });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Invalid API mappings configuration:'
    );
  });

  it('should throw an error for incomplete mapping', () => {
    const { proxy_path_prefix, ...incomplete } = VALID_MAPPING;
    void proxy_path_prefix;
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({ mappings: [incomplete] });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Invalid API mappings configuration:\n- Invalid mapping at index 0: missing proxy_path_prefix'
    );
  });

  it('should throw an error for invalid provider name', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({
      mappings: [{ ...VALID_MAPPING, source_api: 'INVALID' }],
    });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Invalid API mappings configuration:'
    );
  });

  it('should accept a custom config path', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({ mappings: [VALID_MAPPING] });

    const customPath = '/custom/path/config.yaml';
    loadApiMappings(customPath);
    expect(fs.readFileSync).toHaveBeenCalledWith(customPath, 'utf8');
  });

  it('should throw an error when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => loadApiMappings()).toThrow(
      'Configuration file not found: /mock/path/api-mappings.yaml'
    );
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should handle permission denied errors properly', () => {
    const permissionError = new Error(
      'EACCES: permission denied'
    ) as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';

    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw permissionError;
    });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Permission denied: Cannot access /mock/path/api-mappings.yaml'
    );
  });

  it('should handle general file reading errors properly', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Some read error');
    });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Failed to read configuration file: /mock/path/api-mappings.yaml - Some read error'
    );
  });

  it('should throw an error for empty files', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('   \n  \t  ');

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Configuration file is empty: /mock/path/api-mappings.yaml'
    );
  });

  it('should handle YAML parsing errors', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('invalid: yaml: content: :');

    vi.mocked(parse).mockImplementation(() => {
      throw new Error('YAML parsing error');
    });

    expect(() => loadApiMappings()).toThrow(
      'Failed to load API mappings: Invalid YAML format in /mock/path/api-mappings.yaml: YAML parsing error'
    );
  });

  it('should detect additional properties', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
    vi.mocked(parse).mockReturnValue({
      mappings: [{ ...VALID_MAPPING, unknown_property: 'not allowed' }],
    });

    expect(() => loadApiMappings()).toThrow(
      "Failed to load API mappings: Invalid API mappings configuration:\n- Invalid mapping at index 0: unknown property 'unknown_property'"
    );
  });
});
