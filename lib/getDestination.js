
/**
 * @fileoverview Destination directory resolution utility
 * Handles destination path validation and directory changes for downloads
 * @module getDestination
 */

const chdir = require('./chdir');

/**
 * Resolves and validates the destination directory for downloads
 * Changes to the specified directory or defaults to current working directory
 * @function getDestination
 * @param {string} destination - The target destination path
 * @returns {string} The absolute path to the resolved destination directory
 */
function getDestination(destination) {
    if (!destination || destination === null || destination === './' || destination === ' ') {
        return process.cwd();
    }

    chdir(destination);
    return process.cwd();
}

module.exports = getDestination;
