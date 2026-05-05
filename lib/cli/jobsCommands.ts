/**
 * @fileoverview jobsCommands — `nget jobs` subcommand.
 *
 * Lists all currently active download sessions.
 * Agent mode (default): emits an NDJSON line per session.
 * Human mode (--human): prints a formatted table to stderr.
 *
 * Cross-agent visibility is the only goal here — no mutation.
 */

import { readActiveSessions, pruneDeadSessions } from '../core/DownloadSession.js';
import type { SessionStatus } from '../../types/index.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export function handleJobsCommand(argv: Record<string, unknown>, humanMode: boolean): void {
    pruneDeadSessions();
    const sessions = readActiveSessions();

    if (humanMode) {
        _renderHuman(sessions);
    } else {
        _renderNdjson(sessions);
    }
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function _renderNdjson(sessions: SessionStatus[]): void {
    const line = {
        event:    'jobs',
        ts:       Date.now(),
        count:    sessions.length,
        sessions: sessions.map(_summarise),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
}

function _renderHuman(sessions: SessionStatus[]): void {
    const out = process.stderr;

    if (sessions.length === 0) {
        out.write('No active download sessions.\n');
        return;
    }

    out.write(`Active sessions (${sessions.length}):\n`);
    out.write('─'.repeat(60) + '\n');

    for (const s of sessions) {
        const urls   = Object.keys(s.downloads);
        const active = urls.filter(u => s.downloads[u]?.status === 'active').length;
        const done   = urls.filter(u => s.downloads[u]?.status === 'complete').length;
        const errors = urls.filter(u => s.downloads[u]?.status === 'error').length;

        out.write(`session  ${s.sessionId}\n`);
        out.write(`  agent  ${s.agent ?? '(none)'}\n`);
        out.write(`  pid    ${s.pid}\n`);
        out.write(`  start  ${s.startTime}\n`);
        out.write(`  files  ${urls.length} total · ${active} active · ${done} done · ${errors} errors\n`);
        out.write('\n');
    }
}

function _summarise(s: SessionStatus) {
    const urls = Object.keys(s.downloads);
    return {
        sessionId: s.sessionId,
        agent:     s.agent,
        pid:       s.pid,
        startTime: s.startTime,
        total:     urls.length,
        active:    urls.filter(u => s.downloads[u]?.status === 'active').length,
        complete:  urls.filter(u => s.downloads[u]?.status === 'complete').length,
        errors:    urls.filter(u => s.downloads[u]?.status === 'error').length,
    };
}
