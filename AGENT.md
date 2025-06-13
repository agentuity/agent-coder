# AGENT.md - Coding Agent Development Guide

## Build/Lint/Test Commands
- `bun run build` - Build the agent using Agentuity
- `bun run dev` - Start development server (localhost:3500)
- `bun run format` - Format code with Biome
- `bun run lint` - Lint code with Biome
- `bun run cli --local "test message"` - Test local agent
- `bun run test-config` - Test configuration detection
- `bun run show-urls` - Show detected agent URLs

## Architecture & Structure
- **Hybrid cloud-local architecture**: AI agent runs in cloud/local, tools execute locally
- **Main agent**: `src/agents/CloudCoder/index.ts` - Claude-powered coding assistant
- **CLI client**: `cli/` directory - handles tool proxy and continuation between cloud agent and local tools
- **Tools**: `tools/interface.ts` - shared tool schemas for file operations, code execution, shell commands
- **Agent config**: `agentuity.yaml` - Agentuity configuration (DO NOT edit per .cursor/rules)
- Uses Agentuity SDK (`@agentuity/sdk`) for agent framework

## Code Style Guidelines
- **Formatting**: Biome with 2-space indentation, single quotes, trailing commas, semicolons
- **TypeScript**: Strict mode enabled, ES modules, bundler resolution
- **Imports**: Use ES module imports, organize imports enabled
- **Agent exports**: Default function export named Agent or descriptive name
- **Logging**: Use `ctx.logger.info()` from AgentContext, not console.log
- **Error handling**: Proper try-catch blocks, return structured error responses
- **Session management**: Use KV store with TTL for conversation persistence
