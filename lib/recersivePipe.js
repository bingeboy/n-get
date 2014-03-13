var request = require("request")
    , fs = require("fs")
    , colors = require("colors")
    , path = require("path")
    , progress = require('request-progress')
    , emoji = require('emoji');

//lib modules
var chdir = require("./chdir");



var fileCounter = 1;
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
    console.log(urls, "here");
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
    var r = progress(request(popped))
    .on("response", function(res){
        console.log("File Request: ", fileCounter++);
    })
    .on("progress", function (state) {
        //console.log('getting size in bytes', state.received);
        // The properties bellow can be null if response does not contain
        // the content-length header
        //console.log('got all these bytes', state.total);
        console.log(" ", JSON.stringify(state));
    })
    .on("end", function(){
        console.log("Stream End")
    })
    .on("data", function(chunk){
        //console.log('got %d bytes of data', chunk.length);
    })
    .on("error", function(err){
        console.log("Error in Stream".red, err.code)
    })
    .pipe(fs.createWriteStream(writePath))
    .on("finish", function () {
        console.log("Pipe Closed".rainbow.bold + ' 😜');
    });

    if(urls.length === 0){
        console.log("All Requests Made".cyan);
        return
    } else {
        console.log("Requests: ", ++fileCounter);
        recersivePipe(urls)
    }
}

module.exports = recersivePipe;


