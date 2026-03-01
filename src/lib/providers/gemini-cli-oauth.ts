/**
 * Google Gemini CLI OAuth handler.
 *
 * Ported from OpenClaw's extensions/google-gemini-cli-auth/oauth.ts.
 * Extracts OAuth client credentials from the installed Gemini CLI binary,
 * runs a standard Google OAuth2 PKCE flow with a localhost callback server.
 *
 * ⚠ UNOFFICIAL INTEGRATION — Some users have reported Google account
 * restrictions. Use a non-critical account.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join } from 'node:path';
import { spinner, note } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult, ProviderAuthMethod } from './registry';

const REDIRECT_URI = 'http://localhost:8085/oauth2callback';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

// ---------------------------------------------------------------------------
// Extract credentials from installed Gemini CLI
// ---------------------------------------------------------------------------

function findInPath(name: string): string | null {
    const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        for (const ext of exts) {
            const p = join(dir, name + ext);
            if (existsSync(p)) return p;
        }
    }
    return null;
}

function findFile(dir: string, name: string, depth: number): string | null {
    if (depth <= 0) return null;
    try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isFile() && e.name === name) return p;
            if (e.isDirectory() && !e.name.startsWith('.')) {
                const found = findFile(p, name, depth - 1);
                if (found) return found;
            }
        }
    } catch { /* ignore */ }
    return null;
}

function extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null {
    try {
        const geminiPath = findInPath('gemini');
        if (!geminiPath) return null;

        const resolvedPath = realpathSync(geminiPath);
        const binDir = dirname(geminiPath);
        const candidates = [
            dirname(dirname(resolvedPath)),
            join(dirname(resolvedPath), 'node_modules', '@google', 'gemini-cli'),
            join(binDir, 'node_modules', '@google', 'gemini-cli'),
            join(dirname(binDir), 'node_modules', '@google', 'gemini-cli'),
            join(dirname(binDir), 'lib', 'node_modules', '@google', 'gemini-cli'),
        ];

        for (const base of candidates) {
            const searchPaths = [
                join(base, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
                join(base, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'code_assist', 'oauth2.js'),
            ];
            for (const p of searchPaths) {
                if (existsSync(p)) {
                    const content = readFileSync(p, 'utf8');
                    const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
                    const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
                    if (idMatch && secretMatch) return { clientId: idMatch[1], clientSecret: secretMatch[1] };
                }
            }
            const found = findFile(base, 'oauth2.js', 10);
            if (found) {
                const content = readFileSync(found, 'utf8');
                const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
                const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
                if (idMatch && secretMatch) return { clientId: idMatch[1], clientSecret: secretMatch[1] };
            }
        }
    } catch { /* not installed */ }
    return null;
}

// ---------------------------------------------------------------------------
// OAuth Flow
// ---------------------------------------------------------------------------

function generatePkce() {
    const verifier = randomBytes(32).toString('hex');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

function buildAuthUrl(clientId: string, challenge: string, verifier: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: verifier,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${AUTH_URL}?${params}`;
}

function waitForCallback(expectedState: string, timeoutMs: number): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
        let timeout: NodeJS.Timeout | null = null;
        const server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', `http://localhost:8085`);
            if (url.pathname !== '/oauth2callback') { res.statusCode = 404; res.end('Not found'); return; }

            const error = url.searchParams.get('error');
            const code = url.searchParams.get('code')?.trim();
            const state = url.searchParams.get('state')?.trim();

            if (error) { finish(new Error(`OAuth error: ${error}`)); res.statusCode = 400; res.end('Error'); return; }
            if (!code || !state || state !== expectedState) { finish(new Error('OAuth mismatch')); res.statusCode = 400; res.end('Bad'); return; }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end('<h2>Gemini CLI OAuth complete</h2><p>You can close this window.</p>');
            finish(undefined, { code });
        });

        const finish = (err?: Error, result?: { code: string }) => {
            if (timeout) clearTimeout(timeout);
            try { server.close(); } catch { /* */ }
            if (err) reject(err); else if (result) resolve(result);
        };

        server.once('error', (err) => finish(err instanceof Error ? err : new Error('Server error')));
        server.listen(8085, 'localhost');
        timeout = setTimeout(() => finish(new Error('OAuth callback timeout')), timeoutMs);
    });
}

async function exchangeToken(code: string, verifier: string, clientId: string, clientSecret?: string) {
    const body = new URLSearchParams({
        client_id: clientId,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: '*/*' },
        body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
    return await res.json() as { access_token: string; refresh_token: string; expires_in: number };
}

// ---------------------------------------------------------------------------
// Auth Method export
// ---------------------------------------------------------------------------

export const geminiCliOAuth: ProviderAuthMethod = {
    id: 'gemini-cli-oauth',
    label: 'Gemini CLI OAuth (Google sign-in)',
    hint: 'Extracts credentials from installed Gemini CLI, opens browser for Google OAuth',
    kind: 'oauth',
    run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
        const creds = extractGeminiCliCredentials();
        if (!creds) {
            throw new Error(
                'Gemini CLI not found. Install it first:\n' +
                '  npm install -g @google/gemini-cli\n' +
                'Or set GEMINI_CLI_OAUTH_CLIENT_ID environment variable.'
            );
        }

        note(
            '⚠  UNOFFICIAL INTEGRATION\n' +
            'This uses the Gemini CLI\'s OAuth credentials.\n' +
            'Some users have reported Google account restrictions.\n' +
            'Use a non-critical Google account.',
            'Gemini CLI OAuth Warning',
        );

        const spin = spinner();
        spin.start('Starting OAuth flow...');

        const { verifier, challenge } = generatePkce();
        const authUrl = buildAuthUrl(creds.clientId, challenge, verifier);

        spin.stop('OAuth URL ready');
        ctx.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
        try { await ctx.openUrl(authUrl); } catch { /* manual fallback */ }

        const polling = spinner();
        polling.start('Waiting for OAuth callback on localhost:8085...');
        const { code } = await waitForCallback(verifier, 5 * 60 * 1000);
        polling.stop('Authorization code received');

        const exSpin = spinner();
        exSpin.start('Exchanging code for tokens...');
        const tokens = await exchangeToken(code, verifier, creds.clientId, creds.clientSecret);
        exSpin.stop('Tokens acquired ✓');

        const profileId = defaultProfileId('google-gemini-cli');
        const credential = {
            type: 'oauth' as const,
            provider: 'google-gemini-cli',
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000,
        };
        upsertAuthProfile(profileId, credential);

        return {
            profileId,
            credential,
            defaultModel: 'gemini-3.1-pro',
            notes: ['Gemini CLI OAuth tokens stored. Use with caution on non-critical accounts.'],
        };
    },
};
