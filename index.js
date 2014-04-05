#! /usr/bin/env node

//modules
var path = require("path")
, argv = require("minimist")(process.argv)
, chdir = require("./lib/chdir")
, uriManager = require("./lib/uriManager")
, Crawler = require("simplecrawler"); //TODO this is only alpha


var destination
, argvs
, startPath
, fileNameLocal
, spiderDomain
, reqUrls = [ ]
, startPath;

process.argv.forEach(function(val, index, array) {
    if (val === "-d") {
        array.slice(index, index+1);
        return destination = array[index+1];
    }
    if ( index > 1 && index !== array.indexOf(destination + 1) && index !== array.indexOf(destination)){
        reqUrls.push(val);
    }
});

console.log(destination, "HERE");
//process urls
console.log(reqUrls);
//process urls
var sendDownPipe = reqUrls.map(uriManager);
var recersivePipe = require("./lib/recersivePipe")

recersivePipe(sendDownPipe)
