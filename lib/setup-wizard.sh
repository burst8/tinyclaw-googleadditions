#!/usr/bin/env bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETTINGS_FILE="$HOME/.tinyclaw/settings.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── sign_in_provider function ────────────────────────────────────────────────
# Signs into a single CLI provider via OAuth or API key.
# Appends to the global AUTH_JSON variable.
sign_in_provider() {
    local prov="$1"
    echo ""
    echo -e "${YELLOW}── Signing in to $prov ──${NC}"

    echo "  1) OAuth / Browser login"
    echo "  2) API Key"
    read -rp "  Auth method [1/2, default: 1]: " AUTH_METHOD
    AUTH_METHOD=${AUTH_METHOD:-1}

    if [ "$AUTH_METHOD" = "1" ]; then
        # OAuth — run the CLI's login command
        case "$prov" in
            anthropic)
                echo -e "  ${YELLOW}Running: claude login${NC}"
                claude login
                ;;
            openai)
                echo -e "  ${YELLOW}Running: codex login${NC}"
                codex login
                ;;
            gemini)
                echo -e "  ${YELLOW}Running: gcloud auth application-default login (Vertex AI)${NC}"
                gcloud auth application-default login
                ;;
            kimi)
                echo -e "  ${YELLOW}Running: kimi login${NC}"
                kimi login
                ;;
            *)
                echo -e "  ${RED}OAuth not available for $prov — falling back to API key${NC}"
                AUTH_METHOD="2"
                ;;
        esac
        if [ "$AUTH_METHOD" = "1" ]; then
            AUTH_JSON="$AUTH_JSON \"$prov\": { \"method\": \"oauth\", \"authenticated\": true },"
            echo -e "  ${GREEN}✓ $prov signed in via OAuth${NC}"
            return
        fi
    fi

    # API Key path
    local env_hint=""
    case "$prov" in
        anthropic|opencode) env_hint="ANTHROPIC_API_KEY" ;;
        openai)             env_hint="OPENAI_API_KEY" ;;
        gemini|antigravity) env_hint="GOOGLE_API_KEY" ;;
        kimi)               env_hint="MOONSHOT_API_KEY" ;;
    esac

    read -rp "  Enter $env_hint: " API_KEY_VALUE
    if [ -n "$API_KEY_VALUE" ]; then
        AUTH_JSON="$AUTH_JSON \"$prov\": { \"method\": \"apikey\", \"apiKey\": \"$API_KEY_VALUE\" },"
        echo -e "  ${GREEN}✓ $prov API key saved${NC}"
    else
        echo -e "  ${RED}✗ Skipped $prov (no key provided)${NC}"
    fi
}

AUTH_JSON=""  # global accumulator for auth entries

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  TinyClaw - Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- Channel registry ---
# To add a new channel, add its ID here and fill in the config arrays below.
ALL_CHANNELS=(telegram discord whatsapp)

declare -A CHANNEL_DISPLAY=(
    [telegram]="Telegram"
    [discord]="Discord"
    [whatsapp]="WhatsApp"
)
declare -A CHANNEL_TOKEN_KEY=(
    [discord]="discord_bot_token"
    [telegram]="telegram_bot_token"
)
declare -A CHANNEL_TOKEN_PROMPT=(
    [discord]="Enter your Discord bot token:"
    [telegram]="Enter your Telegram bot token:"
)
declare -A CHANNEL_TOKEN_HELP=(
    [discord]="(Get one at: https://discord.com/developers/applications)"
    [telegram]="(Create a bot via @BotFather on Telegram to get a token)"
)

# Channel selection - simple checklist
echo "Which messaging channels (Telegram, Discord, WhatsApp) do you want to enable?"
echo ""

ENABLED_CHANNELS=()
for ch in "${ALL_CHANNELS[@]}"; do
    read -rp "  Enable ${CHANNEL_DISPLAY[$ch]}? [y/N]: " choice
    if [[ "$choice" =~ ^[yY] ]]; then
        ENABLED_CHANNELS+=("$ch")
        echo -e "    ${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} enabled${NC}"
    fi
