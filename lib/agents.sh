#!/usr/bin/env bash
# Agent management functions for TinyClaw

# AGENTS_DIR set after loading settings (uses workspace path)
AGENTS_DIR=""

# Ensure all agent workspaces have .agents/skills copied from SCRIPT_DIR
ensure_agent_skills_links() {
    local skills_src="$SCRIPT_DIR/.agents/skills"
    [ -d "$skills_src" ] || return 0

    local agents_dir="$WORKSPACE_PATH"
    [ -d "$agents_dir" ] || return 0

    local agent_ids
    agent_ids=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null) || return 0

    for agent_id in $agent_ids; do
        local agent_dir="$agents_dir/$agent_id"
        [ -d "$agent_dir" ] || continue

        # Migrate: replace old symlinks with real directories
        if [ -L "$agent_dir/.agents/skills" ]; then
            rm "$agent_dir/.agents/skills"
        fi
        if [ -L "$agent_dir/.claude/skills" ]; then
            rm "$agent_dir/.claude/skills"
        fi

        # Sync default skills into .agents/skills
        # - Overwrites skills that exist in source (keeps them up to date)
        # - Preserves agent-specific custom skills not in source
        mkdir -p "$agent_dir/.agents/skills"
        for skill_dir in "$skills_src"/*/; do
            [ -d "$skill_dir" ] || continue
            local skill_name
            skill_name="$(basename "$skill_dir")"
            # Always overwrite default skills with latest from source
            rm -rf "$agent_dir/.agents/skills/$skill_name"
            cp -r "$skill_dir" "$agent_dir/.agents/skills/$skill_name"
        done

        # Mirror .agents/skills into .claude/skills for Claude Code
        mkdir -p "$agent_dir/.claude/skills"
        cp -r "$agent_dir/.agents/skills/"* "$agent_dir/.claude/skills/" 2>/dev/null || true
    done
}

# List all configured agents
agent_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local agents_count
    agents_count=$(jq -r '(.agents // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$agents_count" = "0" ] || [ -z "$agents_count" ]; then
        echo -e "${YELLOW}No agents configured.${NC}"
        echo ""
        echo "Using default single-agent mode (from models section)."
        echo ""
        echo "Add an agent with:"
        echo -e "  ${GREEN}$0 agent add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Agents${NC}"
    echo "================="
    echo ""

    jq -r '(.agents // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.provider)|\(.value.model)|\(.value.working_directory)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name provider model workdir; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Provider:  ${provider}/${model}"
        echo "    Directory: ${workdir}"
        echo ""
    done

    echo "Usage: Send '@agent_id <message>' in any channel to route to a specific agent."
}

# Show details for a specific agent
agent_show() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Agent: @${agent_id}${NC}"
    echo ""
    jq "(.agents // {}).\"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Add a new agent interactively
agent_add() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    # Load settings to get workspace path
    load_settings
    AGENTS_DIR="$WORKSPACE_PATH"

    echo -e "${BLUE}Add New Agent${NC}"
    echo ""

    # Agent ID
    read -rp "Agent ID (lowercase, no spaces, e.g. 'coder'): " AGENT_ID
    AGENT_ID=$(echo "$AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    if [ -z "$AGENT_ID" ]; then
        echo -e "${RED}Invalid agent ID${NC}"
        exit 1
    fi

    # Check if exists
    local existing
    existing=$(jq -r "(.agents // {}).\"${AGENT_ID}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -n "$existing" ]; then
        echo -e "${RED}Agent '${AGENT_ID}' already exists. Use 'agent remove ${AGENT_ID}' first.${NC}"
        exit 1
    fi

    # Agent name
    read -rp "Display name (e.g. 'Code Assistant'): " AGENT_NAME
    if [ -z "$AGENT_NAME" ]; then
        AGENT_NAME="$AGENT_ID"
    fi

    # Provider
    echo ""
    echo "Provider:"
    echo "  1) Anthropic (Claude)"
    echo "  2) OpenAI (Codex)"
    echo "  3) OpenCode"
    echo "  4) Gemini (Google)"
    echo "  5) Kimi"
    echo "  6) Antigravity"
    read -rp "Choose [1-6, default: 1]: " AGENT_PROVIDER_CHOICE
    case "$AGENT_PROVIDER_CHOICE" in
        2) AGENT_PROVIDER="openai" ;;
        3) AGENT_PROVIDER="opencode" ;;
        4) AGENT_PROVIDER="gemini" ;;
        5) AGENT_PROVIDER="kimi" ;;
        6) AGENT_PROVIDER="antigravity" ;;
        *) AGENT_PROVIDER="anthropic" ;;
    esac

    # Model
    echo ""
    if [ "$AGENT_PROVIDER" = "anthropic" ]; then
        echo "Model:"
        echo "  1) Sonnet (fast)"
        echo "  2) Opus (smartest)"
        echo "  3) Custom (enter model name)"
        read -rp "Choose [1-3, default: 1]: " AGENT_MODEL_CHOICE
        case "$AGENT_MODEL_CHOICE" in
            2) AGENT_MODEL="opus" ;;
            3) read -rp "Enter model name: " AGENT_MODEL ;;
            *) AGENT_MODEL="sonnet" ;;
        esac
    elif [ "$AGENT_PROVIDER" = "opencode" ]; then
        echo "Model (provider/model format):"
        echo "  1) opencode/claude-sonnet-4-5"
        echo "  2) opencode/claude-opus-4-6"
        echo "  3) opencode/gemini-3-flash"
        echo "  4) opencode/gemini-3-pro"
        echo "  5) anthropic/claude-sonnet-4-5"
        echo "  6) anthropic/claude-opus-4-6"
        echo "  7) openai/gpt-5.3-codex"
        echo "  8) Custom (enter model name)"
        read -rp "Choose [1-8, default: 1]: " AGENT_MODEL_CHOICE
        case "$AGENT_MODEL_CHOICE" in
            2) AGENT_MODEL="opencode/claude-opus-4-6" ;;
            3) AGENT_MODEL="opencode/gemini-3-flash" ;;
            4) AGENT_MODEL="opencode/gemini-3-pro" ;;
            5) AGENT_MODEL="anthropic/claude-sonnet-4-5" ;;
            6) AGENT_MODEL="anthropic/claude-opus-4-6" ;;
            7) AGENT_MODEL="openai/gpt-5.3-codex" ;;
            8) read -rp "Enter model name (e.g. provider/model): " AGENT_MODEL ;;
            *) AGENT_MODEL="opencode/claude-sonnet-4-5" ;;
        esac
    elif [ "$AGENT_PROVIDER" = "openai" ]; then
        echo "Model:"
        echo "  1) GPT-5.3 Codex"
        echo "  2) GPT-5.2"
        echo "  3) Custom (enter model name)"
        read -rp "Choose [1-3, default: 1]: " AGENT_MODEL_CHOICE
        case "$AGENT_MODEL_CHOICE" in
            2) AGENT_MODEL="gpt-5.2" ;;
            3) read -rp "Enter model name: " AGENT_MODEL ;;
            *) AGENT_MODEL="gpt-5.3-codex" ;;
        esac
    elif [ "$AGENT_PROVIDER" = "gemini" ]; then
        echo -e "${YELLOW}Enter a model name (e.g. gemini-2.5-pro) or leave blank for CLI default:${NC}"
        read -rp "Model name: " AGENT_MODEL
    elif [ "$AGENT_PROVIDER" = "kimi" ]; then
        echo -e "${YELLOW}Enter a model name or leave blank for CLI default:${NC}"
        read -rp "Model name: " AGENT_MODEL
    elif [ "$AGENT_PROVIDER" = "antigravity" ]; then
        echo -e "${YELLOW}Enter a model name or leave blank for CLI default:${NC}"
        read -rp "Model name: " AGENT_MODEL
    fi

    # Working directory - automatically set to agent directory
    AGENT_WORKDIR="$AGENTS_DIR/$AGENT_ID"

    # Write to settings
    local tmp_file="$SETTINGS_FILE.tmp"

    # Build the agent JSON object
    local agent_json
    agent_json=$(jq -n \
        --arg name "$AGENT_NAME" \
        --arg provider "$AGENT_PROVIDER" \
        --arg model "$AGENT_MODEL" \
        --arg workdir "$AGENT_WORKDIR" \
        '{
            name: $name,
            provider: $provider,
            model: $model,
            working_directory: $workdir
        }')

    # Ensure agents section exists and add the new agent
    jq --arg id "$AGENT_ID" --argjson agent "$agent_json" \
        '.agents //= {} | .agents[$id] = $agent' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Create agent directory and copy configuration files
    if [ -z "$TINYCLAW_HOME" ]; then
        if [ -f "$SCRIPT_DIR/.tinyclaw/settings.json" ]; then
            TINYCLAW_HOME="$SCRIPT_DIR/.tinyclaw"
        else
            TINYCLAW_HOME="$HOME/.tinyclaw"
        fi
    fi
    mkdir -p "$AGENTS_DIR/$AGENT_ID"

    # Copy .claude directory
    if [ -d "$SCRIPT_DIR/.claude" ]; then
        cp -r "$SCRIPT_DIR/.claude" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied .claude/ to agent directory"
    else
        mkdir -p "$AGENTS_DIR/$AGENT_ID/.claude"
    fi

    # Copy heartbeat.md
    if [ -f "$SCRIPT_DIR/heartbeat.md" ]; then
        cp "$SCRIPT_DIR/heartbeat.md" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied heartbeat.md to agent directory"
    fi

    # Copy AGENTS.md
    if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
        cp "$SCRIPT_DIR/AGENTS.md" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied AGENTS.md to agent directory"
    fi

    # Copy AGENTS.md content into .claude/CLAUDE.md as well
    if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
        cp "$SCRIPT_DIR/AGENTS.md" "$AGENTS_DIR/$AGENT_ID/.claude/CLAUDE.md"
        echo "  → Copied CLAUDE.md to .claude/ directory"
    fi

    # Copy default skills from SCRIPT_DIR
    local skills_src="$SCRIPT_DIR/.agents/skills"
    if [ -d "$skills_src" ]; then
        mkdir -p "$AGENTS_DIR/$AGENT_ID/.agents/skills"
        cp -r "$skills_src/"* "$AGENTS_DIR/$AGENT_ID/.agents/skills/" 2>/dev/null || true
        echo "  → Copied skills to .agents/skills/"

        # Mirror into .claude/skills for Claude Code
        mkdir -p "$AGENTS_DIR/$AGENT_ID/.claude/skills"
        cp -r "$AGENTS_DIR/$AGENT_ID/.agents/skills/"* "$AGENTS_DIR/$AGENT_ID/.claude/skills/" 2>/dev/null || true
        echo "  → Copied skills to .claude/skills/"
    fi

    # Create .tinyclaw directory and copy SOUL.md
    mkdir -p "$AGENTS_DIR/$AGENT_ID/.tinyclaw"
    if [ -f "$SCRIPT_DIR/SOUL.md" ]; then
        cp "$SCRIPT_DIR/SOUL.md" "$AGENTS_DIR/$AGENT_ID/.tinyclaw/SOUL.md"
        echo "  → Copied SOUL.md to .tinyclaw/"
    fi

    echo ""
    echo -e "${GREEN}✓ Agent '${AGENT_ID}' created!${NC}"
    echo -e "  Directory: $AGENTS_DIR/$AGENT_ID"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Customize agent behavior by editing:"
    echo -e "     ${GREEN}$AGENTS_DIR/$AGENT_ID/AGENTS.md${NC}"
    echo "  2. Send a message: '@${AGENT_ID} <message>' in any channel"
    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Remove an agent
agent_remove() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        exit 1
    fi

    local agent_name
    agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    read -rp "Remove agent '${agent_id}' (${agent_name})? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
        echo "Cancelled."
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq --arg id "$agent_id" 'del(.agents[$id])' "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Clean up agent state directory
    if [ -d "$AGENTS_DIR/$agent_id" ]; then
        rm -rf "$AGENTS_DIR/$agent_id"
    fi

    echo -e "${GREEN}✓ Agent '${agent_id}' removed.${NC}"
}

# Set provider and/or model for a specific agent
agent_provider() {
    local agent_id="$1"
    local provider_arg="$2"
    local model_arg=""

    # Parse optional --model flag
    if [ "$3" = "--model" ] && [ -n "$4" ]; then
        model_arg="$4"
    fi

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    if [ -z "$provider_arg" ]; then
        # Show current provider/model for this agent
        local cur_provider cur_model agent_name
        cur_provider=$(jq -r "(.agents // {}).\"${agent_id}\".provider // \"anthropic\"" "$SETTINGS_FILE" 2>/dev/null)
        cur_model=$(jq -r "(.agents // {}).\"${agent_id}\".model // empty" "$SETTINGS_FILE" 2>/dev/null)
        agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name // \"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null)
        echo -e "${BLUE}Agent: @${agent_id} (${agent_name})${NC}"
        echo -e "${BLUE}Provider: ${GREEN}${cur_provider}${NC}"
        if [ -n "$cur_model" ]; then
            echo -e "${BLUE}Model:    ${GREEN}${cur_model}${NC}"
        fi
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"

    case "$provider_arg" in
        anthropic)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "anthropic" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "anthropic"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic${NC}"
            fi
            ;;
        openai)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "openai" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "openai"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI${NC}"
            fi
            ;;
        gemini)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "gemini" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Gemini with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "gemini"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Gemini${NC}"
            fi
            ;;
        kimi)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "kimi" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Kimi with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "kimi"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Kimi${NC}"
            fi
            ;;
        antigravity)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "antigravity" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Antigravity with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "antigravity"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Antigravity${NC}"
            fi
            ;;
        *)
            echo "Usage: tinyclaw agent provider <agent_id> {anthropic|openai|gemini|kimi|antigravity} [--model MODEL_NAME]"
            echo ""
            echo "Examples:"
            echo "  tinyclaw agent provider coder                                    # Show current provider/model"
            echo "  tinyclaw agent provider coder anthropic                           # Switch to Anthropic"
            echo "  tinyclaw agent provider coder openai                              # Switch to OpenAI"
            echo "  tinyclaw agent provider coder gemini                              # Switch to Gemini"
            echo "  tinyclaw agent provider coder kimi                                # Switch to Kimi"
            echo "  tinyclaw agent provider coder antigravity                         # Switch to Antigravity"
            echo "  tinyclaw agent provider coder gemini --model gemini-2.5-pro        # Switch to Gemini with model"
            exit 1
            ;;
    esac

    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Reset a specific agent's conversation
agent_reset() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    # Load settings if not already loaded
    if [ -z "$AGENTS_DIR" ] || [ "$AGENTS_DIR" = "" ]; then
        load_settings
        AGENTS_DIR="$WORKSPACE_PATH"
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        return 1
    fi

    mkdir -p "$AGENTS_DIR/$agent_id"
    touch "$AGENTS_DIR/$agent_id/reset_flag"

    local agent_name
    agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    echo -e "${GREEN}✓ Reset flag set for agent '${agent_id}' (${agent_name})${NC}"
    echo "  The next message to @${agent_id} will start a fresh conversation."
}

# Reset multiple agents' conversations
agent_reset_multiple() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    load_settings
    AGENTS_DIR="$WORKSPACE_PATH"

    local has_error=0
    local reset_count=0

    for agent_id in "$@"; do
        agent_reset "$agent_id"
        if [ $? -eq 0 ]; then
            reset_count=$((reset_count + 1))
        else
            has_error=1
        fi
    done

    echo ""
    if [ "$reset_count" -gt 0 ]; then
        echo -e "${GREEN}Reset ${reset_count} agent(s).${NC}"
    fi

    if [ "$has_error" -eq 1 ]; then
        exit 1
    fi
}

# Authenticate (or re-authenticate) a single CLI provider
agent_auth() {
    local provider="$1"

    if [ -z "$provider" ]; then
        echo "Usage: tinyclaw auth <provider>"
        echo ""
        echo "Providers: anthropic, openai, opencode, gemini, kimi, antigravity"
        echo ""
        echo "Examples:"
        echo "  tinyclaw auth anthropic       # Sign in to Anthropic (Claude)"
        echo "  tinyclaw auth gemini           # Sign in to Gemini (Google)"
        echo "  tinyclaw auth kimi             # Sign in to Kimi"
        return 1
    fi

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    echo ""
    echo -e "${YELLOW}── Signing in to $provider ──${NC}"

    echo "  1) OAuth / Browser login"
    echo "  2) API Key"
    read -rp "  Auth method [1/2, default: 1]: " AUTH_METHOD
    AUTH_METHOD=${AUTH_METHOD:-1}

    if [ "$AUTH_METHOD" = "1" ]; then
        case "$provider" in
            anthropic)
                echo -e "  ${YELLOW}Running: claude login${NC}"
                claude login
                ;;
            openai)
                echo -e "  ${YELLOW}Running: codex login${NC}"
                codex login
                ;;
            kimi)
                echo -e "  ${YELLOW}Running: kimi login${NC}"
                kimi login
                ;;
            *)
                echo -e "  ${RED}OAuth not available for $provider — falling back to API key${NC}"
                AUTH_METHOD="2"
                ;;
        esac
        if [ "$AUTH_METHOD" = "1" ]; then
            # Update settings.json auth section via jq
            local tmp_file="$SETTINGS_FILE.tmp"
            jq --arg p "$provider" \
                '.auth[$p] = { "method": "oauth", "authenticated": true }' \
                "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
            echo -e "  ${GREEN}✓ $provider signed in via OAuth${NC}"
            return
        fi
    fi

    # API Key path
    local env_hint=""
    case "$provider" in
        anthropic|opencode) env_hint="ANTHROPIC_API_KEY" ;;
        openai)             env_hint="OPENAI_API_KEY" ;;
        gemini|antigravity) env_hint="GOOGLE_API_KEY" ;;
        kimi)               env_hint="MOONSHOT_API_KEY" ;;
    esac

    read -rp "  Enter $env_hint: " API_KEY_VALUE
    if [ -n "$API_KEY_VALUE" ]; then
        local tmp_file="$SETTINGS_FILE.tmp"
        jq --arg p "$provider" --arg k "$API_KEY_VALUE" \
            '.auth[$p] = { "method": "apikey", "apiKey": $k }' \
            "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
        echo -e "  ${GREEN}✓ $provider API key saved${NC}"
    else
        echo -e "  ${RED}✗ Skipped $provider (no key provided)${NC}"
    fi
}
