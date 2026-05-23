"use strict";
function chdir(dir, quiet = false) {
    try {
        process.chdir(dir);
        if (!quiet) {
            console.log('Moving Directory: ' + process.cwd());
        }
        return process.cwd();
    }
    catch (error) {
        if (!quiet) {
            console.log('chdir: ' + error);
            console.log('Perhaps your directory doesn\'t exist.');
        }
        throw error;
    }
}
module.exports = chdir;
