
const chdir = require('./chdir');

// Get destination for streams
function getDestination(destination) {
    if (!destination || destination === null || destination === './' || destination === ' ') {
        return process.cwd();
    }

    chdir(destination);
    return process.cwd();
}

module.exports = getDestination;
