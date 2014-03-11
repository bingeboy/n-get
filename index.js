#! /usr/bin/env node

console.time("formatUri");
console.time("totaltime");

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
    , reqUrls = [ ]
    , startPath;

// print process.argv
process.argv.forEach(function(val, index, array) {
    //grab next index value for destination to write
    if (val === "-d") {
        destination = array[index+1];
    }
    //push values to array for processing
    else if ( index > 1 && index !== array.indexOf(destination + 1) && index !== array.indexOf(destination)){
        reqUrls.push(val);
    }
});

//Check for destination
if(!writePath || writePath === null) writePath = "./";
//TODO add chdir support var x  = chdir(writePath);
writePath = destination;
writeFileTo = chdir(writePath)
console.log("writePath".bold, writePath);
console.log("filename: ", uriManager.file);

//process urls
if(reqUrls) recersivePipe(reqUrls.map(uriManager));
//download
function recersivePipe(urls){
    var popped = urls.pop();
    var r = request(popped).on("end", function(){
        console.log("Stream End")
    })
    .on("data", function(chunk){
        console.log('got %d bytes of data', chunk.length);
    })
    .on("error", function(err){
        console.log("Error in Stream".red, err.code)
    })
    .pipe(fs.createWriteStream(writeFileTo))
    .on("finish", function () {
        console.log("Pipe Closed".rainbow)
    })
    if(urls.length === 0){
        return
    } else {
        recersivePipe(urls)
    }
}


