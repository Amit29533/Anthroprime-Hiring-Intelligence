export const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
  body: JSON.stringify(body),
});

export function requestBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

export function publicError(error) {
  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode >= 500) console.error(error);
  return json(statusCode, {
    error: statusCode >= 500 ? 'Document storage is temporarily unavailable.' : error.message,
  });
}

export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
