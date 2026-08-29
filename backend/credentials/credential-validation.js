import {
  validateProviderKey,
  checkValidateRateLimit,
  checkRevealRateLimit,
  normalizeApiKeySecret,
} from '../../src/core/secret-validators.js';
import { validateR2ByokCredentials } from '../../src/core/storage-byok-test.js';

export {
  validateProviderKey,
  checkValidateRateLimit,
  checkRevealRateLimit,
  normalizeApiKeySecret,
};

/**
 * @param {object} params
 * @param {string} params.cfAccountId
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @param {string|null} [params.bucketName]
 */
export async function validateR2CredentialBundle(params) {
  return validateR2ByokCredentials({
    cfAccountId: params.cfAccountId,
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    bucketName: params.bucketName ?? undefined,
  });
}
