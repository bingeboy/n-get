# N-Get AI Agent Integration Guide

This guide explains how to integrate N-Get with AI agents, MCP (Model Context Protocol) servers, and other AI frameworks to enable intelligent, adaptive downloading capabilities.

## Table of Contents

- [Overview](#overview)
- [Configuration Management](#configuration-management)
- [MCP Server Integration](#mcp-server-integration)
- [CrewAI Integration](#crewai-integration)
- [AutoGen Integration](#autogen-integration)
- [LangChain Integration](#langchain-integration)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

N-Get's AI integration enables intelligent automation of download tasks through:

- **Dynamic Configuration**: AI agents can adapt download settings based on task requirements
- **Performance Optimization**: Real-time adjustment based on network conditions and performance metrics
- **Profile Management**: Pre-configured profiles for different scenarios (fast, secure, bulk, careful)
- **Learning System**: Configuration learning from successful download patterns
- **Task Intelligence**: Automatic optimization recommendations for different download scenarios

## Configuration Management

### ConfigManager API

The `ConfigManager` class provides AI-friendly methods for dynamic configuration:

```javascript
const ConfigManager = require('./lib/config/ConfigManager');
const configManager = new ConfigManager({
    environment: 'development',
    enableHotReload: true
});

// Get AI-optimized configuration summary
const summary = configManager.getAIConfigSummary();

// Get available profiles
const profiles = configManager.getAvailableProfiles();

// Apply optimal profile for a task
await configManager.applyOptimalProfile({
    fileCount: 50,
    totalSize: 5368709120, // 5GB
    priority: 'medium',
    securityCritical: false
});
```

### Configuration Profiles

N-Get includes four pre-configured profiles optimized for different scenarios:

#### Fast Profile
- **Use Case**: High-priority single file downloads
- **Optimization**: Maximum concurrency and reduced timeouts
- **Settings**: 50 connections, 10 concurrent downloads, 15s timeout

#### Secure Profile  
- **Use Case**: Security-critical downloads
- **Optimization**: HTTPS-only, certificate validation, private network blocking
- **Settings**: 2 concurrent downloads, 5 retries, 60s timeout

#### Bulk Profile
- **Use Case**: Large batch operations and bulk downloads
- **Optimization**: High concurrency, reduced logging, larger timeouts
- **Settings**: 100 connections, 20 concurrent downloads, minimal logging

#### Careful Profile
- **Use Case**: Monitored downloads with detailed reporting
- **Optimization**: Conservative settings, detailed progress, debug logging
- **Settings**: 1 concurrent download, progress reporting, debug logs

## MCP Server Integration

### Setting Up MCP Server

```javascript
// mcp-server.js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const ConfigManager = require('./lib/config/ConfigManager');

const configManager = new ConfigManager();

const server = new Server(
    {
        name: 'n-get-server',
        version: '2.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Tool: Get download configuration
server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    
    switch (name) {
        case 'get_config_summary':
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(configManager.getAIConfigSummary(), null, 2)
                }]
            };
            
        case 'apply_profile':
            await configManager.applyProfile(args.profile);
            return {
                content: [{
                    type: 'text',
                    text: `Applied profile: ${args.profile}`
                }]
            };
            
        case 'optimize_for_task':
            const profile = await configManager.applyOptimalProfile(args.task);
            return {
                content: [{
                    type: 'text',
                    text: `Optimized configuration with profile: ${profile}`
                }]
            };
    }
});

// List available tools
server.setRequestHandler('tools/list', async () => {
    return {
        tools: [
            {
                name: 'get_config_summary',
                description: 'Get current N-Get configuration summary for AI analysis',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'apply_profile',
                description: 'Apply a specific configuration profile',
                inputSchema: {
                    type: 'object',
                    properties: {
                        profile: {
                            type: 'string',
                            enum: ['fast', 'secure', 'bulk', 'careful'],
                            description: 'Configuration profile to apply'
                        }
                    },
                    required: ['profile']
                }
            },
            {
                name: 'optimize_for_task',
                description: 'Automatically optimize configuration for a specific download task',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task: {
                            type: 'object',
                            properties: {
                                fileCount: { type: 'number' },
                                totalSize: { type: 'number' },
                                priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                                securityCritical: { type: 'boolean' }
                            }
                        }
                    },
                    required: ['task']
                }
            }
        ]
    };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(console.error);
```

### Using MCP Server with Claude

```bash
# Start the MCP server
node mcp-server.js

# In Claude Desktop, add to your configuration:
{
  "mcpServers": {
    "n-get": {
      "command": "node",
      "args": ["/path/to/n-get/mcp-server.js"]
    }
  }
}
```

## CrewAI Integration

### N-Get CrewAI Agent

```python
# n_get_agent.py
from crewai import Agent, Task, Crew
from crewai_tools import BaseTool
import subprocess
import json

class NGetTool(BaseTool):
    name: str = "N-Get Download Tool"
    description: str = "Download files using N-Get with AI-optimized configuration"
    
    def _run(self, url: str, task_type: str = "download", **kwargs) -> str:
        # Get optimal configuration
        config_cmd = [
            'node', '-e', f'''
            const ConfigManager = require('./lib/config/ConfigManager');
            const config = new ConfigManager();
            const profile = config.suggestProfileForTask({kwargs});
            console.log(JSON.stringify({{profile, recommendations: config.getRecommendationsForTask("{task_type}")}}));
            '''
        ]
        
        result = subprocess.run(config_cmd, capture_output=True, text=True)
        config_data = json.loads(result.stdout)
        
        # Apply optimal profile and download
        download_cmd = [
            'node', 'bin/n-get.js',
            '--config-ai-enabled=true',
            f'--config-ai-profile={config_data["profile"]}',
            url
        ]
        
        download_result = subprocess.run(download_cmd, capture_output=True, text=True)
        
        return f"Downloaded {url} using {config_data['profile']} profile. Result: {download_result.stdout}"

# Create specialized agents
download_agent = Agent(
    role='Download Specialist',
    goal='Efficiently download files with optimal configuration',
    backstory='Expert in file downloading with adaptive configuration management',
    tools=[NGetTool()],
    verbose=True
)

optimization_agent = Agent(
    role='Performance Optimizer',
    goal='Analyze and optimize download performance',
    backstory='Specialist in network performance and download optimization',
    verbose=True
)

# Create tasks
download_task = Task(
    description='Download the file {url} with optimal settings',
    agent=download_agent,
    expected_output='Confirmation of successful download with performance metrics'
)

optimization_task = Task(
    description='Analyze download performance and suggest improvements',
    agent=optimization_agent,
    expected_output='Performance analysis and optimization recommendations'
)

# Create crew
download_crew = Crew(
    agents=[download_agent, optimization_agent],
    tasks=[download_task, optimization_task],
    verbose=True
)

# Execute
result = download_crew.kickoff({
    'url': 'https://example.com/largefile.zip',
    'task_type': 'bulk'
})
```

## AutoGen Integration

### N-Get AutoGen Function

```python
# n_get_autogen.py
import autogen
import subprocess
import json

def n_get_download(url: str, task_config: dict = None) -> str:
    """
    Download file using N-Get with AI-optimized configuration.
    
    Args:
        url: URL to download
        task_config: Task configuration (fileCount, totalSize, priority, securityCritical)
    
    Returns:
        Download result with performance metrics
    """
    if task_config is None:
        task_config = {}
    
    # Get AI recommendations
    config_script = f"""
    const ConfigManager = require('./lib/config/ConfigManager');
    const config = new ConfigManager();
    const profile = config.suggestProfileForTask({json.dumps(task_config)});
    const summary = config.getAIConfigSummary();
    console.log(JSON.stringify({{profile, summary}}));
    """
    
    result = subprocess.run(['node', '-e', config_script], capture_output=True, text=True)
    ai_config = json.loads(result.stdout)
    
    # Execute download with optimal configuration
    cmd = [
        'node', 'bin/n-get.js',
        '--config-ai-enabled=true',
        f'--config-ai-profile={ai_config["profile"]}',
        url
    ]
    
    download_result = subprocess.run(cmd, capture_output=True, text=True)
    
    return {
        "success": download_result.returncode == 0,
        "output": download_result.stdout,
        "profile_used": ai_config["profile"],
        "ai_summary": ai_config["summary"]
    }

# Register function with AutoGen
config_list = [
    {
        "model": "gpt-4",
        "api_key": "your-api-key"
    }
]

assistant = autogen.AssistantAgent(
    name="download_assistant",
    llm_config={
        "config_list": config_list,
        "functions": [
            {
                "name": "n_get_download",
                "description": "Download files using AI-optimized N-Get configuration",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "URL to download"},
                        "task_config": {
                            "type": "object",
                            "properties": {
                                "fileCount": {"type": "number"},
                                "totalSize": {"type": "number"},
                                "priority": {"type": "string"},
                                "securityCritical": {"type": "boolean"}
                            }
                        }
                    },
                    "required": ["url"]
                }
            }
        ]
    },
    function_map={"n_get_download": n_get_download}
)

user_proxy = autogen.UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    code_execution_config={"use_docker": False}
)

# Example usage
user_proxy.initiate_chat(
    assistant,
    message="Download https://example.com/dataset.zip - it's a 2GB file that needs to be secure"
)
```

## LangChain Integration

### N-Get LangChain Tool

```python
# n_get_langchain.py
from langchain.tools import BaseTool
from langchain.agents import initialize_agent, Tool
from langchain.llms import OpenAI
import subprocess
import json

class NGetDownloadTool(BaseTool):
    name = "n_get_download"
    description = "Download files using N-Get with AI-optimized configuration. Input should be a URL and optional task parameters."
    
    def _run(self, query: str) -> str:
        try:
            # Parse input (could be enhanced with better parsing)
            parts = query.split(' ')
            url = parts[0]
            
            # Extract task parameters if provided
            task_config = {}
            for part in parts[1:]:
                if '=' in part:
                    key, value = part.split('=', 1)
                    if key in ['fileCount', 'totalSize']:
                        task_config[key] = int(value)
                    elif key == 'securityCritical':
                        task_config[key] = value.lower() == 'true'
                    else:
                        task_config[key] = value
            
            # Get AI optimization
            config_script = f"""
            const ConfigManager = require('./lib/config/ConfigManager');
            const config = new ConfigManager();
            const profile = config.suggestProfileForTask({json.dumps(task_config)});
            console.log(profile);
            """
            
            result = subprocess.run(['node', '-e', config_script], capture_output=True, text=True)
            optimal_profile = result.stdout.strip()
            
            # Execute download
            cmd = [
                'node', 'bin/n-get.js',
                '--config-ai-enabled=true',
                f'--config-ai-profile={optimal_profile}',
                url
            ]
            
            download_result = subprocess.run(cmd, capture_output=True, text=True)
            
            return f"Downloaded {url} using {optimal_profile} profile. Status: {'Success' if download_result.returncode == 0 else 'Failed'}"
            
        except Exception as e:
            return f"Error downloading {query}: {str(e)}"
    
    def _arun(self, query: str) -> str:
        raise NotImplementedError("This tool does not support async")

# Create LangChain agent
tools = [
    NGetDownloadTool(),
    Tool(
        name="n_get_config",
        description="Get N-Get configuration summary and available profiles",
        func=lambda x: subprocess.run(['node', '-e', '''
            const ConfigManager = require('./lib/config/ConfigManager');
            const config = new ConfigManager();
            console.log(JSON.stringify(config.getAIConfigSummary(), null, 2));
        '''], capture_output=True, text=True).stdout
    )
]

llm = OpenAI(temperature=0)
agent = initialize_agent(tools, llm, agent="zero-shot-react-description", verbose=True)

# Example usage
response = agent.run("Download https://example.com/secure-file.pdf with securityCritical=true")
print(response)
```

## API Reference

### ConfigManager AI Methods

#### `getAIConfigSummary()`
Returns AI-optimized configuration overview including current settings, capabilities, and performance metrics.

#### `getAvailableProfiles()`
Lists all available configuration profiles with descriptions and current status.

#### `suggestProfileForTask(task)`
Recommends optimal profile based on task characteristics:
- `task.fileCount` - Number of files to download
- `task.totalSize` - Total size in bytes  
- `task.priority` - Task priority (low, medium, high)
- `task.securityCritical` - Whether security is critical

#### `applyOptimalProfile(task)`
Automatically applies the best profile for the given task.

#### `adaptiveOptimization(metrics)`
Dynamically adjusts configuration based on performance metrics:
- `metrics.avgDownloadSpeed` - Average download speed in bytes/sec
- `metrics.errorRate` - Error rate (0-1)
- `metrics.connectionFailures` - Number of connection failures

#### `learnFromOutcome(outcome)`
Records learning data from download outcomes for future optimization.

#### `getRecommendationsForTask(taskType)`
Returns configuration recommendations for specific task types: 'download', 'bulk', 'secure', 'fast'.

## Examples

### Basic AI Integration

```javascript
const ConfigManager = require('./lib/config/ConfigManager');
const config = new ConfigManager();

// Enable AI features
await config.set('ai.enabled', true);
await config.set('ai.profiles.enabled', true);

// Get optimal configuration for bulk download
const profile = await config.applyOptimalProfile({
    fileCount: 100,
    totalSize: 10737418240, // 10GB
    priority: 'medium'
});

console.log(`Applied profile: ${profile}`);
```

### Performance Monitoring and Adaptation

```javascript
// Monitor download performance
const performanceTracker = {
    downloadSpeed: 0,
    errorCount: 0,
    totalRequests: 0
};

// After downloads, apply adaptive optimization
const optimizations = config.adaptiveOptimization({
    avgDownloadSpeed: performanceTracker.downloadSpeed,
    errorRate: performanceTracker.errorCount / performanceTracker.totalRequests,
    connectionFailures: performanceTracker.errorCount
});

console.log('Applied optimizations:', optimizations);
```

### Learning from Outcomes

```javascript
// Record successful download for learning
config.learnFromOutcome({
    success: true,
    duration: 30000, // 30 seconds
    throughput: 5242880, // 5MB/s
    errors: {}
});
```

## Best Practices

### 1. Environment-Specific Configuration
- Use `development` environment for AI experimentation
- Use `production` environment with conservative AI settings
- Enable learning only in development/staging environments

### 2. Security Considerations
- Always validate AI-generated configurations
- Use `secure` profile for sensitive downloads
- Enable audit logging in enterprise environments

### 3. Performance Optimization
- Monitor download metrics for adaptive optimization
- Use bulk profiles for large batch operations
- Implement circuit breakers for high error rates

### 4. Error Handling
- Implement fallback configurations for AI failures
- Log all AI decisions for debugging
- Validate configuration changes before applying

### 5. Testing
- Test AI configurations in isolated environments
- Use mock data for AI training
- Validate profile recommendations with real workloads

## Configuration Examples

### Enable AI in Development
```yaml
# config/development.yaml
ai:
  enabled: true
  profiles:
    enabled: true
    learningEnabled: true
    adaptiveOptimization: true
```

### Production AI Settings
```yaml
# config/production.yaml
ai:
  enabled: true
  profiles:
    enabled: true
    learningEnabled: false
    adaptiveOptimization: false
enterprise:
  auditLogging: true
```

## Troubleshooting

### Common Issues

1. **AI Features Not Working**
   - Ensure `ai.enabled: true` in configuration
   - Check profile availability with `getAvailableProfiles()`
   - Verify environment supports AI features

2. **Profile Application Failures**
   - Validate profile configuration syntax
   - Check Joi validation errors in logs
   - Ensure profile exists in configuration

3. **Performance Issues**
   - Monitor adaptive optimization logs
   - Check if learning data is being recorded
   - Verify metric collection is working

### Debug Commands

```bash
# Check AI configuration status
node -e "const c = require('./lib/config/ConfigManager'); console.log(new c().getAIConfigSummary())"

# List available profiles
node -e "const c = require('./lib/config/ConfigManager'); console.log(new c().getAvailableProfiles())"

# Test profile suggestion
node -e "const c = require('./lib/config/ConfigManager'); console.log(c.suggestProfileForTask({fileCount: 10}))"
```

## Contributing

To contribute to N-Get's AI integration:

1. Fork the repository
2. Create AI integration examples
3. Submit pull requests with documentation
4. Report issues with AI agent integration

For more information, see the main [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md) files.