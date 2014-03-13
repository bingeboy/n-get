//modules
var request = require("request")
    , fs = require("fs")
    , colors = require("colors")
    , path = require("path");

//regex
var regexUrl = /([\w\d_-]*)\.?[^\\\/]*$/i; //TODO remove this var. node path api replaces.

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

// Takes array of urls and pipes them disk
function recersivePipe(urls, distination){
    //location to fs.write
    var writePath = process.cwd().toString();

    var popped = urls.pop().toString();
    poppedReg = path.basename(popped); //TODO rename this var
    //get the specific destination if user enters
    if(!typeof destination === "undefined") {
        writePath = getDestination(destination) + "/" + poppedReg;
    }else {
        writePath = writePath + "/" + poppedReg;
    }


    var r = request(popped)
    .on("end", function(){
        console.log("Stream End")
    })
    .on("data", function(chunk){
        console.log('got %d bytes of data', chunk.length);
    })
    .on("error", function(err){
        console.log("Error in Stream".red, err.code)
    })
    .pipe(fs.createWriteStream(writePath))
    .on("finish", function () {
        console.log("Pipe Closed".rainbow)
    });

    if(urls.length === 0){
        console.log("All Requests Made".cyan);
        return
    } else {
        recersivePipe(urls)
    }
}

module.exports = recersivePipe;


