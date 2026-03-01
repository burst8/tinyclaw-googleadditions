/**
 * MiniMax Portal Device Code OAuth handler.
 *
 * Ported from OpenClaw's extensions/minimax-portal-auth/oauth.ts.
 * Supports CN and Global regions.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spinner, note } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult, ProviderAuthMethod } from './registry';

type Region = 'cn' | 'global';

const CONFIG = {
    cn: { baseUrl: 'https://api.minimaxi.com', clientId: '78257093-7e40-4613-99e0-527b14b39113' },
    global: { baseUrl: 'https://api.minimax.io', clientId: '78257093-7e40-4613-99e0-527b14b39113' },
} as const;

const SCOPE = 'group_id profile model.completion';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';

function toForm(d: Record<string, string>) {
    return Object.entries(d).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function generatePkce() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    return { verifier, challenge, state };
}

function createMiniMaxAuth(region: Region): ProviderAuthMethod {
    const cfg = CONFIG[region];
    return {
        id: `device-code-${region}`,
        label: `MiniMax OAuth (${region === 'cn' ? 'China' : 'Global'})`,
        hint: `Device code flow via ${cfg.baseUrl}`,
        kind: 'device_code',
        run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            const { verifier, challenge, state } = generatePkce();

            // 1. Request code
            const codeRes = await fetch(`${cfg.baseUrl}/oauth/code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-request-id': randomUUID() },
                body: toForm({
                    response_type: 'code', client_id: cfg.clientId, scope: SCOPE,
                    code_challenge: challenge, code_challenge_method: 'S256', state,
                }),
            });
            if (!codeRes.ok) throw new Error(`MiniMax OAuth code failed: ${await codeRes.text()}`);

            const oauth = await codeRes.json() as { user_code: string; verification_uri: string; expired_in: number; interval?: number; state: string };
            if (oauth.state !== state) throw new Error('MiniMax OAuth state mismatch');

            note(`Open ${oauth.verification_uri} to approve access.\nIf prompted, enter: ${oauth.user_code}`, 'MiniMax OAuth');
            try { await ctx.openUrl(oauth.verification_uri); } catch { /* manual */ }

            // 2. Poll
            const spin = spinner();
            spin.start('Waiting for MiniMax OAuth approval…');
            let intervalMs = oauth.interval ?? 2000;

            while (Date.now() < oauth.expired_in) {
                const tokRes = await fetch(`${cfg.baseUrl}/oauth/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                    body: toForm({ grant_type: GRANT_TYPE, client_id: cfg.clientId, user_code: oauth.user_code, code_verifier: verifier }),
                });

                const text = await tokRes.text();
                let payload: any;
                try { payload = JSON.parse(text); } catch { /* continue */ }

                if (payload?.status === 'success' && payload.access_token && payload.refresh_token) {
                    spin.stop('MiniMax OAuth approved ✓');
                    const profileId = defaultProfileId('minimax-portal');
                    const cred = {
                        type: 'oauth' as const,
                        provider: 'minimax-portal',
                        access: payload.access_token,
                        refresh: payload.refresh_token,
                        expires: payload.expired_in,
                        resourceUrl: payload.resource_url,
                    };
                    upsertAuthProfile(profileId, cred);
                    return { profileId, credential: cred, defaultModel: 'minimax/minimax-m2.5', notes: payload.notification_message ? [payload.notification_message] : undefined };
                }

                if (payload?.status === 'error') { spin.stop('Failed'); throw new Error(`MiniMax OAuth failed: ${payload.base_resp?.status_msg ?? text}`); }

                intervalMs = Math.min(intervalMs * 1.5, 10000);
                await new Promise(r => setTimeout(r, intervalMs));
            }

            spin.stop('Timed out');
            throw new Error('MiniMax OAuth timed out.');
        },
    };
}

export const minimaxPortalAuthGlobal = createMiniMaxAuth('global');
export const minimaxPortalAuthCN = createMiniMaxAuth('cn');
