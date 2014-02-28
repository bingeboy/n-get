#! /usr/bin/env node

var colors = require("colors");
var request = require("request");
var fs = require("fs");
var argv = require('minimist')(process.argv.slice(2));

reqUrl = process.argv[2];
writePath = "./" || process.argv[3];


var reqUrl, writePath;


var load = ".";
var url = reqUrl;
var filename = url.substring(url.lastIndexOf("/"));
console.log("filename: ", filename);
writePath = writePath + filename;

//regex
var protocal = /(^http|https|unix|ssh|ftp)/;

//Check for protocol
if(protocal.test(reqUrl)) return;
else
    reqUrl = "http://" + reqUrl;
    console.log("No Protocal in File".red, " Using:".bold, reqUrl);

//Check for destination
if(!writePath || writePath === null) writePath = "./";

// HTTP GET Request
if(reqUrl !== null && reqUrl !== undefined && writePath !== undefined)

console.log("get: ".inverse, reqUrl);
console.log("writing to: ".inverse, writePath);

var r = request(reqUrl.toString())
            .on("end", function(){
                console.log("Stream End")
            })
            .on("data", function(chunk){
                //shhh quite stream in progress
            })
            .on("error", function(){
                console.log("Error in Stream".red)
            })
            .pipe(fs.createWriteStream(writePath))
            .on("finish", function () {
                console.log("Pipe Closed".rainbow)
            })

