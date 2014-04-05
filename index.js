#! /usr/bin/env node

//modules
var path = require("path")
    ,fs = require("fs")
, argv = require("minimist")(process.argv)
, chdir = require("./lib/chdir")
, uriManager = require("./lib/uriManager")
, chdir = require("./lib/chdir")
, Crawler = require("simplecrawler"); //TODO this is only alpha


var destination
, argvs
, startPath
, fileNameLocal
, spiderDomain
, reqUrls = [ ]
, startPath;

//@Description: Take argv from cli.
process.argv.forEach(function(val, index, array) {
        if (val === "-d") {
            array.slice(index, index+1);
            return destination = array[index+1];
        }
        if ( index > 1 && index !== array.indexOf(destination + 1) && index !== array.indexOf(destination)){
            reqUrls.push(val);
        }
})

//@Description:
//Confirm that destination of the -d flag is a real path.
//The calles the chdir module.
if(typeof destination !== 'undefined') {
    fs.realpath(destination, function (err, resolvedPath) {
    if (err) throw err;
        destination = chdir(resolvedPath);
        return destination
    });
}

// -------------------------------Process urls

//@Description check the url and make if work for the pipe. Let users be idiots and type loose.
var sendDownPipe = reqUrls.map(uriManager);

//@Description take all the paths and download them in an async crazy manner for now. Maybe we will add a napkin in l8er for the squares that require them. ;)
var recersivePipe = require("./lib/recersivePipe")
recersivePipe(sendDownPipe, destination)
