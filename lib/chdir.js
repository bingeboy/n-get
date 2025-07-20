
/**
 * @fileoverview Directory change utility module
 * Provides safe directory changing functionality with error handling and optional output
 * @module chdir
 */

require('colors'); // Extends String.prototype

/**
 * Changes the current working directory to the specified path
 * @function chdir
 * @param {string} dir - The destination directory path
 * @param {boolean} [quiet=false] - Whether to suppress console output
 * @returns {string} The new current working directory path
 * @throws {Error} When the directory change fails (e.g., directory doesn't exist)
 */
module.exports = function chdir(dir, quiet = false) {
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
};
