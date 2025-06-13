# Environment Variables Setup

## Required Environment Variables

### 1. Agentuity API Key
```bash
# For local development
API_KEY=your_agentuity_api_key_here

# For cloud deployment  
AGENTUITY_API_KEY=your_agentuity_api_key_here
```

### 2. Riza API Key (Optional - for code execution)
```bash
RIZA_API_KEY=your_riza_api_key_here
```

**Note**: If `RIZA_API_KEY` is not set, code execution tools will fail gracefully with helpful error messages.

## Setup Instructions

### Local Development (.env file)
Create a `.env` file in the project root:

```env
# Agentuity Configuration
API_KEY=your_agentuity_api_key_here
AGENT_URL=http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8

# Optional: Code Execution (sign up at https://riza.io)
RIZA_API_KEY=your_riza_api_key_here

# CLI Mode
CODER_MODE=local
```

### Cloud Deployment
For cloud deployment, set these as environment variables in your deployment environment:

```bash
export AGENTUITY_API_KEY=your_agentuity_api_key_here
export RIZA_API_KEY=your_riza_api_key_here  # Optional
```

### Getting API Keys

#### Agentuity API Key
1. Go to [Agentuity Dashboard](https://app.agentuity.com)
2. Create an account or log in
3. Navigate to API Keys section
4. Generate a new API key
5. Copy and add to your `.env` file

#### Riza API Key (Optional)
1. Go to [Riza.io](https://riza.io)
2. Sign up for an account
3. Get your API key from the dashboard
4. Add to your `.env` file

**Note**: Code execution features will work without Riza, but will show helpful setup instructions.

## Security Best Practices

### ✅ Do This:
- Store API keys in environment variables
- Use `.env` files for local development
- Add `.env` to `.gitignore` (already done)
- Use different keys for development and production

### ❌ Never Do This:
- Commit API keys to version control
- Hardcode secrets in source code
- Share API keys in chat/email
- Use production keys for development

## Verification

Test your setup:

```bash
# Check if environment variables are loaded
bun run cli.js --help

# Test local agent
echo "hello" | bun run cli.js

# Test cloud agent (if deployed)
AGENT_URL=https://your-agent.agentuity.cloud/agent_xxx bun run cli.js --help
```

## Troubleshooting

### "API_KEY environment variable is not set"
- Check your `.env` file exists and contains `API_KEY=...`
- Restart your terminal/IDE after adding environment variables
- Verify the `.env` file is in the project root directory

### "RIZA_API_KEY environment variable is required"
- This is optional - code execution will be disabled but other features work
- Sign up at https://riza.io if you want code execution
- Add `RIZA_API_KEY=...` to your `.env` file

### CLI can't connect to agent
- Check `AGENT_URL` is correct in your `.env` file
- For local mode: ensure agent is running with `bun run dev`
- For cloud mode: verify the cloud agent URL is correct