done
echo ""

if [ ${#ENABLED_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels selected. At least one channel is required.${NC}"
    exit 1
fi

# Collect tokens for channels that need them
declare -A TOKENS
for ch in "${ENABLED_CHANNELS[@]}"; do
    token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        echo "${CHANNEL_TOKEN_PROMPT[$ch]}"
        echo -e "${YELLOW}${CHANNEL_TOKEN_HELP[$ch]}${NC}"
        echo ""
        read -rp "Token: " token_value

        if [ -z "$token_value" ]; then
            echo -e "${RED}${CHANNEL_DISPLAY[$ch]} bot token is required${NC}"
            exit 1
        fi
        TOKENS[$ch]="$token_value"
        echo -e "${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} token saved${NC}"
        echo ""
    fi
done

# Provider selection
echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)  (recommended)"
echo "  2) OpenAI (Codex/GPT)"
echo "  3) OpenCode"
echo "  4) Gemini (Google)"
echo "  5) Kimi"
echo "  6) Antigravity"
echo ""
read -rp "Choose [1-6]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) PROVIDER="anthropic" ;;
    2) PROVIDER="openai" ;;
    3) PROVIDER="opencode" ;;
    4) PROVIDER="gemini" ;;
    5) PROVIDER="kimi" ;;
    6) PROVIDER="antigravity" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $PROVIDER${NC}"
echo ""

# Model selection based on provider
if [ "$PROVIDER" = "anthropic" ]; then
    echo "Which Claude model?"
    echo ""
    echo "  1) Sonnet  (fast, recommended)"
    echo "  2) Opus    (smartest)"
    echo "  3) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-3]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="sonnet" ;;
        2) MODEL="opus" ;;
        3)
            read -rp "Enter model name: " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
elif [ "$PROVIDER" = "opencode" ]; then
    echo "Which OpenCode model? (provider/model format)"
    echo ""
    echo "  1) opencode/claude-sonnet-4-5  (recommended)"
    echo "  2) opencode/claude-opus-4-6"
    echo "  3) opencode/gemini-3-flash"
    echo "  4) opencode/gemini-3-pro"
    echo "  5) anthropic/claude-sonnet-4-5"
    echo "  6) anthropic/claude-opus-4-6"
    echo "  7) openai/gpt-5.3-codex"
    echo "  8) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-8, default: 1]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        2) MODEL="opencode/claude-opus-4-6" ;;
        3) MODEL="opencode/gemini-3-flash" ;;
        4) MODEL="opencode/gemini-3-pro" ;;
        5) MODEL="anthropic/claude-sonnet-4-5" ;;
        6) MODEL="anthropic/claude-opus-4-6" ;;
        7) MODEL="openai/gpt-5.3-codex" ;;
        8)
            read -rp "Enter model name (e.g. provider/model): " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *) MODEL="opencode/claude-sonnet-4-5" ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
elif [ "$PROVIDER" = "gemini" ]; then
    echo "Which Gemini model?"
    echo -e "${YELLOW}(Leave blank for CLI default, or enter a model name like gemini-2.5-pro)${NC}"
    echo ""
    read -rp "Model name [default: CLI default]: " MODEL_INPUT
    MODEL=${MODEL_INPUT:-""}
    if [ -n "$MODEL" ]; then
        echo -e "${GREEN}✓ Model: $MODEL${NC}"
    else
        echo -e "${GREEN}✓ Model: (CLI default)${NC}"
    fi
    echo ""
elif [ "$PROVIDER" = "kimi" ]; then
    echo "Which Kimi model?"
    echo -e "${YELLOW}(Leave blank for CLI default, or enter a model name)${NC}"
    echo ""
    read -rp "Model name [default: CLI default]: " MODEL_INPUT
    MODEL=${MODEL_INPUT:-""}
    if [ -n "$MODEL" ]; then
        echo -e "${GREEN}✓ Model: $MODEL${NC}"
    else
        echo -e "${GREEN}✓ Model: (CLI default)${NC}"
    fi
    echo ""
