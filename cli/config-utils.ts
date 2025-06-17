import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const execAsync = promisify(exec);

interface AgentConfig {
  id: string;
  name: string;
}

interface AgentuityAgentInfo {
  agent: {
    id: string;
    name: string;
    io_types: string[];
  };
  filename: string;
  foundLocal: boolean;
  foundRemote: boolean;
}

interface AgentuityAgentList {
  [key: string]: AgentuityAgentInfo;
}

// Get agent configurations using Agentuity CLI
export async function getAgentConfigs(): Promise<{
  cloudCoder: AgentConfig;
  port: number;
}> {
  try {
    // Use official Agentuity CLI to get agent list
    const { stdout } = await execAsync('agentuity agent list --format json');
    const agentList: AgentuityAgentList = JSON.parse(stdout);

    // Find CloudCoder agent (now the only agent)
    const cloudCoderKey = Object.keys(agentList).find(
      (key) => agentList[key]?.agent?.name?.toLowerCase() === 'cloudcoder'
    );

    if (!cloudCoderKey) {
      throw new Error(
        'CloudCoder agent not found. Run "agentuity agent list" to see available agents.'
      );
    }

    const cloudCoder = agentList[cloudCoderKey]?.agent;

    if (!cloudCoder) {
      throw new Error(
        'Could not load agent details. Please check agent configuration.'
      );
    }

    // Get port from agentuity.yaml if available
    let port = 3500;
    try {
      const yamlContent = await readFile('agentuity.yaml', 'utf-8');
      const config = parse(yamlContent);
      port = config.development?.port || 3500;
    } catch {
      // Use default port if YAML not readable
    }

    return {
      cloudCoder: { id: cloudCoder.id, name: cloudCoder.name },
      port,
    };
  } catch (error) {
    // Fallback to CLI check if JSON parsing failed
    if (error instanceof Error && error.message.includes('JSON')) {
      console.warn(
        'Could not parse agentuity agent list. Falling back to defaults.'
      );
    } else {
      console.warn(
        'Agentuity CLI not available or no agents found. Using fallback values.'
      );
    }

    return {
      cloudCoder: {
        id: 'agent_3918f7879297cf4159ea3d23b54f835b',
        name: 'CloudCoder',
      },
      port: 3500,
    };
  }
}

// Generate agent URL based on mode and configuration
export async function generateAgentUrl(
  mode: 'local' | 'cloud'
): Promise<string> {
  const { cloudCoder, port } = await getAgentConfigs();

  if (mode === 'local') {
    return `http://127.0.0.1:${port}/${cloudCoder.id}`;
  }

  // For cloud mode, use the actual Agentuity cloud URL
  return `https://agentuity.ai/api/${cloudCoder.id}`;
}
