/**
 * OpenAI Codex CLI delegation handler.
 *
 * Delegates to `codex login` for ChatGPT OAuth sign-in.
 * Also supports direct API key entry as an alternative.
 */
import { execSync } from 'child_process';
import { spinner } from '@clack/prompts';
import { upsertAuthProfile, defaultProfileId } from '../auth-profiles';
import type { ProviderAuthContext, ProviderAuthResult, ProviderAuthMethod } from './registry';

export const openaiCodexOAuth: ProviderAuthMethod = {
    id: 'codex-oauth',
    label: 'Codex OAuth (ChatGPT sign-in)',
    hint: 'Runs `codex login` for ChatGPT subscription access',
    kind: 'cli_delegate',
    run: async (_ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
        const spin = spinner();
        spin.start('Running codex login...');

        try {
            execSync('codex login', { stdio: 'inherit' });
        } catch (err) {
            spin.stop('codex login failed');
            throw new Error(`codex login failed: ${err}`);
        }

        spin.stop('Codex OAuth complete ✓');

        const profileId = defaultProfileId('openai-codex');
        const credential = {
            type: 'token' as const,
            provider: 'openai-codex',
            token: '__codex_cli_managed__',  // Codex manages its own tokens
        };
        upsertAuthProfile(profileId, credential);

        return {
            profileId,
            credential,
            defaultModel: 'gpt-5.3-codex',
        };
    },
};
