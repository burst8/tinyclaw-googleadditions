/**
 * Provider initialization — registers all built-in providers.
 *
 * Call `initProviders()` once at startup to populate the registry.
 */
import { registerProvider, type ProviderPlugin } from './registry';
import { createApiKeyAuthMethod } from './api-key';
import { githubCopilotAuth } from './github-copilot';
import { qwenPortalAuth } from './qwen-portal';
import { minimaxPortalAuthGlobal, minimaxPortalAuthCN } from './minimax-portal';
import { geminiCliOAuth } from './gemini-cli-oauth';
import { openaiCodexOAuth } from './openai-codex';

// ---------------------------------------------------------------------------
// API-Key-only providers (Category 1)
// ---------------------------------------------------------------------------

const API_KEY_PROVIDERS: Array<{
    id: string; label: string; envVar: string; hint?: string;
}> = [
        { id: 'openai', label: 'OpenAI (API)', envVar: 'OPENAI_API_KEY' },
        { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
        { id: 'opencode', label: 'OpenCode Zen', envVar: 'OPENCODE_API_KEY' },
        { id: 'google', label: 'Google Gemini (API key)', envVar: 'GEMINI_API_KEY' },
        { id: 'moonshot', label: 'Moonshot AI (Kimi)', envVar: 'MOONSHOT_API_KEY' },
        { id: 'kimi-coding', label: 'Kimi Coding', envVar: 'KIMI_API_KEY' },
        { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
        { id: 'xai', label: 'xAI (Grok)', envVar: 'XAI_API_KEY' },
        { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
        { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
        { id: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
        { id: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN' },
        { id: 'zai', label: 'Z.AI (GLM)', envVar: 'ZAI_API_KEY' },
        { id: 'volcengine', label: 'Volcano Engine (Doubao)', envVar: 'VOLCANO_ENGINE_API_KEY' },
        { id: 'byteplus', label: 'BytePlus (Intl Doubao)', envVar: 'BYTEPLUS_API_KEY' },
        { id: 'synthetic', label: 'Synthetic', envVar: 'SYNTHETIC_API_KEY' },
        { id: 'minimax', label: 'MiniMax (API key)', envVar: 'MINIMAX_API_KEY' },
        { id: 'kilocode', label: 'Kilo Gateway', envVar: 'KILOCODE_API_KEY' },
        { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'AI_GATEWAY_API_KEY' },
    ];

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

let initialized = false;

export function initProviders(): void {
    if (initialized) return;
    initialized = true;

    // --- Category 1: API Key providers ---
    for (const p of API_KEY_PROVIDERS) {
        registerProvider({
            id: p.id,
            label: p.label,
            envVars: [p.envVar],
            auth: [createApiKeyAuthMethod({ provider: p.id, envVar: p.envVar, hint: p.hint })],
        });
    }

    // --- Category 2: OAuth browser redirect ---
    registerProvider({
        id: 'google-gemini-cli',
        label: 'Google Gemini CLI (OAuth)',
        requiresOptIn: true,
        warning: 'Unofficial integration — some users report Google account restrictions.',
        auth: [
            geminiCliOAuth,
            createApiKeyAuthMethod({ provider: 'google-gemini-cli', envVar: 'GOOGLE_API_KEY', hint: 'Fallback: paste a GOOGLE_API_KEY' }),
        ],
    });

    // --- Category 3: Device code OAuth ---
    registerProvider({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        envVars: ['GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN'],
        auth: [
            githubCopilotAuth,
            createApiKeyAuthMethod({ provider: 'github-copilot', envVar: 'GITHUB_TOKEN', hint: 'Paste a GitHub PAT or Copilot token' }),
        ],
    });

    registerProvider({
        id: 'qwen-portal',
        label: 'Qwen Portal (free tier)',
        auth: [
            qwenPortalAuth,
        ],
    });

    registerProvider({
        id: 'minimax-portal',
        label: 'MiniMax Portal (free tier)',
        auth: [
            minimaxPortalAuthGlobal,
            minimaxPortalAuthCN,
        ],
    });

    // --- Category 4: CLI delegation ---
    registerProvider({
        id: 'openai-codex',
        label: 'OpenAI Code (Codex subscription)',
        auth: [
            openaiCodexOAuth,
            createApiKeyAuthMethod({ provider: 'openai-codex', envVar: 'OPENAI_API_KEY', hint: 'Alternative: paste an API key' }),
        ],
    });

    // --- Legacy aliases (map to existing providers) ---
    // 'gemini' maps to 'google' for API key
    // 'kimi' maps to 'moonshot' for API key
    // These are handled separately in the auth command via fallback lookup.
}
