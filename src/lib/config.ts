import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { Settings, AgentConfig, TeamConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS, OPENCODE_MODEL_IDS } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');

const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');
export const FILES_DIR = path.join(TINYCLAW_HOME, 'files');

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let settings: Settings;

        try {
            settings = JSON.parse(settingsData);
        } catch (parseError) {
            // JSON is invalid — attempt auto-fix with jsonrepair
            console.error(`[WARN] settings.json contains invalid JSON: ${(parseError as Error).message}`);

            try {
                const repaired = jsonrepair(settingsData);
                settings = JSON.parse(repaired);

                // Write the fixed JSON back and create a backup
                const backupPath = SETTINGS_FILE + '.bak';
                fs.copyFileSync(SETTINGS_FILE, backupPath);
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
                console.error(`[WARN] Auto-fixed settings.json (backup: ${backupPath})`);
            } catch {
                console.error(`[ERROR] Could not auto-fix settings.json — returning empty config`);
                return {};
            }
        }

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.['openai-cli']) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai-cli';
            } else if (settings?.models?.opencode) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'opencode';
            } else if (settings?.models?.gemini) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'gemini';
            } else if (settings?.models?.kimi) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'kimi';
            } else if (settings?.models?.antigravity) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'antigravity';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else if (provider === 'openai-cli') {
        model = settings?.models?.['openai-cli']?.model || 'gpt-4o';
    } else if (provider === 'opencode') {
        model = settings?.models?.opencode?.model || 'sonnet';
    } else if (provider === 'gemini') {
        model = settings?.models?.gemini?.model || '';
    } else if (provider === 'kimi') {
        model = settings?.models?.kimi?.model || '';
    } else if (provider === 'antigravity') {
        model = settings?.models?.antigravity?.model || '';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Get all configured agents. Falls back to a single "default" agent
 * derived from the legacy models section if no agents are configured.
 */
export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default agent from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Get all configured teams.
 */
export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
export function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
export function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for OpenAI CLI (passthrough).
 */
export function resolveOpenAICliModel(model: string): string {
    return model || '';
}

/**
 * Resolve the model ID for OpenCode (passed via --model flag).
 * Falls back to the raw model string from settings if no mapping is found.
 */
export function resolveOpenCodeModel(model: string): string {
    return OPENCODE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Gemini CLI (passthrough — CLI handles validation).
 */
export function resolveGeminiModel(model: string): string {
    return model || '';
}

/**
 * Resolve the model ID for Kimi CLI (passthrough — CLI handles validation).
 */
export function resolveKimiModel(model: string): string {
    return model || '';
}

/**
 * Resolve the model ID for Antigravity CLI (passthrough — CLI handles validation).
 */
export function resolveAntigravityModel(model: string): string {
    return model || '';
}

/**
 * Build environment variables for a provider's stored auth credentials.
 * Returns an object like { ANTHROPIC_API_KEY: 'sk-...' } if an API key
 * is stored, or an empty object if the provider uses OAuth / has no key.
 */
export function getAuthEnv(provider: string): Record<string, string> {
    const settings = getSettings();
    const entry = settings.auth?.[provider];
    if (!entry?.apiKey) return {};

    const ENV_MAP: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        'openai-cli': 'OPENAI_API_KEY',
        opencode: 'ANTHROPIC_API_KEY',
        gemini: 'GOOGLE_API_KEY',
        kimi: 'MOONSHOT_API_KEY',
        antigravity: 'GOOGLE_API_KEY',
    };

    const varName = ENV_MAP[provider];
    return varName ? { [varName]: entry.apiKey } : {};
}
