#!/usr/bin/env node

import { generateAgentUrls } from '../cli/config-utils.js';
import chalk from 'chalk';

async function showAgentUrls() {
  console.log(chalk.cyan('🔗 Agent URLs for your installation:\n'));

  try {
    // Local URLs
    const localUrls = await generateAgentUrls('local');
    console.log(chalk.green('📍 Local Development Mode:'));
    console.log(`  MainCoder (local):  ${chalk.white(localUrls.mainCoderUrl)}`);
    console.log(
      `  CloudCoder (hybrid): ${chalk.white(localUrls.cloudCoderUrl)}`
    );

    // Cloud URLs (template)
    const cloudUrls = await generateAgentUrls('cloud');
    console.log(chalk.blue('\n☁️  Cloud Deployment Mode:'));
    console.log(`  MainCoder:  ${chalk.white(cloudUrls.mainCoderUrl)}`);
    console.log(`  CloudCoder: ${chalk.white(cloudUrls.cloudCoderUrl)}`);

    console.log(chalk.yellow('\n💡 Usage:'));
    console.log('• For local development, use the local URLs');
    console.log(
      '• For cloud deployment, replace "your-agent.agentuity.cloud" with your actual domain'
    );
    console.log(
      '• The agent IDs are automatically detected using "agentuity agent list"'
    );
  } catch (error) {
    console.error(
      chalk.red('❌ Error reading agent configuration:'),
      error.message
    );
    console.log(
      chalk.yellow(
        '\n💡 Make sure you are in the project root directory with agentuity.yaml'
      )
    );
  }
}

showAgentUrls();
