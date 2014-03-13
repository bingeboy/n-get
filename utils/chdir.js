
//below this ----------------------------- to modules
module.exports = function chdir(dir) {
    try {
        process.chdir(dir);
        console.log('Moving Directory: '.bold + process.cwd());
    }
    catch (err) {
        console.log('chdir: ' + err);
        console.log('Perhaps your directory doesn\'t exist.');
    }
}
