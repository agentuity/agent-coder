# Agent IDs and URL Management

## Overview

This coding agent project uses **dynamic agent IDs** that are automatically read from your `agentuity.yaml` configuration. This ensures that URLs work correctly for every developer's setup without hardcoded values.

## How It Works

### Agent Configuration
Your agent IDs are defined in `agentuity.yaml`:
```yaml
agents:
  - id: agent_ae7cbe64f1c31943895f65422617cbf8  # MainCoder (local execution)
    name: MainCoder
  - id: agent_bf7dce65e2c42854896e75533728dbf9  # CloudCoder (hybrid execution)  
    name: CloudCoder
```

### Dynamic URL Generation
The project includes a utility (`cli/config-utils.ts`) that:
1. **Uses `agentuity agent list --format json`** to get your actual registered agents
2. **Generates correct URLs** for both local and cloud modes  
3. **Handles fallbacks** if the Agentuity CLI is unavailable

### Automatic URL Detection
Scripts and setup wizards automatically use the correct URLs:

```javascript
import { generateAgentUrls } from './cli/config-utils.js';

// Get URLs for your specific setup
const { mainCoderUrl, cloudCoderUrl } = await generateAgentUrls('local');
// mainCoderUrl: http://127.0.0.1:3500/agent_your_actual_id
// cloudCoderUrl: http://127.0.0.1:3500/agent_your_cloud_id
```

## Usage

### Check Your Agent URLs
```bash
bun run show-urls
```

This shows your actual agent URLs:
```
🔗 Agent URLs for your installation:

📍 Local Development Mode:
  MainCoder (local):  http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8
  CloudCoder (hybrid): http://127.0.0.1:3500/agent_bf7dce65e2c42854896e75533728dbf9

☁️  Cloud Deployment Mode:
  MainCoder:  https://your-agent.agentuity.cloud/agent_ae7cbe64f1c31943895f65422617cbf8
  CloudCoder: https://your-agent.agentuity.cloud/agent_bf7dce65e2c42854896e75533728dbf9
```

### Setup Wizard
The setup wizard (`bun run setup`) automatically:
- Detects your agent IDs from `agentuity.yaml`
- Generates correct URLs for local/cloud modes
- Creates configuration with your actual agent endpoints

### Testing Scripts
All test scripts use dynamic URLs:
- `test-cloud.js` - Tests cloud agent with your actual ID
- Test scripts automatically work for any developer's setup

## For Developers

### When You Clone This Repo
1. **Your agent IDs will be different** from the examples shown
2. **URLs are generated automatically** from your `agentuity.yaml`
3. **No manual URL configuration needed** - everything just works

### Agent Types
- **MainCoder**: Executes tools locally (traditional mode)
- **CloudCoder**: Streams tool calls to CLI for local execution (hybrid mode)

### Files That Use Dynamic URLs
- ✅ `cli/setup-command.ts` - Setup wizard
- ✅ `test-cloud.js` - Cloud agent testing
- ✅ All configuration scripts

### No More Hardcoded IDs
Previous versions had hardcoded agent IDs like:
```javascript
// ❌ Old way (hardcoded)
const AGENT_URL = 'http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8';

// ✅ New way (dynamic)
const { mainCoderUrl } = await generateAgentUrls('local');
const AGENT_URL = mainCoderUrl;
```

## Troubleshooting

### "Agent not found" errors
- Run `agentuity agent list` to see your registered agents
- Ensure both `MainCoder` and `CloudCoder` agents are deployed
- Run `bun run show-urls` to verify your agent IDs
- Check that you're in the project root directory

### Wrong URLs in configuration
- Delete `agentuity-coder.config.json` and run `bun run setup` again
- The setup will regenerate URLs with your current agent IDs

### Testing with different agent IDs
- The test scripts automatically use your agent IDs
- No need to modify test files when agent IDs change

## Benefits

✅ **No hardcoded agent IDs** - works for every developer  
✅ **Uses official Agentuity CLI** - reliable agent detection  
✅ **Automatic URL generation** - no manual configuration  
✅ **Real-time agent status** - uses actually deployed agents  
✅ **Fallback handling** - graceful degradation if CLI unavailable  
✅ **Developer-friendly** - setup just works after cloning
