/**
 * @fileoverview n-get MCP server
 *
 * Exposes n-get as an MCP tool so any MCP-compatible agent
 * (Claude Desktop, Cursor, etc.) can download files and monitor
 * sessions without spawning a subprocess.
 *
 * Start via:  node lib/mcp/server.js
 * Or add to claude_desktop_config.json / mcp settings.
 *
 * Tools:
 *   download_file     — download a single URL
 *   batch_download    — download multiple URLs concurrently
 *   get_jobs          — list all active n-get sessions on this machine
 *   get_capabilities  — return n-get's capabilities document
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { z }                    = require('zod');

import { DownloadSession, readActiveSessions, pruneDeadSessions } from '../core/DownloadSession.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CapabilitiesService = require('../services/CapabilitiesService');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const downloadPipeline    = require('../downloadPipeline');

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
    name:    'n-get',
    version: pkg.version,
});

// ─── Tool: download_file ──────────────────────────────────────────────────────

server.tool(
    'download_file',
    'Download a single file from a URL. Returns the local path, file size, and checksum on success.',
    {
        url:         z.string().url().describe('URL to download'),
        destination: z.string().optional().describe('Destination directory (default: current working directory)'),
        agent_id:    z.string().optional().describe('Agent identifier — appears in all session events and get_jobs output'),
        session_id:  z.string().optional().describe('Override the auto-generated session ID'),
        no_resume:   z.boolean().optional().describe('Disable HTTP range resume (default: false)'),
    },
    async ({ url, destination, agent_id, session_id, no_resume }) => {
        const dest = destination ?? process.cwd();
        const session = new DownloadSession({
            sessionId: session_id,
            agentId:   agent_id ?? null,
            quietMode: true,
        });

        session.start();

        try {
            const results = await downloadPipeline([url], dest, {
                session,
                enableResume: !no_resume,
            });

            const r = results[0];
            if (!r || !r.success) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: r?.error ?? 'Download failed' }],
                };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success:  true,
                        url,
                        path:     r.path,
                        size:     r.size,
                        checksum: r.checksum ?? null,
                        duration: r.duration ?? null,
                    }),
                }],
            };
        } finally {
            await session.end();
        }
    }
);

// ─── Tool: batch_download ─────────────────────────────────────────────────────

server.tool(
    'batch_download',
    'Download multiple files concurrently. Returns an array of results — one per URL.',
    {
        urls:          z.array(z.string().url()).min(1).describe('URLs to download'),
        destination:   z.string().optional().describe('Destination directory (default: current working directory)'),
        max_concurrent: z.number().int().min(1).max(20).optional().describe('Max concurrent downloads (default: 3)'),
        agent_id:      z.string().optional().describe('Agent identifier — appears in all session events and get_jobs output'),
        session_id:    z.string().optional().describe('Override the auto-generated session ID'),
        no_resume:     z.boolean().optional().describe('Disable HTTP range resume (default: false)'),
    },
    async ({ urls, destination, max_concurrent, agent_id, session_id, no_resume }) => {
        const dest = destination ?? process.cwd();
        const session = new DownloadSession({
            sessionId: session_id,
            agentId:   agent_id ?? null,
            quietMode: true,
        });

        session.start();

        try {
            const results = await downloadPipeline(urls, dest, {
                session,
                maxConcurrent: max_concurrent ?? 3,
                enableResume:  !no_resume,
            });

            const summary = {
                total:    results.length,
                success:  results.filter((r: { success: boolean }) => r.success).length,
                errors:   results.filter((r: { success: boolean }) => !r.success).length,
                files:    results.map((r: { success: boolean; url: string; path?: string; size?: number; checksum?: string; error?: string }) => ({
                    url:      r.url,
                    success:  r.success,
                    path:     r.path     ?? null,
                    size:     r.size     ?? null,
                    checksum: r.checksum ?? null,
                    error:    r.error    ?? null,
                })),
            };

            return {
                isError: summary.errors === summary.total,
                content: [{ type: 'text', text: JSON.stringify(summary) }],
            };
        } finally {
            await session.end();
        }
    }
);

// ─── Tool: get_jobs ───────────────────────────────────────────────────────────

server.tool(
    'get_jobs',
    'List all active n-get download sessions on this machine. Any agent can call this to observe downloads started by other agents.',
    {},
    () => {
        pruneDeadSessions();
        const sessions = readActiveSessions();

        const summary = sessions.map(s => {
            const downloads = Object.values(s.downloads ?? {}) as Array<{ status: string }>;
            return {
                sessionId: s.sessionId,
                agent:     s.agent,
                pid:       s.pid,
                startTime: s.startTime,
                total:     downloads.length,
                active:    downloads.filter(d => d.status === 'active').length,
                complete:  downloads.filter(d => d.status === 'complete').length,
                errors:    downloads.filter(d => d.status === 'error').length,
            };
        });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ count: sessions.length, sessions: summary }),
            }],
        };
    }
);

// ─── Tool: get_capabilities ───────────────────────────────────────────────────

server.tool(
    'get_capabilities',
    'Return the full n-get capabilities document. Agents can call this to discover supported protocols, flags, output formats, and configuration options.',
    {},
    () => {
        const caps = new CapabilitiesService({});
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(caps.getCapabilities()),
            }],
        };
    }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // MCP servers communicate over stdio — no console.log here
}

main().catch(err => {
    process.stderr.write(`n-get MCP server error: ${err.message}\n`);
    process.exit(1);
});
