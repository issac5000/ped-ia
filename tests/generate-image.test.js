import test from 'node:test';
import assert from 'node:assert/strict';

import { generateImage, getImageModelCandidates, IMAGE_MODEL } from '../api/generate-image.js';

function resetImageEnv() {
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_IMAGE_MODELS;
}

function restoreEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test('generateImage fallback behaviour', async (t) => {
  await t.test('returns an image with the default model when available', async (t) => {
    const originalFetch = global.fetch;
    const originalModel = process.env.OPENAI_IMAGE_MODEL;
    const originalModels = process.env.OPENAI_IMAGE_MODELS;
    resetImageEnv();
    t.after(() => {
      global.fetch = originalFetch;
      restoreEnvValue('OPENAI_IMAGE_MODEL', originalModel);
      restoreEnvValue('OPENAI_IMAGE_MODELS', originalModels);
    });

    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ b64_json: 'ZmFrZUJhc2U2NA==' }] };
        },
      };
    };

    const result = await generateImage(
      { prompt: 'Dessine un soleil' },
      { apiKey: 'test', baseUrl: 'https://example.com' }
    );

    assert.equal(result.imageBase64, 'ZmFrZUJhc2U2NA==');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.model, IMAGE_MODEL);
    assert.equal(calls.length, 1);
    const sentBody = JSON.parse(calls[0].options.body);
    assert.equal(sentBody.model, IMAGE_MODEL);
    assert.match(calls[0].url, /\/v1\/images\/generations$/);
  });

  await t.test('falls back to an alternative model when the default is unavailable', async (t) => {
    const originalFetch = global.fetch;
    const originalModel = process.env.OPENAI_IMAGE_MODEL;
    const originalModels = process.env.OPENAI_IMAGE_MODELS;
    resetImageEnv();
    t.after(() => {
      global.fetch = originalFetch;
      restoreEnvValue('OPENAI_IMAGE_MODEL', originalModel);
      restoreEnvValue('OPENAI_IMAGE_MODELS', originalModels);
    });

    const triedModels = [];
    const responses = [
      {
        ok: false,
        status: 404,
        async json() {
          return {
            error: { message: 'The model `gpt-image-1` does not exist', code: 'model_not_found' },
          };
        },
      },
      {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ b64_json: 'YmFy' }] };
        },
      },
    ];

    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      triedModels.push(body.model);
      return responses.shift();
    };

    const result = await generateImage(
      { prompt: 'Dessine une fusée' },
      { apiKey: 'test', baseUrl: 'https://example.com' }
    );

    assert.equal(result.imageBase64, 'YmFy');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.model, 'dall-e-3');
    assert.deepEqual(triedModels, ['gpt-image-1', 'dall-e-3']);
  });

  await t.test('exposes tried models when all attempts fail', async (t) => {
    const originalFetch = global.fetch;
    const originalModel = process.env.OPENAI_IMAGE_MODEL;
    const originalModels = process.env.OPENAI_IMAGE_MODELS;
    resetImageEnv();
    t.after(() => {
      global.fetch = originalFetch;
      restoreEnvValue('OPENAI_IMAGE_MODEL', originalModel);
      restoreEnvValue('OPENAI_IMAGE_MODELS', originalModels);
    });

    global.fetch = async () => ({
      ok: false,
      status: 500,
      async json() {
        return { error: { message: 'Internal error' } };
      },
    });

    await assert.rejects(
      () =>
        generateImage({ prompt: 'Dessine un arbre' }, { apiKey: 'test', baseUrl: 'https://example.com' }),
      (error) => {
        assert.equal(error.status, 500);
        assert.ok(Array.isArray(error.triedModels));
        assert.equal(error.triedModels[0].model, IMAGE_MODEL);
        return true;
      }
    );
  });

  await t.test('handles Azure asynchronous image generation flow', async (t) => {
    const originalFetch = global.fetch;
    const originalModel = process.env.OPENAI_IMAGE_MODEL;
    const originalModels = process.env.OPENAI_IMAGE_MODELS;
    resetImageEnv();
    t.after(() => {
      global.fetch = originalFetch;
      restoreEnvValue('OPENAI_IMAGE_MODEL', originalModel);
      restoreEnvValue('OPENAI_IMAGE_MODELS', originalModels);
    });

    const calls = [];
    const headersMap = (values = {}) => ({
      get(name) {
        if (!name) return null;
        const lower = name.toLowerCase();
        const table = Object.create(null);
        for (const [key, value] of Object.entries(values)) {
          table[key.toLowerCase()] = value;
        }
        return table[lower] ?? null;
      },
    });

    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 202,
          headers: headersMap({
            'operation-location': 'https://demo-resource.openai.azure.com/openai/operations/images/op123?api-version=2024-02-01',
            'retry-after': '0',
          }),
          async json() {
            return { id: 'op123', status: 'notRunning' };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: headersMap(),
        async json() {
          return { status: 'succeeded', result: { data: [{ b64_json: 'YXp1cmVCYXNlNjQ=' }] } };
        },
      };
    };

    const result = await generateImage(
      { prompt: 'Dessine une fusée sur Azure' },
      { apiKey: 'test', baseUrl: 'https://demo-resource.openai.azure.com/openai', apiVersion: '2024-02-01' }
    );

    assert.equal(result.imageBase64, 'YXp1cmVCYXNlNjQ=');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.model, IMAGE_MODEL);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[1].options.method, 'GET');
    assert.match(calls[1].url, /operations\/images\/op123/i);
  });
});

// Sanity check: ensure helper exposes ordered candidates
// This avoids regressions if environment variables define custom models.
test('getImageModelCandidates merges overrides and defaults', () => {
  const originalModel = process.env.OPENAI_IMAGE_MODEL;
  const originalModels = process.env.OPENAI_IMAGE_MODELS;
  process.env.OPENAI_IMAGE_MODEL = 'custom-image';
  process.env.OPENAI_IMAGE_MODELS = 'beta,delta';

  try {
    const candidates = getImageModelCandidates({ requestedModel: 'preferred' });
    assert.deepEqual(candidates.slice(0, 5), ['preferred', 'custom-image', 'beta', 'delta', 'gpt-image-1']);
  } finally {
    restoreEnvValue('OPENAI_IMAGE_MODEL', originalModel);
    restoreEnvValue('OPENAI_IMAGE_MODELS', originalModels);
  }
});
