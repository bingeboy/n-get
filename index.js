#! /usr/bin/env node

//modules
var colors = require("colors")
    , request = require("request")
    , fs = require("fs")
    , path = require("path")
    , argv = require('minimist')(process.argv)
    , chdir = require("./utils/chdir")
    , uriManager = require("./utils/uriManager");

//argv
var writePath
    , destination
    , argvs
    , startPath
    , fileNameLocal
    , reqUrls = [ ]
    , startPath;

//regex
var regexUrl = /([\w\d_-]*)\.?[^\\\/]*$/i;


// print process.argv TODO make this a module in utils
process.argv.forEach(function(val, index, array) {
    //grab next index value for destination to write
    if (val === "-d") {
        array.slice(index, index+1);
        return destination = array[index+1];
    }
    //push values to array for processing
    else if ( index > 1 && index !== array.indexOf(destination + 1) && index !== array.indexOf(destination)){
        reqUrls.push(val);
    }
});


//get destination for streams
function getDestination(destination) {
    if(!destination || destination === null || destination === "./" || destination === " "){
        return destination = process.cwd();
    }
    else {
      chdir(destination)
      return x = process.cwd();
    }
}


//process urls
var sendDownPipe = reqUrls.map(uriManager);

recersivePipe(sendDownPipe)
//Start downloads TODO move this to a utility
function recersivePipe(urls){
    var popped = urls.pop().toString();
    poppedReg = popped.match(regexUrl)[1];
    writePath = getDestination(destination) + "/" + poppedReg;

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
        return
    } else {
        recersivePipe(urls)
    }
}


