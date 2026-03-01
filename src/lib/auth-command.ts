/**
 * `tinyclaw auth` CLI command.
 *
 * Usage:
 *   tinyclaw auth                  — interactive provider picker
 *   tinyclaw auth <provider>       — direct login for a specific provider
 *   tinyclaw auth --list           — list all available providers
 */
import { intro, outro, select, isCancel, cancel, log } from '@clack/prompts';
import { initProviders } from './providers/init';
import { getAllProviders, getProvider, openUrlInBrowser, type ProviderAuthContext } from './providers/registry';

// Provider ID aliases (legacy TinyClaw names → registry IDs)
const ALIASES: Record<string, string> = {
    'gemini': 'google',
    'kimi': 'moonshot',
    'openai': 'openai',          // identity for clarity
    'anthropic': 'anthropic',
    'opencode': 'opencode',
    'antigravity': 'google',          // falls back to API key
};

function resolveAlias(input: string): string {
    return ALIASES[input] ?? input;
}

export async function runAuthCommand(args: string[]): Promise<void> {
    initProviders();

    const providers = getAllProviders();

    // --list flag
    if (args.includes('--list')) {
        console.log('\nAvailable providers:\n');
        for (const p of providers) {
            const methods = p.auth.map(a => a.label).join(', ');
            const warn = p.requiresOptIn ? ' ⚠ opt-in' : '';
            console.log(`  ${p.id.padEnd(22)} ${p.label}${warn}`);
            console.log(`  ${''.padEnd(22)} Auth: ${methods}\n`);
        }
        return;
    }

    intro('🔐 TinyClaw Provider Authentication');

    // Resolve requested provider
    const rawProvider = args[0];
    let providerId: string | undefined;

    if (rawProvider) {
        providerId = resolveAlias(rawProvider);
        const provider = getProvider(providerId);
        if (!provider) {
            log.error(`Unknown provider: ${rawProvider}`);
            log.info('Run `tinyclaw auth --list` to see all available providers.');
            process.exit(1);
        }
    } else {
        // Interactive picker
        const chosen = await select({
            message: 'Select a provider to authenticate:',
            options: providers.map(p => ({
                value: p.id,
                label: p.label,
                hint: p.requiresOptIn ? '⚠ unofficial' : undefined,
            })),
        });

        if (isCancel(chosen)) {
            cancel('Auth cancelled.');
            process.exit(0);
        }
        providerId = String(chosen);
    }

    const provider = getProvider(providerId)!;

    // Show warning if opt-in required
    if (provider.warning) {
        log.warn(provider.warning);
    }

    // Pick auth method (auto-select if only one)
    let authMethod = provider.auth[0];
    if (provider.auth.length > 1) {
        const methodChoice = await select({
            message: `Auth method for ${provider.label}:`,
            options: provider.auth.map(m => ({
                value: m.id,
                label: m.label,
                hint: m.hint,
            })),
        });

        if (isCancel(methodChoice)) {
            cancel('Auth cancelled.');
            process.exit(0);
        }
        authMethod = provider.auth.find(m => m.id === String(methodChoice)) ?? provider.auth[0];
    }

    // Build context
    const ctx: ProviderAuthContext = {
        isRemote: false,
        openUrl: openUrlInBrowser,
        log: (msg: string) => log.info(msg),
    };

    // Run auth
    try {
        const result = await authMethod.run(ctx);
        log.success(`Authenticated: ${provider.label}`);
        log.info(`Profile: ${result.profileId}`);
        if (result.defaultModel) {
            log.info(`Default model: ${result.defaultModel}`);
        }
        if (result.notes) {
            for (const n of result.notes) log.info(n);
        }
    } catch (err) {
        log.error(`Authentication failed: ${err}`);
        process.exit(1);
    }

    outro('Done ✓');
}

// Direct CLI execution
if (require.main === module) {
    runAuthCommand(process.argv.slice(2)).catch(console.error);
}
