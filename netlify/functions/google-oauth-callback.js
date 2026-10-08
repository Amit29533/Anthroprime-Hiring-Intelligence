import { executionClient } from './_shared/execution.js';
import { collaborationRpc } from './_shared/collaboration-worker.js';
import {
  createGoogleAdapter,
  googleConfiguration,
  readOAuthState,
  seal,
  credentialAad,
} from './_shared/google-workspace.js';
export function createGoogleOAuthCallback({
  client = () => executionClient(4000),
  configuration = googleConfiguration,
  adapter = createGoogleAdapter,
} = {}) {
  return async (event) => {
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: 'GET required.' };
    try {
      const config = configuration(),
        state = readOAuthState(event.queryStringParameters?.state, config.key),
        db = client();
      const ticket = await collaborationRpc(db, 'oauth-claim', { ticket: state.ticket });
      const credentials = await adapter({
        config,
        before: () => collaborationRpc(db, 'oauth-gate', { ticket: state.ticket }),
      }).exchange(event.queryStringParameters?.code, state, ticket);
      await collaborationRpc(db, 'oauth-save', {
        ticket: state.ticket,
        account: ticket.account,
        credentials: seal(credentials, credentialAad(ticket), config.key),
      });
      return {
        statusCode: 200,
        headers,
        body: '<!doctype html><title>Google authorized</title><h1>Google account authorized</h1><p>Return to the application, run the diagnostic and review staging acceptance before enabling this connection.</p>',
      };
    } catch {
      return {
        statusCode: 400,
        headers,
        body: '<!doctype html><title>Authorization incomplete</title><h1>Google authorization incomplete</h1><p>The request expired, was already used, or did not match the configured account and scopes. Start a new authorization from the application.</p>',
      };
    }
  };
}
export const handler = createGoogleOAuthCallback();
