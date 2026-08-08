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

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z }                    = require('zod');
const pkg                      = require('../../package.json');
const CapabilitiesService      = require('../services/CapabilitiesService');
const downloadPipeline         = require('../downloader');
const ConfigManager            = require('../config/ConfigManager');
const HistoryManager           = require('../services/HistoryManager');
const fs                       = require('node:fs');
const path                     = require('node:path');

import { DownloadSession, readActiveSessions, pruneDeadSessions } from '../core/DownloadSession.js';

// ─── Factory — exported for testing ──────────────────────────────────────────

export function createServer() {
    const server = new McpServer({
        name:    'n-get',
        version: pkg.version,
    });

    // Track in-process active sessions for cancel_session / get_session support
    const sessions: Map<string, DownloadSession> = new Map();

    // ConfigManager instance shared across set_profile calls
    const configManager = new ConfigManager({
        environment: 'development',
        enableHotReload: false,
        logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    });

    // HistoryManager instance
    const historyManager = new HistoryManager();

    // ── download_file ─────────────────────────────────────────────────────────

    server.tool(
        'download_file',
        'Download a single file from a URL. Returns the local path, file size, and checksum on success.',
        {
            url:         z.string().url().describe('URL to download'),
            destination: z.string().optional().describe('Destination directory (default: cwd)'),
            agent_id:    z.string().optional().describe('Agent identifier — appears in all session events and get_jobs output'),
            session_id:  z.string().optional().describe('Override the auto-generated session ID'),
            no_resume:   z.boolean().optional().describe('Disable HTTP range resume (default: false)'),
        },
        async ({ url, destination, agent_id, session_id, no_resume }: {
            url: string;
            destination?: string;
            agent_id?: string;
            session_id?: string;
            no_resume?: boolean;
        }) => {
            const dest = destination ?? process.cwd();
            const session = new DownloadSession({
                sessionId: session_id,
                agentId:   agent_id ?? null,
                quietMode: true,
            });

            session.start();
            sessions.set(session.id, session);

            try {
                const results = await downloadPipeline([url], dest, {
                    session,
                    enableResume: !no_resume,
                });

                const r = results[0];
                if (!r || !r.success) {
                    return {
                        isError: true,
                        content: [{ type: 'text' as const, text: r?.error ?? 'Download failed' }],
                    };
                }

                return {
                    content: [{
                        type: 'text' as const,
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
                sessions.delete(session.id);
                await session.end();
            }
        }
    );

    // ── batch_download ────────────────────────────────────────────────────────

    server.tool(
        'batch_download',
        'Download multiple files concurrently. Returns an array of results — one per URL.',
        {
            urls:           z.array(z.string().url()).min(1).describe('URLs to download'),
            destination:    z.string().optional().describe('Destination directory (default: cwd)'),
            max_concurrent: z.number().int().min(1).max(20).optional().describe('Max concurrent downloads (default: 3)'),
            agent_id:       z.string().optional().describe('Agent identifier'),
            session_id:     z.string().optional().describe('Override the auto-generated session ID'),
            no_resume:      z.boolean().optional().describe('Disable HTTP range resume (default: false)'),
        },
        async ({ urls, destination, max_concurrent, agent_id, session_id, no_resume }: {
            urls: string[];
            destination?: string;
            max_concurrent?: number;
            agent_id?: string;
            session_id?: string;
            no_resume?: boolean;
        }) => {
            const dest = destination ?? process.cwd();
            const session = new DownloadSession({
                sessionId: session_id,
                agentId:   agent_id ?? null,
                quietMode: true,
            });

            session.start();
            sessions.set(session.id, session);

            try {
                const results = await downloadPipeline(urls, dest, {
                    session,
                    maxConcurrent: max_concurrent ?? 3,
                    enableResume:  !no_resume,
                });

                const summary = {
                    total:   results.length,
                    success: results.filter((r: { success: boolean }) => r.success).length,
                    errors:  results.filter((r: { success: boolean }) => !r.success).length,
                    files:   results.map((r: { success: boolean; url: string; path?: string; size?: number; checksum?: string; error?: string }) => ({
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
                    content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
                };
            } finally {
                sessions.delete(session.id);
                await session.end();
            }
        }
    );

    // ── get_jobs ──────────────────────────────────────────────────────────────

    server.tool(
        'get_jobs',
        'List all active n-get download sessions on this machine. Any agent can call this to observe downloads started by other agents.',
        {},
        () => {
            pruneDeadSessions();
            const sessions = readActiveSessions();

            const summary = sessions.map(s => {
                const downloads = Object.values(s.downloads ?? {});
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
                    type: 'text' as const,
                    text: JSON.stringify({ count: sessions.length, sessions: summary }),
                }],
            };
        }
    );

    // ── get_capabilities ──────────────────────────────────────────────────────

    server.tool(
        'get_capabilities',
        'Return the full n-get capabilities document. Agents can call this to discover supported protocols, flags, output formats, and configuration options.',
        {},
        () => {
            const caps = new CapabilitiesService({});
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(caps.getCapabilities()),
                }],
            };
        }
    );

    // ── cancel_session ────────────────────────────────────────────────────────

    server.tool(
        'cancel_session',
        'Cancel an active download session by session ID. Other sessions continue unaffected.',
        {
            sessionId: (z as any).string().describe('Session ID to cancel'),
        },
        async ({ sessionId }: { sessionId: string }) => {
            const session = sessions.get(sessionId);
            if (session) {
                session.cancel();
                await session.flushStatus();
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ sessionId, cancelled: true, message: 'Session cancelled' }),
                    }],
                };
            }
            // Check if it's a session from another process
            const activeSessions = readActiveSessions();
            const external = activeSessions.find((s: any) => s.sessionId === sessionId);
            if (external) {
                return {
                    isError: true,
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ code: 'EXTERNAL_SESSION', message: 'Session belongs to another process and cannot be cancelled via MCP' }),
                    }],
                };
            }
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ code: 'SESSION_NOT_FOUND', message: 'Session not found or already complete' }),
                }],
            };
        }
    );

    // ── get_session ───────────────────────────────────────────────────────────

    server.tool(
        'get_session',
        'Query the current state of a specific download session by session ID.',
        {
            sessionId: (z as any).string().describe('Session ID to query'),
        },
        ({ sessionId }: { sessionId: string }) => {
            const session = sessions.get(sessionId);
            if (session) {
                const s = (session as any)._status;
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            sessionId: s.sessionId,
                            agentId:   s.agent,
                            pid:       s.pid,
                            startTime: s.startTime,
                            active:    true,
                            downloads: s.downloads,
                        }),
                    }],
                };
            }
            const activeSessions = readActiveSessions();
            const external = activeSessions.find((s: any) => s.sessionId === sessionId);
            if (external) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            sessionId: external.sessionId,
                            agentId:   external.agent,
                            pid:       external.pid,
                            startTime: external.startTime,
                            active:    true,
                            downloads: external.downloads,
                        }),
                    }],
                };
            }
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ code: 'SESSION_NOT_FOUND', message: 'Session not found or already complete' }),
                }],
            };
        }
    );

    // ── set_profile ───────────────────────────────────────────────────────────

    server.tool(
        'set_profile',
        'Apply a named configuration profile process-wide. Valid profiles: fast, secure, bulk, careful.',
        {
            profileName: (z as any).enum(['fast', 'secure', 'bulk', 'careful']).describe('Config profile name'),
        },
        async ({ profileName }: { profileName: string }) => {
            try {
                await configManager.applyProfile(profileName);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ profile: profileName, applied: true }),
                    }],
                };
            } catch (err: any) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ profile: profileName, applied: false, message: err.message || 'Profile system not available' }),
                    }],
                };
            }
        }
    );

    // ── get_history ───────────────────────────────────────────────────────────

    server.tool(
        'get_history',
        'Return recent download history as a flat list. Optionally filter by destination, limit, status, or date.',
        {
            destination: (z as any).string().optional().describe('Directory to read history from (default: cwd)'),
            limit:       (z as any).number().int().min(1).max(500).optional().describe('Max entries to return (default: all)'),
            status:      (z as any).string().optional().describe('Filter by status: complete, error, etc.'),
            since:       (z as any).string().optional().describe('ISO 8601 date — return entries after this time'),
        },
        async ({ destination, limit, status, since }: { destination?: string; limit?: number; status?: string; since?: string }) => {
            try {
                const dest = destination ?? process.cwd();
                const opts: any = {};
                if (limit)  opts.limit  = limit;
                if (status) opts.status = status;
                if (since)  opts.since  = new Date(since);
                const raw = await historyManager.getHistory(dest, opts);
                const entries = raw.map((e: any) => ({
                    timestamp:     e.timestamp,
                    url:           e.url,
                    filename:      e.filePath ? path.basename(e.filePath) : null,
                    status:        e.status,
                    bytes:         e.size     ?? null,
                    duration:      e.duration ?? null,
                    error:         e.error    ?? null,
                    correlationId: e.correlationId ?? null,
                }));
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ entries, total: entries.length, limit: limit ?? null }),
                    }],
                };
            } catch (err: any) {
                return {
                    isError: true,
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ code: 'HISTORY_ERROR', message: err.message }),
                    }],
                };
            }
        }
    );

    // ── get_instructions ─────────────────────────────────────────────────────

    server.tool(
        'get_instructions',
        'Return the contents of AGENTS.md — the agent-facing usage guide for n-get.',
        {},
        () => {
            try {
                const agentsMd = fs.readFileSync(path.join(__dirname, '../../AGENTS.md'), 'utf8');
                return {
                    content: [{ type: 'text' as const, text: agentsMd }],
                };
            } catch {
                return {
                    isError: true,
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ code: 'NOT_FOUND', message: 'AGENTS.md not found' }),
                    }],
                };
            }
        }
    );

    // ── get_agent_card ────────────────────────────────────────────────────────

    // ── fetch_http ────────────────────────────────────────────────────────────

    server.tool(
        'fetch_http',
        'Make an HTTP API call (GET/POST/PUT/DELETE/PATCH) and return the response as JSON. Use this to call external APIs without leaving the MCP loop.',
        {
            url:     (z as any).string().describe('The URL to fetch'),
            method:  (z as any).enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('HTTP method'),
            body:    (z as any).string().optional().describe('Request body (JSON string for POST/PUT/PATCH)'),
            headers: (z as any).record((z as any).string()).optional().describe('Additional request headers'),
            timeout: (z as any).number().optional().describe('Request timeout in milliseconds (default: 30000)'),
        },
        async ({ url, method = 'GET', body, headers, timeout }: {
            url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number;
        }) => {
            const ngetFetch = require('../fetch');
            try {
                let parsedBody: unknown = body;
                if (body) {
                    try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
                }
                const result = await ngetFetch(url, { method, headers, body: parsedBody, timeout });
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({
                        status:      result.status,
                        statusText:  result.statusText,
                        latencyMs:   result.latencyMs,
                        headers:     result.headers,
                        data:        result.data,
                    }) }],
                };
            } catch (err: unknown) {
                const e = err as Error & { status?: number };
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: JSON.stringify({
                        error:   e.message,
                        status:  e.status,
                    }) }],
                };
            }
        }
    );

    // ── get_agent_card ────────────────────────────────────────────────────────

    server.tool(
        'get_agent_card',
        'Return the A2A 1.0 agent card for n-get. Describes agent skills, transport, and protocol version for A2A-compatible orchestrators.',
        {
            endpoint_url: (z as any).string().optional().describe('Override the default endpoint URL in the card (e.g. the public URL of your n-get MCP endpoint)'),
        },
        ({ endpoint_url }: { endpoint_url?: string }) => {
            const caps = new CapabilitiesService({});
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(caps.toA2ACard(endpoint_url)),
                }],
            };
        }
    );

    return server;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
    const server = createServer();
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err: Error) => {
        process.stderr.write(`n-get MCP server error: ${err.message}\n`);
        process.exit(1);
    });
}
