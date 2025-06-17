export interface ProjectInfo {
    type: 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'java' | 'unknown';
    framework?: string;
    packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'poetry' | 'cargo' | 'go' | 'bundler' | 'maven' | 'gradle';
    buildTool?: string;
    testRunner?: string;
    hasTypescript?: boolean;
    mainLanguage?: string;
    suggestedCommands?: {
        install?: string;
        dev?: string;
        build?: string;
        test?: string;
        lint?: string;
        format?: string;
    };
}
export declare class ProjectAnalyzer {
    private projectPath;
    constructor(projectPath?: string);
    analyze(): Promise<ProjectInfo>;
    private fileExists;
    private readJson;
    private readFile;
    private detectNodePackageManager;
    private detectNodeFramework;
    private detectTestRunner;
    private getNodeCommands;
    private detectPythonPackageManager;
    private detectPythonFramework;
    private getPythonCommands;
    private detectRubyFramework;
    private getRubyCommands;
    private getJavaCommands;
}
