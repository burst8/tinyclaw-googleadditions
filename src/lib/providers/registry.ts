/**
 * Provider auth registry.
 *
 * Each provider declares its supported auth methods (API key, OAuth, device code, etc.)
 * with an async `run()` handler that drives the interactive login flow.
 */
import type { AuthProfileCredential } from '../auth-profiles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderAuthKind = 'oauth' | 'api_key' | 'device_code' | 'cli_delegate' | 'custom';

export interface ProviderAuthResult {
    profileId: string;
    credential: AuthProfileCredential;
    defaultModel?: string;
    notes?: string[];
}

export interface ProviderAuthContext {
    isRemote: boolean;
    openUrl: (url: string) => Promise<void>;
    log: (msg: string) => void;
}

export interface ProviderAuthMethod {
    id: string;
    label: string;
    hint?: string;
    kind: ProviderAuthKind;
    run: (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;
}

export interface ProviderPlugin {
    id: string;
    label: string;
    envVars?: string[];
    auth: ProviderAuthMethod[];
    /** Whether this provider requires explicit opt-in (e.g. unofficial integrations) */
    requiresOptIn?: boolean;
    /** Warning shown before enabling this provider */
    warning?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers: ProviderPlugin[] = [];

export function registerProvider(provider: ProviderPlugin): void {
    // Replace existing registration if same id
    const idx = providers.findIndex(p => p.id === provider.id);
    if (idx >= 0) {
        providers[idx] = provider;
    } else {
        providers.push(provider);
    }
}

export function getAllProviders(): ProviderPlugin[] {
    return [...providers];
}

export function getProvider(id: string): ProviderPlugin | null {
    return providers.find(p => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Helper: Open URL cross-platform
// ---------------------------------------------------------------------------

export async function openUrlInBrowser(url: string): Promise<void> {
    const { exec } = await import('child_process');
    const { platform } = process;

    const cmd =
        platform === 'darwin' ? `open "${url}"` :
            platform === 'win32' ? `start "" "${url}"` :
                `xdg-open "${url}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
