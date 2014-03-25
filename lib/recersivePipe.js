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

function bytesToSize(bytes) {
   var k = 1000;
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes === 0) return '0 Bytes';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)),10);
   return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

// Takes array of urls and pipes them disk
var time, diff, stateDisplay, fileSize;
function recersivePipe(urls, distination){
    //start timer
    time = process.hrtime();

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
    //check if the file already exist on disk
    if(fs.lstatSync(writePath).isFile()) {
        writePath = writePath + "(" + new Date() + ")"
        console.log("Duplicate File Name Found".red, writePath);
    }
    var r = progress(request(popped))
    .on("response", function(res){
        if(urls > 1) console.log("%d Request: ", fileCounter++);
    })
    .on("progress", function (state) {
        fileSize = state.total;
        //console.log('File Size', state.total + "bytes" , state.percent + "%");
    })
    .on("end", function(){
        //console.log("Stream End")
    })
    .on("data", function(chunk){
        //console.log('got %d bytes of data', chunk.length);
    })
    .on("error", function(err){
        console.log("Error in Stream".red, err.code)
    })
    .pipe(fs.createWriteStream(writePath))
    .on("finish", function () {
        console.log("Download Complete".rainbow.bold + ' 😜');
        console.log("File Size".green, bytesToSize(fileSize));
        diff = process.hrtime(time);
        console.log('%d nanoseconds'.yellow, diff[0] * 1e9 + diff[1]);
    });

    if(urls.length === 0){
        //console.log("All Requests Made".cyan);
        return
    } else {
        console.log("Requests: ", ++fileCounter);
        recersivePipe(urls)
    }
}

module.exports = recersivePipe;


