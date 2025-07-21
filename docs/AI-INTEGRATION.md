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

N-Get's AI integration provides AI agents with complete control over download configuration through modern AI standards and protocols:

- **Agent-Controlled Configuration**: AI agents have full control over all download settings and behavior
- **Profile Management**: Pre-configured profiles that agents can select and apply (fast, secure, bulk, careful)
- **Real-time Monitoring**: Performance and status reporting for agents to make informed decisions
- **Learning Data**: Optional collection of outcome data for agent training and improvement
- **Standards Compliance**: Full support for MCP, OpenAI APIs, and other AI frameworks

### Latest AI Standards Support (2024-2025)

N-Get integrates with the newest AI capabilities:

- **OpenAI Structured Outputs**: 100% reliable JSON schema adherence with `strict: true`
- **Responses API**: Advanced tool calling with web search, file search, and computer use
- **Model Context Protocol (MCP)**: Full MCP server implementation for universal AI integration
- **GPT-4o Models**: Support for latest reasoning models including o1, o3, o3-mini, and o4-mini
- **Built-in Web Search**: Real-time information retrieval powered by ChatGPT search
- **Computer Use Integration**: Direct system interaction for autonomous download management

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

### Setting Up MCP Server (2025 Standards)

The Model Context Protocol (MCP) is now the universal standard for AI integration, with OpenAI joining the MCP steering committee in 2025.

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
        # Agent gets available profiles and decides
        config_cmd = [
            'node', '-e', f'''
            const ConfigManager = require('./lib/config/ConfigManager');
            const config = new ConfigManager();
            const profiles = config.getAvailableProfiles();
            const summary = config.getAIConfigSummary();
            console.log(JSON.stringify({{profiles, summary}}));
            '''
        ]
        
        result = subprocess.run(config_cmd, capture_output=True, text=True)
        config_data = json.loads(result.stdout)
        
        # Agent logic to select profile based on task_type
        profile_map = {
            "bulk": "bulk",
            "secure": "secure", 
            "fast": "fast",
            "download": "careful"
        }
        selected_profile = profile_map.get(task_type, "careful")
        
        # Apply agent-selected profile and download
        download_cmd = [
            'node', 'bin/n-get.js',
            '--config-ai-enabled=true',
            f'--config-ai-profile={selected_profile}',
            url
        ]
        
        download_result = subprocess.run(download_cmd, capture_output=True, text=True)
        
        return f"Downloaded {url} using {selected_profile} profile (agent decision). Result: {download_result.stdout}"

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
    
    # Get available profiles for agent decision
    config_script = f"""
    const ConfigManager = require('./lib/config/ConfigManager');
    const config = new ConfigManager();
    const profiles = config.getAvailableProfiles();
    const summary = config.getAIConfigSummary();
    console.log(JSON.stringify({{profiles, summary}}));
    """
    
    result = subprocess.run(['node', '-e', config_script], capture_output=True, text=True)
    config_data = json.loads(result.stdout)
    
    # Agent logic to select profile
    if task_config.get('securityCritical'):
        selected_profile = 'secure'
    elif task_config.get('fileCount', 1) > 10:
        selected_profile = 'bulk'
    elif task_config.get('priority') == 'high':
        selected_profile = 'fast'
    else:
        selected_profile = 'careful'
    
    # Execute download with agent-selected configuration
    cmd = [
        'node', 'bin/n-get.js',
        '--config-ai-enabled=true',
        f'--config-ai-profile={selected_profile}',
        url
    ]
    
    download_result = subprocess.run(cmd, capture_output=True, text=True)
    
    return {
        "success": download_result.returncode == 0,
        "output": download_result.stdout,
        "profile_used": selected_profile,
        "agent_decision": f"Selected {selected_profile} based on task analysis",
        "available_profiles": list(config_data["profiles"].keys())
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

## OpenAI Responses API Integration (2025)

### N-Get with Responses API and Structured Outputs

```javascript
// openai-responses-integration.js
const OpenAI = require('openai');
const ConfigManager = require('./lib/config/ConfigManager');

const openai = new OpenAI();
const configManager = new ConfigManager();

// OpenAI Structured Outputs schema for n-get configuration
const ngetConfigSchema = {
    type: "object",
    properties: {
        action: {
            type: "string",
            enum: ["download", "configure", "optimize", "analyze"]
        },
        urls: {
            type: "array",
            items: { type: "string" }
        },
        profile: {
            type: "string",
            enum: ["fast", "secure", "bulk", "careful", "auto"]
        },
        taskConfig: {
            type: "object",
            properties: {
                fileCount: { type: "number" },
                totalSize: { type: "number" },
                priority: { type: "string", enum: ["low", "medium", "high"] },
                securityCritical: { type: "boolean" }
            }
        },
        destination: { type: "string" }
    },
    required: ["action"]
};

async function ngetWithResponsesAPI(userQuery) {
    const response = await openai.responses.create({
        model: "gpt-4o-2024-08-06",
        messages: [
            {
                role: "system",
                content: `You are an AI assistant that helps users download files using n-get. 
                Analyze user requests and provide structured responses for optimal download configuration.
                Use web search when you need current information about files or URLs.`
            },
            {
                role: "user", 
                content: userQuery
            }
        ],
        tools: [
            {
                type: "web_search"
            },
            {
                type: "function",
                function: {
                    name: "configure_nget_download",
                    description: "Configure and execute n-get download with optimal settings",
                    strict: true,  // Enable structured outputs
                    parameters: ngetConfigSchema
                }
            }
        ],
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "NGetResponse",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        reasoning: { type: "string" },
                        configuration: ngetConfigSchema,
                        webSearchUsed: { type: "boolean" },
                        recommendations: {
                            type: "array",
                            items: { type: "string" }
                        }
                    },
                    required: ["reasoning", "configuration"]
                }
            }
        }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Apply AI-selected profile to n-get
    if (result.configuration.profile && result.configuration.profile !== "auto") {
        await configManager.applyProfile(result.configuration.profile);
    }

    return result;
}

// Example usage with web search integration
async function smartDownload(userRequest) {
    try {
        const aiResponse = await ngetWithResponsesAPI(userRequest);
        
        console.log("AI Analysis:", aiResponse.reasoning);
        console.log("Recommended Profile:", aiResponse.configuration.profile);
        
        if (aiResponse.webSearchUsed) {
            console.log("Used web search for current information");
        }

        // Execute download with AI-optimized configuration
        if (aiResponse.configuration.action === "download") {
            const subprocess = require('child_process');
            const cmd = [
                'node', 'bin/n-get.js',
                `--config-ai-profile=${aiResponse.configuration.profile}`,
                ...aiResponse.configuration.urls
            ];
            
            if (aiResponse.configuration.destination) {
                cmd.push('-d', aiResponse.configuration.destination);
            }

            const result = subprocess.spawn('node', cmd.slice(1));
            return { success: true, aiResponse, process: result };
        }

        return { success: true, aiResponse };
        
    } catch (error) {
        console.error("AI-powered download failed:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { ngetWithResponsesAPI, smartDownload };
```

### Using with Computer Use Tool

```javascript
// computer-use-integration.js
async function ngetWithComputerUse(task) {
    const response = await openai.responses.create({
        model: "gpt-4o-2024-08-06",
        messages: [
            {
                role: "user",
                content: `Download files using n-get and verify the downloads completed successfully: ${task}`
            }
        ],
        tools: [
            {
                type: "computer_use",
                computer_use: {
                    display_width_px: 1920,
                    display_height_px: 1080
                }
            }
        ]
    });

    // OpenAI will use computer use to:
    // 1. Execute n-get commands
    // 2. Verify file downloads
    // 3. Check file integrity
    // 4. Report results back
    
    return response;
}
```

## LangChain Integration

### N-Get LangChain Tool with Structured Outputs

```python
# n_get_langchain.py
from langchain.tools import BaseTool
from langchain.agents import initialize_agent, Tool
from langchain_openai import ChatOpenAI
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
            
            # Agent gets available profiles and decides
            config_script = f"""
            const ConfigManager = require('./lib/config/ConfigManager');
            const config = new ConfigManager();
            const profiles = config.getAvailableProfiles();
            console.log(JSON.stringify(Object.keys(profiles)));
            """
            
            result = subprocess.run(['node', '-e', config_script], capture_output=True, text=True)
            available_profiles = json.loads(result.stdout)
            
            # Agent decision logic
            if 'securityCritical=true' in query:
                optimal_profile = 'secure'
            elif 'fileCount' in query and int(query.split('fileCount=')[1].split()[0]) > 10:
                optimal_profile = 'bulk'
            elif 'priority=high' in query:
                optimal_profile = 'fast'
            else:
                optimal_profile = 'careful'
            
            # Execute download
            cmd = [
                'node', 'bin/n-get.js',
                '--config-ai-enabled=true',
                f'--config-ai-profile={optimal_profile}',
                url
            ]
            
            download_result = subprocess.run(cmd, capture_output=True, text=True)
            
            return f"Downloaded {url} using {optimal_profile} profile (agent decision). Status: {'Success' if download_result.returncode == 0 else 'Failed'}"
            
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

#### `applyProfile(profileName)`
Applies a specific configuration profile. Agents can choose from: 'fast', 'secure', 'bulk', 'careful'.

#### `get(path, defaultValue)`
Gets configuration value by path (e.g., 'http.timeout', 'downloads.maxConcurrent').

#### `set(path, value)`
Sets configuration value by path. Allows agents to make granular configuration changes.

#### `learnFromOutcome(outcome)`
Records learning data from download outcomes for agent training and improvement.

#### `getMetrics()`
Returns configuration metrics, performance data, and usage statistics for agent analysis.

## Examples

### Basic AI Agent Integration

```javascript
const ConfigManager = require('./lib/config/ConfigManager');
const config = new ConfigManager();

// Enable AI features
await config.set('ai.enabled', true);
await config.set('ai.profiles.enabled', true);

// Agent examines available profiles
const profiles = config.getAvailableProfiles();
console.log('Available profiles:', Object.keys(profiles));

// Agent decides to use bulk profile for large download
await config.applyProfile('bulk');

// Agent can also make granular adjustments
await config.set('downloads.maxConcurrent', 15);
await config.set('http.maxConnections', 80);

console.log('Configuration applied by agent');
```

### Agent Performance Monitoring

```javascript
// Agent monitors current configuration
const summary = config.getAIConfigSummary();
console.log('Current settings:', summary.keySettings);
console.log('Current capabilities:', summary.capabilities);

// Agent checks metrics after download
const metrics = config.getMetrics();
console.log('Performance metrics:', {
    profileSwitches: metrics.profileSwitches,
    configurationChanges: metrics.configurationChanges,
    environment: metrics.environment
});
```

### Agent Learning from Outcomes

```javascript
// Agent records download outcome for learning
config.learnFromOutcome({
    success: true,
    duration: 30000, // 30 seconds
    throughput: 5242880, // 5MB/s
    errors: {}
});

// Agent can export learning data for training
const trainingData = config.exportForAITraining();
console.log('Learning data collected:', trainingData.history.length, 'entries');
```

## Best Practices

### 1. Agent-Controlled Configuration
- Agents should examine available profiles before making decisions
- Use `getAIConfigSummary()` to understand current state before changes
- Make incremental configuration adjustments rather than wholesale changes
- Validate configuration changes using agent logic before applying

### 2. Environment-Specific Behavior
- Use `development` environment for agent experimentation and learning
- Use `production` environment with conservative agent behavior
- Enable learning data collection only in development/staging environments

### 3. Security Considerations
- Agents should use `secure` profile for sensitive downloads
- Validate all agent-requested configuration changes
- Enable audit logging in enterprise environments
- Implement agent authorization for configuration changes

### 4. Performance Monitoring
- Agents should monitor metrics using `getMetrics()` after downloads
- Use performance data to inform future agent decisions
- Implement agent circuit breakers for high error rates
- Allow agents to switch profiles based on performance feedback

### 5. Error Handling and Fallbacks
- Implement fallback profiles when agent decisions fail
- Log all agent configuration decisions for debugging
- Provide default configurations when agent communication fails
- Validate agent-requested settings against schema

### 6. Testing Agent Integration
- Test agent configurations in isolated environments
- Use mock download scenarios for agent training
- Validate agent decision-making with real workloads
- Implement agent behavior regression testing

## Configuration Examples

### Enable AI in Development
```yaml
# config/development.yaml
ai:
  enabled: true
  profiles:
    enabled: true
    learningEnabled: true
```

### Production AI Settings
```yaml
# config/production.yaml
ai:
  enabled: true
  profiles:
    enabled: true
    learningEnabled: false
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
   - Monitor agent configuration decisions in logs
   - Check if learning data is being recorded
   - Verify metric collection is working

### Debug Commands

```bash
# Check AI configuration status
node -e "const c = require('./lib/config/ConfigManager'); console.log(new c().getAIConfigSummary())"

# List available profiles
node -e "const c = require('./lib/config/ConfigManager'); console.log(new c().getAvailableProfiles())"

# Test agent profile selection
node -e "const c = require('./lib/config/ConfigManager'); const cm = new c(); console.log(cm.getAvailableProfiles())"
```

## Contributing

To contribute to N-Get's AI integration:

1. Fork the repository
2. Create AI integration examples
3. Submit pull requests with documentation
4. Report issues with AI agent integration

## OpenAI 2025 Standards Compliance

### Supported Models and Pricing

**Latest Models (2025):**
- `gpt-4o-2024-08-06` - Structured outputs with 100% reliability
- `gpt-4o-mini-2024-07-18` - Cost-effective structured outputs
- `o1`, `o3`, `o3-mini`, `o4-mini` - Advanced reasoning models

**Tool Pricing (2025):**
- Web Search: $30/1K queries (GPT-4o), $25/1K queries (GPT-4o-mini)
- File Search: $0.10/GB vector storage/day + $2.50/1K tool calls
- Computer Use: Standard token pricing
- MCP Integration: No additional cost (token-based billing only)

### Migration from Legacy APIs

**From JSON Mode to Structured Outputs:**
```javascript
// Legacy JSON Mode (deprecated)
{
    response_format: { type: "json_object" }
}

// New Structured Outputs (recommended)
{
    response_format: {
        type: "json_schema",
        json_schema: {
            name: "NGetConfig",
            strict: true,  // Guarantees 100% schema adherence
            schema: ngetConfigSchema
        }
    }
}
```

**From Chat Completions to Responses API:**
```javascript
// Legacy approach
const chatResponse = await openai.chat.completions.create({...});

// New Responses API (recommended for tools)
const response = await openai.responses.create({
    tools: [
        { type: "web_search" },
        { type: "function", function: {...} }
    ]
});
```

### Safety and Compliance Features

- **Refusal Handling**: Programmatic detection of safety-based refusals
- **Schema Validation**: Guaranteed JSON schema compliance with `strict: true`
- **Source Attribution**: Automatic citation links for web search results
- **Audit Logging**: Enterprise-grade logging for all AI interactions

For more information, see the main [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md) files.