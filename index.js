#! /usr/bin/env node

//modules
var colors = require("colors")
    , request = require("request")
    , fs = require("fs")
    , path = require("path")
    , argv = require('minimist')(process.argv.slice(2));

//argv
var reqUrl = process.argv[2]
    , writePath = !process.argv[3] ? process.cwd() : process.argv[3]
    , startPath = process.cwd();

var load = "."
    , url = reqUrl
    , filename = url.substring(url.lastIndexOf("/"));

    filename = filename.replace("/","");

//Check for destination
if(!writePath || writePath === null) writePath = "./";
var x  = chdir(writePath)
writeFileTo = filename;
console.log("writePath".bold, writePath);


console.log("filename: ", filename);

//regex
var protocal = /(^http|https|unix|ssh|ftp)/;

//Check for protocol
if(!protocal.test(reqUrl)){
    reqUrl = "http://" + reqUrl;
    console.log("No Protocal in File".red, " Using:".bold, reqUrl);
}


// HTTP GET Request
if(reqUrl !== null && reqUrl !== undefined && writePath !== undefined)

console.log("Request: ".inverse.cyan, reqUrl);

var r = request(reqUrl)
            .on("end", function(){
                console.log("Stream End")
            })
            .on("data", function(chunk){
            //    console.log('got %d bytes of data', chunk.length);
            })
            .on("error", function(err){
                console.log("Error in Stream".red, err.code)
            })
            .pipe(fs.createWriteStream(writeFileTo))
            .on("finish", function () {
                console.log("Pipe Closed".rainbow)
            })

//below this ----------------------------- to modules
function chdir(dir) {
    try {
        process.chdir(dir);
        console.log('Moving Directory: '.bold + process.cwd());
    }
    catch (err) {
        console.log('chdir: ' + err);
    }
}
