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
