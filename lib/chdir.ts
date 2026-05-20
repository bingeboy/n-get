/**
 * @fileoverview Directory change utility module
 * Provides safe directory changing functionality with error handling and optional output
 * @module chdir
 */

require('colors'); // Extends String.prototype

/**
 * Changes the current working directory to the specified path
 * @param dir - The destination directory path
 * @param quiet - Whether to suppress console output
 * @returns The new current working directory path
 * @throws {Error} When the directory change fails (e.g., directory doesn't exist)
 */
function chdir(dir: string, quiet: boolean = false): string {
    try {
        process.chdir(dir);
        if (!quiet) {
            console.log('Moving Directory: '.bold + process.cwd());
        }

        return process.cwd();
    } catch (error) {
        if (!quiet) {
            console.log('chdir: ' + error);
            console.log('Perhaps your directory doesn\'t exist.');
        }

        throw error;
    }
}

export = chdir;
