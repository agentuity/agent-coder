# Agentuity CLI Integration Improvement

## What Changed

We replaced manual YAML parsing with the official **Agentuity CLI** for agent detection.

### Before (YAML Parsing)
```typescript
// ❌ Manual YAML parsing
const yamlContent = await readFile('agentuity.yaml', 'utf-8');
const config: AgentuityConfig = parse(yamlContent);
const agents = config.agents.find(agent => agent.name === 'MainCoder');
```

### After (Agentuity CLI)
```typescript
// ✅ Official Agentuity CLI
const { stdout } = await execAsync('agentuity agent list --format json');
const agentList: AgentuityAgentList = JSON.parse(stdout);
```

## Benefits of Using Agentuity CLI

### 🎯 **More Reliable**
- Uses the official Agentuity API instead of file parsing
- Gets actual deployed/registered agents, not just YAML config
- Handles agent registration status automatically

### 📊 **Richer Data**  
The CLI provides more information:
```json
{
  "cloudcoder": {
    "agent": {
      "id": "agent_3918f7879297cf4159ea3d23b54f835b",
      "name": "CloudCoder", 
      "io_types": ["webhook"]
    },
    "filename": "/path/to/agent/file.ts",
    "foundLocal": true,
    "foundRemote": true,
    "rename": false
  }
}
```

### 🔄 **Real-Time Status**
- Shows which agents are actually deployed
- Indicates local vs remote availability  
- Detects renamed or missing agents

### 🛠️ **Official Integration**
- Uses the same data source as `agentuity deploy`
- Consistent with Agentuity ecosystem expectations
- Future-proof against YAML format changes

## Updated Files

### `cli/config-utils.ts`
- ✅ Now uses `agentuity agent list --format json`
- ✅ Improved error handling and fallbacks
- ✅ Case-insensitive agent name matching
- ✅ Still reads port from YAML when available

### `scripts/show-agent-urls.js`
- ✅ Updated messaging to reflect CLI usage
- ✅ Better error messages for troubleshooting

### `AGENT_IDS.md`
- ✅ Updated documentation to reflect CLI integration
- ✅ Improved troubleshooting with CLI commands

## Testing Results

### Agent Detection Works
```bash
$ bun run show-urls
🔗 Agent URLs for your installation:

📍 Local Development Mode:
  MainCoder (local):  http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8
  CloudCoder (hybrid): http://127.0.0.1:3500/agent_3918f7879297cf4159ea3d23b54f835b
```

### Dynamic URL Generation  
- ✅ Setup wizard uses correct agent IDs
- ✅ Test scripts automatically detect agent URLs
- ✅ Fallback handling if CLI unavailable

### Developer Experience
```bash
# Check what agents are available
agentuity agent list

# See your URLs automatically
bun run show-urls

# Setup uses correct agents
bun run setup
```

## Fallback Strategy

If `agentuity agent list` fails:
1. **Graceful degradation** to default agent IDs
2. **Clear warning messages** about CLI availability
3. **Continued functionality** with reasonable defaults

## Impact

### For Developers
- 🎯 **More reliable** - uses actual deployed agents
- 🔧 **Less setup** - automatically detects current state
- 📊 **Better debugging** - can see agent registration status

### For Maintenance  
- 🛡️ **Future-proof** - uses official Agentuity API
- 🔄 **Self-updating** - reflects real agent state
- 📝 **Simpler code** - less YAML parsing logic

This improvement makes the coding agent more robust and aligned with Agentuity best practices! 🚀
