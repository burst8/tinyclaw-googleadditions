/**
 * Generic API key auth handler.
 *
 * Reusable for all providers that authenticate via a simple API key.
 * Uses @clack/prompts for an interactive terminal experience.
 */
import { text, isCancel, cancel } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult } from './registry';

export function createApiKeyAuthMethod(params: {
    provider: string;
    envVar: string;
    hint?: string;
}) {
    return {
        id: 'api-key',
        label: `API Key (${params.envVar})`,
        hint: params.hint ?? `Paste your ${params.envVar}`,
        kind: 'api_key' as const,
        run: async (_ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            const keyInput = await text({
                message: `Enter your ${params.envVar}:`,
                placeholder: 'sk-...',
                validate: (value: string | undefined) => {
                    if (!value?.trim()) return 'API key is required';
                    return undefined;
                },
            });

            if (isCancel(keyInput)) {
                cancel('Auth cancelled.');
                process.exit(0);
            }

            const key = String(keyInput).trim();
            const profileId = defaultProfileId(params.provider);

            upsertAuthProfile(profileId, {
                type: 'api_key',
                provider: params.provider,
                key,
            });

            return {
                profileId,
                credential: {
                    type: 'api_key',
                    provider: params.provider,
                    key,
                },
            };
        },
    };
}
