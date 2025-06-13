# 🤖 Coding Agent CLI Guide

A beautiful, professional CLI for your AI coding assistant.

## 🚀 Quick Start

```bash
# Interactive mode (recommended)
bun run cli.js --interactive

# Direct command
bun run cli.js "What does package.json contain?"

# Work in specific project
bun run cli.js --project ./my-app --interactive
```

## 🎨 Features

### ✨ Beautiful Interface
- **Colored output** with syntax highlighting
- **Loading spinners** for agent responses
- **ASCII art header** with figlet
- **Boxed help text** and important messages
- **Progress indicators** for long operations

### 🔧 Interactive Commands
- `/help` - Show available commands
- `/clear` - Clear screen and show header
- `/session` - Start new conversation session
- `/quit` - Exit gracefully

### 🎯 Project Awareness
- **Auto-detects** git repos, package.json, etc.
- **Working directory** support with `--project`
- **Session persistence** across commands

## 📖 Usage Examples

### Interactive Mode
```bash
bun run cli.js -i

# Inside interactive mode:
💬 You: What files are in this project?
💬 You: Create a FastAPI server with authentication
💬 You: /help
💬 You: /quit
```

### Direct Commands
```bash
# Quick questions
bun run cli.js "Show me the git status"

# Code generation
bun run cli.js "Create a React component for user login"

# Debugging help
bun run cli.js "Fix the error in src/main.py"
```

### Project-specific Work
```bash
# Work on specific project
bun run cli.js --project ~/my-app "Add error handling to the API"

# Continue previous session
bun run cli.js --session session_123456 "What was my last change?"
```

## 🎨 CLI Libraries Used

- **Commander.js** - Command parsing and structure
- **Chalk** - Beautiful colors and text styling  
- **Ora** - Elegant loading spinners
- **Inquirer** - Interactive prompts
- **Figlet** - ASCII art headers
- **Boxen** - Styled message boxes

## 🔧 Configuration

Set up your `.env` file:
```bash
API_KEY=your_agentuity_api_key
AGENT_URL=http://127.0.0.1:3500/agent_ae7cbe64f1c31943895f65422617cbf8
```

## 🚀 Installation for Global Use

To install globally:
```bash
bun link
# Now you can use 'coder' from anywhere
coder --interactive
```

## 🎯 Next Steps

The CLI is ready for:
- **Diff visualization** with delta integration
- **File watching** for real-time sync
- **Git integration** with automatic commits
- **Progress bars** for long operations
- **Configuration files** for personalization

---

Ready to code with AI! 🚀
