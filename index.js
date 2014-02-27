var colors = require("colors");
var request = require("request");
var fs = require("fs");
var argv = require('minimist')(process.argv.slice(2));

console.log("get: ",process.argv[2]);
console.log("writing to: ",process.argv[3]);

var reqUrl, writePath;

reqUrl = process.argv[2];
writePath = process.argv[3];

var load = ".";
var url = reqUrl;
var filename = url.substring(url.lastIndexOf("/"));
console.log("filename: ", filename);
writePath = writePath + filename;

// HTTP GET Request
if(reqUrl !== null && reqUrl !== undefined && writePath !== undefined)

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
                console.log("Pipe Closed".blue)
            })

