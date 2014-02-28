#! /usr/bin/env node
process.cwd()
var colors = require("colors");
var request = require("request");
var fs = require("fs");
var argv = require('minimist')(process.argv.slice(2));

var reqUrl = process.argv[2];
var writePath = !process.argv[3] ? process.cwd() : process.cwd() + process.argv[3]

console.log("writePath".bold, writePath);


var load = ".";
var url = reqUrl;
var filename = url.substring(url.lastIndexOf("/"));
console.log("filename: ", filename);
console.log("Writing to disk : ".green, writePath+filename);
writePath = writePath + filename;

//regex
var protocal = /(^http|https|unix|ssh|ftp)/;

//Check for protocol
if(!protocal.test(reqUrl)){
    reqUrl = "http://" + reqUrl;
    console.log("No Protocal in File".red, " Using:".bold, reqUrl);
}

//Check for destination
if(!writePath || writePath === null) {
    console.log("ere");
    writePath = "./";
}
// HTTP GET Request
if(reqUrl !== null && reqUrl !== undefined && writePath !== undefined)

console.log("get: ".inverse, reqUrl);
console.log("writing to: ".inverse, writePath);

var r = request(reqUrl)
            .on("end", function(){
                console.log("Stream End")
            })
            .on("data", function(chunk){
                //shhh quite stream in progress
                console.log(chunk.length);
            })
            .on("error", function(err){
                console.log("Error in Stream".red, err.code)
            })
            .pipe(fs.createWriteStream(writePath))
            .on("finish", function () {
                console.log("Pipe Closed".rainbow)
            })

