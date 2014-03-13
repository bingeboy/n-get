#! /usr/bin/env node

//modules
var path = require("path")
, argv = require("minimist")(process.argv)
, chdir = require("./lib/chdir")
, uriManager = require("./lib/uriManager")

//argv
var  destination
, argvs
, startPath
, fileNameLocal
, reqUrls = [ ]
, startPath;


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


//process urls
var sendDownPipe = reqUrls.map(uriManager);
var recersivePipe = require("./lib/recersivePipe")

recersivePipe(sendDownPipe)
