/**
 * Qwen Portal Device Code OAuth handler.
 *
 * Ported from OpenClaw's extensions/qwen-portal-auth/oauth.ts.
 * Free-tier access to Qwen Coder + Vision via device code flow.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spinner, note } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult, ProviderAuthMethod } from './registry';

const QWEN_BASE = 'https://chat.qwen.ai';
const DEVICE_CODE_EP = `${QWEN_BASE}/api/v1/oauth2/device/code`;
const TOKEN_EP = `${QWEN_BASE}/api/v1/oauth2/token`;
const CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const SCOPE = 'openid profile email model.completion';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function generatePkce() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

function toForm(d: Record<string, string>) {
    return Object.entries(d).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export const qwenPortalAuth: ProviderAuthMethod = {
    id: 'device-code',
    label: 'Qwen OAuth (free tier)',
    hint: 'Device code flow via chat.qwen.ai',
    kind: 'device_code',
    run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
        const { verifier, challenge } = generatePkce();

        // 1. Request device code
        const dcRes = await fetch(DEVICE_CODE_EP, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-request-id': randomUUID() },
            body: toForm({ client_id: CLIENT_ID, scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256' }),
        });
        if (!dcRes.ok) throw new Error(`Qwen device code failed: ${await dcRes.text()}`);

        const device = await dcRes.json() as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval?: number };
        const verifyUrl = device.verification_uri_complete || device.verification_uri;

        note(`Open ${verifyUrl} to approve access.\nIf prompted, enter the code ${device.user_code}.`, 'Qwen OAuth');
        try { await ctx.openUrl(verifyUrl); } catch { /* manual */ }

        // 2. Poll for token
        const spin = spinner();
        spin.start('Waiting for Qwen OAuth approval…');
        let intervalMs = device.interval ? device.interval * 1000 : 2000;
        const deadline = Date.now() + device.expires_in * 1000;

        while (Date.now() < deadline) {
            const tokRes = await fetch(TOKEN_EP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: toForm({ grant_type: GRANT_TYPE, client_id: CLIENT_ID, device_code: device.device_code, code_verifier: verifier }),
            });

            if (tokRes.ok) {
                const tok = await tokRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number; resource_url?: string };
                if (tok.access_token && tok.refresh_token && tok.expires_in) {
                    spin.stop('Qwen OAuth approved ✓');

                    const profileId = defaultProfileId('qwen-portal');
                    const cred = {
                        type: 'oauth' as const,
                        provider: 'qwen-portal',
                        access: tok.access_token,
                        refresh: tok.refresh_token,
                        expires: Date.now() + tok.expires_in * 1000,
                        resourceUrl: tok.resource_url,
                    };
                    upsertAuthProfile(profileId, cred);
                    return { profileId, credential: cred, defaultModel: 'qwen-portal/coder-model' };
                }
            }

            // Check for pending / slow_down
            try {
                const errBody = await tokRes.json() as { error?: string };
                if (errBody.error === 'slow_down') intervalMs = Math.min(intervalMs * 1.5, 10000);
                else if (errBody.error !== 'authorization_pending') {
                    spin.stop('Qwen OAuth failed');
                    throw new Error(`Qwen OAuth error: ${errBody.error}`);
                }
            } catch { /* continue polling */ }

            await new Promise(r => setTimeout(r, intervalMs));
        }

        spin.stop('Timed out');
        throw new Error('Qwen OAuth timed out waiting for authorization.');
    },
};
