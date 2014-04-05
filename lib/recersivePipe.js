var request = require("request")
    , fs = require("fs")
    , colors = require("colors")
    , path = require("path")
    , progress = require('request-progress')
    , emoji = require('emoji');

//lib modules
var chdir = require("./chdir");


// Keep tracks of the files to download.
var fileCounter = 1;

//@description: get destination for streams.
//TODO move this into a different module. Doesnt' belong here.
function getDestination(destination) {
    if(!destination || destination === null || destination === "./" || destination === " "){
        return destination = process.cwd();
    }
    else {
      chdir(destination);
      return x = process.cwd();
    }
}

//@Description: Handles file size to display
function bytesToSize(bytes) {
   var k = 1000;
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes === 0) return '0 Bytes';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)),10);
   return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

//@Description: Takes array of urls and pipes them disk.
//@para urls {array.object.instance}
//@destination {String} is this a verified location on disk
var time, diff, stateDisplay, fileSize;
function recersivePipe(urls, destination){
    if(urls === 'undefined') console.log("FAILED To Process URI");

    //start timer
    time = process.hrtime();

    //location to fs.write
    var writePath = process.cwd().toString();
    var popped = urls.pop();
    poppedReg = path.basename(popped).toString(); //TODO rename this var
    //get the specific destination if user enters
    if(typeof destination !== "undefined") {
        writePath = getDestination(destination) + "/" + poppedReg;
    }else {
        writePath = writePath + "/" + poppedReg;
    }
    //check if the file already exist on disk
    try {
        fs.statSync(writePath).isFile();
        writePath = writePath + "(" + new Date() + ")"
        console.log("Duplicate File Name Found".red, writePath);
    } catch (err) {
        //name doesn't exist.... proceeed
    }
    var r = progress(request(popped))
    .on("response", function(res){
        if(urls > 1) process.stdout.write("%d Request: ", fileCounter++);
    })
    .on("progress", function (state) {
        if(state.total !== null) {
            fileSize = state.total;
            process.stdout.write(state.percent + "%\r");
        }
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
    .on("finish", function (state) {
        console.log("\n Download Complete".rainbow.bold + ' 😜');
        if(fileSize) console.log("File Size".green, bytesToSize(fileSize)); //TODO there is some issue with fileSize and fs.statSync
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


