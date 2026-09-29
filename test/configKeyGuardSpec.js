'use strict';
/**
 * @fileoverview Ratchet guarding the configuration contract.
 *
 * n-get advertises its config surface to agents through `nget config show`,
 * `--capabilities`, and config/default.yaml. Twice now that surface has made
 * claims the code does not honour:
 *
 *   #154 — documented security keys did not take effect
 *   #164 — security.certificateValidation validated, defaulted, and reached no
 *          code at all; setting it false changed a label and nothing else
 *
 * Both were found by hand, one at a time, after shipping. An audit then turned
 * up a dozen more of the same shape. This spec exists so the next one fails in
 * CI instead of in a release.
 *
 * ── How the ratchet works ────────────────────────────────────────────────────
 *
 * Each check below carries an allowlist of the violations that exist today.
 * The assertion is EXACT equality, which enforces movement in one direction:
 *
 *   a new violation      -> not in the allowlist -> fails
 *   a violation fixed    -> stale allowlist entry -> fails until the line goes
 *
 * So the lists can only shrink, and they are the live inventory of the debt.
 * When a list reaches [] the corresponding class of bug is extinct and the
 * check becomes a plain invariant.
 *
 * Do not add entries to these lists to make a build pass. An addition means a
 * new key was shipped that does nothing — fix the key.
 */

const Joi = require('joi');

const ConfigManager = require('../lib/config/ConfigManager');
const {schemaKeys, consumerSource, unreadSchemaKeys, undeclaredYamlKeys} = require('./helpers/configKeyAudit');

/**
 * Schema keys that validate and default but reach no code.
 *
 * Empty as of #180, which removed the last sixteen. The invariant is now
 * unconditional: every key the schema accepts is read by something. An entry
 * appearing here again means a key was shipped that does nothing.
 */
const KNOWN_UNREAD_KEYS = [];

/**
 * Keys shipped in config/default.yaml that the schema never declares, and so
 * are removed by stripUnknown at load. Anything reading them gets undefined.
 *
 * Empty as of #180. The ssh and webhooks sections were declared in #175, and
 * downloads.enableStdout — set by the shipped fetch profile but reaching no
 * code — was removed rather than declared.
 */
const KNOWN_UNDECLARED_KEYS = [];

const sorted = xs => [...xs].sort();

describe('configuration contract guard', () => {
    let config;

    before(() => {
        config = new ConfigManager({environment: 'test', enableHotReload: false});
    });

    describe('every schema key must be read by something', () => {

        it('reports no unread keys beyond the known allowlist', () => {
            const unread = unreadSchemaKeys(config.schema);
            const unexpected = unread.filter(k => !KNOWN_UNREAD_KEYS.includes(k));

            expect(unexpected, [
                '',
                'These config keys validate and default but no code reads them:',
                ...unexpected.map(k => `    ${k}`),
                '',
                'A key that appears in `nget config show` and changes nothing is a',
                'lie told to an agent (see #154, #164). Wire it up or remove it.',
                'Do not add it to KNOWN_UNREAD_KEYS to make this pass.',
                '',
            ].join('\n')).to.deep.equal([]);
        });

        it('has no stale allowlist entries', () => {
            const unread = unreadSchemaKeys(config.schema);
            const fixed = KNOWN_UNREAD_KEYS.filter(k => !unread.includes(k));

            expect(fixed, [
                '',
                'These keys are listed in KNOWN_UNREAD_KEYS but are now read',
                '(or no longer exist):',
                ...fixed.map(k => `    ${k}`),
                '',
                'Delete them from the list — the ratchet only turns one way.',
                '',
            ].join('\n')).to.deep.equal([]);
        });
    });

    describe('every shipped key must exist in the schema', () => {

        it('reports no undeclared keys beyond the known allowlist', () => {
            const undeclared = undeclaredYamlKeys(config.schema);
            const unexpected = undeclared.filter(k => !KNOWN_UNDECLARED_KEYS.includes(k));

            expect(unexpected, [
                '',
                'These keys ship in config/default.yaml but the schema does not',
                'declare them, so stripUnknown deletes them at load:',
                ...unexpected.map(k => `    ${k}`),
                '',
                'Anything reading them receives undefined. Add them to the Joi',
                'schema, or stop shipping them in default.yaml.',
                '',
            ].join('\n')).to.deep.equal([]);
        });

        it('has no stale allowlist entries', () => {
            const undeclared = undeclaredYamlKeys(config.schema);
            const fixed = KNOWN_UNDECLARED_KEYS.filter(k => !undeclared.includes(k));

            expect(fixed, [
                '',
                'These keys are listed in KNOWN_UNDECLARED_KEYS but are now',
                'declared in the schema (or no longer shipped):',
                ...fixed.map(k => `    ${k}`),
                '',
                'Delete them from the list — the ratchet only turns one way.',
                '',
            ].join('\n')).to.deep.equal([]);
        });
    });

    describe('the detector itself works', () => {
        // Without these, a broken scan would report zero violations and every
        // check above would pass vacuously — the worst failure mode for a guard.
        //
        // These probe a SYNTHETIC schema rather than the real one. Asserting
        // against real violations would work today and then break the moment
        // the cleanup finishes and both allowlists reach [] — the guard would
        // start failing precisely when the codebase became correct.

        const synthetic = Joi.object({
            // Named so no source file could plausibly mention it.
            zzzKeyNoSourceFileMentions: Joi.boolean().default(false),
            // `timeout` is read throughout the download and SSH paths.
            timeout: Joi.number().default(1),
        });

        it('sees the real schema', () => {
            const keys = schemaKeys(config.schema);
            expect(keys.length).to.be.greaterThan(40);
            expect(keys).to.include('http.timeout');
            expect(keys).to.include('security.blockLocalhost');
        });

        it('flags a key nothing references', () => {
            expect(unreadSchemaKeys(synthetic)).to.include('zzzKeyNoSourceFileMentions');
        });

        it('does not flag a key the source does reference', () => {
            expect(unreadSchemaKeys(synthetic)).to.not.include('timeout');
        });

        it('does not mistake schema declarations for usage', () => {
            // The whole premise: ConfigManager's Joi schema and alias map
            // mention every key by name, so a scan that counts them as readers
            // finds nothing wrong. Strip them and the dead keys appear.
            const withDeclarations = consumerSource({keepDeclarations: true});
            const stripped = consumerSource();
            expect(withDeclarations.length).to.be.greaterThan(stripped.length);
            expect(stripped).to.not.match(/^\s*[A-Za-z0-9_]+\s*:\s*Joi\./m);
        });
    });

    describe('the two lists agree with the audit', () => {

        it('matches the recorded unread inventory exactly', () => {
            expect(sorted(unreadSchemaKeys(config.schema))).to.deep.equal(sorted(KNOWN_UNREAD_KEYS));
        });

        it('matches the recorded undeclared inventory exactly', () => {
            expect(sorted(undeclaredYamlKeys(config.schema))).to.deep.equal(sorted(KNOWN_UNDECLARED_KEYS));
        });
    });
});
