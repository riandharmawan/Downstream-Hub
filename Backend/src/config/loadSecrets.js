/**
 * Load secrets from a secret manager at startup and set process.env.
 * When USE_SECRET_MANAGER=alicloud, fetches a single JSON secret from Alibaba Cloud KMS
 * and sets each key as an env var. Otherwise does nothing.
 *
 * Required for Alicloud: ALICLOUD_SECRET_NAME, ALICLOUD_REGION, and either
 * ALICLOUD_ACCESS_KEY_ID + ALICLOUD_ACCESS_KEY_SECRET, or an ECS RAM role.
 * Optional: install @alicloud/kms20160120 when using Alicloud.
 */
async function loadSecrets() {
  const provider = process.env.USE_SECRET_MANAGER;
  if (!provider || provider !== 'alicloud') {
    return;
  }

  const secretName = process.env.ALICLOUD_SECRET_NAME;
  const region = process.env.ALICLOUD_REGION || 'cn-hangzhou';
  if (!secretName) {
    throw new Error('USE_SECRET_MANAGER=alicloud requires ALICLOUD_SECRET_NAME');
  }

  let KmsClient;
  try {
    const kms = require('@alicloud/kms20160120');
    KmsClient = kms.default || kms;
  } catch (e) {
    throw new Error(
      'USE_SECRET_MANAGER=alicloud is set but @alicloud/kms20160120 is not installed. Run: npm install @alicloud/kms20160120'
    );
  }

  const accessKeyId = process.env.ALICLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALICLOUD_ACCESS_KEY_SECRET;
  const config = {
    endpoint: `kms.${region}.aliyuncs.com`,
    regionId: region,
  };
  if (accessKeyId && accessKeySecret) {
    config.accessKeyId = accessKeyId;
    config.accessKeySecret = accessKeySecret;
  }
  // If no AccessKey, the SDK may use ECS instance RAM role automatically in Alicloud.

  const client = new KmsClient(config);
  const res = await client.getSecretValue({
    secretName,
  });

  const secretData = res?.body?.secretData ?? res?.body?.SecretData;
  if (!secretData) {
    throw new Error('Alibaba Cloud GetSecretValue returned no secretData');
  }

  let data;
  try {
    data = JSON.parse(secretData);
  } catch (e) {
    throw new Error('ALICLOUD_SECRET_NAME secret value must be valid JSON');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('ALICLOUD_SECRET_NAME secret value must be a JSON object');
  }

  for (const [key, value] of Object.entries(data)) {
    if (value != null && typeof value === 'string') {
      process.env[key] = value;
    }
  }
}

module.exports = { loadSecrets };