elif [ "$PROVIDER" = "antigravity" ]; then
    echo "Which Antigravity model?"
    echo -e "${YELLOW}(Leave blank for CLI default, or enter a model name)${NC}"
    echo ""
    read -rp "Model name [default: CLI default]: " MODEL_INPUT
    MODEL=${MODEL_INPUT:-""}
    if [ -n "$MODEL" ]; then
        echo -e "${GREEN}✓ Model: $MODEL${NC}"
    else
        echo -e "${GREEN}✓ Model: (CLI default)${NC}"
    fi
    echo ""
else
    # Codex / legacy OpenAI models
    echo "Which OpenAI model?"
    echo ""
    echo "  1) GPT-5.3 Codex  (recommended)"
    echo "  2) GPT-5.2"
    echo "  3) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-3]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="gpt-5.3-codex" ;;
        2) MODEL="gpt-5.2" ;;
        3)
            read -rp "Enter model name: " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
fi

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often Claude checks in proactively)${NC}"
echo ""
read -rp "Interval in seconds [default: 3600]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-3600}

if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 3600${NC}"
    HEARTBEAT_INTERVAL=3600
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Workspace configuration
echo "Workspace name (where agent directories will be stored)?"
echo -e "${YELLOW}(Creates ~/your-workspace-name/)${NC}"
echo ""
read -rp "Workspace name [default: tinyclaw-workspace]: " WORKSPACE_INPUT
WORKSPACE_NAME=${WORKSPACE_INPUT:-tinyclaw-workspace}
# Clean workspace name
WORKSPACE_NAME=$(echo "$WORKSPACE_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_/~.-')
if [[ "$WORKSPACE_NAME" == /* || "$WORKSPACE_NAME" == ~* ]]; then
  WORKSPACE_PATH="${WORKSPACE_NAME/#\~/$HOME}"
else
  WORKSPACE_PATH="$HOME/$WORKSPACE_NAME"
fi
echo -e "${GREEN}✓ Workspace: $WORKSPACE_PATH${NC}"
echo ""

# Default agent name
echo "Name your default agent?"
echo -e "${YELLOW}(The main AI assistant you'll interact with)${NC}"
echo ""
read -rp "Default agent name [default: assistant]: " DEFAULT_AGENT_INPUT
DEFAULT_AGENT_NAME=${DEFAULT_AGENT_INPUT:-assistant}
# Clean agent name
DEFAULT_AGENT_NAME=$(echo "$DEFAULT_AGENT_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_-' | tr '[:upper:]' '[:lower:]')
echo -e "${GREEN}✓ Default agent: $DEFAULT_AGENT_NAME${NC}"
echo ""

# ── CLI Sign-In Queue ────────────────────────────────────────────────────────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  CLI Authentication${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Select providers to sign into now (OAuth or API key):"
echo "  1) Anthropic (Claude)    4) Gemini (Google)"
echo "  2) OpenAI (Codex)        5) Kimi"
echo "  3) OpenCode              6) Antigravity"
echo ""
echo -e "${YELLOW}Enter numbers separated by spaces (e.g. '1 4 5'), or 'none' to skip:${NC}"
read -rp "Sign in to: " SIGNIN_CHOICES

if [ "$SIGNIN_CHOICES" != "none" ] && [ -n "$SIGNIN_CHOICES" ]; then
    for choice in $SIGNIN_CHOICES; do
        case "$choice" in
            1) sign_in_provider "anthropic" ;;
            2) sign_in_provider "openai" ;;
            3) sign_in_provider "opencode" ;;
            4) sign_in_provider "gemini" ;;
            5) sign_in_provider "kimi" ;;
            6) sign_in_provider "antigravity" ;;
            *) echo -e "  ${RED}Unknown option: $choice — skipping${NC}" ;;
        esac
    done
    echo ""
    echo -e "${GREEN}✓ CLI authentication complete${NC}"
else
    echo -e "${YELLOW}Skipping CLI sign-in${NC}"
fi
echo ""

# --- Additional Agents (optional) ---
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Additional Agents (Optional)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "You can set up multiple agents with different roles, models, and working directories."
echo "Users route messages with '@agent_id message' in chat."
echo ""
read -rp "Set up additional agents? [y/N]: " SETUP_AGENTS

AGENTS_JSON=""
# Always create the default agent
DEFAULT_AGENT_DIR="$WORKSPACE_PATH/$DEFAULT_AGENT_NAME"
# Capitalize first letter of agent name (proper bash method)
DEFAULT_AGENT_DISPLAY="$(tr '[:lower:]' '[:upper:]' <<< "${DEFAULT_AGENT_NAME:0:1}")${DEFAULT_AGENT_NAME:1}"
AGENTS_JSON='"agents": {'
AGENTS_JSON="$AGENTS_JSON \"$DEFAULT_AGENT_NAME\": { \"name\": \"$DEFAULT_AGENT_DISPLAY\", \"provider\": \"$PROVIDER\", \"model\": \"$MODEL\", \"working_directory\": \"$DEFAULT_AGENT_DIR\" }"

ADDITIONAL_AGENTS=()  # Track additional agent IDs for directory creation

if [[ "$SETUP_AGENTS" =~ ^[yY] ]]; then

    # Add more agents
    ADDING_AGENTS=true
    while [ "$ADDING_AGENTS" = true ]; do
        echo ""
        read -rp "Add another agent? [y/N]: " ADD_MORE
        if [[ ! "$ADD_MORE" =~ ^[yY] ]]; then
            ADDING_AGENTS=false
            continue
        fi

        read -rp "  Agent ID (lowercase, no spaces): " NEW_AGENT_ID
        NEW_AGENT_ID=$(echo "$NEW_AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
        if [ -z "$NEW_AGENT_ID" ]; then
            echo -e "${RED}  Invalid ID, skipping${NC}"
            continue
        fi

        read -rp "  Display name: " NEW_AGENT_NAME
        [ -z "$NEW_AGENT_NAME" ] && NEW_AGENT_NAME="$NEW_AGENT_ID"

        echo "  Provider: 1) Anthropic  2) OpenAI  3) OpenCode  4) Gemini  5) Kimi  6) Antigravity"
        read -rp "  Choose [1-6, default: 1]: " NEW_PROVIDER_CHOICE
        case "$NEW_PROVIDER_CHOICE" in
            2) NEW_PROVIDER="openai" ;;
            3) NEW_PROVIDER="opencode" ;;
            4) NEW_PROVIDER="gemini" ;;
            5) NEW_PROVIDER="kimi" ;;
            6) NEW_PROVIDER="antigravity" ;;
            *) NEW_PROVIDER="anthropic" ;;
        esac

        if [ "$NEW_PROVIDER" = "anthropic" ]; then
            echo "  Model: 1) Sonnet  2) Opus  3) Custom"
            read -rp "  Choose [1-3, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opus" ;;
                3) read -rp "  Enter model name: " NEW_MODEL ;;
                *) NEW_MODEL="sonnet" ;;
            esac
        elif [ "$NEW_PROVIDER" = "opencode" ]; then
            echo "  Model: 1) opencode/claude-sonnet-4-5  2) opencode/claude-opus-4-6  3) opencode/gemini-3-flash  4) anthropic/claude-sonnet-4-5  5) Custom"
            read -rp "  Choose [1-5, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opencode/claude-opus-4-6" ;;
                3) NEW_MODEL="opencode/gemini-3-flash" ;;
                4) NEW_MODEL="anthropic/claude-sonnet-4-5" ;;
                5) read -rp "  Enter model name (e.g. provider/model): " NEW_MODEL ;;
                *) NEW_MODEL="opencode/claude-sonnet-4-5" ;;
            esac
        elif [ "$NEW_PROVIDER" = "gemini" ]; then
            echo -e "  ${YELLOW}Enter a model name (e.g. gemini-2.5-pro) or leave blank for CLI default:${NC}"
            read -rp "  Model name: " NEW_MODEL_INPUT
            NEW_MODEL=${NEW_MODEL_INPUT:-""}
        elif [ "$NEW_PROVIDER" = "kimi" ]; then
            echo -e "  ${YELLOW}Enter a model name or leave blank for CLI default:${NC}"
            read -rp "  Model name: " NEW_MODEL_INPUT
            NEW_MODEL=${NEW_MODEL_INPUT:-""}
        elif [ "$NEW_PROVIDER" = "antigravity" ]; then
            echo -e "  ${YELLOW}Enter a model name or leave blank for CLI default:${NC}"
            read -rp "  Model name: " NEW_MODEL_INPUT
            NEW_MODEL=${NEW_MODEL_INPUT:-""}
        else
            echo "  Model: 1) GPT-5.3 Codex  2) GPT-5.2  3) Custom"
            read -rp "  Choose [1-3, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="gpt-5.2" ;;
                3) read -rp "  Enter model name: " NEW_MODEL ;;
                *) NEW_MODEL="gpt-5.3-codex" ;;
            esac
        fi

        NEW_AGENT_DIR="$WORKSPACE_PATH/$NEW_AGENT_ID"

        AGENTS_JSON="$AGENTS_JSON, \"$NEW_AGENT_ID\": { \"name\": \"$NEW_AGENT_NAME\", \"provider\": \"$NEW_PROVIDER\", \"model\": \"$NEW_MODEL\", \"working_directory\": \"$NEW_AGENT_DIR\" }"

        # Track this agent for directory creation later
        ADDITIONAL_AGENTS+=("$NEW_AGENT_ID")

        echo -e "  ${GREEN}✓ Agent '${NEW_AGENT_ID}' added${NC}"
    done
fi

AGENTS_JSON="$AGENTS_JSON },"

# Build enabled channels array JSON
CHANNELS_JSON="["
for i in "${!ENABLED_CHANNELS[@]}"; do
    if [ $i -gt 0 ]; then
        CHANNELS_JSON="${CHANNELS_JSON}, "
    fi
    CHANNELS_JSON="${CHANNELS_JSON}\"${ENABLED_CHANNELS[$i]}\""
done
CHANNELS_JSON="${CHANNELS_JSON}]"

# Build channel configs with tokens
DISCORD_TOKEN="${TOKENS[discord]:-}"
TELEGRAM_TOKEN="${TOKENS[telegram]:-}"

# Write settings.json with layered structure
# Use jq to build valid JSON to avoid escaping issues with agent prompts
if [ "$PROVIDER" = "anthropic" ]; then
    MODELS_SECTION='"models": { "provider": "anthropic", "anthropic": { "model": "'"${MODEL}"'" } }'
elif [ "$PROVIDER" = "opencode" ]; then
    MODELS_SECTION='"models": { "provider": "opencode", "opencode": { "model": "'"${MODEL}"'" } }'
elif [ "$PROVIDER" = "gemini" ]; then
    MODELS_SECTION='"models": { "provider": "gemini", "gemini": { "model": "'"${MODEL}"'" } }'
elif [ "$PROVIDER" = "kimi" ]; then
    MODELS_SECTION='"models": { "provider": "kimi", "kimi": { "model": "'"${MODEL}"'" } }'
elif [ "$PROVIDER" = "antigravity" ]; then
    MODELS_SECTION='"models": { "provider": "antigravity", "antigravity": { "model": "'"${MODEL}"'" } }'
else
    MODELS_SECTION='"models": { "provider": "openai", "openai": { "model": "'"${MODEL}"'" } }'
fi

# Build auth section from accumulated sign-in data
AUTH_SECTION=""
if [ -n "$AUTH_JSON" ]; then
    # Strip trailing comma
    AUTH_JSON="${AUTH_JSON%,}"
    AUTH_SECTION="\"auth\": { $AUTH_JSON },"
fi

cat > "$SETTINGS_FILE" <<EOF
{
  "workspace": {
    "path": "${WORKSPACE_PATH}",
    "name": "${WORKSPACE_NAME}"
  },
  "channels": {
    "enabled": ${CHANNELS_JSON},
    "discord": {
      "bot_token": "${DISCORD_TOKEN}"
    },
    "telegram": {
      "bot_token": "${TELEGRAM_TOKEN}"
    },
    "whatsapp": {}
  },
  ${AGENTS_JSON}
  ${MODELS_SECTION},
  ${AUTH_SECTION}
  "monitoring": {
    "heartbeat_interval": ${HEARTBEAT_INTERVAL}
  }
}
EOF

# Normalize JSON with jq (fix any formatting issues)
if command -v jq &> /dev/null; then
    tmp_file="$SETTINGS_FILE.tmp"
    jq '.' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$SETTINGS_FILE"
fi

# Create workspace directory
mkdir -p "$WORKSPACE_PATH"
echo -e "${GREEN}✓ Created workspace: $WORKSPACE_PATH${NC}"

# Create ~/.tinyclaw with templates
TINYCLAW_HOME="$HOME/.tinyclaw"
mkdir -p "$TINYCLAW_HOME"
mkdir -p "$TINYCLAW_HOME/logs"
if [ -d "$PROJECT_ROOT/.claude" ]; then
    cp -r "$PROJECT_ROOT/.claude" "$TINYCLAW_HOME/"
fi
if [ -f "$PROJECT_ROOT/heartbeat.md" ]; then
    cp "$PROJECT_ROOT/heartbeat.md" "$TINYCLAW_HOME/"
fi
if [ -f "$PROJECT_ROOT/AGENTS.md" ]; then
    cp "$PROJECT_ROOT/AGENTS.md" "$TINYCLAW_HOME/"
fi
echo -e "${GREEN}✓ Created ~/.tinyclaw with templates${NC}"

# Create default agent directory with config files
mkdir -p "$DEFAULT_AGENT_DIR"
if [ -d "$TINYCLAW_HOME/.claude" ]; then
    cp -r "$TINYCLAW_HOME/.claude" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_HOME/heartbeat.md" ]; then
    cp "$TINYCLAW_HOME/heartbeat.md" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_HOME/AGENTS.md" ]; then
    cp "$TINYCLAW_HOME/AGENTS.md" "$DEFAULT_AGENT_DIR/"
fi
echo -e "${GREEN}✓ Created default agent directory: $DEFAULT_AGENT_DIR${NC}"

# Create ~/.tinyclaw/files directory for file exchange
mkdir -p "$TINYCLAW_HOME/files"
echo -e "${GREEN}✓ Created files directory: $TINYCLAW_HOME/files${NC}"

# Create directories for additional agents
for agent_id in "${ADDITIONAL_AGENTS[@]}"; do
    AGENT_DIR="$WORKSPACE_PATH/$agent_id"
    mkdir -p "$AGENT_DIR"
    if [ -d "$TINYCLAW_HOME/.claude" ]; then
        cp -r "$TINYCLAW_HOME/.claude" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_HOME/heartbeat.md" ]; then
        cp "$TINYCLAW_HOME/heartbeat.md" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_HOME/AGENTS.md" ]; then
        cp "$TINYCLAW_HOME/AGENTS.md" "$AGENT_DIR/"
    fi
    echo -e "${GREEN}✓ Created agent directory: $AGENT_DIR${NC}"
done

echo -e "${GREEN}✓ Configuration saved to ~/.tinyclaw/settings.json${NC}"
echo ""
echo "You can manage agents later with:"
echo -e "  ${GREEN}tinyclaw agent list${NC}    - List agents"
echo -e "  ${GREEN}tinyclaw agent add${NC}     - Add more agents"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}tinyclaw start${NC}"
echo ""
