# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered coding assistant built with the Agentuity platform. It provides a hybrid cloud-local architecture where AI logic runs in the cloud while file operations and code execution happen locally for security.

## Essential Commands

```bash
# Development
bun run dev          # Start local development server (port 3500)
bun run build        # Build using Agentuity bundler
bun run start        # Bundle and run locally

# Code Quality (ALWAYS run before completing tasks)
bun run format       # Format code with Biome
bun run lint         # Lint code with Biome

# CLI Testing
bun run cli          # Run CLI in development mode
bun run cli --local "test message"  # Test local agent
bun run test-config  # Test dynamic configuration
bun run show-urls    # Show detected agent URLs
```

## Architecture

The project uses a hybrid cloud-local architecture:

- **Cloud Agent** (`src/agents/CloudCoder/`): Contains the AI logic that runs on Agentuity cloud or locally
- **CLI Client** (`cli.js`): User interface that connects to the agent and renders markdown
- **Tool Proxy** (`cli/tool-proxy.ts`): Executes tools locally based on cloud agent requests
- **Continuation Handler** (`cli/continuation-handler.ts`): Manages tool execution workflow

All tools are defined in `tools/interface.ts` with shared schemas between cloud and local components.

## Key Development Patterns

1. **Tool Development**: When adding new tools, update both `tools/interface.ts` (schemas) and `cli/tool-proxy.ts` (implementation)

2. **Security Model**: Only whitelisted commands can be executed locally. See `allowedCommands` in `cli/tool-proxy.ts`

3. **TypeScript Configuration**: Strict mode is enabled. All code should follow strict typing rules

4. **Code Style**: Use Biome for formatting and linting. No manual formatting changes needed

5. **Agent Configuration**: The `agentuity.yaml` file is auto-generated. Never edit it directly

## Testing Approach

- No dedicated test framework is configured
- Test manually using `bun run cli` with various commands
- Use `bun run test-config` to verify configuration detection
- Test both cloud and local modes during development