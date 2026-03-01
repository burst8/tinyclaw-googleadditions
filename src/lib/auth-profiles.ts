/**
 * Credential store for TinyClaw provider authentication.
 *
 * Stores API keys, OAuth tokens, and setup tokens in
 * $TINYCLAW_HOME/auth-profiles.json with restrictive permissions.
 */
import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiKeyCredential = {
    type: 'api_key';
    provider: string;
    key: string;
};

export type OAuthCredential = {
    type: 'oauth';
    provider: string;
    access: string;
    refresh: string;
    expires: number;      // epoch ms
    email?: string;
    projectId?: string;   // Google Cloud project (Gemini)
    resourceUrl?: string; // Qwen / MiniMax resource URL
};

export type TokenCredential = {
    type: 'token';
    provider: string;
    token: string;
    expires?: number;     // epoch ms, undefined = no expiry
};

export type AuthProfileCredential =
    | ApiKeyCredential
    | OAuthCredential
    | TokenCredential;

export interface AuthProfileStore {
    profiles: Record<string, AuthProfileCredential>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AUTH_PROFILES_FILE = path.join(TINYCLAW_HOME, 'auth-profiles.json');

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Load all auth profiles from disk.
 */
export function getAuthProfiles(): AuthProfileStore {
    try {
        if (!fs.existsSync(AUTH_PROFILES_FILE)) {
            return { profiles: {} };
        }
        const raw = fs.readFileSync(AUTH_PROFILES_FILE, 'utf8');
        const parsed = JSON.parse(raw) as AuthProfileStore;
        return parsed?.profiles ? parsed : { profiles: {} };
    } catch {
        return { profiles: {} };
    }
}

/**
 * Insert or update a single auth profile.
 * Writes immediately to disk with chmod 600.
 */
export function upsertAuthProfile(profileId: string, credential: AuthProfileCredential): void {
    const store = getAuthProfiles();
    store.profiles[profileId] = credential;

    // Ensure directory exists
    const dir = path.dirname(AUTH_PROFILES_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(AUTH_PROFILES_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');

    // Restrictive permissions (owner-only read/write)
    try {
        fs.chmodSync(AUTH_PROFILES_FILE, 0o600);
    } catch {
        // Windows doesn't support chmod — ignore.
    }
}

/**
 * Remove an auth profile by ID.
 */
export function removeAuthProfile(profileId: string): void {
    const store = getAuthProfiles();
    delete store.profiles[profileId];
    fs.writeFileSync(AUTH_PROFILES_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/**
 * Build a default profile ID for a provider.
 * Convention: `<provider>:default`
 */
export function defaultProfileId(provider: string): string {
    return `${provider}:default`;
}

/**
 * Get the active credential for a provider.
 *
 * Resolution order:
 *   1. Profile bound in settings.json auth.<provider>.profileId
 *   2. Default profile `<provider>:default`
 *   3. Any profile matching provider
 */
export function getActiveCredential(provider: string): AuthProfileCredential | null {
    const store = getAuthProfiles();

    // 1. Try default profile
    const defId = defaultProfileId(provider);
    if (store.profiles[defId]) {
        return store.profiles[defId];
    }

    // 2. Search by provider field
    for (const cred of Object.values(store.profiles)) {
        if (cred.provider === provider) {
            return cred;
        }
    }

    return null;
}

/**
 * Build environment variables for a provider from stored credentials.
 * Returns an object like { ANTHROPIC_API_KEY: 'sk-...' } ready to merge
 * into a child process env.
 */
export function getAuthEnvFromProfiles(provider: string): Record<string, string> {
    const cred = getActiveCredential(provider);
    if (!cred) return {};

    const ENV_MAP: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        'openai-codex': 'OPENAI_API_KEY',
        opencode: 'ANTHROPIC_API_KEY',
        google: 'GEMINI_API_KEY',
        gemini: 'GOOGLE_API_KEY',
        'google-gemini-cli': 'GOOGLE_API_KEY',
        moonshot: 'MOONSHOT_API_KEY',
        kimi: 'MOONSHOT_API_KEY',
        'kimi-coding': 'KIMI_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        xai: 'XAI_API_KEY',
        mistral: 'MISTRAL_API_KEY',
        groq: 'GROQ_API_KEY',
        cerebras: 'CEREBRAS_API_KEY',
        huggingface: 'HF_TOKEN',
        zai: 'ZAI_API_KEY',
        volcengine: 'VOLCANO_ENGINE_API_KEY',
        byteplus: 'BYTEPLUS_API_KEY',
        synthetic: 'SYNTHETIC_API_KEY',
        minimax: 'MINIMAX_API_KEY',
        'minimax-portal': 'MINIMAX_API_KEY',
        kilocode: 'KILOCODE_API_KEY',
        'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
        'github-copilot': 'GITHUB_TOKEN',
        'qwen-portal': 'QWEN_API_KEY',
        antigravity: 'GOOGLE_API_KEY',
    };

    const varName = ENV_MAP[provider];
    if (!varName) return {};

    if (cred.type === 'api_key') return { [varName]: cred.key };
    if (cred.type === 'oauth') return { [varName]: cred.access };
    if (cred.type === 'token') return { [varName]: cred.token };

    return {};
}
