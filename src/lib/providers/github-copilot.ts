/**
 * GitHub Copilot Device Code OAuth handler.
 *
 * Ported from OpenClaw's src/providers/github-copilot-auth.ts.
 * Uses GitHub's device code flow (RFC 8628) to authenticate.
 */
import { spinner, note } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult, ProviderAuthMethod } from './registry';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        scope: 'read:user',
    });

    const res = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (!res.ok) {
        throw new Error(`GitHub device code failed: HTTP ${res.status}`);
    }

    const json = await res.json() as DeviceCodeResponse;
    if (!json.device_code || !json.user_code || !json.verification_uri) {
        throw new Error('GitHub device code response missing fields');
    }
    return json;
}

async function pollForAccessToken(params: {
    deviceCode: string;
    intervalMs: number;
    expiresAt: number;
}): Promise<string> {
    const bodyBase = new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: params.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    while (Date.now() < params.expiresAt) {
        const res = await fetch(ACCESS_TOKEN_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: bodyBase,
        });

        if (!res.ok) {
            throw new Error(`GitHub device token failed: HTTP ${res.status}`);
        }

        const json = await res.json() as Record<string, string>;
        if ('access_token' in json && typeof json.access_token === 'string') {
            return json.access_token;
        }

        const err = json.error ?? 'unknown';
        if (err === 'authorization_pending') {
            await new Promise(r => setTimeout(r, params.intervalMs));
            continue;
        }
        if (err === 'slow_down') {
            await new Promise(r => setTimeout(r, params.intervalMs + 2000));
            continue;
        }
        if (err === 'expired_token') {
            throw new Error('GitHub device code expired; run login again');
        }
        if (err === 'access_denied') {
            throw new Error('GitHub login cancelled');
        }
        throw new Error(`GitHub device flow error: ${err}`);
    }

    throw new Error('GitHub device code expired; run login again');
}

export const githubCopilotAuth: ProviderAuthMethod = {
    id: 'device-code',
    label: 'GitHub Device Code (browser)',
    hint: 'Opens github.com/login/device in your browser',
    kind: 'device_code',
    run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
        const spin = spinner();
        spin.start('Requesting device code from GitHub...');
        const device = await requestDeviceCode();
        spin.stop('Device code ready');

        note(
            `Visit: ${device.verification_uri}\nCode:  ${device.user_code}`,
            'GitHub Copilot Authorization',
        );

        try { await ctx.openUrl(device.verification_uri); } catch { /* manual fallback */ }

        const expiresAt = Date.now() + device.expires_in * 1000;
        const intervalMs = Math.max(1000, device.interval * 1000);

        const polling = spinner();
        polling.start('Waiting for GitHub authorization...');
        const accessToken = await pollForAccessToken({
            deviceCode: device.device_code,
            intervalMs,
            expiresAt,
        });
        polling.stop('GitHub access token acquired ✓');

        const profileId = defaultProfileId('github-copilot');
        upsertAuthProfile(profileId, {
            type: 'token',
            provider: 'github-copilot',
            token: accessToken,
        });

        return {
            profileId,
            credential: {
                type: 'token',
                provider: 'github-copilot',
                token: accessToken,
            },
        };
    },
};
