# Coding Agent Development Plan

## 📋 Project Status

**Last Updated**: January 15, 2025  
**Current Phase**: Core Implementation Complete  
**Last Worked On**: Enhanced CLI client design and shell command tool planning  
**Up Next**: Shell command tool implementation  

## ✅ Completed Tasks

### Core Infrastructure (✅ Complete)
- [x] **Agent Architecture** - Agentuity-based cloud agent with tool calling
- [x] **Claude 4 Sonnet Integration** - LLM with streaming responses  
- [x] **KV Store Context** - Conversation memory and session management
- [x] **File Operations Tools** - read_file, write_file, list_directory, create_directory
- [x] **Code Execution** - Riza.io integration for Python/JS/TS execution
- [x] **Basic CLI Client** - Simple test client for interaction
- [x] **Authentication** - Bearer token and session tracking
- [x] **Documentation** - Comprehensive README and usage examples

## 🔄 Current Sprint (In Progress)

### Priority 1: Enhanced CLI Experience
**Status**: Planning Complete, Ready for Implementation  
**Estimated Time**: 1-2 weeks  

#### Tasks:
- [ ] **Shell Command Tool** - Execute git, npm, build commands safely
- [ ] **Enhanced CLI Client** - Project-aware, better UX, interactive mode
- [ ] **Diff Visualization** - Integration with delta or built-in colored diffs
- [ ] **Project Detection** - Auto-detect git repos, package.json, etc.
- [ ] **File Watching** - Monitor changes and sync with agent

## 📅 Roadmap

### Phase 1: Enhanced CLI (Next 2-4 weeks)
**Goal**: Production-ready CLI tool similar to Amp/Claude CLI

#### Core Features
- [ ] **Project Context Awareness**
  - Auto-detect git repositories
  - Read project configuration (package.json, pyproject.toml, go.mod)
  - Understand project structure and conventions
  
- [ ] **Interactive Command System**
  ```bash
  coder "Create a FastAPI server"           # Direct command
  coder --project ./my-app "Add auth"       # Project-specific
  coder --interactive                       # Interactive mode
  > /edit src/main.py                      # Edit specific file
  > /diff                                  # Show changes
  > /run npm test                          # Execute commands
  > /commit "Add authentication"           # Git operations
  ```

- [ ] **Advanced Tools**
  - `run_command` - Safe shell command execution
  - `git_operations` - Status, diff, commit, push
  - `project_analyze` - Understand codebase structure
  - `diff_files` - Compare file versions

- [ ] **Change Tracking & Visualization**
  - Real-time diff display using `delta`
  - File change notifications
  - Git integration for automatic commits
  - Before/after comparisons

#### CLI Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLI Client    │───▶│   Project       │───▶│   Agent API     │
│                 │    │   Manager       │    │                 │
│ • Commands      │    │ • File Watch    │    │ • Tools         │
│ • Interactive   │    │ • Git Ops       │    │ • Streaming     │
│ • Diff Display  │    │ • Context       │    │ • Sessions      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Phase 2: Editor Integration (1-2 months)
**Goal**: Seamless development environment integration

#### VSCode Extension
**Features:**
- [ ] **Real-time Collaboration Panel**
- [ ] **Inline Code Suggestions**
- [ ] **Side-by-side Diff View**
- [ ] **Integrated Terminal Output**
- [ ] **Context Menu Integration**
- [ ] **File Tree Integration**

**Benefits:**
- Rich UI capabilities (custom panels, diff viewers)
- Direct VSCode API access
- Excellent user experience for VSCode users
- Can integrate with existing VSCode features (terminal, git, etc.)
- Easier to implement than universal solutions

### Phase 3: Advanced Features (2-3 months)
**Goal**: Enterprise-ready coding assistant

- [ ] **Multi-Project Workspaces**
- [ ] **Code Review System**
- [ ] **CI/CD Integration**
- [ ] **Team Collaboration**
- [ ] **Custom Tool Plugins**
- [ ] **Performance Optimization**

