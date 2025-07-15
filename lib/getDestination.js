
//get destination for streams
function getDestination(destination) {
    if(!destination || destination === null || destination === "./" || destination === " "){
        return destination = process.cwd();
    }
    else {
      chdir(destination);
      return x = process.cwd();
    }
}

module.exports = getDestination;
