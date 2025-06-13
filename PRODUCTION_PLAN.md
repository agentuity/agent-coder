# Coding Agent Production Hardening Plan

## 1. Cloud Deployment Architecture

### Current State
- Agent and tools are tightly coupled, assuming local file system access
- Tools use Node.js `fs` module and `exec` directly
- Works only when agent runs locally

### Target Architecture: Hybrid Cloud + Local Tools

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cloud Agent   │◄──►│   Local CLI     │◄──►│  Local Tools    │
│  (Claude LLM)   │    │ (Tool Proxy)    │    │ (File System)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Implementation Requirements

#### A. Split Architecture
1. **Cloud Agent** (`src/agents/CloudCoder/`)
   - Contains LLM logic and reasoning
   - No direct file system access
   - Sends tool requests via WebSocket/HTTP
   - Receives tool results from CLI

2. **Local CLI** (`cli/`)
   - WebSocket client connected to cloud agent
   - Tool executor (runs tools locally)
   - Handles streaming responses
   - Session management

3. **Tool Interface** (`tools/`)
   - Shared tool definitions
   - Transport-agnostic tool execution
   - Support both local and remote modes

#### B. Communication Protocol (HTTP Streaming + Continuation)

**Instead of WebSockets, use Agentuity's `response.stream` with a continuation pattern:**

1. CLI sends message to cloud agent
2. Agent streams back tool calls via `response.stream`
3. CLI executes tools locally and collects results
4. CLI sends continuation request with tool results
5. Agent continues from where it left off

```typescript
interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

interface ContinuationRequest {
  sessionId: string;
  toolResults: Array<{
    id: string;
    success: boolean;
    result?: string;
    error?: string;
  }>;
}
```

**Advantages over WebSockets:**
- ✅ Uses existing Agentuity streaming infrastructure
- ✅ No need for persistent connections
- ✅ Simpler deployment (HTTP only)
- ✅ Better error handling and retry logic

## 2. Developer Experience (DX) Improvements

### A. Easy Setup & Configuration

#### Simple Git Clone Setup
```bash
git clone https://github.com/yourorg/coding-agent.git
cd coding-agent
bun install
bun run setup
```

**Setup script does:**
1. Creates `agentuity-coder.config.json`
2. Prompts for agent URL and API key
3. Sets up environment files
4. Creates CLI alias/script

#### Config Structure
```json
{
  "agentUrl": "https://your-agent.agentuity.cloud/agent_xxx",
  "apiKey": "[ENCRYPTED]",
  "sessionTimeout": 3600,
  "toolsPath": "./tools",
  "maxFileSize": "10MB",
  "allowedCommands": ["git", "npm", "bun", "python"],
  "projectType": "auto-detect"
}
```

### B. Local Development

#### After Setup
```bash
# Use from anywhere (via alias or PATH)
coder --interactive

# Or run directly
bun run cli --interactive
```

### C. Development Tools

#### Local Development Mode
```bash
# Start local agent (development)
bun run dev

# Use local agent
coder --local
```

#### Debug Mode
```bash
# Enable verbose logging
coder --debug --interactive

# Show all tool calls and responses
coder --trace
```

## 3. Security & Safety Hardening

### A. Command Safety
- ✅ Already implemented: Command whitelist in `tools.ts`
- ✅ Already implemented: Blocked dangerous patterns
- 🔄 **TODO**: User-configurable command policies

### B. File System Security
```typescript
interface SecurityPolicy {
  allowedPaths: string[];        // Only allow access to project dirs
  blockedPaths: string[];        // Block system directories
  maxFileSize: number;           // Prevent huge file operations
  requireConfirmation: string[]; // Commands that need user approval
}
```

### C. API Key Management
- ✅ **No hardcoded secrets**: All API keys must be in environment variables
- ✅ **Graceful degradation**: Code execution fails safely when RIZA_API_KEY missing
- Encrypt keys in config files
- Support environment variables  
- Integration with system keychains

### D. Security Best Practices
- ✅ **Secret leak prevention**: No API keys committed to code
- ✅ **Environment-based config**: All secrets via environment variables
- ✅ **Error handling**: Clear messages for missing API keys
- User education on API key management

## 4. Implementation Phases

### Phase 1: Hybrid Architecture (1-2 weeks)
- [ ] Create cloud agent variant that streams tool calls
- [ ] Add continuation endpoint for tool results
- [ ] Modify CLI to handle tool calls and send results back
- [ ] Test with cloud deployment

### Phase 2: Setup & DX (1 week)  
- [ ] Create setup command and config management
- [ ] Add CLI alias/PATH setup
- [ ] Documentation and examples

### Phase 3: Advanced Features (1-2 weeks)
- [ ] Enhanced security policies
- [ ] Multi-project workspace support
- [ ] Plugin system for custom tools
- [ ] Telemetry and analytics

## 5. Specific Files to Create/Modify

### New Files Needed:
```
src/agents/CloudCoder/index.ts     # Cloud-only agent variant
cli/tool-proxy.ts                  # Tool execution proxy
cli/continuation-handler.ts        # Handle tool call continuations
cli/config-manager.ts              # Configuration handling  
cli/setup-command.ts               # Setup wizard
tools/interface.ts                 # Shared tool interface
docs/DEPLOYMENT.md                 # Cloud deployment guide
docs/DEVELOPMENT.md                # Local development setup
```

### Files to Modify:
```
cli.js                            # Add tool call handling and continuation
src/agents/MainCoder/tools.ts     # Extract tool interface
package.json                      # Add setup scripts
agentuity.yaml                    # Cloud configuration
```

## 6. Configuration Examples

### Developer's Local Config
```json
{
  "agentUrl": "https://my-team.agentuity.cloud/agent_12345",
  "apiKey": "${CODER_API_KEY}",
  "projectPaths": ["~/code/*"],
  "autoCommit": false,
  "toolPolicy": "strict"
}
```

### Team Shared Config (version controlled)
```json
{
  "agentUrl": "${TEAM_AGENT_URL}",
  "allowedCommands": ["git", "npm", "docker"],
  "blockedPaths": ["/etc", "/usr", "/bin"],
  "maxFileSize": "5MB",
  "requireConfirmation": ["rm", "sudo"]
}
```

## 7. Migration Path

### Step 1: Keep Current Local Mode Working
- Don't break existing functionality
- Add cloud mode as new option

### Step 2: Add Cloud Support Gradually  
- Implement tool proxy pattern
- Test with subset of tools first
- Full feature parity over time

### Step 3: Package and Distribute
- Create installer/setup wizard
- Documentation and examples
- Community feedback and iteration

## Next Steps

1. **Decision**: Confirm hybrid architecture approach
2. **Prototype**: Build minimal tool proxy WebSocket connection
3. **Deploy**: Test cloud agent with basic tools
4. **Package**: Create distribution mechanism
5. **Document**: Setup guides for developers
