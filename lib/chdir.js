
const colors = require('colors');

/*
Description: This module acts like a 'chdir'
Param: {String} should be the destination folder
*/

module.exports = function chdir(dir, quiet = false) {
    try {
        process.chdir(dir);
        if (!quiet) {
            console.log('Moving Directory: '.bold + process.cwd());
        }
        return process.cwd();
    }
    catch (err) {
        if (!quiet) {
            console.log('chdir: ' + err);
            console.log('Perhaps your directory doesn\'t exist.');
        }
        throw err;
    }
};