## 🛠 Technical Implementation Details

### Shell Command Tool Design
```typescript
interface ShellCommandTool {
  name: 'run_command';
  description: 'Execute shell commands safely (git, npm, build tools)';
  parameters: {
    command: string;
    workingDir?: string;
    timeout?: number;
    allowedCommands?: string[]; // Security whitelist
  };
  safety: {
    // Whitelist of safe commands
    allowed: ['git', 'npm', 'yarn', 'bun', 'python', 'node', 'tsc', 'cargo'];
    // Blocked patterns
    blocked: ['rm -rf', 'sudo', 'curl', 'wget'];
  };
}
```

### Enhanced CLI Architecture
```typescript
interface CLIClient {
  // Core functionality
  commands: CommandHandler;
  session: SessionManager;
  project: ProjectDetector;
  
  // Features
  fileWatcher: FileWatcher;
  diffViewer: DiffDisplay;
  gitIntegration: GitOperations;
  
  // Configuration
  config: CLIConfig;
  auth: AuthManager;
}
```

### Diff Visualization Options

#### Option 1: Delta Integration (Recommended)
- Industry standard for beautiful diffs
- Syntax highlighting and themes
- Easy integration: `git diff | delta`

#### Option 2: Built-in Diff Display
```typescript
import { diffLines } from 'diff';
import chalk from 'chalk';

function displayDiff(oldContent: string, newContent: string) {
  const diff = diffLines(oldContent, newContent);
  diff.forEach(part => {
    const color = part.added ? 'green' : part.removed ? 'red' : 'grey';
    process.stdout.write(chalk[color](part.value));
  });
}
```

#### Option 3: Git-based Tracking
- Automatic commits before agent changes
- Use git's diff capabilities
- Integration with existing git workflows

## 📊 Success Metrics

### Phase 1 Success Criteria
- [ ] CLI can handle 90% of common coding tasks
- [ ] File operations work reliably across different project types
- [ ] Diff visualization is clear and helpful
- [ ] Shell commands execute safely with proper error handling
- [ ] Session persistence works across restarts

### Phase 2 Success Criteria
- [ ] Editor integration feels native and responsive
- [ ] Real-time collaboration doesn't interfere with normal coding
- [ ] Diff views are intuitive and actionable
- [ ] Performance is acceptable for large codebases

## 🔄 Weekly Review Schedule

### Every Monday: Sprint Planning
- Review completed tasks
- Plan upcoming week priorities
- Update roadmap based on learnings

### Every Friday: Progress Review
- Document what was accomplished
- Identify blockers and challenges
- Prepare for next week

## 🎯 Immediate Next Actions

### This Week (Priority Order)
1. **Implement Shell Command Tool** (2-3 days)
   - Add to `tools.ts` with safety checks
   - Test with common commands (git, npm, etc.)
   - Update agent to use new tool

2. **Enhanced CLI Client Design** (2-3 days)
   - Create new CLI architecture
   - Implement project detection
   - Add interactive command system

3. **Diff Visualization** (1-2 days)
   - Integrate delta or build custom diff display
   - Test with various file types
   - Ensure good UX for change tracking

### Next Week
1. **File Watching System**
2. **Git Integration Tool**
3. **CLI Polish and Testing**

## 📝 Notes & Decisions

### Editor Integration Decision
**Decision**: VSCode Extension
**Reasoning**: 
- Faster time to market
- Better user experience capabilities
- Rich UI possibilities (custom panels, diff viewers)
- Easier debugging and development
- Direct access to VSCode APIs and ecosystem

### Security Considerations
- Shell commands must be sandboxed/whitelisted
- File operations should respect project boundaries
- Git operations need proper authentication handling
- Code execution already handled safely via Riza.io

### Performance Considerations
- Large file handling needs optimization
- Streaming responses essential for good UX
- File watching should be efficient (use proper debouncing)
- Session storage should have reasonable limits

---

**Last Updated**: January 15, 2025  
**Next Review**: January 22, 2025
