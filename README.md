# Coding Agent

A powerful AI coding agent built with Agentuity that can read, write, analyze, and execute code across multiple languages. This agent provides autonomous coding assistance with secure code execution via Riza.io.

## Features

### 🔧 Core Capabilities
- **File Operations**: Read, write, list directories, create directories
- **Code Execution**: Safe execution of Python, JavaScript, and TypeScript in sandboxed environments
- **Multi-Language Support**: Works with Python, JavaScript, TypeScript, and Go codebases
- **Conversation Memory**: Maintains context across interactions using Agentuity KV store
- **Streaming Responses**: Real-time response streaming for better user experience

### 🛠 Available Tools

1. **`read_file`** - Read and examine existing code files
2. **`write_file`** - Create new files or modify existing ones
3. **`list_directory`** - Explore project structure and organization
4. **`create_directory`** - Create directories for proper code organization
5. **`execute_code`** - Run and test code safely in isolated environments

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Local Client  │───▶│  Agentuity      │───▶│     Tools       │
│   (CLI/VSCode)  │    │  Cloud Agent    │    │                 │
└─────────────────┘    └─────────────────┘    │  • File Ops     │
                                             │  • Code Exec    │
                                             │  • Git Ops      │
                                             └─────────────────┘
                                                      │
                                             ┌─────────────────┐
                                             │   Riza.io API   │
                                             │ (Code Execution)│
                                             └─────────────────┘
```

## Quick Start

### 1. Start the Agent
```bash
# Development mode (local)
bun run dev

# Production deployment
agentuity deploy
```

### 2. Test with CLI Client
```bash
# Make executable and run
chmod +x test-client.js
node test-client.js
```

### 3. API Endpoints
- **Local**: `http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8`
- **Cloud**: Will be provided after deployment

## Usage Examples

### Basic File Operations
```
You: Can you read the package.json file and tell me what dependencies we have?

Agent: I'll read the package.json file for you.
[reads file and analyzes dependencies]
```

### Code Development
```
You: Create a simple Python function that calculates fibonacci numbers

Agent: I'll create a fibonacci function for you.
[writes fibonacci.py file]
[tests the code using execute_code tool]
```

### Project Analysis
```
You: Help me understand the structure of this project

Agent: I'll explore the project structure for you.
[lists directories and key files]
[provides architectural overview]
```

### Code Execution and Testing
```
You: Can you test this Python code: print("Hello, World!")

Agent: I'll execute that Python code for you.
[uses execute_code tool]
[shows output: "Hello, World!"]
```

## Configuration

### Environment Variables
- `RIZA_API_KEY`: Your Riza.io API key for code execution
- `AGENTUITY_API_KEY`: Automatically set by Agentuity platform

### Authentication
- Bearer token authentication required
- Session-based conversation tracking
- Secure KV storage for context

## Local Integration Options

### Option 1: CLI Tool (Current)
- Simple command-line interface
- Real-time conversation
- File/directory operations
- Easy testing and development

### Option 2: VSCode Extension (Future)
- Real-time code editing collaboration
- Contextual file sending
- Integrated terminal/output
- Seamless workflow integration

### Option 3: API Integration
- Direct HTTP API calls
- Custom client development
- Integration with existing tools
- Programmatic access

## API Reference

### Request Format
```bash
curl -X POST http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8 \
  -H "Content-Type: text/plain" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "x-session-id: unique-session-id" \
  -d "Your coding request here"
```

### Response Format
- Streaming text responses
- Real-time tool execution updates
- Error handling with clear messages
- Context preservation across requests

## Best Practices

### For Users
1. **Be Specific**: Provide clear requirements and context
2. **Use Sessions**: Include session IDs for conversation continuity
3. **Test Incrementally**: Work on small, testable pieces
4. **Provide Context**: Share relevant file paths and project structure

### For Development
1. **Security**: All code execution happens in Riza.io sandbox
2. **Error Handling**: Comprehensive error reporting and recovery
3. **Performance**: Efficient file operations and caching
4. **Scalability**: Designed for multiple concurrent users

## File Structure

```
CodingAgent/
├── src/
│   └── agents/
│       └── MainCoder/
│           ├── index.ts       # Main agent logic
│           └── tools.ts       # Tool definitions
├── test-client.js            # CLI testing client
├── package.json              # Dependencies
├── agentuity.yaml           # Agentuity configuration
└── README.md                # This documentation
```

## Troubleshooting

### Common Issues

**Agent not responding:**
- Check if development server is running (`bun run dev`)
- Verify correct endpoint URL and API key
- Check network connectivity

**Code execution fails:**
- Verify Riza.io API key is set correctly
- Check if language is supported (Python, JavaScript, TypeScript)
- Review code syntax and dependencies

**File operations fail:**
- Check file/directory permissions
- Verify paths are relative to working directory
- Ensure parent directories exist for write operations

### Debugging

1. Check agent logs in development mode
2. Use test client for isolated testing
3. Verify tool execution in Agentuity console
4. Monitor KV store for session persistence

## Contributing

To extend the agent:

1. **Add New Tools**: Extend `tools.ts` with new tool definitions
2. **Update Agent Logic**: Modify conversation handling in `index.ts`
3. **Test Thoroughly**: Use test client and write unit tests
4. **Document Changes**: Update this documentation

## Security

- All code execution happens in isolated Riza.io sandboxes
- No direct system access from executed code
- Bearer token authentication for all requests
- Session-based isolation for multi-user scenarios
- Secure KV storage for conversation context

## Support

- **Documentation**: https://agentuity.dev
- **Issues**: Use project issue tracker
- **Community**: Join Agentuity Discord
- **API Reference**: https://docs.riza.io

---

Built with ❤️ using [Agentuity](https://agentuity.dev) and [Riza.io](https://riza.io)
