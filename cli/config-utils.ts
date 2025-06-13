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
export async function getAgentConfigs(): Promise<{ mainCoder: AgentConfig; cloudCoder: AgentConfig; port: number }> {
  try {
    // Use official Agentuity CLI to get agent list
    const { stdout } = await execAsync('agentuity agent list --format json');
    const agentList: AgentuityAgentList = JSON.parse(stdout);
    
    // Find agents by name (case-insensitive)
    const mainCoderKey = Object.keys(agentList).find(key => 
      agentList[key].agent.name.toLowerCase() === 'maincoder'
    );
    const cloudCoderKey = Object.keys(agentList).find(key => 
      agentList[key].agent.name.toLowerCase() === 'cloudcoder'
    );
    
    if (!mainCoderKey) {
      throw new Error('MainCoder agent not found. Run "agentuity agent list" to see available agents.');
    }
    
    if (!cloudCoderKey) {
      throw new Error('CloudCoder agent not found. Run "agentuity agent list" to see available agents.');
    }
    
    const mainCoder = agentList[mainCoderKey].agent;
    const cloudCoder = agentList[cloudCoderKey].agent;
    
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
      mainCoder: { id: mainCoder.id, name: mainCoder.name },
      cloudCoder: { id: cloudCoder.id, name: cloudCoder.name },
      port 
    };
  } catch (error) {
    // Fallback to CLI check if JSON parsing failed
    if (error instanceof Error && error.message.includes('JSON')) {
      console.warn('Could not parse agentuity agent list. Falling back to defaults.');
    } else {
      console.warn('Agentuity CLI not available or no agents found. Using fallback values.');
    }
    
    return {
      mainCoder: { id: 'agent_ae7cbe64f1c31943895f65422617cbf8', name: 'MainCoder' },
      cloudCoder: { id: 'agent_bf7dce65e2c42854896e75533728dbf9', name: 'CloudCoder' },
      port: 3500
    };
  }
}

// Generate agent URLs based on mode and configuration
export async function generateAgentUrls(mode: 'local' | 'cloud'): Promise<{ mainCoderUrl: string; cloudCoderUrl: string }> {
  const { mainCoder, cloudCoder, port } = await getAgentConfigs();
  
  if (mode === 'local') {
    return {
      mainCoderUrl: `http://127.0.0.1:${port}/${mainCoder.id}`,
      cloudCoderUrl: `http://127.0.0.1:${port}/${cloudCoder.id}`
    };
  } else {
    // For cloud mode, use placeholder that user will replace
    return {
      mainCoderUrl: `https://your-agent.agentuity.cloud/${mainCoder.id}`,
      cloudCoderUrl: `https://your-agent.agentuity.cloud/${cloudCoder.id}`
    };
  }
}
