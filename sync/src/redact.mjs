// Tokens never reach a log line, an error message or stdout (#151 AC1).
//
// Two layers: known secret values are replaced wherever they appear, and any
// JSON field named like a credential is masked whatever its value. The first
// catches a token echoed inside prose; the second catches one we never saw.

/** Every value registered here is scrubbed from redact()'s output. */
const known = new Set();

export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) known.add(value);
}

/** For tests only. */
export function clearSecrets() {
  known.clear();
}

export function redact(text) {
  let out = String(text ?? '');
  for (const secret of known) out = out.split(secret).join('[redacted]');
  out = out.replace(
    /("(?:access_token|refresh_token|id_token|device_code|code_verifier|client_secret)"\s*:\s*")[^"]*(")/gi,
    '$1[redacted]$2',
  );
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[redacted]');
  // A FIT download URL downloads with no credentials (sync plan §2), so it is
  // a secret, and the sync never asks for one (#154). Masked anyway, in case
  // COROS ever puts one in an error or a payload.
  out = out.replace(/(?:https?:\/\/)?s3\.coros\.com\/fit\/[^\s"'<>)\]]*/gi, '[fit-url redacted]');
  return out;
}

