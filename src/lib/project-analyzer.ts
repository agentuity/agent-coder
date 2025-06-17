import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectInfo {
  type: 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'java' | 'unknown';
  framework?: string;
  packageManager?:
    | 'npm'
    | 'yarn'
    | 'pnpm'
    | 'bun'
    | 'pip'
    | 'poetry'
    | 'cargo'
    | 'go'
    | 'bundler'
    | 'maven'
    | 'gradle';
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

export class ProjectAnalyzer {
  private projectPath: string;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
  }

  async analyze(): Promise<ProjectInfo> {
    const info: ProjectInfo = { type: 'unknown' };

    // Check for Node.js project
    if (await this.fileExists('package.json')) {
      const packageJson = await this.readJson('package.json');
      info.type = 'node';
      info.packageManager = await this.detectNodePackageManager();
      info.framework = this.detectNodeFramework(packageJson);
      info.hasTypescript = await this.fileExists('tsconfig.json');
      info.testRunner = this.detectTestRunner(packageJson);
      info.suggestedCommands = this.getNodeCommands(
        packageJson,
        info.packageManager
      );
    }
    // Check for Python project
    else if (
      (await this.fileExists('requirements.txt')) ||
      (await this.fileExists('pyproject.toml')) ||
      (await this.fileExists('setup.py'))
    ) {
      info.type = 'python';
      info.packageManager = await this.detectPythonPackageManager();
      info.framework = await this.detectPythonFramework();
      info.suggestedCommands = this.getPythonCommands(
        info.framework,
        info.packageManager
      );
    }
    // Check for Go project
    else if (await this.fileExists('go.mod')) {
      info.type = 'go';
      info.packageManager = 'go';
      info.suggestedCommands = {
        install: 'go mod download',
        build: 'go build',
        test: 'go test ./...',
        format: 'go fmt ./...',
      };
    }
    // Check for Rust project
    else if (await this.fileExists('Cargo.toml')) {
      info.type = 'rust';
      info.packageManager = 'cargo';
      info.suggestedCommands = {
        build: 'cargo build',
        dev: 'cargo run',
        test: 'cargo test',
        format: 'cargo fmt',
      };
    }
    // Check for Ruby project
    else if (await this.fileExists('Gemfile')) {
      info.type = 'ruby';
      info.packageManager = 'bundler';
      info.framework = await this.detectRubyFramework();
      info.suggestedCommands = this.getRubyCommands(info.framework);
    }
    // Check for Java project
    else if (
      (await this.fileExists('pom.xml')) ||
      (await this.fileExists('build.gradle'))
    ) {
      info.type = 'java';
      info.packageManager = (await this.fileExists('pom.xml'))
        ? 'maven'
        : 'gradle';
      info.suggestedCommands = this.getJavaCommands(info.packageManager);
    }

    return info;
  }

  private async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.projectPath, filename));
      return true;
    } catch {
      return false;
    }
  }

  private async readJson(filename: string): Promise<Record<string, any>> {
    try {
      const content = await fs.readFile(
        path.join(this.projectPath, filename),
        'utf8'
      );
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async readFile(filename: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.projectPath, filename), 'utf8');
    } catch {
      return '';
    }
  }

  private async detectNodePackageManager(): Promise<
    'npm' | 'yarn' | 'pnpm' | 'bun'
  > {
    if (await this.fileExists('bun.lockb')) return 'bun';
    if (await this.fileExists('pnpm-lock.yaml')) return 'pnpm';
    if (await this.fileExists('yarn.lock')) return 'yarn';
    return 'npm';
  }

  private detectNodeFramework(
    packageJson: Record<string, any>
  ): string | undefined {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps['next']) return 'nextjs';
    if (deps['react']) return 'react';
    if (deps['vue']) return 'vue';
    if (deps['@angular/core']) return 'angular';
    if (deps['svelte']) return 'svelte';
    if (deps['express']) return 'express';
    if (deps['fastify']) return 'fastify';
    if (deps['koa']) return 'koa';
    if (deps['@nestjs/core']) return 'nestjs';

    return undefined;
  }

  private detectTestRunner(
    packageJson: Record<string, any>
  ): string | undefined {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps['vitest']) return 'vitest';
    if (deps['jest']) return 'jest';
    if (deps['mocha']) return 'mocha';
    if (deps['@playwright/test']) return 'playwright';
    if (deps['cypress']) return 'cypress';

    return undefined;
  }

  private getNodeCommands(
    packageJson: Record<string, any>,
    pm: string
  ): ProjectInfo['suggestedCommands'] {
    const scripts = packageJson.scripts || {};
    const pmRun = pm === 'npm' ? 'npm run' : pm;

    return {
      install: pm === 'npm' ? 'npm install' : `${pm} install`,
      dev: scripts.dev
        ? `${pmRun} dev`
        : scripts.start
          ? `${pmRun} start`
          : undefined,
      build: scripts.build ? `${pmRun} build` : undefined,
      test: scripts.test ? `${pmRun} test` : undefined,
      lint: scripts.lint ? `${pmRun} lint` : undefined,
      format: scripts.format ? `${pmRun} format` : undefined,
    };
  }

  private async detectPythonPackageManager(): Promise<'pip' | 'poetry'> {
    if (
      (await this.fileExists('poetry.lock')) ||
      (await this.fileExists('pyproject.toml'))
    ) {
      const pyproject = await this.readFile('pyproject.toml');
      if (pyproject.includes('[tool.poetry]')) return 'poetry';
    }
    return 'pip';
  }

  private async detectPythonFramework(): Promise<string | undefined> {
    const requirements = await this.readFile('requirements.txt');
    const pyproject = await this.readFile('pyproject.toml');
    const allDeps = requirements + pyproject;

    if (allDeps.includes('django')) return 'django';
    if (allDeps.includes('flask')) return 'flask';
    if (allDeps.includes('fastapi')) return 'fastapi';
    if (allDeps.includes('pyramid')) return 'pyramid';

    return undefined;
  }

  private getPythonCommands(
    framework?: string,
    pm?: string
  ): ProjectInfo['suggestedCommands'] {
    const base = {
      install:
        pm === 'poetry' ? 'poetry install' : 'pip install -r requirements.txt',
      test: 'pytest',
      format: 'black .',
      lint: 'flake8',
    };

    if (framework === 'django') {
      return { ...base, dev: 'python manage.py runserver' };
    } else if (framework === 'flask' || framework === 'fastapi') {
      return { ...base, dev: 'python app.py' };
    }

    return base;
  }

  private async detectRubyFramework(): Promise<string | undefined> {
    const gemfile = await this.readFile('Gemfile');

    if (gemfile.includes('rails')) return 'rails';
    if (gemfile.includes('sinatra')) return 'sinatra';

    return undefined;
  }

  private getRubyCommands(
    framework?: string
  ): ProjectInfo['suggestedCommands'] {
    const base = {
      install: 'bundle install',
      test: 'bundle exec rspec',
      format: 'rubocop -a',
    };

    if (framework === 'rails') {
      return { ...base, dev: 'rails server', build: 'rails assets:precompile' };
    }

    return base;
  }

  private getJavaCommands(pm: string): ProjectInfo['suggestedCommands'] {
    if (pm === 'maven') {
      return {
        install: 'mvn install',
        build: 'mvn package',
        test: 'mvn test',
        dev: 'mvn spring-boot:run',
      };
    } else {
      return {
        build: 'gradle build',
        test: 'gradle test',
        dev: 'gradle bootRun',
      };
    }
  }
}
