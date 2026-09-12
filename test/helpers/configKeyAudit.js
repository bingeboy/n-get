'use strict';
/**
 * @fileoverview Static audit of the configuration contract.
 *
 * Two questions, both of which have been answered wrongly in shipped releases:
 *
 *   1. Does every key the schema accepts actually DO something?
 *      security.certificateValidation did not (#164). Neither did the documented
 *      security keys fixed in #154. A key that validates, defaults, and appears
 *      in `nget config show` but reaches no code is a lie told to an agent.
 *
 *   2. Does every key we ship in default.yaml actually EXIST in the schema?
 *      Config is validated with stripUnknown, so a documented key that the
 *      schema does not declare is deleted silently at load. It looks supported
 *      and evaporates.
 *
 * The reader detection is deliberately CONSERVATIVE. It reports a key as unread
 * only when its name appears nowhere outside the schema and alias-map
 * declarations. That yields no false positives — the failure mode is missing a
 * dead key whose leaf name collides with a common property (`enabled`, `port`,
 * `host`) — which is the right trade for a guard that must never cry wolf.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** Directories that hold no config consumers. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'site', '.claude', 'test', 'scripts']);

/**
 * Flatten a nested object to dotted leaf paths.
 * @param {object} obj
 * @returns {string[]}
 */
function flatten(obj) {
    const out = [];
    (function walk(node, prefix) {
        if (node === null || typeof node !== 'object' || Array.isArray(node)) {
            if (prefix) { out.push(prefix); }
            return;
        }
        for (const key of Object.keys(node)) {
            walk(node[key], prefix ? `${prefix}.${key}` : key);
        }
    })(obj, '');
    return out;
}

/**
 * Every leaf key the Joi schema accepts, as dotted paths.
 * @param {object} joiSchema - a live ConfigManager's `schema`
 * @returns {string[]}
 */
function schemaKeys(joiSchema) {
    const out = [];
    (function walk(node, prefix) {
        if (!node) { return; }
        if (node.type === 'object' && node.keys) {
            for (const key of Object.keys(node.keys)) {
                walk(node.keys[key], prefix ? `${prefix}.${key}` : key);
            }
            return;
        }
        if (prefix) { out.push(prefix); }
    })(joiSchema.describe(), '');
    return out;
}

/** Every key shipped in config/default.yaml, excluding profile definitions. */
function defaultYamlKeys() {
    const doc = yaml.load(fs.readFileSync(path.join(REPO_ROOT, 'config/default.yaml'), 'utf8'));
    // profiles.* are *values* applied wholesale by applyProfile(), not keys the
    // schema declares individually.
    return flatten(doc).filter(k => !k.startsWith('profiles.'));
}

/**
 * Source text of every config consumer, with declaration sites removed.
 *
 * ConfigManager's alias map and Joi schema DECLARE keys; they do not consume
 * them, so counting them as usage is what let 17 dead keys accumulate unseen.
 * types/index.ts is a type mirror of the schema, likewise not a consumer.
 *
 * @param {{keepDeclarations?: boolean}} [opts] - keepDeclarations retains the
 *   schema and alias-map lines. Only the guard's own self-test uses it, to
 *   prove that stripping them is what makes dead keys visible.
 * @returns {string}
 */
function consumerSource(opts = {}) {
    const chunks = [];

    (function collect(dir) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (SKIP_DIRS.has(entry.name)) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { collect(full); continue; }
            if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) { continue; }

            const posix = full.split(path.sep).join('/');
            const text = fs.readFileSync(full, 'utf8');

            if (posix.endsWith('types/index.ts') && !opts.keepDeclarations) { continue; }

            if (posix.endsWith('lib/config/ConfigManager.ts') && !opts.keepDeclarations) {
                const kept = text.split('\n').filter(line => {
                    const isAlias = /^\s*'[a-z0-9]+'\s*:\s*'[A-Za-z0-9]+',?\s*$/.test(line);
                    const isJoiDecl = /^\s*[A-Za-z0-9_]+\s*:\s*Joi\./.test(line);
                    return !isAlias && !isJoiDecl;
                });
                chunks.push(kept.join('\n'));
                continue;
            }

            chunks.push(text);
        }
    })(REPO_ROOT);

    return chunks.join('\n');
}

/**
 * Schema keys that no code reads.
 * @param {object} joiSchema
 * @returns {string[]}
 */
function unreadSchemaKeys(joiSchema) {
    const source = consumerSource();
    return schemaKeys(joiSchema).filter(key => {
        const leaf = key.split('.').pop();
        const referenced = source.includes(`.${leaf}`)
            || source.includes(`'${leaf}'`)
            || source.includes(`"${leaf}"`)
            || source.includes(`${leaf}:`)
            || source.includes(key);
        return !referenced;
    });
}

/**
 * Keys shipped in default.yaml that the schema does not declare. These are
 * stripped at load and silently do nothing.
 * @param {object} joiSchema
 * @returns {string[]}
 */
function undeclaredYamlKeys(joiSchema) {
    const declared = new Set(schemaKeys(joiSchema));
    // A yaml leaf is covered if it, or an ancestor, is a schema leaf. An
    // ancestor match means the schema accepts a free-form object there.
    const covered = key => {
        const parts = key.split('.');
        for (let i = parts.length; i > 0; i--) {
            if (declared.has(parts.slice(0, i).join('.'))) { return true; }
        }
        return false;
    };
    return defaultYamlKeys().filter(k => !covered(k));
}

module.exports = {flatten, schemaKeys, defaultYamlKeys, consumerSource, unreadSchemaKeys, undeclaredYamlKeys};
