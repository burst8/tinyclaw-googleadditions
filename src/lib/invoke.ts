import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel, resolveGeminiModel, resolveKimiModel, resolveAntigravityModel, getAuthEnv } from './config';
import { getAuthEnvFromProfiles } from './auth-profiles';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';

/**
 * Resolve auth env vars for a provider. Checks auth-profiles.json first
 * (the new OpenClaw-style store), then falls back to settings.json auth entries.
 */
function resolveAuthEnv(provider: string): Record<string, string> {
    // Try new auth profile store first
    const profileEnv = getAuthEnvFromProfiles(provider);
    if (Object.keys(profileEnv).length > 0) {
        return profileEnv;
    }
    // Fall back to legacy settings.json auth
    return getAuthEnv(provider);
}

export async function runCommand(command: string, args: string[], cwd?: string, extraEnv?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...extraEnv };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir, resolveAuthEnv('openai'));

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else if (provider === 'opencode') {
        // OpenCode CLI — non-interactive mode via `opencode run`.
        // Outputs JSONL with --format json; extract "text" type events for the response.
        // Model passed via --model in provider/model format (e.g. opencode/claude-sonnet-4-5).
        // Supports -c flag for conversation continuation (resumes last session).
        const modelId = resolveOpenCodeModel(agent.model);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting OpenCode conversation for agent: ${agentId}`);
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir, resolveAuthEnv('opencode'));

        // Parse JSONL output and collect all text parts
        let response = '';
        const lines = opencodeOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
    } else if (provider === 'gemini') {
        // Gemini CLI — uses Vertex AI / Google AI endpoints
        const modelId = resolveGeminiModel(agent.model);
        log('INFO', `Using Gemini CLI (agent: ${agentId}, model: ${modelId || 'default'})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Gemini conversation for agent: ${agentId}`);
        }

        const geminiArgs: string[] = [];
        if (modelId) {
            geminiArgs.push('--model', modelId);
        }
        if (continueConversation) {
            geminiArgs.push('-c');
        }
        geminiArgs.push('-p', message);

        return await runCommand('gemini', geminiArgs, workingDir, resolveAuthEnv('gemini'));
    } else if (provider === 'kimi') {
        // Kimi CLI
        const modelId = resolveKimiModel(agent.model);
        log('INFO', `Using Kimi CLI (agent: ${agentId}, model: ${modelId || 'default'})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Kimi conversation for agent: ${agentId}`);
        }

        const kimiArgs: string[] = [];
        if (modelId) {
            kimiArgs.push('--model', modelId);
        }
        if (continueConversation) {
            kimiArgs.push('-c');
        }
        kimiArgs.push('-p', message);

        return await runCommand('kimi', kimiArgs, workingDir, resolveAuthEnv('kimi'));
    } else if (provider === 'antigravity') {
        // Antigravity CLI
        const modelId = resolveAntigravityModel(agent.model);
        log('INFO', `Using Antigravity CLI (agent: ${agentId}, model: ${modelId || 'default'})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Antigravity conversation for agent: ${agentId}`);
        }

        const antigravityArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            antigravityArgs.push('--model', modelId);
        }
        if (continueConversation) {
            antigravityArgs.push('-c');
        }
        antigravityArgs.push('-p', message);

        return await runCommand('antigravity', antigravityArgs, workingDir, resolveAuthEnv('antigravity'));
    } else {
        // Default to Claude (Anthropic)
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);

        return await runCommand('claude', claudeArgs, workingDir, resolveAuthEnv('anthropic'));
    }
}
